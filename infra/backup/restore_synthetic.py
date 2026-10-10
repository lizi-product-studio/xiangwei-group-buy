#!/usr/bin/env python3
"""Restore a marked synthetic PITR fixture into a new or empty task-owned schema only."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import uuid

import binlog_archive as archive
import database_backup as snapshots

TARGET = re.compile(r"^hometown_sec_b_[a-zA-Z0-9_]{1,48}$")
COLLECTIONS = ("orders", "payments", "orderRefunds", "partialRefunds", "ledger", "users", "points")


def validate_target_name(name: str) -> None:
    if not TARGET.fullmatch(name):
        raise ValueError("restore target must use the exact hometown_sec_b_ task schema prefix")


def validate_expected_rows(path: Path) -> list[dict]:
    values = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(values, list) or not values:
        raise ValueError("expectedRows must be an array of synthetic entity records")
    keys = set()
    for item in values:
        if not isinstance(item, dict) or item.get("collection") not in COLLECTIONS:
            raise ValueError("expectedRows contains an unsupported collection")
        if not isinstance(item.get("entityKey"), str) or not isinstance(item.get("document"), dict):
            raise ValueError("expectedRows record is malformed")
        collection, document = item["collection"], item["document"]
        required = {"orders": ("id", "userId", "pickupPointId", "status", "totalCents"),
                    "orderRefunds": ("id", "orderId", "paymentId", "status", "amountCents"),
                    "partialRefunds": ("id", "orderId", "paymentId", "status", "amountCents"),
                    "payments": ("id", "orderId", "status", "amountCents"),
                    "ledger": ("id", "referenceType", "referenceId", "eventType", "lines"),
                    "users": ("id", "status"), "points": ("id", "status")}[collection]
        if any(key not in document for key in required):
            raise ValueError("expectedRows omits amount, state, or ownership fields")
        key = (collection, item["entityKey"])
        if key in keys:
            raise ValueError("expectedRows contains duplicate entity identities")
        keys.add(key)
    present = {item["collection"] for item in values}
    if not set(COLLECTIONS).issubset(present):
        raise ValueError("expectedRows must cover orders/payments/both refund kinds/ledger/users/points")
    by_id = {collection: {item["document"]["id"]: item["document"] for item in values
                          if item["collection"] == collection} for collection in COLLECTIONS}
    for order in by_id["orders"].values():
        if order["userId"] not in by_id["users"] or order["pickupPointId"] not in by_id["points"]:
            raise ValueError("expected order ownership is incomplete")
    for payment in by_id["payments"].values():
        if payment["orderId"] not in by_id["orders"]:
            raise ValueError("expected payment order is missing")
    for collection in ("orderRefunds", "partialRefunds"):
        for refund in by_id[collection].values():
            payment = by_id["payments"].get(refund["paymentId"])
            if payment is None or payment["orderId"] != refund["orderId"]:
                raise ValueError("expected refund/payment ownership does not match")
    for ledger in by_id["ledger"].values():
        if ledger["referenceType"] == "ORDER" and ledger["referenceId"] not in by_id["orders"]:
            raise ValueError("expected ledger order is missing")
    return sorted(values, key=lambda item: (item["collection"], item["entityKey"]))


def select_segments(bundles: list[Path], snapshot_file: str, snapshot_position: int,
                    stop_file: str, stop_position: int) -> list[tuple[Path, dict]]:
    snapshot_index = archive.parse_binlog_name(snapshot_file)[1]
    stop_index = archive.parse_binlog_name(stop_file)[1]
    if snapshot_position < 4 or stop_position < 4 or snapshot_index > stop_index:
        raise ValueError("snapshot and recovery coordinates are invalid or reversed")
    manifests = [(bundle, archive.manifest_digest(bundle)[0]) for bundle in bundles]
    included = [(bundle, manifest) for bundle, manifest in manifests
                if snapshot_index <= manifest["fileIndex"] <= stop_index]
    included.sort(key=lambda item: item[1]["fileIndex"])
    if (not included or included[0][1]["fileIndex"] != snapshot_index
            or included[0][1]["binlogFile"] != snapshot_file):
        raise ValueError("selected snapshot binlog segment is missing from the archive")
    if included[-1][1]["binlogFile"] != stop_file:
        raise ValueError("requested recovery stop file is outside the supplied segment chain")
    if snapshot_position > included[0][1]["endPosition"] or stop_position > included[-1][1]["endPosition"]:
        raise ValueError("snapshot or stop position is beyond its archived segment")
    return included


def _mysql(container: str, database: str, sql: str | None = None, source=None) -> bytes:
    command = ["docker", "exec", "-i", container, "sh", "-c",
               'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names "$@"',
               "mysql", database]
    result = subprocess.run(command, input=sql.encode() if source is None and sql is not None else None,
                            stdin=source, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            check=True, timeout=180)
    return result.stdout


def read_target_rows(container: str, target: str) -> list[dict]:
    mode = _mysql(container, target, "SELECT mode FROM community_entity_store_state WHERE id=1;").decode().strip()
    if mode in ("LEGACY", "PREPARED"):
        payload = json.loads(_mysql(container, target, "SELECT payload FROM community_product_state WHERE id=1;").decode())
        rows = []
        for collection in COLLECTIONS:
            entries = payload.get(collection, [])
            if not isinstance(entries, list):
                raise ValueError("legacy collection must contain application Map entries")
            keys = set()
            for entry in entries:
                if (not isinstance(entry, list) or len(entry) != 2
                        or not isinstance(entry[0], str) or not isinstance(entry[1], dict)
                        or entry[0] in keys):
                    raise ValueError("legacy Map entry is malformed or duplicated")
                keys.add(entry[0])
                rows.append({"collection": collection, "entityKey": entry[0], "document": entry[1]})
        return sorted(rows, key=lambda item: (item["collection"], item["entityKey"]))
    if mode != "ENTITY":
        raise RuntimeError("restored store mode is invalid")
    raw = _mysql(container, target,
                 "SELECT collection,entity_key,document FROM community_entity_records "
                 "WHERE collection IN ('orders','payments','orderRefunds','partialRefunds','ledger','users','points') ORDER BY collection,entity_key;")
    rows = []
    for line in raw.decode("utf-8").splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3:
            raise RuntimeError("restored row projection is malformed")
        rows.append({"collection": parts[0], "entityKey": parts[1], "document": json.loads(parts[2])})
    return rows


def restore(args: argparse.Namespace) -> dict:
    validate_target_name(args.target_database)
    fixture = Path(args.fixture).resolve(strict=True)
    if fixture.is_symlink() or not fixture.is_dir():
        raise ValueError("synthetic fixture root must be a regular directory")
    metadata = archive.read_object(fixture / "fixture.json")
    if metadata.get("format") != "hometown-synthetic-pitr-fixture-v1" or metadata.get("synthetic") is not True:
        raise ValueError("restore tool accepts only explicitly marked synthetic fixtures")
    source_database = metadata.get("database")
    source_uuid = metadata.get("sourceUuid")
    if not isinstance(source_database, str) or not re.fullmatch(r"[A-Za-z0-9_]+", source_database):
        raise ValueError("synthetic fixture database binding is invalid")
    validate_target_name(source_database)
    if source_database == args.target_database:
        raise ValueError("restore target must differ from synthetic source")
    if not isinstance(source_uuid, str) or not archive.UUID.fullmatch(source_uuid):
        raise ValueError("synthetic fixture MySQL UUID binding is invalid")
    snapshot_name = metadata.get("snapshotFile")
    if snapshot_name != "snapshot.sql.gz":
        raise ValueError("synthetic fixture snapshot filename is invalid")
    snapshot = fixture / snapshot_name
    if snapshot.is_symlink() or not snapshot.is_file() or archive.sha256(snapshot) != metadata.get("snapshotCompressedSha256"):
        raise ValueError("synthetic snapshot compressed digest mismatch")
    expected_rows_path = fixture / "expectedRows.json"
    if archive.sha256(expected_rows_path) != metadata.get("expectedRowsSha256"):
        raise ValueError("synthetic expected-row oracle digest mismatch")
    expected_rows = validate_expected_rows(expected_rows_path)
    anchor = archive.read_object(fixture / "anchor.json")
    if (anchor.get("sourceUuid") != source_uuid or anchor.get("database") != source_database
            or anchor.get("format") != "hometown-binlog-anchor-v1"):
        raise ValueError("synthetic fixture anchor does not match source metadata")
    snapshot_file = metadata.get("snapshotBinlogFile")
    snapshot_position = metadata.get("snapshotBinlogPosition")
    snapshot_index = archive.parse_binlog_name(str(snapshot_file))[1]
    anchor_index = archive.parse_binlog_name(anchor["snapshotBinlogFile"])[1]
    if not isinstance(snapshot_position, int) or snapshot_position < 4 or snapshot_index < anchor_index:
        raise ValueError("selected snapshot coordinate is invalid or predates the archive anchor")
    receipt_path = fixture / "snapshotReceipt.json"
    receipt = archive.read_object(receipt_path)
    if (archive.sha256(receipt_path) != metadata.get("snapshotReceiptSha256")
            or receipt.get("sourceUuid") != source_uuid or receipt.get("database") != source_database
            or receipt.get("sqlSha256") != metadata.get("snapshotSqlSha256")
            or receipt.get("compressedSha256") != metadata.get("snapshotCompressedSha256")
            or receipt.get("snapshotBinlogFile") != snapshot_file
            or receipt.get("snapshotBinlogPosition") != snapshot_position):
        raise ValueError("synthetic snapshot receipt does not bind the selected snapshot")
    if snapshot_index == anchor_index and (
            snapshot_position != anchor["snapshotBinlogPosition"]
            or metadata["snapshotSqlSha256"] != anchor.get("snapshotSha256")
            or metadata["snapshotReceiptSha256"] != anchor["snapshotReceiptSha256"]):
        raise ValueError("synthetic snapshot does not match its root archive anchor")
    segment_names = metadata.get("segmentBundles")
    if not isinstance(segment_names, list) or not segment_names or any(
            not isinstance(name, str) or not re.fullmatch(r"[0-9a-f]{8}-[A-Za-z0-9_.-]+\.\d{6}", name)
            for name in segment_names):
        raise ValueError("synthetic fixture must name an exact ordered segment set")
    if len(set(segment_names)) != len(segment_names):
        raise ValueError("synthetic fixture repeats a segment")
    bundles = [fixture / "segments" / name for name in segment_names]
    chain = archive.verify_chain(bundles, anchor, source_uuid, source_database)
    for bundle in bundles:
        archive.verify_age(bundle, Path(args.identity).resolve(strict=True), args.age)
    stop_file = args.stop_file or metadata.get("expectedStopFile")
    stop_position = args.stop_position or metadata.get("expectedStopPosition")
    if not isinstance(stop_file, str) or not isinstance(stop_position, int):
        raise ValueError("point-in-time recovery target is incomplete")
    if stop_file != metadata.get("expectedStopFile") or stop_position != metadata.get("expectedStopPosition"):
        raise ValueError("recovery target does not match the expected-row oracle coordinate")
    included = select_segments(bundles, snapshot_file, snapshot_position, stop_file, stop_position)
    work = Path(args.work_dir).resolve()
    work.mkdir(parents=True, exist_ok=True, mode=0o700)
    if work.is_symlink() or work.stat().st_mode & 0o077:
        raise ValueError("synthetic recovery work directory must be private (0700)")
    probe = _mysql(args.container, "mysql", "SELECT @@binlog_format,@@gtid_mode;").decode().strip().split("\t")
    if probe != ["ROW", "OFF"]:
        raise RuntimeError("synthetic recovery container must use the verified ROW/GTID_OFF settings")
    existence = _mysql(args.container, "information_schema",
                       "SELECT COUNT(*) FROM schemata WHERE schema_name='" + args.target_database + "';").decode().strip()
    target_exists = existence == "1"
    if target_exists:
        table_count = int(_mysql(args.container, "information_schema",
                                 "SELECT COUNT(*) FROM tables WHERE table_schema='" + args.target_database + "';").decode().strip())
        if table_count:
            raise RuntimeError("restore target is already non-empty; refusing repeated or partial replay")
    run_id = uuid.uuid4().hex
    plain_snapshot = work / ("snapshot-" + run_id + ".sql")
    with gzip.open(snapshot, "rb") as source, plain_snapshot.open("xb") as output:
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk); output.write(chunk)
        output.flush(); os.fsync(output.fileno())
    if digest.hexdigest() != metadata.get("snapshotSqlSha256"):
        plain_snapshot.unlink(missing_ok=True)
        raise ValueError("synthetic snapshot SQL digest mismatch")
    with plain_snapshot.open("rb") as source:
        prefix = source.read(4 * 1024 * 1024)
    if re.search(rb"(?im)^\s*(?:USE\s+|CREATE\s+DATABASE\b|DROP\s+DATABASE\b)", prefix):
        plain_snapshot.unlink(missing_ok=True)
        raise ValueError("synthetic snapshot attempts to select or create a database")
    if snapshots.snapshot_binlog_position(plain_snapshot) != (snapshot_file, snapshot_position):
        raise ValueError("synthetic dump coordinate differs from metadata")
    marker = work / (args.target_database + ".restore-started.json")
    with marker.open("x", encoding="utf-8") as output:
        json.dump({"target": args.target_database, "requestId": run_id, "status": "STARTED"}, output)
        output.flush(); os.fsync(output.fileno())
    if not target_exists:
        _mysql(args.container, "mysql", "CREATE DATABASE `" + args.target_database + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;")
    started = time.monotonic()
    # If interrupted after schema creation or partial SQL, the next run sees a non-empty target and refuses replay.
    with plain_snapshot.open("rb") as source:
        _mysql(args.container, args.target_database, source=source)
    for index, (bundle, manifest) in enumerate(included):
        raw = work / ("segment-" + run_id + "-" + str(index).zfill(4) + ".bin")
        encrypted = bundle / "segment.bin.age"
        with raw.open("xb") as output:
            archive.verify_age(bundle, Path(args.identity), args.age, output=output)
            output.flush(); os.fsync(output.fileno())
        start = snapshot_position if index == 0 else manifest["startPosition"]
        command = [args.mysqlbinlog, "--database=" + args.target_database,
                   "--rewrite-db=" + source_database + "->" + args.target_database,
                   "--start-position=" + str(start)]
        if manifest["binlogFile"] == stop_file:
            command.append("--stop-position=" + str(stop_position))
        command.append(str(raw))
        decoder = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            _mysql(args.container, args.target_database, source=decoder.stdout)
            if decoder.wait(timeout=30) != 0:
                raise RuntimeError("mysqlbinlog rejected the synthetic replay")
        finally:
            if decoder.poll() is None:
                decoder.kill(); decoder.wait()
        raw.unlink(missing_ok=True)
    actual = read_target_rows(args.container, args.target_database)
    if actual != expected_rows:
        raise RuntimeError("restored application objects differ by identity, amount, state or ownership")
    plain_snapshot.unlink(missing_ok=True)
    receipt = {"status": "SYNTHETIC_PITR_PASS", "sourceUuid": source_uuid,
               "sourceDatabase": source_database, "targetDatabase": args.target_database,
               "snapshotSqlSha256": metadata["snapshotSqlSha256"],
               "stopFile": stop_file, "stopPosition": stop_position,
               "verifiedApplicationRows": len(actual), "verifiedCollections": list(COLLECTIONS), "elapsedSeconds": round(time.monotonic() - started, 3),
               "targetPreserved": True, "requestId": str(uuid.uuid4()),
               "checkedAtUtc": archive.utc_now()}
    Path(args.receipt).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    archive.atomic_json(Path(args.receipt), receipt)
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--container", required=True)
    parser.add_argument("--target-database", required=True)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--stop-file")
    parser.add_argument("--stop-position", type=int)
    parser.add_argument("--mysqlbinlog", default="/usr/bin/mysqlbinlog")
    parser.add_argument("--age", default="/usr/bin/age")
    args = parser.parse_args()
    try:
        print(json.dumps(restore(args), sort_keys=True))
    except Exception as exc:
        print(json.dumps({"status": "FAILED", "errorType": type(exc).__name__, "requestId": str(uuid.uuid4())}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
