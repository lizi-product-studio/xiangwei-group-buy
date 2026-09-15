---
title: "社区团购 — Test and Acceptance Plan"
status: IN_REVIEW
version: 1.2.1
last_updated: "2026-08-31"
owner: qa
source_of_truth: project-document-set
---

# Test and acceptance plan

## Acceptance matrix

| Acceptance ID | Requirement/feature refs | Role/data scope | Given | When | Then | Evidence type/location | Owner | Result |
|---|---|---|---|---|---|---|---|---|
| AC-AREA-01 | REQ-001, FEAT-DISCOVERY | public/USER | empty store | public catalog loads | no default coverage; only real active point areas | API unit `service-area-coverage.test.ts` | QA | PASS_LOCAL |
| AC-ORDER-01 | REQ-002, FEAT-ORDER | USER owner | duplicate/concurrent request | order is created | one reservation/order; other owner 404 | API unit/lifecycle tests | QA | PASS_LOCAL |
| AC-PAY-01 | REQ-003, FEAT-ORDER | USER/WeChat | callback duplicate/race | payment is applied | amount/signature/state/idempotency contract holds | payment concurrency tests; real provider pending | QA | BLOCKED_EXTERNAL |
| AC-CAMPAIGN-01 | REQ-004, FEAT-CAMPAIGN | OPERATOR/system | first and second miss | campaign closes | first postponed; reopened count=1; second cancelled/refund | `p1c-governance.api.test.ts` | QA | PASS_LOCAL |
| AC-LOGISTICS-01 | REQ-005, FEAT-LOGISTICS | OPERATOR/ADMIN | transport draft | edit/dispatch/correct | role, summary, reuse and audit hold | operations browser E2E | QA | PASS_LOCAL |
| AC-ARRIVAL-01 | REQ-006, FEAT-LOGISTICS | point scope | five-role cases | arrival submitted | manager allowed; operator/cross-point denied; admin reason | lifecycle API/E2E | QA | PASS_LOCAL |
| AC-ALLOCATION-01 | REQ-007, FEAT-LOGISTICS | OPERATOR | shortage/damage | draft generated | deterministic; no early pickup/refund | allocation unit/API | QA | PASS_LOCAL |
| AC-PICKUP-01 | REQ-008, FEAT-PICKUP | point/user order | repeat/concurrent/partial/deadline | pickup submitted | bounded/idempotent/exact cutoff | invariants/lifecycle API | QA | PASS_LOCAL |
| AC-CASE-01 | REQ-009, FEAT-AFTERSALE | USER/CS/OPS | multiple eligible SKUs | case submitted/handled | 1–20 lines and 24h/quantity guards | API + mini claim utility tests | QA | PASS_LOCAL |
| AC-REFUND-01 | REQ-010, FEAT-REFUND | FINANCE/system | crash/unknown/late callback | reconcile runs | one obligation/submit/entry; correct accounting stage | payment/ledger tests; provider pending | QA | BLOCKED_EXTERNAL |
| AC-NOTIFY-01 | REQ-011, FEAT-NOTIFY | USER/CS | seven events/four templates | authorize/deliver/manual complete | groups≤3; unknown safe; successful contact evidence required | API/mini/E2E; template/channel pending | QA | BLOCKED_EXTERNAL |
| AC-PRIVACY-01 | REQ-012, FEAT-PRIVACY | USER owner | own/cross-user records | list/correct/withdraw | masked own; other owner 404; audit | `p1c-governance.api.test.ts` + mini UI | QA | PASS_LOCAL_POLICY_BLOCKED |
| AC-AUTH-01 | REQ-013, FEAT-ADMIN-AUTH | all roles | staff/scope changes | old/new requests run | default/scoped pages and old session invalidation | staff/API/browser E2E | QA | PASS_LOCAL |
| AC-DEPLOY-01 | REQ-014, FEAT-DEPLOY | system/ops | empty baseline/config | migrate/start/reconcile | no demo; fail-closed; cross-pool/Redis lease | CI/integration tests; current run pending | QA | BLOCKED_ENVIRONMENT |
| AC-PICKUP-LOC-01 | REQ-015, DR-017 | OPERATOR/SUPER_ADMIN | service areas map to one directory node | open new-point modal and select a service area | readonly path derives from `serviceAreaId`; no independent province/city/district truth exists; test labels result only as administrative-path compatibility | browser + API contract test | QA | PLANNED |
| AC-PICKUP-LOC-02 | REQ-015, DR-018 | OPERATOR/SUPER_ADMIN | deterministic `MAPPED` adapter fixture inside selected administrative path | type address, explicitly select POI and confirm map | GCJ-02 output, raw provider id and normalized directory node are handled at adapter boundary; UI needs no raw coordinates; no claim of physical service-boundary correctness | adapter unit + browser E2E + API test | QA | PLANNED |
| AC-PICKUP-LOC-03 | REQ-015, DR-018 | OPERATOR/SUPER_ADMIN | POI search returns empty and a map/adapter fixture maps a rural pin | select incomplete rural address then point map | input remains; clear fallback is offered; only mapped, administratively compatible output permits save | browser E2E + adapter unit test | QA | PLANNED |
| AC-PICKUP-LOC-04 | REQ-015, DR-018 | OPERATOR/SUPER_ADMIN | adapter yields NOT_CONFIGURED, UNAVAILABLE or UNMAPPABLE | attempt create/change/activate | 503/502/422 differs from empty search; current form session retained; zero location writes and no OSM/public fallback | API error/zero-write + browser E2E | QA | PLANNED |
| AC-PICKUP-LOC-05 | REQ-015, DR-018 | OPERATOR/SUPER_ADMIN | mapped pin has incompatible administrative path | submit create or location-changing patch | API returns `PICKUP_LOCATION_ADMIN_PATH_MISMATCH/409`; UI preserves state and guides correction; test makes no geometric-boundary assertion | API integration + browser E2E | QA | PLANNED |
| AC-PICKUP-LOC-06 | REQ-016, DR-019 | OPERATOR/SUPER_ADMIN | records have no persisted verification marker; fixtures include NFKC/whitespace/Chinese-or-ASCII-punctuation-equivalent address variants, six-decimal-equivalent GCJ-02 coordinate jitter, and a value just across the six-decimal comparison boundary | PATCH address, one coordinate, INACTIVE→ACTIVE, ACTIVE→ACTIVE, ACTIVE→INACTIVE and non-location fields | address/coordinate/INACTIVE→ACTIVE triggers call adapter and fail closed; ACTIVE→ACTIVE, ACTIVE→INACTIVE and non-location patches skip adapter and retain exact address/coords. Normalized-equivalent address or six-decimal-equivalent coordinate input is ignored and persisted original values remain byte/number-identical; just-across-boundary coordinate triggers verification and failure produces zero position write | API regression + browser E2E | QA | PLANNED |
| AC-PICKUP-LOC-07 | REQ-016, DR-020 | OPERATOR/SUPER_ADMIN | same-area candidate, same point PATCH, Chinese/full-width punctuation and spacing fixtures | create/change then confirm duplicate | self is excluded; NFKC normalization and Haversine GCJ-02 distance are deterministic; first candidate and accepted override audit; never auto-merge/delete | unit + API + browser E2E | QA | PLANNED |
| AC-PICKUP-LOC-08 | REQ-015, DR-018 | OPERATOR/SUPER_ADMIN | map tiles or click/drag interaction fails | open form or attempt map confirmation | distinct accessible map-unavailable state preserves only current form session; create/change/activate is disabled and writes zero data | browser E2E + API zero-write test | QA | PLANNED |

