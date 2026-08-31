---
title: "社区团购 — Domain Rules"
status: APPROVED
version: 1.2.0
last_updated: "2026-08-31"
owner: requirements
source_of_truth: project-document-set
---

# Domain rules

## Domain boundary

- 地方农产品与常温熟食的区域拼团、平台统一销售、集中配送和固定点位自提。
- 不包含多商家撮合、即时配送、送货上门、多仓温控或点位预约排班。

## Numbered business rules

| Rule ID | Trigger / actors | Rule | Exceptions / recovery | Fact state | Source |
|---|---|---|---|---|---|
| DR-001 | 消费者浏览区域 | 仅启用、允许下单且至少有一个真实 ACTIVE 点位的区域公开 | 无覆盖仅可登记意向 | CONFIRMED | README/PRD |
| DR-002 | 运营配置点位 | 点位必须由运营显式创建；生产和迁移不得生成默认点位或演示城市 | 停用前检查进行中团期、负责人和订单影响 | CONFIRMED | README/PRD |
| DR-003 | 团期开售 | 一个团期固定一个点位；开售后不得更换 | 取消不可重新开售 | CONFIRMED | PRD |
| DR-004 | 截单 | 达到成团条件则锁定履约；未达到按 DR-014 顺延或取消 | 取消已付款订单必须同事务生成唯一退款义务 | CONFIRMED | PRD |
| DR-005 | 下单/支付 | 库存、订单行、点位快照和幂等记录同事务；支付回调校验金额、签名和重复事件 | 取消/支付竞争以条件状态更新收敛 | CONFIRMED | architecture |
| DR-006 | 发车/到货 | OPERATOR 管运输；授权 PICKUP_MANAGER 逐商品确认本点到货；OPERATOR 不得到货；超管代办必须有原因 | 重复请求幂等，敏感操作审计 | CONFIRMED | PRD |
| DR-007 | 到货差异 | 按 `paidAt ASC, orderNo ASC` 生成草案，运营确认前受影响量不可核销或退款 | 草案可复算；确认写审计 | CONFIRMED | PRD |
| DR-008 | 领取 | 六码仅本点可核销，支持分次、并发和请求幂等 | 到货后第 3 个自然日 23:59:59 起普通核销禁止 | CONFIRMED | PRD |
| DR-009 | 品质售后 | 按每次领取凭证逐商品计算，领取后未满 24 小时可申请；一次案件可含 1–20 个商品行 | 满 24 小时拒绝；分次领取互不延长 | CONFIRMED | PRD/API contract |
| DR-010 | 退款义务 | 退款状态与固定 `providerRefundNo` 唯一义务同事务；认领、租约、查询/安全重提、人工挂起可恢复 | 迟到响应不得覆盖新处理者；回调一次落账 | CONFIRMED | architecture |
| DR-011 | 退款会计 | 未领取/未确认收入的退款借记客户合同负债；已领取并确认收入部分借记销售收入；贷记微信支付清算 | 分录始终借贷平衡并关联退款义务 | CONFIRMED | 模式 B 会计语义 |
| DR-012 | 通知 | 事件、用户授权和微信模板语义必须一致；失败转人工任务时，完成记录必须含合规渠道、外部引用、结果、责任人与时间 | 外部渠道未知时只能标记待处理，不得宣称已联系 | CONFIRMED | PRD/go-live |
| DR-013 | 数据权利 | 用户可读取自己的区域意向并提交更正或撤回；平台保留履约/法定义务所需记录并审计处理 | 账号注销规则另需产品/法务批准 | CONFIRMED | 隐私说明 |
| DR-014 | 顺延 | 团期最多顺延一次；第一次未成团可重开，第二次未成团必须取消并为已付款订单退款 | 顺延必须通知；通知失败进入 DR-012 | CONFIRMED | 客户端“延期一次”承诺 |
| DR-015 | 员工权限 | 每次敏感操作校验角色、状态和点位范围；停用/换角色/换点位使旧会话立即失效 | UI 隐藏不代替后端鉴权 | CONFIRMED | PRD |
| DR-016 | 生产门禁 | 生产必须 MySQL 8.4、Redis 7.4、HTTPS、真实微信登录/支付；缺配置拒启动 | 真实外部验收不能以 mock 代替 | CONFIRMED | README/go-live |
| DR-017 | OPERATOR/SUPER_ADMIN 创建或变更自提点位置 | `serviceAreaId → ServiceArea.regionCode → 行政区目录路径` 是唯一**行政目录归属**事实链。省/市/区只读展示该链，不得作为第二个可提交、可独立修改或可与 `serviceAreaId` 冲突的事实源。本轮仅把每个 ServiceArea 当作一个行政目录节点校验路径相容，**不证明也不承诺**实际配送几何边界、门牌正确性或可通行性 | 若业务 ServiceArea 是自定义、重叠或非目录对齐范围，此契约不足，必须停止实现路由并回到需求/架构决策；不得自行扩成地理围栏 | CONFIRMED（单一行政链方向）/DEFAULT_ASSUMPTION（本轮单节点语义）/BLOCKING_UNKNOWN（实际业务边界） | TASK-PICKUP-LOCATION-REQ-REPAIR；QG-PL-01 |
| DR-018 | 新建、位置变更或从 INACTIVE 启用自提点 | 地址/POI 是首选输入，地图用于确认、微调及 POI 无结果兜底。服务端当场以提供方无关的逆地理适配器输出，校验坐标的**规范化行政目录节点**与服务区域节点路径相容；结果只说明“行政路径相容/不相容”，不得称为“已在实际服务区内”。地址文字不决定行政归属 | 未配置获批准适配器、地图不可用、提供方失败或行政标识不可映射时 fail-closed：保留本次表单会话，禁止新建、位置变更或启用写入。运营不直接编辑经纬度；同一路径相容仍保留错图钉、错门牌和不可通行的运营风险 | CONFIRMED（方向）/EVIDENCE_INFERRED（GCJ-02 现状）/BLOCKING_EXTERNAL（真实提供方） | TASK-PICKUP-LOCATION-REQ-REPAIR；QG-PL-01/02/04 |
| DR-019 | PATCH 编辑既有自提点 | 无持久“已/未核验”状态。本次请求仅在以下事件当场核验：新建；规范化地址改变；以 6 位 GCJ-02 值比较的纬度或经度改变；或状态由 INACTIVE 变 ACTIVE。服务区域不可在 PATCH 改变 | 未触发事件的纯非位置编辑（包括 ACTIVE→ACTIVE、INACTIVE→INACTIVE 及 ACTIVE→INACTIVE）原样保留地址/坐标且不调用逆编码；UI 只能说“本次未变更位置，未重新核验”，不得宣称历史已/待核验。触发事件失败时零位置写入、不得静默换区或丢坐标 | CONFIRMED（无状态触发方向） | TASK-PICKUP-LOCATION-REQ-REPAIR；QG-PL-03 |
| DR-020 | 在同一服务区域保存候选重复点位 | **DEFAULT_ASSUMPTION**：地址经确定性 NFKC、大小写折叠、空白折叠及中英文逗号/句号/分号/冒号归一后相同，或 GCJ-02 坐标以 Haversine（地球半径 6,371,000 米）计算距离不超过 50 米，即为“疑似重复”。PATCH 必须排除自身 `pickupPointId` | 仅提示，不自动合并/删除。首次候选与明确 `confirmDuplicate: true` 覆写均写审计（actor、请求、点位/候选 ID、匹配原因、距离、确认标记）；真实运营样本可调整或移除该默认值 | DEFAULT_ASSUMPTION | TASK-PICKUP-LOCATION-REQ-REPAIR；QG-PL-05 |

