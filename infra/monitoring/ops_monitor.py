#!/usr/bin/env python3
"""Standalone operations monitor with durable, bounded, at-least-once mail delivery."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from email.message import EmailMessage
import fcntl
import json
import os
from pathlib import Path
import re
import smtplib
import ssl
import subprocess
import gzip
import hashlib
import importlib.util
import math
from functools import lru_cache
import tempfile
import time
from urllib.request import Request, urlopen
import uuid

FORMAT = "hometown-ops-monitor-v1"
MAX_QUEUE = 1000
MAX_ATTEMPTS = 5
MAX_DELIVERIES_PER_CYCLE = 2
MAX_PROPAGATION_SECONDS = 900
RETRY_SECONDS = (30, 120, 600, 1800)
EVENTS = {
    "api_unhealthy": ("严重", "后台 API 健康检查失败"),
    "snapshot_stale": ("严重", "数据库快照超过时限或校验失败"),
    "replica_unhealthy": ("严重", "最新快照未完成受限异机加密发布"),
    "binlog_gap": ("严重", "连续 binlog 归档链存在缺口或过期"),
    "business_store_unavailable": ("严重", "退款和通知状态查询失败"),
    "refund_manual": ("需处理", "退款存在待人工处理记录"),
    "refund_unknown": ("需处理", "退款结果未知，需要继续核对"),
    "refund_stale": ("需处理", "退款处理超过监控时限"),
    "notification_manual": ("需处理", "通知存在待人工处理记录"),
    "notification_unknown": ("需处理", "通知提交结果未知"),
    "notification_stale": ("需处理", "通知发送队列超过监控时限"),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".tmp-", dir=path.parent)
    tmp = Path(name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(value, out, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
        dfd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    finally:
        tmp.unlink(missing_ok=True)


def load_state(path: Path) -> dict:
    if path.is_symlink():
        raise ValueError("monitor state must not be a symlink")
    if not path.exists():
        return {"format": FORMAT, "active": {}, "outbox": [], "deadLetters": [], "lastCycleUtc": None}
    if not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("monitor state must be a private regular file")
    value = json.loads(path.read_text(encoding="utf-8"))
    if (value.get("format") != FORMAT or not isinstance(value.get("active"), dict)
            or not isinstance(value.get("outbox"), list) or not isinstance(value.get("deadLetters"), list)):
        raise ValueError("monitor state format is invalid")
    return value


def _event(event_type: str, now: str, incident: str | None = None) -> dict:
    level, label = EVENTS[event_type]
    return {"eventId": str(uuid.uuid4()), "requestId": str(uuid.uuid4()),
            "incidentId": incident or str(uuid.uuid4()), "kind": event_type,
            "transition": "OPEN", "level": level, "label": label,
            "createdAtUtc": now, "attempts": 0, "nextAttemptEpoch": 0,
            "lastFailureType": None}


def conditions(observation: dict, now_epoch: float | None = None) -> dict[str, bool]:
    """Translate aggregate evidence into stable, PII-free active condition keys."""
    result = {}
    if observation.get("api") != "HEALTHY":
        result["api_unhealthy"] = True
    if observation.get("snapshot") != "BACKUP_OK":
        result["snapshot_stale"] = True
    if observation.get("replica") != "CIPHERTEXT_VERIFIED" and not bounded_propagation(observation, "replica", "PENDING"):
        result["replica_unhealthy"] = True
    if observation.get("binlog") != "CONTIGUOUS" and not bounded_propagation(observation, "binlog", "LAGGING"):
        result["binlog_gap"] = True
    metric_names = ("refundManualHold", "refundUnknown", "refundStale",
                    "notificationManual", "notificationUnknown", "notificationStale")
    if any(not isinstance(observation.get(name), int) or observation.get(name) < 0 for name in metric_names):
        result["business_store_unavailable"] = True
        return result
    for name, event in (("refundManualHold", "refund_manual"),
                        ("refundUnknown", "refund_unknown"),
                        ("refundStale", "refund_stale"),
                        ("notificationManual", "notification_manual"),
                        ("notificationUnknown", "notification_unknown"),
                        ("notificationStale", "notification_stale")):
        value = observation.get(name)
        if value:
            result[event] = True
    return result


def transition(state: dict, observation: dict, now: str | None = None) -> list[str]:
    now = now or utc_now()
    current = conditions(observation)
    active = state["active"]
    metric_names = ("refundManualHold", "refundUnknown", "refundStale",
                    "notificationManual", "notificationUnknown", "notificationStale")
    business_unknown = any(not isinstance(observation.get(name), int) or observation.get(name) < 0
                           for name in metric_names)
    if business_unknown:
        # Missing measurements cannot establish recovery; keep each known business incident active.
        for kind in EVENTS:
            if kind.startswith(("refund_", "notification_")) and kind in active:
                current[kind] = True
    emitted = []
    for kind in EVENTS:
        if kind in current and kind not in active:
            event = _event(kind, now)
            active[kind] = {"incidentId": event["incidentId"], "openedAtUtc": now, "requestId": event["requestId"]}
            emitted.append(event["eventId"])
            state["outbox"].append(event)
        elif kind not in current and kind in active:
            incident = active.pop(kind)
            event = _event(kind, now, incident["incidentId"])
            event["transition"] = "RESOLVED"
            event["requestId"] = str(uuid.uuid4())
            event["pairedRequestId"] = incident["requestId"]
            event["label"] = "已恢复：" + EVENTS[kind][1]
            event["level"] = "恢复"
            emitted.append(event["eventId"])
            state["outbox"].append(event)
    if len(state["outbox"]) > MAX_QUEUE:
        raise RuntimeError("monitor outbox is full; preserving existing events")
    state["lastCycleUtc"] = now
    state["lastObservation"] = {key: value for key, value in observation.items()
                                 if key in ("api", "snapshot", "replica", "binlog", "replicaPropagation", "binlogPropagation")
                                 or key in EVENTS}
    return emitted


def load_smtp_config(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        raise ValueError("SMTP configuration is missing or not a regular file")
    if path.stat().st_mode & 0o077 or path.parent.stat().st_mode & 0o077:
        raise ValueError("SMTP configuration and parent directory must be private")
    value = json.loads(path.read_text(encoding="utf-8"))
    required = ("host", "username", "password", "sender", "recipient")
    if any(not isinstance(value.get(key), str) or not value[key] for key in required):
        raise ValueError("SMTP configuration is incomplete")
    if str(value.get("port")) != "587":
        raise ValueError("SMTP port must use STARTTLS port 587")
    return value


def send_event(config: dict, event: dict, smtp_factory=smtplib.SMTP) -> None:
    msg = EmailMessage()
    msg["From"] = config["sender"]
    msg["To"] = config["recipient"]
    msg["Subject"] = f"[{event['level']}] 乡味集运维告警 {event['requestId']}"
    msg["Message-ID"] = f"<{event['eventId']}@alerts.hometown.invalid>"
    msg["X-Request-ID"] = event["requestId"]
    msg.set_content("事件：%s\n状态：%s\n时间：%s\n事件编号：%s\n请求编号：%s\n关联事件：%s\n"
                    % (event["label"], event["transition"], event["createdAtUtc"],
                       event["incidentId"], event["requestId"], event.get("pairedRequestId", "无")))
    with smtp_factory(config["host"], int(config["port"]), timeout=15) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login(config["username"], config["password"])
        refused = smtp.send_message(msg)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)


def deliver(state: dict, config: dict, now_epoch: float | None = None, smtp_factory=smtplib.SMTP) -> dict:
    now_epoch = time.time() if now_epoch is None else now_epoch
    kept = []
    sent = 0
    attempted = 0
    failed = 0
    for event in state["outbox"]:
        if attempted >= MAX_DELIVERIES_PER_CYCLE:
            kept.append(event)
            continue
        if event["nextAttemptEpoch"] > now_epoch:
            kept.append(event)
            continue
        try:
            attempted += 1
            send_event(config, event, smtp_factory)
            sent += 1
        except Exception as exc:
            failed += 1
            event["attempts"] += 1
            event["lastFailureType"] = type(exc).__name__
            if event["attempts"] >= MAX_ATTEMPTS:
                dead = dict(event)
                dead["deadLetteredAtEpoch"] = now_epoch
                state["deadLetters"].append(dead)
            else:
                wait = RETRY_SECONDS[min(event["attempts"] - 1, len(RETRY_SECONDS) - 1)]
                event["nextAttemptEpoch"] = now_epoch + wait
                kept.append(event)
    state["outbox"] = kept
    # Keep bounded history; active incidents and pending outbox entries are never trimmed.
    state["deadLetters"] = state["deadLetters"][-MAX_QUEUE:]
    return {"sent": sent, "failed": failed, "queued": len(kept), "deadLetters": len(state["deadLetters"])}


def defer_pending(state: dict, failure_type: str, now_epoch: float | None = None) -> dict:
    """Apply the same finite retry budget when restricted mail configuration cannot be loaded."""
    now_epoch = time.time() if now_epoch is None else now_epoch
    kept = []
    failed = 0
    for event in state["outbox"]:
        if event["nextAttemptEpoch"] > now_epoch:
            kept.append(event)
            continue
        failed += 1
        event["attempts"] += 1
        event["lastFailureType"] = failure_type
        if event["attempts"] >= MAX_ATTEMPTS:
            dead = dict(event)
            dead["deadLetteredAtEpoch"] = now_epoch
            state["deadLetters"].append(dead)
        else:
            event["nextAttemptEpoch"] = now_epoch + RETRY_SECONDS[min(event["attempts"] - 1, len(RETRY_SECONDS) - 1)]
            kept.append(event)
    state["outbox"] = kept
    state["deadLetters"] = state["deadLetters"][-MAX_QUEUE:]
    return {"sent": 0, "failed": failed, "queued": len(kept), "deadLetters": len(state["deadLetters"]),
            "configurationFailureType": failure_type}


def run_cycle(state_path: Path, observation: dict, smtp_path: Path, sender_factory=smtplib.SMTP,
              now: str | None = None, now_epoch: float | None = None) -> dict:
    state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state_path.parent, 0o700)
    with (state_path.parent / ".monitor.lock").open("a") as lock:
        os.chmod(state_path.parent / ".monitor.lock", 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = load_state(state_path)
        transitions = transition(state, observation, now)
        # Persist incidents before any SMTP transaction. A crash after server
        # acceptance can resend the same Message-ID, but cannot lose the event
        # or mint a new incident on the next run.
        atomic_json(state_path, state)
        try:
            config = load_smtp_config(smtp_path)
            delivery = deliver(state, config, now_epoch, sender_factory)
        except Exception as exc:
            # Never serialize exception text; it can contain hosts or credentials.
            delivery = defer_pending(state, type(exc).__name__, now_epoch)
        atomic_json(state_path, state)
        return {"status": "MONITORED", "requestId": str(uuid.uuid4()), "transitionCount": len(transitions), **delivery}


def mysql_observation(container: str, database: str) -> dict:
    entity_query = """SELECT JSON_OBJECT(
      'refundManualHold',SUM(collection IN ('orderRefunds','partialRefunds') AND record_status='MANUAL_HOLD'),
      'refundUnknown',SUM(collection IN ('orderRefunds','partialRefunds') AND record_status='SUBMISSION_UNKNOWN'),
      'refundStale',SUM(collection IN ('orderRefunds','partialRefunds') AND record_status='PROCESSING' AND created_at < UTC_TIMESTAMP(3)-INTERVAL 30 MINUTE),
      'notificationManual',SUM(collection='notifications' AND record_status='MANUAL_REQUIRED'),
      'notificationUnknown',SUM(collection='notifications' AND record_status='SUBMISSION_UNKNOWN'),
      'notificationStale',SUM(collection='notifications' AND record_status='PENDING_DELIVERY' AND (retry_at < UTC_TIMESTAMP(3)-INTERVAL 30 MINUTE OR (retry_at IS NULL AND created_at < UTC_TIMESTAMP(3)-INTERVAL 30 MINUTE)))
    ) FROM community_entity_records WHERE
      (collection IN ('orderRefunds','partialRefunds') AND record_status IN ('MANUAL_HOLD','SUBMISSION_UNKNOWN','PROCESSING')) OR
      (collection='notifications' AND record_status IN ('MANUAL_REQUIRED','SUBMISSION_UNKNOWN','PENDING_DELIVERY'))"""
    command = ["docker", "exec", "-i", container, "sh", "-c",
               'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names "$@"',
               "mysql", database]
    mode_query = "SELECT COALESCE((SELECT mode FROM community_entity_store_state WHERE id=1),'LEGACY')"
    mode_result = subprocess.run(command, input=mode_query.encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 timeout=15, check=True)
    mode = mode_result.stdout.decode().strip()
    if mode not in ("LEGACY", "PREPARED", "ENTITY"):
        mode = "LEGACY"
    if mode == "ENTITY":
        query = entity_query
    else:
        query = """SELECT JSON_OBJECT(
          'refundManualHold', COALESCE((SELECT COUNT(*) FROM JSON_TABLE(s.payload,'$.orderRefunds[*]' COLUMNS(status VARCHAR(48) PATH '$[1].status')) r WHERE r.status='MANUAL_HOLD'),0) + COALESCE((SELECT COUNT(*) FROM JSON_TABLE(s.payload,'$.partialRefunds[*]' COLUMNS(status VARCHAR(48) PATH '$[1].status')) r WHERE r.status='MANUAL_HOLD'),0),
          'refundUnknown', COALESCE((SELECT COUNT(*) FROM JSON_TABLE(s.payload,'$.orderRefunds[*]' COLUMNS(status VARCHAR(48) PATH '$[1].status')) r WHERE r.status='SUBMISSION_UNKNOWN'),0) + COALESCE((SELECT COUNT(*) FROM JSON_TABLE(s.payload,'$.partialRefunds[*]' COLUMNS(status VARCHAR(48) PATH '$[1].status')) r WHERE r.status='SUBMISSION_UNKNOWN'),0),
          'refundStale', COALESCE((SELECT COUNT(*) FROM JSON_TABLE(s.payload,'$.orderRefunds[*]' COLUMNS(status VARCHAR(48) PATH '$[1].status',createdAt VARCHAR(40) PATH '$[1].createdAt')) r WHERE r.status='PROCESSING' AND STR_TO_DATE(SUBSTRING(r.createdAt,1,19),'%Y-%m-%dT%H:%i:%s') < UTC_TIMESTAMP()-INTERVAL 30 MINUTE),0) + COALESCE((SELECT COUNT(*) FROM JSON_TABLE(s.payload,'$.partialRefunds[*]' COLUMNS(status VARCHAR(48) PATH '$[1].status',createdAt VARCHAR(40) PATH '$[1].createdAt')) r WHERE r.status='PROCESSING' AND STR_TO_DATE(SUBSTRING(r.createdAt,1,19),'%Y-%m-%dT%H:%i:%s') < UTC_TIMESTAMP()-INTERVAL 30 MINUTE),0),
          'notificationManual', COALESCE((SELECT COUNT(*) FROM JSON_TABLE(s.payload,'$.notifications[*]' COLUMNS(status VARCHAR(48) PATH '$[1].status')) n WHERE n.status='MANUAL_REQUIRED'),0),
          'notificationUnknown', COALESCE((SELECT COUNT(*) FROM JSON_TABLE(s.payload,'$.notifications[*]' COLUMNS(status VARCHAR(48) PATH '$[1].status')) n WHERE n.status='SUBMISSION_UNKNOWN'),0),
          'notificationStale', COALESCE((SELECT COUNT(*) FROM JSON_TABLE(s.payload,'$.notifications[*]' COLUMNS(status VARCHAR(48) PATH '$[1].status',createdAt VARCHAR(40) PATH '$[1].createdAt',nextAttemptAt VARCHAR(40) PATH '$[1].nextAttemptAt')) n WHERE n.status='PENDING_DELIVERY' AND STR_TO_DATE(SUBSTRING(COALESCE(n.nextAttemptAt,n.createdAt),1,19),'%Y-%m-%dT%H:%i:%s') < UTC_TIMESTAMP()-INTERVAL 30 MINUTE),0)
        ) FROM community_product_state s WHERE s.id=1"""
    result = subprocess.run(command, input=query.encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=15, check=True)
    data = json.loads(result.stdout.decode().strip())
    return {key: int(data.get(key) or 0) for key in (
        "refundManualHold", "refundUnknown", "refundStale", "notificationManual", "notificationUnknown", "notificationStale")}


def bounded_propagation(observation: dict, name: str, status: str) -> bool:
    detail = observation.get(name + "Propagation")
    if observation.get(name) != status or not isinstance(detail, dict) or detail.get("verifiedSourceBinding") is not True:
        return False
    age, maximum = detail.get("ageSeconds"), detail.get("maxAgeSeconds")
    return (type(age) in (int, float) and math.isfinite(age) and type(maximum) is int
            and 0 < maximum <= MAX_PROPAGATION_SECONDS and 0 <= age <= maximum)


@lru_cache(maxsize=1)
def backup_verifiers():
    """Reuse the frozen ciphertext/chain verifiers; never load or call age."""
    here = Path(__file__).resolve().parent
    # Installed monitor and backup libraries have separate sibling directories.
    roots = (here, here.parent / "hometown-backup", here.parent / "backup")
    root = next((candidate for candidate in roots if (candidate / "binlog_archive.py").is_file()
                 and (candidate / "encrypted_replica.py").is_file()), None)
    if root is None or root.is_symlink() or root.stat().st_uid != os.geteuid() or root.stat().st_mode & 0o022:
        raise ValueError("backup verifier directory is missing or not trusted")
    modules = []
    for name in ("binlog_archive", "encrypted_replica"):
        path = root / (name + ".py")
        if (path.is_symlink() or not path.is_file() or path.stat().st_uid != os.geteuid()
                or path.stat().st_mode & 0o022):
            raise ValueError("installed backup verifier is missing or not a regular file")
        spec = importlib.util.spec_from_file_location("hometown_monitor_" + name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    return tuple(modules)


def publication_age(value: str, now_epoch: float) -> float:
    if not isinstance(value, str):
        raise ValueError("source publication timestamp is missing")
    published = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if published.tzinfo is None:
        raise ValueError("source publication timestamp must include its timezone")
    age = now_epoch - published.timestamp()
    if not math.isfinite(age) or age < 0:
        raise ValueError("source publication timestamp is invalid or in the future")
    return age


def replica_observation(config: dict, receipt: dict, snapshot_ok: bool) -> dict:
    if not snapshot_ok or not receipt or receipt.get("status") != "BACKUP_OK":
        raise ValueError("latest verified source backup is unavailable")
    archive, snapshots = backup_verifiers()
    now = time.time()
    maximum = min(MAX_PROPAGATION_SECONDS, int(config.get("replicaEvidenceMaxAgeSeconds", 900)))
    if maximum <= 0:
        raise ValueError("receiver propagation bound must be positive")
    status_path = Path(config["replicaStatusPath"])
    if (status_path.is_symlink() or not status_path.is_file() or status_path.stat().st_mode & 0o077
            or status_path.stat().st_size > 65536 or status_path.parent.stat().st_mode & 0o077
            or status_path.stat().st_uid != os.geteuid()):
        raise ValueError("receiver evidence must be a private bounded regular file")
    receiver = json.loads(status_path.read_text(encoding="utf-8"))
    checked_age = now - float(receiver.get("checkedAtEpoch", 0))
    if (receiver.get("format") != "hometown-receiver-ciphertext-status-v1"
            or receiver.get("status") != "CIPHERTEXT_VERIFIED" or not 0 <= checked_age <= maximum
            or receiver.get("sourceUuid") != receipt.get("sourceUuid") or receiver.get("database") != config["database"]):
        raise ValueError("receiver evidence is stale or bound to another source")
    export = Path(config["replicaExportDirectory"])
    latest_name = receipt["file"].removesuffix(".sql.gz")
    receiver_file = receiver.get("snapshotFile")
    if not isinstance(receiver_file, str) or not re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}\.sql\.gz", receiver_file):
        raise ValueError("receiver snapshot identity is invalid")
    receiver_name = receiver_file.removesuffix(".sql.gz")
    selected = snapshots.inspect_bundle(export / receiver_name)
    latest = selected if receiver_name == latest_name else snapshots.inspect_bundle(export / latest_name)
    for inspected in (selected, latest):
        source = inspected["manifest"]
        if source.get("database") != config["database"] or source.get("sourceUuid") != receipt.get("sourceUuid"):
            raise ValueError("source snapshot export is bound to another database or UUID")
    for key in ("compressedSha256", "sqlSha256", "snapshotBinlogFile", "snapshotBinlogPosition"):
        if latest["manifest"].get(key) != receipt.get(key) or selected["manifest"].get(key) != receiver.get(key):
            raise ValueError("source receipt/export or receiver snapshot digest/coordinate differs")
    if type(receiver.get("snapshotBinlogPosition")) is not int:
        raise ValueError("receiver snapshot coordinate must be an integer")
    if (receiver.get("snapshotManifestSha256") != selected["manifestSha256"]
            or receiver.get("encryptedSha256") != selected["encryptedSha256"]):
        raise ValueError("receiver snapshot ciphertext or exact source manifest differs")
    observed = {"replica": "CIPHERTEXT_VERIFIED"}
    if receiver_name != latest_name:
        if receiver_name > latest_name:
            raise ValueError("receiver snapshot is ahead of the current source")
        # Use the first still-unreceived source publication, not the newest one.
        # Subsequent source snapshots must never restart the propagation clock.
        pending = []
        for path in sorted(export.iterdir(), key=lambda item: item.name):
            if receiver_name < path.name <= latest_name and re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}", path.name):
                metadata = snapshots.read_bundle_metadata(path)
                source = metadata["manifest"]
                if source.get("sourceUuid") != receipt.get("sourceUuid") or source.get("database") != config["database"]:
                    raise ValueError("pending source snapshot belongs to another source")
                pending.append(publication_age(source.get("exportedAtUtc"), now))
        if not pending:
            raise ValueError("unreceived source snapshot publication is unavailable")
        age = max(pending)
        observed.update(replica="PENDING" if age <= maximum else "FAILED", replicaPropagation={"verifiedSourceBinding": True, "ageSeconds": age,
            "maxAgeSeconds": maximum, "receiverSnapshot": receiver_file, "latestSourceSnapshot": receipt["file"],
            "latestSnapshotVerified": False})
    try:
        observed.update(binlog_observation(config, receipt, receiver, selected, archive, now))
    except Exception:
        observed["binlog"] = "FAILED"
        if observed["replica"] == "PENDING":
            # A prior snapshot is tolerated only with a verified matching source prefix.
            observed["replica"] = "FAILED"
            observed.pop("replicaPropagation", None)
    return observed


def binlog_observation(config: dict, receipt: dict, receiver: dict, selected: dict, archive, now: float) -> dict:
    export = Path(config["replicaExportDirectory"])
    chain = archive.read_object(Path(config["binlogStatusPath"]))
    binlog_root = export / "binlog"
    anchor = archive.read_object(binlog_root / "anchor.json")
    bundles = [path for path in binlog_root.iterdir() if re.fullmatch(r"[0-9a-f]{8}-[A-Za-z0-9_.-]+\.\d{6}", path.name)]
    verified = archive.verify_chain(bundles, anchor, receipt["sourceUuid"], config["database"])
    active_match = re.fullmatch(r"[A-Za-z0-9_.-]+\.(\d{6})", str(chain.get("currentSourceFile")))
    head = verified["headFileIndex"]
    max_chain_age = min(MAX_PROPAGATION_SECONDS, int(config.get("binlogMaxAgeSeconds", 900)))
    if max_chain_age <= 0:
        raise ValueError("binlog propagation bound must be positive")
    source_age = now - float(chain.get("lastPublishedEpoch", 0))
    if (chain.get("status") != "PUBLISHED_CONTIGUOUS" or not isinstance(head, int)
            or chain.get("sourceUuid") != receipt["sourceUuid"] or chain.get("database") != config["database"]
            or type(chain.get("headFileIndex")) is not int or chain["headFileIndex"] != head
            or chain.get("headManifestSha256") != verified["headManifestSha256"]
            or not active_match or int(active_match.group(1)) != head + 1
            or type(chain.get("currentSourcePosition")) is not int or chain["currentSourcePosition"] < 4
            ):
        raise ValueError("source published chain is stale, incomplete, or inconsistent")
    source_segments = {}
    for path in bundles:
        manifest, digest = archive.manifest_digest(path)
        source_segments[manifest["fileIndex"]] = (manifest, digest)
    receiver_head = receiver.get("headFileIndex")
    if type(receiver_head) is not int or receiver_head not in source_segments:
        raise ValueError("receiver head is ahead of or absent from the verified source prefix")
    head_manifest, head_digest = source_segments[receiver_head]
    if (receiver.get("headManifestSha256") != head_digest
            or type(receiver.get("segmentCount")) is not int
            or receiver["segmentCount"] != receiver_head - verified["firstFileIndex"] + 1):
        raise ValueError("receiver verified head digest or prefix length differs")
    snapshot_file = selected["manifest"]["snapshotBinlogFile"]
    snapshot_index = archive.parse_binlog_name(snapshot_file)[1]
    position = selected["manifest"]["snapshotBinlogPosition"]
    segment = source_segments.get(snapshot_index, ({}, ""))[0]
    if (snapshot_index > receiver_head or segment.get("binlogFile") != snapshot_file
            or not segment.get("startPosition", 0) <= position <= segment.get("endPosition", 0)
            or (snapshot_file == anchor["snapshotBinlogFile"] and position == anchor["snapshotBinlogPosition"]
                and selected["manifest"]["sqlSha256"] != anchor.get("snapshotSha256"))):
        raise ValueError("receiver snapshot is not covered by its matching source prefix/root SQL")
    observed = {"binlog": "CONTIGUOUS"}
    if (not 0 <= source_age <= max_chain_age
            or publication_age(verified["headCapturedAtUtc"], now) > max_chain_age):
        observed["binlog"] = "FAILED"
    if receiver_head < head:
        lag_age = publication_age(head_manifest.get("capturedAtUtc"), now)
        observed.update(binlog="LAGGING" if lag_age <= max_chain_age and observed["binlog"] != "FAILED" else "FAILED", binlogPropagation={"verifiedSourceBinding": True, "ageSeconds": lag_age,
            "maxAgeSeconds": max_chain_age, "receiverHeadFileIndex": receiver_head, "sourceHeadFileIndex": head,
            "receiverHeadCapturedAtUtc": head_manifest["capturedAtUtc"], "latestHeadVerified": False})
    return observed


def collect(config: dict) -> dict:
    observation = {}
    try:
        request = Request(config["healthUrl"], headers={"Accept": "application/json", "User-Agent": "hometown-ops-monitor/1"})
        with urlopen(request, timeout=5) as response:
            body = json.loads(response.read(65536))
            observation["api"] = "HEALTHY" if response.status == 200 and body.get("status") in ("ok", "healthy", "HEALTHY") else "FAILED"
    except Exception:
        observation["api"] = "FAILED"
    receipt = None
    backup = Path(config["backupDirectory"])
    for candidate in sorted(backup.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True):
        try:
            value = json.loads(candidate.read_text(encoding="utf-8"))
            receipt = value
            break
        except Exception:
            continue
    backup_max_age = int(config.get("backupMaxAgeSeconds", 93600))
    try:
        filename = receipt.get("file") if receipt else None
        if not isinstance(filename, str) or Path(filename).name != filename or not filename.endswith(".sql.gz"):
            raise ValueError("invalid backup receipt file")
        backup_file = backup / filename
        if (backup_file.is_symlink() or not backup_file.is_file() or receipt.get("status") != "BACKUP_OK"
                or receipt.get("database") != config.get("database")
                or backup_file.stat().st_size != int(receipt.get("sizeBytes", -1))
                or time.time() - backup_file.stat().st_mtime > backup_max_age):
            raise ValueError("latest backup is stale or invalid")
        if receipt.get("compressedSha256") is None or receipt.get("sqlSha256") is None:
            raise ValueError("snapshot receipt omits integrity digests")
        now_epoch = time.time()
        cache_path = Path(config.get("snapshotVerificationCachePath", "/var/lib/hometown-alert/snapshot-verify.json"))
        stat_result = backup_file.stat()
        signature = {"file": filename, "device": stat_result.st_dev, "inode": stat_result.st_ino,
                     "size": stat_result.st_size, "mtimeNs": stat_result.st_mtime_ns, "ctimeNs": stat_result.st_ctime_ns,
                     "compressedSha256": receipt["compressedSha256"], "sqlSha256": receipt["sqlSha256"]}
        interval = int(config.get("snapshotVerificationIntervalSeconds", 300))
        max_compressed = int(config.get("snapshotMaxCompressedBytes", 8 * 1024**3))
        max_sql = int(config.get("snapshotMaxSqlBytes", 64 * 1024**3))
        cached = {}
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8")) if not cache_path.is_symlink() else {}
        except Exception:
            cached = {}
        cache_fresh = (cached.get("signature") == signature
                       and 0 <= now_epoch - float(cached.get("verifiedAtEpoch", 0)) <= interval)
        if not cache_fresh:
            if stat_result.st_size > max_compressed:
                raise ValueError("snapshot exceeds the bounded integrity-verification size")
            verification_started = time.monotonic()
            max_seconds = float(config.get("snapshotVerificationMaxSeconds", 20))
            compressed_hash = hashlib.sha256()
            with backup_file.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    if time.monotonic() - verification_started > max_seconds:
                        raise RuntimeError("snapshot integrity verification exceeded its time budget")
                    compressed_hash.update(chunk)
            sql_hash = hashlib.sha256()
            sql_size = 0
            with gzip.open(backup_file, "rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    if time.monotonic() - verification_started > max_seconds:
                        raise RuntimeError("snapshot integrity verification exceeded its time budget")
                    sql_size += len(chunk)
                    if sql_size > max_sql:
                        raise ValueError("snapshot exceeds the bounded SQL verification size")
                    sql_hash.update(chunk)
            if (compressed_hash.hexdigest() != receipt["compressedSha256"]
                    or sql_hash.hexdigest() != receipt["sqlSha256"]):
                raise ValueError("snapshot digest does not match its receipt")
            after = backup_file.stat()
            if (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                    stat_result.st_dev, stat_result.st_ino, stat_result.st_size, stat_result.st_mtime_ns, stat_result.st_ctime_ns):
                raise RuntimeError("snapshot changed during integrity verification")
            cached = {"signature": signature, "verifiedAtEpoch": now_epoch}
            atomic_json(cache_path, cached)
        observation["snapshot"] = "BACKUP_OK"
    except Exception:
        observation["snapshot"] = "STALE"
    try:
        observation.update(replica_observation(config, receipt, observation["snapshot"] == "BACKUP_OK"))
    except Exception:
        observation["replica"] = "FAILED"
        observation["binlog"] = "FAILED"
    try:
        observation.update(mysql_observation(config["mysqlContainer"], config["database"]))
    except Exception:
        for key in ("refundManualHold", "refundUnknown", "refundStale", "notificationManual", "notificationUnknown", "notificationStale"):
            observation[key] = None
    return observation


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/etc/hometown-alert/monitor.json")
    parser.add_argument("--smtp-config", default="/etc/hometown-alert/smtp.json")
    parser.add_argument("--state-dir", default="/var/lib/hometown-alert")
    parser.add_argument("--input", help="synthetic observation JSON for isolated tests")
    args = parser.parse_args()
    try:
        if args.input:
            observation = json.loads(Path(args.input).read_text(encoding="utf-8"))
        else:
            cfg_path = Path(args.config)
            if cfg_path.is_symlink() or cfg_path.stat().st_mode & 0o077 or cfg_path.parent.stat().st_mode & 0o077:
                raise ValueError("monitor configuration must be a private regular file")
            config = json.loads(cfg_path.read_text(encoding="utf-8"))
            observation = collect(config)
        result = run_cycle(Path(args.state_dir) / "state.json", observation, Path(args.smtp_config))
        print(json.dumps(result, sort_keys=True))
    except Exception as exc:
        print(json.dumps({"status": "FAILED", "errorType": type(exc).__name__, "requestId": str(uuid.uuid4())}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