## Test levels and environments

| Level | Scope | Environment | Command / procedure | Pass condition |
|---|---|---|---|---|
| lint/type/build/unit | all workspaces | Node 22 / local | `pnpm check` | zero failure/warning; no required skipped test claimed |
| browser E2E | admin + memory API | Chromium | `pnpm test:e2e` | 11+ cases; no unexpected 4xx/5xx/pageerror |
| integration | MySQL 8.4 + Redis 7.4 | isolated empty DB | `REQUIRE_INTEGRATION_TESTS=true ... vitest mysql-redis.integration` | no skip; migration twice; concurrent pools retain both writes; notification lease; reconciliation竞争与失锁检测; Redis healthy |
| performance/concurrency | same integration | representative fixtures | order/refund/notification concurrent workload | record p50/p95/lock wait; guardrail decision |
| WeChat pre-release | trial mini-program/merchant | real credentials, sanitized evidence | login, small payment, full/partial refund, 4-template/7-event messages | every item pass; duplicate callbacks idempotent |
| operations/manual | pre-release | five staff roles + user | `docs/go-live-checklist.md` | signed screenshots/logs with build/time/role |
| backup/rollback | isolated production-like | encrypted backup | restore to new DB; application health and reconciliation | RPO/RTO recorded; no missing financial facts |