## Business object invariants

| Object | Invariant | Retention / audit |
|---|---|---|
| Campaign | 点位开售后不可变；顺延次数不超过 1；CANCELLED 终态 | 状态、原因、操作者、时间 |
| Order/Line | 金额整数分；累计领取/退款不超过已付款可用量 | 支付、点位和商品快照保留 |
| Arrival | 正常+短少+破损等于应到数量；本点权限 | 请求摘要、代办原因、审计 |
| Pickup | 请求 ID+摘要幂等；累计不超可领量 | 领取凭证是售后时钟来源 |
| Refund obligation | 每个退款事实固定唯一 providerRefundNo；成功一次落账 | 认领、重试、未知提交、人工状态保留 |
| Ledger entry | 借贷金额相等；科目由收入确认事实决定 | 关联订单/退款/操作者 |
| Notification | outbox 事件与偏好/授权/模板映射可追踪 | 自动提交预算、人工处理证据 |
| Service-area interest | 仅本人可读；更正/撤回需审计 | 业务处理和合规保留理由 |
| PickupPoint location | `serviceAreaId` 通过区域目录确定唯一**行政**归属；`address` 是对消费者展示的单一地址，`latitude`/`longitude` 是 GCJ-02 地图位置。路径相容是写入时事件校验，不是持久位置正确性或业务几何边界证明 | 创建/修改与重复候选/覆写审计；未触发位置事件的历史原值保留 |

