---
title: "社区团购 — Release Quality Case"
status: IN_REVIEW
version: 1.0.0
last_updated: "2026-08-31"
owner: qa
source_of_truth: project-document-set
---

# Release quality case

## Review control

- Gate ID: QUALITY-RELEASE-EVIDENCE
- Mode: BALANCED
- Reviewer/session: implementation evidence assembled by main_agent; independent QA and Quality Governor decisions must be recorded separately
- Input fingerprint: current worktree and `docs/00-10`
- Evidence references: `evidence/local-gates-2026-08-31.md`, test sources, CI workflow and go-live checklist
- Conclusion: BLOCKED_FOR_PRODUCTION; LOCAL_GATE_PASS_PENDING_FINAL_RERUN

## Claim-evidence map

| Release claim | Behavior evidence | Outcome evidence | Guardrail/operations evidence | Remaining risk | Decision |
|---|---|---|---|---|---|
| Core community flow is internally coherent | API/domain/unit and 11 browser journeys | Local memory/mock behavior | Permission/state matrices and audit | Does not prove live operation | LOCAL PASS |
| Money/stock transitions are deterministic and recoverable in code | Concurrency, refund recovery, allocation, ledger tests | Unique obligations and stage-correct ledger paths | Fixed provider IDs, leases, idempotency | Real MySQL/WeChat not exercised | LOCAL PASS / EXTERNAL BLOCK |
| Notifications do not invent delivery | at-most-once tests, semantic mapping and grouped-consent tests | Manual completion requires external evidence fields | Unknown result does not auto-resend | Approved channel/template reach absent | EXTERNAL BLOCK |
| Periodic work has local duplicate-execution controls | Local non-reentry plus Redis lease implementation and step-boundary loss detection | Integration cases are defined fail-closed but not executed locally | 120s expiring lease; executing-replica readiness degradation | Real Redis/multi-replica behavior is unproved; pilot must remain single-replica | LOCAL GUARDRAIL / EXTERNAL BLOCK |
| Product may scale beyond pilot | None | None | Single JSON aggregate limitation documented | Global lock/full rewrite; no benchmark | REJECTED CLAIM |
| Product is commercially validated | None in repository | None | Bounded-pilot proposal | Demand, repeat and margin unknown | REJECTED CLAIM |
| Production is releasable | Go-live checklist | No production/trial evidence | Mock forbidden and config fail-closed | Multiple P0 external/compliance gates | BLOCKED |

## Adversarial findings

| ID | Unsupported claim or counter-evidence | Severity | Source owner | Required correction/re-entry evidence | Status |
|---|---|---|---|---|---|
| QC-01 | Passing local tests could be misreported as real payment/refund/notification proof | P0 | release owner | Real trial matrix with redacted provider evidence | OPEN |
| QC-02 | Seven integration cases are skipped without supplied MySQL/Redis URLs | P0 | technical/ops | Run with `REQUIRE_INTEGRATION_TESTS=true` against required versions | OPEN |
| QC-03 | Single JSON aggregate has no capacity/SLO evidence | P1 | architecture/ops | 2× pilot peak benchmark, threshold and stop rule | OPEN |
| QC-04 | External客服 channel, deletion/retention and complaint escalation are unapproved | P0 | product/legal/finance | Approved policy plus dry run | OPEN |
| QC-05 | Independent Quality Governor review could not be replaced by implementer judgment | P0 process | main_agent | Independent review of exact final fingerprint | OPEN |

## Decision

- Release recommendation: do not deploy production.
- Explicitly not claimed: business validation, horizontal scalability, legal approval, real WeChat success, backup/restore readiness or production acceptance.
- Monitoring/stop condition: readiness degradation, refund/manual queue growth, any money/stock invariant break, callback signature failure, or capacity threshold breach stops launch/expansion.
- Post-release learning: product owner reviews conversion, repeat, contribution margin, refunds, non-pickup and complaints after each pilot campaign.
- Re-entry condition: all P0 entries in `docs/go-live-issues-and-solutions.md` close, fresh full gates pass, independent QA passes, and Quality Governor approves the exact evidence fingerprint.
