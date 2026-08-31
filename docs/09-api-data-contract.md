---
title: "社区团购 — API and Data Contract"
status: APPROVED
version: 1.0.0
last_updated: "2026-08-31"
owner: architect
source_of_truth: project-document-set
---

# API and data contract

## APIs and events

| ID | Method/path | Actor | Input / success | Errors / idempotency | Requirement |
|---|---|---|---|---|---|
| API-AUTH | POST `/auth/wechat`, `/auth/admin/*` | USER/staff | token/session | provider/config/credential errors fail closed | REQ-003/013 |
| API-CATALOG | GET public areas/points/campaigns | public | only sale-ready real coverage | unavailable objects return 404, not leaked internals | REQ-001 |
| API-ORDER | POST/GET `/orders` | USER/authorized staff | clientRequestId, fixed snapshots | 409 inventory/state/idempotency conflict | REQ-002 |
| API-PAY | payment create/callback | USER/WeChat | JSAPI params / event result | signature, amount, duplicate event, state race | REQ-003 |
| API-CAMPAIGN | admin create/open/close/postpone/cancel | OPS/ADMIN | schedule/reason/impact | version CAS; one postponement; audit | REQ-004 |
| API-FULFILL | admin delivery/arrival/allocation/pickup | scoped roles | item facts/request ids | cross-point 403, state 409, payload-hash conflict | REQ-005–008 |
| API-QUALITY | quality cases/accept/decide/refund | USER/CS/OPS/FIN | 1–20 unique SKU lines | 24h, quantity, role separation | REQ-009/010 |
| API-REFUND | reconcile/callback/manual queues | FIN/system/WeChat | fixed refund numbers | lease/fence, unknown, retry cap, idempotent ledger | REQ-010 |
| API-NOTIFY | GET/POST preferences/messages; admin retry/manual-complete | USER/CS/OPS | seven event types; manual channel/ref/result | owner check; unknown cannot retry | REQ-011 |
| API-INTEREST | create/list/correct/withdraw; admin status | USER/CS/OPS | privacy version, masked reads | owner 404; processed correction 409; audit | REQ-012 |
| API-ADMIN | staff/settings/audit/finance | internal roles | scoped read/write DTOs | 401/403 without resource leakage | REQ-013 |

## Data models

| Entity | Identifier / invariants | Scope / retention | Migration |
|---|---|---|---|
| User/Staff/Session | id/openid or username; status/permission version | self/internal; session revoked on change | aggregate baseline |
| ServiceArea/PickupPoint | explicit real records; enabled/active state | public filtered; admin global | aggregate baseline |
| Campaign/DeliveryPlan | fixed point after sale; version CAS; postponementCount≤1 | public sale-ready/admin global | optional field defaults 0 |
| Order/OrderLine | snapshots, money cents, quantity invariants | user owner; staff minimal queue | aggregate baseline |
| Payment/Refund/PartialRefund | provider ids unique; recovery state/lease/fence | FIN/system; long-lived audit | aggregate baseline |
| Arrival/Allocation/PickupReceipt | deterministic allocation; idempotent receipt | point scope/ops; dispute evidence | aggregate baseline |
| QualityCase/Exception | unique request; 1–20 items; accounting stage | user/CS/OPS/FIN | optional legacy accounting stage fallback |
| Notification/Preference | unique eventKey; seven semantic types; at-most-once evidence | user/CS/OPS | new manual evidence fields nullable for old records |
| ServiceAreaInterest | owner, consent, status and audit | self; admin masked | retained withdrawal record |
| Ledger/Audit | balanced lines; immutable facts | FIN/admin | aggregate baseline |

## Error contract

| Code/status | Condition | Public behavior | Retry/recovery |
|---|---|---|---|
| VALIDATION_ERROR/400 | malformed/current policy mismatch | field/action message | correct input |
| UNAUTHENTICATED/401 | missing/expired token | clear local identity | login and resume intent |
| FORBIDDEN/403 | role/scope denied | no sensitive details | request correct authority |
| RESOURCE_NOT_FOUND/404 | missing or other-owner object | same response | return to list |
| INVALID_STATE_TRANSITION/409 | stale/consumed/closed action | current-state message | refresh; do not replay blindly |
| CONCURRENT_MODIFICATION/409 | CAS/lock race | retry from fresh state | bounded retry |
| FINANCIAL_INCONSISTENT/500 | ledger/invariant violation | fail transaction | alert/manual investigation |
| provider unknown | external request may have happened | durable UNKNOWN/MANUAL | query fixed id; no new side effect |

## Compatibility

- Public/admin APIs remain under `/api/v1`; additive nullable fields are backward compatible.
- Current JSON aggregate uses lazy defaults for additive fields; no production backfill is claimed.
- Baseline migration is for new empty database only. Any future normalized schema requires numbered migration, dual-read/write or cutover plan, reconciliation and rollback evidence.
