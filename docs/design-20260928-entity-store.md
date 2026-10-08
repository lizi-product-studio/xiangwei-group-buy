# B 档：实体化 MySQL 持久化设计

> 状态：设计提案，供评审与后续实施拆分；不是迁移脚本、生产变更或迁移窗口批准。
>
> 基线：整体优化方案 `docs/task-20260928-overall-optimization.md`（主工作树当前 HEAD `29cc56ed43a78c5d5913af9993068150bea0415e`）；本工作树 API 接口基线 `2ef33815e7134747ea3b590c06d01a0f39852f8e`。主工作树与本工作树在本设计涉及的 A 档 API 代码上对应同一实现。接口和实体类型以 `apps/api/src/modules/core/store.ts`、`apps/api/src/modules/core/types.ts` 为准。

## 1. 目标与不变量

当前 MySQL 持久化以 `community_product_state(id=1, payload)` 保存完整 `MemoryState`。每次事务读取、反序列化、修改并写回整个 JSON；随历史订单、履约和审计数据增长，单请求的内存与序列化成本也随总历史增长。B 档把持续增长的业务集合拆成实体行，让每个 `CommerceStore` 方法只读取或更新它需要的行。

设计须维持这些边界：

- 保留 `CommerceStore` 业务接口和既有状态转换、金额、库存、回调验签、退款恢复、通知重试及审计语义；除非单独评审 API 分页契约，不在本次持久化改造里改变业务行为。
- 第一版仍用 `community_product_state(id=1) FOR UPDATE` 作为全局写事务互斥锁。实体拆表用于缩小读取与写入范围，不意味着放开并发写入或改为行锁竞争。
- 读取快照使用一个只读、可重复读的一致性事务，不拿全局写锁；快照中的多个实体查询来自同一数据库时点。
- 所有业务集合均保留。审计、回调幂等、支付/退款恢复、通知和其他历史记录不做自动清理；保留策略是后续独立决策，不阻塞 B 档实施。
- 不在此迁移中引入 Redis 作为会话权威存储；认证会话继续落 MySQL，避免 Redis 数据丢失造成所有用户退出。
- 不把生产数据复制到测试机。迁移演练用合成数据；隔离恢复演练沿用现有受控流程。

## 2. 实体行与存储约定

每个实体表建议包含稳定主键、原始业务 JSON 文档、必要的查询投影列及时间列。JSON 文档保留完整类型字段；投影列只服务已存在的过滤、排序、唯一性或恢复扫描。投影列的写入和 JSON 文档必须在同一事务中完成，不能形成双重事实源。

金额保持当前整数分语义。可索引的金额投影用 `BIGINT`，不做浮点换算；所有唯一约束须先由迁移前数据扫描证明成立。自然键和投影列均需支持从原 payload 重建。

低变更配置集合可继续作为 singleton 配置 JSON，避免为静态小表增加无收益的复杂度：服务区域、自提点、商品 SKU、分类、首页 Banner、访问角色、内部员工及员工点位分配。`CommerceStore` 对这些配置的读取仍只加载其配置集合，不加载订单等业务历史。若容量测试显示其独立增长，之后可按相同实体模式拆出。

### 2.1 表清单和访问索引

以下是逻辑表名建议；最终命名遵守现有 MySQL 命名约定。`doc` 表示完整业务 JSON 文档。索引以 `CommerceStore` 当前读取路径为目标，不预先添加未被调用的通用索引。

