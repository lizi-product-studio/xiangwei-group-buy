# TASK-20260908-ISOLATED-SERVER-TEST

This is a test-only environment for the user-designated server `180.76.100.156`.
It is not a production deployment. Use only the dedicated root
`/opt/readiness-test-20260908`; do not copy any old `.env`, production configuration,
database, upload, or backup into its build context. Upload the reviewed source
snapshot into `/opt/readiness-test-20260908/source` without `.git`, `node_modules`,
`.env*`, or unrelated local artifacts. Record source hashes with the test evidence.

The image build needs internet access to install locked dependencies and Chromium.
It uses Debian because Playwright's pinned browser does not support Alpine. Build
before starting the database services; monitor host resources during the build.
The accelerated browser layer keeps TLS and Debian archive signature checks and
allows up to 300 seconds of connection inactivity for Playwright's verified CDN
download because the designated server has a 3 Mbps public link.
No runtime service has a published port or external network. All runtime services
join only the internal `readiness-20260908` network. No Docker socket, host network,
old source directory, or old data volume is mounted.

## Prepare and run

Commands below run on the designated test server after resource review and source
upload. Run phases one at a time; capture each command's exit status and stdout in
the evidence directory without printing the rendered Compose configuration or
credentials. `prepare.mjs` uses exclusive creation and refuses an existing secrets
directory, so it does not rotate credentials on an existing database volume.

```sh
cd /opt/readiness-test-20260908/source
docker run --rm --network none --entrypoint id mysql:8.4 mysql
docker run --rm --network none --entrypoint id redis:7.4-alpine redis
# Set these to the actual numeric UIDs returned above; do not assume a value.
docker run --rm --network none -e READINESS_MYSQL_UID="$READINESS_MYSQL_UID" -e READINESS_REDIS_UID="$READINESS_REDIS_UID" -v /opt/readiness-test-20260908:/opt/readiness-test-20260908 node:22-alpine node /opt/readiness-test-20260908/source/infra/readiness-test/prepare.mjs
docker build -f infra/readiness-test/Dockerfile -t readiness-runner:20260908 .
docker compose --env-file /opt/readiness-test-20260908/secrets/.env -f infra/readiness-test/compose.yaml up -d --wait readiness-mysql readiness-redis
docker compose --env-file /opt/readiness-test-20260908/secrets/.env -f infra/readiness-test/compose.yaml run --rm migrate
docker compose --env-file /opt/readiness-test-20260908/secrets/.env -f infra/readiness-test/compose.yaml exec -T readiness-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot < /run/readiness-grants.sql'
docker compose --env-file /opt/readiness-test-20260908/secrets/.env -f infra/readiness-test/compose.yaml run --rm integration
docker compose --env-file /opt/readiness-test-20260908/secrets/.env -f infra/readiness-test/compose.yaml run --rm e2e
docker compose --env-file /opt/readiness-test-20260908/secrets/.env -f infra/readiness-test/compose.yaml run --rm capacity
```

Before tests, inspect the actual Docker network's `Internal` flag, each container's
network membership, zero published ports, cgroup memory/CPU limits, and lack of
production mounts. Verify outbound HTTPS from the test runner fails. Confirm the
restricted test users cannot update/delete their identity marker or access other
schemas. If any check fails, stop before fixture writes. Existing Docker objects
with the same names must be investigated before reuse; do not attach them silently.

`migrate` runs all migrations twice on the two fresh dedicated schemas. It alone
receives the migrator password. After successful migration, the explicit grants
step gives each runtime user DML on `community_product_state`, read access to
`schema_migrations`, and only SELECT on `capacity_test_identity`. Neither runtime
user can write the marker or create/drop tables. The root password is provided
only to MySQL, not the test runners. Generated credentials remain in mode-0600
files under the mode-0700 secrets directory, outside source and Git. The read-only
MySQL init SQL and Redis configuration mounts are mode 0400 owned by each verified
container UID, so their dropped-privilege entrypoints can read them.

`integration` first validates its exact endpoints and server-side identity marker,
then executes the unchanged `pnpm check` full gate with required real integration
tests. It uses `readiness_integration_20260908` and Redis DB 6. The current migration
unit tests use stubs; this does not invent a live migration-recovery test or claim
that setting a dormant CI variable supplies one. Migration replay has its own
actual database evidence from the preceding phase.

`e2e` executes the unchanged `pnpm test:e2e`. The repository browser gate intentionally
starts memory-backed API and queue services on runner loopback ports 3101/5174.
Its result is a browser workflow result, not a real-MySQL E2E result. Reports/traces
are copied to `/evidence`. Demo auth and mock payment are explicit. No real WeChat
credentials enter runtime; the internal network blocks real provider access.

`capacity` uses only `readiness_capacity_20260908`, Redis DB 5, the closed
`server-isolated-20260908` profile and its immutable marker. The harness supplies
synthetic fixtures and explicit provider stubs. Its JSON output is retained in
`/opt/readiness-test-20260908/evidence/capacity-server.json`.

## Resource limits and interpretation

MySQL is capped at 640 MiB / 0.75 CPU, Redis at 96 MiB / 0.25 CPU, and the normal
runner at 768 MiB / 1 CPU, with no additional swap allowance. The backend override
gives only the full `integration` check a bounded 1280 MiB ceiling and 896 MiB Node
heap: its first 768 MiB attempt completed lint, typecheck and tests, then was
OOM-killed while Vite bundled the admin application. Capacity and E2E retain the
768 MiB ceiling; no resource limit is removed. The server has approximately
3.3 GiB total RAM; check available RAM and disk again immediately before starting.
Do not run multiple runner phases together. Capture container OOM flags, host free
memory, CPU and container stats alongside results. OOM or a failed process is a
failed/uncompleted gate; do not lower coverage, skip failures, or quietly raise
limits. Capacity results are specific to these CPU/memory constraints and cannot
be claimed as production capacity approval.

## Stop / preserve evidence

Use `docker compose ... stop` with the same exact file and env-file to stop only
these named test services. This preserves the uniquely named data volumes and
evidence. There is no cleanup/delete helper. Deleting test volumes or the test
directory requires a separately reviewed exact scope. Passing these tests does
not deploy B to production or authorize real transactions or notifications.
