---
title: "社区团购 — State and Permission Matrices"
status: APPROVED
version: 1.1.0
last_updated: "2026-08-31"
owner: architect
source_of_truth: project-document-set
---

# State and permission matrices

## Feature-state matrix

| Feature ID | Initial | Loading | Empty | Success | Failure | Offline | Unauthorized | Expired | Disabled/validation | Recovery | Acceptance refs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-DISCOVERY | 未选区域 | skeleton | 无覆盖转意向 | 可浏览真实团期 | 加载错误 | 网络提示 | 公共可读 | 不适用 | 不可售隐藏 | 重试/改选 | AC-AREA-01 |
| FEAT-ORDER | 空购物车 | 提交禁用 | 空购物车提示 | 真实订单/支付状态 | 库存或支付错误 | 保留草稿 | 登录并恢复意图 | 支付截止 | 数量/点位校验 | 刷新订单 | AC-ORDER-01, AC-PAY-01 |
| FEAT-CAMPAIGN | DRAFT | 操作禁用 | 无团期 | 成团/一次顺延/取消 | 状态冲突 | 保留写结果 | 403 | 截团 | 时间/影响校验 | 重取状态 | AC-CAMPAIGN-01 |
| FEAT-LOGISTICS | 无运输 | 页面加载 | 无任务引导 | 发车/到货/差异事实 | 草稿/状态错误 | 草稿保留 | 403/跨点 | 超时提示 | 角色/原因/数量 | 复用草稿/重试 | AC-LOGISTICS-01, AC-ARRIVAL-01, AC-ALLOCATION-01 |
| FEAT-PICKUP | 待领取 | 提交禁用 | 无任务 | 分次凭证/完成 | 错码/冲突 | 不消费请求 | 403/跨点 | 截止禁核销 | 数量/六码 | 同请求幂等 | AC-PICKUP-01 |
| FEAT-AFTERSALE | 加载订单 | 提交禁用 | 无可申报商品 | 多行案件 | 数量/24h/重复 | 保留表单 | 登录恢复 | 24h截止 | 每行必填 | 修正后重提 | AC-CASE-01 |
| FEAT-REFUND | 待批准 | 执行禁用 | 无退款 | provider成功+平衡分录 | 可重试/人工挂起 | durable义务 | 403 | 租约过期接管 | 仅批准项 | 固定号查询重试 | AC-REFUND-01 |
| FEAT-NOTIFY | 未授权 | 授权/投递中 | 无消息 | 站内/微信/有证据人工完成 | unknown/manual | 站内保留 | 登录恢复 | 任务租约 | 每组≤3；无回应不可完成 | 查询/人工证据 | AC-NOTIFY-01 |
| FEAT-PRIVACY | 无意向 | 加载记录 | 无历史 | 创建/更正/撤回 | 状态冲突 | 明确失败 | owner 404 | 隐私版本失效 | 同意/手机号 | 重同意/联系客服 | AC-PRIVACY-01 |
| FEAT-ADMIN-AUTH | 未登录 | 登录/页面加载 | 无员工 | 权限生效 | 401/403 | 重新连接 | 菜单+API拒绝 | 旧会话撤销 | 密码/点位范围 | 重新登录 | AC-AUTH-01 |
| FEAT-DEPLOY | boot | 依赖探测 | 空库无演示数据 | ready | 配置/依赖失败 | readiness失败 | 内部操作受限 | 租约接管 | 生产mock拒绝 | 修配置/恢复 | AC-DEPLOY-01 |

## Business object transition matrix

