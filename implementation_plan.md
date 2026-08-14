# Implementation Plan

## 2026-08-14 — 人员、权限与运营导航闭环（以 PRD v1.0 为准）

> 本节以 `docs/staff-permissions-and-admin-navigation-prd.md` 及
> `docs/product-reflection-staff-account-gap.md` 为唯一产品依据，并取代下方
> “社区团购后台导航与页面职责重组”草案中与本节冲突的部分。下方草案保留为
> 决策历史，不得作为本轮实现依据。

### 产品目标与完整闭环

让超级管理员能在后台完成“创建员工 → 分配固定角色及点位范围 → 首次激活 →
现场使用 → 变更/停用并立即回收会话”的完整闭环；让自提点负责人只使用其点位
工作台；同时把后台按商品、团期、订单、物流、自提点、售后、财务和系统设置
重组。业务人员永远不输入或传递内部用户 ID，消费者目录也不作为员工来源。

本轮 MVP 包含：固定角色模板、员工目录、一次性初始凭据与首次改密、点位绑定、
停用/恢复、会话撤销、服务端点位隔离、独立点位工作台和 PRD 指定的导航页面。
不包含短信/企业微信、SSO、任意权限勾选、多租户、供应商门户、WMS 或新的资金
流程；既有社区轻量履约、支付、退款、历史撮合/仓配兼容路径保持不变。

### 已核对的冲突与处理决定

| 当前状态 | 与 PRD 的冲突 | 本轮处理 |
| --- | --- | --- |
| 现有“核销员授权”要求手输 `userId`，以 `PICKUP_VERIFIER` 事件授权 | 没有创建、激活、目录、停用或人员可读信息，且将技术 ID 泄漏给运营 | 正常入口替换为“系统设置 → 员工与权限”；新负责人使用 `PICKUP_MANAGER` 与员工点位范围。旧事件/API 仅保留兼容，不在日常导航展示。 |
| 当前认证仅有 `admin_credentials`、角色和单令牌注销 | 不能区分内部员工状态，停用/换点无法批量回收既有会话 | 新增内部员工状态和按员工删除会话能力；每次受保护请求也重验员工启用状态与点位范围。 |
| “配送与领取”页混放商品表、建商品和建团按钮 | 违反一页一工作主题，物流页不应含商品或团期配置 | 拆为商品管理、团期管理、订单管理、物流管理、自提点管理、售后与异常、财务管理和系统设置；点位负责人走独立工作台。 |
| 旧草案假定不需要迁移、点位人员继续为 `PICKUP_VERIFIER` | 无法实现正式员工生命周期，也不符合统一负责人角色 | 用仅新增的 `0033_internal_staff_accounts.sql` 引入新模型；不自动把存量用户/授权推断成员工，避免误授予权限。 |

### 页面结构与核心用户流

全局后台左侧导航严格按 PRD 分组：

```text
日常运营：工作台 / 商品管理 / 团期管理 / 订单管理
履约管理：物流管理 / 自提点管理
客户与资金：售后与异常 / 财务管理
系统：系统设置
```

- **工作台：** 只展示待发布、即将截单、待发车、待点位确认、待领取、待处理异常的卡片和跳转。
- **商品管理：** 唯一主操作为新增商品；商品图片、分类、规格、默认售价和可售量独立维护。采购成本/供应商备注仅受限“采购信息”区域可见。
- **团期管理：** 唯一主操作为创建团期；配置商品、本团价格/数量、区域、固定自提点和时间，发布后才面向消费者。
- **订单管理：** 查询订单、支付/履约/售后进度及导出，不承担商品、发车或退款执行。
- **物流管理：** 创建配送、人工货拉拉运单/司机/车牌/预计时间、确认发车、查看点位交接；不得渲染商品表或建团按钮。
- **自提点管理：** 服务区域、自提点、负责人账号与权限三个页签；负责人账号页只选择可读员工，不输入内部 ID。
- **售后与异常 / 财务管理 / 系统设置：** 分别承载处置、资金与对账、员工与权限/操作记录/通知失败/历史兼容。历史撮合结算仅 FINANCE/SUPER_ADMIN 在财务兼容页查看。
- **点位工作台：** `PICKUP_MANAGER` 登录后仅有“我的待确认到货、我的待领取订单、提货码核销、我的账户”；所有数据按已绑定的启用点位过滤。

### 后端模块、数据模型与兼容迁移

新增迁移 `0033_internal_staff_accounts.sql`，全部为 additive，重复部署安全：

| 数据对象 | 用途与关键字段 | 兼容策略 |
| --- | --- | --- |
| `internal_staff` | `user_id`、内部员工编号、姓名、手机号、固定角色、`PENDING_ACTIVATION/ACTIVE/SUSPENDED`、创建/停用信息 | 仅标识新内部员工；不读取或迁移消费者资料，不物理删除。 |
| `staff_pickup_point_assignments` | 员工与启用自提点的当前范围、分配人、变更时间 | 新负责人授权事实；旧 `pickup_verifier_assignment_events` 不改写，继续供历史兼容账号使用。 |
| `admin_credentials` 新列 | `must_change_password` 等首次激活状态 | 保留旧密码散列和账号；新凭据只返回一次明文初始凭据，持久化只保存散列。 |

应用层新增 `StaffService`，负责在单一 `CommerceStore.transaction` 中完成员工、角色、点位、凭据和审计写入。存储层新增员工目录、点位范围、替换内部员工角色、按用户撤销所有会话的双实现（Memory/MySQL）。

兼容/回滚策略：历史 `PICKUP_VERIFIER`、存量 `admin_credentials`、`pickup_verifier_assignment_events`、订单、支付、退款、分账和社区履约表一律保留；新表初始为空，不自动改变任何人权限。回滚时关闭新员工/导航入口，不删除新表；已创建员工的历史审计仍可查，旧路径继续可用。不会改变 `PLATFORM_COMMUNITY` 的订单/配送状态机或财务语义。

### 0033 迁移失败恢复（QA P1，2026-08-14）

QA 在隔离 MySQL 中确认：MySQL 对多条 DDL 隐式提交；若 `0033` 的末尾
`admin_credentials` 列已由外部历史变更存在，前两个新表会已经创建，而迁移元数据会
记录 `FAILED`，原迁移器又会拒绝重试。这不是可接受的人工清库发布流程。

`0033` 已可能在既有环境中标记为 APPLIED，因此不得修改其内容或校验和。最小兼容修复是：

1. 迁移器仅对已知的 `0033_internal_staff_accounts.sql=FAILED` 启动受限恢复器；必须逐项
   比对已有对象与 0033 的不可变结构契约：列类型/长度、NULL、默认值、ENUM 全量成员及
   顺序；主键与二级索引的列顺序/唯一性；外键的本地列、引用表和引用列。任何同名异构
   对象（包括 `phone INT`）均停止并输出精确诊断，绝不删除、修改或覆盖数据。
2. 对缺失对象执行同语义的新增 DDL；`must_change_password` 只在列缺失时新增；恢复后再次
   校验完整目标模式，才将原 FAILED 标记原子更新为 APPLIED。其他 FAILED 迁移仍保持人工
   阻断，避免泛化地掩盖真实故障。
3. 增加真实 MySQL 故障注入：预置末尾列、首次执行 0033 失败并保留半成品，第二次执行应
   无人工修改地补齐模式并标记 APPLIED；另构造保留相同列名/索引名/外键名但 `phone INT`
   的同名异构表，验证迁移失败、保持 FAILED 且不能被恢复器接纳。该测试仅创建隔离临时库，
   不接触业务库。

这是一项发布可靠性修复，不会改写员工、消费者、订单、支付或任意历史记录。已部署且
APPLIED 的 0033 不执行任何恢复路径；回滚时只关闭新功能，保留新增模式和迁移元数据。

### API、认证与权限设计

| API | 权限 | 语义 |
| --- | --- | --- |
| `POST/GET /api/v1/admin/staff`、`GET /:id`、`PATCH /:id` | `SUPER_ADMIN` | 创建/检索/变更内部员工；目录仅返回姓名、脱敏手机号、角色、状态、点位和员工编号。 |
| `POST /api/v1/admin/staff/:id/reset-credential` | `SUPER_ADMIN` | 生成一次性初始凭据并审计；明文只在该响应出现一次。 |
| `POST /api/v1/auth/admin/activate` | 未登录 | 校验一次性凭据、设置新密码、将待激活员工启用；不在日志或后续查询返回凭据。 |
| 既有登录/会话 API | 内部员工需启用且已激活 | 登录和每个受保护请求重验员工状态；停用或点位变更删除全部会话，下一请求拒绝。 |
| 社区到货、点位订单查询、提货码核销 API | `PICKUP_MANAGER`（旧 `PICKUP_VERIFIER` 仅兼容） | 以 `staff_pickup_point_assignments` 验证本点位和员工状态；拒绝跨点位、成本、财务、团期/商品配置和退款执行。 |

固定角色模板为 `SUPER_ADMIN`、`OPERATOR`、`CUSTOMER_SERVICE`、`FINANCE`、`PICKUP_MANAGER`。新员工每次只持有一个模板角色，角色调整在事务中替换，禁止自由组合接口权限。敏感操作（创建、角色/点位变更、重置凭据、停用/恢复、到货、异常、核销、退款决定/执行）记录操作者、请求 ID、前后值和停用/敏感变更原因。

### 开发顺序

1. 为迁移和 `StaffService` 编写领域/API 回归：创建、激活、改密、停用会话失效、换点拒绝和目录脱敏。
2. 实现 `0033`、core 类型/Memory/MySQL Store、认证首次激活和会话撤销；接入服务端点位负责人授权，保留旧核销授权作兼容。
3. 增加员工与权限 API，并收紧成本、财务、订单和退款的角色边界；所有服务端读取/写入先于前端改造完成。
4. 重组后台导航和独立页面；删除正常流程中手输核销员 ID 的入口，接入员工目录/点位多选和点位工作台。
5. 更新 API、集成和 Playwright 流程：创建负责人 → 激活/登录 → 本点到货 → 本点核销 → 停用 → 拒绝；覆盖跨点位/跨财务、重复到货/核销、窄屏和错误/空/加载态。
6. 为 0033 增加 MySQL DDL 失败注入与自动恢复验证；迁移器只修复可验证的 0033 半成品，其他失败仍阻断。
7. 运行迁移、lint、typecheck、unit/API/真实 MySQL-Redis integration、coverage、build、浏览器 E2E和 diff 检查；冻结后交项目评测 Agent 按 PRD 第 7 节独立验收。

### 验收标准、风险与外部确认

- 超级管理员无需内部 ID 即可创建、绑定并激活负责人；未绑定启用点位的负责人不可启用；目录不含消费者资料或明文凭据。
- 停用/换点立刻回收会话和点位权限；历史事实和审计不受影响。
- 点位负责人只见自己的工作台；跨点位读取/到货/核销、成本读取、退款和财务 API 全部由服务端拒绝。
- 商品、团期、物流各为独立页面；物流页没有商品表、新增商品或创建团期入口；所有面向运营状态显示中文。
- 风险：一次性初始凭据需要受控线下分发；本轮采用 PRD 默认方案，SMS/企业微信/SSO和最终提货/售后期限仍是上线前产品确认项。开发自测仅提供证据，不替代项目评测 Agent 的独立发布结论。

### 实施状态与开发自测（2026-08-14）

- 已完成 `0033_internal_staff_accounts.sql`，并在本地 MySQL 以既有迁移器顺序执行；迁移只增加 `internal_staff`、`staff_pickup_point_assignments` 与 `admin_credentials.must_change_password`，未修改历史业务记录。
- 已完成 `StaffService`、Memory/MySQL 双存储实现、一次性激活/改密、目录脱敏、角色与点位范围变更、停用/重置凭据会话回收和审计；旧核销员事件接口保留为仅超级管理员可用的兼容接口，日常 UI 不再展示。
- 已完成服务端最小权限：点位负责人只能读取已绑定启用点位的社区配送、到货、订单查询与核销；跨点位、商品/团期配置、采购成本、报价、财务、退款和全局订单接口拒绝。运营读取平台商品时商业字段已由服务端脱敏且不能覆盖。
- 已完成后台分组导航和独立页面：商品管理、团期管理、订单管理、物流管理、自提点管理、售后与异常、财务管理、系统设置；纯点位负责人自动进入点位工作台。物流页没有商品表、新增商品或创建团期入口；差异原因和未知状态均显示中文。
- 已补浏览器流程：平台负责人创建负责人 → 负责人用一次性凭据激活 → 仅见本点工作台 → 逐 SKU 短少到货 → 部分领取 → 平台负责人停用 → 原 bearer 会话被 401 拒绝。该流程使用真实浏览器页面完成员工创建、登录、激活、到货、核销与停用。
- 已执行的开发级验证：API 61/61（含 5 个 MySQL/Redis 集成用例）通过、后台 API 单测通过、后台生产构建通过、Playwright 端到端通过、`db:migrate` 已执行 `0033`。冻结后仍须由项目评测 Agent 依 PRD 第 7 节独立验收；这些结果不构成发布放行。
- QA 指出的 0033 多 DDL 半成品恢复风险已修复：迁移器会在测试过的 `FAILED` 0033 状态下校验既有对象、补齐缺失对象并仅在完整模式匹配后标记 APPLIED；真实隔离 MySQL 故障注入覆盖“末尾列冲突 → FAILED 与两张半成品表保留 → 下次迁移自动恢复”，并由 CI 的专用临时库凭据强制执行。其他 FAILED 迁移仍维持阻断策略。

