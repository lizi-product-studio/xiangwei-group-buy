---
title: "社区团购 — Role, Page, Feature, and Operations Matrices"
status: APPROVED
version: 1.1.0
last_updated: "2026-08-31"
owner: product_auditor
source_of_truth: project-document-set
---

# Role and journey matrices

## Role-page matrix

| Role ID | Surface/client | Page ID | Page/name | Entry point | Primary task | Permission ref | Requirement refs |
|---|---|---|---|---|---|---|---|
| USER | 微信小程序 | PAGE-MINI-HOME | 首页/区域/点位 | 小程序首页 | 选择真实覆盖和团期 | PERM-USER | REQ-001 |
| USER | 微信小程序 | PAGE-MINI-CHECKOUT | 团期/购物车/结算 | 团期详情 | 下单并发起支付 | PERM-USER | REQ-002, REQ-003 |
| USER | 微信小程序 | PAGE-MINI-ORDERS | 订单/详情/领取 | 我的订单 | 查看履约并领取 | PERM-USER | REQ-008 |
| USER | 微信小程序 | PAGE-MINI-SERVICE | 消息/售后/意向/法律 | 我的服务 | 通知、售后和数据权利 | PERM-USER | REQ-009, REQ-011, REQ-012 |
| PICKUP_MANAGER | Web | PAGE-POINT-WORKBENCH | 我的点位工作台 | 登录默认页 | 本点到货和核销 | PERM-PICKUP | REQ-006, REQ-008 |
| OPERATOR | Web | PAGE-OPS-CONTROL | 团期/配送/配置 | 运营工作台 | 团期、运输与差异处理 | PERM-OPS | REQ-004, REQ-005, REQ-007 |
| OPERATOR | Web | PAGE-GOVERNANCE | 区域意向治理 | 运营治理 | 推进区域意向，不接触通知人工队列 | PERM-OPS | REQ-012 |
| CUSTOMER_SERVICE | Web | PAGE-GOVERNANCE | 售后与治理 | 客服默认页 | 受理售后和通知证据 | PERM-CS | REQ-009, REQ-011, REQ-012 |
| FINANCE | Web | PAGE-FINANCE | 财务/账本 | 财务默认页 | 执行批准退款 | PERM-FIN | REQ-010 |
| SUPER_ADMIN | Web | PAGE-SECURITY | 设置/员工/审计 | 设置默认页 | 权限、审计和生产约束 | PERM-ADMIN | REQ-013, REQ-014 |

## Page-feature matrix

| Page ID | Feature ID | Feature/action | Primary/secondary | Feedback | Error/recovery | Backend dependency | Requirement refs |
|---|---|---|---|---|---|---|---|
| PAGE-MINI-HOME | FEAT-DISCOVERY | 真实区域/点位/团期发现 | Primary | 覆盖与可售状态 | 空覆盖转意向；失败重试 | public catalog/service areas | REQ-001 |
| PAGE-MINI-CHECKOUT | FEAT-ORDER | 固定点位下单和微信支付 | Primary | 订单/支付真实状态 | 库存冲突、取消和登录恢复 | order/payment | REQ-002, REQ-003 |
| PAGE-MINI-ORDERS | FEAT-PICKUP | 取货码、分次领取和截止 | Primary | 已领/剩余/截止 | 跨点、错码、重复、逾期 | fulfillment | REQ-008 |
| PAGE-MINI-SERVICE | FEAT-AFTERSALE | 多商品品质售后 | Primary | 案件/退款状态 | 24h、数量、重复错误 | quality cases | REQ-009 |
| PAGE-MINI-SERVICE | FEAT-NOTIFY | 站内消息与分组订阅 | Primary | 授权进度和站内消息 | 拒绝仍保留站内；失败进人工 | notification/outbox | REQ-011 |
| PAGE-MINI-SERVICE | FEAT-PRIVACY | 开通意向查看/更正/撤回 | Secondary | 脱敏记录和状态 | 已处理转客服；保留例外 | interest/audit | REQ-012 |
| PAGE-OPS-CONTROL | FEAT-CAMPAIGN | 开售、截单、一次顺延、取消 | Primary | 影响预览和状态 | 二次失败取消退款 | campaign/refund obligation | REQ-004 |
| PAGE-OPS-CONTROL | FEAT-LOGISTICS | 运输、到货与差异确认 | Primary | 责任/超时/草案 | 草稿复用、紧急原因、幂等 | fulfillment | REQ-005, REQ-006, REQ-007 |
| PAGE-POINT-WORKBENCH | FEAT-PICKUP | 本点到货和分次核销 | Primary | 到货事实/领取凭证 | 跨点拒绝、重复幂等 | scoped fulfillment | REQ-006, REQ-008 |
| PAGE-GOVERNANCE | FEAT-AFTERSALE | 客服受理和运营决定 | Primary | 职责分离状态 | 原因必填、刷新恢复 | quality/cancellation | REQ-009 |
| PAGE-GOVERNANCE | FEAT-NOTIFY | 人工通知证据 | Primary | 渠道/引用/结果 | 未联系成功不可完成 | notification/audit | REQ-011 |
| PAGE-GOVERNANCE | FEAT-PRIVACY | 区域意向推进 | Secondary | 联系/关闭状态 | 数据脱敏、状态冲突 | interest/audit | REQ-012 |
| PAGE-FINANCE | FEAT-REFUND | 执行批准退款和查账 | Primary | 固定退款号/分录 | unknown、退避、人工挂起 | payment/refund/ledger | REQ-010 |
| PAGE-SECURITY | FEAT-ADMIN-AUTH | 员工生命周期和审计 | Primary | 当前角色/点位 | 旧会话失效、敏感原因 | auth/audit | REQ-013 |
| PAGE-SECURITY | FEAT-DEPLOY | 生产配置和健康门禁 | Secondary | readiness/配置错误 | 缺真实依赖拒启动 | config/MySQL/Redis/WeChat | REQ-014 |

