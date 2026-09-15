# Local gate evidence — 2026-08-31

## Candidate scope

- Branch: `codex/audit-remediation`.
- Runtime: Node `v22.22.3`, pnpm `11.16.0` through `/Users/lizi/.local/node/bin`.
- Scope includes refund accounting stage, one-postponement limit, notification semantic/consent closure, manual contact evidence, own service-area-interest rights, multi-item after-sale, Redis reconciliation ownership/readiness, document traceability and release-risk correction.

## Executed gates

| Gate | Result | Evidence |
|---|---|---|
| `pnpm check` | PASS | lint, typecheck, unit tests and all workspace builds completed on final candidate before evidence update |
| Domain tests | PASS | 4 tests |
| API contract tests | PASS | 16 executions (source and built test files), including `NO_RESPONSE` rejection |
| Mini-program tests | PASS | 84 tests, including grouped subscription, multi-SKU claim utilities and page-level multi-line submission |
| Admin tests | PASS | 56 tests |
| API tests | PASS_LOCAL | 69 tests; seven MySQL/Redis cases skipped because URLs were not supplied |
| `pnpm test:e2e` | PASS | 11/11 Chromium journeys in 1.4 minutes; memory store/mock payment by design |
| `pnpm audit --prod --audit-level high` | PASS | no known production dependency vulnerabilities reported at execution time |
| `git diff --check` | PASS | no whitespace errors before final document update; must rerun before commit |
## Independent QA

- Fresh QA agent/session reviewed the candidate read-only and concluded `BLOCKED` for production.
- It confirmed local payment/refund/notification tests are mock evidence, not provider evidence; current MySQL/Redis tests are a deliberately narrow integration surface; external WeChat, migration/run reports, capacity, recovery and compliance evidence remain release gates.
- Some QA observations referenced an earlier document snapshot; the final document set now contains the canonical AC matrix and valid traceability, but its production-blocked conclusion remains correct.

## Explicitly not proven

- MySQL 8.4/Redis 7.4 integration cases and migration replay were not executed on this machine. CI is configured fail-closed and now runs migration twice, but a future CI result is not claimed here.
- No real WeChat login, JSAPI payment, full/partial refund, subscription delivery or external客服 contact was performed.
- No true-device offline/accessibility run, production backup/restore drill, capacity benchmark, legal approval, deployment or production write occurred.
- Browser E2E uses `DATA_STORE=memory` and `PAYMENT_PROVIDER=mock`; it only proves local workflow behavior.

## Release decision

Local candidate gates pass. Production release remains blocked by the P0 items in `docs/go-live-issues-and-solutions.md`, independent Quality Governor review, and the unresolved product-completeness rows. Local success must not be promoted to production approval.
