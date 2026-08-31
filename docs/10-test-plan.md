---
title: "社区团购 — Test and Acceptance Plan"
status: IN_REVIEW
version: 1.0.0
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
- Required external: real WeChat and production-like backup/restore; local mock cannot close them.

## Defects and risks

| ID | Severity | Failed criterion | Re-entry | Disposition |
|---|---|---|---|---|
| EXT-001 | P0 release | real WeChat/merchant/HTTPS evidence absent | AC-PAY/REFUND/NOTIFY/DEPLOY pass | BLOCKED_AUTH |
| EXT-002 | P0 release | approved external customer contact channel absent | AC-NOTIFY-02 external reference verified | BLOCKED_CONTEXT |
| ENV-001 | P1 release | MySQL 8.4/Redis 7.4 unavailable locally | integration suite no-skip | BLOCKED_ENVIRONMENT |
| ARCH-001 | P1 scale | single JSON global lock | performance baseline + accepted pilot guardrail; normalize before scale | OPEN_GUARDRAIL |
| ARCH-002 | P1 scale | scheduler runs in API | Redis ownership implemented; real integration, lease-expiry/worker observability and independent-worker extraction before scale | PARTIAL_GUARDRAIL |

## Independent QA conclusion

- QA Agent/session: `independent_qa_evidence_audit`, fresh read-only candidate review on 2026-08-31.
- Engineering owner/session: main orchestrator implementation session.
- Conclusion: `BLOCKED` for production; local candidate gates pass but do not prove real provider/data-layer operation.
- Evidence summary: QA confirmed the E2E uses memory/mock and required real MySQL/Redis, migration replay, WeChat/merchant, capacity, recovery and compliance evidence. The canonical AC/traceability documents were completed after its initial snapshot; production blockers remain unchanged.
- Date/baseline versions: 2026-08-31, current worktree; exact commit to be recorded after commit.
