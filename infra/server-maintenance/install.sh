#!/usr/bin/env bash
set -euo pipefail
umask 077
role=${1:?usage: install.sh production|test}
[[ $EUID == 0 ]] || { echo 'root required'; exit 1; }
[[ $role == production || $role == test ]] || exit 1
cd -- "$(dirname -- "$0")"
# Check every unit before touching persistent host configuration.
systemd-analyze verify "$PWD/server-guard.service" "$PWD/server-guard.timer" "$PWD/server-audit.service" "$PWD/server-audit.timer" "$PWD/server-test-swap.service"
# Refuse to silently change a previously installed host role.
if [[ -f /etc/server-guard.json ]]; then
  python3 -c 'import json,sys; assert json.load(open("/etc/server-guard.json"))["role"] == sys.argv[1]' "$role"
fi
backup="/root/server-guard-backups/$(date -u +%Y%m%dT%H%M%SZ)-$role"
mkdir -p /root/server-guard-backups
mkdir "$backup"
targets=(etc/server-guard.json etc/sysctl.d/90-server-guard.conf usr/local/lib/server-guard/server_guard.py usr/local/sbin/server-test-run usr/local/sbin/server-health etc/systemd/system/server-guard.service etc/systemd/system/server-guard.timer etc/systemd/system/server-audit.service etc/systemd/system/server-audit.timer etc/systemd/system/server-test-swap.service)
for path in "${targets[@]}"; do
  if [[ -e /$path ]]; then printf '%s\n' "$path" >> "$backup/present.txt"; else printf '%s\n' "$path" >> "$backup/absent.txt"; fi
done
if [[ -f $backup/present.txt ]]; then tar -C / -cf "$backup/files.tar" -T "$backup/present.txt"; fi
sysctl -n vm.swappiness > "$backup/swappiness.before"
python3 - "$backup/units.before.json" <<'PY'
import json,subprocess,sys
units=['server-guard.timer','server-audit.timer','server-guard.service','server-audit.service','server-test-swap.service']
result={u:{key:subprocess.run(['systemctl',verb,u],capture_output=True,text=True).stdout.strip() for key,verb in [('enabled','is-enabled'),('active','is-active')]} for u in units}
with open(sys.argv[1],'w') as f: json.dump(result,f)
PY
free -m > "$backup/memory.before"
docker ps --format '{{.ID}} {{.Names}} {{.Status}}' > "$backup/containers.before"
cp rollback.py "$backup/rollback.py"
rollback_on_error() {
  result=$?
  trap - ERR
  echo "Install failed; rolling back from $backup" >&2
  python3 "$backup/rollback.py" "$backup" || echo "ROLLBACK FAILED; use $backup for recovery" >&2
  exit "$result"
}
trap rollback_on_error ERR
install -d -m 700 /var/lib/server-guard /var/log/server-guard /usr/local/lib/server-guard
install -m 700 server_guard.py /usr/local/lib/server-guard/server_guard.py
install -m 600 "$role.json" /etc/server-guard.json
for unit in server-guard.service server-guard.timer server-audit.service server-audit.timer; do
  install -m 644 "$unit" "/etc/systemd/system/$unit"
done
cat > /usr/local/sbin/server-test-run <<'EOF'
#!/bin/sh
exec /usr/bin/python3 /usr/local/lib/server-guard/server_guard.py run "$@"
EOF
cat > /usr/local/sbin/server-health <<'EOF'
#!/bin/sh
exec /usr/bin/python3 /usr/local/lib/server-guard/server_guard.py status "$@"
EOF
chmod 700 /usr/local/sbin/server-test-run /usr/local/sbin/server-health
printf 'vm.swappiness = 20\n' > /etc/sysctl.d/90-server-guard.conf
sysctl -p /etc/sysctl.d/90-server-guard.conf
if [[ $role == test ]]; then
  install -d -m 700 /srv/server-tests
  if docker network inspect server-tests > /dev/null 2>&1; then
    docker network inspect server-tests | python3 -c 'import json,sys; n=json.load(sys.stdin)[0]; assert n["Driver"]=="bridge" and n["Scope"]=="local" and n.get("Labels",{}).get("io.xiangwei.server-guard")=="test-v1", "Existing server-tests network is not owned by this tool"'
  else
    docker network create --driver bridge --label io.xiangwei.server-guard=test-v1 server-tests
  fi
  # Separate boot unit avoids editing /etc/fstab. Never replace an existing file.
  if [[ ! -e /var/lib/server-guard/emergency.swap ]]; then
    python3 -c 'import shutil; assert shutil.disk_usage("/var/lib/server-guard").free >= 8*1024**3, "Need 8 GiB free before allocating swap"'
    fallocate -l 2G /var/lib/server-guard/emergency.swap
    chmod 600 /var/lib/server-guard/emergency.swap
    mkswap /var/lib/server-guard/emergency.swap
    touch "$backup/swap-created"
  fi
  install -m 644 server-test-swap.service /etc/systemd/system/server-test-swap.service
fi
systemctl daemon-reload
if [[ $role == test ]]; then systemctl enable --now server-test-swap.service; fi
systemctl start server-guard.service
systemctl start server-audit.service
systemctl enable --now server-guard.timer server-audit.timer
sha256sum /usr/local/lib/server-guard/server_guard.py > "$backup/installed.sha256"
trap - ERR
printf 'Installed role=%s backup=%s\n' "$role" "$backup"