| 集合 / 建议表 | 主键、唯一性与查询投影 | 直接服务的 `CommerceStore` 方法 / 说明 |
|---|---|---|
| 消费者与用户 `commerce_users` | `id` 主键；`wechat_open_id` 唯一（允许多个 NULL）；`consumer_number` 唯一且仅消费者可有；按需投影 `is_consumer`、创建时间 | `findUserByWechatOpenId`、`getUser`、`listConsumerUsers`、`saveUser`、`allocateConsumerPublicNumber`。公开编号用独立 `commerce_sequences(sequence_name,value)` 行原子递增；迁移时以已分配最大编号和旧 sequence 值较大者初始化，保留未分配消费者校验。 |
| 隐私同意 `commerce_privacy_consents` | 复合主键 `(user_id, document_version)`，必要时按 `accepted_at` 过滤 | `savePrivacyConsent`、`getPrivacyConsent`。 |
| 登录会话 `commerce_auth_sessions` | `token_hash` 主键；索引 `(user_id, expires_at)`、`(expires_at, token_hash)`；只保存哈希和原会话字段，不保存明文令牌 | `getAuthSession`、`getActiveAuthSession`、`saveAuthSession`、`deleteAuthSession`、`deleteAuthSessionsByUser`、`listExpiredAuthenticationData`、`deleteExpiredAuthenticationData`。会话继续以 MySQL 为权威。 |
| 密码修改令牌 `commerce_password_change_tokens` | `token_hash` 主键；索引 `(user_id, expires_at)`、`(expires_at, token_hash)` | `getPasswordChangeToken`、`savePasswordChangeToken`、`deletePasswordChangeToken`、过期认证数据扫描/删除。 |
| 管理员凭据 `commerce_admin_credentials` | `username` 主键；`user_id` 唯一；仅存既有安全哈希字段 | `findAdminCredential`、`findAdminCredentialByUserId`、`saveAdminCredential`。 |
| 用户角色 `commerce_user_roles` | 复合主键 `(user_id, role)`；反向授权检查按 `(role, user_id)`；保存 `authorization_version` 所属用户 | `replaceUserRoles` 及认证/授权读路径。角色更新与用户授权版本在同一事务更新。 |
| 小型配置 `community_product_state` 内配置节点 | 现有 singleton 行继续作配置源；区域/点位/目录等列表按现有配置键过滤，保持 ID 唯一校验 | `list/save/deleteServiceArea`、`list/save/deletePickupPoint`、SKU、分类、首页 Banner 对应方法。该行 payload 不再承载增长型业务集合。 |
| 营销团期 `commerce_campaigns` | `id` 主键；索引 `(service_area_id, status, cutoff_at)`、`status`；完整团期 JSON 含库存版本 | `listCampaigns`、`getCampaign`、`getCampaignForUpdate`、`saveCampaign`、`updateCampaign`、`deleteDraftCampaign`、`hasCampaignBusinessReferences`、`reserveCampaignInventory`、`releaseCampaignInventory`。引用检查按 `campaign_id` 查询对应业务表，禁止扫全状态。 |
| 团期商品 `commerce_campaign_items` | 复合主键 `(campaign_id, catalog_sku_id)`；索引 `catalog_sku_id`；库存预留数为整型投影并与 doc 同事务 | `replaceCampaignItems`、`getCampaignItem`、团期库存预留/释放。 |
| 幂等记录 `commerce_idempotency` | 主键 `(actor_id, idempotency_key)`；索引 `expires_at`（若现有记录确有到期字段）；保留 `fingerprint`、`order_id`、可选 `checkout_batch_id` | `getIdempotency`、`getIdempotencyForUpdate`、`saveIdempotency`；公开编号分配器迁移到独立 sequence 后不再占用特殊幂等键。普通业务幂等历史不清理。 |
| 订单 `commerce_orders` | `id` 主键、`order_no` 唯一；索引 `(user_id, created_at, id)`、`(campaign_id, created_at, id)`、`(pickup_point_id, status, created_at)`、`(status, expires_at)`、`(delivery_plan_id, status)`；投影金额为整数分 | `listOrdersByCampaign`、`listOrdersByUser`、通用/过期订单列表、`getOrder*`、`saveOrder`、状态变更/取消/支付确认。按已有调用的过滤和排序顺序建索引；返回全部的现有 Store 方法仍可能返回其所需集合，接口分页是另行评审项。 |
| 订单行 `commerce_order_lines` | `id` 主键；索引 `(order_id, id)`、`(campaign_id, order_id)`；保存商品快照、数量、单价/行金额分及履约数量 | `saveOrderLines`、团期行列表、订单行更新、`listOrderDeliveryFacts`。旧订单行若没有 `campaign_id` 投影，迁移时从所属订单补齐并校验；订单与行金额必须一致。 |
| 结账批次 `commerce_checkout_batches` | `id` 主键；`out_trade_no` 唯一；`order_id` 检索索引（订单到批次关系可单列 `commerce_checkout_batch_orders`，复合主键 `(checkout_batch_id, order_id)`，反向索引 `order_id`） | `get/saveCheckoutBatch*`、按订单/支付单号读取。保留批次订单顺序、金额及状态。 |
| 支付 `commerce_payments` | `id` 主键；索引 `(order_id, created_at)`、`(checkout_batch_id, created_at)`、`(status, initiation_lease_until)`；provider 交易号仅在迁移确认现有业务唯一后加唯一约束 | `getPaymentByOrder*`、`savePayment*`、支付发起认领及回调状态落库。支付 provider payload、重试/认领字段原样保留。 |
| 支付批次 `commerce_payment_batches` | `id` 主键；`checkout_batch_id` 唯一（只有迁移数据验证该既有语义后落约束）；索引状态/认领期限 | `getPaymentBatchByCheckoutBatch*`、`savePaymentBatch`、批次发起认领方法。 |
| 支付回调去重 `commerce_payment_callbacks` | `event_id` 主键；`body_hash`；保存首次处理时间和必要原始状态；相同事件 ID 不同 body hash 仍按现有逻辑判为不一致 | `claimPaymentCallback`。回调幂等记录是财务安全历史，不做自动删除。 |
| 全额退款 `commerce_order_refunds` | `id` 主键；`order_id` 唯一（当前内存 Store 明确拒绝同订单第二笔全额退款）；`provider_refund_no` 非空时唯一；索引 `(status, next_attempt_at)`、`submission_lease_until` | 全额退款查询、保存、认领及状态条件更新、待恢复列表。退款恢复次数、租约和 provider 状态完整保存。 |
| 部分退款 `commerce_partial_refunds` | `id` 主键；provider 退款号在现有规则可确认唯一后建唯一索引；索引 `(order_id, created_at)`、`(exception_id, status)`、`(status, next_attempt_at)`、`submission_lease_until` | 按 ID/订单/provider 编号读取，待处理和异常列表、保存/认领/条件更新。 |
| 账务流水 `commerce_ledger_transactions` | `id` 主键；唯一业务键 `(reference_type, reference_id, event_type)`；索引 `(reference_id, created_at)` | `appendLedgerTransaction`、`listLedgerTransactions`。原流水及 debit/credit 明细完整保留，唯一冲突返回既有“已存在”结果。 |
| 审计 `commerce_audit_logs` | `id` 主键；唯一 `(request_id, action)`；索引 `(resource_type, resource_id, action, created_at)`、`created_at` | `saveAuditLog`、`findLatestAudit`、`listAuditLogs`。历史审计不做自动清理。 |
| 配送计划 `commerce_delivery_plans` | `id` 主键；索引 `(campaign_id, pickup_point_id)`、`(pickup_point_id, status)`；不假定 campaign 单计划唯一 | delivery plan 查询/保存/更新方法及 `listOrderDeliveryFacts`。 |
| 配送批次 `commerce_dispatch_batches` | `id` 主键；索引 `(campaign_id, status, created_at)`、`delivery_plan_id` | dispatch batch 查询/保存方法。 |
| 提货凭证 `commerce_pickup_credentials` | `order_id` 主键；`code_hash` 可建普通检索索引，确认现有代码约束后才可唯一；索引 `(status, expires_at)` | 提货凭证读取、保存和核销查找。永不明文保存实际提货码；需维持订单号/验证码现有冲突处理。 |
| 提货记录 `commerce_pickup_records` | 复合主键 `(order_id, delivery_plan_id, verifier_id)`，忠实映射当前 Set 元组；索引 `(order_id, delivery_plan_id)` | `pickupRecordExists`、保存提货记录。 |
| 提货回执 `commerce_pickup_receipts` | `id` 主键；唯一 `(order_id, pickup_request_id)`；索引 `(order_id, created_at)`、`created_at` | 回执按请求读取、按订单/全量列表、`saveCommunityPickupReceipt`。唯一冲突返回 false。 |
| 到货确认 `commerce_delivery_confirmations` | `id` 主键；`dispatch_batch_id` 唯一（当前保存逻辑拒绝重复批次确认）；索引 campaign/plan 查询 | `getCommunityDeliveryConfirmationByBatch`、`saveCommunityDeliveryConfirmation`。 |
| 履约异常 `commerce_fulfillment_exceptions` | `id` 主键；索引 `(order_id, client_request_id)`、`(registered_at, id)`；迁移确认语义后为订单+请求号加唯一约束 | 异常按 ID/订单请求读取、限量列表、保存。异常明细行独立实体化，避免不断增长的 `items` 数组继续扩大单行。 |
| 履约分摊 `commerce_fulfillment_allocations` | `id` 主键；索引 `(exception_id, order_id)`、`(order_id, order_line_id)` | 分摊列表/保存/标记已退款。更新退款数时与关联订单行在同一全局写事务。 |
| 分摊草稿 `commerce_fulfillment_allocation_drafts` | `id` 主键；`delivery_id` 索引；是否唯一按当前 get/save 语义和迁移数据验证确定；草稿明细可用子表 | 草稿按配送读取、保存。 |
| 提货窗口 `commerce_pickup_windows` | `order_id` 主键；索引 `(status, deadline_at, order_id)`、`deadline_at` | 窗口读写、超期列表、按截止时间及状态批量扫描。 |
| 取消申请 `commerce_cancellation_requests` | `id` 主键；`order_id` 普通索引；`(status, created_at)` | 按订单读、列表/待处理列表、保存。若业务允许一个订单多次申请，不增加未证实的 order 唯一约束。 |
| 品质案件 `commerce_quality_cases` | `id` 主键；唯一 `(order_id, client_request_id)`；索引 `(order_id, created_at)`、`(status, created_at)`；案件明细可独立子表 | 品质案件按订单和请求读取、列表、保存；保持当前重复请求判定。 |
| 区域意向 `commerce_service_area_interests` | `id` 主键；索引 `(user_id, created_at)`、`(service_area_id, status, created_at)` | 保存、单条读取、全量及按用户列表。 |
| 通知 `commerce_order_notifications` | `id` 主键；`event_key` 唯一；索引 `(status, next_attempt_at, created_at)`、`(status, submission_lease_until)`、`(user_id, created_at)`、手动处理状态+时间 | 通知创建/认领/提交/重试/已发送/未知/已读/人工完成及用户/人工队列读取。保留完整状态和投递事实。 |
| 通知偏好 `commerce_notification_preferences` | `user_id` 主键 | 偏好读写。 |

