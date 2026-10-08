from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("source_retention", Path(__file__).with_name("source_retention.py"))
retention = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(retention)


class SourceRetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "backups"
        self.export = self.root / "replica-export"
        self.root.mkdir(mode=0o700)
        self.export.mkdir(mode=0o700)
        self.plan_path = Path(self.temp.name) / "reviewed-plan.json"
        self.keys_path = Path(self.temp.name) / "active-keys.json"
        self.old_key = hashlib.sha256(b"old-recipient").hexdigest()
        self.current_key = hashlib.sha256(b"current-recipient").hexdigest()
        self.keys_path.write_text(json.dumps([self.old_key, self.current_key]))
        self.start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.names = []
        for index in range(15):
            keys = [self.old_key] if index == 0 else [self.current_key]
            self.names.append(self.add_snapshot(self.start + timedelta(days=index * 7), index, keys))
        self.old_name = self.add_snapshot(datetime(2025, 1, 1, tzinfo=timezone.utc), 90,
                                          [self.current_key], managed=False)
        self.incomplete_name = self.add_snapshot(self.start + timedelta(days=110), 91,
                                                 [self.current_key], export_bundle=False)
        self.failed_name = self.add_snapshot(self.start + timedelta(days=111), 92,
                                             [self.current_key], receipt_status="BACKUP_FAILED")
        (self.root / ".snapshot-running-job").mkdir()
        (self.export / ".pending-upload").mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def add_snapshot(self, created: datetime, suffix: int, keys: list[str], managed: bool = True,
                     export_bundle: bool = True, receipt_status: str = "BACKUP_OK") -> str:
        stamp = created.strftime("%Y%m%dT%H%M%SZ")
        bundle_id = f"{stamp}-{suffix:08x}"
        name = bundle_id + ".sql.gz"
        source = self.root / name
        sql = (f"synthetic snapshot {suffix}\n".encode()) * 20
        with source.open("wb") as output:
            output.write(gzip.compress(sql, mtime=0))
        compressed_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        sql_hash = hashlib.sha256(sql).hexdigest()
        receipt = {"status": receipt_status, "createdAtUtc": stamp, "file": name,
                   "compressedSha256": compressed_hash, "sqlSha256": sql_hash,
                   "sizeBytes": source.stat().st_size}
        receipt_path = source.with_suffix(".json")
        receipt_path.write_text(json.dumps(receipt, sort_keys=True) + "\n")
        if export_bundle:
            bundle = self.export / bundle_id
            bundle.mkdir()
            encrypted_name = name + ".age"
            cipher = f"synthetic encrypted bytes {suffix}".encode()
            payload = bundle / encrypted_name
            payload.write_bytes(cipher)
            manifest = {"format": retention.BUNDLE_FORMAT, "sourceFile": name,
                        "createdAtUtc": stamp,
                        "exportedAtUtc": (created if managed else datetime(2025, 1, 2, tzinfo=timezone.utc)).isoformat().replace("+00:00", "Z"),
                        "retentionEligible": True, "compressedSha256": compressed_hash,
                        "sqlSha256": sql_hash, "encryptedFile": encrypted_name,
                        "encryptedSha256": hashlib.sha256(cipher).hexdigest(),
                        "encryptedSizeBytes": len(cipher), "recipientKeyCount": len(keys),
                        "recipientKeyIds": keys}
            manifest_bytes = (json.dumps(manifest, sort_keys=True) + "\n").encode()
            (bundle / "manifest.json").write_bytes(manifest_bytes)
            complete = {"format": retention.BUNDLE_FORMAT,
                        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                        "encryptedSha256": manifest["encryptedSha256"],
                        "sourceFile": name, "sourceCompressedSha256": compressed_hash}
            (bundle / "complete.json").write_text(json.dumps(complete, sort_keys=True) + "\n")
        return name

    def args(self):
        return type("Args", (), {"backup_dir": str(self.root.resolve()), "export_dir": str(self.export.resolve()),
                                  "active_key_ids": str(self.keys_path),
                                  "managed_after": "2026-01-01T00:00:00Z",
                                  "max_plan_age_hours": 24, "plan_out": None,
                                  "apply_plan": None})()

    def test_dry_run_protects_retention_points_and_excludes_old_incomplete_and_running(self):
        plan = retention.run(self.args())
        self.assertEqual(plan["mode"], "DRY_RUN")
        self.assertEqual(plan["candidateCount"], 7)
        protected = {item["bundleId"]: item["reasons"] for item in plan["protected"]}
        self.assertIn("latest-recoverable", protected[self.names[-1][:-7]])
        self.assertIn("last-copy-for-active-key:" + self.old_key,
                      protected[self.names[0][:-7]])
        self.assertEqual(sum("weekly-4" in item["reasons"] for item in plan["protected"]), 4)
        preserved_paths = {item["path"] for item in plan["preserved"]}
        self.assertIn(self.old_name, preserved_paths)
        self.assertIn(self.incomplete_name, preserved_paths)
        self.assertIn(self.failed_name, preserved_paths)
        self.assertIn(".snapshot-running-job", preserved_paths)
        self.assertIn("replica-export/.pending-upload", preserved_paths)

    def test_apply_removes_only_exact_reviewed_source_and_export_candidates(self):
        plan = retention.run(self.args())
        self.plan_path.write_text(json.dumps(plan))
        apply_args = self.args()
        apply_args.apply_plan = str(self.plan_path)
        result = retention.run(apply_args)
        self.assertEqual(result["status"], "SOURCE_ROTATION_APPLIED")
        self.assertEqual(len(result["removed"]), 7)
        for removed in result["removed"]:
            self.assertFalse((self.root / removed["bundleId"]).exists())
            self.assertFalse((self.root / (removed["bundleId"] + ".sql.json")).exists())
            self.assertFalse((self.export / removed["bundleId"]).exists())
        self.assertTrue((self.root / self.old_name).exists())
        self.assertTrue((self.root / self.names[0]).exists())
        self.assertTrue((self.root / self.names[-1]).exists())
        self.assertTrue((self.root / self.incomplete_name).exists())
        self.assertTrue((self.export / ".pending-upload").exists())

    def test_changed_gzip_after_dry_run_refuses_all_deletion(self):
        plan = retention.run(self.args())
        self.plan_path.write_text(json.dumps(plan))
        candidate = plan["candidates"][0]
        with (self.root / candidate["backupName"]).open("ab") as changed:
            changed.write(b"changed after review")
        apply_args = self.args()
        apply_args.apply_plan = str(self.plan_path)
        with self.assertRaises(ValueError):
            retention.run(apply_args)
        self.assertTrue((self.root / candidate["backupName"]).exists())
        self.assertTrue((self.export / candidate["exportName"]).exists())

    def test_changed_export_cipher_after_dry_run_refuses_all_deletion(self):
        plan = retention.run(self.args())
        self.plan_path.write_text(json.dumps(plan))
        candidate = plan["candidates"][0]
        payload = self.export / candidate["exportName"] / candidate["encryptedName"]
        payload.write_bytes(payload.read_bytes() + b"post-review mutation")
        apply_args = self.args()
        apply_args.apply_plan = str(self.plan_path)
        with self.assertRaises(ValueError):
            retention.run(apply_args)
        self.assertTrue((self.root / candidate["backupName"]).exists())
        self.assertTrue((self.export / candidate["exportName"]).exists())

    def test_missing_active_key_copy_blocks_apply(self):
        missing_key = hashlib.sha256(b"not-in-any-recipient-list").hexdigest()
        self.keys_path.write_text(json.dumps([missing_key]))
        plan = retention.run(self.args())
        self.assertTrue(plan["blockers"])
        self.plan_path.write_text(json.dumps(plan))
        apply_args = self.args()
        apply_args.apply_plan = str(self.plan_path)
        with self.assertRaises(ValueError):
            retention.run(apply_args)
        self.assertTrue(all((self.root / name).exists() for name in self.names))

    def test_symlink_snapshot_is_preserved_and_target_is_not_followed(self):
        target = Path(self.temp.name) / "outside.sql.gz"
        target.write_bytes(b"outside user data")
        link_name = "20260201T000000Z-deadbeef.sql.gz"
        (self.root / link_name).symlink_to(target)
        plan = retention.run(self.args())
        preserved = {item["path"] for item in plan["preserved"]}
        self.assertIn(link_name, preserved)
        self.assertEqual(target.read_bytes(), b"outside user data")

    def test_plan_root_identity_and_protection_set_are_bound(self):
        plan = retention.run(self.args())
        self.plan_path.write_text(json.dumps(plan))
        plan["roots"]["export"]["inode"] += 1
        self.plan_path.write_text(json.dumps(plan))
        apply_args = self.args()
        apply_args.apply_plan = str(self.plan_path)
        with self.assertRaises(ValueError):
            retention.run(apply_args)
        self.assertTrue(all((self.root / name).exists() for name in self.names))

    def test_active_recipient_change_refuses_reviewed_plan(self):
        plan = retention.run(self.args())
        self.plan_path.write_text(json.dumps(plan))
        self.keys_path.write_text(json.dumps([self.current_key]))
        apply_args = self.args()
        apply_args.apply_plan = str(self.plan_path)
        with self.assertRaises(ValueError):
            retention.run(apply_args)
        self.assertTrue(all((self.root / name).exists() for name in self.names))


if __name__ == "__main__":
    unittest.main()
