# TASK-REM-P1-C 运营治理闭环验收契约

本文件只定义 P1-C 的运营治理闭环：品质售后与截单后取消职责分离、通知失败人工队列、区域开通意向、审计与财务账本可核查，以及既有商品/点位/团期配置对象的生命周期管理。它不改变已验收的 P0 退款恢复、到货权限，或 P1-A 员工会话与 P1-B 履约主流程。README、PRD、架构说明和上线清单优先于本文件。

## 范围与明确不做

- 不新增消费者手机号或新的联系方式采集。通知人工完成只保存已批准渠道枚举、外部会话/工单引用和成功联系结果。
- 不实现消费者账号注销/删除。订单留存、未结售后和隐私政策尚未获得产品与法务批准；该决定是上线外部阻断，不能被本地测试替代。
- 不建设生产基础设施、真实微信消息通道或消费者隐私政策。真实 MySQL/Redis、微信预发布和实际联系渠道继续依赖外部环境与批准。
- 不新增 P1-C 以外的商品、订单、退款或数据授权模型；前端展示与服务端鉴权都以当前已批准角色为准。

## 角色 × 页面 × 动作 × 数据最小化

| 角色 | 页面 | 可见数据 | 可执行动作 | 明确禁止 |
| --- | --- | --- | --- | --- |
| `CUSTOMER_SERVICE` | 售后与治理 | 品质单完整业务事实；取消只读；通知人工队列；区域意向队列（手机号默认脱敏） | 受理 `REGISTERED` 品质单；系统重试通知、人工完成通知；意向 `NEW -> CONTACTED -> CLOSED` | 品质决定/退款、取消审核/退款、审计、账本、完整手机号默认展示 |
| `OPERATOR` | 售后与治理、配置 | 已受理品质单；截单后取消；意向队列；商品、点位、团期 | 批准/拒绝已受理品质单；批准/拒绝待审核取消；意向状态变化；商品/点位编辑与启停；合法团期延期 | 通知人工队列与联系动作、品质/取消财务退款、审计、账本、未授权隐私字段 |
| `FINANCE` | 财务 | 已批准待退款品质单/取消单；退款和账本 | 执行已批准退款；核查账本 | 受理/决定品质单、审核取消、通知或意向队列、审计、配置写入 |
| `SUPER_ADMIN` | 系统设置、治理、财务、配置 | 全部受管业务事实；审计页仅安全脱敏快照；账本 | 紧急代办上述受限员工动作 | 展示密码、token、一次性凭据、完整 OpenID 或默认完整手机号 |
| `PICKUP_MANAGER` | 点位工作台 | 仅已授权点位的履约事实 | 已验收的到货/领取动作 | P1-C 治理、审计、账本、配置写入 |
| `USER` | 小程序 | 仅本人已同意隐私的区域意向提交与本人订单 | 提交区域开通意向 | 管理端、治理队列、其他人的信息 |

角色可见性是体验边界；所有 API 必须重复验证角色、资源状态与数据范围，返回 403 或 409，而不是仅依赖隐藏按钮。

## 状态、理由与审计契约

### 品质售后

```text
REGISTERED --CUSTOMER_SERVICE / SUPER_ADMIN 受理（说明必填）--> ACCEPTED
ACCEPTED --OPERATOR / SUPER_ADMIN 批准（说明必填）--> REFUNDING
ACCEPTED --OPERATOR / SUPER_ADMIN 拒绝（说明必填）--> REJECTED
REFUNDING --FINANCE / SUPER_ADMIN 成功退款--> RESOLVED
```

相同终态动作必须幂等返回现有事实；跨状态动作拒绝。FINANCE 只能对运营已批准且存在批准退款事实的品质单操作，不能受理或决定。
财务写接口返回该次写入后持久化的品质单状态和部分退款状态：只有 `RESOLVED` / `SUCCEEDED` 才在页面表述为“退款已完成”；`REFUNDING` 与提供方 `PROCESSING`、`SUBMISSION_UNKNOWN`、`RETRYABLE_FAILURE`、`MANUAL_HOLD` 均保留真实恢复语义，页面不再显示第二个“执行退款”动作。写成功后的本地队列先按接口返回收敛；随后读刷新失败只能显示可重试错误，不能回显旧动作。

