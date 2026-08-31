---
title: "社区团购 — Solution Challenge"
status: IN_REVIEW
version: 1.0.0
last_updated: "2026-08-31"
owner: product_auditor
source_of_truth: project-document-set
---

# Solution challenge

## Review control

- Gate ID: QUALITY-SOLUTION
- Mode: BALANCED
- Reviewer/session: product auditor findings incorporated; independent Quality Governor pending
- Input fingerprint: current `docs/00-09`, repository code and product-auditor review
- Evidence references: role/journey matrix, state/permission matrix, PRD, API contract and tests
- Conclusion: PROVISIONAL_PASS_FOR_BOUNDED_PILOT_ONLY
- Selected product lens: minimum operational closure
- Lens selection reason: fulfillment truth, money recovery and pickup authorization matter more than growth features at first launch

## Solution logic

| Assumption ID | Causal mechanism | Strongest alternative | Smallest valuable slice | Friction/failure | Test and falsifier | Decision |
|---|---|---|---|---|---|---|
| SC-01 | Region-scoped campaigns aggregate demand before centralized delivery | Existing commerce marketplace or manual chat group | One district, one point, limited SKUs and one weekly campaign | Requires six roles/actors and disciplined operational entry | Falsified if handling cost/order or exception rate is worse than manual baseline | KEEP AS PILOT |
| SC-02 | Fixed pickup point materially reduces last-mile cost | Home delivery with delivery fee | One immutable point per campaign | Non-pickup and deadline disputes | Measure pickup completion and expired-order refund/loss rate | KEEP WITH HARD DEADLINE |
| SC-03 | Prepayment supports procurement certainty | Deposit/COD | JSAPI paid order with deterministic cancellation/refund | Consumer trust and refund latency | Falsified by poor paid conversion or refund SLA breaches | KEEP ONLY AFTER REAL WECHAT EVIDENCE |
| SC-04 | Internal role split reduces fraud and mistakes | One all-powerful operator | CS accepts, operator decides, finance refunds, point confirms/picks | Staffing burden for a small pilot | Falsified if role separation cannot be staffed; super-admin use exceeds emergency threshold | KEEP; monitor emergency overrides |
| SC-05 | Four templates plus in-app inbox cover seven events | SMS/phone/CRM | Semantic mapping plus grouped consent | Subscribe-message reach is not guaranteed | Real-device delivery matrix; failures require approved external channel evidence | KEEP, EXTERNAL GATE |
| SC-06 | Single JSON aggregate is sufficient initially | Normalized relational model now | Capped pilot with capacity ceiling | Global row lock and full-payload rewrite | Stop expansion when p95/p99, lock wait or payload threshold fails | TEMPORARY; NOT SCALE ARCHITECTURE |

## Adversarial findings

| Finding ID | Counter-evidence | Severity | Required correction | Re-entry evidence | Status |
|---|---|---|---|---|---|
| SC-F01 | Membership, coupon, rating and broad search are not needed to prove the core mechanism | P2 scope | Keep excluded until paid cohort evidence identifies a need | Experiment evidence | CLOSED |
| SC-F02 | Unlimited postponement could hold funds indefinitely | P0 | One postponement maximum; second failure cancels/refunds | API regression test | CLOSED |
| SC-F03 | Notification “manual completed” previously proved only a note, not contact | P0 | Require approved channel, external reference and result | API/UI/E2E evidence plus approved real channel | CODE_CLOSED_EXTERNAL_OPEN |
| SC-F04 | MySQL global aggregate prevents honest horizontal-scale claims | P1 architecture | Cap pilot, benchmark, define normalization trigger | Real MySQL capacity report | OPEN |
| SC-F05 | No demand/unit-economic evidence justifies multi-region rollout | P0 business | Run bounded pilot before expansion | Paid funnel, repeat and margin cohort | OPEN |

## Decision

- Why preferable: it is a coherent end-to-end operational pilot with deterministic money, stock, pickup and exception handling; it is not evidence that a larger platform should exist.
- Scope removed/deferred: membership, coupons, rating, multi-business modes, speculative automation and self-service account deletion without retention rules.
- Remaining accepted experiment risk: consumer demand, supplier reliability, operational staffing and unit economics are unproven.
- Re-entry condition: external gates, capacity threshold, pilot outcome thresholds and independent Quality Governor review are complete.
