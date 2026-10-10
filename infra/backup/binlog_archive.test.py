import argparse
import shutil
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import binlog_archive as archive


UUID = "2d3a4d54-7a3a-4aa1-992c-87ad8bcf1a31"
DB = "hometown_food"
ANCHOR_HASH = "a" * 64


def make_bundle(root: Path, name: str, index: int, previous: str, source_uuid=UUID, database=DB,
                start=157, raw=b"synthetic mysql row binlog", captured="2026-10-10T00:00:00Z"):
    bundle = root / name
    bundle.mkdir()
    payload = bundle / "segment.bin.age"
    payload.write_bytes(raw)  # Test payload stand-in; it is not age encryption evidence.
    digest = hashlib.sha256(raw).hexdigest()
    manifest = {"format": archive.FORMAT, "sourceUuid": source_uuid, "database": database,
                "binlogFile": "mysql-bin.%06d" % index, "fileIndex": index,
                "startPosition": start, "endPosition": 2048, "fileSizeBytes": 2048,
                "rawSha256": hashlib.sha256(b"raw" + raw).hexdigest(),
                "previousManifestSha256": previous, "snapshotReceiptSha256": ANCHOR_HASH,
                "capturedAtUtc": captured, "encryptedFile": "segment.bin.age",
                "encryptedSha256": digest, "encryptedSizeBytes": len(raw)}
    encoded = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode()
    (bundle / "manifest.json").write_bytes(encoded)
    complete = {"format": archive.FORMAT, "manifestSha256": hashlib.sha256(encoded).hexdigest(),
                "encryptedSha256": digest}
    (bundle / "complete.json").write_text(json.dumps(complete))
    return bundle, hashlib.sha256(encoded).hexdigest()


class BinlogArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.anchor = {"format": "hometown-binlog-anchor-v1", "sourceUuid": UUID, "database": DB,
                       "snapshotBinlogFile": "mysql-bin.000001", "snapshotBinlogPosition": 157,
                       "snapshotReceiptSha256": ANCHOR_HASH}
    def tearDown(self): self.tmp.cleanup()

    def pair(self, names=("binlog-a", "binlog-b")):
        first, first_hash = make_bundle(self.root, UUID.replace("-", "")[:8] + "-mysql-bin.000001", 1, ANCHOR_HASH)
        second, _ = make_bundle(self.root, UUID.replace("-", "")[:8] + "-mysql-bin.000002", 2, first_hash, start=4)
        return [first, second]

    def test_three_segments_verify_snapshot_coordinate_and_hash_chain(self):
        bundles = self.pair()
        third, _ = make_bundle(self.root, UUID.replace("-", "")[:8] + "-mysql-bin.000003", 3,
                               archive.manifest_digest(bundles[-1])[1], start=4)
        result = archive.verify_chain(bundles + [third], self.anchor, UUID, DB)
        self.assertEqual(result["status"], "CHAIN_METADATA_CONTIGUOUS")
        self.assertEqual(result["headFileIndex"], 3)
        self.assertEqual(result["segmentCount"], 3)

    def test_missing_first_or_middle_segment_fails(self):
        bundles = self.pair()
        last, _ = make_bundle(self.root, UUID.replace("-", "")[:8] + "-mysql-bin.000003", 3,
                              archive.manifest_digest(bundles[-1])[1], start=4)
        with self.assertRaisesRegex(ValueError, "missing"):
            archive.verify_chain([bundles[1], last], self.anchor)
        with self.assertRaisesRegex(ValueError, "missing"):
            archive.verify_chain([bundles[0], last], self.anchor)

    def test_wrong_source_uuid_or_database_fails_closed(self):
        for source_uuid, database in (("5c6619ba-1e0a-4d73-9c2f-dc6a8159376b", DB), (UUID, "other_db")):
            with self.subTest(source_uuid=source_uuid, database=database):
                path, _ = make_bundle(self.root, source_uuid.replace("-", "")[:8] + "-mysql-bin.000001", 1, ANCHOR_HASH,
                                      source_uuid=source_uuid, database=database)
                with self.assertRaisesRegex(ValueError, "different MySQL source|different database|does not match"):
                    archive.verify_chain([path], self.anchor, UUID, DB)

    def test_ciphertext_mutation_and_truncation_fail(self):
        bundle = self.pair()[0]
        payload = bundle / "segment.bin.age"
        payload.write_bytes(payload.read_bytes() + b"x")
        with self.assertRaisesRegex(ValueError, "ciphertext"):
            archive.manifest_digest(bundle)

    def test_staged_bundle_uses_explicit_source_identity(self):
        final, _ = make_bundle(self.root, UUID.replace("-", "")[:8] + "-mysql-bin.000001", 1, ANCHOR_HASH)
        staged = self.root / (".pending-" + final.name + "-random")
        final.rename(staged)
        with self.assertRaisesRegex(ValueError, "not bound"):
            archive.manifest_digest(staged)
        manifest, _ = archive.manifest_digest(staged, final.name)
        self.assertEqual(manifest["binlogFile"], "mysql-bin.000001")
        with self.assertRaisesRegex(ValueError, "not bound"):
            archive.manifest_digest(staged, "deadbeef-mysql-bin.000001")

    def test_mysql_84_three_column_binary_log_index_is_parsed(self):
        outputs = iter((UUID.encode(), b"/var/lib/mysql/mysql-bin", b"mysql-bin.000001\t128\tNo\nmysql-bin.000002\t256\tYes\n"))
        with patch.object(archive, "_docker", side_effect=lambda *_args: next(outputs)):
            source_uuid, basename, logs = archive.read_binary_log_index("mysql-test")
        self.assertEqual(source_uuid, UUID)
        self.assertEqual(basename, "/var/lib/mysql/mysql-bin")
        self.assertEqual(logs, [("mysql-bin.000001", 128), ("mysql-bin.000002", 256)])

    def test_first_snapshot_position_cannot_exceed_segment_end(self):
        self.anchor["snapshotBinlogPosition"] = 3000
        bundle, _ = make_bundle(self.root, UUID.replace("-", "")[:8] + "-mysql-bin.000001", 1, ANCHOR_HASH, start=3000)
        with self.assertRaisesRegex(ValueError, "beyond"):
            archive.verify_chain([bundle], self.anchor)

    def test_publication_is_atomic_and_rejects_interrupted_encryption(self):
        fake = self.root / "age-copy"
        fake.write_text("#!/usr/bin/env python3\nimport shutil,sys\na=sys.argv[1:]\nshutil.copyfile(a[-1],a[-2])\n")
        fake.chmod(0o700)
        raw = self.root / "mysql-bin.000001"
        content = b"synthetic raw binlog sample"
        raw.write_bytes(content)
        manifest = {"format": archive.FORMAT, "sourceUuid": UUID, "database": DB,
                    "binlogFile": "mysql-bin.000001", "fileIndex": 1,
                    "startPosition": 157, "endPosition": len(content), "fileSizeBytes": len(content),
                    "rawSha256": hashlib.sha256(content).hexdigest(),
                    "previousManifestSha256": ANCHOR_HASH, "snapshotReceiptSha256": ANCHOR_HASH,
                    "capturedAtUtc": "2026-10-10T00:00:00Z"}
        export = self.root / "export"
        archive.publish_segment(raw, manifest, export, ["age1synthetic"], str(fake))
        published = export / (UUID.replace("-", "")[:8] + "-mysql-bin.000001")
        self.assertTrue((published / "complete.json").is_file())
        manifest_path = published / "manifest.json"
        self.assertEqual(json.loads(manifest_path.read_text())["rawSha256"], hashlib.sha256(content).hexdigest())
        retry = dict(manifest, capturedAtUtc="2026-10-10T00:03:00Z")
        self.assertEqual(archive.publish_segment(raw, retry, export, ["age1synthetic"], str(fake))["status"], "ALREADY_PUBLISHED")
        altered = self.root / "altered.bin"
        altered.write_bytes(content + b"changed")
        conflict = dict(retry, fileSizeBytes=altered.stat().st_size, endPosition=altered.stat().st_size,
                        rawSha256=hashlib.sha256(altered.read_bytes()).hexdigest())
        with self.assertRaisesRegex(FileExistsError, "different content"):
            archive.publish_segment(altered, conflict, export, ["age1synthetic"], str(fake))
        failed = self.root / "age-fail"
        failed.write_text("#!/bin/sh\nexit 4\n")
        failed.chmod(0o700)
        next_raw = self.root / "mysql-bin.000002"
        next_raw.write_bytes(content)
        manifest.update(binlogFile="mysql-bin.000002", fileIndex=2)
        with self.assertRaises(subprocess.CalledProcessError):
            archive.publish_segment(next_raw, manifest, export, ["age1synthetic"], str(failed))
        self.assertFalse(any(path.name.startswith(".pending-") for path in export.iterdir()))
        self.assertFalse((export / (UUID.replace("-", "")[:8] + "-mysql-bin.000002")).exists())

    def test_first_and_repeated_pull_publish_ciphertext_without_decrypting(self):
        remote = self.root / "remote"; remote.mkdir()
        first, digest = make_bundle(remote, UUID.replace("-", "")[:8] + "-mysql-bin.000001", 1, ANCHOR_HASH,
                                    captured=archive.utc_now())
        (remote / "anchor.json").write_text(json.dumps(self.anchor))
        (remote / "chain-status.json").write_text(json.dumps({"status": "PUBLISHED_CONTIGUOUS", "sourceUuid": UUID,
             "database": DB, "headFileIndex": 1, "headManifestSha256": digest}))
        config = self.root / "private"; config.mkdir(mode=0o700)
        identity = config / "ssh"; identity.write_text("synthetic SSH placeholder"); identity.chmod(0o600)
        hosts = config / "hosts"; hosts.write_text("synthetic pinned host placeholder")
        args = argparse.Namespace(incoming=str(self.root / "incoming"), ssh_identity=str(identity), known_hosts=str(hosts),
             source="synthetic@example", expected_uuid=UUID, database=DB, minimum_free_bytes=0, stale_after_seconds=900)
        def transfer(_args, batch):
            if batch.startswith("ls"):
                return "/binlog/" + first.name + "\n"
            for line in batch.splitlines():
                _, source, destination = line.split()
                shutil.copyfile(remote / source.removeprefix("/binlog/"), destination)
            return ""
        with patch.object(archive, "sftp", side_effect=transfer), patch.object(archive, "verify_age", side_effect=AssertionError("must not decrypt")):
            result = archive.pull_binlogs(args)
            self.assertEqual(result["status"], "CONTIGUOUS_CIPHERTEXT_VERIFIED")
            self.assertEqual(result["newlyReceivedSegments"], 1)
            again = archive.pull_binlogs(args)
            self.assertEqual(again["newlyReceivedSegments"], 0)
            receipt = Path(args.incoming) / "receipts" / (first.name + ".json")
            receipt.unlink() # crash after final publication but before receipt
            self.assertEqual(archive.pull_binlogs(args)["newlyReceivedSegments"], 0)
            (Path(args.incoming) / first.name / "segment.bin.age").write_bytes(b"changed")
            with self.assertRaises(ValueError):
                archive.pull_binlogs(args)


if __name__ == "__main__":
    unittest.main()