## 2026-08-14 — 社区团购后台导航与页面职责重组

### 产品目标

把后台入口按运营人员实际处理的对象重组，而不是按旧数据库表或仓配技术模块罗列。社区日常主线固定为“商品 → 团期 → 订单 → 物流 → 点位领取 → 异常/财务”；旧采购、中心仓、批次、供应商应付、历史撮合结算保留数据和接口，但只能从明确标注的只读兼容入口进入。

### 影响范围与兼容策略

- **前端路由/页面：** 将现有“配送与领取”拆为商品管理、团期管理、订单管理、物流管理、自提点管理、售后与异常、财务管理、系统设置；工作台仅放待办跳转，不放主数据表或配置操作。
- **点位人员：** `PICKUP_VERIFIER` 登录后仅渲染“点位工作台”，查询仍使用既有点位限定接口；不请求或显示全局商品、团期、订单、成本、退款、财务和其他点位数据。
- **服务端：** 本轮不新建业务表、不迁移或删除任何记录。沿用已有 API 的角色校验与社区逐 SKU 到货/领取路径；补齐前端查询开关与 API 回归，确保 UI 隐藏不被当作授权边界。
- **历史兼容：** 采购/仓储、供应商应付和历史撮合结算从日常导航移至“系统设置 / 历史兼容”或“财务管理 / 历史兼容”只读标签。旧接口与历史订单读取逻辑不改写。

### 目标页面与职责

1. **工作台：** 仅展示待发布、即将截单、待发车、待点位确认、待领取、待处理异常的卡片；卡片跳转到对应的团期、物流、订单或异常列表。
2. **商品管理：** 平台商品的新增、搜索/筛选、编辑和启停；采购成本/供应商备注放入仅商业角色可见的“采购信息”折叠区。不得创建团期或配送。
3. **团期管理：** 社区团期的创建、草稿编辑、发布、暂停/取消、延期与销售汇总；商品被添加且团期发布后才对消费者可见。
4. **订单管理：** 订单状态、团期/点位筛选、支付/售后进度与拣货/装袋导出入口；不在此页配置商品、发车或执行退款。
5. **物流管理：** 已截单团期的配送准备、人工货拉拉信息、确认发车、点位确认结果与状态时间线；严禁出现平台商品表或创建团期操作。
6. **自提点管理：** 服务区域、自提点、负责人账号与点位授权三个页签；负责人角色仅能确认到货、登记事实、查询订单和核销。
7. **售后与异常：** 配送异常、提货异常、用户售后三个页签；运营决策，财务执行已确认退款。
8. **财务管理：** 支付/退款记录、日对账和导出；“历史撮合结算”只作为 FINANCE/SUPER_ADMIN 可见的兼容页签。
9. **系统设置：** 后台账号与角色、操作记录、通知失败记录、历史兼容数据；“核销员授权”和“操作记录”不再是一级业务导航。

### 权限与显示规则

- `SUPER_ADMIN` 可见全部页面；`OPERATOR` 可见日常运营、物流、自提点和异常，但不可见采购成本、供应商报价及财务执行；`FINANCE` 仅财务、退款审批所需订单/异常只读；`CUSTOMER_SERVICE` 仅订单和售后异常；`PICKUP_VERIFIER` 仅点位工作台。
- 所有运营文案、表头和状态使用中文映射；未知内部状态显示“待处理”而不是英文枚举。
- 前端可见性之外，继续依赖服务端既有点位、商业字段和退款权限校验；不得因本次导航重组放宽 API 权限。

### 实施顺序

1. 在 `App.tsx` 建立新页面键、角色门禁和日常/履约/客户资金/系统分组导航；将纯点位负责人分流到独立工作台。
2. 将现有社区商品、团期、配送、订单、异常、点位授权和审计组件按单一主题重组，清除物流页中的商品和建团入口；增加中文状态/空态/加载态。
3. 调整 React Query 仅在相应页面和角色下读取数据，收紧普通运营账号对商业字段的渲染；复用既有后端路线，不更改历史数据。
4. 更新 API 边界与 Playwright 用例，实测运营的商品→团期→物流→点位领取路径，以及点位负责人隔离；验证宽屏、768px、390px。
5. 运行 lint、typecheck、单元/API、构建、覆盖率、真实 MySQL/Redis 集成、浏览器 E2E和 diff 检查，交独立 QA 复测。

### 验收与风险

- 物流页没有商品表、商品创建或建团按钮；商品页唯一主操作是新增商品，团期页唯一主操作是创建团期。
- 顶级导航不再出现“收货区域、核销员授权、操作记录、历史撮合结算”；它们均归入自提点、系统设置或财务兼容标签。
- 点位负责人无法通过页面或 API 读取其他点位、全局订单、商品配置、成本、退款或财务信息。
- 本轮不改变支付、退款、库存、历史订单或迁移结构。最大风险是单文件后台现有角色查询的耦合；每次页面分拆后必须回归 API 权限与浏览器操作。

## 2026-08-14 — independent browser-runner evidence

### Goal

Make the Mode B browser gate independently auditable when a local QA host cannot launch Chromium. The existing Linux CI job already provisions Chromium and executes `pnpm test:e2e`; this increment preserves the browser trace, HTML report, and raw test results for both successful and failed runs.

### Scope and verification

- Add a manual CI trigger in addition to push and pull-request runs; it does not alter production deployment or application data.
- In CI only, record Playwright trace output for the complete single Mode B workflow and generate an HTML report.
- Upload those artifacts unconditionally after the E2E command, including a failed browser-launch diagnosis. The resulting CI job log and artifacts are the reproducible evidence for independent QA.
- Locally rerun the E2E command and validate workflow/config syntax through the normal repository gates. Cloud execution itself remains a separate CI/QA action because this workspace has no authority to push or trigger the remote repository.

## 2026-08-14 — Mode B discrepancy handover browser-gate completion

### Goal

Turn the existing Mode B Playwright check from an API-prepared presentation assertion into a browser-operated workflow. The test must use the administration UI to record supplier receipt, start and complete sorting, create outbound delivery, record a per-SKU shortage handover, and make the operator refund decision before finance reviews the calculated amount.

### Scope and compatibility

- Keep isolated fixture creation, campaign opening, customer checkout/payment, and test cleanup outside the browser flow; these are prerequisites, not the operations being accepted.
- Exercise existing UI controls and protected APIs only through the admin browser session after the order is locked. Do not change legacy marketplace flows, payment routes, schemas, or historical records.
- Preserve the existing finance confirmation assertion, but make it the result of real UI actions so it proves the discrepancy-workflow screens and their state refresh behavior.

### Browser workflow and assertions

1. Seed a Mode B supplier, SKU, offer, warehouse, campaign, fixed pickup point and paid order through the isolated API fixture helper; wait for close and generated purchase order.
2. In the browser, open “采购与中心仓”, submit the supplier-receipt modal with the lot and inspection evidence, and assert the purchase-order line displays receipt progress.
3. In the browser, start and complete sorting, create outbound delivery, then open the pickup-handover modal and submit a one-unit SKU shortage with its reason and evidence.
4. In the browser, use the operator action to confirm the partial-refund disposition; then assert the finance-review row contains the exact SKU/order amount basis and confirmation action.
5. Add deterministic DOM waits after every mutation. The test must fail if any of those operation buttons/forms cease to work, not merely if the final finance text changes.

### Verification plan

- Run the focused Playwright spec after the red-capable UI path is in place, followed by `pnpm test:e2e` on a host where Chromium can spawn.
- Keep `pnpm check`, coverage, real MySQL/Redis integration and diff validation as regression gates. If the host blocks Chromium spawning, report the exact environmental error separately from the test logic.

## 2026-08-14 — real MySQL/Redis release-environment verification repair

### Goal

Validate the Mode B path against an actual MySQL 8.4 and Redis 7.4 environment, including migrations `0026` through `0031`, rather than relying on skipped integration coverage. During that validation, correct the MySQL persistence boundary for a successful platform-payment timestamp.

### Scope and compatibility

- Normalize `Payment.succeededAt` and order lifecycle timestamps (`paidAt` / `pickedUpAt`) to JavaScript `Date` values at the MySQL store boundary, matching the existing conditional payment-write paths.
- Do not alter payment routes, legacy marketplace payment/refund/settlement behavior, schemas, or any historical financial records.
- Extend the real integration assertion so a successful Mode B mock payment proves that the paid order state was persisted before the receipt/shortage workflow continues, through sorting, outbound creation, and its order-state transition.

### Verification plan

- Run additive migrations through `0031` on MySQL, then run two concurrent migrators to exercise the migration lock and repeat-deploy safety.
- Run the MySQL/Redis integration suite with both integration URLs configured, so it cannot skip.
- Run workspace checks, coverage, E2E, and diff validation with that same real integration environment available.

## 2026-08-13 QA final P1 — procurement least privilege and customer-claim audit atomicity

### Goal and boundary

Remove purchase-commercial data from warehouse-facing Mode-B reads and make a picked-up consumer claim plus its audit evidence one database transaction. The change must not alter any legacy marketplace route or historical record and introduces no destructive migration.

### Design

1. `GET /api/v1/admin/platform/purchase-orders` derives a role-specific DTO. Warehouse receiver/quality/warehouse-operation roles receive only the receipt facts they need: purchase-order and warehouse identity, state, line identity, SKU and planned/accepted/remaining quantities. `supplierId` and `purchaseUnitCents` remain available only to procurement, finance and super-admin roles; an ordinary operator is deliberately not a commercial-data reader. The internal domain model and the protected receiving write path retain purchase cost so payables remain correct.
2. Supplier offers are commercial records too: only procurement, finance and super-admin can list them, and only procurement/super-admin can create or change them. An ordinary operator must receive 403 rather than a redacted price, because an offer ID itself is a supply-source association unsuitable for the operational UI.
3. The administration page renders the procurement amount estimate only for the same commercial-data audience and its public TypeScript DTO marks the sensitive values optional. It does not query supplier offers for an ordinary operator. Warehouse staff can still open the receipt modal and submit fact-only receipt evidence.
4. `registerCustomerClaim` accepts a request audit context and writes `FULFILLMENT_EXCEPTION_CUSTOMER_CLAIMED` through the transaction-scoped store after the exception, allocations and sales-line changes are saved. The audit contains the exception, allocations and exact sales-line before/after values. The route removes its post-commit audit call. A duplicate request returns the prior immutable exception without another audit event.

### Regression and environment verification

1. API regression: a warehouse reader receives no supplier or unit-cost fields, while procurement retains them; an ordinary operator is forbidden from reading or writing supplier offers; the receipt endpoint still accepts the warehouse role.
2. API regression: a customer claim produces one transaction-scoped audit record with sales-line before/after values; exact retry adds neither a second exception nor a second audit row. The in-memory store also snapshots its mutable transactional state so an injected audit persistence failure rolls the customer claim back in tests just as the MySQL transaction does.
3. Run API/admin/miniprogram type checks and tests, root check, coverage, and Mode-B browser E2E. Run the MySQL/Redis integration test and migrations only where both services are reachable; explicitly report a local environment block rather than treating it as a pass.

## 2026-08-13 QA follow-up — final receipt retry, customer refund progress, finance verification and UI E2E

### Goal and compatibility boundary

Close the independent QA findings without changing legacy marketplace records or routes. The scope is limited to Mode-B receipt idempotency, consumer-facing exception/refund progress, finance-review evidence and a repeatable browser workflow. All persistence changes are additive; old receipt rows remain readable and legacy after-sales behaviour stays unchanged for legacy orders.

### Product and technical design

1. A receipt request first locks its purchase order and searches recorded receipt batches by a complete immutable fingerprint. It must return that receipt even after the order reaches `RECEIVED`; only a *new or materially different* batch is rejected by the terminal state guard.
2. Receipt fingerprint evidence includes accepted/rejected quantities, lot number, production/expiry dates, inspection result/note, exception reason and evidence URL. Reason/evidence are stored on the receipt-item fact rather than inferred from a mutable exception.
3. Mode-B orders hide the legacy voluntary after-sales entry after lock. The detail view instead shows SKU-level normal, exceptional and refund progress, including pending, processing, failed and succeeded amounts. Deep links to the legacy page are rejected client-side as well as at the API boundary.
4. Finance confirmation receives a stable per-order, per-line refund calculation: order number, product/SKU identity, exceptional/refunded/current-refund quantities, immutable paid price, order total, refunded/in-flight amount and remaining refund capacity. The confirmation UI renders these values before the irreversible action.
5. A Playwright Mode-B administration workflow is added to the quality gate. It prepares an isolated supplier, SKU, offer, campaign and paid order; performs receipt, sorting, outbound and a one-unit handover shortage; then checks the finance confirmation evidence in the rendered administration UI. CI installs Chromium before the gate; locally it may be run once the browser runtime is installed.

### Additive schema, API and permissions

- Add migration `0031_goods_receipt_retry_evidence.sql` for nullable `goods_receipt_items.exception_reason` and `evidence_url`; no table or historical field is removed.
- Existing receipt and consumer-order endpoints retain their DTO shape and only append fields. Finance permissions remain unchanged; the additional amounts are read-only verification data.
- No service receives a new authority: client hiding does not replace the existing Mode-B server rejection of legacy after-sales/full refunds.

### Red-to-green verification order

