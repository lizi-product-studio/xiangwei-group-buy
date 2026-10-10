# Hometown operations monitor

`ops_monitor.py` runs independently of the API process once per minute. It probes `/health/ready`, the latest private snapshot receipt and file, encrypted-replica status, the local binlog-chain status document, and aggregate refund/notification recovery states from MySQL. The SQL path follows `community_entity_store_state.mode`; `LEGACY` and `PREPARED` read the document at index 1 of actual Map-entry aggregate JSON, while `ENTITY` reads indexed state columns. It never selects order documents, amounts, identifiers, recipients, customer information, or provider error strings.

Install the Python file and unit files as root-owned files. Create `/etc/hometown-alert` mode 0700 and place a reviewed, non-secret `monitor.json` there with mode 0600. The actual SMTP JSON is a separate 0600 file in that directory and is read only at send time; do not copy it to source control, command arguments, output, or evidence. Leave its host, username, password, sender and recipient to the already provisioned restricted configuration. This implementation accepts STARTTLS port 587 only. It does not send a startup or synthetic message.

The state directory `/var/lib/hometown-alert` is mode 0700. Atomic state replacement and a process lock preserve active incident IDs, request IDs, outbox retries, dead letters and recovery pairing across restarts. Identical ongoing conditions create no extra event. A transition back to healthy queues one recovery event that references the opening request ID. Events contain fixed labels and aggregate conditions only. Logs include only event counts and exception classes, never SMTP exception text or message contents.

Delivery is at-least-once: a process crash after SMTP accepted a message but before the durable state replacement can cause a retry. Message-ID is stable for a queued event; SMTP has no transactional idempotency contract. Failures use delays of 30, 120, 600 and 1800 seconds, then move to a bounded dead-letter list after five attempts. The pending queue is capped at 1000 and fails closed when full rather than deleting undelivered events. Check `systemctl status hometown-ops-monitor.timer hometown-ops-monitor.service`, the state file and journal. A failed external mail path remains visible locally and does not turn into a false delivery success.

The monitor runs as root because the existing MySQL endpoint is container-private and the established backup units use the Docker CLI to obtain it without placing passwords in arguments. Access to Docker is effectively host-root; the unit limits filesystem writes to its state directory and reads to the installed status/configuration roots, but does not reduce Docker daemon authority. Before production activation, verify the existing container name, TLS health URL, unit confinement and the isolated runtime grants. No SMTP delivery, server installation, or continuous 24-hour operation is established by local tests.

Local synthetic checks:

```sh
python3 infra/monitoring/ops_monitor.test.py -v
```

The test injects a fake SMTP object. It does not open a socket or send email.


Stage B snapshot health hashes both compressed bytes and decompressed SQL, verifies gzip, and binds the cache to inode/device/size/mtime/ctime plus both receipt hashes. Checks are cached for 300 seconds by default and bounded by compressed/SQL size and a 20-second verification budget; changed files invalidate the cache. A failed, oversized or timed-out check remains unhealthy.

Replica health uses the private `replicaStatusPath` delivered from the real receiver over a reviewed authenticated channel. The status must be at most 900 seconds old and match the current source snapshot UUID, database, coordinates, compressed/SQL hashes and exact export manifest hash. Binlog health also requires the receiver head to equal the source head. Missing receiver evidence is a failure even when source publication succeeded. `monitor.example.json` uses the HTTPS SAN name and the capture's actual `binlog-local/chain.json` path. Production receiver evidence transport, unit confinement, actual SMTP delivery and timing under network failure remain deployment checks owned by the coordinator.

A query failure retains existing refund/notification incidents and opens a separate store-unavailable incident. An incident resolves only after a successful observation establishes zero. Recovery pairing, retry limits and persisted state remain intact. At most two deliveries are attempted per cycle; the 90-second unit deadline is not a proof that real SMTP outages have been accepted. The external 587/465 connection failures remain open and are not retried by synthetic tests.