**增长型嵌套数组：**`Campaign.items`、订单 `items`、异常/配送确认/提货回执/品质案件/分摊草稿中的明细，应在实体表的 JSON 文档之外拆成可按父实体取回的子表行；其父子写入仍处在同一事务。读方法只为所需父 ID 取明细。固定大小的供应商响应、少量状态快照可保留在 JSON 文档中。

**表清单覆盖核对：**`MemoryState` 中所有集合均已分配到上述实体表或小型配置节点：users、privacy、sessions、passwordChangeTokens、credentials、roles、accessRoles、staff、staffPoints、areas、points、catalog、categories、homepageBanners、campaigns、idempotency、orders、checkoutBatches、lines、payments、paymentBatches、callbacks、orderRefunds、partialRefunds、ledger、audits、plans、batches、pickupCredentials、pickupRecords、pickupReceipts、deliveries、exceptions、allocations、drafts、windows、cancellations、quality、interests、notifications、preferences。实施时逐个核对 `CommerceStore` 接口，不能漏掉任何方法或集合。

## 3. 访问、事务和一致性边界

### 写事务

所有写方法和 `transaction` 在同一个 MySQL 连接/事务中执行：先锁定 `community_product_state(id=1)`，再对实际实体行做定向读写。原先 `get*ForUpdate`、认领和条件更新仍保留其可见语义；可用条件 `UPDATE ... WHERE status=? AND ...` 防止状态覆盖，但全局锁依旧是并发写边界。事务中不调用微信支付、通知供应商或其他外部网络；只在事务提交后执行外部副作用，并沿用已有幂等和恢复记录。