1. Add an API regression for a final 8/10 → 2/10 exact retry and an altered evidence/date payload rejection after `RECEIVED`.
2. Add a partial-refund duplicate execution regression that asserts one execution audit event.
3. Extend consumer/refund DTO assertions and mini-program pure presentation tests.
4. Add admin API/UI presentation tests and a browser E2E receipt workflow; then run it from CI.
5. Run the scoped tests, `pnpm check`, coverage and environment-gated MySQL/Redis integration. MySQL/Redis results remain explicitly unavailable until a real service is supplied.

## 2026-08-13 QA P1 corrective increment — replenishment, point authorization, atomic evidence

### Interpreted goal

Resolve the independent QA re-test P1 findings without altering any legacy marketplace order, payment, refund, profit-sharing, settlement, or financial record. Mode-B procurement remains additive: a planned supplier delivery may be accepted in multiple receipt batches, and each qualified batch independently creates inventory and supplier payable evidence. Fulfilment evidence must be written exactly once with its business state, and wrong-point recovery must require authorization for the campaign's bound fixed pickup point.

### Scope and non-scope

- **In scope:** repeatable supplier receipt batches; remaining-quantity validation; resolving a waiting supplier-shortage once replenished; fixed-point authorization and active point/user checks for transfer reinspection; outbound-row serialization and transactional audit evidence; finance line-level refund basis; Mode-B API/browser workflow regression coverage; Mode-B MySQL/Redis integration scenario that runs when the environment is supplied.
- **Out of scope:** modification/deletion of legacy data; supplier portal; wallet/commission/point settlement; automatic supplier payment; changes to the production database environment or Docker daemon. Real infrastructure checks remain executable but cannot be asserted locally while MySQL/Redis are unavailable.

### Design and data model

1. `goods_receipts` is a receipt-batch ledger, not a singleton purchase-order attribute. A purchase-order item may have several receipts; accepted total can only increase up to planned quantity. A duplicate retry returns the same matching receipt; a later batch receives the outstanding accepted quantity and creates its own lot, movement, payable and audit evidence.
2. The purchase order is locked during receipt processing. Supplier-shortage exceptions remain immutable facts and are marked resolved only by accepted replenishment, never by overwriting a previous receipt.
3. The outbound order is locked before first pickup handover. The service returns whether it created the fact, and writes the handover/exception audit records in the same transaction, so concurrent first requests have one factual record and one audit trail.
4. Transfer reinspection requires an active actor, active fixed pickup point and active verifier assignment for that exact point. Only `SUPER_ADMIN` may bypass assignment; no role bypasses quantity, state, or active-entity checks.
5. Exception APIs expose a per-sales-line calculation (`remaining quantity × immutable paid unit price`) for finance confirmation; the UI presents that exact calculation in the confirmation action.

### APIs, permissions and page changes

- `POST /api/v1/admin/platform/purchase-orders/:id/receive` accepts the next receipt batch, returns cumulative receipt progress, and retains compatible original response fields.
- `POST /api/v1/admin/platform/fulfillment-exceptions/:id/transfer-reinspection` enforces fixed-point assignment server-side.
- Existing handover, receipt, exception decision, transfer and partial-refund endpoints move their Mode-B audit writers into the corresponding service transaction.
- The admin procurement view presents remaining quantities and an additional-receipt action. The finance exception list shows SKU/order-line quantity, immutable unit price, amount already refunded and amount due before the irreversible confirmation.

### Development order and acceptance criteria

1. Add red API/service regressions for: 8/10 receipt then 2/10 replenishment; unassigned wrong-point reinspection rejection; concurrent first handover creates one audit sequence; finance response line-basis literal values.
2. Add additive schema/index changes only if the current `goods_receipts` uniqueness rules require them; keep old rows readable.
3. Implement the service/store locking and transactional evidence changes, then run the red regressions green.
4. Exercise the Mode-B admin workflow in a local browser: receipt, exception queue, amount basis, and error/empty states. Add an environment-gated MySQL/Redis Mode-B integration case.
5. Run `pnpm check`, coverage, scoped API/admin tests and the environment-gated integration command. Do not call this a release decision; independent QA retains final acceptance.

## 2026-08-13 Mode B — fulfilment discrepancy and partial-refund closure (current plan)

### QA corrective increment — 2026-08-13

Independent QA reproduced two release-blocking cross-route failures. This increment is deliberately additive and does not alter legacy order, payment, refund, settlement, or financial records.

1. A discrepancy handover must allocate the affected quantity **and** mark every unaffected sales line as fulfilled before it may create a pickup credential. The resulting credential represents only the already fulfilled lines; an all-exception order remains in transit without a code.
2. The legacy full-refund and after-sales routes must reject every `PLATFORM_PROCUREMENT` order at the route and service boundaries. Mode-B refunds are only created from an operator-confirmed fulfillment exception, then executed by finance. This prevents stock release and money movement outside the exception allocation.
3. The warehouse exception request no longer accepts an arbitrary expected quantity. The service derives it from locked, paid sales demand for the campaign SKU, and rejects concurrent unresolved warehouse exceptions for the same SKU.
4. `WRONG_POINT` is a transfer-first branch: operations records `TRANSFER_PENDING`; warehouse/fulfilment records a reinspection before inventory moves from quarantine to handed-over and only the associated allocation is restored to collectible. A direct refund is blocked until the delivery promise window has expired. The factual discrepancy remains immutable; the resolution evidence and inventory movement are appended.
5. The admin exception queue exposes the derived refund basis and provides a guarded warehouse discrepancy registration form. Exception registration, decision, transfer reinspection, and finance execution write before/after audit evidence.

Verification additions: multi-SKU handover with one shortage (unaffected SKU remains fulfilled and collectible), all-short order gets no pickup code, generic full-refund/legacy after-sales rejection for every mode-B state, server-derived warehouse expected quantity, and wrong-point reinspection restoration.

### Goal and compatibility boundary

Add a mode-B-only path for supplier short receipt, warehouse/transit/pickup discrepancies and customer-quality claims. A normal quantity remains collectible while only the confirmed affected quantity is refunded at its immutable sales-line unit price. Existing marketplace rows (`merchant_orders`, `refunds`, settlements, profit sharing and their ledger events) stay untouched and keep their historical behaviour. All schema work is additive in migrations `0027`–`0029`.

### Product flow and roles

1. A receiver/inspector records a factual discrepancy with SKU, expected/accepted/rejected quantity, reason, text evidence and responsibility. The record is not a refund decision.
2. An operator chooses replenishment/transfer, loss, or `REFUND_CONFIRMED`; a delivery handover can therefore complete normally or with an exception.
3. Allocation of a confirmed shortage is deterministic: paid time ascending, then order ID. The system creates order-line allocations, so an order line can be partly fulfilled and partly exceptional.
4. A finance user alone executes the already approved refund. A stable provider refund number is created per discrepancy and a token-fenced, recoverable platform refund is submitted. Duplicate confirmation, clicks, callbacks and recovery cannot exceed the sales-line paid amount.
5. On a discrepancy handover, only orders with at least one fulfilled quantity become `READY_FOR_PICKUP`; the pickup credential represents the fulfilled portion. Orders with no fulfilled quantity remain in transit until their exception is resolved. Pickup staff never determine an amount or create a refund.

### Additive data model

- Extend `sales_order_items` with `fulfilled_quantity`, `exception_quantity` and `refunded_quantity`; snapshots and original paid amount remain immutable.
- Add `fulfillment_exceptions` and `fulfillment_exception_items` for immutable factual evidence plus its operational decision/approval trail.
- Add `fulfillment_allocations` to map each campaign SKU discrepancy to paid-order lines with stable allocation order.
- Add `platform_partial_refunds` for multiple partial direct-platform refunds per payment, including amount, exception ID, stable provider number, lease and claim token.
- Extend pickup handover items with accepted/rejected/short/damaged quantities and reason/evidence fields; retain the old `received_quantity` as the compatible accepted value.
- Add a discrepancy/loss inventory movement type and a `QUARANTINE` bucket. No exception movement ever restores qualified sellable inventory.

### APIs and permission design

- Receiver/quality/warehouse operators register supplier/warehouse facts; fulfilment registers point-handover facts; a picked-up user registers only a factual SKU-level claim. Each route requires a reason/evidence text and enforces its server-side role boundary.
- Operator/customer service confirms the disposition (wait replenishment, transfer, loss, or partial refund); finance is intentionally excluded.
- Finance executes an operator-approved partial refund only, with a confirmation note. `SUPER_ADMIN` has the same data constraints.
- Consumers receive line-level ordered/fulfilled/exception/refunded quantities, exception reason and partial-refund progress in the existing order DTO. There is no post-cutoff “change my mind” partial-refusal endpoint.

### Inventory, accounting, and safety rules

- Supplier payables continue to originate exclusively from qualified receipt quantity. A transit/pickup loss posts inventory to quarantine/loss and does not alter the payable.
- A refund never increases campaign sellable inventory or a qualified lot balance.
- Partial refund ledger entries debit contract liability before pickup or sales revenue after pickup, and credit platform payment clearing. Entries use an idempotent partial-refund reference rather than a merchant commission event.
- MySQL conditional updates, unique exception/refund constraints, stable provider refund numbers, and existing lease/token recovery protect concurrent confirmations, provider callback retries and process crashes.

### Development order and acceptance tests

1. Add plan, types, contracts and additive migrations `0027`–`0029`.
2. Extend stores and direct-platform refund provider support for multiple bounded partial refunds.
3. Implement receipt/handover discrepancy recording, paid-time allocation, operational approval and finance execution.
4. Render discrepancy/refund state in the admin work queue and consumer order detail.
5. Verify: A×2/B×3 with B shortage 1 leaves A×2/B×2 collectible and refunds B×1 only; supplier 8/10 receipt yields payable 8; transit 2 loss after receipt leaves payable 10; duplicate approve/refund/callback is idempotent; legacy routes are unchanged.

### Rollback

Keep `PLATFORM_PROCUREMENT_ENABLED` off to stop new mode-B traffic. Migration tables/columns are additive and can remain unused; do not delete or transform an existing order, payment, refund, payable, ledger transaction, or inventory movement. Existing platform orders without a discrepancy keep their original full-handover behaviour.

## 2026-08-13 模式 B 核心领域重构（现行计划）

### 产品目标

将系统从“多商户撮合、合单支付、佣金分账”的历史模式 A，安全切换为“平台统一采购、统一定价、统一销售、中心仓验收后履约”的模式 B。平台是消费者合同、收款、退款和售后的唯一主体；供应商仅是采购来源，自提点仅是履约场地。首期仅覆盖常温农产品、干货和真空熟食，并继续维持一团一服务区域、一开售前绑定的固定自提点。

### 不可变兼容与切换策略

- 把历史数据视为已真实存在：绝不删除、改写或重算旧 `merchant_orders`、支付、退款、分账、结算、财务流水和审计记录。
- 全部 schema 变化从 `0026` 开始新增；旧表只进入 `legacy-marketplace` 兼容模块，不以改名伪装成采购或仓库模型。
- `campaigns.business_model_version` 和 `orders.business_model_version` 是不可逆路由标识；模式 B 新订单使用 `PLATFORM_PROCUREMENT` + `PLATFORM_DIRECT`，绝不创建 `merchant_orders` 或 `settlements`。
- 发布前由 `PLATFORM_PROCUREMENT_ENABLED` 和 `DEFAULT_BUSINESS_MODEL_VERSION` 控制灰度。生产默认保持 legacy；仅在预发全链路验收、微信平台直连主体和库存期初数据核对完成后才打开模式 B 流量。回滚只关闭模式 B 新建，不回写已经创建的模式 B 订单。

### 模块、表与页面

| 边界 | 模式 B 模块/表 | 一期职责 |
| --- | --- | --- |
| sales | `sales_order_items`、`payments.payment_route`、`platform_refunds` | 平台售价、订单明细、单平台支付/退款、售后 |
| procurement | `suppliers`、`supplier_qualifications`、`supplier_sku_offers`、`purchase_orders`、`purchase_order_items`、`supplier_payables` | 供货关系、采购价、采购需求、应付与线下付款留痕 |
| warehouse | `warehouses`、`goods_receipts`、`goods_receipt_items`、`inventory_lots`、`inventory_movements`、`sorting_tasks` | 中心仓收货验收、批次、不可变库存流水、分拣 |
| fulfillment | `outbound_orders`、`outbound_order_items`、`pickup_handovers` | 出库配送、固定点位交接、交接后开放取货码 |
| finance | 新平台账务事件与科目 | 支付清算、合同负债、销售收入、退款、库存商品、销售成本、供应商应付 |
| legacy-marketplace | 既有 `merchant_orders`、`refunds`、`settlements` 与合单支付/分账代码 | 仅历史订单查询、退款、回调与未完成分账，不接受新模式 B 流量 |

运营后台按“供货与平台商品 → 采购 → 收货验收/库存 → 分拣出库 → 点位交接 → 应付”组织；历史商户结算移至只读兼容区。小程序保持购物车、下单、支付、订单和核销入口，但不展示供应商、商户、佣金或分账，并明确显示平台采购、仓库验收、配送与自提进度。

### 权限、状态机与关键约束

