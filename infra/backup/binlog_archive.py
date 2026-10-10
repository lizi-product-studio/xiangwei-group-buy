#!/usr/bin/env python3
"""Age-encrypted, source-bound MySQL row-binlog archive and receiver verifier."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
import threading
import uuid

FORMAT = "hometown-binlog-segment-v1"
CHAIN_FORMAT = "hometown-binlog-chain-v1"
HEX = re.compile(r"^[0-9a-f]{64}$")
BINLOG = re.compile(r"^([A-Za-z0-9_.-]+)\.(\d{6})$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value: dict, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".tmp-", dir=path.parent)
    tmp = Path(name)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(json.dumps(value, sort_keys=True, indent=2) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(tmp, path)
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        tmp.unlink(missing_ok=True)


def read_object(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        raise ValueError("expected a regular metadata file")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("metadata must be a JSON object")
    return value


def parse_binlog_name(name: str) -> tuple[str, int]:
    match = BINLOG.fullmatch(name)
    if not match:
        raise ValueError("binary-log filename is invalid")
    return match.group(1), int(match.group(2))


def manifest_digest(bundle: Path, expected_bundle_name: str | None = None, metadata_only: bool = False) -> tuple[dict, str]:
    if bundle.is_symlink() or not bundle.is_dir():
        raise ValueError("binary-log bundle must be a regular directory")
    manifest_path = bundle / "manifest.json"
    complete_path = bundle / "complete.json"
    read_object(manifest_path)
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    complete = read_object(complete_path)
    digest = hashlib.sha256(manifest_bytes).hexdigest()
    if manifest.get("format") != FORMAT or complete.get("format") != FORMAT or complete.get("manifestSha256") != digest:
        raise ValueError("binary-log manifest or completion marker failed validation")
    if complete.get("encryptedSha256") != manifest.get("encryptedSha256"):
        raise ValueError("binary-log completion marker does not match ciphertext")
    source_uuid = manifest.get("sourceUuid")
    database = manifest.get("database")
    file_name = manifest.get("binlogFile")
    _, file_index = parse_binlog_name(str(file_name))
    if (not isinstance(source_uuid, str) or not UUID.fullmatch(source_uuid)
            or not isinstance(database, str) or not re.fullmatch(r"[A-Za-z0-9_]+", database)
            or manifest.get("fileIndex") != file_index or manifest.get("startPosition", 0) < 4
            or manifest.get("endPosition", 0) != manifest.get("fileSizeBytes")
            or not isinstance(manifest.get("fileSizeBytes"), int) or manifest["fileSizeBytes"] < 4
            or not isinstance(manifest.get("rawSha256"), str) or not HEX.fullmatch(manifest["rawSha256"])
            or not isinstance(manifest.get("encryptedSha256"), str) or not HEX.fullmatch(manifest["encryptedSha256"])
            or not isinstance(manifest.get("previousManifestSha256"), str)
            or not HEX.fullmatch(manifest["previousManifestSha256"])):
        raise ValueError("binary-log source binding, coordinate, or digest is invalid")
    expected_bundle = source_uuid.replace("-", "")[:8] + "-" + file_name
    if (expected_bundle_name or bundle.name) != expected_bundle:
        raise ValueError("binary-log bundle directory is not bound to its source UUID and segment name")
    payload_name = manifest.get("encryptedFile")
    if payload_name != "segment.bin.age":
        raise ValueError("binary-log encrypted payload name is invalid")
    if type(manifest.get("encryptedSizeBytes")) is not int or manifest["encryptedSizeBytes"] < 1:
        raise ValueError("binary-log encrypted size is invalid")
    if metadata_only:
        return manifest, digest
    payload = bundle / payload_name
    if payload.is_symlink() or not payload.is_file() or payload.stat().st_size != manifest.get("encryptedSizeBytes"):
        raise ValueError("binary-log ciphertext is missing or has the wrong size")
    if sha256(payload) != manifest["encryptedSha256"]:
        raise ValueError("binary-log ciphertext digest mismatch")
    if {p.name for p in bundle.iterdir()} != {"manifest.json", "complete.json", payload_name}:
        raise ValueError("binary-log bundle contains unexpected files")
    return manifest, digest


def verify_chain(bundles: list[Path], anchor: dict, expected_uuid: str | None = None,
                 expected_database: str | None = None) -> dict:
    if anchor.get("format") != "hometown-binlog-anchor-v1":
        raise ValueError("snapshot anchor format is invalid")
    source_uuid = anchor.get("sourceUuid")
    database = anchor.get("database")
    first_file = anchor.get("snapshotBinlogFile")
    first_position = anchor.get("snapshotBinlogPosition")
    _, first_index = parse_binlog_name(str(first_file))
    if (not isinstance(source_uuid, str) or not UUID.fullmatch(source_uuid)
            or not isinstance(database, str) or not re.fullmatch(r"[A-Za-z0-9_]+", database)
            or not isinstance(first_position, int) or first_position < 4
            or not isinstance(anchor.get("snapshotReceiptSha256"), str)
            or not HEX.fullmatch(anchor["snapshotReceiptSha256"])):
        raise ValueError("snapshot anchor source or coordinate is invalid")
    if expected_uuid and source_uuid != expected_uuid.lower():
        raise ValueError("binary-log archive belongs to a different MySQL source UUID")
    if expected_database and database != expected_database:
        raise ValueError("binary-log archive belongs to a different database")
    ordered = []
    for bundle in bundles:
        manifest, digest = manifest_digest(bundle)
        ordered.append((manifest["fileIndex"], manifest, digest))
    ordered.sort(key=lambda entry: entry[0])
    expected_index = first_index
    previous = anchor["snapshotReceiptSha256"]
    for index, manifest, digest in ordered:
        if (manifest["sourceUuid"] != source_uuid or manifest["database"] != database
                or manifest.get("snapshotReceiptSha256") != anchor["snapshotReceiptSha256"]
                or parse_binlog_name(manifest["binlogFile"])[0] != parse_binlog_name(first_file)[0]):
            raise ValueError("binary-log segment source UUID or database does not match its snapshot anchor")
        if index != expected_index:
            raise ValueError("binary-log archive has a missing or duplicate segment")
        if manifest["previousManifestSha256"] != previous:
            raise ValueError("binary-log manifest chain is broken")
        if index == first_index and manifest["startPosition"] != first_position:
            raise ValueError("first binary-log segment does not begin at the snapshot coordinate")
        if index == first_index and manifest["startPosition"] > manifest["endPosition"]:
            raise ValueError("snapshot coordinate is beyond the first archived segment")
        if index > first_index and manifest["startPosition"] != 4:
            raise ValueError("subsequent binary-log segment does not begin at position 4")
        previous = digest
        expected_index += 1
    head = ordered[-1][1] if ordered else None
    return {"status": "CHAIN_METADATA_CONTIGUOUS" if ordered else "WAITING_FOR_FIRST_SEGMENT",
            "sourceUuid": source_uuid, "database": database,
            "firstFileIndex": first_index, "headFileIndex": head["fileIndex"] if head else None,
            "headFile": head["binlogFile"] if head else None,
            "headEndPosition": head["endPosition"] if head else None,
            "headCapturedAtUtc": head["capturedAtUtc"] if head else None,
            "headManifestSha256": previous, "segmentCount": len(ordered)}


def publish_segment(raw: Path, manifest: dict, export: Path, recipients: list[str], age: str = "age") -> dict:
    if not raw.is_file() or raw.is_symlink() or raw.stat().st_size != manifest["fileSizeBytes"]:
        raise ValueError("source binary log changed during collection")
    if sha256(raw) != manifest["rawSha256"]:
        raise ValueError("source binary-log digest changed during collection")
    source_short = manifest["sourceUuid"].replace("-", "")[:8]
    bundle_id = source_short + "-" + manifest["binlogFile"]
    if not re.fullmatch(r"[0-9a-f]{8}-[A-Za-z0-9_.-]+\.\d{6}", bundle_id):
        raise ValueError("binary-log bundle identity is invalid")
    export.mkdir(parents=True, exist_ok=True, mode=0o750)
    target = export / bundle_id
    if target.exists():
        existing, _ = manifest_digest(target, bundle_id)
        immutable_keys = ("format", "sourceUuid", "database", "binlogFile", "fileIndex", "startPosition",
                          "endPosition", "fileSizeBytes", "rawSha256", "previousManifestSha256",
                          "snapshotReceiptSha256")
        if all(existing.get(key) == manifest.get(key) for key in immutable_keys):
            return {"status": "ALREADY_PUBLISHED", "bundle": bundle_id}
        raise FileExistsError("binary-log bundle exists with different content")
    stage = export / (".pending-" + uuid.uuid4().hex)
    stage.mkdir(mode=0o750)
    try:
        payload = stage / "segment.bin.age"
        command = [age]
        for recipient in recipients:
            if not recipient.startswith("age1"):
                raise ValueError("age recipient is malformed")
            command += ["-r", recipient]
        command += ["-o", str(payload), str(raw)]
        subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=True, timeout=300)
        with payload.open("rb") as stream:
            os.fsync(stream.fileno())
        manifest = {**manifest, "encryptedFile": payload.name,
                    "encryptedSha256": sha256(payload), "encryptedSizeBytes": payload.stat().st_size}
        encoded = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode()
        with (stage / "manifest.json").open("xb") as stream:
            stream.write(encoded); stream.flush(); os.fsync(stream.fileno())
        complete = {"format": FORMAT, "manifestSha256": hashlib.sha256(encoded).hexdigest(),
                    "encryptedSha256": manifest["encryptedSha256"]}
        atomic_json(stage / "complete.json", complete, 0o640)
        os.chmod(payload, 0o640); os.chmod(stage / "manifest.json", 0o640)
        descriptor = os.open(stage, os.O_RDONLY)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
        os.replace(stage, target)
        descriptor = os.open(export, os.O_RDONLY)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
        return {"status": "PUBLISHED", "bundle": bundle_id,
                "manifestSha256": hashlib.sha256(encoded).hexdigest()}
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def sftp(args: argparse.Namespace, batch: str) -> str:
    binary = shutil.which("sftp")
    if not binary:
        raise RuntimeError("OpenSSH sftp client is required")
    command = [binary, "-q", "-P", str(getattr(args, "port", 22)), "-oBatchMode=yes", "-oStrictHostKeyChecking=yes",
               "-oIdentitiesOnly=yes", "-oUserKnownHostsFile=" + args.known_hosts,
               "-oConnectTimeout=15", "-i", args.ssh_identity, "-b", "-", args.source]
    result = subprocess.run(command, input=batch, text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError("restricted SFTP transfer failed")
    return result.stdout


def pull_binlogs(args: argparse.Namespace) -> dict:
    incoming = Path(args.incoming).resolve()
    incoming.mkdir(parents=True, exist_ok=True, mode=0o700)
    if incoming.stat().st_mode & 0o077:
        raise ValueError("binlog incoming directory must be private (0700)")
    ssh_identity = Path(args.ssh_identity).resolve(strict=True)
    known_hosts = Path(args.known_hosts).resolve(strict=True)
    for path in (ssh_identity,):
        if path.stat().st_mode & 0o077 or path.parent.stat().st_mode & 0o077:
            raise ValueError("replica identities and parent directories must be private")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+", args.source):
        raise ValueError("source must be a fixed user@host from reviewed configuration")
    with (incoming / ".pull.lock").open("a") as lock:
        os.chmod(incoming / ".pull.lock", 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        listing = sftp(args, "ls -1 /binlog\n")
        names = set()
        for line in listing.splitlines():
            name = line.strip().removesuffix("/").removeprefix("/binlog/")
            if re.fullmatch(r"[0-9a-f]{8}-[A-Za-z0-9_.-]+\.\d{6}", name):
                names.add(name)
        anchor_stage = incoming / (".pending-anchor-" + uuid.uuid4().hex)
        anchor_stage.mkdir(mode=0o700)
        try:
            sftp(args, "get /binlog/anchor.json " + str(anchor_stage / "anchor.json") + "\n"
                 + "get /binlog/chain-status.json " + str(anchor_stage / "chain-status.json") + "\n")
            anchor = read_object(anchor_stage / "anchor.json")
            source_status = read_object(anchor_stage / "chain-status.json")
            source_uuid = anchor.get("sourceUuid")
            if args.expected_uuid and source_uuid != args.expected_uuid.lower():
                raise ValueError("source UUID does not match the replica trust configuration")
            if anchor.get("database") != args.database:
                raise ValueError("source database does not match the replica trust configuration")
            if (source_status.get("status") != "PUBLISHED_CONTIGUOUS"
                    or source_status.get("sourceUuid") != source_uuid
                    or source_status.get("database") != args.database
                    or not isinstance(source_status.get("headFileIndex"), int)
                    or not isinstance(source_status.get("headManifestSha256"), str)):
                raise ValueError("source has not published a complete contiguous binlog chain")
            final_anchor = incoming / "anchor.json"
            if final_anchor.exists() and read_object(final_anchor) != anchor:
                # New snapshots do not change the root anchor; any change requires a reviewed chain rebase.
                raise ValueError("source binlog anchor changed; refusing silent chain rebase")
            if not final_anchor.exists():
                os.replace(anchor_stage / "anchor.json", final_anchor)
                os.chmod(final_anchor, 0o600)
        finally:
            shutil.rmtree(anchor_stage, ignore_errors=True)
        receipts = incoming / "receipts"
        receipts.mkdir(mode=0o700, exist_ok=True)
        received = 0
        for name in sorted(names, key=lambda value: parse_binlog_name(value[9:])[1]):
            final = incoming / name
            receipt_path = receipts / (name + ".json")
            if final.exists():
                if final.is_symlink() or not final.is_dir():
                    raise ValueError("existing binary-log replica is not a regular directory")
                manifest, digest = manifest_digest(final, name)
                receipt = read_object(receipt_path) if receipt_path.exists() else {}
                if not receipt:
                    # Publication can outlive a crash before the local receipt. The source
                    # head/anchor checks below still bind the complete local chain.
                    receipt = {"status": "CIPHERTEXT_SEGMENT_VERIFIED", "manifestSha256": digest,
                               "encryptedSha256": manifest["encryptedSha256"], "verifiedAtEpoch": time.time()}
                    atomic_json(receipt_path, receipt)
                if (receipt.get("status") != "CIPHERTEXT_SEGMENT_VERIFIED"
                        or receipt.get("manifestSha256") != digest
                        or receipt.get("encryptedSha256") != manifest["encryptedSha256"]):
                    raise ValueError("previously verified binary-log replica changed; preserving evidence")
                continue
            stage = incoming / (".pending-" + name + "-" + uuid.uuid4().hex)
            stage.mkdir(mode=0o700)
            remote = "/binlog/" + name
            try:
                sftp(args, "get " + remote + "/manifest.json " + str(stage / "manifest.json") + "\n"
                     + "get " + remote + "/complete.json " + str(stage / "complete.json") + "\n")
                manifest, digest = manifest_digest(stage, name, metadata_only=True)
                if manifest["sourceUuid"] != source_uuid or manifest["database"] != args.database:
                    raise ValueError("binary-log segment is bound to another source")
                if shutil.disk_usage(incoming).free < manifest["encryptedSizeBytes"] + args.minimum_free_bytes:
                    raise RuntimeError("insufficient free space; retaining existing verified replicas")
                sftp(args, "get " + remote + "/segment.bin.age " + str(stage / "segment.bin.age") + "\n")
                manifest, digest = manifest_digest(stage, name)
                verification = {"status": "CIPHERTEXT_SEGMENT_VERIFIED", "sourceUuid": manifest["sourceUuid"],
                                "database": manifest["database"], "binlogFile": manifest["binlogFile"],
                                "manifestSha256": digest, "verificationBoundary": "ciphertext hash and manifest continuity; no age decryption"}
                os.replace(stage, final)
                atomic_json(receipt_path, {**verification, "encryptedSha256": manifest["encryptedSha256"],
                                           "verifiedAtEpoch": time.time(), "verifiedAtUtc": utc_now()})
                received += 1
            except Exception:
                failed = incoming / ("failed-" + name + "-" + uuid.uuid4().hex[:8])
                if stage.exists():
                    os.replace(stage, failed)
                raise
        # Only segments anchored at the snapshot coordinate count as a valid chain.
        bundles = [path for path in incoming.iterdir() if path.is_dir() and not path.is_symlink()
                   and re.fullmatch(r"[0-9a-f]{8}-[A-Za-z0-9_.-]+\.\d{6}", path.name)]
        checked = verify_chain(bundles, anchor, args.expected_uuid, args.database)
        if (checked.get("headFileIndex") != source_status["headFileIndex"]
                or checked.get("headManifestSha256") != source_status["headManifestSha256"]):
            raise ValueError("receiver segment set is behind or differs from the source publication head")
        for bundle in bundles:
            manifest, digest = manifest_digest(bundle)
            receipt = read_object(receipts / (bundle.name + ".json"))
            if receipt.get("status") != "CIPHERTEXT_SEGMENT_VERIFIED" or receipt.get("manifestSha256") != digest:
                raise RuntimeError("one or more replica segments lack a matching ciphertext verification receipt")
        checked = chain_freshness(checked, args.stale_after_seconds, decrypted=False) if bundles else {
            **checked, "status": "WAITING_FOR_FIRST_SEGMENT"}
        checked.update(checkedAtEpoch=time.time(), checkedAtUtc=utc_now(), newlyReceivedSegments=received,
                       verificationBoundary="ciphertext hash and manifest continuity; no age decryption or MySQL restore")
        atomic_json(incoming / "status.json", checked)
        return checked


def _docker(container: str, database: str, sql: str, stdin=None) -> bytes:
    command = ["docker", "exec", "-i", container, "sh", "-c",
               'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names "$@"',
               "mysql", database]
    return subprocess.run(command, input=sql.encode() if stdin is None else None, stdin=stdin,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=30).stdout


def read_binary_log_index(container: str) -> tuple[str, str, list[tuple[str, int]]]:
    source_uuid = _docker(container, "mysql", "SELECT @@server_uuid;").decode("ascii").strip().lower()
    if not UUID.fullmatch(source_uuid):
        raise RuntimeError("MySQL source UUID is invalid")
    basename = _docker(container, "mysql", "SELECT @@log_bin_basename;").decode("utf-8").strip()
    if not basename.startswith("/") or ".." in Path(basename).parts:
        raise RuntimeError("MySQL binary-log base path is invalid")
    result = _docker(container, "mysql", "SHOW BINARY LOGS;").decode("ascii").splitlines()
    logs = []
    for line in result:
        parts = line.split("\t")
        if len(parts) not in (2, 3):
            raise RuntimeError("MySQL binary-log index row has an unsupported column count")
        parse_binlog_name(parts[0])
        size = int(parts[1])
        if len(parts) == 3 and parts[2] not in ("Yes", "No"):
            raise RuntimeError("MySQL binary-log encryption indicator is invalid")
        if size < 4:
            raise RuntimeError("MySQL binary-log size is invalid")
        logs.append((parts[0], size))
    logs.sort(key=lambda item: parse_binlog_name(item[0])[1])
    if not logs or any(parse_binlog_name(logs[i + 1][0])[1] != parse_binlog_name(logs[i][0])[1] + 1 for i in range(len(logs) - 1)):
        raise RuntimeError("source MySQL binary-log index itself contains a gap")
    return source_uuid, basename, logs


def list_binary_logs(container: str) -> tuple[str, str, list[tuple[str, int]]]:
    _docker(container, "mysql", "FLUSH BINARY LOGS;")
    return read_binary_log_index(container)


def snapshot_anchor(backup_dir: Path, database: str) -> dict:
    receipts = sorted(backup_dir.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    for receipt_path in receipts:
        if receipt_path.is_symlink():
            continue
        receipt = read_object(receipt_path)
        if receipt.get("status") != "BACKUP_OK":
            continue
        source_uuid = receipt.get("sourceUuid")
        file_name = receipt.get("snapshotBinlogFile")
        position = receipt.get("snapshotBinlogPosition")
        if (receipt.get("database") != database or not isinstance(source_uuid, str)
                or not UUID.fullmatch(source_uuid) or not isinstance(position, int) or position < 4):
            raise RuntimeError("latest successful snapshot lacks a source-bound binlog coordinate")
        parse_binlog_name(str(file_name))
        if not isinstance(receipt.get("sqlSha256"), str) or not HEX.fullmatch(receipt["sqlSha256"]):
            raise RuntimeError("latest successful snapshot receipt digest is invalid")
        return {"format": "hometown-binlog-anchor-v1", "sourceUuid": source_uuid,
                "database": database, "snapshotFile": receipt["file"],
                "snapshotSha256": receipt["sqlSha256"], "snapshotReceiptSha256": sha256(receipt_path),
                "snapshotBinlogFile": file_name, "snapshotBinlogPosition": position,
                "createdAtUtc": receipt.get("createdAtUtc")}
    raise RuntimeError("no source-coordinate snapshot is available; take a verified snapshot first")


def capture(args: argparse.Namespace) -> dict:
    os.umask(0o027)
    backup = Path(args.backup_dir).resolve(strict=True)
    root = Path(args.archive_dir).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.stat().st_mode & 0o077:
        raise ValueError("local binlog staging root must be private (0700)")
    recipients_path = Path(args.recipients).resolve(strict=True)
    if recipients_path.stat().st_mode & 0o077:
        raise ValueError("age recipient configuration must be restricted")
    recipients = [line.strip() for line in recipients_path.read_text().splitlines()
                  if line.strip() and not line.lstrip().startswith("#")]
    if not recipients:
        raise ValueError("no age recipients configured")
    export = Path(args.export_dir).resolve()
    bundle_root = export / "binlog"
    bundle_root.mkdir(parents=True, exist_ok=True, mode=0o2750)
    export_stat = export.stat()
    bundle_stat = bundle_root.stat()
    if (os.geteuid() != 0 or export_stat.st_uid != 0 or bundle_stat.st_uid != 0
            or not export_stat.st_mode & stat.S_ISGID or not bundle_stat.st_mode & stat.S_ISGID
            or grp.getgrgid(export_stat.st_gid).gr_name != "hometown-replica"
            or bundle_stat.st_gid != export_stat.st_gid
            or export_stat.st_mode & 0o027 or bundle_stat.st_mode & 0o027):
        raise ValueError("binlog export root must preserve the restricted root:hometown-replica setgid boundary")
    anchor = snapshot_anchor(backup, args.database)
    with (root / ".archive.lock").open("a") as lock:
        os.chmod(root / ".archive.lock", 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state_path = root / "chain.json"
        if state_path.exists():
            state = read_object(state_path)
            if state.get("format") != CHAIN_FORMAT or state.get("sourceUuid") != anchor["sourceUuid"] or state.get("database") != args.database:
                raise ValueError("existing binlog chain belongs to a different MySQL source or database")
            anchor = state["anchor"]
            expected_index = int(state["headFileIndex"]) + 1
            previous = state["headManifestSha256"]
        else:
            if (bundle_root / "anchor.json").exists():
                anchor = read_object(bundle_root / "anchor.json")
            expected_index = parse_binlog_name(anchor["snapshotBinlogFile"])[1]
            previous = anchor["snapshotReceiptSha256"]
        source_uuid, log_basename, logs = list_binary_logs(args.container)
        if source_uuid != anchor["sourceUuid"]:
            raise RuntimeError("MySQL server UUID changed since snapshot; refusing to mix sources")
        by_index = {parse_binlog_name(name)[1]: (name, size) for name, size in logs}
        anchor_index = parse_binlog_name(anchor["snapshotBinlogFile"])[1]
        archived = [path for path in bundle_root.iterdir() if path.is_dir() and not path.is_symlink()
                    and re.fullmatch(r"[0-9a-f]{8}-[A-Za-z0-9_.-]+\.\d{6}", path.name)]
        durable = verify_chain(archived, anchor, source_uuid, args.database)
        checkpoint_bundles = [path for path in archived if manifest_digest(path)[0]["fileIndex"] < expected_index]
        checkpoint = verify_chain(checkpoint_bundles, anchor, source_uuid, args.database)
        checkpoint_head = checkpoint["headFileIndex"] if checkpoint_bundles else anchor_index - 1
        if checkpoint_head != expected_index - 1 or checkpoint["headManifestSha256"] != previous:
            raise RuntimeError("durable archived chain does not match its checkpoint")
        if archived:
            # Adopt only a fully validated durable suffix after a publish/checkpoint crash.
            expected_index = durable["headFileIndex"] + 1
            previous = durable["headManifestSha256"]
            state = {"format": CHAIN_FORMAT, "status": "PUBLISHED_CONTIGUOUS",
                     "sourceUuid": source_uuid, "database": args.database, "anchor": anchor,
                     "headFileIndex": durable["headFileIndex"], "headFile": durable["headFile"],
                     "headEndPosition": durable["headEndPosition"], "headManifestSha256": previous,
                     "lastPublishedEpoch": datetime.fromisoformat(durable["headCapturedAtUtc"].replace("Z", "+00:00")).timestamp()}
            atomic_json(state_path, state)
        elif anchor_index not in by_index:
            raise RuntimeError("snapshot anchor binlog expired before its first segment was archived")
        if expected_index < anchor_index:
            raise RuntimeError("archive chain head precedes its snapshot anchor")
        active_index = parse_binlog_name(logs[-1][0])[1]
        if expected_index > active_index:
            raise RuntimeError("archive checkpoint is ahead of the MySQL binary-log index")
        if expected_index < active_index and expected_index not in by_index:
            raise RuntimeError("binary-log index purged an unarchived segment")
        atomic_json(bundle_root / "anchor.json", anchor, 0o640)
        # The final file is active. Only immutable, closed segments are copied and published.
        closed = [idx for idx in range(expected_index, active_index) if idx in by_index]
        if closed and closed[0] != expected_index:
            raise RuntimeError("binary-log index purged an unarchived segment")
        published = []
        for index in closed:
            file_name, expected_size = by_index[index]
            basename, _ = parse_binlog_name(file_name)
            source_path = str(Path(log_basename).parent / file_name)
            with tempfile.TemporaryDirectory(prefix=".binlog-", dir=root) as temporary:
                raw = Path(temporary) / file_name
                subprocess.run(["docker", "cp", args.container + ":" + source_path, str(raw)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=120)
                if raw.is_symlink() or not raw.is_file() or raw.stat().st_size != expected_size:
                    raise RuntimeError("closed MySQL binary log size changed during copy")
                # Recheck source listing after copying to catch a file replacement or source switch.
                latest_uuid, _, latest_logs = read_binary_log_index(args.container)
                latest = {name: size for name, size in latest_logs}
                if latest_uuid != source_uuid or latest.get(file_name) != expected_size:
                    raise RuntimeError("MySQL binary-log source changed during archive")
                raw_hash = sha256(raw)
                manifest = {"format": FORMAT, "sourceUuid": source_uuid, "database": args.database,
                            "binlogFile": file_name, "fileIndex": index,
                            "startPosition": anchor["snapshotBinlogPosition"] if index == anchor_index else 4,
                            "endPosition": expected_size, "fileSizeBytes": expected_size,
                            "rawSha256": raw_hash, "previousManifestSha256": previous,
                            "snapshotReceiptSha256": anchor["snapshotReceiptSha256"],
                            "capturedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")}
                result = publish_segment(raw, manifest, bundle_root, recipients, args.age)
                bundle = bundle_root / (source_uuid.replace("-", "")[:8] + "-" + file_name)
                published_manifest, previous = manifest_digest(bundle)
                state = {"format": CHAIN_FORMAT, "status": "PUBLISHED_CONTIGUOUS",
                         "sourceUuid": source_uuid, "database": args.database, "anchor": anchor,
                         "headFileIndex": index, "headFile": file_name, "headEndPosition": expected_size,
                         "headManifestSha256": previous, "lastPublishedEpoch": time.time(),
            "verificationBoundary": "source ciphertext encrypted and atomically published; receiver state is separate"}
                atomic_json(state_path, state)
                atomic_json(bundle_root / "chain-status.json", state, 0o640)
                published.append(result)
                expected_index = index + 1
        if not closed:
            state = read_object(state_path) if state_path.exists() else {
                "format": CHAIN_FORMAT, "status": "WAITING_FOR_FIRST_CLOSED_SEGMENT",
                "sourceUuid": source_uuid, "database": args.database, "anchor": anchor,
                "headFileIndex": anchor_index - 1, "headFile": None,
                "headEndPosition": None, "headManifestSha256": previous,
                "lastPublishedEpoch": None,
                         "verificationBoundary": "source ciphertext encrypted and atomically published; receiver state is separate"}
            atomic_json(state_path, state)
            atomic_json(bundle_root / "anchor.json", anchor, 0o640)
        else:
            atomic_json(bundle_root / "anchor.json", anchor, 0o640)
        state["currentSourceFile"] = logs[-1][0]
        state["currentSourcePosition"] = logs[-1][1]
        state["checkedAtUtc"] = utc_now()
        atomic_json(state_path, state)
        atomic_json(bundle_root / "chain-status.json", state, 0o640)
        return {"status": "PUBLISHED_CONTIGUOUS" if state.get("headFileIndex", 0) >= anchor_index else "WAITING_FOR_FIRST_CLOSED_SEGMENT",
                "publishedSegments": len(published), "sourceUuid": source_uuid,
                "headFile": state.get("headFile"), "headEndPosition": state.get("headEndPosition"),
                "remoteVerification": "NOT_OBSERVED_BY_SOURCE"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def chain_freshness(status: dict, stale_after_seconds: int = 900, now: datetime | None = None,
                    decrypted: bool = True) -> dict:
    captured = status.get("headCapturedAtUtc")
    if not isinstance(captured, str):
        return {**status, "status": "STALE", "ageSeconds": None}
    try:
        instant = datetime.fromisoformat(captured.replace("Z", "+00:00"))
    except ValueError:
        return {**status, "status": "INVALID_TIME", "ageSeconds": None}
    now = now or datetime.now(timezone.utc)
    age = max(0, int((now - instant).total_seconds()))
    return {**status, "status": "STALE" if age > stale_after_seconds else (
                "CONTIGUOUS_AND_DECRYPTION_VERIFIED" if decrypted else "CONTIGUOUS_CIPHERTEXT_VERIFIED"),
            "ageSeconds": age, "staleAfterSeconds": stale_after_seconds}


def verify_age(bundle: Path, identity: Path, age: str = "age", output=None, timeout_seconds: int = 300) -> dict:
    if identity.is_symlink() or not identity.is_file() or identity.stat().st_mode & 0o077 or identity.parent.stat().st_mode & 0o077:
        raise ValueError("age identity and its parent directory must be private")
    manifest, digest = manifest_digest(bundle)
    encrypted = bundle / manifest["encryptedFile"]
    process = subprocess.Popen([age, "-d", "-i", str(identity), str(encrypted)], stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert process.stdout is not None
    raw_hash = hashlib.sha256()
    raw_size = 0
    deadline = threading.Timer(timeout_seconds, process.kill)
    deadline.start()
    try:
        for chunk in iter(lambda: process.stdout.read(1024 * 1024), b""):
            raw_hash.update(chunk); raw_size += len(chunk)
            if raw_size > manifest["fileSizeBytes"]:
                raise RuntimeError("decrypted binary log exceeds its declared size")
            if output is not None:
                output.write(chunk)
        if process.wait() != 0:
            raise RuntimeError("age authentication or decryption failed")
    finally:
        deadline.cancel()
        if process.poll() is None:
            process.kill(); process.wait()
    if raw_hash.hexdigest() != manifest["rawSha256"] or raw_size != manifest["fileSizeBytes"]:
        raise RuntimeError("decrypted binary log failed size or digest verification")
    return {"status": "BINLOG_SEGMENT_VERIFIED", "sourceUuid": manifest["sourceUuid"],
            "database": manifest["database"], "binlogFile": manifest["binlogFile"],
            "rawSha256": raw_hash.hexdigest(), "manifestSha256": digest,
            "plaintextWritten": output is not None}


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    source = commands.add_parser("capture")
    source.add_argument("--container", default="hometown-food-mysql-1")
    source.add_argument("--database", default="hometown_food")
    source.add_argument("--backup-dir", default="/var/backups/hometown-database")
    source.add_argument("--archive-dir", default="/var/backups/hometown-database/binlog-local")
    source.add_argument("--export-dir", default="/var/backups/hometown-database/replica-export")
    source.add_argument("--recipients", default="/etc/hometown-backup/replica-recipients.txt")
    source.add_argument("--age", default="/usr/local/bin/age")
    pull = commands.add_parser("pull")
    pull.add_argument("--incoming", default="/var/lib/hometown-replica/binlog")
    pull.add_argument("--ssh-identity", default="/etc/hometown-replica/ssh_identity")
    pull.add_argument("--known-hosts", default="/etc/hometown-replica/known_hosts")
    pull.add_argument("--source", required=True)
    pull.add_argument("--port", type=int, default=22)
    pull.add_argument("--database", default="hometown_food")
    pull.add_argument("--expected-uuid", required=True)
    pull.add_argument("--minimum-free-bytes", type=int, default=1024 * 1024 * 1024)
    pull.add_argument("--stale-after-seconds", type=int, default=900)
    pull.set_defaults(handler=pull_binlogs)
    source.set_defaults(handler=capture)
    args = parser.parse_args()
    try:
        print(json.dumps(args.handler(args), sort_keys=True))
    except Exception as exc:
        print(json.dumps({"status": "FAILED", "errorType": type(exc).__name__}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
