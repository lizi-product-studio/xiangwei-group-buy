import json
import os
from pathlib import Path
import tempfile
import unittest
import gzip
import hashlib
import subprocess
from unittest.mock import patch

import ops_monitor as monitor


class FakeSMTP:
    fail = False
    messages = []
    def __init__(self, host, port, timeout):
        self.host, self.port, self.timeout = host, port, timeout
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def ehlo(self): pass
    def starttls(self, context): pass
    def login(self, username, password): self.username, self.password = username, password
    def send_message(self, message):
        if self.fail: raise OSError("private smtp failure that must never be logged")
        self.messages.append(message)
        return {}


HEALTHY = {"api": "HEALTHY", "snapshot": "BACKUP_OK", "replica": "CIPHERTEXT_VERIFIED", "binlog": "CONTIGUOUS",
           "refundManualHold": 0, "refundUnknown": 0, "refundStale": 0,
           "notificationManual": 0, "notificationUnknown": 0, "notificationStale": 0}


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.state = self.root / "state" / "state.json"
        self.smtp = self.root / "smtp.json"
        self.smtp.write_text(json.dumps({"host": "smtp.invalid", "port": 587, "username": "synthetic",
                                         "password": "never-log-this", "sender": "ops@example.invalid",
                                         "recipient": "owner@example.invalid"}))
        os.chmod(self.smtp, 0o600)
        FakeSMTP.fail = False
        FakeSMTP.messages = []
    def tearDown(self): self.tmp.cleanup()

    def cycle(self, observation, now_epoch, sender=FakeSMTP):
        return monitor.run_cycle(self.state, observation, self.smtp, sender,
                                 now="2026-10-10T00:00:00Z", now_epoch=now_epoch)

    def test_deduplicates_unchanged_incident_and_pairs_recovery(self):
        bad = dict(HEALTHY, binlog="GAP")
        first = self.cycle(bad, 1_000)
        second = self.cycle(bad, 1_001)
        self.assertEqual(first["transitionCount"], 1)
        self.assertEqual(second["transitionCount"], 0)
        state = json.loads(self.state.read_text())
        self.assertEqual(len(state["active"]), 1)
        opened = FakeSMTP.messages[0]
        opening_request_id = opened["X-Request-ID"]
        self.assertTrue(opening_request_id)
        self.assertTrue(opened["Message-ID"].startswith("<"))
        self.cycle(HEALTHY, 1_002)
        state = json.loads(self.state.read_text())
        self.assertFalse(state["active"])
        self.assertEqual(len(FakeSMTP.messages), 2)
        recovery = FakeSMTP.messages[1]
        self.assertIn("[恢复]", recovery["Subject"])
        self.assertNotEqual(recovery["X-Request-ID"], opening_request_id)
        self.assertIn(opening_request_id, recovery.get_content())

    def test_retry_is_bounded_and_error_text_and_secrets_are_not_persisted(self):
        FakeSMTP.fail = True
        bad = dict(HEALTHY, refundUnknown=1)
        self.cycle(bad, 10_000)
        for now in (10_030, 10_150, 10_750, 12_550, 14_350):
            self.cycle(bad, now)
        state_text = self.state.read_text()
        state = json.loads(state_text)
        self.assertEqual(len(state["outbox"]), 0)
        self.assertEqual(len(state["deadLetters"]), 1)
        self.assertEqual(state["deadLetters"][0]["attempts"], monitor.MAX_ATTEMPTS)
        self.assertEqual(state["deadLetters"][0]["lastFailureType"], "OSError")
        self.assertNotIn("never-log-this", state_text)
        self.assertNotIn("private smtp failure", state_text)

    def test_sensitive_or_unrecognized_observation_fails_closed(self):
        observation = dict(HEALTHY, binlog="UNKNOWN", refundStale=None)
        self.cycle(observation, 5_000)
        state = json.loads(self.state.read_text())
        self.assertEqual(set(state["active"]), {"binlog_gap", "business_store_unavailable"})
        self.assertNotIn("password", self.state.read_text().lower())
        self.assertTrue(state["active"]["binlog_gap"]["requestId"])

    def test_smtp_refused_recipient_is_not_counted_as_delivery(self):
        class RefusingSMTP(FakeSMTP):
            def send_message(self, message): return {"owner@example.invalid": (550, b"refused")}
        result = self.cycle(dict(HEALTHY, api="FAILED"), 20_000, RefusingSMTP)
        state = json.loads(self.state.read_text())
        self.assertEqual(result["failed"], 1)
        self.assertEqual(state["outbox"][0]["attempts"], 1)

    def test_crash_after_smtp_acceptance_keeps_same_event_and_message_id(self):
        class CrashAfterAcceptance(FakeSMTP):
            accepted = None
            def send_message(self, message):
                type(self).accepted = message["Message-ID"]
                FakeSMTP.messages.append(message)
                raise SystemExit("simulated process crash after SMTP acceptance")

        bad = dict(HEALTHY, api="FAILED")
        with self.assertRaises(SystemExit):
            self.cycle(bad, 25_000, CrashAfterAcceptance)
        saved = json.loads(self.state.read_text())
        self.assertEqual(len(saved["active"]), 1)
        self.assertEqual(len(saved["outbox"]), 1)
        expected_message_id = f"<{saved['outbox'][0]['eventId']}@alerts.hometown.invalid>"
        self.assertEqual(CrashAfterAcceptance.accepted, expected_message_id)

        self.cycle(bad, 25_001, FakeSMTP)
        retried = FakeSMTP.messages[-1]
        self.assertEqual(retried["Message-ID"], expected_message_id)
        saved = json.loads(self.state.read_text())
        self.assertEqual(len(saved["active"]), 1)
        self.assertEqual(saved["outbox"], [])

    def test_missing_restricted_smtp_configuration_uses_the_bounded_retry_budget(self):
        bad = dict(HEALTHY, api="FAILED")
        self.smtp.write_text("{}")
        for now in (30_000, 30_030, 30_150, 30_750, 32_550):
            result = self.cycle(bad, now)
        state = json.loads(self.state.read_text())
        self.assertEqual(result["configurationFailureType"], "ValueError")
        self.assertEqual(state["outbox"], [])
        self.assertEqual(state["deadLetters"][0]["attempts"], monitor.MAX_ATTEMPTS)

    def test_unknown_business_query_does_not_resolve_any_existing_business_incident(self):
        metric_events = {
            "refundManualHold": "refund_manual", "refundUnknown": "refund_unknown", "refundStale": "refund_stale",
            "notificationManual": "notification_manual", "notificationUnknown": "notification_unknown",
            "notificationStale": "notification_stale",
        }
        for metric, event_kind in metric_events.items():
            with self.subTest(metric=metric):
                state = {"active": {}, "outbox": [], "deadLetters": []}
                opened = dict(HEALTHY)
                opened[metric] = 1
                monitor.transition(state, opened, "2026-10-10T00:00:00Z")
                original = state["active"][event_kind]["requestId"]
                unavailable = dict(HEALTHY)
                for name in metric_events:
                    unavailable[name] = None
                monitor.transition(state, unavailable, "2026-10-10T00:01:00Z")
                self.assertIn(event_kind, state["active"])
                self.assertIn("business_store_unavailable", state["active"])
                self.assertFalse(any(e["kind"] == event_kind and e["transition"] == "RESOLVED" for e in state["outbox"]))
                recovered = dict(HEALTHY)
                monitor.transition(state, recovered, "2026-10-10T00:02:00Z")
                recovery = [e for e in state["outbox"] if e["kind"] == event_kind and e["transition"] == "RESOLVED"]
                self.assertEqual(len(recovery), 1)
                self.assertEqual(recovery[0]["pairedRequestId"], original)

    def test_collector_requires_fresh_receiver_ciphertext_status_for_current_snapshot(self):
        import runpy
        fixture_type = runpy.run_path(str(Path(__file__).with_name("ops_monitor.propagation.test.py")))["Fixture"]
        fixture = fixture_type(self.root)
        status_path = fixture.receiver_path
        evidence = fixture.evidence
        export = fixture.export / fixture.root_snapshot["file"].removesuffix(".sql.gz")
        import time
        with patch.object(monitor, "urlopen", side_effect=OSError), patch.object(monitor, "mysql_observation", side_effect=RuntimeError):
            observed = monitor.collect(fixture.config)
            self.assertEqual(observed["snapshot"], "BACKUP_OK")
            self.assertEqual(observed["replica"], "CIPHERTEXT_VERIFIED")
            for change in ({"checkedAtEpoch": time.time()-901}, {"sourceUuid": "wrong"}, {"snapshotFile": "old.sql.gz"},
                           {"compressedSha256": "0"*64}, {"snapshotManifestSha256": "0"*64}, {"status": "FAILED"}):
                status_path.write_text(json.dumps({**evidence, **change}))
                self.assertEqual(monitor.collect(fixture.config)["replica"], "FAILED")
            (export / "manifest.json").write_text(json.dumps({"database":"wrong", "sourceUuid":evidence["sourceUuid"]}))
            status_path.write_text(json.dumps(evidence))
            self.assertEqual(monitor.collect(fixture.config)["replica"], "FAILED")
            status_path.unlink()
            self.assertEqual(monitor.collect(fixture.config)["replica"], "FAILED")

    def test_same_size_snapshot_tamper_and_invalid_gzip_fail_digest_check(self):
        backup = self.root / "backups"
        backup.mkdir()
        filename = "20261010T000000Z-ab12cd34.sql.gz"
        path = backup / filename
        sql = b"original SQL"
        with gzip.open(path, "wb") as out:
            out.write(sql)
        receipt = {"status": "BACKUP_OK", "file": filename, "sizeBytes": path.stat().st_size,
                   "compressedSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                   "sqlSha256": hashlib.sha256(sql).hexdigest(), "database":"hometown_food"}
        (backup / "receipt.json").write_text(json.dumps(receipt))
        config = {"backupDirectory": str(backup), "database":"hometown_food", "snapshotVerificationCachePath": str(self.root / "cache.json")}
        with patch.object(monitor, "urlopen", side_effect=OSError), patch.object(monitor.subprocess, "run", side_effect=OSError), \
             patch.object(monitor, "mysql_observation", side_effect=RuntimeError):
            self.assertEqual(monitor.collect(config)["snapshot"], "BACKUP_OK")
            data = bytearray(path.read_bytes()); data[-1] ^= 1; path.write_bytes(data)
            # Force a new verification window even if the filesystem's mtime resolution is coarse.
            time = __import__("time")
            time.sleep(0.002)
            self.assertEqual(monitor.collect(config)["snapshot"], "STALE")


if __name__ == "__main__":
    unittest.main()