- 新角色：`PROCUREMENT`、`WAREHOUSE_RECEIVER`、`QUALITY_INSPECTOR`、`WAREHOUSE_OPERATOR`。所有采购价、验收、报损、库存调整、出库、交接、应付付款均经过服务端 RBAC 和审计。
- 模式 B 订单：`PENDING_PAYMENT → PAID_WAITING_CLOSE → LOCKED → PROCUREMENT_PENDING → SORTING → OUTBOUND_PENDING → IN_TRANSIT → READY_FOR_PICKUP → PICKED_UP`；退款分支沿用可靠的 `REFUNDING → REFUNDED`。
- 团期锁单后按供应商汇总采购单；合格验收才增加批次可用库存；只有库存流水证明已分拣才可出库；只有实际点位交接成功才可生成取货码。少货、拒收或交接差异创建异常，明确阻断自动部分退款与取货码开放。
- 供应商应付严格等于合格实收数量 × 采购单价；不从消费者零售价、退款或佣金推算。销售收入与成本、采购应付均通过追加式双向记账。

### 开发顺序与验收

1. 更新计划、架构与 PRD，明确双模型、迁移、灰度和回滚。
2. 新增模式版本、供应商/供货关系、采购/仓库/库存 additive schema 与领域类型。
3. 实现模式 B 销售明细、平台直连支付/退款、平台账务，并将 legacy 任务按版本过滤。
4. 实现锁单采购、收货验收、批次库存、分拣、出库与点位交接。
5. 改造后台和小程序契约/文案，冻结模式 A 的新建入口。
6. 补模式 B 全链路、双模型、重复回调、库存并发和迁移兼容测试；执行质量门禁和预发演练。

完成标准：新订单不再依赖 `merchant_id`、佣金、二级商户号、`merchant_orders` 或 `settlements`；未验收/未入库/未分拣/未交接不能推进履约；旧订单仍可支付回调、退款、分账与审计；所有迁移可顺序重复部署且不损失旧数据。

## 当前总原则：先把产品做对，再讨论上线

在消费者和运营人员均认可产品可用以前，**不投入主体资质、支付接入、服务器部署、域名、监控、备份或生产合规等上线事项**。这些工作统一移至最后一个阶段；当前只以产品体验、业务逻辑和运营效率为验收对象。

### 第一优先级：标准社区团购产品完成度

- 消费者不需要解释即可完成“选自提点 → 看商品 → 加购 → 结算 → 看订单 → 取货”的完整体验。
- 首页、商品详情、购物车、结算、订单和“我的”不保留演示感、固定文案或半成品入口。
- 商品、规格、库存、价格、售罄、截团、订单状态和异常提示都以真实业务规则展示。

### 第二优先级：后台运营效率

- 运营不必先手工创建城市；区县、自提点、商品和团期通过预设、批量导入和创建向导完成。
- 后台默认只展示待办与当前任务，避免无关口号、重复数据和需要人工计算的环节。
- 建团、商品上架、订单查询、分拣汇总和自提点履约形成清晰的日常工作流。

### 第三优先级：保定实际规则

- 在标准版被确认后，再加入保定区县、乡镇/村、团长、配送线路、县域差异价格与佣金等特殊规则。

### 最终阶段：上线准备

- 只有前三项通过产品验收后，才开始处理微信支付、真实部署、主体资质、域名、生产数据库、监控和合规。

## 2026-08-10 标准社区团购 MVP 补全

### 产品目标

先完成不依赖保定特殊规则的标准社区团购产品：真实商品资料进入团期，消费者可以浏览商品、加入购物车、批量结算、查看订单详情，运营可以维护商品分类和主图。

### 核心用户与标准流程

- 消费者：选择自提点 → 浏览当前点位可售商品 → 加入购物车 → 确认订单 → 支付 → 查看订单进度 → 到店核销。
- 运营：维护商户和商品 → 审核商品 → 创建团期并选择同区县自提点 → 截团 → 履约 → 售后与结算。
- 自提点人员：确认到货 → 用户凭取货码核销。

### MVP 功能列表

- 商品增加分类和主图字段，后台可以维护图片 URL 并预览。
- 公开团期商品摘要返回分类、主图、规格、价格、库存和销量。
- 小程序首页支持商品分类筛选，不再把团期本身伪装成单个商品。
- 新增标准购物车一级入口，支持加减数量、删除、清空和合计。
- 购物车限定同一团期和当前自提点；切换团期或点位时给出明确处理提示。
- 立即购买和购物车结算统一生成结算草稿，结算页支持多商品。
- 下单请求提交真实商品明细，服务端重新计算价格和校验库存。
- 新增订单详情页，展示商品、自提点、金额、状态与取货入口。

### 非 MVP 范围

- 优惠券、会员价、积分、营销裂变、好友拼团。
- 商品多图相册、视频、富文本详情和对象存储直传。
- 跨团期合并结算、跨自提点购物车。
- 地图定位、距离排序和导航。

### 页面结构

- 一级 Tab：团购、购物车、订单、我的。
- 二级页：商品详情、选择自提点、确认订单、订单详情、取货码。
- 后台商品资料新增分类和主图；其他模块沿用现有任务式结构。

### 后端模块、数据库与 API

- `products` 增加 `category`、`image_url` 字段；新增迁移，不改价格与库存真值模型。
- `GET /api/v1/campaigns` 和详情响应扩充商品摘要。
- 复用 `POST /api/v1/orders` 的多明细能力，不新增购物车服务端表。
- 前端结算草稿只保存 SKU、数量、团期和自提点，最终价格由服务端重算。

### 权限与风险

- 商品维护继续仅限运营角色，审核权限保持双人边界。
- 支付、退款、库存和订单幂等仍由服务端控制；前端合计仅作展示。
- 图片 URL 首期由运营填写；正式上线前应接入对象存储、文件类型校验和内容审核。

### 开发顺序

1. 扩展商品模型、迁移、接口与后台表单。
2. 建立购物车和结算草稿工具。
3. 重构首页、详情与多商品结算。
4. 新增购物车 Tab 和订单详情。
5. 补接口测试、类型检查、构建与实际页面回归。

### 验收标准

- 后台新建商品可填写分类和主图，团期接口返回真实商品资料。
- 用户可把同团期多个商品加入购物车并一次下单。
- 切换到不兼容团期或自提点时不会静默混单。
- 订单详情展示真实商品、自提点和订单状态。
- 不再存在固定商品名、固定价格或固定 SKU 的消费者链路。
- 全量 `pnpm check` 通过。

### Current status

- [x] 商品模型与后台资料
- [x] 购物车与多商品结算
- [x] 订单详情
- [x] lint、typecheck、unit test、build 及后台浏览器验收
- [ ] 微信开发者工具真机画面复核（本轮窗口捕获连接异常）

## 2026-08-10 保定区县服务范围与自提闭环修正

### 产品目标

把错误的“杭州/泛京津冀”演示逻辑收敛为“河北省保定市 → 区县/县级市 → 自提点”，并保证用户选择的自提点真实贯穿浏览、结算、下单、订单和个人中心。

### 功能列表与页面结构

- 后台区域预设改为保定区县，运营无需先手工创建城市。
- 后台服务网络统一使用“服务区县”称谓，自提点按区县归属并支持批量导入。
- 小程序新增可操作的自提点选择页，按保定区县分组展示可用点位。
- 首页、商品详情、结算页和“我的”读取同一份已选自提点。
- 订单创建使用真实已选自提点 ID；订单列表按订单自身的自提点 ID 显示名称，避免历史订单串点。
- 移除小程序固定米粉 SKU/价格逻辑，团期中的真实商品、规格、价格和销量贯穿详情、结算与下单。
- 当前自提点没有可售团期时展示明确空状态，不跨区误售。

### 后端模块、数据库与 API

- 将区域模板从 `JING_JIN_JI` 调整为 `BAODING_COUNTIES`，写入保定市下辖区、县和县级市的行政区划代码。
- 继续复用 `service_areas` 与 `pickup_points`，不新增迁移。
- 复用 `GET /api/v1/service-areas`、`GET /api/v1/pickup-points`；保留区域激活和批量建点接口。
- 扩展公开团期响应的 `items` 商品摘要字段，不新增独立接口或数据库表。
- 内存演示数据统一改为保定市莲池区及其自提点。

### 权限设计

- 消费者只读取已启用区县和 ACTIVE 自提点；下单仍由服务端校验自提点是否属于团期。
- 区域激活和自提点维护继续仅允许 `OPERATOR`、`SUPER_ADMIN`。

### 开发顺序

1. 修正保定区县预设、种子数据、接口类型和自动化测试。
2. 增加共享自提点选择逻辑与选择页。
3. 串通首页、详情、结算、订单和“我的”。
4. 移除小程序硬编码 SKU/价格，并校验团期与自提点同区县。
5. 精简后台区县/自提点文案与导入示例。
6. 执行 lint、typecheck、test、build，并进行实际页面交互验证。

### 测试计划与验收标准

- 区域模板首次激活创建全部保定区县，重复激活不重复创建。
- 项目源码和用户界面不再出现杭州自提点或京津冀一键开通。
- 选择一个自提点后，首页、详情、结算和“我的”显示一致。
- 下单请求提交所选自提点 ID；不属于团期的点位不能错误下单。
- 订单列表显示订单自己的自提点，不依赖当前选择。
- 无点位、无适用团期、接口失败均有可恢复提示。
- 全量检查通过。

### 风险

- 本轮按保定市政府公开口径维护区县清单；定州市及雄安新区托管三县保留在行政清单中，但实际开通与点位投放由运营决定。
- 地址仍为文字，地图定位、距离排序和导航需后续接入腾讯位置服务并补充经纬度字段。

### Current status

- [x] 保定区县预设与演示数据
- [x] 自提点选择及全链路联动
- [x] 真实团期商品/SKU/价格联动
- [x] 团期与自提点同区县双重校验
- [x] 后台区县化调整
- [x] 自动化与页面验收

## 2026-08-10 用户中心与后台信息架构精简

### 产品目标

补齐小程序“我的”一级入口与用户自助闭环；把后台从“一个页面同时堆多种对象”改成按任务切换、一次只处理一种数据。

### MVP 功能列表

- 小程序底部增加“我的”一级 Tab。
- 我的页面展示用户身份、订单状态数量、全部订单、当前自提点、客服帮助与常用设置。
- 订单数量直接读取现有用户订单接口，包含待付款、进行中、待自提和退款/售后。
- 后台商品与商户改为页内二级切换，默认只展示商品。
- 后台服务网络改为区域开通、服务区县、自提点三级切换。
- 页头和面板辅助文案继续精简。

### 页面结构

- 小程序：团购、订单、我的三个一级 Tab；我的页内包含账户、订单、自提点、服务和设置。
- 后台：侧栏保持稳定；商品与商户、服务网络使用页内任务切换。

### Backend modules / Database tables / API list

- 复用现有订单、城市、自提点接口和数据表，本轮不新增后端模块、数据库迁移或外部 API。

### Permission design

- “我的”只读取当前用户订单；沿用既有用户会话隔离。
- 后台权限边界不变，只调整信息展示方式。

### 开发顺序

1. 增加“我的”页面与底部入口。
2. 接入订单状态统计和页面交互。
3. 重构后台商品/商户与服务网络页内结构。
4. 执行 lint、typecheck、test、build 和浏览器检查。

### 测试计划

- 无订单、订单加载失败和多种订单状态均有正确展示。
- 三个 Tab 路径合法，小程序类型检查通过。
- 后台页内切换只展示当前任务，新增操作仍可用。
- 后台桌面和窄屏无横向溢出。

### 验收标准

- 用户可以从底部直接进入“我的”。
- 用户可以看到真实订单状态数量并进入订单页。
- 后台商品页不再同时展示商户表；服务网络不再同时展示模板和两张表。
- 全量项目检查通过。

### 风险与待确认事项

- 微信头像昵称授权受微信平台规则约束，本轮使用安全的默认身份，不强制索取个人资料。
- 售后目前只有订单退款状态，没有独立售后工单模块；“退款/售后”先作为订单筛选入口。

### Current status

- [x] 小程序“我的”一级 Tab 与页面
- [x] 用户订单状态统计与订单筛选联动
- [x] Tab 页面跳转方式修复
- [x] 后台商品/商户页内切换
- [x] 后台区域/城市/自提点页内切换
- [x] 后台浏览器布局与交互检查
- [x] lint、typecheck、build

## 2026-08-10 产品与体验重构

### 产品目标

降低区域开通和自提点配置的人工作业量，并把后台与小程序从“品牌展示型界面”重构为“运营任务优先、消费者商品优先”的社区团购产品。

### Feature list

- 保定 24 个区县/县级市一键开通，重复执行幂等。
- 自提点批量粘贴导入并自动匹配城市。
- 后台工作台、服务网络和全局视觉层级重做。
- 小程序首页、团期详情、结算、订单与取货码视觉重做。
- 本地商品主图接入。

### Page structure

- 后台：工作台、团购活动、商品与商户、服务网络、订单履约、财务结算、操作记录。
- 小程序：团购首页、商品/团期详情、确认订单、订单列表、取货码。

### Backend modules

- service-areas：区域模板和城市幂等开通。
- pickup-points：单点创建与批量导入。
- 既有 campaigns、orders、fulfillment、finance 模块保持合同兼容。

### Database tables

- 复用 `service_areas`、`pickup_points`，本轮无新迁移。

### API list

- `GET /api/v1/admin/network-presets`
- `POST /api/v1/admin/network-presets/:presetId/activate`
- `POST /api/v1/admin/pickup-points/batch`

### Permission design

- 区域激活和批量建点仅 `OPERATOR`、`SUPER_ADMIN` 可执行。
- 保留现有后台登录、RBAC 与审计边界；不改变消费者和财务权限。

### Development order

