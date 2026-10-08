from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("encrypted_replica", Path(__file__).with_name("encrypted_replica.py"))
replica = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(replica)


class ReplicaRetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.incoming = self.root / "incoming"
        self.incoming.mkdir(mode=0o700)
        self.receipts = self.incoming / "receipts"
        self.receipts.mkdir(mode=0o700)
        self.keys = self.root / "active-keys.json"
        self.old_key = hashlib.sha256(b"old-recipient").hexdigest()
        self.current_key = hashlib.sha256(b"current-recipient").hexdigest()
        self.keys.write_text(json.dumps([self.old_key, self.current_key]))
        self.ids = []
        start = datetime(2026, 6, 1, tzinfo=timezone.utc)
        for index in range(15):
            self.ids.append(self.add_bundle(start + timedelta(days=index * 7), index))
        self.history_id = self.add_bundle(datetime(2025, 1, 1, tzinfo=timezone.utc), 99, exported="2025-01-01T00:00:00Z")
        (self.incoming / ".pending-in-progress").mkdir()
        (self.incoming / "failed-evidence").mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def add_bundle(self, created: datetime, suffix: int, exported: str | None = None, bundle_root: Path | None = None, write_receipt: bool = True) -> str:
        bundle_id = created.strftime("%Y%m%dT%H%M%SZ") + f"-{suffix:08x}"
        bundle = (bundle_root or self.incoming) / bundle_id
        bundle.mkdir()
        payload = b"synthetic encrypted bytes " + str(suffix).encode()
        payload_name = bundle_id + ".sql.gz.age"
        (bundle / payload_name).write_bytes(payload)
        compressed_hash = hashlib.sha256(b"compressed" + str(suffix).encode()).hexdigest()
        sql_hash = hashlib.sha256(b"sql" + str(suffix).encode()).hexdigest()
        recipient_ids = [self.old_key] if suffix == 0 else [self.current_key]
        manifest = {
            "format": "hometown-encrypted-db-replica-v1",
            "sourceFile": bundle_id + ".sql.gz",
            "createdAtUtc": created.isoformat().replace("+00:00", "Z"),
            "exportedAtUtc": exported or created.isoformat().replace("+00:00", "Z"),
            "retentionEligible": True,
            "compressedSha256": compressed_hash,
            "sqlSha256": sql_hash,
            "encryptedFile": payload_name,
            "recipientKeyIds": recipient_ids,
            "recipientKeyCount": len(recipient_ids),
            "encryptedSizeBytes": len(payload),
            "encryptedSha256": hashlib.sha256(payload).hexdigest(),
        }
        manifest_bytes = (json.dumps(manifest, sort_keys=True) + "\n").encode()
        (bundle / "manifest.json").write_bytes(manifest_bytes)
        manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()
        (bundle / "complete.json").write_text(json.dumps({
            "format": manifest["format"], "manifestSha256": manifest_hash,
            "encryptedSha256": manifest["encryptedSha256"], "sourceFile": manifest["sourceFile"],
            "sourceCompressedSha256": compressed_hash,
        }))
        if write_receipt:
            (self.receipts / f"{bundle_id}.json").write_text(json.dumps({"status": "VERIFIED_CIPHERTEXT_ONLY", "encryptedSha256": manifest["encryptedSha256"], "manifestSha256": manifest_hash}))
        return bundle_id

    def args(self):
        return type("Args", (), {
            "incoming": str(self.incoming),
            "receipts": str(self.receipts),
            "active_key_ids": str(self.keys),
            "managed_after": "2026-01-01T00:00:00Z",
        })()

    def test_dry_run_protects_daily_weekly_latest_key_and_unmanaged_evidence(self):
        plan = replica.retention_plan(self.args())
        protected = {value["bundleId"]: value["reasons"] for value in plan["protected"]}
        self.assertIn("latest-recoverable", protected[self.ids[-1]])
        self.assertIn("last-copy-for-active-key:" + self.old_key, protected[self.ids[0]])
        weekly = [value for value in plan["protected"] if "weekly-4" in value["reasons"]]
        self.assertEqual(len(weekly), 4)
        self.assertEqual(plan["candidateCount"], 7)
        preserved_names = {value["name"] for value in plan["preservedUnmanagedOrUnverified"]}
        self.assertIn(self.history_id, preserved_names)
        self.assertIn(".pending-in-progress", preserved_names)
        self.assertIn("failed-evidence", preserved_names)
        self.assertEqual(plan["mode"], "DRY_RUN")

    def test_apply_requires_unchanged_recent_plan_and_keeps_last_copies(self):
        plan = replica.retention_plan(self.args())
        plan_path = self.root / "plan.json"
        plan_path.write_text(json.dumps(plan))
        apply_args = self.args()
        apply_args.apply_plan = str(plan_path)
        apply_args.max_plan_age_hours = 24
        result = replica.apply_retention_plan(apply_args)
        self.assertEqual(len(result["removed"]), 7)
        self.assertTrue((self.incoming / self.ids[0]).is_dir())
        self.assertTrue((self.incoming / self.ids[-1]).is_dir())
        self.assertTrue((self.incoming / self.history_id).is_dir())
        self.assertTrue((self.incoming / "failed-evidence").is_dir())
        rotation_state = replica.load_rotation_state(self.incoming)
        self.assertEqual(set(rotation_state), {value["bundleId"] for value in plan["candidates"]})

    def test_changed_candidate_digest_blocks_all_deletion(self):
        plan = replica.retention_plan(self.args())
        plan_path = self.root / "plan.json"
        plan_path.write_text(json.dumps(plan))
        candidate = self.incoming / plan["candidates"][0]["bundleId"]
        (candidate / (candidate.name + ".sql.gz.age")).write_bytes(b"tampered")
        apply_args = self.args()
        apply_args.apply_plan = str(plan_path)
        apply_args.max_plan_age_hours = 24
        with self.assertRaises(ValueError):
            replica.apply_retention_plan(apply_args)
        self.assertTrue(candidate.exists())

    def test_future_or_policy_changed_plan_blocks_deletion(self):
        plan = replica.retention_plan(self.args())
        plan_path = self.root / "plan.json"
        plan["generatedAtUtc"] = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        plan_path.write_text(json.dumps(plan))
        apply_args = self.args()
        apply_args.apply_plan = str(plan_path)
        apply_args.max_plan_age_hours = 24
        with self.assertRaises(ValueError):
            replica.apply_retention_plan(apply_args)
        candidate = self.incoming / plan["candidates"][0]["bundleId"]
        self.assertTrue(candidate.exists())

        plan["generatedAtUtc"] = datetime.now(timezone.utc).isoformat()
        plan["policy"]["daily"] = 1
        plan_path.write_text(json.dumps(plan))
        with self.assertRaises(ValueError):
            replica.apply_retention_plan(apply_args)
        self.assertTrue(candidate.exists())

    def test_rotation_then_pull_does_not_refill_expired_bundle_and_keeps_source(self):
        plan = replica.retention_plan(self.args())
        expired_id = plan["candidates"][0]["bundleId"]
        source_root = self.root / "source"
        source_root.mkdir(mode=0o700)
        shutil.copytree(self.incoming / expired_id, source_root / expired_id)
        newest_id = self.add_bundle(datetime(2026, 10, 1, tzinfo=timezone.utc), 200,
                                    bundle_root=source_root, write_receipt=False)

        plan_path = self.root / "plan.json"
        plan_path.write_text(json.dumps(plan))
        apply_args = self.args()
        apply_args.apply_plan = str(plan_path)
        apply_args.max_plan_age_hours = 24
        replica.apply_retention_plan(apply_args)
        self.assertFalse((self.incoming / expired_id).exists())
        self.assertTrue((self.incoming / self.ids[0]).is_dir())
        self.assertTrue((self.incoming / self.ids[-1]).is_dir())
        self.assertTrue((source_root / expired_id).is_dir())

        keys = self.root / "keys"
        keys.mkdir(mode=0o700)
        age_identity = keys / "age-identity"
        ssh_identity = keys / "ssh-identity"
        known_hosts = keys / "known_hosts"
        for path in (age_identity, ssh_identity, known_hosts):
            path.write_text("synthetic")
            path.chmod(0o600)
        pull_args = type("Args", (), {
            "source": "replica-reader@backup-host",
            "incoming": str(self.incoming),
            "identity": str(age_identity),
            "ssh_identity": str(ssh_identity),
            "known_hosts": str(known_hosts),
            "minimum_free_bytes": 0,
        })()

        def fake_sftp(_args, batch):
            if batch == "ls -1 /\n":
                return f"/{expired_id}/\n/{newest_id}/\n"
            for command in batch.splitlines():
                _, remote, local = command.split()
                shutil.copy2(source_root / remote.lstrip("/"), Path(local))
            return ""

        def fake_verify(verify_args):
            inspected = replica.inspect_bundle(Path(verify_args.bundle), getattr(verify_args, "expected_bundle_id", None))
            manifest = inspected["manifest"]
            return {
                "status": "VERIFIED_CIPHERTEXT_ONLY", "sourceFile": manifest["sourceFile"],
                "sqlSha256": manifest["sqlSha256"], "encryptedSha256": inspected["encryptedSha256"],
                "manifestSha256": inspected["manifestSha256"], "plaintextWritten": False,
            }

        with patch.object(replica, "sftp", side_effect=fake_sftp), patch.object(replica, "verify", side_effect=fake_verify):
            result = replica.pull(pull_args)
        self.assertEqual(result["status"], "REPLICATED")
        self.assertEqual(result["rotationSkippedBundleCount"], 1)
        self.assertFalse((self.incoming / expired_id).exists())
        self.assertTrue((self.incoming / newest_id).is_dir())
        self.assertTrue((source_root / expired_id).is_dir())

    def test_latest_status_and_publish_idempotency_fail_closed_on_ciphertext_bitrot(self):
        bundle_id = self.ids[-1]
        bundle = self.incoming / bundle_id
        valid = replica.inspect_bundle(bundle)
        self.assertEqual(replica.existing_publish_result(bundle, bundle_id + ".sql.gz", valid["manifest"]["compressedSha256"])["status"], "ALREADY_PUBLISHED")

        config = self.root / "config"
        config.mkdir(mode=0o700)
        for name in ("source.env", "ssh_identity", "known_hosts", "age-identity.txt"):
            (config / name).write_text("synthetic")
        state_path = self.incoming / "status.json"
        state_path.write_text(json.dumps({"status": "REPLICATED", "latestBundle": bundle_id, "verifiedBundleCount": 1}))
        status_args = type("Args", (), {
            "config_dir": str(config), "incoming": str(self.incoming), "receipts": str(self.receipts),
            "minimum_free_bytes": 0, "stale_after_hours": 26,
        })()
        receipt_path = self.receipts / f"{bundle_id}.json"
        receipt = json.loads(receipt_path.read_text())
        receipt["verifiedAtEpoch"] = time.time()
        receipt_path.write_text(json.dumps(receipt))
        self.assertEqual(replica.status(status_args)["status"], "REPLICATED")

        payload = bundle / valid["manifest"]["encryptedFile"]
        payload.write_bytes(payload.read_bytes() + b"corruption")
        self.assertEqual(replica.status(status_args)["status"], "FAILED")
        with self.assertRaises(ValueError):
            replica.existing_publish_result(bundle, bundle_id + ".sql.gz", valid["manifest"]["compressedSha256"])

    def test_export_directory_requires_expected_owner(self):
        export = self.root / "export"
        export.mkdir(mode=0o750)
        export.chmod(0o2750)
        actual_uid = export.stat().st_uid
        replica.validate_export_directory(export, expected_uid=actual_uid)
        with self.assertRaises(ValueError):
            replica.validate_export_directory(export, expected_uid=actual_uid + 1)

    def test_broken_rotation_state_symlink_fails_closed(self):
        (self.incoming / ".rotation-state.json").symlink_to(self.root / "missing-state.json")
        with self.assertRaises(ValueError):
            replica.load_rotation_state(self.incoming)


class SftpRootListingTest(unittest.TestCase):
    def test_accepts_absolute_and_legacy_bare_root_entries_and_ignores_prompt(self):
        bundle_id = "20260930T120000Z-a1b2c3d4"
        listing = "\n".join((
            "sftp> ls -1 /",
            "/" + bundle_id + "/",
            "20260929T120000Z-01020304",
            "sftp>",
        ))
        self.assertEqual(
            replica.root_bundle_names(listing),
            ["20260929T120000Z-01020304", bundle_id],
        )

    def test_rejects_nested_dot_and_malformed_paths(self):
        valid = "20260930T120000Z-a1b2c3d4"
        listing = "\n".join((
            "/nested/" + valid + "/",
            "/../" + valid + "/",
            "/./" + valid + "/",
            "//" + valid + "/",
            "/" + valid + "//",
            "sftp> /" + valid + "/",
            "Connected to backup-host.",
        ))
        self.assertEqual(replica.root_bundle_names(listing), [])


if __name__ == "__main__":
    unittest.main()
