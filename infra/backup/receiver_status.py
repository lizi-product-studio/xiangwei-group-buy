#!/usr/bin/env python3
"""Recheck receiver ciphertext and emit bound, fresh facts; never decrypt."""
import argparse
import json
import re
from pathlib import Path
import time

import binlog_archive as archive
import encrypted_replica as snapshots


def collect(incoming: Path, binlogs: Path, expected_uuid: str, database: str) -> dict:
    bundles = [path for path in incoming.iterdir() if path.is_dir() and not path.is_symlink()
               and re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{8}', path.name)]
    if not bundles:
        raise ValueError('receiver has no snapshot bundle')
    latest = sorted(bundles, key=lambda path: path.name)[-1]
    inspected = snapshots.inspect_bundle(latest)
    manifest = inspected['manifest']
    if manifest.get('sourceUuid') != expected_uuid or manifest.get('database') != database:
        raise ValueError('snapshot receiver source UUID or database differs from trust configuration')
    anchor = archive.read_object(binlogs / 'anchor.json')
    segments = [path for path in binlogs.iterdir() if path.is_dir() and not path.is_symlink()
                and re.fullmatch(r'[0-9a-f]{8}-[A-Za-z0-9_.-]+\.\d{6}', path.name)]
    chain = archive.verify_chain(segments, anchor, expected_uuid, database)
    if not segments:
        raise ValueError('receiver has no contiguous binary-log segments')
    selected = binlogs / (expected_uuid.replace('-', '')[:8] + '-' + manifest['snapshotBinlogFile'])
    segment, _ = archive.manifest_digest(selected)
    position = manifest['snapshotBinlogPosition']
    if not segment['startPosition'] <= position <= segment['endPosition']:
        raise ValueError('selected snapshot coordinate is outside its verified archive segment')
    if (manifest['snapshotBinlogFile'] == anchor['snapshotBinlogFile']
            and position == anchor['snapshotBinlogPosition']
            and manifest['sqlSha256'] != anchor.get('snapshotSha256')):
        raise ValueError('selected root snapshot SQL differs from the chain anchor')
    return {'format': 'hometown-receiver-ciphertext-status-v1', 'status': 'CIPHERTEXT_VERIFIED',
            'sourceUuid': expected_uuid, 'database': database,
            'snapshotFile': manifest['sourceFile'], 'snapshotManifestSha256': inspected['manifestSha256'],
            'compressedSha256': manifest['compressedSha256'], 'sqlSha256': manifest['sqlSha256'],
            'encryptedSha256': manifest['encryptedSha256'],
            'snapshotBinlogFile': manifest['snapshotBinlogFile'],
            'snapshotBinlogPosition': manifest['snapshotBinlogPosition'],
            'headFileIndex': chain['headFileIndex'], 'headManifestSha256': chain['headManifestSha256'],
            'segmentCount': chain['segmentCount'], 'checkedAtEpoch': time.time(),
            'verificationBoundary': 'receiver ciphertext hashes and manifest chain only; no decryption'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--incoming', required=True)
    parser.add_argument('--binlogs', required=True)
    parser.add_argument('--expected-uuid', required=True)
    parser.add_argument('--database', required=True)
    args = parser.parse_args()
    try:
        result = collect(Path(args.incoming), Path(args.binlogs), args.expected_uuid, args.database)
        print(json.dumps(result, sort_keys=True))
    except Exception as exc:
        print(json.dumps({'status': 'FAILED', 'errorType': type(exc).__name__}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
