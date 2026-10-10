#!/usr/bin/env python3
"""Private database snapshots; restore drills never target the live schema."""
import argparse
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import uuid


def mysql(container, database, sql=None, source=None):
    command = ["docker", "exec", "-i", container, "sh", "-c",
               'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 --batch --skip-column-names "$@"',
               "mysql", database]
    return subprocess.run(command, input=sql.encode() if sql else None,
                          stdin=source, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          check=True).stdout


def dump(container, database, target):
    command = ["docker", "exec", container, "sh", "-c",
               'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --default-character-set=utf8mb4 '
               '--single-transaction --skip-lock-tables --no-tablespaces '
               '--set-gtid-purged=OFF --source-data=2 --hex-blob --order-by-primary '
               '--skip-comments --compact --skip-extended-insert "$@"',
               "mysqldump", database]
    subprocess.run(command, stdout=target, stderr=subprocess.DEVNULL, check=True)


def snapshot_binlog_position(path):
    """Read mysqldump's source-data coordinate without loading the dump into memory."""
    pattern = re.compile(rb"CHANGE (?:REPLICATION SOURCE TO SOURCE_LOG_FILE|MASTER TO MASTER_LOG_FILE)='([^']+)', (?:SOURCE_LOG_POS|MASTER_LOG_POS)=(\d+)")
    with Path(path).open("rb") as source:
        prefix = source.read(1024 * 1024)
    match = pattern.search(prefix)
    if not match:
        raise RuntimeError("Snapshot is missing its transactional binary-log coordinate")
    filename = match.group(1).decode("ascii")
    position = int(match.group(2))
    if not re.fullmatch(r"[A-Za-z0-9_.-]+\.\d{6}", filename) or position < 4:
        raise RuntimeError("Snapshot binary-log coordinate is invalid")
    return filename, position


def source_uuid(container, database):
    value = mysql(container, database, "SELECT @@server_uuid;").decode("ascii").strip()
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", value):
        raise RuntimeError("MySQL server UUID is unavailable")
    return value.lower()


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


_SOURCE_COORDINATE = re.compile(
    rb"^\s*-- CHANGE (?:REPLICATION SOURCE TO SOURCE_LOG_FILE='[^']+', SOURCE_LOG_POS=\d+|"
    rb"MASTER TO MASTER_LOG_FILE='[^']+', MASTER_LOG_POS=\d+);\s*(?:\r?\n)?$"
)


def comparable_dump_digest(path):
    """Hash every dump byte except mysqldump's one source-position comment."""
    digest = hashlib.sha256()
    removed = 0
    with Path(path).open("rb") as source:
        for line in source:
            if _SOURCE_COORDINATE.fullmatch(line):
                removed += 1
                continue
            digest.update(line)
    if removed > 1:
        raise RuntimeError("Dump contains multiple source-coordinate statements")
    return digest.hexdigest()


def run(args):
    os.umask(0o077)
    if not re.fullmatch(r"[A-Za-z0-9_]+", args.database):
        raise ValueError("Invalid database identifier")
    replica_recipients = getattr(args, "replica_recipients", None)
    replica_export = getattr(args, "replica_export", None)
    if bool(replica_recipients) != bool(replica_export):
        raise ValueError("replica recipient and export paths must be configured together")
    root = Path(args.directory).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.stat().st_mode & 0o077:
        raise ValueError("Backup directory must be private (0700)")
    with (root / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if shutil.disk_usage(root).free < 512 * 1024 * 1024:
            raise RuntimeError("Insufficient backup disk space")
        started = time.monotonic()
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        target = root / (stamp + "-" + uuid.uuid4().hex[:8] + ".sql.gz")
        with tempfile.TemporaryDirectory(prefix=".snapshot-", dir=root) as tmp:
            plain = Path(tmp) / "snapshot.sql"
            database_uuid = source_uuid(args.container, args.database)
            with plain.open("xb") as output:
                dump(args.container, args.database, output)
            if plain.stat().st_size < 100:
                raise RuntimeError("Database snapshot is unexpectedly small")
            binlog_file, binlog_position = snapshot_binlog_position(plain)
            source_digest = digest(plain)
            compressed = Path(tmp) / "snapshot.sql.gz"
            with plain.open("rb") as source, compressed.open("xb") as raw:
                with gzip.GzipFile(fileobj=raw, mode="wb") as output:
                    shutil.copyfileobj(source, output)
                raw.flush()
                os.fsync(raw.fileno())
            with gzip.open(compressed, "rb") as check:
                if hashlib.file_digest(check, "sha256").hexdigest() != source_digest:
                    raise RuntimeError("Compressed snapshot verification failed")
            compressed.replace(target)
            receipt = {"status": "BACKUP_OK", "createdAtUtc": stamp,
                       "database": args.database, "file": target.name,
                       "sourceUuid": database_uuid, "snapshotBinlogFile": binlog_file,
                       "snapshotBinlogPosition": binlog_position,
                       "compressedSha256": digest(target), "sqlSha256": source_digest,
                       "sizeBytes": target.stat().st_size,
                       "backupSeconds": round(time.monotonic() - started, 3)}
            receipt_path = target.with_suffix(".json")
            receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
            if replica_recipients:
                from encrypted_replica import publish_backup
                result = publish_backup(target, root, Path(replica_recipients), Path(replica_export), "hometown-replica")
                receipt["replicaStatus"] = result["status"]
                temporary_receipt = receipt_path.with_suffix(".json.tmp")
                temporary_receipt.write_text(json.dumps(receipt, indent=2) + "\n")
                os.replace(temporary_receipt, receipt_path)
            if args.restore_drill:
                # A random, newly created schema on the same server keeps live data
                # on its existing host. No USE/database statements occur in this dump.
                drill = "hometown_restore_" + uuid.uuid4().hex
                restored = Path(tmp) / "restored.sql"
                replay = Path(tmp) / "replay.sql"
                drill_start = time.monotonic()
                receipt.update(restoreStatus="RUNNING", restoreSchema=drill)
                receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
                try:
                    mysql(args.container, "mysql", f"CREATE DATABASE `{drill}`;")
                    with gzip.open(target, "rb") as source, replay.open("xb") as output:
                        shutil.copyfileobj(source, output)
                    with replay.open("rb") as source:
                        mysql(args.container, drill, source=source)
                    with restored.open("xb") as output:
                        dump(args.container, drill, output)
                    if comparable_dump_digest(restored) != comparable_dump_digest(plain):
                        raise RuntimeError("Restored snapshot differs from original")
                    mysql(args.container, "mysql", f"DROP DATABASE `{drill}`;")
                    receipt.update(restoreStatus="PASS", restoreSchemaRemoved=True,
                                   restoreSeconds=round(time.monotonic()-drill_start, 3))
                except Exception:
                    # Keep failed restore state for investigation; never touch live DB.
                    receipt.update(restoreStatus="FAILED", restoreSchemaRemoved=False)
                    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
                    raise
                receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
            print(json.dumps(receipt))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", default="hometown-food-mysql-1")
    parser.add_argument("--database", default="hometown_food")
    parser.add_argument("--directory", default="/var/backups/hometown-database")
    parser.add_argument("--restore-drill", action="store_true")
    parser.add_argument("--replica-recipients", help="private host file containing age public recipients; omitted disables replica publication")
    parser.add_argument("--replica-export", help="root-only directory for atomically published encrypted bundles")
    try:
        run(parser.parse_args())
    except Exception as error:
        # Do not print command arguments, connection details, or SQL contents.
        print(json.dumps({"status": "FAILED", "errorType": type(error).__name__}))
        raise SystemExit(1)