单个状态转换涉及订单、库存、支付、退款、账务或履约时，相关实体行和审计/幂等记录同事务提交。失败整体回滚，不能出现只写入订单主行而没有行项目、资金流水或请求去重记录的中间结果。序列分配也使用同一事务内原子递增，不通过全表扫描求 max。

### 只读快照

`readSnapshot` 在一个只读 `REPEATABLE READ` 一致性事务里，通过同一连接加载其契约要求的数据，再组成当前快照类型；不得拿 singleton 全局写锁。明确设置隔离级别和一致快照时点，确保跨表读取期间并发提交不会形成半旧半新的快照。只读 facade 拒绝写方法和嵌套写事务。

实体化后的 Store 实现不得重新把所有实体行 hydrate 成完整 `MemoryState`，也不得为兼容旧快照而在每次 API 请求中从 legacy payload 扫描。每个 Store 方法直接执行对应的主键/索引查询。当前返回集合的接口可按当前使用语义返回结果集；订单和其他大集合的分页契约如需改变，应单独评审，且容量验收应记录哪些调用仍是全量列表。

### 索引与查询计划

索引字段取自现有 Store 谓词和排序：订单状态/过期时间、用户/团期/点位，回调/支付/退款认领租约，通知重试，按订单和请求号幂等读取，履约期限扫描，以及审计按资源取最新。实施验证需用生产同版本 MySQL 的 `EXPLAIN` 抽查这些真实查询，并检查索引不会改变 NULL、多记录或排序语义。先核验历史数据再加唯一索引；发现重复时应停止迁移并报告，不自行丢弃/合并记录。

## 4. 兼容迁移与切换

