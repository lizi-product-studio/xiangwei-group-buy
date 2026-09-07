#!/usr/bin/env python3
"""Bounded legacy Docker build; run from an unpacked verified release tree."""
import argparse
import os
import re
import signal
import subprocess
import threading
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--tag', required=True)
parser.add_argument('--log', required=True)
args = parser.parse_args()
if not re.fullmatch(r'hometown-api:[a-f0-9]{7,40}', args.tag):
    raise SystemExit('release tag must contain verified commit')

def available_mib():
    match = re.search(r'^MemAvailable:\s+(\d+)', Path('/proc/meminfo').read_text(), re.M)
    return int(match.group(1)) // 1024

def healthy():
    result = subprocess.run(['docker', 'inspect', '--format', '{{.State.Health.Status}}',
                             'hometown-food-mysql-1', 'hometown-food-redis-1'],
                            capture_output=True, text=True, timeout=10)
    return result.returncode == 0 and result.stdout.split() == ['healthy', 'healthy']

if available_mib() < 640 or not healthy():
    raise SystemExit('precondition: memory or existing service health')
stats = os.statvfs('.')
if stats.f_bavail * stats.f_frsize < 4 * 1024**3:
    raise SystemExit('precondition: disk budget')
if Path(args.log).exists():
    raise SystemExit('refuse to overwrite build log')
started = time.monotonic()
run_ids = set()
lock = threading.Lock()
log = open(args.log, 'x', buffering=1)
os.chmod(args.log, 0o600)
process = subprocess.Popen(['docker', 'build', '--rm', '--force-rm', '--memory', '512m',
    '--memory-swap', '512m', '--cpu-period', '100000', '--cpu-quota', '50000',
    '-t', args.tag, '-f', 'apps/api/Dockerfile', '.'],
    env={**os.environ, 'DOCKER_BUILDKIT': '0'}, stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT, text=True, start_new_session=True)

def read_output():
    for line in process.stdout:
        log.write(line)
        match = re.search(r'Running in ([a-f0-9]{12,64})', line)
        if match:
            with lock:
                run_ids.add(match.group(1))
reader = threading.Thread(target=read_output, daemon=True)
reader.start()
reason = None
def interrupted(signum, frame):
    raise KeyboardInterrupt()
signal.signal(signal.SIGTERM, interrupted)
try:
    while process.poll() is None:
        if available_mib() < 256:
            reason = 'low-memory'
        elif time.monotonic() - started >= 1200:
            reason = 'timeout'
        if reason:
            break
        time.sleep(2)
except BaseException:
    reason = 'monitor-interrupted-or-failed'
finally:
    cleanup_errors = []
    try:
        if reason:
            # IDs come only from this build's legacy "Running in" output.
            with lock:
                ids = list(run_ids)
            for container_id in ids:
                try:
                    state = subprocess.run(['docker', 'inspect', '--format', '{{.State.Running}}', container_id],
                                           capture_output=True, text=True, timeout=10)
                    if state.returncode == 0 and state.stdout.strip() == 'true':
                        killed = subprocess.run(['docker', 'kill', container_id], capture_output=True, timeout=15)
                        if killed.returncode != 0:
                            cleanup_errors.append('RUN kill failed: ' + container_id)
                except Exception:
                    cleanup_errors.append('daemon cleanup unavailable: ' + container_id)
    finally:
        if reason and process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
        try:
            code = process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            code = process.wait(timeout=10)
    reader.join(timeout=10)
    log.close()
    with lock:
        ids = list(run_ids)
    residual = []
    for container_id in ids:
        try:
            state = subprocess.run(['docker', 'inspect', '--format', '{{.State.Running}}', container_id],
                                   capture_output=True, text=True, timeout=10)
            if state.returncode == 0 and state.stdout.strip() == 'true':
                residual.append(container_id)
            elif state.returncode != 0 and 'no such' not in state.stderr.lower():
                cleanup_errors.append('residual inspect unavailable: ' + container_id)
        except Exception:
            cleanup_errors.append('residual inspect timeout: ' + container_id)
    try:
        final_healthy = healthy()
    except Exception:
        final_healthy = False
        cleanup_errors.append('final health unavailable')
    print({'build_exit': code, 'stop_reason': reason, 'running_build_containers': residual,
           'data_services_healthy': final_healthy, 'cleanup_errors': cleanup_errors,
           'status': 'BLOCKED' if cleanup_errors else 'CHECKED', 'available_mib': available_mib()})
if code != 0 or reason or residual or cleanup_errors or not final_healthy:
    raise SystemExit(1)