1. 更新产品说明、实施计划和接口校验。
2. 实现区域预设与批量自提点 API，并补自动化测试。
3. 重构后台工作台、服务网络与全局视觉。
4. 重构小程序核心页面并接入商品图片。
5. 执行 lint、typecheck、test、build 和浏览器视觉检查。

### Test plan

- 区域预设首次激活创建 13 城，第二次激活新增 0 城。
- 自提点批量导入成功；未知城市整批拒绝且给出明确错误。
- 既有下单、支付、结团、履约测试继续通过。
- 后台桌面与窄屏视觉检查；小程序 TypeScript 构建通过。

### Acceptance criteria

- 开通保定服务范围不需要手工逐区县录入。
- 自提点可一次批量录入，不要求先逐个操作城市页面。
- 后台首屏仅展示运营任务和业务数据，不出现装饰性口号。
- 小程序首屏直接呈现自提点、商品、价格、截单/发车和购买入口。
- 全量项目检查通过，无法执行的检查有明确说明。

### Risks

- 地址尚无地图校验；真实上线前需要地图服务与经纬度字段。
- 商品图片仍为演示资产；真实商品需要图片上传、审核和 CDN。
- 生产支付、退款和密钥配置属于高风险能力，本轮不修改其边界。

### Current status

- [x] 产品重构说明与实施计划
- [x] 保定区县区域预设 API 与幂等测试
- [x] 自提点批量导入 API、重复保护与错误处理
- [x] 后台工作台、服务网络与全局视觉重构
- [x] 小程序核心页面与商品图片重构
- [x] 桌面、760px 窄屏和关键操作浏览器验收
- [x] lint、typecheck、unit test、build
- [ ] 真实 MySQL/Redis 集成测试（需要 `RUN_INTEGRATION=1` 和可用基础设施）

## 产品目标

从零建设一个面向河北省保定市下辖区县的多商户家乡美食集单自提平台。平台代商户运营商品，通过可配置团期统一收单、发车和自提，使用合规支付分账能力向商户结算并收取佣金。跨市扩展保留在数据结构中，但不进入首期运营范围。

## MVP 功能列表

- 微信用户登录与会话
- 保定市区县、已开通服务区县和自提点
- 商户、资质和微信二级商户状态
- 平台代运营商品与 SKU
- 可配置团期、截止与失败策略
- 多商户购物车、父子订单和库存
- 微信平台收付通适配层、模拟支付、退款与分账
- 发车批次、采购汇总和自提点分拣
- 到货通知、取货码和幂等核销
- 佣金规则、不可变财务流水、商户结算单和对账
- 售后和履约异常
- 运营后台、商户轻量工作台、自提点工作台
- RBAC、数据权限和审计日志

## 页面结构

### 微信小程序

1. 登录与隐私授权
2. 城市/自提点选择
3. 首页
4. 团期列表/详情
5. 商品详情
6. 购物车
7. 确认订单/支付结果
8. 订单列表/详情
9. 取货码
10. 售后
11. 自提点申请
12. 商户/自提点角色工作台
13. 个人中心

### 运营后台

1. 登录与工作台
2. 商户和资质
3. 商品与审核
4. 城市与服务区域
5. 自提点与申请
6. 团期和规则
7. 订单、退款和售后
8. 发车批次与分拣
9. 佣金、结算和对账
10. 用户、角色和审计日志
11. 系统配置

## 后端模块

- auth
- users
- merchants
- catalog
- service-areas
- pickup-points
- campaigns
- orders
- payments
- fulfillment
- pickup
- commissions
- settlements
- after-sales
- notifications
- audit

## 数据库表

首批迁移优先建立：

- users, roles, permissions, user_roles
- merchants, merchant_qualifications, merchant_payment_accounts
- products, product_skus, food_profiles
- regions, service_areas, pickup_points, pickup_applications
- campaigns, campaign_rules, campaign_skus, campaign_pickup_points
- orders, merchant_orders, order_items, discount_allocations
- payments, payment_callbacks, refunds
- dispatch_batches, allocations, packages
- pickup_codes, pickup_records, fulfillment_exceptions
- commission_rules, ledger_entries, settlements
- after_sales, outbox_events, audit_logs

## API 清单

- Auth：微信登录、刷新会话、退出
- Service Area：开通城市、自提点查询
- Pickup Application：申请、查询、审核
- Campaign：列表、详情、创建、开售、关闭、顺延、取消
- Product：创建、编辑、审核、上下架
- Order：试算、创建、支付、详情、取消
- Payment：支付回调、查询、退款、退款回调、分账
- Fulfillment：采购汇总、批次创建、发车、到货、异常
- Pickup：取货码、扫码核销、手工核销、核销记录
- Settlement：佣金规则、账单生成、执行、对账
- After Sale：申请、审核、退款、关闭
- Admin：用户、角色、权限、配置、审计日志

## 权限设计

- USER：消费者自己的数据
- MERCHANT_CONTACT：指定商户只读/提交权限
- PICKUP_MANAGER：预留的指定自提点管理角色；当前 MVP 尚未建立可审计的点位映射，因此不授予到货确认、核销员授权或全量数据访问权限
- PICKUP_VERIFIER：指定自提点核销权限
- OPERATOR：商品、团期和履约运营
- REVIEWER：商户/商品/自提点审核
- CUSTOMER_SERVICE：用户、订单和售后处理
- FINANCE：退款、佣金、结算和对账
- SUPER_ADMIN：角色、权限和系统配置

所有角色同时受资源范围限制；财务和审计数据禁止物理删除。

## 开发顺序

1. 建立 monorepo、统一 TypeScript 配置、lint、测试和 CI 基础。
2. 实现共享领域包：金额、ID、错误码、状态机、佣金计算和幂等约定。
3. 建立 API、配置校验、健康检查、日志和统一错误响应。
4. 建立 MySQL/Redis 本地环境与数据库迁移。
5. 实现用户、RBAC、商户、资质、服务区域和自提点。
6. 实现商品、SKU、食品信息和审核。
7. 实现团期规则与安全关闭状态机。
8. 实现父子订单、库存、订单试算和创建。
9. 实现模拟支付适配器，再接微信平台收付通、退款和分账。
10. 实现发车批次、分拣、到货和核销。
11. 实现佣金、财务流水、结算和对账。
12. 实现用户小程序、后台和角色工作台。
13. 完成端到端测试、并发测试、安全检查和上线清单。

### 已冻结的首期工程决策

- 服务端：Fastify + TypeScript，按业务模块组织的模块化单体。
- 业务真值：MySQL 8；热点缓存与任务协调：Redis；异步任务：BullMQ。
- 本地演示：内存仓储 + 模拟支付，可在未取得微信资质时跑通流程。
- 生产保护：生产环境强制禁止演示登录和模拟支付。
- 第一纵向切片：创建/开售团期 → 订单试算 → 幂等下单 → 模拟支付 → 截团 → 成团锁单或失败退款。

## 测试计划

### 单元测试

- 金额与优惠分摊不产生分差
- 佣金优先级和计算基数
- 团期规则判断与状态迁移
- 订单状态迁移
- 退款后佣金和应结算金额重算
- 取货码过期、重复和错误处理

### 集成测试

- 并发创建订单不会超卖
- 团期自动关闭与支付回调竞争
- 支付回调、退款回调重复投递
- 父订单拆分多个商户子订单
- 部分退款与账单一致性
- 批次到货后才能核销
- 核销成功后才能进入可结算状态

### 端到端测试

- 用户完整购买与自提流程
- 未成团自动退款流程
- 商户缺货部分退款流程
- 自提点异常上报和售后流程
- 商户申请、自提点申请和平台审核
- 财务生成结算单、执行分账和对账

### 非功能测试

- 热门团期下单与库存并发压测
- 大批量团期关闭和分拣任务
- 权限越权与敏感字段脱敏
- 数据库备份恢复演练
- Worker 重启后的任务恢复

## 验收标准

- 所有核心成功路径和异常路径有自动化测试。
- 支付、退款、核销、团期关闭和分账接口具备幂等保护。
- 金额以分为单位，账单逐笔可追溯且借贷平衡。
- 未开通城市不可下单；自提点查询分页且按城市过滤。
- 商户和自提点只能访问自身范围的数据。
- 后台敏感操作有审计日志和二次确认。
- API、Worker、后台和小程序均能构建并在测试环境启动。
- 无真实支付资质时使用明确标识的模拟适配器，生产配置禁止启用模拟支付。

## 风险与待确认事项

- 一期研发预算和目标上线日期尚未确认，会影响团队配置和并行程度。
- 平台收付通和二级商户进件资质需由主体公司尽快向微信支付确认。
- 小程序账号、备案、域名、服务器和隐私政策尚未准备。
- 佣金基数、优惠承担方、运费承担方和逾期未取规则待业务确认。
- 第一阶段明确禁止冷链、生鲜和现制食品进入可售状态。

## 当前进度

- [x] 市场与开源方案调研
- [x] 产品方向与 0→1 路线确认
- [x] 初版 PRD
- [x] 初版架构
- [x] 实施计划
- [x] 工程脚手架
- [x] 共享领域模型（金额、佣金、团期/订单状态机）
- [x] API 基础（配置校验、健康检查、错误响应、演示鉴权）
- [x] 第一批核心数据库迁移
- [x] 团期—订单—模拟支付—截团纵向切片
- [x] 运营后台基础（总览、团期列表、新建/开售/结团）
- [x] 小程序基础（团期列表、详情、确认订单、模拟支付、订单列表）
- [x] 可事务化仓储接口与内存事务实现
- [x] MySQL/Redis 本地编排和带校验和的迁移执行器
- [x] 并发库存预占测试
- [x] MySQL 业务仓储适配器（团期、库存、订单、幂等和主数据）
- [x] Redis 持久化团期截单任务、重试与生产配置保护
- [x] 商户、商品、服务区域和自提点管理 API
- [x] 真实 MySQL/Redis 集成测试：本机 Docker 环境已验证迁移、建团持久化与 Redis 定时收团（2026-08-11）
- [x] 商品提交审核、审核通过/驳回与审核权限
- [x] 发车批次创建、发车和自提点到货
- [x] 安全取货码、错误码拦截和幂等核销
- [x] 履约数据库迁移与端到端自动化测试

## 最终阶段：正式上线加固计划（2026-08-10）

> 前置条件：必须先完成并验收“标准交易闭环”、“后台运营闭环”和“保定业务规则”。本阶段不与当前产品打磨并行。

### 上线目标

将当前可演示 MVP 升级为可部署、可恢复、可审计、可承载真实资金和订单的生产版本。所有外部资质和密钥通过环境配置注入；在缺少真实微信资料时，代码和测试完成到适配器边界，但不得宣称真实收款已验证。

### 上线阻断项

- [x] 团期独立库存原子预占、取消/退款释放及并发一致性
- [x] 团期状态更新不重建 SKU/自提点映射，数据库采用乐观锁防止重复截团
- [x] 截团任务数据库对账、重试、进程重启恢复和幂等消费（数据库为真值，Redis 为调度器）
- [x] 支付下单、支付回调、退款和退款回调具备签名校验与幂等记录
- [x] 不可变双向财务流水、佣金确认、商户结算单和逐笔对账
- [x] 微信用户会话、管理员密码登录、RBAC 与用户订单范围隔离
- [x] 小程序完成实时订单、订单详情和取货码主闭环
- [x] 运营后台完成商户、商品审核、城市、自提点、履约、订单整单售后、财务和审计页面
- [x] 真实 MySQL/Redis CI 测试定义、并发/恢复/安全和端到端自动化测试
- [x] 生产部署、监控要求、备份恢复、隐私合规和发布回滚清单

### 仍需项目公司在最终验收时提供

- 小程序主体、备案域名、微信认证与类目资质。
- 平台收付通商户号、API v3 密钥、商户私钥、微信支付公钥及各商户二级商户号。
- 可执行 CI 的代码托管仓库或带 Docker 的预发布环境，用于跑真实 MySQL/Redis 与镜像构建门禁。
- 业务确认后的隐私政策、用户协议、退款规则和逾期未取规则。

### 本轮开发顺序

1. 先修复库存、退款、状态更新和截团恢复一致性，并用并发/重复消费测试覆盖。
2. 建立支付适配器、回调记录、退款、账本和结算模型，再完成微信适配边界。
3. 补齐后台和小程序端到端业务页面，确保前后端契约一致。
4. 增加真实基础设施测试与 CI 服务容器，在可用环境执行迁移和恢复验证。
5. 执行上线自审，只将主体资质、商户号、域名和证书列为最终外部输入。

## 2026-08-11 全量界面原型与视觉统一（已完成本轮）

### 产品目标

以已确认的“产地可信感”视觉为唯一基准，先交付一套可点击、可评审的后台与小程序界面原型；产品仍遵循平台统一采购、用户预付、自提点取货的标准闭环，后续再接入保定及全国运营参数。

### 页面与功能清单

- 小程序：服务范围/自提点选择、团购首页、商品/团期详情、购物车、确认订单、支付结果、订单列表、订单详情、取货码、售后申请、我的、未开通地区登记，以及自提点工作人员的到货确认与核销入口。
- 运营后台：今日待办、商品与供应来源、开团向导、团期、服务网络与自提点、订单聚合、仓库收货/分拣、发运/到货、售后、供应商与自提点结算、开通意向和操作留痕。
- 交互原型：主导航、商品加购、同团期结算、自提点切换、订单状态与取货核销的关键路径可操作；不在本轮接入真实支付、物流、认证或持久化新数据。