迁移是一次明确维护窗口内的全量权威源切换；不做无验证的双写。使用加法 DDL，保留 `community_product_state.payload` 原值及其哈希，直到用户另行批准后续清理。迁移状态至少记录版本、legacy 快照哈希、开始/完成时间、各集合处理进度与核对结果。DDL 存在隐式提交，因此步骤必须可重入，不能假设 DDL 与数据插入共用一个原子事务。

### 预备阶段（不改生产数据）

1. 冻结 B 候选代码与迁移脚本；在隔离环境用合成规模数据执行一次完整演练，包括从中断点恢复、重复运行、索引构建及时间/资源记录。
2. 核实正式库当前版本、源 payload 大小和集合计数，检查计划唯一约束对应的数据是否有重复；不输出敏感字段。
3. 复用适用的生产备份，并完成独立隔离恢复演练；确认恢复所得数据库与源版本、迁移候选匹配。不能把“备份成功”写成恢复成功。
4. 批准具体迁移窗口、用户影响、进行中支付/退款/回调/调度任务处理办法，以及旧快照和备份保留安排。未批准时只可继续离线演练，不能切正式流量。

### 正式切换步骤

1. 在窗口开始后停止所有 API 写入者、定时任务及其他可能改库的进程；确认支付、退款回调/恢复器及通知发送不会和快照导入并行写入。对不能确认可自动重试的外部回调，先按供应商行为制定并演练应答/补偿方式。
2. 取得一致数据库快照，将旧 singleton JSON payload 原样复制为不可变 `legacy_snapshot`（保存 SHA-256、源 `schema_version` 和时间）。正式步骤也可继续直接使用原 payload，但独立副本用于保证迁移输入不会被后续代码覆盖。
3. 运行幂等、可续跑的实体导入。建议以版本化 `JSON_TABLE`/等价应用解析从冻结快照导入；使用稳定自然键和 `INSERT ... ON DUPLICATE KEY UPDATE`，更新只能来源于同一冻结快照。每集合记录完成标记和行数。导入中断时保持写入冻结，从相同快照重跑。
4. 完成核对：每个集合记录 legacy 元素数、实体行数、重复键数；金额比对订单总额、订单行金额、支付成功额、全额/部分退款金额、账本借贷总额和逐业务引用明细；检查订单行/团期库存、结账批次/订单、支付与回调、退款恢复、通知 event key 等引用关系。差异必须为零，金额精确到分。不可将重复或孤儿行静默忽略。
5. 启动使用实体 Store 的候选版本但保持维护模式；以只读和受控探测核对查询计划、健康、版本标记、关键订单与财务记录抽样。写入验收和外部支付链路验证按单独批准方案处理，不能在此期间生成真实交易。
6. 所有核对通过后，原子更新持久化格式/迁移状态标记为 entity-store，启动单一写入实例并观察核心链路。确认当前进程版本、数据库标记、存储行数摘要和健康状态一致后，才结束维护窗口。
7. 保存本次迁移脚本版本、源/目标计数与金额摘要、快照哈希、执行日志和检查结果；日志不得包含 token、手机号、openid 或支付凭据。

### 失败、重跑与回退条件

- DDL 或导入在窗口内失败：保持维护模式和写冻结；根据迁移状态从同一 legacy 快照重跑。新实体行只允许由幂等迁移重建或补齐，禁止临时编辑账务数值。无法解释的差异立即停止切换。
- **新 Store 尚未接收任何生产写入：**若只读核验或健康检查失败，可将应用切回旧 adapter、恢复旧存储标记并继续使用未改动的 legacy payload；保留失败实体表和证据供调查。
- **新 Store 已接收生产写入：**不能把应用直接切回旧 JSON 快照，因为快照不包含切换后的订单/支付/回调等写入，会造成数据丢失。默认执行前向修复。只有在实现并演练了反向导出、冻结全部写入、将所有实体和嵌套子表重建为 JSON、通过同一行数/金额/引用核对且确认无并发新写入后，才能将反向迁移作为回退路径；在该能力未实现和验证前，切换后视作前向恢复点。
- 不得因迁移失败清空旧 payload、实体表、日志或回调；不以“回滚”名义重建/删除业务历史。

## 5. 30–50 个自提点容量验收

上线 B 档前在受控测试机对与候选相同的 API 版本、MySQL 主版本和必要 Redis 配置执行容量测试。只写入合成用户、商品、订单、支付结果、账本、通知、提货及履约记录；不复制生产数据或真实凭据。