## State machines

### Campaign

`DRAFT → SCHEDULED|OPEN|CANCELLED`; `SCHEDULED → OPEN|CANCELLED`; `OPEN → CLOSING|POSTPONED|CANCELLED`; `CLOSING → LOCKED|POSTPONED|CANCELLED`; `LOCKED → FULFILLING|CANCELLED`; `FULFILLING → COMPLETED`; `POSTPONED → OPEN|CANCELLED`。第二次未成团禁止再次进入 `POSTPONED`。

### Order

`PENDING_PAYMENT → PAID_WAITING_CLOSE|CANCELLING|CANCELLED`，随后按锁定、分配、运输、待领取、已领取/完成推进；已付款取消与符合规则的售后进入 `REFUNDING → REFUNDED`。

### Refund recovery

`PENDING → CLAIMED → SUBMISSION_UNKNOWN|PROVIDER_PROCESSING|RETRYABLE_FAILURE|MANUAL_HOLD|SUCCEEDED`（等价字段表达可接受）。自动处理必须使用持久化租约和固定退款号。

## Permissions and data scope

- USER：仅本人订单、消息、售后、意向和偏好。
- PICKUP_MANAGER：仅授权点位配送、到货和核销；无运营、财务权限。
- OPERATOR：运营对象、运输、差异和业务审批；不得提交普通到货或执行财务退款。
- CUSTOMER_SERVICE：售后受理、通知人工队列和必要订单上下文；不得执行退款。
- FINANCE：仅已批准退款与账本；不得改变商品、团期或到货事实。
- SUPER_ADMIN：员工、权限、审计、系统设置和带原因紧急代办。

## Failure, recovery, concurrency

- 所有创建/提交接口使用客户端请求 ID 或事件 ID 幂等；内容摘要不一致应冲突。
- 支付、取消、截单、核销、退款回调通过事务和条件更新收敛。
- 外部退款结果未知时先查询固定退款号；达到重试上限进入可见人工挂起。
- 通知使用 at-most-once 外部提交预算，未知结果不得自动重发；客服处理必须满足 DR-012。
- 首发部署固定单 API 副本；扩容必须先引入明确 worker 所有权、租约与运行指标。

## Compliance and external constraints

- 不提交微信密钥、证书、真实个人数据或生产配置。
- 隐私文案不得承诺系统没有实现的即时删除或已联系结果。
- 生产/真实设备/在线数据写入和不可逆迁移需单独授权。

## Rule change log

| Version | Date | Rule IDs | Decision | Summary |
|---|---|---|---|---|
| 1.0.0 | 2026-08-31 | DR-001–016 | existing approved product baseline | 将 README/PRD/architecture/go-live 与当前实现收敛为编号规则 |
| 1.1.0 | 2026-08-31 | DR-017–020 | TASK-PICKUP-LOCATION-REQ | 冻结区域事实源、地图恢复、历史编辑兼容和重复点位提示；不改变消费者定位范围 |
| 1.2.0 | 2026-08-31 | DR-017–020 | TASK-PICKUP-LOCATION-REQ-REPAIR | 收紧为行政路径相容；明确无状态 PATCH 触发、提供方/地图 fail-closed 和重复算法/审计 |