## Role and permission coverage

| Role | Default landing | Allowed | Denied/cross-scope | Evidence |
|---|---|---|---|---|
| USER | mini home/profile | own order/message/case/interest | other user objects 404 | API + mini tests |
| PICKUP_MANAGER | point workbench | assigned arrival/pickup | other point and admin pages 403 | role E2E/API |
| OPERATOR | dashboard | catalog/campaign/logistics/decision | arrival submit/finance execute | role E2E/API |
| CUSTOMER_SERVICE | service | accept cases/manual notifications | refund execute/settings | governance E2E/API |
| FINANCE | finance | approved refunds/ledger | operations/config | role E2E/API |
| SUPER_ADMIN | settings | staff/audit/emergency | emergency without reason | staff/arrival E2E/API |

## Recovery coverage

- Payment/refund: submit-before failure, response loss, not-found, timeout, duplicate reconcile, late callback, retry exhaustion/manual hold.
- Notification: malformed provider response, persistent attempt budget, SUBMISSION_UNKNOWN, stale worker, audited manual evidence.
- UI: identity epoch + request generation for data/loading/error; write result retained if refresh fails.
- Transactions: outbox/audit failure rolls back business state; ledger imbalance fails.
- Deployment: missing integration URLs with `REQUIRE_INTEGRATION_TESTS=true` fails rather than skips.

## Regression plan

- Required final suites: `pnpm check`, `pnpm test:e2e`, `git diff --check`.
- Required integration: MySQL 8.4/Redis 7.4 migration and integration suite.
- Required rendered/manual: notification governance fields, multi-item after-sale, own interest correction/withdraw, narrow/mobile viewports.
- Required location tests before accepting REQ-015/016: deterministic provider-neutral adapter fixtures for GCJ-02/WGS84 conversion, raw-id→directory mapping, `MAPPED/NOT_CONFIGURED/UNAVAILABLE/UNMAPPABLE`, administrative path compatibility (not geometry), POI explicit selection/no automatic first result, search/map/reverse failures, current-session-only recovery, no-write fail-closed, PATCH trigger matrix, legacy preservation, duplicate self exclusion/NFKC punctuation/space normalization/Haversine/audit and keyboard/screen-reader location status. Network calls or a production Key are not test prerequisites.
- Required external: real WeChat and production-like backup/restore; local mock cannot close them.

## Defects and risks

| ID | Severity | Failed criterion | Re-entry | Disposition |
|---|---|---|---|---|
| EXT-001 | P0 release | real WeChat/merchant/HTTPS evidence absent | AC-PAY/REFUND/NOTIFY/DEPLOY pass | BLOCKED_AUTH |
| EXT-002 | P0 release | approved external customer contact channel absent | AC-NOTIFY-02 external reference verified | BLOCKED_CONTEXT |
| ENV-001 | P1 release | MySQL 8.4/Redis 7.4 unavailable locally | integration suite no-skip | BLOCKED_ENVIRONMENT |
| ARCH-001 | P1 scale | single JSON global lock | performance baseline + accepted pilot guardrail; normalize before scale | OPEN_GUARDRAIL |
| ARCH-002 | P1 scale | scheduler runs in API | Redis ownership implemented; real integration, lease-expiry/worker observability and independent-worker extraction before scale | PARTIAL_GUARDRAIL |
| LOC-001 | P1 release evidence | real map/POI coverage for the intended rural service area is unproven | pre-release samples cover search, map pin, reverse, cross-area refusal and customer-visible address | BLOCKED_EXTERNAL |
| LOC-002 | P1 implementation boundary | administrative path compatibility does not prove actual delivery boundary, correct doorplate or reachability | keep residual-risk wording; stop and re-route if ServiceArea is custom/overlapping/non-directory-aligned | BLOCKING_UNKNOWN |

## Independent QA conclusion

- QA Agent/session: `independent_qa_evidence_audit`, fresh read-only candidate review on 2026-08-31.
- Engineering owner/session: main agent implementation session.
- Conclusion: `BLOCKED` for production; local candidate gates pass but do not prove real provider/data-layer operation.
- Evidence summary: QA confirmed the E2E uses memory/mock and required real MySQL/Redis, migration replay, WeChat/merchant, capacity, recovery and compliance evidence. The canonical AC/traceability documents were completed after its initial snapshot; production blockers remain unchanged.
- Date/baseline versions: 2026-08-31, current worktree; exact commit to be recorded after commit.
