#!/usr/bin/env python3
"""Review and apply retention only to complete, post-enable source snapshots."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

HEX = re.compile(r"^[0-9a-f]{64}$")
SNAPSHOT = re.compile(r"^(\d{8}T\d{6}Z-[a-f0-9]{8})\.sql\.gz$")
FORMAT = "hometown-source-retention-plan-v1"
BUNDLE_FORMAT = "hometown-encrypted-db-replica-v1"


def json_digest(path: Path) -> str:
    data, _, _ = read_regular_bytes(path)
    return hashlib.sha256(data).hexdigest()


def load_object(path: Path) -> dict:
    value = json.loads(read_regular_bytes(path)[0])
    if not isinstance(value, dict):
        raise ValueError("expected JSON object")
    return value


def utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed.astimezone(timezone.utc)


def is_regular(path: Path) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISREG(info.st_mode)


def read_regular_bytes(path: Path) -> tuple[bytes, int, int]:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("expected a regular non-symlink file")
        with os.fdopen(os.dup(fd), "rb") as source:
            return source.read(), info.st_size, info.st_ino
    finally:
        os.close(fd)


def nofollow_sha256(path: Path) -> tuple[str, int, int]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("candidate file is not regular")
        value = hashlib.sha256()
        with os.fdopen(os.dup(descriptor), "rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                value.update(chunk)
        return value.hexdigest(), info.st_size, info.st_ino
    finally:
        os.close(descriptor)


def root_identity(path: Path) -> dict:
    if path.is_symlink() or not path.is_dir():
        raise ValueError("retention roots must be real directories, not symlinks")
    info = path.stat(follow_symlinks=False)
    return {"path": str(path), "device": info.st_dev, "inode": info.st_ino,
            "uid": info.st_uid, "gid": info.st_gid, "mode": stat.S_IMODE(info.st_mode)}


def has_symlink_component(path: Path) -> bool:
    current = path
    while True:
        if current.exists() or current.is_symlink():
            if current.is_symlink():
                return True
        if current.parent == current:
            return False
        current = current.parent


def verify_export_bundle(bundle: Path, bundle_id: str, source_file: str,
                         compressed_hash: str) -> dict:
    if bundle.is_symlink() or not bundle.is_dir():
        raise ValueError("export bundle is not a real directory")
    manifest_path = bundle / "manifest.json"
    complete_path = bundle / "complete.json"
    if not is_regular(manifest_path) or not is_regular(complete_path):
        raise ValueError("export manifest or completion marker is missing or non-regular")
    manifest_bytes, _, manifest_inode = read_regular_bytes(manifest_path)
    manifest = json.loads(manifest_bytes)
    complete_bytes, _, complete_inode = read_regular_bytes(complete_path)
    complete = json.loads(complete_bytes)
    if not isinstance(manifest, dict) or not isinstance(complete, dict):
        raise ValueError("export manifest and completion marker must be JSON objects")
    manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()
    encrypted_name = source_file + ".age"
    if (manifest.get("format") != BUNDLE_FORMAT or manifest.get("sourceFile") != source_file
            or manifest.get("encryptedFile") != encrypted_name
            or manifest.get("compressedSha256") != compressed_hash
            or manifest.get("retentionEligible") is not True):
        raise ValueError("export manifest is not eligible or does not match its source snapshot")
    if complete.get("format") != BUNDLE_FORMAT or complete.get("manifestSha256") != manifest_hash:
        raise ValueError("export completion marker does not bind the manifest")
    if (complete.get("sourceFile") != source_file
            or complete.get("sourceCompressedSha256") != compressed_hash
            or complete.get("encryptedSha256") != manifest.get("encryptedSha256")):
        raise ValueError("export completion marker disagrees with its source or ciphertext")
    cipher_hash = manifest.get("encryptedSha256")
    cipher_size = manifest.get("encryptedSizeBytes")
    key_ids = manifest.get("recipientKeyIds")
    if (not isinstance(cipher_hash, str) or not HEX.fullmatch(cipher_hash)
            or not isinstance(cipher_size, int) or cipher_size < 1
            or not isinstance(key_ids, list) or not key_ids
            or any(not isinstance(key, str) or not HEX.fullmatch(key) for key in key_ids)):
        raise ValueError("export manifest has invalid ciphertext or recipient data")
    payload = bundle / encrypted_name
    if {child.name for child in bundle.iterdir()} != {"manifest.json", "complete.json", encrypted_name}:
        raise ValueError("export bundle contains unexpected files")
    cipher_actual, cipher_actual_size, cipher_inode = nofollow_sha256(payload)
    if cipher_actual != cipher_hash or cipher_actual_size != cipher_size:
        raise ValueError("export ciphertext digest or size mismatch")
    if any(child.is_symlink() for child in bundle.iterdir()):
        raise ValueError("export bundle contains a symlink")
    return {"bundleId": bundle_id, "sourceFile": source_file, "exportInode": bundle.stat(follow_symlinks=False).st_ino,
            "compressedSha256": compressed_hash, "manifestSha256": manifest_hash,
            "manifestName": manifest_path.name, "manifestInode": manifest_inode, "manifestSizeBytes": len(manifest_bytes),
            "completeSha256": hashlib.sha256(complete_bytes).hexdigest(), "completeName": complete_path.name,
            "completeInode": complete_inode, "completeSizeBytes": len(complete_bytes), "encryptedName": encrypted_name,
            "encryptedSha256": cipher_hash, "encryptedSizeBytes": cipher_size,
            "encryptedInode": cipher_inode, "recipientKeyIds": sorted(set(key_ids)),
            "createdAtUtc": manifest.get("createdAtUtc"), "exportedAtUtc": manifest.get("exportedAtUtc")}


def inspect_snapshot(root: Path, export_root: Path, snapshot: Path,
                     managed_after: datetime) -> dict:
    match = SNAPSHOT.fullmatch(snapshot.name)
    if not match or snapshot.is_symlink() or not is_regular(snapshot):
        raise ValueError("snapshot is not an exact regular source backup")
    bundle_id = match.group(1)
    source_file = snapshot.name
    receipt_path = snapshot.with_suffix(".json")
    if receipt_path.parent != root or receipt_path.name != bundle_id + ".sql.json" or not is_regular(receipt_path):
        raise ValueError("source receipt is absent or not a regular direct child")
    receipt_bytes, receipt_size, receipt_inode = read_regular_bytes(receipt_path)
    receipt = json.loads(receipt_bytes)
    if not isinstance(receipt, dict):
        raise ValueError("source receipt must be a JSON object")
    source_hash, source_size, source_inode = nofollow_sha256(snapshot)
    receipt_hash = hashlib.sha256(receipt_bytes).hexdigest()
    if (receipt.get("status") != "BACKUP_OK" or receipt.get("file") != source_file
            or receipt.get("compressedSha256") != source_hash
            or receipt.get("sizeBytes") != source_size
            or not isinstance(receipt.get("sqlSha256"), str)
            or not HEX.fullmatch(receipt["sqlSha256"])):
        raise ValueError("source snapshot receipt does not match the gzip file")
    snapshot_fd = os.open(snapshot, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        snapshot_info = os.fstat(snapshot_fd)
        if not stat.S_ISREG(snapshot_info.st_mode) or snapshot_info.st_ino != source_inode:
            raise ValueError("source snapshot changed while being verified")
        with os.fdopen(os.dup(snapshot_fd), "rb") as compressed:
            with gzip.GzipFile(fileobj=compressed, mode="rb") as source:
                sql_hash = hashlib.file_digest(source, "sha256").hexdigest()
    finally:
        os.close(snapshot_fd)
    if sql_hash != receipt["sqlSha256"]:
        raise ValueError("source gzip contents do not match the receipt")
    created = utc(str(receipt.get("createdAtUtc", "")))
    filename_created = utc(match.group(1).rsplit("-", 1)[0])
    if filename_created != created or filename_created < managed_after:
        raise ValueError("snapshot filename is historical or disagrees with the source receipt")
    bundle = export_root / bundle_id
    exported_bundle = verify_export_bundle(bundle, bundle_id, source_file, source_hash)
    exported = utc(str(exported_bundle.get("exportedAtUtc", "")))
    if utc(str(exported_bundle.get("createdAtUtc", ""))) != created:
        raise ValueError("export and source receipt creation timestamps disagree")
    if created < managed_after or exported < managed_after:
        raise ValueError("source snapshot or replica export predates managed-after")
    if exported_bundle["bundleId"] != bundle_id:
        raise ValueError("export identity mismatch")
    return {"bundleId": bundle_id, "backupName": source_file,
            "receiptName": receipt_path.name, "exportName": bundle_id,
            "createdAtUtc": created.isoformat(), "exportedAtUtc": exported.isoformat(),
            "backupSha256": source_hash, "backupSizeBytes": source_size,
            "backupInode": source_inode, "receiptSha256": receipt_hash,
            "receiptInode": receipt_inode, "receiptSizeBytes": receipt_size,
            **exported_bundle}


def lock_roots(root: Path):
    """Acquire the backup job lock and a separate retention lock without following links."""
    fds = []
    try:
        for name in (".lock", ".source-retention.lock"):
            path = root / name
            fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
            fds.append(fd)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fds
    except Exception:
        for fd in reversed(fds):
            os.close(fd)
        raise


def read_active_keys(path: Path) -> list[str]:
    if path.is_symlink() or not is_regular(path):
        raise ValueError("active recipient key IDs must be a regular file")
    keys = json.loads(read_regular_bytes(path)[0])
    if (not isinstance(keys, list) or not keys
            or any(not isinstance(key, str) or not HEX.fullmatch(key) for key in keys)):
        raise ValueError("active key ID file must contain SHA-256 recipient IDs")
    return sorted(set(keys))


def scan_retention(root: Path, export_root: Path, managed_after: datetime,
                   active_keys: list[str]) -> dict:
    records = []
    preserved = []
    for child in sorted(root.iterdir(), key=lambda path: path.name):
        if child.name in {"replica-export", ".lock", ".source-retention.lock"}:
            continue
        match = SNAPSHOT.fullmatch(child.name)
        if not match:
            preserved.append({"path": child.name, "reason": "unknown-or-in-progress"})
            continue
        try:
            records.append(inspect_snapshot(root, export_root, child, managed_after))
        except Exception:
            preserved.append({"path": child.name, "reason": "historical-incomplete-or-unverified"})
    eligible_ids = {record["bundleId"] for record in records}
    for child in sorted(export_root.iterdir(), key=lambda path: path.name):
        if child.name not in eligible_ids:
            preserved.append({"path": "replica-export/" + child.name,
                              "reason": "historical-unmanaged-incomplete-or-unverified"})
    records.sort(key=lambda record: (record["createdAtUtc"], record["bundleId"]))
    keep: dict[str, set[str]] = {}

    def preserve(record: dict, reason: str) -> None:
        keep.setdefault(record["bundleId"], set()).add(reason)

    blockers = []
    if records:
        preserve(records[-1], "latest-recoverable")
        by_day = {}
        by_week = {}
        for record in records:
            created = utc(record["createdAtUtc"])
            day = created.strftime("%Y-%m-%d")
            week = created.isocalendar()[:2]
            if day not in by_day or record["createdAtUtc"] > by_day[day]["createdAtUtc"]:
                by_day[day] = record
            if week not in by_week or record["createdAtUtc"] > by_week[week]["createdAtUtc"]:
                by_week[week] = record
        for record in sorted(by_day.values(), key=lambda item: item["createdAtUtc"], reverse=True)[:7]:
            preserve(record, "daily-7")
        for record in sorted(by_week.values(), key=lambda item: item["createdAtUtc"], reverse=True)[:4]:
            preserve(record, "weekly-4")
        for key_id in active_keys:
            matching = [record for record in records if key_id in record["recipientKeyIds"]]
            if not matching:
                blockers.append("no verified managed replica for active key " + key_id)
            else:
                preserve(max(matching, key=lambda item: (item["createdAtUtc"], item["bundleId"])),
                         "last-copy-for-active-key:" + key_id)
    else:
        blockers.append("no verified managed source snapshot is available")
    protected = [{**record, "reasons": sorted(keep[record["bundleId"]])}
                 for record in records if record["bundleId"] in keep]
    candidates = [record for record in records if record["bundleId"] not in keep]
    return {"candidateCount": len(candidates), "candidates": candidates,
            "protected": protected, "preserved": preserved, "blockers": blockers}


def build_plan(root: Path, export_root: Path, managed_after: datetime,
               active_keys: list[str]) -> dict:
    if root.is_symlink() or export_root.is_symlink():
        raise ValueError("retention roots cannot be symlinks")
    if export_root.parent != root or export_root.name != "replica-export":
        raise ValueError("export root must be the exact replica-export child of the backup root")
    roots = {"backup": root_identity(root), "export": root_identity(export_root)}
    inventory = scan_retention(root, export_root, managed_after, active_keys)
    inventory.update({"format": FORMAT, "mode": "DRY_RUN", "managedAfterUtc": managed_after.isoformat(),
                      "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
                      "activeRecipientKeyIds": active_keys, "roots": roots,
                      "candidateBytes": sum(value["backupSizeBytes"] + value["receiptSizeBytes"]
                                            + value["encryptedSizeBytes"]
                                            + value["manifestSizeBytes"] + value["completeSizeBytes"]
                                            for value in inventory["candidates"])})
    return inventory


def plan_projection(plan: dict) -> dict:
    return {key: value for key, value in plan.items() if key not in {"mode", "generatedAtUtc"}}


def atomic_json(path: Path, value: dict) -> None:
    temp = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    encoded = (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temp, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)
        dirfd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
    except Exception:
        temp.unlink(missing_ok=True)
        raise


def delete_candidate(root_fd: int, export_fd: int, record: dict, remove: bool = True) -> None:
    bundle_id = record["bundleId"]
    expected_backup = record["backupName"]
    expected_receipt = record["receiptName"]
    def file_identity(parent_fd: int, name: str) -> tuple[str, int, int]:
        fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent_fd)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("candidate entry is no longer a regular file")
            value = hashlib.sha256()
            with os.fdopen(os.dup(fd), "rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    value.update(chunk)
            return value.hexdigest(), info.st_size, info.st_ino
        finally:
            os.close(fd)

    if file_identity(root_fd, expected_backup) != (record["backupSha256"], record["backupSizeBytes"], record["backupInode"]):
        raise ValueError("source backup changed after review; refusing deletion")
    if file_identity(root_fd, expected_receipt) != (record["receiptSha256"], record["receiptSizeBytes"], record["receiptInode"]):
        raise ValueError("source receipt changed after review; refusing deletion")
    bundle_fd = os.open(bundle_id, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0), dir_fd=export_fd)
    try:
        if os.fstat(bundle_fd).st_ino != record["exportInode"]:
            raise ValueError("export bundle directory changed after review")
        children = {name for name in os.listdir(bundle_fd)}
        expected_children = {record["manifestName"], record["completeName"], record["encryptedName"]}
        if children != expected_children:
            raise ValueError("export bundle contents changed; refusing deletion")
        expected_hashes = {
            record["manifestName"]: (record["manifestSha256"], record["manifestSizeBytes"], record["manifestInode"]),
            record["completeName"]: (record["completeSha256"], record["completeSizeBytes"], record["completeInode"]),
            record["encryptedName"]: (record["encryptedSha256"], record["encryptedSizeBytes"], record["encryptedInode"]),
        }
        for name, expected in expected_hashes.items():
            if file_identity(bundle_fd, name) != expected:
                raise ValueError("export bundle content changed after review; refusing deletion")
        if not remove:
            return
        for name in sorted(expected_children):
            os.unlink(name, dir_fd=bundle_fd)
        os.fsync(bundle_fd)
    finally:
        os.close(bundle_fd)
    os.rmdir(bundle_id, dir_fd=export_fd)
    for name in (expected_backup, expected_receipt):
        os.unlink(name, dir_fd=root_fd)


def apply_plan(args: argparse.Namespace, root: Path, export_root: Path,
               managed_after: datetime, active_key_path: Path, initial_active_keys: list[str]) -> dict:
    plan_path = Path(args.apply_plan)
    if plan_path.is_symlink() or not is_regular(plan_path):
        raise ValueError("reviewed plan must be a regular non-symlink file")
    plan = load_object(plan_path)
    if plan.get("format") != FORMAT or plan.get("mode") != "DRY_RUN":
        raise ValueError("apply requires a source-retention dry-run plan")
    generated = utc(str(plan.get("generatedAtUtc", "")))
    age = (datetime.now(timezone.utc) - generated).total_seconds()
    if age < 0 or age > args.max_plan_age_hours * 3600:
        raise ValueError("reviewed source-retention plan is future-dated or expired")
    if plan.get("candidateCount") != len(plan.get("candidates", [])) or plan.get("candidateCount", 0) < 1:
        raise ValueError("reviewed source-retention plan has no applicable candidates")
    if plan.get("blockers"):
        raise ValueError("source-retention protection set is incomplete")
    lock_fds = lock_roots(root)
    root_fd = export_fd = None
    try:
        active_keys = read_active_keys(active_key_path)
        if active_keys != initial_active_keys:
            raise ValueError("active recipient key IDs changed while applying the reviewed plan")
        fresh = build_plan(root, export_root, managed_after, active_keys)
        if plan_projection(plan) != plan_projection(fresh):
            raise ValueError("reviewed source-retention plan, roots, candidates, or protection set changed")
        root_fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
        export_fd = os.open(export_root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
        for path, fd, identity in ((root, root_fd, fresh["roots"]["backup"]),
                                   (export_root, export_fd, fresh["roots"]["export"])):
            info = os.fstat(fd)
            if (str(path) != identity["path"] or info.st_dev != identity["device"]
                    or info.st_ino != identity["inode"] or info.st_uid != identity["uid"]
                    or info.st_gid != identity["gid"] or stat.S_IMODE(info.st_mode) != identity["mode"]):
                raise ValueError("retention root identity changed before deletion")
        for record in fresh["candidates"]:
            delete_candidate(root_fd, export_fd, record, remove=False)
        removed = []
        for record in fresh["candidates"]:
            delete_candidate(root_fd, export_fd, record)
            removed.append({"bundleId": record["bundleId"], "backupSha256": record["backupSha256"],
                            "receiptSha256": record["receiptSha256"], "manifestSha256": record["manifestSha256"],
                            "encryptedSha256": record["encryptedSha256"]})
        os.fsync(export_fd)
        os.fsync(root_fd)
        return {"status": "SOURCE_ROTATION_APPLIED", "removed": removed,
                "bytesFreed": fresh["candidateBytes"]}
    finally:
        if export_fd is not None:
            os.close(export_fd)
        if root_fd is not None:
            os.close(root_fd)
        for fd in reversed(lock_fds):
            os.close(fd)


def run(args: argparse.Namespace) -> dict:
    root_arg = Path(args.backup_dir).absolute()
    export_arg = Path(args.export_dir).absolute()
    if has_symlink_component(root_arg) or has_symlink_component(export_arg):
        raise ValueError("backup and export roots cannot be symlinks")
    root = root_arg.resolve(strict=True)
    export_root = export_arg.resolve(strict=True)
    if export_root.parent != root or export_root.name != "replica-export":
        raise ValueError("export root must be the exact replica-export child of the backup root")
    managed_after = utc(args.managed_after)
    active_key_path = Path(args.active_key_ids).absolute()
    active_keys = read_active_keys(active_key_path)
    if args.apply_plan:
        return apply_plan(args, root, export_root, managed_after, active_key_path, active_keys)
    lock_fds = lock_roots(root)
    try:
        active_keys = read_active_keys(active_key_path)
        plan = build_plan(root, export_root, managed_after, active_keys)
        if args.plan_out:
            target = Path(args.plan_out).absolute()
            if root == target or root in target.parents:
                raise ValueError("dry-run plan must be stored outside the backup root")
            atomic_json(target, plan)
        return plan
    finally:
        for fd in reversed(lock_fds):
            os.close(fd)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup-dir", default="/var/backups/hometown-database")
    parser.add_argument("--export-dir", default="/var/backups/hometown-database/replica-export")
    parser.add_argument("--active-key-ids", required=True, help="JSON array of active SHA-256 age recipient IDs")
    parser.add_argument("--managed-after", required=True, help="reviewed UTC enablement cutoff timestamp")
    parser.add_argument("--plan-out", help="save dry-run JSON outside the backup root")
    parser.add_argument("--apply-plan", help="apply exactly this recent reviewed dry-run plan")
    parser.add_argument("--max-plan-age-hours", type=float, default=24)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), sort_keys=True))
    except Exception as error:
        print(json.dumps({"status": "FAILED", "errorType": type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