### 截单后取消

```text
PENDING_REVIEW --OPERATOR / SUPER_ADMIN 批准（理由必填）--> APPROVED_WAITING_FINANCE
PENDING_REVIEW --OPERATOR / SUPER_ADMIN 拒绝（理由必填）--> REJECTED
APPROVED_WAITING_FINANCE --FINANCE / SUPER_ADMIN 提交退款--> REFUNDING
REFUNDING --支付机构成功或可靠恢复--> REFUNDED
```

截单前直接退款和 P0/P1-B 已有退款义务仍遵循原有契约；本节只约束截单后、需要运营审核的申请。财务不得替运营审核，重复执行不能产生第二笔退款或账本。
取消退款写接口返回写后持久化状态：支付已成功则为 `REFUNDED`，仍待提供方确认或自动恢复则为 `REFUNDING`；页面分别显示完成或同步中，刷新失败不得重新开放执行按钮。

### 通知人工队列

```text
PENDING_DELIVERY --本地前置校验失败或用户未授权（尚未提交提供方）--> MANUAL_REQUIRED
MANUAL_REQUIRED --受权角色“系统重试”--> PENDING_DELIVERY
MANUAL_REQUIRED / PENDING_DELIVERY --CUSTOMER_SERVICE（或 SUPER_ADMIN 紧急代办）提供成功联系证据并二次确认--> MANUAL_COMPLETED
```

在调用提供方前，worker 必须持久化 CAS 将 `PENDING_DELIVERY` 置为
`SUBMISSION_UNKNOWN`，写入唯一 `providerSubmissionAttemptId` 和开始时间，再在事务外调用提供方：

```text
PENDING_DELIVERY --begin submission CAS--> SUBMISSION_UNKNOWN
SUBMISSION_UNKNOWN --同 attemptId 成功落库--> WECHAT_SENT
SUBMISSION_UNKNOWN --超时/断网/5xx/异常/崩溃--> SUBMISSION_UNKNOWN
```

`SUBMISSION_UNKNOWN` 绝不被自动 claim、drain、reconcile 或系统重试。若提供方尚未提供稳定幂等键与可靠查询契约，系统选择 **at-most-once**：进程在 begin 后崩溃可能漏发，但不得自动重发造成重复投递。此状态必须在人工队列展示“微信可能已送达，请勿再次系统发送”；人工完成可记录线下处置，但不得擦除 attempt 或 unknown 事实。

租约的 `now`、到期判断、`leaseUntil` 与 submission 开始/结果时间均以 Store 权威时钟为准；worker 只能传租约时长和 claim token，不能传绝对时间。MySQL 实现必须在持有聚合行锁的同一连接内使用 `UTC_TIMESTAMP(3)`；应用实例的快慢时钟不得决定 claim 或 begin 的所有权。

真实微信适配器采用 fail-closed 响应契约：token 与发送响应都必须是非数组 JSON 对象；token 的 `access_token` 必须为非空字符串，若提供 `expires_in` 必须为正的有限数值；发送响应必须有数值 `errcode === 0`。HTTP 非 2xx、JSON 解析失败、HTML、`{}`、数组、字符串、缺字段及字段类型错误全部作为提交结果未知处理，保留 `SUBMISSION_UNKNOWN`，不得写为 `WECHAT_SENT`。

队列仅展示通知类型、订单号或用户最小标识、失败原因、尝试次数、最近时间与状态。不得输出完整 OpenID、敏感 payload 或系统未持有的手机号。人工完成必须持久化处理说明、操作者和时间，并写审计；重复完成不得覆盖首次处理事实或生成额外审计。
系统重试只允许 `MANUAL_REQUIRED` 且尚未开始 provider submission：`SUBMISSION_UNKNOWN`、`IN_APP_AVAILABLE`、`WECHAT_SENT`、`MANUAL_COMPLETED`、`PENDING_DELIVERY` 和未知记录分别以无写入的 409/404 拒绝。系统重试必须经网页二次确认；取消确认不得发起请求。

### 区域开通意向

```text
NEW --CUSTOMER_SERVICE / OPERATOR / SUPER_ADMIN（说明必填）--> CONTACTED
CONTACTED --CUSTOMER_SERVICE / OPERATOR / SUPER_ADMIN（说明必填）--> CLOSED
```

