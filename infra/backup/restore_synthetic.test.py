from pathlib import Path
import hashlib
import json
import tempfile
import unittest
from unittest.mock import patch

import binlog_archive as archive
import restore_synthetic as restore
UUID = "2d3a4d54-7a3a-4aa1-992c-87ad8bcf1a31"
DB = "hometown_food"
ANCHOR_HASH = "a" * 64


def make_bundle(root, name, index, previous, start=157):
    bundle = root / name
    bundle.mkdir()
    raw = b"synthetic mysql row binlog"
    payload = bundle / "segment.bin.age"
    payload.write_bytes(raw)
    cipher_hash = hashlib.sha256(raw).hexdigest()
    manifest = {"format": archive.FORMAT, "sourceUuid": UUID, "database": DB,
                "binlogFile": "mysql-bin.%06d" % index, "fileIndex": index,
                "startPosition": start, "endPosition": 2048, "fileSizeBytes": 2048,
                "rawSha256": hashlib.sha256(b"raw" + raw).hexdigest(),
                "previousManifestSha256": previous, "snapshotReceiptSha256": ANCHOR_HASH,
                "capturedAtUtc": "2026-10-10T00:00:00Z", "encryptedFile": "segment.bin.age",
                "encryptedSha256": cipher_hash, "encryptedSizeBytes": len(raw)}
    encoded = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode()
    (bundle / "manifest.json").write_bytes(encoded)
    (bundle / "complete.json").write_text(json.dumps({"format": archive.FORMAT,
         "manifestSha256": hashlib.sha256(encoded).hexdigest(), "encryptedSha256": cipher_hash}))
    return bundle, hashlib.sha256(encoded).hexdigest()


class SyntheticRecoveryGuardTests(unittest.TestCase):
    def test_only_task_schema_names_are_allowed(self):
        restore.validate_target_name("hometown_sec_b_20261010")
        for name in ("hometown_food", "test", "hometown_sec_b_20261010;DROP", "hometown_sec_b_"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                restore.validate_target_name(name)

    def test_snapshot_can_start_in_middle_of_verified_archive_chain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first, digest1 = make_bundle(root, UUID.replace("-", "")[:8] + "-mysql-bin.000001", 1, ANCHOR_HASH)
            second, digest2 = make_bundle(root, UUID.replace("-", "")[:8] + "-mysql-bin.000002", 2, digest1, start=4)
            third, _ = make_bundle(root, UUID.replace("-", "")[:8] + "-mysql-bin.000003", 3, digest2, start=4)
            selected = restore.select_segments([third, first, second], "mysql-bin.000002", 512,
                                                "mysql-bin.000003", 2048)
            self.assertEqual([item[1]["fileIndex"] for item in selected], [2, 3])
            self.assertEqual(selected[0][1]["binlogFile"], "mysql-bin.000002")

    def test_missing_snapshot_file_or_pit_target_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first, digest1 = make_bundle(root, UUID.replace("-", "")[:8] + "-mysql-bin.000001", 1, ANCHOR_HASH)
            second, _ = make_bundle(root, UUID.replace("-", "")[:8] + "-mysql-bin.000002", 2, digest1, start=4)
            with self.assertRaisesRegex(ValueError, "snapshot binlog segment is missing"):
                restore.select_segments([first, second], "mysql-bin.000003", 4, "mysql-bin.000003", 100)
            with self.assertRaisesRegex(ValueError, "stop file is outside"):
                restore.select_segments([first, second], "mysql-bin.000001", 157, "mysql-bin.000003", 100)
            with self.assertRaisesRegex(ValueError, "beyond"):
                restore.select_segments([first], "mysql-bin.000001", 157, "mysql-bin.000001", 3000)

    def test_snapshot_identity_mismatch_is_not_rewritten_as_a_restore_target(self):
        with self.assertRaisesRegex(ValueError, "task schema"):
            restore.validate_target_name("hometown_food_backup")

    def test_empty_or_incomplete_application_oracle_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "expectedRows.json"
            for rows in ([], [{"collection": "orders", "entityKey": "order", "document": {
                "id":"order", "userId":"user", "pickupPointId":"point", "status":"PAID", "totalCents":100}}]):
                path.write_text(json.dumps(rows))
                with self.assertRaises(ValueError):
                    restore.validate_expected_rows(path)

    def test_legacy_and_prepared_read_actual_map_entries_and_preserve_keys(self):
        payload = {collection: [["key-"+collection, {"id":"id-"+collection, "status":"ACTIVE", "amountCents":123}]]
                   for collection in restore.COLLECTIONS}
        for mode in ("LEGACY", "PREPARED"):
            with patch.object(restore, "_mysql", side_effect=[mode.encode(), json.dumps(payload).encode()]):
                rows = restore.read_target_rows("synthetic", "hometown_sec_b_test")
            self.assertEqual(len(rows), 7)
            for row in rows:
                self.assertEqual(row["entityKey"], "key-"+row["collection"])
                self.assertEqual(row["document"], payload[row["collection"]][0][1])
        for entries in ([{"id":"wrong-array"}], [["dup",{}],["dup",{}]], [42]):
            bad = {"orders":entries}
            with patch.object(restore, "_mysql", side_effect=[b"LEGACY",json.dumps(bad).encode()]):
                with self.assertRaises(ValueError):restore.read_target_rows("synthetic", "hometown_sec_b_test")


if __name__ == "__main__":
    unittest.main()