最低数据规模：50 个点位 × 每点每日 30 笔订单 × 连续 90 日，即至少 135,000 笔订单；订单明细按真实交易形态生成，包含多商品订单、支付批次、回调去重、账务借贷、通知重试、提货记录和退款/履约异常样本。保留累计历史，不能只测刚创建的一天数据。

通过标准：

- 在目标数据规模下，API 进程峰值内存低于 300 MiB，零 OOM；订单创建/支付状态读取、点位订单列表和提货码核销路径的 p95 均低于 500 ms。报告环境、并发/请求速率、预热方式及测量窗口，不能只报最佳单次。
- 迁移前后集合计数、订单/支付/退款/账本金额和关键引用完全一致；重复运行迁移不会新增重复记录或改变金额。
- 通过契约测试与直接回归：库存保留/释放，checkout 幂等，支付批次与 callback 去重，退款认领/重试恢复，账本只追加一次，审计不丢，通知重试与人工队列、到货及提货核销语义不变。
- 用查询计划和运行指标证明请求只读取相关实体/索引范围；接口请求不再加载全部订单历史或完整 MemoryState。记录返回集合本身仍可能是大集合的方法，以便后续分页治理。
- 演练一次在每个主要迁移边界中断后恢复；恢复时间必须落在已批准维护窗口内。超过窗口预算、出现漏行、重复键、金额差异、内存超限或慢查询时，验收失败，不进入正式切换。

## 6. 最小实施切片与顺序

切片是开发和验收检查点；生产仍使用旧实现，直至所有集合、方法及兼容性核对完成后统一切换，避免一半写旧 JSON、一半写新表的双权威状态。

1. **契约与迁移骨架：**以现有 `CommerceStore` 完整接口建立 MemoryStore/MySQL adapter 行为契约；新增迁移状态/快照哈希结构、测试用 schema、实体表基础与索引核对工具。确认事务、只读快照、数据库时钟和关闭连接语义。
2. **用户与请求基础实体：**用户、隐私同意、MySQL 会话、密码令牌、管理员凭据/角色、幂等、编号序列、审计。核验授权版本、过期扫描、无损编号继续分配。
3. **交易核心实体：**团期/团期商品、订单/订单行、结账批次、支付/批次、回调、全额及部分退款、账本。先完成金额、库存、支付和退款状态矩阵回归；任何语义差异都不得继续切片验收。
4. **履约与通知实体：**配送计划/批次、提货凭证/记录/回执、到货确认、异常/分摊/草稿、提货窗口、取消、品质案件、区域意向、通知/偏好。覆盖各幂等键、查询窗口及全部子明细。
5. **方法覆盖与容量门：**逐一映射 `CommerceStore` 每个方法到实体查询/事务；在 135,000 订单规模通过容量、内存、迁移可重跑、行数与金额核对。
6. **冻结候选与正式切换：**独立冻结版本，完成备份/恢复和维护窗口批准，执行第 4 节的统一迁移流程。正式上线前不删除 legacy 快照，也不加行级并发或读副本。

可以先实现任一模块的表、adapter 和测试，但不得对生产单独迁移一组集合后留下两种事实源。若要采用在线分批导入、双写或按集合渐进切流，须另行设计并审查一致性、回调重放和回退，不属于本提案。

## 7. 正式迁移前需要用户明确的决定

这些是进入生产维护窗口和数据副本管理前需要的具体决定；不要求用户现在决定历史记录保留期限。系统默认永久保留现有历史集合和 legacy 快照，等待以后另行批准清理政策。

| 决定 | 需要明确的内容 | 建议默认值 / 决定缺失时的边界 |
|---|---|---|
| 正式窗口 | 具体日期、起止时间、可接受维护时长；是否暂停消费者下单、运营后台和点位操作 | 选择低业务量时段，维护期间所有写入入口进入维护模式；未定具体窗口不执行生产迁移。 |
| 在途事务影响 | 窗口前如何处理未确认支付、退款提交租约、回调和定时任务；可否等待排空，供应商回调无法确认时采用何种已验证重试/补偿方式 | 由上线计划列明状态与责任人；不能证明回调可重试时不开始冻结。此决定是可用性和资金对账边界。 |
| 回退支持窗口 | 新 Store 开始生产写入后的恢复方式；是否要求本期实现并演练反向导出 | 建议将切换后的恢复定为前向修复；若要求在切换后恢复旧 adapter，必须增加反向迁移实现与演练，不能直接重放旧快照。 |
| 快照与备份保护 | 是否接受生产库内继续保存一份 legacy payload，及其与现有同机备份相同的访问控制、加密/备份范围和保留方式；何时可另行评估删除 | 建议迁移完成后继续保留 legacy 快照及现有备份，不缩小权限或提前删除。现有恢复证据是同机备份与隔离还原；当前没有异地备份，若用户要求异地副本需单独批准位置、访问范围和恢复责任。 |
| 数据保护影响 | 实体表复制订单、联系方式、用户标识和财务历史的存储范围/主体权限；保留完整 legacy 副本意味着迁移后短期或长期增加一份可访问数据 | 仅在同一生产数据库、同一受控环境内迁移；测试只用合成数据。接受该副本及其访问/备份范围后才正式迁移；不把此项扩展成全面数据保留政策。 |