### 页面结构与视觉规则

- 小程序首页保留轻纸感、深墨蓝、橙红主操作与草木绿可信状态；首页可使用产地图文叙事，交易页降低装饰密度并优先展示自提、价格与状态。
- 后台延续同一色彩语义，但使用白底、任务优先、轻分隔的工作台布局；不使用首页式大字、书法、口号或重复指标卡。
- 全部页面沿用现有 TypeScript、小程序和 React/Ant Design 技术栈，避免以静态截图替代核心流程。

### 后端模块、数据表与 API

- 现有 `campaigns`、`orders`、`fulfillment`、`service_areas`、`pickup_points`、`finance` 契约保持不变；原型阶段用现有演示数据覆盖视觉和流程状态。
- 新增页面若尚无接口，明确标记为原型状态，不伪造已上线的支付、配送或核销结果。

### 权限设计

- 消费者只能看自己的订单与已开放自提点；自提点人员只进入本点到货与核销任务；运营、仓库、履约和财务继续使用既有 RBAC 边界。

### 测试计划与开发顺序

1. 完成小程序和后台的视觉令牌、布局规则与页面清单。
2. 重做小程序核心购买链路与个人/取货入口，再补齐售后、未开通地区和自提点工作态原型。
3. 重做后台工作台与各业务模块的任务型页面布局。
4. 对照已选首页视觉进行同尺寸设计验收，并跑小程序 TypeScript、后台类型检查与生产构建。

### 验收标准

- 小程序首页与已选视觉在纸感背景、墨蓝层级、橙红操作、产地内容和卡片留白上保持一致；不再出现杭州、硬编码京津冀或“多人拼团/团长拉新”表述。
- 消费者能清楚完成“选自提点 → 看商品 → 加购 → 结算 → 看订单 → 取货”的原型路径。
- 后台每个页面只围绕一个运营任务，首页不出现装饰性口号，区域与自提点支持全国层级与“未开通地区意向”而非要求先手工逐城配置。
- 相关类型检查、构建和视觉对照通过；真实支付、第三方物流、资质和生产部署保留为上线前的独立工作。

## 2026-08-11 团期到货点与货拉拉履约（历史方案，已由固定自提点规则替代）

> 历史说明：以下内容记录了曾评估过的“截团后确定临时地点”方案，不能作为当前产品或实现依据。当前正式规则为：团期开售前必须绑定服务区域内已启用的固定自提点；用户下单前确认该点，截团后不得更换已有订单的领取地点。现行口径见本文末尾 2026-08-12 评测整改章节、[履约与界面说明](docs/interface-prototype-map.md) 与 README。

### 产品目标

【历史方案】将原先的“预先维护固定自提点”改造成批次履约模式：用户先按收货区域参加团购；收单结束后，运营与当地合作方协商一个集中领取地点。该方案已废弃，保留仅为需求演进追溯。

### 已确认流程与本轮假设

1. 平台统一采购、定价并按服务区域开团；用户下单后立即支付。
2. 【历史方案】截团后，运营联系目的地的当地合作方，确定一个方便领取的到货地点。
3. 运营在系统中录入地点和约车信息，并人工预约货拉拉；本轮不接入货拉拉开放平台或保存其密钥。
4. 车辆于次日将整批货送至该地点；运营确认到货后，系统为该团期的已付款订单统一开放取货码。
5. 一期假设为“一个团期对应一个收货区域、一个集中到货点”。同一商品需要覆盖多个区域时，先按区域复制开团；后续再扩展一团多区域。
6. 用户下单时只选择“收货区域”，允许地点状态为“截团后确认”；司机姓名、电话、货拉拉订单号仅对履约人员可见。

### MVP 范围

- 小程序：选择收货区域、展示“本团到货点待确认/已确认/运输中/已到货”及确认后的地点、时间；订单与取货码同步展示该状态。
- 后台：把服务网络改为“收货区域与到货点”；开团不再要求配置自提点；履约页按“确认地点 → 预约车辆 → 确认发车 → 确认到货”推进。
- 后端：新增团期配送计划，订单记录服务区域与计划关联；保留原自提点字段的兼容读取，迁移现有 MySQL 数据。
- 数据表：新增 `campaign_delivery_plans`，为 `orders` 增加 `service_area_id`、`delivery_plan_id`；保留 `pickup_points` 仅作历史兼容，不再用于新单校验。
- 接口：公开查询团期配送状态；运营可创建/更新配送计划、登记车辆、确认发车和到货。

### 权限、风险与非范围

- 运营、履约角色可编辑配送计划；消费者只可读取与其订单/团期相关的脱敏信息。司机电话、约车订单号不返回给消费者。
- 订阅消息、地图选点、货拉拉 API、司机实时轨迹、冷链和多区域合单均不在本轮接入；上线前需取得微信订阅消息授权并确认超时未领取、变更地点和退款规则。
- 真实支付已存在模拟适配，不把当前演示支付或人工约车描述为正式生产联通。

### 开发顺序与验收

1. 先扩展领域模型、契约、内存/MySQL 仓储和数据库迁移，并为收货区域下单与配送状态流转增加测试。
2. 【历史方案】调整 API 和后台的团期、区域、履约页面，确保无需预建固定自提点即可开团和履约。
3. 调整小程序选区、首页、下单确认、订单详情和“我的”文案与状态展示。
4. 运行迁移校验、类型检查、测试和生产构建；按真实步骤演练一笔“待确认地点 → 到货可取”的订单。

【历史方案验收标准】运营只需选择收货区域即可开团；截团后能完整记录并推进到货地点和人工货拉拉预约。该验收标准已废弃，当前验收以“开售前绑定固定自提点、下单前消费者可见并确认”为准。

## 2026-08-11 区域目录与运营开通体验修正

### 产品目标

运营人员从系统维护的全国行政区划目录中搜索并选择省、市、区县，再开通或暂停收单；不再填写行政区划代码和区域名称。区县仍是开团与收单的最小范围。

### 功能、数据与接口

- 预置全国省级与首批区县目录，目录条目包含省、市、区县、标准区划代码与展示路径。
- 新增运营端目录查询接口；区域启用接口只接收目录条目的标准区划代码，后端自行创建或启用收货区域。
- 收货区域页改为“已开通区域”与“开通新区域”：搜索、勾选、确认开通，支持暂停收单；保留历史区域和已开团数据。

### 权限、测试与验收

- 仅 OPERATOR、SUPER_ADMIN 可查询目录、开通和暂停区域；消费者只能看到已启用区域。
- 覆盖目录搜索、幂等开通、重复开通、暂停后的下单拦截，以及后台不再出现手填代码/名称。
- 验收：运营从输入地名到开通区域不超过三步，未使用任何行政代码；开团下拉框只出现已开通区域。

### 开发顺序

1. 建立区域目录与契约，替换手工建区接口。
2. 改造运营端开通区域页面和启停动作。
3. 补 API/集成测试、构建与页面回归。

### 本轮验证结果

- [x] 团期创建自动生成“待确认地点”的配送计划；新单按收货区域校验并关联该计划。
- [x] 后台已实现地点确认、人工约车登记、发车与到货确认；未确认地点或未登记车辆时不能创建发车批次。
- [x] 小程序已更新首页、选区、详情、购物车、结算、订单和“我的”的地点状态与文案。
- [x] `pnpm check` 通过：静态检查、类型检查、API 履约测试及所有应用构建均通过；真实 MySQL/Redis 集成测试仍因本机未提供 Docker 环境而跳过。

## 2026-08-11 可运营闭环与消费者登录重建（代码闭环完成；等待外部生产联调）

### 产品目标

把当前“可演示的团购流程”升级为运营人员可以安全维护、消费者可以明确登录并完成购买/领取、现场人员可以核销的可运行 MVP。业务真值为：全国区县按需开通、按区县开团、开售前绑定每团固定自提点、用户预付、截团后推进备货与配送、到货后发码核销。

### MVP 功能列表

- 商品与供货商：查询、新增、编辑、审核、上下架/启停、受引用保护的归档/删除。
- 团期：草稿编辑、复制建团、开售、结团、取消、顺延；一期取消“无新时间的顺延”假流程。
- 团期商品快照：开团时锁定商品资料、售价、库存和佣金，后续商品库变动不影响进行中团期。
- 收货区域与固定自提点：继续使用全国官方目录；团期草稿必须选择服务区域内已启用的固定自提点，新订单校验并记录该点。
- 履约：开售前确认固定点，到货窗口更新、车辆登记、发车、到货、取货码；新增领取点核销工作台。
- C 端：显式微信登录/体验身份、隐私说明、带图标的底部菜单、首次区域选择、订单/售后入口、开通意向提交和订单消息记录。
- 后台：按角色显示允许的菜单与操作；订单退款、财务和审计保持只读/留痕边界。

### 页面结构

- 小程序：团购、购物车、订单、我的；登录状态在“我的”明确呈现，二级页包括选区、商品、结算、订单详情、售后、取货码、开通意向。
- 运营后台：工作台、团期、供货与商品、收货区域、配送与领取、结算、操作记录；另提供受角色保护的现场核销页。

### 后端模块、数据库表与 API

- `products` / `product_skus`：补受状态保护的更新、下架、恢复与草稿删除；`merchants` 补更新与启停。
- `campaign_skus`：保存团期商品快照并以该快照向 C 端返回；`campaigns` 补草稿更新、取消和延期。
- 新增 `service_area_interests`、`after_sales`、`order_notifications`，分别承载开通意向、售后单和站内订单消息。
- API：商品/供货商 CRUD、团期更新/取消/延期/复制、消费者身份、售后/意向/消息、核销工作台所需查询与核销。

### 权限设计

- OPERATOR：商品、供货商、区域、团期；REVIEWER：商品审核；FULFILLMENT/PICKUP_VERIFIER：履约与核销；FINANCE：退款与账务；USER：仅自己的订单、售后、意向和消息。
- 已被团期、订单、财务或审计记录引用的数据不得物理删除；支付、退款、核销和审计保持幂等/不可篡改。

### 开发顺序

1. 更新契约、领域模型、迁移和仓储，先实现商品/供货商 CRUD 与团期快照。
2. 补团期草稿编辑、取消、延期和后端状态保护，移除一期不完整顺延入口。
3. 补售后、开通意向、订单消息与现场核销工作台。
4. 重做后台操作入口、权限呈现与小程序登录/底部图标/关键空态。
5. 执行迁移、API 集成测试、全量静态检查与构建；再由独立产品审查并进行回归测试。

### 测试计划与验收标准

- 商品被在售团期引用时不能下架/删除；草稿且未引用时可删除；商品变更不影响团期商品快照。
- 供货商被商品/团期引用时只能停用，不能删除；停用不破坏历史订单。
- 草稿团期可编辑/复制/取消；延期必须提交新的截单与发车时间；活动团期不能被静默改商品。
- 用户未登录时能看到明确登录入口；微信配置启用时调用微信登录并持久化会话；演示环境明确标识体验身份。
- 底部四个 Tab 均显示未选中/选中图标；售后、意向、消息和核销路径均有成功、空态和失败提示。
- `pnpm check`、MySQL/Redis 集成测试、关键 API 注入测试和独立产品复审均通过。

### 风险与边界

- 真实微信登录、订阅消息和支付依赖主体的 AppID、AppSecret、模板 ID 与支付资质；代码会完成适配与显式降级，但不能在缺少外部凭据时宣称真实平台已联通。
- 开通意向中的联系方式属于个人信息：仅在用户主动提交并勾选用途说明后保存，运营端按最小权限查看。
- 生产数据绝不通过物理删除抹除订单、财务、核销或审计记录。

### 本轮最终验证（2026-08-12）

- [x] 商品、供货商、团期、区域、配送计划、售后与开通意向均提供受权限和状态保护的运营操作；历史引用数据只能停用或归档。
- [x] 团期商品保存不可变快照；跨团期库存分配会扣除其他未结束团期的剩余配额，暂停区域不能新建、开售或恢复团期。
- [x] 地点确认、发车、到货均生成用户可追溯的订单消息；未开启提醒的用户进入后台“待人工通知”队列。
- [x] 订单详情展示售后申请及处理状态；约车后变更地点会自动清除旧约车信息并记录审计。
- [x] `pnpm check`、MySQL/Redis 集成测试、数据库迁移均已通过。

外部上线前置：需由项目主体提供正式微信 AppID/AppSecret、支付商户与回调证书、已审核的订阅消息模板及 HTTPS 域名，才能完成真实登录、支付回调和微信订阅消息的最后联调；本地演示不会伪装成已完成这些外部认证。

## 2026-08-12 最终放行复审修复

### 修复目标

消除复审发现的上线级风险：小程序发布环境不得访问本机地址；用户仅在微信授权成功后才会进入微信订阅消息发送链路，未授权或发送失败必须自动进入人工通知；临时领取地点每次实质变更都必须通知已付款用户；同一 SKU 的团期创建需在数据库事务中加锁；发车、到货和通知重试不得生成重复触达任务。

### 实施与验收

- 小程序采用独立的发布配置：开发环境允许本机 API，体验版和正式版必须填入 HTTPS API 域名；未配置时显式阻止发布运行。
- 三类提醒分别使用已审核模板、当前用户的授权结果和服务端发送结果判断；任何未授权、未配置、无 OpenID 或发送失败均进入客服人工通知队列。
- 通知以“订单 + 业务事件键”唯一约束，地点变更以新的地点版本生成事件；同一发车或到货事件可安全重试。
- MySQL 在创建/修改团期快照前对 SKU 行执行 `FOR UPDATE`，用统一的锁顺序避免并发超分配。
- 新增 API 注入测试覆盖：地点首次确认/变更、重复发车/到货、人工兜底和通知幂等；随后执行完整检查及 MySQL/Redis 集成测试。

