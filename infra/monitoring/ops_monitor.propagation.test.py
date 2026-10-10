"""Ciphertext fixtures exercise real frozen verifiers; no age, SMTP or network."""
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import unittest
from unittest.mock import patch

import ops_monitor as monitor

UUID = "2d3a4d54-7a3a-4aa1-992c-87ad8bcf1a31"
METRICS = dict.fromkeys(("refundManualHold", "refundUnknown", "refundStale", "notificationManual", "notificationUnknown", "notificationStale"), 0)


class HealthyAPI:
    status = 200
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self, _): return b'{"status":"ok"}'


class Fixture:
    def __init__(self, root):
        self.root, self.now = root, time.time()
        self.backup, self.export, self.status = root/"backup", root/"export", root/"status"
        for directory in (self.backup, self.export, self.status): directory.mkdir(mode=0o700)
        self.chain_root = self.export/"binlog"
        self.chain_root.mkdir()
        self.receiver_path = self.status/"receiver.json"
        self.chain_path = root/"chain.json"
        self.config = dict(healthUrl="https://synthetic.invalid", backupDirectory=str(self.backup), database="hometown_food",
            mysqlContainer="unused", replicaExportDirectory=str(self.export), replicaStatusPath=str(self.receiver_path),
            binlogStatusPath=str(self.chain_path), snapshotVerificationCachePath=str(root/"cache"/"snapshot.json"))
        self.snapshots, self.segments = {}, {}
        self.root_snapshot = self.snapshot("20261010T000000Z-10000001", 1, 157, 60)
        self.anchor = dict(format="hometown-binlog-anchor-v1", sourceUuid=UUID, database="hometown_food",
            snapshotFile=self.root_snapshot["file"], snapshotSha256=self.root_snapshot["sqlSha256"], snapshotReceiptSha256="a"*64,
            snapshotBinlogFile="mysql-bin.000001", snapshotBinlogPosition=157)
        self.write(self.chain_root/"anchor.json", self.anchor)
        self.segment(1, 20)
        self.receiver(self.root_snapshot["file"], 1)

    def utc(self, age):
        return datetime.fromtimestamp(self.now-age,timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")
    def write(self, path, value):
        path.write_text(json.dumps(value));path.chmod(0o600)
    def snapshot(self, name, index, position, age):
        file=name+".sql.gz";raw=("synthetic SQL "+name).encode();compressed=gzip.compress(raw,mtime=0)
        (self.backup/file).write_bytes(compressed)
        os.utime(self.backup/file,(self.now,self.now))
        receipt=dict(status="BACKUP_OK",file=file,sizeBytes=len(compressed),database="hometown_food",sourceUuid=UUID,
            compressedSha256=hashlib.sha256(compressed).hexdigest(),sqlSha256=hashlib.sha256(raw).hexdigest(),
            snapshotBinlogFile=f"mysql-bin.{index:06d}",snapshotBinlogPosition=position)
        bundle=self.export/name;bundle.mkdir()
        cipher=b"synthetic ciphertext "+name.encode();(bundle/(file+".age")).write_bytes(cipher)
        manifest=dict(format="hometown-encrypted-db-replica-v1",sourceFile=file,encryptedFile=file+".age",
            encryptedSizeBytes=len(cipher),encryptedSha256=hashlib.sha256(cipher).hexdigest(),recipientKeyIds=["1"*64],
            exportedAtUtc=self.utc(age),**{key:receipt[key] for key in ("database","sourceUuid","compressedSha256","sqlSha256","snapshotBinlogFile","snapshotBinlogPosition")})
        self.write(bundle/"manifest.json",manifest)
        manifest_hash=hashlib.sha256((bundle/"manifest.json").read_bytes()).hexdigest()
        self.write(bundle/"complete.json",dict(format=manifest["format"],manifestSha256=manifest_hash,sourceFile=file,
            encryptedSha256=manifest["encryptedSha256"],sourceCompressedSha256=manifest["compressedSha256"],
            **{key:manifest[key] for key in ("sourceUuid","snapshotBinlogFile","snapshotBinlogPosition")}))
        self.write(self.backup/"latest.json",receipt)
        self.snapshots[file]=(receipt,manifest,manifest_hash)
        return receipt
    def segment(self, index, age):
        name=f"{UUID.replace('-','')[:8]}-mysql-bin.{index:06d}";bundle=self.chain_root/name;bundle.mkdir()
        cipher=b"synthetic segment "+str(index).encode();(bundle/"segment.bin.age").write_bytes(cipher)
        previous=self.anchor["snapshotReceiptSha256"] if index==1 else self.segments[index-1][1]
        manifest=dict(format="hometown-binlog-segment-v1",sourceUuid=UUID,database="hometown_food",binlogFile=f"mysql-bin.{index:06d}",
            fileIndex=index,startPosition=157 if index==1 else 4,endPosition=200,fileSizeBytes=200,rawSha256="2"*64,
            encryptedFile="segment.bin.age",encryptedSizeBytes=len(cipher),encryptedSha256=hashlib.sha256(cipher).hexdigest(),
            previousManifestSha256=previous,snapshotReceiptSha256=self.anchor["snapshotReceiptSha256"],capturedAtUtc=self.utc(age))
        self.write(bundle/"manifest.json",manifest);digest=hashlib.sha256((bundle/"manifest.json").read_bytes()).hexdigest()
        self.write(bundle/"complete.json",dict(format=manifest["format"],manifestSha256=digest,encryptedSha256=manifest["encryptedSha256"]))
        self.segments[index]=(manifest,digest,bundle)
        self.write(self.chain_path,dict(status="PUBLISHED_CONTIGUOUS",sourceUuid=UUID,database="hometown_food",headFileIndex=index,
            headManifestSha256=digest,currentSourceFile=f"mysql-bin.{index+1:06d}",currentSourcePosition=158,lastPublishedEpoch=self.now-age))
    def receiver(self, file, head):
        receipt,manifest,digest=self.snapshots[file]
        self.evidence=dict(format="hometown-receiver-ciphertext-status-v1",status="CIPHERTEXT_VERIFIED",database="hometown_food",
            sourceUuid=UUID,snapshotFile=file,snapshotManifestSha256=digest,encryptedSha256=manifest["encryptedSha256"],checkedAtEpoch=self.now,
            headFileIndex=head,headManifestSha256=self.segments[head][1],segmentCount=head,
            **{key:receipt[key] for key in ("compressedSha256","sqlSha256","snapshotBinlogFile","snapshotBinlogPosition")})
        self.write(self.receiver_path,self.evidence)
    def collect(self):
        with patch.object(monitor,"urlopen",return_value=HealthyAPI()),patch.object(monitor,"mysql_observation",return_value=METRICS),patch.object(monitor.time,"time",return_value=self.now):
            return monitor.collect(self.config)


class PropagationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.fixture=Fixture(self.root)
    def tearDown(self): self.temp.cleanup()
    def test_latest_snapshot_and_head_remain_verified(self):
        observed=self.fixture.collect();self.assertEqual(observed["replica"],"CIPHERTEXT_VERIFIED");self.assertEqual(observed["binlog"],"CONTIGUOUS")
        self.assertEqual(monitor.conditions(observed),{})
    def test_normal_verified_prefix_lag_creates_no_incident_or_mail(self):
        self.fixture.segment(2,5);observed=self.fixture.collect()
        self.assertEqual(observed["binlog"],"LAGGING");self.assertFalse(observed["binlogPropagation"]["latestHeadVerified"])
        smtp=self.root/"smtp.json";self.fixture.write(smtp,dict(host="smtp.invalid",port=587,username="synthetic",password="synthetic",sender="ops@example.invalid",recipient="owner@example.invalid"))
        for _ in range(2):
            result=monitor.run_cycle(self.root/"state"/"state.json",observed,smtp,sender_factory=lambda *_args,**_kwargs:self.fail("normal propagation must not call SMTP"))
            self.assertEqual(result["transitionCount"],0);self.assertEqual(result["sent"],0)
        self.assertEqual(json.loads((self.root/"state"/"state.json").read_text())["lastObservation"]["binlog"],"LAGGING")
    def test_fresh_receiver_check_and_new_publications_cannot_hide_stalled_head(self):
        self.fixture.segment(2,5);self.fixture.now+=902;self.fixture.segment(3,0)
        self.fixture.receiver(self.fixture.root_snapshot["file"],1)
        observed=self.fixture.collect();self.assertEqual(observed["binlog"],"FAILED");self.assertEqual(observed["replica"],"CIPHERTEXT_VERIFIED")
        self.assertIn("binlog_gap",monitor.conditions(observed))
    def test_ahead_wrong_digest_missing_segment_and_bad_root_sql_fail(self):
        self.fixture.segment(2,5)
        for change in ({"headFileIndex":3},{"headManifestSha256":"0"*64},{"segmentCount":2},{"snapshotBinlogPosition":201},{"database":"wrong"}):
            with self.subTest(change=change):
                self.fixture.write(self.fixture.receiver_path,{**self.fixture.evidence,**change});self.assertEqual(self.fixture.collect()["binlog"],"FAILED")
        self.fixture.write(self.fixture.receiver_path,self.fixture.evidence)
        self.fixture.write(self.fixture.chain_root/"anchor.json",{**self.fixture.anchor,"snapshotSha256":"0"*64})
        self.assertEqual(self.fixture.collect()["binlog"],"FAILED")
        self.fixture.write(self.fixture.chain_root/"anchor.json",self.fixture.anchor)
        shutil.rmtree(self.fixture.segments[1][2]);self.assertEqual(self.fixture.collect()["binlog"],"FAILED")
    def test_daily_new_snapshot_is_pending_and_publications_do_not_reset_clock(self):
        self.fixture.segment(2,5);self.fixture.snapshot("20261010T000001Z-10000002",2,100,5)
        observed=self.fixture.collect();self.assertEqual(observed["replica"],"PENDING");self.assertEqual(monitor.conditions(observed),{})
        self.assertFalse(observed["replicaPropagation"]["latestSnapshotVerified"])
        self.fixture.now+=902;self.fixture.segment(3,0);self.fixture.snapshot("20261010T000002Z-10000003",3,100,0)
        self.fixture.receiver(self.fixture.root_snapshot["file"],3)
        expired=self.fixture.collect()
        self.assertEqual(expired["replica"],"FAILED");self.assertEqual(expired["binlog"],"CONTIGUOUS")
        self.assertEqual(set(monitor.conditions(expired)),{"replica_unhealthy"})
    def test_new_snapshot_received_is_verified_and_old_cipher_tamper_fails(self):
        self.fixture.segment(2,5);new=self.fixture.snapshot("20261010T000001Z-10000002",2,100,5)
        old=self.fixture.root_snapshot["file"];self.fixture.receiver(new["file"],2)
        self.assertEqual(self.fixture.collect()["replica"],"CIPHERTEXT_VERIFIED")
        self.fixture.receiver(old,1);path=self.fixture.export/old.removesuffix(".sql.gz")/(old+".age")
        data=bytearray(path.read_bytes());data[-1]^=1;path.write_bytes(data)
        self.assertEqual(self.fixture.collect()["replica"],"FAILED")
    def test_pending_is_not_a_generic_healthy_bypass(self):
        self.fixture.segment(2,5);observed=self.fixture.collect()
        for age in (901,-1,float("inf"),True):
            bad={**observed,"binlogPropagation":{**observed["binlogPropagation"],"ageSeconds":age}}
            self.assertIn("binlog_gap",monitor.conditions(bad))
        bad={**observed,"binlogPropagation":{**observed["binlogPropagation"],"verifiedSourceBinding":False}}
        self.assertIn("binlog_gap",monitor.conditions(bad))
    def test_fresh_source_status_cannot_hide_old_equal_head(self):
        self.fixture.now+=902
        chain=json.loads(self.fixture.chain_path.read_text());chain["lastPublishedEpoch"]=self.fixture.now
        self.fixture.write(self.fixture.chain_path,chain);self.fixture.receiver(self.fixture.root_snapshot["file"],1)
        self.assertEqual(self.fixture.collect()["binlog"],"FAILED")
    def test_complete_source_metadata_bound_to_another_database_or_uuid_fails(self):
        file=self.fixture.root_snapshot["file"];bundle=self.fixture.export/file.removesuffix(".sql.gz")
        original=json.loads((bundle/"manifest.json").read_text());complete=json.loads((bundle/"complete.json").read_text())
        for change in ({"database":"another_database"},{"sourceUuid":"1d3a4d54-7a3a-4aa1-992c-87ad8bcf1a31"}):
            changed={**original,**change};self.fixture.write(bundle/"manifest.json",changed)
            updated={**complete,"manifestSha256":hashlib.sha256((bundle/"manifest.json").read_bytes()).hexdigest()}
            if "sourceUuid" in change:updated["sourceUuid"]=change["sourceUuid"]
            self.fixture.write(bundle/"complete.json",updated)
            self.assertEqual(self.fixture.collect()["replica"],"FAILED")
    def test_retained_old_generation_does_not_poison_latest_or_become_current_prefix(self):
        current=self.fixture.root_snapshot
        old=self.fixture.snapshot("20261009T000000Z-10000000",0,157,120)
        self.fixture.write(self.fixture.backup/"latest.json",current)
        self.fixture.receiver(current["file"],1)
        observed=self.fixture.collect()
        self.assertEqual(observed["replica"],"CIPHERTEXT_VERIFIED");self.assertEqual(observed["binlog"],"CONTIGUOUS")
        # Even a current head digest cannot make an old-generation snapshot covered.
        self.fixture.receiver(old["file"],1)
        observed=self.fixture.collect()
        self.assertEqual(observed["replica"],"FAILED");self.assertEqual(observed["binlog"],"FAILED")
        legacy=self.fixture.export/"20261008T000000Z-10000000";legacy.mkdir()
        self.fixture.write(legacy/"manifest.json",{"sourceUuid":None})
        self.fixture.receiver(current["file"],1)
        self.assertEqual(self.fixture.collect()["replica"],"CIPHERTEXT_VERIFIED")
    def test_separate_installed_alert_and_backup_library_layout(self):
        lib=self.root/"usr"/"local"/"lib";alert=lib/"hometown-alert";backup=lib/"hometown-backup"
        alert.mkdir(parents=True);backup.mkdir()
        source=Path(monitor.__file__).resolve();shutil.copy2(source,alert/"ops_monitor.py")
        for name in ("binlog_archive.py","encrypted_replica.py"):shutil.copy2(source.parent.parent/"backup"/name,backup/name)
        monitor.backup_verifiers.cache_clear()
        try:
            with patch.object(monitor,"__file__",str(alert/"ops_monitor.py")):
                self.assertEqual(monitor.backup_verifiers()[0].FORMAT,"hometown-binlog-segment-v1")
                self.assertEqual(self.fixture.collect()["binlog"],"CONTIGUOUS")
        finally:monitor.backup_verifiers.cache_clear()


if __name__ == "__main__": unittest.main()