历史审计、callback、幂等、通知、支付和退款数据按当前系统继续留存，不作清理或归档。为避免把保留期限误作当前工程阻断，本轮不要求补充这些记录的期限；未来如需缩减数据，再单独定义期限、法律依据、恢复要求和可验证清理方案。

## 8. 非目标与后续事项

- 本提案不修改 API 业务逻辑、不新增迁移文件、不进行数据库写入、不触碰正式或测试服务器。
- B 档不同时引入逐点位锁、读写分离、Redis 会话或多主并发；这些会扩大一致性边界，应在本次实体化与容量证据完成后依据测量结果单独决定。
- 当前无分页接口的方法可能仍返回其契约要求的全部单类结果；实体化会消除无关集合 hydrate，但不会自动令任意“列出全部”调用变为有界。大规模历史订单管理如需分页，另行明确页面/调用方契约和验收。
- 老 JSON 快照暂不删除。后续如提出清理，必须先完成已批准的保留窗口、备份恢复核验及数据保护评估，并作为独立的可审计操作。

## 附录 A：当前 `CommerceStore` 方法覆盖索引

下面按表/集合列出当前 `apps/api/src/modules/core/store.ts` 中的全部接口方法（同名重复声明折叠为一个名称）。实施审查应以源码再次核对签名，并逐项确认没有遗漏；`readSnapshot`/`transaction` 是跨集合边界，不归属单一表。