| Object ID | From state | Event/action | Actor | Guard | To state | Side effects | Failure/recovery | Rule/API/AC refs |
|---|---|---|---|---|---|---|---|---|
| OBJ-CAMPAIGN | OPEN/CLOSING | close threshold met | system/OPERATOR | paid qty达标 | LOCKED | 订单锁定/调度 | 幂等重放 | DR-004, AC-CAMPAIGN-01 |
| OBJ-CAMPAIGN | OPEN/CLOSING | first miss | system | failureAction=POSTPONE,count=0 | POSTPONED | 通知/审计 | 仅可重开一次 | DR-014, AC-CAMPAIGN-01 |
| OBJ-CAMPAIGN | OPEN/CLOSING | miss after reopen/cancel | system/OPERATOR | count=1或取消 | CANCELLED | REFUNDING+唯一义务 | 调和恢复 | DR-004/010, AC-CAMPAIGN-01 |
| OBJ-ORDER | PENDING_PAYMENT | valid callback | WeChat/system | 验签/金额/事件唯一 | PAID_WAITING_CLOSE | payment/outbox | 固定事件幂等 | DR-005, AC-PAY-01 |
| OBJ-ORDER | READY_FOR_PICKUP | partial/full pickup | PICKUP_MANAGER | 本点/六码/截止/数量 | READY/PICKED/COMPLETED | receipt/收入 | request摘要幂等 | DR-008, AC-PICKUP-01 |
| OBJ-REFUND | PENDING | reconcile/execute | FINANCE/system | 批准/租约/固定号 | provider/manual/succeeded | ledger/order状态 | query/retry/fence | DR-010/011, AC-REFUND-01 |
| OBJ-QUALITY | REGISTERED/ACCEPTED | accept/decide | CS/OPERATOR | 24h/数量/职责 | ACCEPTED/REJECTED/REFUNDING | exception/audit | 冲突重取 | DR-009, AC-CASE-01 |
| OBJ-NOTIFICATION | PENDING/manual | submit/manual evidence | system/CUSTOMER_SERVICE/SUPER_ADMIN | budget或成功联系证据 | SENT/UNKNOWN/MANUAL_COMPLETED | receipt/audit | unknown不重发 | DR-012, AC-NOTIFY-01 |
| OBJ-INTEREST | NEW/CONTACTED | correct/withdraw/handle | USER/CS/OPS | owner/隐私/状态 | NEW/CONTACTED/CLOSED | consent/audit | owner 404/冲突 | DR-013, AC-PRIVACY-01 |

## Permission matrix

| Role ID | Resource | Data scope | View | Create | Modify | Delete | Approve/review | Export | Sensitive operation log | Backend enforcement | Acceptance refs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| USER | 订单/消息/售后/意向 | 本人 | yes | 自己的业务动作 | NEW意向/售后草稿 | no | no | no | 同意与操作审计 | owner check/404 | AC-ORDER-01, AC-PRIVACY-01 |
| PICKUP_MANAGER | 配送/订单最小字段 | 授权点位 | yes | 到货/核销 | 本点事实 | no | no | no | 请求/点位审计 | role+point scope | AC-ARRIVAL-01, AC-PICKUP-01 |
| OPERATOR | 运营对象/必要订单 | 全局运营 | yes | 配置/团期/运输 | 业务配置 | no | 差异/取消/售后 | no | 原因/影响/actor | role guard；不得到货/财务执行 | AC-LOGISTICS-01, AC-ALLOCATION-01 |
| CUSTOMER_SERVICE | 售后/通知/意向 | 必要客户事实 | yes | 受理/人工证据 | 意向状态 | no | 售后受理 | no | 外部引用/结果 | role guard；不得退款 | AC-CASE-01, AC-NOTIFY-01 |
| FINANCE | 已批准退款/账本 | 财务最小范围 | yes | 退款执行 | provider状态 | no | financial execute | no | 固定号/分录 | role+approved state | AC-REFUND-01 |
| SUPER_ADMIN | 员工/审计/全局 | 全局 | yes | 员工/紧急代办 | 设置/权限 | no | emergency | no | 强制原因/audit | role+reason+revision | AC-AUTH-01, AC-DEPLOY-01 |

## Permission test notes

- UI 隐藏不是授权；列表、详情和动作都由后端复验角色、所有权或点位范围。
- USER/PICKUP_MANAGER 必须包含跨所有权/跨点位负例；员工角色、状态、点位变化后旧会话立即失效。
- 真实 bearer/WeChat 和生产依赖仍需预发布正反例，demo headers 不能替代。