### 放行结果（2026-08-12）

- [x] 小程序开发、体验、正式环境地址和订阅模板配置已隔离；正式/体验占位配置会阻止运行。
- [x] 服务端已实现微信订阅消息真实发送、令牌失效重试、失败/未授权人工队列和后台重试入口。
- [x] 地点首次确认、实质变更和撤销均按订单事件触达；重复发车、到货不会重复创建通知。
- [x] `pnpm check` 通过；API 自动化 14 项通过；真实 MySQL/Redis 集成测试 15 项通过；数据库已迁移至 `0016_notification_delivery_idempotency.sql`。
- [x] 产品最终放行复审：无代码级 P0/P1 阻断。

## 2026-08-12 消费者登录可见性修复

### 目标与验收

- 开发演示不能自动跳过消费者身份：用户必须能看见未登录的“我的”页面，并能主动进入体验登录；真实环境继续调用微信授权登录。
- 登录前只展示登录说明、隐私提示和必要帮助；登录后才展示订单、收货区域、消息与售后入口。
- 用户可退出体验身份回到登录前状态，再次登录可恢复；全量类型检查、接口测试和小程序构建通过。

### 结果

- [x] 开发环境默认呈现登录前状态，体验登录与退出均可操作；真实环境保持微信授权登录。
- [x] 提交订单、登记开通意向和订单页均按登录状态保护。
- [x] 小程序类型检查、构建和 API 自动化测试通过。

## 2026-08-12 Release Gate QA 验收

### 产品目标

对已完成的消费者小程序、运营后台、API、数据库迁移与部署配置进行独立的发布验收；以实际可运行行为、自动化测试、安全扫描和界面截图作为证据，而非仅依赖历史自述。

### 验收范围

- 模块：消费者购买/支付/取货/售后，运营商品/团期/区域/履约/客服/财务/审计，API 身份认证与权限，MySQL/Redis 持久化与定时任务。
- 核心流程：选收货区域 → 商品 → 购物车 → 下单 → 支付 → 截团/履约 → 取货码；运营建团 → 地点 → 车辆 → 到货 → 核销；退款与售后。
- 必测异常：未登录、无权限、IDOR、非法/超长输入、重复提交、重复回调、库存并发、过期订单、网络/API 失败、空数据、Token 失效、刷新与响应式界面。

### 发现、最小修复与回归

- Finding `SEC-DEP-001`：依赖扫描发现 `fastify@5.6.1` 命中 GHSA-jx2c-rxcm-jvmq 与 GHSA-247c-9743-5963（请求 Content-Type 解析导致的验证绕过，高危），并命中 GHSA-444r-cwp2-x5xf 与 GHSA-mrq3-vjjr-p77c。
- 根因：API 依赖版本落后于 Fastify 的安全修复版本。
- 最小修复：仅将 `apps/api/package.json` 的 `fastify` 升至 `5.8.5` 并更新 `pnpm-lock.yaml`；未改动业务代码或 API 契约。
- 回归计划：重新运行依赖扫描、lint、typecheck、unit/API 注入测试、构建、可运行 API/后台验收，以及可用时的 MySQL/Redis 集成测试和小程序开发者工具验收。
- Finding `QA-LOG-001`：运营端全额退款将订单完成退款，但未释放该订单先前预占的团期与全局 SKU 库存。
- 最小修复计划：仅在 `PaymentService.requestFullRefund` 首次把可退款订单变更为 `REFUNDING` 的同一事务内，逐明细释放库存；重复退款请求因订单已处于退款终态而不再次释放。新增 API 注入回归用例验证首次释放及重复请求幂等。
- Finding `QA-CODE-002`：API 全量类型检查在全局错误处理器失败，原因是对 `unknown` 异常直接使用 `in` 运算符。最小修复计划：在现有 Zod 错误分支前增加对象且非空的类型守卫，不改变错误响应格式。

## 2026-08-12 Release Gate remaining P1 closure

### Product decision and scope

- `FUNC-001`: implement an auditable full original-payment refund MVP. Customer service may accept or reject a case; only `FINANCE` or `SUPER_ADMIN` may approve a full refund and resolve it.
- Partial refunds, discount allocation, freight allocation, and clawback after successful profit sharing remain out of scope. An order with an existing settlement record must be rejected from automatic refund and remain open for manual financial handling.
- Pickup verification no longer starts profit sharing immediately. Funds stay frozen until a separate, future settlement-window approval exists, keeping after-sales refunds financially safe.
- `QA-SPEC-001`: follow the user's explicit “select pickup point” flow. Orders carry an active `pickupPointId` in the campaign service area; the mini-program chooses it before checkout and displays it on the order.

### Data, API, UI, permissions

- Extend AfterSale with resolution type, refund amount, refund linkage, resolver, note, and resolved time; add an idempotent finance refund-decision API.
- Restore `pickupPointId` to the order contract, validate area/status, and bind pickup verification to the selected point.
- Add a new immutable migration for the after-sales resolution fields and order pickup-point requirement.
- Split customer-service and finance actions in the admin UI; update the mini-program selection, checkout, and order-detail copy.

### Regression and acceptance

- Cover unauthorized approval, reject, duplicate approval, refund/stock idempotency, settled-order rejection, and resolution persistence.
- Cover missing, inactive, and cross-area pickup points, order response data, and pickup verification binding.
- Run migration checks, lint, typecheck, unit/API tests, admin/miniprogram builds, and full `pnpm check`.

## 2026-08-12 UI / UX QA corrective patch

### Product goal

Ensure an operator can discover every primary admin module on a phone, distinguish a failed data request from a genuine empty result, and inspect or act on a campaign without hidden essential columns.

### Feature list and page structure

- The existing admin sidebar becomes a two-column, fully visible primary navigation only at phone widths; desktop and tablet navigation remain unchanged.
- Each admin page shows a clear, retryable data-load alert when one of the data sources required by that page fails. The alert explicitly warns that displayed zero and empty values may be incomplete.
- The campaign page keeps a compact desktop table with campaign status, cutoff, dispatch, delivery status, and actions all visible. At tablet and phone widths, it renders campaign cards with those same facts and actions instead of a horizontally hidden table.

### Backend modules, database tables, APIs, and permissions

No backend module, database table, API, business rule, or permission changes. Existing role filtering and campaign actions are reused unchanged.

### Test plan

- Run admin typecheck, lint, test command, and production build.
- Run the admin against the local API and capture the campaign page at 1280px, 768px, and 390px.
- Force a required page query to fail and verify that the visible page-level alert names the failure, warns against interpreting empty data as real, and retries the failed queries.

### Development order and acceptance criteria

1. Add the page-query failure boundary and retry action.
2. Replace mobile horizontal navigation overflow with visible grid navigation.
3. Reprioritize campaign desktop columns and add responsive campaign cards.
4. A QA reviewer must independently re-check the three breakpoints and an API-failure state.

Acceptance: all primary modules are visible at 390px; no required campaign fact/action is hidden at desktop, tablet, or phone widths; a failed request is visibly distinguishable from a genuine empty state and has a working retry action.

## 2026-08-12 Release Gate remaining P1 closure

### Product goal and feature scope

- Close the audited after-sales money loop with an auditable full-original-payment refund MVP: customer service accepts or rejects a claim; only FINANCE/SUPER_ADMIN approves the full refund. Partial refund remains explicitly out of scope because merchant allocation and settled-fund clawback policy is not defined.
- Restore the explicit customer flow “select fixed pickup point” without redesigning dispatch: each campaign has one active fixed pickup point, every order stores that point, and pickup verification must match it.
- Add a seven-day post-pickup protection period. Pickup moves ledger balances to settleable accounts but does not trigger provider profit sharing; only orders without open claims are settled after protection expires.

### Data, APIs, permissions, and pages

- `after_sales`: resolution type/amount/refund links/resolver/note/time; `orders`: pickup point and picked-up time; `campaign_delivery_plans`: fixed pickup-point foreign key.
- Customer order requests require `pickupPointId`; admin delivery-plan editing requires an active point in the campaign area and locks it once orders exist.
- Customer-service status endpoint supports accept/reject with a reason. Finance-only refund endpoint links provider refund records to the claim and is idempotent. Direct post-pickup refund is rejected so it cannot bypass the claim workflow.
- Admin delivery modal selects an existing fixed point. Mini-program pickup selection, checkout, order creation, display, and pickup verification use the same identifier.

### Test plan and acceptance criteria

- Cover invalid/cross-point order, owner cancellation/IDOR/payment race, finance-only and idempotent refund, post-pickup quality refund without stock resale, no immediate settlement, seven-day delayed settlement, and early-close guard.
- Run dependency audit, lint, typecheck, unit/API tests, production builds, and real admin browser checks at desktop and 390px.
- Accept only with P0/P1 code findings at zero and all executable gates passing; real MySQL/Redis, WeChat payment/login, and Mini Program simulator remain environmental release evidence and cannot be claimed without credentials/runtime.

## 2026-08-12 Real MySQL / Redis runtime closure

### Product goal and scope

- Run the existing backend and admin against the declared local MySQL and Redis configuration, apply every migration, and remove runtime-only failures that memory-store tests could not reveal.
- Keep the fix limited to MySQL persistence/query compatibility and the real infrastructure integration scenario; no business rule or page redesign is included.

### Backend, database, API, and permissions

- Clamp trusted list limits and use bounded text queries because MySQL 8.4 rejects prepared `LIMIT ?` parameters on these paths.
- Convert optional ISO delivery-plan timestamps to `Date` values before writing `DATETIME(3)` columns.
- The integration test follows the production rule by confirming the campaign's active fixed pickup point before opening it. Existing route permissions remain unchanged.

### Test plan and acceptance criteria

- Apply all migrations to a clean dedicated integration database.
- Run the real MySQL/Redis campaign persistence and recovered scheduled-close flow with no skipped test.
- Verify admin orders, refunds, and audit APIs return 200 against MySQL, then reload the visible admin page without its partial-data warning.
- Run lint, typecheck, all tests, and production builds before considering the local runtime gate closed.
- Finding `FUNC-003`：人工调用团期关闭接口时，当前实现未校验截单时间，运营人员可在收单期提前结束团期。最小修复计划：仅在 `CampaignService.close` 中拒绝截单时间前的人工关闭；任务调度调用继续允许按既有关闭流程执行。新增 API 与服务层用例覆盖两条路径。

### Release Gate

- 必须为 0：P0、P1、Security Critical、Security High。
- 必须为 PASS：build、lint、typecheck、核心自动化/API 流程、消费者与运营关键流程。
- 外部依赖验证（真实微信、生产支付、Docker MySQL/Redis、微信开发者工具）若当前环境不可用，不得记为通过，必须作为未完成证据项阻止无条件 Release PASS。

## 2026-08-12 QA 回归修复：消费者未支付订单取消

### Finding 与最小范围

- Finding `FUNC-002`：已登录消费者无法取消误创建的订单；声明的 `POST /orders/:id/cancel` 未实现，小程序也没有入口。
- 本轮仅覆盖订单所有者取消 `PENDING_PAYMENT` 订单：事务内以条件更新取得一次性取消权、释放团期与全局库存、失效已创建但未支付的支付单，并记录审计日志。
- 取消重试返回同一已取消订单且不重复释放库存；非所有者返回拒绝；已支付订单明确返回“请通过售后流程处理”。不在本轮推断或实现已支付取消/退款政策。

### 回归计划

- API 注入测试：所有者取消、重复取消、IDOR、库存恢复、已支付拒绝。
- 小程序：订单详情仅在待支付时显示“取消订单”确认操作；取消结果刷新订单状态。
- 执行 API 定向测试、类型检查和小程序构建；交由独立 QA 复测后再更新 `FUNC-002` 状态。

## 2026-08-12 项目评测整改（研发执行）

### Product goal

Close every code/configuration issue identified by the independent project evaluation that can be safely resolved inside this repository. The release target is a transaction-safe group-buying MVP: payment callbacks cannot lose money during campaign closure/cancellation, checkout is retry-safe, pickup verification is scoped to the assigned pickup point, public APIs disclose only sellable campaigns, and operational reliability is observable and recoverable.

### Feature list / page structure

- Consumer: carry the campaign pickup point into cart and checkout, keep one checkout idempotency key across retry attempts, expose a reachable privacy policy, and validate interest-registration phone numbers.
- Operations: make pickup verification point-scoped; explain disabled pickup actions; keep campaign facts/actions readable without horizontal hiding.
- API: serialize payment/campaign terminal-state changes, reject malformed JSON as a client error, filter public campaigns, provide bounded cursor-based scans, and expose readiness for both persistence and queue infrastructure.
- Delivery: persist notification work before delivery, drain/retry it independently of an operator request, and make production ingress TLS-only at the application boundary.

### Backend modules

- `campaigns`, `orders`, `payments`: conditional state transitions and compensation for late payment callbacks.
- `fulfillment` and auth/store: verifier-to-pickup-point authorization.
- `notifications` and scheduler: durable outbox delivery/retry worker and queue health.
- `core/store`, MySQL store, migrations: locking/query helpers, authorization mapping, and safe migration execution.