- **Store 控制与运营队列：**`getAggregatePayloadStatus`、`readSnapshot`、`listOperationsQueue`、`transaction`、`health`、`databaseNow`、`close`。
- **用户、授权和认证：**`findUserByWechatOpenId`、`getUser`、`listConsumerUsers`、`allocateConsumerPublicNumber`、`saveUser`、`savePrivacyConsent`、`getPrivacyConsent`、`getAuthSession`、`getActiveAuthSession`、`saveAuthSession`、`deleteAuthSession`、`deleteAuthSessionsByUser`、`getPasswordChangeToken`、`listExpiredAuthenticationData`、`deleteExpiredAuthenticationData`、`savePasswordChangeToken`、`deletePasswordChangeToken`、`findAdminCredential`、`findAdminCredentialByUserId`、`saveAdminCredential`、`replaceUserRoles`、`getAccessRole`、`listAccessRoles`、`saveAccessRole`、`deleteAccessRole`、`getInternalStaff`、`listInternalStaff`、`saveInternalStaff`、`listStaffPickupPointAssignments`、`replaceStaffPickupPointAssignments`、`hasActivePickupPointAssignment`。
- **小型运营配置：**`listServiceAreas`、`saveServiceArea`、`updateServiceAreaOrderEnabled`、`listPickupPoints`、`savePickupPoint`、`deletePickupPoint`、`listCatalogSkus`、`getCatalogSku`、`saveCatalogSku`、`listProductCategories`、`getProductCategory`、`saveProductCategory`、`deleteProductCategory`、`listHomepageBanners`、`getHomepageBanner`、`saveHomepageBanner`、`deleteHomepageBanner`。
- **营销团期与商品：**`listCampaigns`、`getCampaign`、`getCampaignForUpdate`、`saveCampaign`、`updateCampaign`、`deleteDraftCampaign`、`hasCampaignBusinessReferences`、`replaceCampaignItems`、`getCampaignItem`、`reserveCampaignInventory`、`releaseCampaignInventory`。
- **幂等与订单：**`getIdempotency`、`getIdempotencyForUpdate`、`saveIdempotency`、`listOrdersByCampaign`、`listOrdersByUser`、`listOrders`、`listExpiredPendingOrders`、`getOrder`、`getOrderForUpdate`、`getOrderByNo`、`getOrderByNoForUpdate`、`saveOrder`、`saveOrderStatus`、`transitionOrderStatus`、`cancelPendingOrder`、`markPendingOrderPaid`。
- **结账批次与订单行：**`getCheckoutBatch`、`getCheckoutBatchForUpdate`、`getCheckoutBatchByOrder`、`getCheckoutBatchByOutTradeNoForUpdate`、`saveCheckoutBatch`、`saveOrderLines`、`listOrderLinesByCampaign`、`listOrderLinesByCampaignForUpdate`、`listOrderLinesByOrderForUpdate`、`updateOrderLine`、`listOrderDeliveryFacts`。
- **支付与回调：**`getPaymentByOrder`、`getPaymentByOrderForUpdate`、`getPaymentBatchByCheckoutBatch`、`getPaymentBatchForUpdate`、`savePaymentBatch`、`savePaymentBatchIfInitiationClaimed`、`savePayment`、`savePaymentIfStatus`、`savePaymentIfInitiationClaimed`、`claimPaymentCallback`。
- **退款与账本：**`getOrderRefundByOrder`、`getOrderRefundByProviderNo`、`saveOrderRefund`、`claimOrderRefundSubmission`、`saveOrderRefundIfClaimed`、`saveOrderRefundIfUnclaimed`、`saveOrderRefundIfStatus`、`listOrderRefunds`、`listPendingOrderRefunds`、`listRefundingOrders`、`getPartialRefund`、`getPartialRefundByProviderNo`、`listPartialRefunds`、`listPartialRefundsByOrder`、`listPartialRefundsByException`、`listPendingPartialRefunds`、`savePartialRefund`、`claimPartialRefundSubmission`、`savePartialRefundIfClaimed`、`savePartialRefundIfUnclaimed`、`savePartialRefundIfStatus`、`appendLedgerTransaction`、`listLedgerTransactions`。
- **审计：**`saveAuditLog`、`findLatestAudit`、`listAuditLogs`。
- **计划和批次：**`getDeliveryPlan`、`getDeliveryPlanByCampaign`、`listDeliveryPlans`、`saveDeliveryPlan`、`getDispatchBatch`、`listDispatchBatches`、`saveDispatchBatch`。
- **提货凭证、记录、回执及到货：**`getPickupCredential`、`savePickupCredential`、`savePickupRecord`、`pickupRecordExists`、`getCommunityPickupReceiptByRequestIdForUpdate`、`listCommunityPickupReceipts`、`listCommunityPickupReceiptsByOrder`、`saveCommunityPickupReceipt`、`getCommunityDeliveryConfirmationByBatch`、`saveCommunityDeliveryConfirmation`。
- **履约异常、分摊和草稿：**`getFulfillmentException`、`getFulfillmentExceptionForUpdate`、`getFulfillmentExceptionByOrderRequestForUpdate`、`listFulfillmentExceptions`、`saveFulfillmentException`、`listFulfillmentAllocations`、`saveFulfillmentAllocations`、`markFulfillmentAllocationsRefunded`、`getCommunityAllocationDraftByDeliveryForUpdate`、`saveCommunityAllocationDraft`。
- **提货窗口、取消和品质案件：**`getCommunityPickupWindowForUpdate`、`getCommunityPickupWindow`、`saveCommunityPickupWindow`、`listCommunityPickupWindowsPastDeadline`、`listCommunityPickupWindowsDueBy`、`listCommunityPickupWindowsByStatus`、`getCommunityCancellationRequestByOrderForUpdate`、`listCommunityCancellationRequests`、`listPendingCommunityCancellationRequests`、`saveCommunityCancellationRequest`、`getCommunityQualityCaseByOrderRequest`、`getCommunityQualityCaseByOrderRequestForUpdate`、`getCommunityQualityCaseForUpdate`、`listCommunityQualityCases`、`listCommunityQualityCasesByOrder`、`listCommunityQualityCasesByOrderForUpdate`、`saveCommunityQualityCase`。
- **区域意向：**`saveServiceAreaInterest`、`getServiceAreaInterest`、`listServiceAreaInterests`、`listServiceAreaInterestsByUser`。
- **通知和偏好：**`createOrderNotificationIfAbsent`、`saveOrderNotificationIfClaimed`、`getOrderNotification`、`listOrderNotificationsByUser`、`listManualOrderNotifications`、`claimPendingOrderNotifications`、`beginOrderNotificationSubmission`、`markOrderNotificationSentIfSubmission`、`recordSubmissionUnknownIfSubmission`、`markOrderNotificationRead`、`requeuePendingOrderNotification`、`markOrderNotificationManualCompleted`、`saveNotificationPreference`、`getNotificationPreference`。
