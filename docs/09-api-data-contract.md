---
title: "社区团购 — API and Data Contract"
status: APPROVED
version: 1.2.1
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
| API-PICKUP-LOCATION | POST/PATCH `/admin/pickup-points` | OPERATOR/SUPER_ADMIN | 既有点位字段；触发事件时服务端逆编码、目录路径相容和重复检查 | 409 行政路径不相容/疑似重复；422 不可映射；502/503 fail-closed；不信任浏览器区域字段 | REQ-015/016 |

## Data models

| Entity | Identifier / invariants | Scope / retention | Migration |
|---|---|---|---|
| User/Staff/Session | id/openid or username; status/permission version | self/internal; session revoked on change | aggregate baseline |
| ServiceArea/PickupPoint | explicit real records; enabled/active state | public filtered; admin global | aggregate baseline |
| PickupPoint location (P1 Delta) | `serviceAreaId` is administrative authority; `address` is one display string; `latitude`/`longitude` are GCJ-02. 路径相容不是业务几何边界证明；不持久化 province/city/district、POI id、手工微调或核验状态 | existing public output remains compatible; historical values retained | no migration/backfill |
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
| PICKUP_LOCATION_ADMIN_PATH_MISMATCH/409 | `MAPPED` 的定位目录节点与所选服务区域目录节点路径不相容 | show selected and located administrative paths; retain current form session | move map pin/select correct POI, or restart with correct service area; not a business-boundary claim |
| POSSIBLE_DUPLICATE_PICKUP_LOCATION/409 | same service area has same normalized address or a point within 50m and `confirmDuplicate` is absent | show minimum candidate name/address/distance, never auto-merge | adjust location or explicitly retry with `confirmDuplicate: true` |
| LOCATION_ADMIN_IDENTIFIER_UNMAPPABLE/422 | adapter replied but its raw administrative identifier cannot map to the canonical directory node | distinguish from empty result; retain current form session | choose another location/retry after directory/provider correction; no write |
| LOCATION_VERIFICATION_UNAVAILABLE/502 | approved adapter request timed out/failed | distinguish from empty result; retain current form session | retry; no public-endpoint fallback and no write |
| LOCATION_VERIFICATION_NOT_CONFIGURED/503 | environment has no approved, configured location-verification adapter | show configuration-safe generic message; retain current form session | retry only after authorized configuration; no write |
| FINANCIAL_INCONSISTENT/500 | ledger/invariant violation | fail transaction | alert/manual investigation |
| provider unknown | external request may have happened | durable UNKNOWN/MANUAL | query fixed id; no new side effect |

## Compatibility

- Public/admin APIs remain under `/api/v1`; additive nullable fields are backward compatible.
- Current JSON aggregate uses lazy defaults for additive fields; no production backfill is claimed.
- Baseline migration is for new empty database only. Any future normalized schema requires numbered migration, dual-read/write or cutover plan, reconciliation and rollback evidence.
- **Adapter result / P1 Delta**: adapter receives GCJ-02 coordinates and returns either `MAPPED { coordinateSystem, latitude, longitude, providerAdministrativeId, directoryRegionCode, displayAddress }` or `NOT_CONFIGURED | UNAVAILABLE | UNMAPPABLE`. `providerAdministrativeId` is raw evidence; only the controlled `directoryRegionCode` enters the path comparison. No unapproved public endpoint is a production fallback.
- **PATCH trigger matrix**: create always verifies. PATCH verifies exactly when normalized address differs, either coordinate differs after six-decimal GCJ-02 comparison, or persisted status is INACTIVE and requested status is ACTIVE. If none triggers, the API **MUST ignore** every supplied location field (including a differently formatted but normalized-equivalent `address` and six-decimal-equivalent latitude/longitude), **MUST preserve the exact persisted address, latitude and longitude values**, and **MUST skip** the adapter. No request creates a persistent verification status; `serviceAreaId` remains immutable in PATCH.
- **Path compatibility definition**: a `MAPPED.directoryRegionCode` is administratively compatible exactly when its canonical directory path equals the selected `ServiceArea.regionCode` or descends from it. It is not a physical service boundary predicate. The selector derives displayed province/city/district from the same directory and never submits a second administrative key.
- **Duplicate determinism / additive compatibility**: create may add optional `confirmDuplicate: boolean` (default `false`); PATCH uses it only after a trigger event and excludes the target point. `normalizeAddress` is NFKC, lowercase/case-fold where applicable, trim/collapse all Unicode whitespace, and replaces Chinese/ASCII comma, full stop, semicolon and colon with one separator before trimming separators. Distance is Haversine on persisted GCJ-02 latitude/longitude with Earth radius 6,371,000m. The first 409 and an accepted override both produce audit events containing actor/request, target/candidate IDs, match reason/distance and confirmation flag.
