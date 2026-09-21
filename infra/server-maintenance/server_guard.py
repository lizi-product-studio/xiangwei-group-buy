#!/usr/bin/env python3
"""Small host monitor and opt-in, bounded test runner. No third-party packages."""
import argparse
import datetime
import fcntl
import json
import logging
import logging.handlers
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

CONFIG = Path('/etc/server-guard.json')
STATE = Path('/var/lib/server-guard')
LOG = Path('/var/log/server-guard')
NAME = 'server-test-runner'
LABEL = 'io.xiangwei.server-guard'


def command(args, timeout=15, check=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}): {result.stderr[:300]}')
    return result


def read_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def write_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.chmod(0o600)
    temp.replace(path)


def event(kind, **fields):
    logger = logging.getLogger('server-guard')
    if not logger.handlers:
        handler = logging.handlers.RotatingFileHandler(LOG / 'events.jsonl', maxBytes=2*1024*1024, backupCount=5)
        handler.setFormatter(logging.Formatter('%(message)s'))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    value = {'time': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'event': kind, **fields}
    logger.info(json.dumps(value, ensure_ascii=False))
    print(json.dumps(value, ensure_ascii=False), flush=True)


def memory():
    values = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        values[key] = int(value.split()[0]) // 1024
    return {key: values[key] for key in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree')}


def runner():
    result = command(['docker', 'container', 'ls', '-a', '--filter', f'name=^/{NAME}$', '--format', '{{.ID}}'])
    if not result.stdout.strip():
        return None
    return json.loads(command(['docker', 'inspect', result.stdout.strip()]).stdout)[0]


def owned(container):
    return bool(container and container['Name'] == '/' + NAME
                and container.get('Config', {}).get('Labels', {}).get(LABEL) == 'test-v1')


def isolated_network(network):
    return (network.get('Driver') == 'bridge' and network.get('Scope') == 'local'
            and network.get('Labels', {}).get(LABEL) == 'test-v1')


def stop_reason(config, container, available, previous, now):
    """Only this helper's labeled runner on the test host is stoppable."""
    if config['role'] != 'test' or not owned(container) or not container['State']['Running']:
        return None, 0
    labels = container['Config']['Labels']
    try:
        deadline = int(labels[LABEL + '.deadline'])
    except (KeyError, ValueError, TypeError):
        return None, 0  # malformed metadata never expands stop authority
    if now >= deadline:
        return 'timeout', 0
    same_run = previous.get('runner_id') == container['Id']
    fresh = 0 <= now - previous.get('time', 0) <= 45
    count = previous.get('low_samples', 0) if same_run and fresh else 0
    count = count + 1 if available < config['stop_below_mib'] else 0
    return ('low_memory' if count >= 2 else None), count


def check(config):
    previous = read_json(STATE / 'latest.json', {})
    now = time.time()
    mem = memory()
    current = runner() if config['role'] == 'test' else None
    reason, count = stop_reason(config, current, mem['MemAvailable'], previous, now)
    snapshot = {'time': now, 'role': config['role'], 'memory_mib': mem,
                'disk_free_mib': shutil.disk_usage('/').free // 1048576,
                'low_samples': count, 'runner_id': current['Id'] if current else None,
                'runner_running': bool(current and current['State']['Running']),
                'memory_pressure': Path('/proc/pressure/memory').read_text().strip()}
    if reason:
        event('stop_requested', reason=reason, container=current['Id'], available_mib=mem['MemAvailable'])
        # Address the full ID, never a name that another process can replace.
        command(['docker', 'stop', '--time', '10', current['Id']], timeout=25)
        event('test_stopped', reason=reason, container=current['Id'])
        snapshot['runner_running'] = False
        snapshot['stop_reason'] = reason
    if mem['MemAvailable'] < config['warn_below_mib'] and now - previous.get('last_warning', 0) > 300:
        event('memory_warning', role=config['role'], available_mib=mem['MemAvailable'])
        snapshot['last_warning'] = now
    else:
        snapshot['last_warning'] = previous.get('last_warning', 0)
    write_json(STATE / 'latest.json', snapshot)


def audit(config):
    ssh = command(['/usr/sbin/sshd', '-T']).stdout.splitlines()
    keys = ('permitrootlogin ', 'passwordauthentication ', 'pubkeyauthentication ', 'permitemptypasswords ')
    settings = dict(line.split(' ', 1) for line in ssh if line.startswith(keys))
    issues = []
    if settings.get('permitrootlogin') == 'yes' and settings.get('passwordauthentication') == 'yes':
        issues.append('root_password_login_enabled')
    rows = command(['docker', 'ps', '-q']).stdout.split()
    containers = []
    for cid in rows:
        data = json.loads(command(['docker', 'inspect', cid]).stdout)[0]
        host = data['HostConfig']
        item = {'name': data['Name'], 'image_id': data['Image'], 'memory_limit': host['Memory'],
                'privileged': host['Privileged'], 'health': data['State'].get('Health', {}).get('Status'),
                'oom_killed': data['State']['OOMKilled'], 'ports': data['NetworkSettings']['Ports']}
        containers.append(item)
        if not host['Memory'] or host['Privileged'] or item['health'] == 'unhealthy' or item['oom_killed']:
            issues.append('container_requires_attention:' + data['Name'])
    result = {'time': time.time(), 'role': config['role'], 'issues': issues,
              'ssh': settings, 'containers': containers,
              'listeners': command(['ss', '-lntu']).stdout,
              'swappiness': Path('/proc/sys/vm/swappiness').read_text().strip()}
    write_json(STATE / 'security.json', result)
    old = read_json(STATE / 'audit-event.json', {})
    if old.get('issues') != issues:
        event('audit_changed', issues=issues)
        write_json(STATE / 'audit-event.json', {'issues': issues})
    print(json.dumps(result, ensure_ascii=False))


def run(config, args):
    if config['role'] != 'test':
        raise RuntimeError('Test workloads are disabled on the production host')
    if not 1 <= args.minutes <= 60:
        raise RuntimeError('Duration must be 1..60 minutes')
    if not args.command:
        raise RuntimeError('A test command is required after --')
    work = Path(args.workdir).resolve(strict=True)
    root = Path('/srv/server-tests').resolve()
    if not work.is_dir() or work == root or root not in work.parents or ',' in str(work):
        raise RuntimeError('Use a dedicated project directory below /srv/server-tests')
    if args.network in ('host', 'none') or args.network.startswith('container:'):
        raise RuntimeError('Use the managed server-tests network')
    network = json.loads(command(['docker', 'network', 'inspect', args.network]).stdout)[0]
    if not isolated_network(network):
        raise RuntimeError('Network is not an owner-labeled, local test bridge')
    command(['systemctl', 'is-active', '--quiet', 'server-guard.timer'])
    snap = read_json(STATE / 'latest.json', {})
    if not 0 <= time.time() - snap.get('time', 0) <= 45:
        raise RuntimeError('Memory guard has no fresh successful sample')
    if memory()['MemAvailable'] < config['start_above_mib']:
        raise RuntimeError('Need at least 2000 MiB available before starting tests')
    if shutil.disk_usage(work).free < 4 * 1024**3:
        raise RuntimeError('Need at least 4 GiB disk space before starting tests')
    command(['docker', 'image', 'inspect', args.image])  # never pull implicitly
    if sum(p.stat().st_size for p in LOG.glob('run-*') if p.is_file()) >= 256 * 1024**2:
        raise RuntimeError('Archived run evidence reached 256 MiB; preserve/export it before further runs')
    current = runner()
    if current:
        if not owned(current) or current['State']['Running']:
            raise RuntimeError('Runner name is occupied; inspect existing task instead of starting another')
        # Save capped Docker logs before replacing our own stopped container. No volumes removed.
        log_path = LOG / ('run-' + current['Id'][:12] + '.log')
        with log_path.open('w') as out:
            result = subprocess.run(['docker', 'logs', '--timestamps', current['Id']], stdout=out, stderr=out, timeout=30)
        if result.returncode:
            raise RuntimeError('Cannot archive previous runner logs; container retained')
        write_json(LOG / ('run-' + current['Id'][:12] + '.json'),
                   {'id': current['Id'], 'exit_code': current['State']['ExitCode'],
                    'oom_killed': current['State']['OOMKilled'], 'finished': current['State']['FinishedAt']})
        command(['docker', 'rm', current['Id']])
    deadline = int(time.time()) + args.minutes * 60
    cmd = ['docker', 'run', '-d', '--name', NAME, '--pull=never', '--restart=no', '--init',
           '--label', LABEL + '=test-v1', '--label', LABEL + '.deadline=' + str(deadline),
           '--memory=1800m', '--memory-swap=1800m', '--cpus=1.5', '--pids-limit=512',
           '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--network', args.network,
           '--log-driver=json-file', '--log-opt=max-size=10m', '--log-opt=max-file=3',
           '--mount', f'type=bind,source={work},target=/workspace', '--workdir=/workspace',
           '--env=CI=1', '--env=NODE_OPTIONS=--max-old-space-size=1152',
           '--entrypoint=/usr/bin/timeout', args.image,
           '-s', 'TERM', '-k', '10', str(args.minutes * 60), *args.command]
    cid = command(cmd, timeout=45).stdout.strip()
    event('test_started', container=cid, deadline=deadline, image=args.image)
    print(f'Follow: docker logs -f {NAME}\nResult: docker inspect --format="{{{{.State.ExitCode}}}}" {NAME}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['check', 'audit', 'status', 'run'])
    parser.add_argument('--image', default='node:22-bookworm-slim')
    parser.add_argument('--workdir')
    parser.add_argument('--network', default='server-tests')
    parser.add_argument('--minutes', type=int, default=20)
    # Split -- explicitly, so flags after the action still belong to this CLI.
    arguments = sys.argv[1:]
    boundary = arguments.index('--') if '--' in arguments else len(arguments)
    args = parser.parse_args(arguments[:boundary])
    args.command = arguments[boundary + 1:]
    os.umask(0o077)
    config = read_json(CONFIG)
    if not config or config.get('role') not in ('production', 'test'):
        raise RuntimeError('Missing or invalid host role')
    if args.action == 'status':
        print(json.dumps({'latest': read_json(STATE / 'latest.json'),
                          'security': read_json(STATE / 'security.json')}, ensure_ascii=False, indent=2))
        return
    lock_name = args.action + '.lock'
    with (STATE / lock_name).open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'run':
            if not args.workdir:
                raise RuntimeError('--workdir is required')
            run(config, args)
        elif args.action == 'audit':
            audit(config)
        else:
            check(config)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'server-guard: {error}', file=sys.stderr)
        sys.exit(1)
