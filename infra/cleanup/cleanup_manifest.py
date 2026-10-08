#!/usr/bin/env python3
"""Delete only exact, closed release-staging directories listed in a reviewed manifest."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

PROTECTED = (
    Path("/var/backups/hometown-database"),
    Path("/var/lib/docker"),
    Path("/etc"),
    Path("/usr/local/hometown-backup"),
)
ALLOWED_ROOTS = (
    Path("/tmp/hometown-release-staging"),
    Path("/var/tmp/hometown-release-staging"),
)


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*"), key=lambda value: value.as_posix()):
        if path.is_symlink():
            raise ValueError("symlinks are not eligible for cleanup")
        if path.is_file():
            relative = path.relative_to(root).as_posix().encode()
            digest.update(len(relative).to_bytes(4, "big")); digest.update(relative)
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
    return digest.hexdigest()


def run(manifest_path: Path, apply: bool, lock_path: Path) -> dict:
    data = json.loads(manifest_path.read_text())
    if data.get("version") != 1 or not isinstance(data.get("allowedRoots"), list) or not isinstance(data.get("entries"), list):
        raise ValueError("unsupported cleanup manifest")
    roots = [Path(value).resolve() for value in data["allowedRoots"]]
    if roots != [value.resolve() for value in ALLOWED_ROOTS]:
        raise ValueError("cleanup manifest must use the two fixed release-staging roots")
    actions = []
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for entry in data["entries"]:
            if entry.get("state") != "TASK_ENDED" or not entry.get("taskId") or not entry.get("sha256"):
                raise ValueError("each cleanup entry needs TASK_ENDED, taskId, and exact sha256")
            target = Path(entry["path"])
            if not target.is_absolute() or target.is_symlink() or not target.exists():
                actions.append({"path": str(target), "result": "SKIP_ALREADY_ABSENT" if not target.exists() else "REJECT_PATH"})
                continue
            resolved = target.resolve(strict=True)
            if not any(resolved.parent == root or root in resolved.parents for root in roots):
                raise ValueError("cleanup path is outside the two exact staging roots")
            if any(resolved == protected or protected in resolved.parents for protected in PROTECTED):
                raise ValueError("cleanup path intersects a protected data/config/backup path")
            if not resolved.is_dir() or not (resolved / ".active.lock").is_file():
                raise ValueError("candidate must be a directory participating in the active-lock protocol")
            with (resolved / ".active.lock").open("rb") as owner_lock:
                try:
                    fcntl.flock(owner_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError as error:
                    raise RuntimeError("candidate is still owned by an active job") from error
                actual = tree_digest(resolved)
                if actual != entry["sha256"]:
                    raise ValueError("candidate contents changed after review")
                if apply:
                    shutil.rmtree(resolved)
                    actions.append({"path": str(resolved), "result": "REMOVED", "treeSha256": actual})
                else:
                    actions.append({"path": str(resolved), "result": "DRY_RUN_ELIGIBLE", "treeSha256": actual})
    return {"mode": "APPLY" if apply else "DRY_RUN", "actions": actions}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="/usr/local/lib/hometown-backup/cleanup-manifest.json")
    parser.add_argument("--apply", action="store_true", help="delete only exact reviewed entries after all guards pass")
    parser.add_argument("--lock-file", default="/run/lock/hometown-temp-cleanup.lock")
    args = parser.parse_args()
    try:
        print(json.dumps(run(Path(args.manifest), args.apply, Path(args.lock_file)), sort_keys=True))
    except Exception as error:
        print(json.dumps({"status": "FAILED", "errorType": type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
