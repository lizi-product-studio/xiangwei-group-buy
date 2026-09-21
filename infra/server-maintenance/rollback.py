#!/usr/bin/env python3
"""Restore only installer-owned paths. Preserve swap, state, logs and network."""
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ALLOWED = {
    'etc/server-guard.json', 'etc/sysctl.d/90-server-guard.conf',
    'usr/local/lib/server-guard/server_guard.py',
    'usr/local/sbin/server-test-run', 'usr/local/sbin/server-health',
    *('etc/systemd/system/' + name for name in (
        'server-guard.service', 'server-guard.timer', 'server-audit.service',
        'server-audit.timer', 'server-test-swap.service')),
}
UNITS = ['server-guard.timer', 'server-audit.timer', 'server-guard.service',
         'server-audit.service', 'server-test-swap.service']


def run(*args, check=True):
    return subprocess.run(args, check=check, timeout=60)


def main():
    backup = Path(sys.argv[1]).resolve(strict=True)
    if backup.parent != Path('/root/server-guard-backups'):
        raise RuntimeError('Expected a direct child of /root/server-guard-backups')
    present = (backup / 'present.txt').read_text().splitlines() if (backup / 'present.txt').exists() else []
    absent = (backup / 'absent.txt').read_text().splitlines() if (backup / 'absent.txt').exists() else []
    if set(present) | set(absent) != ALLOWED or set(present) & set(absent):
        raise RuntimeError('Invalid backup file manifest')
    before = json.loads((backup / 'units.before.json').read_text())
    swappiness = int((backup / 'swappiness.before').read_text())
    archive = tarfile.open(backup / 'files.tar') if present else None
    if archive and (set(archive.getnames()) != set(present) or any(not m.isfile() for m in archive.getmembers())):
        raise RuntimeError('Backup must contain exactly the regular files in its manifest')
    for unit in UNITS:
        run('systemctl', 'disable', '--now', unit, check=False)
    for path in absent:
        Path('/' + path).unlink(missing_ok=True)
    if archive:
        for member in archive.getmembers():
            target = Path('/') / member.name
            target.write_bytes(archive.extractfile(member).read())
            target.chmod(member.mode)
        archive.close()
    run('sysctl', '-w', 'vm.swappiness=' + str(swappiness))
    run('systemctl', 'daemon-reload')
    for unit in UNITS:
        state = before[unit]
        if state['enabled'] == 'enabled':
            run('systemctl', 'enable', unit)
        if state['active'] == 'active':
            run('systemctl', 'start', unit)
    print('Rollback complete. Evidence, dedicated network and any active swap are retained; no swapoff was executed.')


if __name__ == '__main__':
    main()