不允许回退、跳跃或无说明更新。列表中的手机号默认脱敏；如提供显式查看，则仅对受权角色在最小必要的单条详情中展示并写审计。若当前架构未实现安全显式查看，保持脱敏，并把实际外部联系流程列为外部依赖。

### 配置生命周期

- 商品：`ACTIVE <-> INACTIVE`。OPERATOR/SUPER_ADMIN 可编辑和切换；`INACTIVE` 不再进入公共目录，新旧订单、团期与明细快照不得改写。
- 自提点：`ACTIVE <-> INACTIVE`。存在进行中团期/配送或仍有有效点位负责人授权时，停用必须被明确拒绝；不得静默断开履约。
- 团期：只有既有的合法延期状态可 `POSTPONE`，输入新的截单、发车和预计到货时间。所有时间必须在当前业务时间之后且满足 `cutoff < dispatch <= estimated arrival start <= estimated arrival end`；重复或非法状态拒绝。延期必须留下审计和既有通知事实。

## 审计与账本可核查

- `SUPER_ADMIN` 审计页显示操作者、动作、资源、requestId 与时间；before/after 仅在展开时显示且必须递归脱敏密码、token、一次性凭据、完整手机号、OpenID 和敏感 payload。
- 通知人工完成、区域意向状态变化、品质受理/决定/退款、取消审核/退款以及配置写入都必须有审计事实。
- FINANCE/SUPER_ADMIN 账本显示交易事件、关联单据、借/贷方向、账户、金额与时间；每笔交易显示借方合计、贷方合计和是否平衡。任一不平衡条目须显著告警，其他内部角色无访问权。

## 页面状态、按页加载与响应式

每个新治理页面须有 loading、empty、error/retry、disabled、confirmation 和 unauthorized 反馈。按 P1-A 的当前身份与最新 reload generation 提交数据：过期响应、错误或 loading 状态不得覆盖新请求或新身份。375、768、1440px 下无页面级横向溢出；表格仅在自身容器内滚动，弹窗和主操作保持可读、可触达。

## 验收证据

1. 浏览器分别以客服、运营、财务、超管完成品质受理、批准/拒绝和退款；UI 不出现无权动作，API 反向验证 403/409，操作后数据刷新。
2. 浏览器走截单后取消的批准、拒绝与财务退款链路；理由必填、重复执行幂等、退款和账本仅一次。
3. 浏览器看到通知失败人工队列，系统重试与填写处理说明的人工完成均经二次确认；API/单元验证审计及首次处理事实不被重复覆盖。
4. USER 提交已同意隐私的区域意向，客服 UI 将其按说明转为 `CONTACTED` 再 `CLOSED`；FINANCE/PICKUP_MANAGER 菜单和 API 均拒绝。
5. 超管审计页脱敏展示，FINANCE 账本逐笔显示借贷平衡；未授权角色 API 返回 403。
6. OPERATOR/SUPER_ADMIN 从 UI 编辑/停用商品、按约束停用点位和延期团期，验证公共目录过滤、历史快照不变、非法停用/延期被拒绝、审计与通知事实存在。
7. 新增与既有浏览器测试均监听非预期 4xx/5xx、`pageerror`、`requestfailed`；`pnpm check`、`pnpm test:e2e` 和 `git diff --check` 必须通过。缺少真实 MySQL/Redis URL 时强制集成门禁 fail-closed，报告为 BLOCKED，不得计为 PASS。

## 外部决策 BLOCKED

| 决策 | 为什么不能由本包自行决定 | 上线前需要的输入 |
| --- | --- | --- |
| 实际人工联系渠道与隐私政策 | 系统不应假设客服可从本产品取得或使用消费者联系方式 | 产品、法务与隐私负责人的批准渠道、留存与告知政策 |
| 消费者账号删除/注销 | 与订单留存、支付凭据、未结售后及法定数据处理义务冲突 | 产品、法务和财务批准的数据生命周期规则 |
| 真实 MySQL/Redis 与微信预发布 | 本地无连接信息不能证明生产事务、消息或支付机构行为 | CI/预发布环境 URL、凭据与外部平台验收 |
