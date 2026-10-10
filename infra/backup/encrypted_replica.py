#!/usr/bin/env python3
"""Publish and verify encrypted database replica bundles without writing plaintext on the receiver."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import grp
import stat
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import zlib

HEX = re.compile(r"^[0-9a-f]{64}$")
NAME = re.compile(r"^[A-Za-z0-9_.-]+$")


def sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def write_json(path: Path, value: dict) -> None:
    with path.open("xb") as stream:
        stream.write((json.dumps(value, sort_keys=True, indent=2) + "\n").encode())
        stream.flush()
        os.fsync(stream.fileno())


def fsync_dir(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    write_json(temporary, value)
    os.replace(temporary, path)
    fsync_dir(path.parent)


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError("JSON document must be an object")
    return value


def read_bundle_metadata(bundle: Path, expected_bundle_id: str | None = None) -> dict:
    if bundle.is_symlink() or not bundle.is_dir():
        raise ValueError("bundle must be a real directory")
    complete_path = bundle / "complete.json"
    manifest_path = bundle / "manifest.json"
    for path in (complete_path, manifest_path):
        if path.is_symlink() or not path.is_file():
            raise ValueError("bundle is missing regular completion or manifest files")
    complete = load_json(complete_path)
    manifest_bytes = manifest_path.read_bytes()
    manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()
    manifest = json.loads(manifest_bytes)
    bundle_id = expected_bundle_id or bundle.name
    source_file = bundle_id + ".sql.gz"
    if (not re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}", bundle_id)
            or manifest.get("format") != "hometown-encrypted-db-replica-v1"
            or manifest.get("sourceFile") != source_file
            or manifest.get("encryptedFile") != source_file + ".age"):
        raise ValueError("bundle metadata does not match its exact bundle identity")
    if complete.get("format") != manifest["format"] or complete.get("manifestSha256") != manifest_hash:
        raise ValueError("bundle manifest is incomplete or does not match its completion marker")
    for name in ("compressedSha256", "sqlSha256", "encryptedSha256"):
        if not isinstance(manifest.get(name), str) or not HEX.fullmatch(manifest[name]):
            raise ValueError("invalid digest in bundle manifest")
    coordinate_keys = ("sourceUuid", "snapshotBinlogFile", "snapshotBinlogPosition")
    coordinate_count = sum(key in manifest for key in coordinate_keys)
    if coordinate_count not in (0, len(coordinate_keys)):
        raise ValueError("snapshot bundle contains an incomplete binlog coordinate")
    if coordinate_count:
        source_uuid, snapshot_file, snapshot_position = (manifest[key] for key in coordinate_keys)
        if (not isinstance(source_uuid, str) or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", source_uuid)
                or not isinstance(snapshot_file, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+\.\d{6}", snapshot_file)
                or not isinstance(snapshot_position, int) or snapshot_position < 4):
            raise ValueError("snapshot source UUID or transactional binlog coordinate is invalid")
    encrypted_size = manifest.get("encryptedSizeBytes")
    recipients = manifest.get("recipientKeyIds")
    if (not isinstance(encrypted_size, int) or encrypted_size < 1
            or not isinstance(recipients, list) or not recipients
            or any(not isinstance(value, str) or not HEX.fullmatch(value) for value in recipients)):
        raise ValueError("invalid size or recipient identities in bundle manifest")
    if (complete.get("encryptedSha256") != manifest["encryptedSha256"]
            or complete.get("sourceFile") != source_file
            or complete.get("sourceCompressedSha256") != manifest["compressedSha256"]
            or (coordinate_count and (complete.get("sourceUuid") != manifest["sourceUuid"]
                                      or complete.get("snapshotBinlogFile") != manifest["snapshotBinlogFile"]
                                      or complete.get("snapshotBinlogPosition") != manifest["snapshotBinlogPosition"]))):
        raise ValueError("completion marker does not match source or encrypted digests")
    return {"complete": complete, "manifest": manifest, "manifestSha256": manifest_hash}


def inspect_bundle(bundle: Path, expected_bundle_id: str | None = None) -> dict:
    metadata = read_bundle_metadata(bundle, expected_bundle_id)
    manifest = metadata["manifest"]
    encrypted = bundle / manifest["encryptedFile"]
    expected_names = {"complete.json", "manifest.json", manifest["encryptedFile"]}
    if {path.name for path in bundle.iterdir()} != expected_names or encrypted.is_symlink() or not encrypted.is_file():
        raise ValueError("bundle contains unexpected files or a non-regular payload")
    encrypted_size = encrypted.stat().st_size
    encrypted_hash = sha256(encrypted)
    if encrypted_size != manifest["encryptedSizeBytes"] or encrypted_hash != manifest["encryptedSha256"]:
        raise ValueError("encrypted payload size or digest mismatch")
    return {**metadata, "encryptedPath": encrypted, "encryptedSizeBytes": encrypted_size, "encryptedSha256": encrypted_hash}


def validate_export_directory(export: Path, expected_group: str | None = None, expected_uid: int = 0) -> None:
    export_stat = export.stat()
    export_mode = export_stat.st_mode & 0o777
    if export_stat.st_uid != expected_uid:
        raise ValueError("encrypted export directory must be owned by root")
    if export_mode & 0o027 or export_mode & 0o750 != 0o750 or not (export_stat.st_mode & stat.S_ISGID):
        raise ValueError("encrypted export directory must be setgid 0750 for restricted SFTP group inheritance")
    if expected_group and grp.getgrgid(export_stat.st_gid).gr_name != expected_group:
        raise ValueError("encrypted export directory is not owned by the configured restricted SFTP group")


def existing_publish_result(target: Path, source_file: str, compressed_hash: str) -> dict:
    inspected = inspect_bundle(target)
    manifest = inspected["manifest"]
    if manifest["sourceFile"] != source_file or manifest["compressedSha256"] != compressed_hash:
        raise FileExistsError("bundle path exists with different content; refusing to overwrite")
    return {"status": "ALREADY_PUBLISHED", "bundle": target.name, "encryptedSha256": inspected["encryptedSha256"]}


def publish_backup(source: Path, backup_dir: Path, recipient_path: Path, export: Path, expected_group: str | None = None) -> dict:
    os.umask(0o027)
    binary = shutil.which("age")
    if not binary:
        raise RuntimeError("age is required; refusing to publish an unencrypted replica")
    source = Path(source).resolve(strict=True)
    backup_dir = Path(backup_dir).resolve(strict=True)
    if source.parent != backup_dir or source.suffixes[-2:] != [".sql", ".gz"]:
        raise ValueError("backup must be an exact .sql.gz file inside the configured backup directory")
    receipt_path = source.with_suffix(".json")
    receipt = load_json(receipt_path)
    if receipt.get("status") != "BACKUP_OK" or receipt.get("file") != source.name:
        raise ValueError("source backup receipt does not match the requested backup")
    compressed_hash = sha256(source)
    if receipt.get("compressedSha256") != compressed_hash or not HEX.fullmatch(str(receipt.get("sqlSha256", ""))):
        raise ValueError("source backup receipt digest mismatch")
    with gzip.open(source, "rb") as stream:
        sql_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    if sql_hash != receipt["sqlSha256"]:
        raise ValueError("source SQL digest does not match backup receipt")
    recipient_path = Path(recipient_path).resolve(strict=True)
    recipients = [line.strip() for line in recipient_path.read_text().splitlines() if line.strip() and not line.lstrip().startswith("#")]
    if not recipients or any(not value.startswith("age1") for value in recipients):
        raise ValueError("recipient file must contain one or more age public recipients")
    export = Path(export).resolve()
    export.mkdir(parents=True, exist_ok=True, mode=0o750)
    validate_export_directory(export, expected_group)
    with (export / ".publish.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        bundle_id = source.name.removesuffix(".sql.gz")
        if not NAME.fullmatch(bundle_id):
            raise ValueError("invalid backup filename")
        target = export / bundle_id
        if target.exists():
            return existing_publish_result(target, source.name, compressed_hash)
        stage = export / (".pending-" + uuid.uuid4().hex)
        stage.mkdir(mode=0o750)
        try:
            encrypted_name = source.name + ".age"
            encrypted_path = stage / encrypted_name
            command = [binary]
            for recipient in recipients:
                command += ["-r", recipient]
            command += ["-o", str(encrypted_path), str(source)]
            subprocess.run(command, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
            with encrypted_path.open("rb") as stream:
                os.fsync(stream.fileno())
            cipher_hash = sha256(encrypted_path)
            manifest = {
                "format": "hometown-encrypted-db-replica-v1",
                "sourceFile": source.name,
                "createdAtUtc": receipt.get("createdAtUtc"),
                "exportedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "retentionEligible": True,
                "database": receipt.get("database"),
                "sourceUuid": receipt["sourceUuid"],
                "snapshotBinlogFile": receipt["snapshotBinlogFile"],
                "snapshotBinlogPosition": receipt["snapshotBinlogPosition"],
                "compressedSha256": compressed_hash,
                "sqlSha256": receipt["sqlSha256"],
                "sizeBytes": receipt.get("sizeBytes"),
                "encryptedFile": encrypted_name,
                "encryptedSha256": cipher_hash,
                "encryptedSizeBytes": encrypted_path.stat().st_size,
                "recipientKeyCount": len(recipients),
                "recipientKeyIds": sorted(hashlib.sha256(value.encode()).hexdigest() for value in recipients),
            }
            manifest_bytes = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode()
            with (stage / "manifest.json").open("xb") as stream:
                stream.write(manifest_bytes)
                stream.flush()
                os.fsync(stream.fileno())
            complete = {
                "format": manifest["format"],
                "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                "encryptedSha256": cipher_hash,
                "sourceFile": source.name,
                "sourceCompressedSha256": compressed_hash,
                "sourceUuid": receipt["sourceUuid"],
                "snapshotBinlogFile": receipt["snapshotBinlogFile"],
                "snapshotBinlogPosition": receipt["snapshotBinlogPosition"],
            }
            temporary_complete = stage / ".complete.tmp"
            write_json(temporary_complete, complete)
            os.replace(temporary_complete, stage / "complete.json")
            fsync_dir(stage)
            os.replace(stage, target)
            fsync_dir(export)
            return {"status": "PUBLISHED", "bundle": bundle_id, "encryptedSha256": cipher_hash}
        except Exception:
            shutil.rmtree(stage, ignore_errors=True)
            raise


def verify(args: argparse.Namespace) -> dict:
    binary = shutil.which("age")
    if not binary:
        raise RuntimeError("age is required; refusing to accept an unverifiable replica")
    bundle = Path(args.bundle).resolve(strict=True)
    identity = Path(args.identity).resolve(strict=True)
    if identity.stat().st_mode & 0o077 or identity.parent.stat().st_mode & 0o077:
        raise ValueError("decryption identity and its directory must be private (0600 file, 0700 directory)")
    inspected = inspect_bundle(bundle, getattr(args, "expected_bundle_id", None))
    manifest = inspected["manifest"]
    manifest_hash = inspected["manifestSha256"]
    encrypted = inspected["encryptedPath"]
    proc = subprocess.Popen([binary, "-d", "-i", str(identity), str(encrypted)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    compressed_hash = hashlib.sha256()
    sql_hash = hashlib.sha256()
    decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
    try:
        while chunk := proc.stdout.read(1024 * 1024):
            compressed_hash.update(chunk)
            pending = chunk
            while pending:
                output = decompressor.decompress(pending, 1024 * 1024)
                sql_hash.update(output)
                pending = decompressor.unconsumed_tail
        status = proc.wait()
        if status != 0:
            raise RuntimeError("age authentication/decryption failed")
        if not decompressor.eof or decompressor.unused_data or compressed_hash.hexdigest() != manifest["compressedSha256"] or sql_hash.hexdigest() != manifest["sqlSha256"]:
            raise RuntimeError("decrypted backup failed compressed or SQL digest verification")
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    result = {"status": "DECRYPTION_VERIFIED", "sourceFile": manifest["sourceFile"],
              "sqlSha256": sql_hash.hexdigest(), "encryptedSha256": manifest["encryptedSha256"],
              "manifestSha256": manifest_hash, "plaintextWritten": False,
              "verificationBoundary": "age decryption, gzip and content hashes; no plaintext file"}
    if "sourceUuid" in manifest:
        result.update(sourceUuid=manifest["sourceUuid"], snapshotBinlogFile=manifest["snapshotBinlogFile"],
                      snapshotBinlogPosition=manifest["snapshotBinlogPosition"])
    return result


def sftp(args: argparse.Namespace, batch: str) -> str:
    binary = shutil.which("sftp")
    if not binary:
        raise RuntimeError("OpenSSH sftp client is required")
    command = [binary, "-q", "-P", str(getattr(args, "port", 22)), "-oBatchMode=yes", "-oStrictHostKeyChecking=yes",
               "-oIdentitiesOnly=yes", f"-oUserKnownHostsFile={args.known_hosts}",
               "-oConnectTimeout=15", "-i", args.ssh_identity, "-b", "-", args.source]
    result = subprocess.run(command, input=batch, text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError("restricted SFTP operation failed")
    return result.stdout


def root_bundle_names(listing: str) -> list[str]:
    """Accept only one bundle-name entry from an SFTP listing of the chroot root."""
    bundles = set()
    for line in listing.splitlines():
        entry = line.strip()
        if not entry or entry.startswith("sftp>"):
            continue
        if entry.startswith("/"):
            entry = entry[1:]
        if entry.endswith("/"):
            entry = entry[:-1]
        if "/" not in entry and re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}", entry):
            bundles.add(entry)
    return sorted(bundles)


def load_rotation_state(incoming: Path) -> dict:
    state_path = incoming / ".rotation-state.json"
    if state_path.is_symlink():
        raise ValueError("rotation state must be a regular file")
    if not state_path.exists():
        return {}
    if not state_path.is_file():
        raise ValueError("rotation state must be a regular file")
    state = load_json(state_path)
    rotated = state.get("rotated")
    if state.get("format") != "hometown-replica-rotation-state-v1" or not isinstance(rotated, dict):
        raise ValueError("rotation state is invalid; refusing to skip source bundles")
    for bundle_id, value in rotated.items():
        if (not re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}", bundle_id)
                or not isinstance(value, dict)
                or value.get("sourceFile") != bundle_id + ".sql.gz"
                or any(not isinstance(value.get(key), str) or not HEX.fullmatch(value[key])
                       for key in ("compressedSha256", "manifestSha256", "encryptedSha256"))):
            raise ValueError("rotation state contains an invalid bundle identity or digest")
    return rotated


def rotation_state_document(rotated: dict) -> dict:
    return {"format": "hometown-replica-rotation-state-v1", "rotated": rotated}


def bind_ciphertext_source(manifest: dict, args: argparse.Namespace) -> None:
    expected = getattr(args, "expected_uuid", None)
    database = getattr(args, "database", None)
    if (not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", expected)
            or manifest.get("sourceUuid") != expected or manifest.get("database") != database
            or not isinstance(database, str) or not re.fullmatch(r"[A-Za-z0-9_]+", database)):
        raise ValueError("snapshot ciphertext UUID or database differs from receiver trust configuration")


def verify_ciphertext(bundle: Path, args: argparse.Namespace, expected_bundle_id: str | None = None) -> dict:
    inspected = inspect_bundle(bundle, expected_bundle_id)
    manifest = inspected["manifest"]
    bind_ciphertext_source(manifest, args)
    return {"status": "CIPHERTEXT_VERIFIED", "sourceFile": manifest["sourceFile"],
            "sourceUuid": manifest["sourceUuid"], "database": manifest["database"],
            "encryptedSha256": inspected["encryptedSha256"], "manifestSha256": inspected["manifestSha256"],
            "compressedSha256": manifest["compressedSha256"], "sqlSha256": manifest["sqlSha256"],
            "plaintextWritten": False, "decryptionPerformed": False,
            "verificationBoundary": "ciphertext hashes and bound source metadata only; no age call"}


def pull(args: argparse.Namespace) -> dict:
    incoming = Path(args.incoming).resolve()
    incoming.mkdir(parents=True, exist_ok=True, mode=0o700)
    if incoming.stat().st_mode & 0o077:
        raise ValueError("incoming directory must be private (0700)")
    ciphertext_only = getattr(args, "ciphertext_only", False)
    identity = None if ciphertext_only else Path(args.identity).resolve(strict=True)
    ssh_identity = Path(args.ssh_identity).resolve(strict=True)
    known_hosts = Path(args.known_hosts).resolve(strict=True)
    for path in ((ssh_identity,) if ciphertext_only else (identity, ssh_identity)):
        if path.stat().st_mode & 0o077 or path.parent.stat().st_mode & 0o077:
            raise ValueError("replica identities and parent directories must be private")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+", args.source):
        raise ValueError("source must be a fixed user@host from the reviewed environment file")
    state_path = incoming / "status.json"
    with (incoming / ".pull.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        bundles = root_bundle_names(sftp(args, "ls -1 /\n"))
        rotated = load_rotation_state(incoming)
        verified = []
        rotation_skipped = []
        for bundle_id in bundles:
            final = incoming / bundle_id
            receipts_dir = incoming / "receipts"
            if bundle_id in rotated:
                stage = incoming / (".pending-" + bundle_id + "-" + uuid.uuid4().hex)
                stage.mkdir(mode=0o700)
                try:
                    remote = "/" + bundle_id
                    sftp(args, f"get {remote}/complete.json {stage}/complete.json\nget {remote}/manifest.json {stage}/manifest.json\n")
                    metadata = read_bundle_metadata(stage, bundle_id)
                    prior = rotated[bundle_id]
                    current = metadata["manifest"]
                    if ciphertext_only:
                        bind_ciphertext_source(current, args)
                    if (metadata["manifestSha256"] != prior["manifestSha256"]
                            or current["compressedSha256"] != prior["compressedSha256"]
                            or current["encryptedSha256"] != prior["encryptedSha256"]):
                        raise ValueError("rotated source bundle metadata changed; refusing re-pull")
                    shutil.rmtree(stage)
                    rotation_skipped.append(bundle_id)
                    continue
                except Exception:
                    failed = incoming / ("failed-" + bundle_id + "-" + uuid.uuid4().hex[:8])
                    if stage.exists():
                        os.replace(stage, failed)
                        fsync_dir(incoming)
                    raise
            if final.exists():
                if not final.is_dir() or final.is_symlink():
                    raise ValueError("existing incoming path is not a bundle directory")
                existing_receipt = receipts_dir / f"{bundle_id}.json"
                accepted = ("CIPHERTEXT_VERIFIED", "DECRYPTION_VERIFIED", "VERIFIED_CIPHERTEXT_ONLY") if ciphertext_only else ("DECRYPTION_VERIFIED", "VERIFIED_CIPHERTEXT_ONLY")
                if existing_receipt.is_file() and load_json(existing_receipt).get("status") in accepted:
                    inspected = inspect_bundle(final)
                    receipt = load_json(existing_receipt)
                    if (receipt.get("encryptedSha256") != inspected["encryptedSha256"]
                            or receipt.get("manifestSha256") != inspected["manifestSha256"]):
                        raise ValueError("previously verified local replica changed; preserving evidence and failing pull")
                    if ciphertext_only:
                        verification = verify_ciphertext(final, args)
                        atomic_json(existing_receipt, {**verification, "verifiedAtEpoch": time.time(),
                            "verifiedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
                    verified.append(bundle_id)
                    continue
                verification = (verify_ciphertext(final, args) if ciphertext_only else
                                verify(argparse.Namespace(bundle=str(final), identity=str(identity))))
                receipts_dir.mkdir(mode=0o700, exist_ok=True)
                atomic_json(existing_receipt, {**verification, "verifiedAtEpoch": time.time(), "verifiedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
                verified.append(bundle_id)
                continue
            stage = incoming / (".pending-" + bundle_id + "-" + uuid.uuid4().hex)
            stage.mkdir(mode=0o700)
            try:
                remote = "/" + bundle_id
                sftp(args, f"get {remote}/complete.json {stage}/complete.json\nget {remote}/manifest.json {stage}/manifest.json\n")
                complete = load_json(stage / "complete.json")
                manifest_bytes = (stage / "manifest.json").read_bytes()
                manifest = json.loads(manifest_bytes)
                if ciphertext_only:
                    bind_ciphertext_source(read_bundle_metadata(stage, bundle_id)["manifest"], args)
                if manifest.get("sourceFile") != bundle_id + ".sql.gz":
                    raise ValueError("remote bundle identity does not match its source manifest")
                if complete.get("manifestSha256") != hashlib.sha256(manifest_bytes).hexdigest() or manifest.get("format") != "hometown-encrypted-db-replica-v1":
                    raise ValueError("remote manifest or completion marker failed validation")
                payload_name = manifest.get("encryptedFile")
                if not isinstance(payload_name, str) or not NAME.fullmatch(payload_name) or not payload_name.endswith(".sql.gz.age"):
                    raise ValueError("remote manifest payload name is invalid")
                payload_size = manifest.get("encryptedSizeBytes")
                if not isinstance(payload_size, int) or payload_size < 1 or shutil.disk_usage(incoming).free < payload_size + args.minimum_free_bytes:
                    raise RuntimeError("insufficient free space to preserve existing verified replicas")
                sftp(args, f"get {remote}/{payload_name} {stage}/{payload_name}\n")
                verification = (verify_ciphertext(stage, args, bundle_id) if ciphertext_only else
                                verify(argparse.Namespace(bundle=str(stage), identity=str(identity), expected_bundle_id=bundle_id)))
                receipts_dir.mkdir(mode=0o700, exist_ok=True)
                atomic_json(receipts_dir / f"{bundle_id}.json", {**verification, "verifiedAtEpoch": time.time(), "verifiedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
                os.replace(stage, final)
                fsync_dir(incoming)
                verified.append(bundle_id)
            except Exception:
                # Keep any received ciphertext and metadata for diagnosis; never discard older verified bundles.
                failed = incoming / ("failed-" + bundle_id + "-" + uuid.uuid4().hex[:8])
                if stage.exists():
                    os.replace(stage, failed)
                    fsync_dir(incoming)
                raise
        state = {"status": "REPLICATED" if verified else "WAITING_FOR_FIRST_BACKUP", "verifiedBundleCount": len(verified), "latestBundle": verified[-1] if verified else None, "rotationSkippedBundleCount": len(rotation_skipped), "checkedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        state["verificationBoundary"] = "ciphertext/metadata only" if ciphertext_only else "decryption verification or matching historical decryption receipt"
        atomic_json(state_path, state)
        return state


def status(args: argparse.Namespace) -> dict:
    config = Path(args.config_dir)
    required = [config / "source.env", config / "ssh_identity", config / "known_hosts"]
    ciphertext_only = getattr(args, "ciphertext_only", False)
    if not ciphertext_only:
        required.append(config / "age-identity.txt")
    if any(not path.is_file() for path in required):
        return {"status": "NOT_CONFIGURED", "verifiedBundleCount": 0}
    state_path = Path(args.incoming) / "status.json"
    if not state_path.is_file():
        return {"status": "WAITING_FOR_FIRST_BACKUP", "verifiedBundleCount": 0}
    state = load_json(state_path)
    if state.get("status") == "FAILED":
        return {"status": "FAILED", "errorType": state.get("errorType", "UnknownError")}
    if state.get("status") == "WAITING_FOR_FIRST_BACKUP":
        return {"status": "WAITING_FOR_FIRST_BACKUP", "verifiedBundleCount": 0}
    bundle_id = state.get("latestBundle")
    if not isinstance(bundle_id, str) or not re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}", bundle_id):
        return {"status": "FAILED", "reason": "latest verified replica identity is invalid"}
    latest = Path(args.incoming) / bundle_id
    receipt_path = Path(args.receipts) / f"{bundle_id}.json"
    if not latest.is_dir() or not receipt_path.is_file():
        return {"status": "FAILED", "reason": "latest verified replica or receipt is missing"}
    receipt = load_json(receipt_path)
    try:
        inspected = inspect_bundle(latest)
    except Exception:
        return {"status": "FAILED", "reason": "latest verified replica failed local integrity recheck"}
    accepted = ("CIPHERTEXT_VERIFIED", "DECRYPTION_VERIFIED", "VERIFIED_CIPHERTEXT_ONLY") if ciphertext_only else ("DECRYPTION_VERIFIED", "VERIFIED_CIPHERTEXT_ONLY")
    if ciphertext_only:
        bind_ciphertext_source(inspected["manifest"], args)
    if (receipt.get("status") not in accepted
            or receipt.get("encryptedSha256") != inspected["encryptedSha256"]
            or receipt.get("manifestSha256") != inspected["manifestSha256"]):
        return {"status": "FAILED", "reason": "latest verified replica no longer matches its verification receipt"}
    age_hours = (time.time() - float(receipt.get("verifiedAtEpoch", 0))) / 3600
    free_bytes = shutil.disk_usage(Path(args.incoming)).free
    if free_bytes < args.minimum_free_bytes:
        return {"status": "LOW_DISK", "freeBytes": free_bytes, "minimumFreeBytes": args.minimum_free_bytes}
    if age_hours > args.stale_after_hours:
        return {"status": "STALE", "latestBundle": state.get("latestBundle"), "ageHours": round(age_hours, 2), "freeBytes": free_bytes}
    return {"status": "REPLICATED", "latestBundle": state.get("latestBundle"), "verifiedBundleCount": state.get("verifiedBundleCount"), "ageHours": round(age_hours, 2), "freeBytes": free_bytes,
            "verificationBoundary": "ciphertext/metadata only" if ciphertext_only else "prior decryption receipt and current ciphertext hashes"}


def _utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("retention timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def retention_plan(args: argparse.Namespace) -> dict:
    incoming = Path(args.incoming).resolve(strict=True)
    active_ids = json.loads(Path(args.active_key_ids).read_text())
    if not isinstance(active_ids, list) or not active_ids or any(not isinstance(value, str) or not HEX.fullmatch(value) for value in active_ids):
        raise ValueError("active key ID file must contain one or more SHA-256 recipient IDs")
    managed_after = _utc(args.managed_after)
    receipts = Path(args.receipts).resolve(strict=True)
    records = []
    for bundle in incoming.iterdir():
        if not re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}", bundle.name) or bundle.is_symlink() or not bundle.is_dir():
            continue
        receipt_path = receipts / f"{bundle.name}.json"
        manifest_path = bundle / "manifest.json"
        complete_path = bundle / "complete.json"
        if not receipt_path.is_file() or not manifest_path.is_file() or not complete_path.is_file():
            continue
        receipt = load_json(receipt_path)
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
        complete = load_json(complete_path)
        payload_name = manifest.get("encryptedFile")
        if not isinstance(payload_name, str) or not NAME.fullmatch(payload_name):
            continue
        payload = bundle / payload_name
        if not payload.is_file() or payload.is_symlink():
            continue
        encrypted_hash = sha256(payload)
        manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()
        if receipt.get("status") not in ("VERIFIED_CIPHERTEXT_ONLY", "DECRYPTION_VERIFIED") or receipt.get("encryptedSha256") != encrypted_hash or receipt.get("manifestSha256") != manifest_hash:
            continue
        if complete.get("encryptedSha256") != encrypted_hash or complete.get("manifestSha256") != manifest_hash:
            continue
        try:
            created = _utc(str(manifest["createdAtUtc"]))
            exported = _utc(str(manifest["exportedAtUtc"]))
        except (KeyError, ValueError):
            continue
        if manifest.get("retentionEligible") is not True or exported < managed_after or manifest.get("sourceFile") != bundle.name + ".sql.gz":
            continue
        key_ids = manifest.get("recipientKeyIds")
        if not isinstance(key_ids, list) or any(not isinstance(value, str) or not HEX.fullmatch(value) for value in key_ids):
            continue
        records.append({"bundleId": bundle.name, "createdAtUtc": created.isoformat(), "exportedAtUtc": exported.isoformat(), "recipientKeyIds": sorted(set(key_ids)), "encryptedSha256": encrypted_hash, "manifestSha256": manifest_hash, "receiptPath": str(receipt_path)})
    records.sort(key=lambda value: (value["createdAtUtc"], value["bundleId"]))

    keep: dict[str, set[str]] = {}
    def preserve(record: dict, reason: str) -> None:
        keep.setdefault(record["bundleId"], set()).add(reason)
    if records:
        newest = max(records, key=lambda value: (value["createdAtUtc"], value["bundleId"]))
        preserve(newest, "latest-recoverable")
        days: dict[str, dict] = {}
        weeks: dict[tuple[int, int], dict] = {}
        for record in records:
            created = _utc(record["createdAtUtc"])
            day = created.strftime("%Y-%m-%d")
            week = created.isocalendar()[:2]
            if day not in days or record["createdAtUtc"] > days[day]["createdAtUtc"]:
                days[day] = record
            if week not in weeks or record["createdAtUtc"] > weeks[week]["createdAtUtc"]:
                weeks[week] = record
        for record in sorted(days.values(), key=lambda value: value["createdAtUtc"], reverse=True)[:7]: preserve(record, "daily-7")
        for record in sorted(weeks.values(), key=lambda value: value["createdAtUtc"], reverse=True)[:4]: preserve(record, "weekly-4")
        for key_id in active_ids:
            matching = [record for record in records if key_id in record["recipientKeyIds"]]
            if not matching:
                raise ValueError("no successfully verified replica exists for every configured active key")
            preserve(max(matching, key=lambda value: (value["createdAtUtc"], value["bundleId"])), "last-copy-for-active-key:" + key_id)

    eligible_ids = {record["bundleId"] for record in records}
    candidates = [record for record in records if record["bundleId"] not in keep]
    protected = [{**record, "reasons": sorted(keep[record["bundleId"]])} for record in records if record["bundleId"] in keep]
    preserved = []
    for child in sorted(incoming.iterdir(), key=lambda value: value.name):
        if child.name in eligible_ids or child.name in ("receipts", ".pull.lock", ".rotation-state.json", "status.json"):
            continue
        reason = "in-progress" if child.name.startswith(".pending-") else "failed-evidence" if child.name.startswith("failed-") else "historical-unmanaged-or-unverified"
        preserved.append({"name": child.name, "reason": reason})
    def bundle_bytes(bundle_id: str) -> int:
        root = incoming / bundle_id
        return sum(path.stat().st_size for path in root.rglob("*") if path.is_file() and not path.is_symlink())
    plan = {"format": "hometown-replica-retention-plan-v1", "mode": "DRY_RUN", "managedAfterUtc": managed_after.isoformat(), "generatedAtUtc": datetime.now(timezone.utc).isoformat(), "incomingRoot": str(incoming), "policy": {"daily": 7, "weekly": 4, "protectLatestRecoverable": True, "activeKeyIds": active_ids}, "candidateCount": len(candidates), "candidateBytes": sum(bundle_bytes(value["bundleId"]) + Path(value["receiptPath"]).stat().st_size for value in candidates), "candidates": candidates, "protected": protected, "preservedUnmanagedOrUnverified": preserved}
    return plan


def apply_retention_plan(args: argparse.Namespace) -> dict:
    plan = load_json(Path(args.apply_plan))
    generated = _utc(str(plan.get("generatedAtUtc", "")))
    age_seconds = (datetime.now(timezone.utc) - generated).total_seconds()
    if age_seconds < 0 or age_seconds > args.max_plan_age_hours * 3600:
        raise ValueError("retention plan is too old; generate and review a new dry-run")
    root = Path(args.incoming).resolve(strict=True)
    lock_path = root / ".pull.lock"
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fresh = retention_plan(argparse.Namespace(incoming=str(root), receipts=args.receipts, active_key_ids=args.active_key_ids, managed_after=args.managed_after))
        old_ids = [(value["bundleId"], value["encryptedSha256"], value["manifestSha256"]) for value in plan.get("candidates", [])]
        new_ids = [(value["bundleId"], value["encryptedSha256"], value["manifestSha256"]) for value in fresh["candidates"]]
        if (plan.get("format") != fresh["format"] or plan.get("incomingRoot") != fresh["incomingRoot"]
                or plan.get("managedAfterUtc") != fresh["managedAfterUtc"]
                or plan.get("policy") != fresh["policy"] or old_ids != new_ids or not old_ids):
            raise ValueError("reviewed retention candidates changed or are empty; no files removed")
        candidates = []
        rotated = load_rotation_state(root)
        for bundle_id, encrypted_hash, manifest_hash in old_ids:
            bundle = root / bundle_id
            if bundle.parent != root or bundle.is_symlink() or not bundle.is_dir():
                raise ValueError("candidate path changed; no files removed")
            inspected = inspect_bundle(bundle)
            manifest = inspected["manifest"]
            if inspected["manifestSha256"] != manifest_hash or inspected["encryptedSha256"] != encrypted_hash:
                raise ValueError("candidate content changed; no files removed")
            state_record = {"sourceFile": manifest["sourceFile"], "compressedSha256": manifest["compressedSha256"],
                            "encryptedSha256": encrypted_hash, "manifestSha256": manifest_hash}
            if bundle_id in rotated and any(rotated[bundle_id].get(key) != value for key, value in state_record.items()):
                raise ValueError("existing rotation state conflicts with candidate; no files removed")
            rotated[bundle_id] = {**state_record, "rotatedAtUtc": datetime.now(timezone.utc).isoformat()}
            receipt = Path(next(value["receiptPath"] for value in fresh["candidates"] if value["bundleId"] == bundle_id))
            candidates.append((bundle, receipt, encrypted_hash))
        atomic_json(root / ".rotation-state.json", rotation_state_document(rotated))
        removed = []
        for bundle, receipt, encrypted_hash in candidates:
            shutil.rmtree(bundle)
            if receipt.parent == Path(args.receipts).resolve() and receipt.name == bundle.name + ".json":
                receipt.unlink(missing_ok=True)
            removed.append({"bundleId": bundle.name, "encryptedSha256": encrypted_hash})
        fsync_dir(root)
        fsync_dir(Path(args.receipts).resolve())
        return {"status": "ROTATION_APPLIED", "removed": removed, "bytesFreed": plan["candidateBytes"]}


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    publish_parser = sub.add_parser("publish")
    publish_parser.add_argument("--backup", required=True)
    publish_parser.add_argument("--backup-dir", default="/var/backups/hometown-database")
    publish_parser.add_argument("--recipients", required=True)
    publish_parser.add_argument("--export-dir", default="/var/backups/hometown-database/replica-export")
    publish_parser.add_argument("--expected-group", default="hometown-replica")
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--bundle", required=True)
    verify_parser.add_argument("--identity", required=True)
    pull_parser = sub.add_parser("pull")
    pull_parser.add_argument("--source", required=True)
    pull_parser.add_argument("--ssh-identity", required=True)
    pull_parser.add_argument("--known-hosts", required=True)
    pull_parser.add_argument("--identity", required=True)
    pull_parser.add_argument("--incoming", default="/var/lib/hometown-replica/incoming")
    pull_parser.add_argument("--minimum-free-bytes", type=int, default=512 * 1024 * 1024)
    ciphertext_parser = sub.add_parser("pull-ciphertext")
    ciphertext_parser.add_argument("--source", required=True)
    ciphertext_parser.add_argument("--ssh-identity", required=True)
    ciphertext_parser.add_argument("--known-hosts", required=True)
    ciphertext_parser.add_argument("--expected-uuid", required=True)
    ciphertext_parser.add_argument("--database", default="hometown_food")
    ciphertext_parser.add_argument("--port", type=int, default=22)
    ciphertext_parser.add_argument("--incoming", default="/var/lib/hometown-replica/incoming")
    ciphertext_parser.add_argument("--minimum-free-bytes", type=int, default=512 * 1024 * 1024)
    ciphertext_parser.set_defaults(ciphertext_only=True)
    status_parser = sub.add_parser("status")
    status_parser.add_argument("--config-dir", default="/etc/hometown-replica")
    status_parser.add_argument("--incoming", default="/var/lib/hometown-replica/incoming")
    status_parser.add_argument("--receipts", default="/var/lib/hometown-replica/incoming/receipts")
    status_parser.add_argument("--stale-after-hours", type=float, default=26)
    status_parser.add_argument("--minimum-free-bytes", type=int, default=512 * 1024 * 1024)
    status_parser.add_argument("--ciphertext-only", action="store_true")
    status_parser.add_argument("--expected-uuid")
    status_parser.add_argument("--database", default="hometown_food")
    retention_parser = sub.add_parser("retention")
    retention_parser.add_argument("--incoming", default="/var/lib/hometown-replica/incoming")
    retention_parser.add_argument("--receipts", default="/var/lib/hometown-replica/incoming/receipts")
    retention_parser.add_argument("--active-key-ids", default="/etc/hometown-replica/active-recipient-key-ids.json")
    retention_parser.add_argument("--managed-after", required=True)
    retention_parser.add_argument("--plan-out")
    retention_parser.add_argument("--apply-plan")
    retention_parser.add_argument("--max-plan-age-hours", type=float, default=24)
    args = parser.parse_args()
    try:
        if args.command == "publish": result = publish_backup(Path(args.backup), Path(args.backup_dir), Path(args.recipients), Path(args.export_dir), args.expected_group)
        elif args.command == "verify": result = verify(args)
        elif args.command in ("pull", "pull-ciphertext"): result = pull(args)
        elif args.command == "retention":
            if args.apply_plan:
                result = apply_retention_plan(args)
            else:
                result = retention_plan(args)
                if args.plan_out:
                    atomic_json(Path(args.plan_out), result)
        else:
            result = status(args)
            if result.get("status") in ("FAILED", "STALE", "LOW_DISK"):
                print(json.dumps(result, sort_keys=True))
                raise SystemExit(2)
        print(json.dumps(result, sort_keys=True))
    except Exception as error:
        if args.command in ("pull", "pull-ciphertext"):
            incoming = Path(args.incoming)
            incoming.mkdir(parents=True, exist_ok=True, mode=0o700)
            atomic_json(incoming / "status.json", {"status": "FAILED", "errorType": type(error).__name__, "checkedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        print(json.dumps({"status": "FAILED", "errorType": type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