### Database tables

- Add an immutable pickup-verifier assignment table with one or more active pickup-point grants per user.
- Add only indexes/columns required for bounded operational scans or durable notification delivery; preserve existing order and payment history.

### API list

- Harden existing public campaign, checkout, payment callback, pickup verification, health, and admin notification endpoints without breaking their response envelopes.
- Add admin-only pickup-verifier assignment management only if existing role management has no safe equivalent.

### Permission design

- `PICKUP_VERIFIER` may verify only orders whose campaign delivery plan is assigned to that verifier. `SUPER_ADMIN` remains the audited break-glass role; broader fulfilment roles retain their documented operations but do not inherit verifier-wide cross-point access.
- Assignment changes require `OPERATOR` or `SUPER_ADMIN` and are audit logged.

### Test plan

- API/service regressions: cancel/close versus payment callback, duplicate callback, late refund, public campaign visibility, malformed JSON, point-scoped verification, persistent checkout idempotency, phone validation, notification retry, and readiness failures.
- Data layer: MySQL conditional transitions and migration runner failure behavior.
- Quality gates: coverage command, lint, typecheck, unit/API test suite, and production builds. Run infrastructure integration tests when local MySQL/Redis is available.

### Development order

1. Establish transaction and authorization invariants with tests.
2. Implement backend/store/migration fixes and durable notification delivery.
3. Fix consumer checkout, privacy, and validation flow.
4. Complete production ingress/readiness/quality-gate configuration and targeted operational UI fixes.
5. Run full regression and independently re-check all originally reported findings.

### Acceptance criteria

- A successful payment cannot leave an order cancelled without a persisted refund workflow, and campaign transitions cannot overwrite a concurrently paid order.
- Retries submit the same checkout request key; public users cannot browse non-open campaigns.
- A verifier assigned to point A cannot verify an order for point B.
- Notifications survive request completion/failure and are retried asynchronously; readiness fails when required queue infrastructure is unavailable.
- `pnpm test:coverage` is executable, source quality/build checks pass, and production configuration does not publish a plaintext public endpoint.

### Risks / confirmations needed

- Real WeChat credentials, a public DNS name, TLS certificate/private key, payment callback verification, and a production MySQL/Redis environment are external release evidence. This repository can enforce their presence but cannot manufacture or validate them.
- Existing production verifier assignments must be created before enabling scoped verification; migration will fail closed for unassigned verifier accounts.

## 2026-08-12 复核整改（第二轮）

### Product goal

- Close the release-blocking findings from the independent post-implementation review without broadening the MVP: point managers must not administer unrelated points, scheduled campaign closure must recover after transient failures, and the campaign must remain consistently purchasable through pre-arrival fulfilment milestones.
- Current fulfillment rule: a campaign is sellable only after its service-area fixed pickup point has been bound before sale; public data contains only the consumer-safe location, arrival window, and milestone status.

### Feature list / API / permission design

- Restrict pickup-verifier assignment management to `OPERATOR` and `SUPER_ADMIN`. The MVP has no auditable pickup-manager-to-point mapping, so `PICKUP_MANAGER` has no grant/revoke or batch-arrival route; those operational actions remain with `FULFILLMENT`, `OPERATOR`, and `SUPER_ADMIN` until that mapping is introduced.
- Permit a granted `PICKUP_VERIFIER` to look up only the order necessary for verification and only after the delivery-plan / assigned-point relationship is validated.
- Treat fixed-point plan states from `SITE_CONFIRMED` through vehicle booking as publicly sellable while the campaign is open; public responses expose only consumer-safe location/time fields.
- Make Redis scheduled-close jobs retry/reconcile after transient worker failures.

### Test plan and acceptance criteria

- Add regressions for cross-point assignment/arrival denial, granted-verifier order lookup, booked-vehicle public visibility and ordering, and retry/reconciliation of failed scheduled close work.
- Strip operations-only delivery remarks from anonymous responses and align written product rules to the pre-sale fixed-point model.
- Re-run lint, typecheck, full tests, coverage, build, MySQL/Redis integration, and production compose validation.

## 2026-08-13 复核 P2 收口

### Product goal

- Close the remaining operational P2 findings without relaxing payment, authorization, or migration safety: repeated payment initiation must be provider-idempotent, operators must understand and manage verifier access through the admin UI, and concurrent deployment processes must serialize schema migrations.

### Feature list / page structure

- Payment API: reuse or safely claim one in-flight payment initiation for an order, so concurrent taps cannot create duplicate provider-side payment requests.
- Admin operations: add a protected verifier-assignment management surface with assignment list, grant, and revoke actions; make unavailable on-site verification explain the missing point assignment or arrival condition.
- Migration delivery: acquire one database-wide migration lock before checking or applying scripts, and release it on every success or failure path.

### Permission design

- Only `OPERATOR` and `SUPER_ADMIN` may see or change verifier assignments. The UI must use the same APIs and role checks as the server; it must not infer authorization from a generic fulfilment role.

### Test plan / acceptance criteria

- Add a concurrent payment-initiation regression proving one provider call and one persisted payment intent for the same order.
- Add admin API/UI regressions for assignment list, grant/revoke actions and actionable verifier-state feedback.
- Exercise migration locking with a database-backed check when MySQL is available; unit-level code must release the named lock in `finally`.
- Re-run typecheck, focused tests, the workspace quality gate, and coverage after integration.
# 2026-08-14 — Mode B 社区团购轻量履约主线（已确认产品调整）

## 产品目标

把一期日常运营收敛为“卖什么 → 什么时候卖 → 发到哪里 → 到了多少 → 谁取走了”。平台仍是销售、支付、退款和售后主体；供应商采购价、点位合作费用与结算保留线下处理。既有 Mode B 的采购、中心仓、批次、分拣、出库、供应商应付链仅作为历史兼容能力保留，不能再是新日常团期的前置条件或主导航。

## 已确认范围与假设

- 新增业务版本 `PLATFORM_COMMUNITY`，支付路由仍为 `PLATFORM_DIRECT`。旧 `LEGACY_MARKETPLACE` 与已存在的 `PLATFORM_PROCUREMENT` 记录、接口、支付/退款/分账/审计均保持可读可处理，绝不转换或删除。
- 一团仍只绑定一个开售前确认的固定自提点；不引入一团多点、冷链、供应商后台、点位钱包、自动结算或第三方物流接口。
- 新版本团期直接使用平台商品与团期售价/可售量快照，不要求仓库、供应商报价、采购单、批次或库存桶。商品可记录仅供内部参考的采购成本/供应商备注，但这些字段不参与消费者订单、退款或点位人员可见 DTO。
- 配送为人工记录：货拉拉/承运平台、运单号、司机、车牌、发车时间、预计到达时间；只有绑定点位的有效负责人现场确认数量后才产生可领取权益。

## 影响面与最小替换策略

| 面向 | 现有强依赖 | 替换方式 | 历史兼容 |
| --- | --- | --- | --- |
| 商品/团期 | `supplier_sku_offers`、仓库和 `campaign_platform_skus` 才能建团 | 新增独立的社区团期商品快照与可售量；直接平台商品建档、发布 | 旧 Mode B 继续读原快照与采购链 |
| 下单/支付 | Mode B 只识别 `PLATFORM_PROCUREMENT` | 新版本以 `PLATFORM_COMMUNITY` 预占社区团期可售量、写平台销售明细、走单平台支付 | 旧合单支付/平台采购直连支付按原路由处理 |
| 履约 | 收货→批次→分拣→出库→交接 | 新增社区配送批次、点位逐 SKU 实到确认；正常数量分配至订单后开放取货 | 旧出库/交接和库存流水不改写 |
| 领取 | 订单级一次性核销 | 销售明细增加已领取数量，核销记录保存逐 SKU 全提/部分提取事实 | 旧订单继续使用原订单级记录 |
| 后台导航 | “采购与中心仓”承载主流程 | 日常主入口替换为“配送与领取”、商品、团期、订单、异常；采购/仓储/历史结算放入只读兼容区 | 兼容接口不删除 |

## MVP 功能列表、页面与模块

1. 工作台：按今天待开团、待发车、待点位确认、待领取、待处理异常生成可操作清单。
2. 商品管理：运营创建/编辑/停用平台商品（名称、分类、图片、规格、默认零售价、可售数量、可选采购成本和供应商备注）。
3. 团期管理：用平台商品创建社区团期，配置本团售价/可售量、开售/截单/提货时间、服务区域和固定自提点；发布后才能公开购买。
4. 配送与领取：运营登记人工运单并确认发车；仅点位负责人可在自己绑定点位确认逐 SKU 实到/短少/破损/错货，并使正常数量进入待领取。
5. 点位核销：六码查询展示订单商品、待领数量与异常数量；支持全提或逐商品部分提货，写不可抵赖操作和审计。
6. 异常与售后：复用统一异常记录，来源覆盖发车前、运输、点位交接、提货现场、售后；点位只能登记事实，运营决定补送/换货/部分退款/全额退款/驳回，财务执行已批准的退款。

## 最小增量数据迁移

迁移 `0032_community_fulfillment.sql` 只新增表、字段、索引和约束：

- 扩展 `campaigns` / `orders` / `payments` 的版本或路由枚举，新增 `PLATFORM_COMMUNITY`，不修改旧行。
- `community_campaign_items`：新团期平台商品快照、团期售价、可售量、预占量；与旧 `campaign_platform_skus` 完全隔离。
- `community_delivery_items`：按配送批次保存应发、实到、短少、破损和证据；配送计划保留人工承运信息与预计到达时间。
- `sales_order_items.picked_up_quantity` 与 `pickup_receipt_items`：保存新版本逐 SKU 已领取事实，旧订单默认为零且不回填。
- `platform_skus` 增加可选 `reference_purchase_cost_cents`、`supplier_note`，仅运营/采购/财务可读；不替代供应商应付或采购价。

回滚只关闭 `COMMUNITY_FULFILLMENT_ENABLED`，停止创建/发布新社区团期；新增表和旧表均保留，已经付款的新订单仍按其不可变版本继续完成或退款。

## API 与权限设计

- `POST/GET /api/v1/admin/community/products`：OPERATOR/SUPER_ADMIN 创建和维护；成本/备注仅 PROCUREMENT/FINANCE/SUPER_ADMIN 返回。
- `POST /api/v1/admin/community/campaigns`、团期发布/截单：OPERATOR/SUPER_ADMIN。
- `POST /api/v1/admin/community/delivery-plans/:id/dispatch`：FULFILLMENT/OPERATOR/SUPER_ADMIN，必须已绑定固定点且已录人工运单信息。
- `POST /api/v1/community/delivery-plans/:id/arrival`：PICKUP_VERIFIER（或超级管理员）且绑定该点位；必须运输中；逐 SKU 数量不得超过应发，重复请求返回已有事实。
- `GET /api/v1/community/pickup/orders/lookup`、`POST /api/v1/community/pickup/verify`：只允许绑定点位的有效负责人；只返回本点订单及必要商品数量，不返回采购成本、供应商、团期配置、收入、退款执行或历史结算。
- 异常决策和退款复用已有服务端权限、审计、部分退款围栏；通用整单退款入口继续拒绝所有 Mode B 订单。

## 开发顺序

1. 先落 schema、领域类型、存储双实现和新版本路由；为社区团期下单/取消/支付增加独立销售明细与库存预占。
2. 实现人工配送、逐 SKU 点位确认、正常数量分配、通知和部分领取的领域服务，保留原采购仓储服务不改语义。
3. 调整 API 契约、服务端鉴权与审计；补重复发车/到货、点位隔离、越权、数量边界和部分退款回归。
4. 将后台主导航改为商品、团期、订单、配送与领取、异常；把仓储/采购/历史结算移至兼容入口。同步小程序订单/领取文案和明细状态。
5. 实跑后台与小程序关键路径，跑迁移、单元/API/真实 MySQL-Redis 集成、浏览器 E2E、lint/typecheck/build/coverage；冻结后交独立项目评测 Agent 复测。

## 验收标准

- 新商品和新社区团期不要求 `supplier_sku_offers`、采购单、中心仓或批次库存；发布且固定点确认后才在小程序可购买。
- 一笔新订单只写平台销售订单/平台支付/销售明细，绝不创建 `merchant_orders`、`settlements`、采购单或供应商应付。
- 发车前必须登记人工物流信息；非绑定点位人员无法看到或确认其他点位配送；重复确认不重复开放领取或重复审计。
- 点位短少/破损仅阻断对应 SKU 数量，其他商品/订单仍可领取；部分提货和部分退款不把订单错误标为全额退款。
- 提货码核销页展示逐 SKU 待领、已领、异常数量，任何全提/部分提货都产生审计事实。
- Legacy 与旧平台采购订单继续可查询、退款和完成历史任务，且不会进入社区新链路。

## 测试计划与风险

- 单元/API：版本隔离、商品/团期创建、付款预占、运单/发车顺序、点位授权与隔离、重复到货、数量不一致、全提/部分提、异常和部分退款金额上限。
- 真库：0032 迁移可重复执行；并发点位确认、并发核销、支付/退款回调与旧 0026–0031 数据并存。
- 浏览器/小程序：运营创建商品→团期→发车→点位确认→有码查询→部分/全部领取；空态、403、重复提交、窄屏；证据/trace 由 CI 上传。
- 高风险：支付、退款、数量、权限和历史财务数据。所有新路径须按 `business_model_version` 显式分支，不能以旧 merchant/warehouse 字段推断。