## Front-office/back-office matrix

| Feature ID | Front-office action | Backend/admin module or system handler | Business object | State transition | Operator/system actor | User feedback | Audit/log | Failure/recovery | Requirement refs |
|---|---|---|---|---|---|---|---|---|---|
| FEAT-DISCOVERY | 选择区域点位 | public catalog filter | ServiceArea/PickupPoint | unavailable→interest only | system | 可售或未覆盖 | config audit | 空/重试 | REQ-001 |
| FEAT-ORDER | 下单支付 | order/payment services | Order/Inventory | PENDING_PAYMENT→PAID_WAITING_CLOSE | USER/WeChat | 支付与订单状态 | payment event | 幂等/验签/冲突 | REQ-002, REQ-003 |
| FEAT-CAMPAIGN | 截单/顺延 | campaign service | Campaign | OPEN→LOCKED/POSTPONED/CANCELLED | OPERATOR/system | 新时间或退款 | outbox/audit | 最多一次顺延 | REQ-004 |
| FEAT-LOGISTICS | 发车/到货/差异 | fulfillment services | Delivery/Allocation | DRAFT→DISPATCHED→ARRIVED | OPERATOR/PICKUP_MANAGER | 到货/差异状态 | scope/reason audit | 草稿/幂等/复算 | REQ-005, REQ-006, REQ-007 |
| FEAT-PICKUP | 六码领取 | fulfillment service | OrderLine/Receipt | ready→partial/completed | PICKUP_MANAGER | 已领与剩余 | request digest | 截止/跨点/重放 | REQ-008 |
| FEAT-AFTERSALE | 多行品质申诉 | quality workflow | QualityCase | REGISTERED→ACCEPTED→decision | USER/CS/OPS | 案件/退款进度 | actor/reason | 24h/数量边界 | REQ-009 |
| FEAT-REFUND | 执行退款 | payment reconciler | Refund/Ledger | pending→provider/manual/succeeded | FINANCE/system | 退款状态 | fixed id/ledger | lease/query/retry | REQ-010 |
| FEAT-NOTIFY | 授权/人工恢复 | notification outbox | Notification | pending→sent/unknown/manual | USER/system/CS | 站内+微信/人工 | external evidence | unknown不重发 | REQ-011 |
| FEAT-PRIVACY | 更正/撤回意向 | interest/audit | ServiceAreaInterest | NEW→NEW/CLOSED | USER/CS/OPS | 脱敏记录/状态 | consent/audit | owner 404/冲突 | REQ-012 |
| FEAT-ADMIN-AUTH | 员工变更 | auth/staff services | Staff/Session | active/role/scope revision | SUPER_ADMIN | 重新登录/权限状态 | sensitive audit | 撤销旧会话 | REQ-013 |
| FEAT-DEPLOY | 启动/健康检查 | config/migrate/reconciler | Deployment | boot→ready/degraded | system/ops | 健康和阻断原因 | structured log | fail-closed/租约接管 | REQ-014 |

## Journey coverage

| Journey ID | Role ID | Goal | Entry | Pages/features | Success exit | Cancel/back | Failure/recovery | Rule/AC refs |
|---|---|---|---|---|---|---|---|---|
| J-01 | USER | 参团支付 | PAGE-MINI-HOME | FEAT-DISCOVERY, FEAT-ORDER | PAID_WAITING_CLOSE | 支付前取消 | 库存/支付恢复 | DR-003/005, AC-ORDER-01 |
| J-02 | OPERATOR | 成团履约 | PAGE-OPS-CONTROL | FEAT-CAMPAIGN, FEAT-LOGISTICS | READY_FOR_PICKUP | 取消退款 | 一次顺延/差异 | DR-004/006/007, AC-CAMPAIGN-01 |
| J-03 | PICKUP_MANAGER | 分次领取 | PAGE-POINT-WORKBENCH | FEAT-PICKUP | COMPLETED | 截止前返回 | 跨点/并发/逾期 | DR-008, AC-PICKUP-01 |
| J-04 | USER | 品质售后 | PAGE-MINI-SERVICE | FEAT-AFTERSALE, FEAT-REFUND | RESOLVED | 取消提交 | 24h/人工挂起 | DR-009/010, AC-CASE-01 |
| J-05 | CUSTOMER_SERVICE | 通知恢复 | PAGE-GOVERNANCE | FEAT-NOTIFY | SENT/有证据完成 | 拒绝授权 | unknown/人工证据 | DR-012, AC-NOTIFY-01 |
| J-06 | USER | 数据权利 | PAGE-MINI-SERVICE | FEAT-PRIVACY | 更正/撤回 | 取消编辑 | 已处理转客服 | DR-013, AC-PRIVACY-01 |

## Matrix review

- Coverage conclusion: 核心首发闭环已映射；真实微信、外部客服渠道、法务规则和生产证据仍为发布门禁。
- Gaps and routed owners: 账号注销→产品/法务/财务；真实微信→发布负责人；容量→技术/运维。
- Approval evidence: `docs/10-test-plan.md`、`docs/go-live-checklist.md`；Quality Governor 独立复核待完成。
