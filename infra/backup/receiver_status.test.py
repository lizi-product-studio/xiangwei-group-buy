import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import argparse
import shutil
from unittest.mock import patch
import encrypted_replica as snapshots

import binlog_archive as archive
import receiver_status as receiver

UUID = '2d3a4d54-7a3a-4aa1-992c-87ad8bcf1a31'
DB = 'hometown_sec_b_test'


class ReceiverBindingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.incoming = self.root/'incoming'; self.incoming.mkdir()
        self.binlogs = self.root/'binlogs'; self.binlogs.mkdir()
        self.anchor = {'format':'hometown-binlog-anchor-v1','sourceUuid':UUID,'database':DB,
                       'snapshotBinlogFile':'mysql-bin.000001','snapshotBinlogPosition':157,
                       'snapshotReceiptSha256':'a'*64,'snapshotSha256':'c'*64}
        archive.atomic_json(self.binlogs/'anchor.json',self.anchor)
        segment = self.binlogs/(UUID.replace('-','')[:8]+'-mysql-bin.000001'); segment.mkdir()
        payload = b'synthetic ciphertext stand-in, not an age test'
        (segment/'segment.bin.age').write_bytes(payload)
        manifest = {'format':archive.FORMAT,'sourceUuid':UUID,'database':DB,'binlogFile':'mysql-bin.000001',
                    'fileIndex':1,'startPosition':157,'endPosition':2048,'fileSizeBytes':2048,'rawSha256':'d'*64,
                    'previousManifestSha256':'a'*64,'snapshotReceiptSha256':'a'*64,'capturedAtUtc':archive.utc_now(),
                    'encryptedFile':'segment.bin.age','encryptedSizeBytes':len(payload),'encryptedSha256':hashlib.sha256(payload).hexdigest()}
        encoded=json.dumps(manifest).encode();(segment/'manifest.json').write_bytes(encoded)
        archive.atomic_json(segment/'complete.json',{'format':archive.FORMAT,'manifestSha256':hashlib.sha256(encoded).hexdigest(),'encryptedSha256':manifest['encryptedSha256']})
        self.bundle=self.incoming/'20261010T000000Z-deadbeef';self.bundle.mkdir()
        self.snapshot={'format':'hometown-encrypted-db-replica-v1','sourceFile':self.bundle.name+'.sql.gz',
                       'encryptedFile':self.bundle.name+'.sql.gz.age','database':DB,'sourceUuid':UUID,
                       'snapshotBinlogFile':'mysql-bin.000001','snapshotBinlogPosition':157,
                       'compressedSha256':'b'*64,'sqlSha256':'c'*64,'encryptedSha256':hashlib.sha256(payload).hexdigest(),
                       'encryptedSizeBytes':len(payload),'recipientKeyIds':['e'*64]}
        (self.bundle/self.snapshot['encryptedFile']).write_bytes(payload)
        self.write_snapshot()

    def tearDown(self):self.tmp.cleanup()

    def write_snapshot(self):
        encoded=json.dumps(self.snapshot).encode();(self.bundle/'manifest.json').write_bytes(encoded)
        archive.atomic_json(self.bundle/'complete.json',{'format':self.snapshot['format'],
             'manifestSha256':hashlib.sha256(encoded).hexdigest(),'encryptedSha256':self.snapshot['encryptedSha256'],
             'sourceFile':self.snapshot['sourceFile'],'sourceCompressedSha256':self.snapshot['compressedSha256'],
             'sourceUuid':UUID,'snapshotBinlogFile':self.snapshot['snapshotBinlogFile'],
             'snapshotBinlogPosition':self.snapshot['snapshotBinlogPosition']})

    def test_same_uuid_other_database_and_missing_database_are_rejected(self):
        self.assertEqual(receiver.collect(self.incoming,self.binlogs,UUID,DB)['status'],'CIPHERTEXT_VERIFIED')
        for database in ('hometown_sec_b_other',None):
            self.snapshot['database']=database;self.write_snapshot()
            with self.assertRaisesRegex(ValueError,'database'):receiver.collect(self.incoming,self.binlogs,UUID,DB)

    def test_snapshot_must_fit_verified_chain_and_match_root_when_at_root_position(self):
        for file,position,sql in (('mysql-bin.000001',4000,'c'*64),('mysql-bin.000002',157,'c'*64),('mysql-bin.000001',157,'f'*64)):
            self.snapshot.update(snapshotBinlogFile=file,snapshotBinlogPosition=position,sqlSha256=sql);self.write_snapshot()
            with self.assertRaises(ValueError):receiver.collect(self.incoming,self.binlogs,UUID,DB)

    def test_later_snapshot_may_use_old_chain_anchor(self):
        self.snapshot.update(snapshotBinlogPosition=300,sqlSha256='f'*64);self.write_snapshot()
        self.assertEqual(receiver.collect(self.incoming,self.binlogs,UUID,DB)['snapshotBinlogPosition'],300)

    def test_snapshot_ciphertext_pull_never_reads_age_identity_or_invokes_decryption(self):
        private=self.root/'private';private.mkdir(mode=0o700)
        key=private/'ssh';key.write_text('synthetic SSH placeholder');key.chmod(0o600)
        hosts=private/'known_hosts';hosts.write_text('synthetic fixed host placeholder')
        incoming=self.root/'received'
        args=argparse.Namespace(ciphertext_only=True,incoming=str(incoming),source='reader@example',ssh_identity=str(key),
          known_hosts=str(hosts),expected_uuid=UUID,database=DB,minimum_free_bytes=0)
        def transfer(_args,batch):
            if batch.startswith('ls'):return '/'+self.bundle.name+'\n'
            for line in batch.splitlines():
                _,source,destination=line.split();shutil.copyfile(self.incoming/source.lstrip('/'),destination)
            return ''
        with patch.object(snapshots,'sftp',side_effect=transfer),patch.object(snapshots,'verify',side_effect=AssertionError('must not decrypt')):
            self.assertEqual(snapshots.pull(args)['status'],'REPLICATED')
            self.assertEqual(snapshots.pull(args)['status'],'REPLICATED')
        receipt=json.loads((incoming/'receipts'/(self.bundle.name+'.json')).read_text())
        self.assertEqual(receipt['status'],'CIPHERTEXT_VERIFIED');self.assertFalse(receipt['decryptionPerformed'])
        config=self.root/'config';config.mkdir(mode=0o700)
        for name in ('source.env','ssh_identity','known_hosts'):(config/name).write_text('synthetic')
        status_args=argparse.Namespace(ciphertext_only=True,config_dir=str(config),incoming=str(incoming),receipts=str(incoming/'receipts'),
          expected_uuid=UUID,database=DB,minimum_free_bytes=0,stale_after_hours=26)
        self.assertEqual(snapshots.status(status_args)['status'],'REPLICATED')
        self.assertFalse((config/'age-identity.txt').exists())
        for change in ({'expected_uuid':'5c6619ba-1e0a-4d73-9c2f-dc6a8159376b'},{'database':'other'}):
            with self.assertRaises(ValueError):snapshots.verify_ciphertext(incoming/self.bundle.name,argparse.Namespace(**{**vars(args),**change}))
        payload=incoming/self.bundle.name/self.snapshot['encryptedFile'];payload.write_bytes(bytes([payload.read_bytes()[0]^1])+payload.read_bytes()[1:])
        with self.assertRaises(ValueError):snapshots.verify_ciphertext(incoming/self.bundle.name,args)
        payload.write_bytes((self.bundle/self.snapshot['encryptedFile']).read_bytes())
        (incoming/self.bundle.name/'complete.json').unlink()
        with self.assertRaises(ValueError):snapshots.verify_ciphertext(incoming/self.bundle.name,args)


if __name__ == '__main__':unittest.main()
