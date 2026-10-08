# OPS-20260929-REMOVE-RECON-RESET 操作边界

本目录是本轮工程交付的执行说明，不替代主编排任务索引。代码基线为 6558fac。服务器窗口归主编排；工程只提供代码及隔离演练，不连接正式服务器。

## 两个独立变化

1. 正常软件升级删除“账单对账”菜单、页面、账单导入/差异/人工核查 API、权限映射、解析服务及专用 store 方法。已有 `reconciliationBills` / `reconciliationReviews` 集合与序列化类型继续兼容，正常升级不会删除其历史数据。自动支付/退款核对、实际支付退款事实、ledger、退款记录与账务流水不受此移除影响。
2. 用户单独授权本轮业务数据重置，包括真实交易历史。只有执行重置脚本才删除这些数据；源码提交/部署不会自动清库。

## 删除与保留

| 对象 | 重置行为 |
|---|---|
| users / staff / credentials / roles | 只保留参数指定的一个现存、关联一致且可登录的 SUPER_ADMIN；拒绝多个超管或关联不一致；密码/盐/授权版本保持原值 |
| accessRoles / deletedAccessRoleIds | 逐记录保留权限配置及已删除内置角色的标记；不重新启用已停用配置 |
| sessions / passwordChangeTokens / staffPoints / privacy / preferences | 全部删除，包括超管旧会话；需重新登录 |
| areas / points / catalog / categories / homepageBanners / campaigns / campaignGroups / plans / batches | 全部删除，不将区域、分类、banner视为系统配置 |
| orders / lines / checkoutBatches / payments / paymentBatches / callbacks / orderRefunds / partialRefunds / ledger / audits | 全部删除，包括真实交易历史及既有回调去重记录 |
| pickupCredentials / pickupRecords / pickupReceipts / deliveries / exceptions / allocations / drafts / windows / cancellations / quality / interests / notifications / idempotency | 全部删除，不留履约、售后、通知或旧请求关联 |
| reconciliationBills / reconciliationReviews | 本次重置删除，正常升级保留 |
| community_entity_relations | 清空派生关联索引；entity records 内被删除业务的所有投影随记录删除 |
| community_product_state | 用保留超管及权限配置生成净化 aggregate，旧业务 payload 被替换；保留 schema_version |
| community_legacy_snapshots / community_entity_reverse_exports / community_entity_migration_journal | 清空在线旧副本/迁移记录，防止旧业务数据被回填；不删除表 |
| community_entity_store_state | 保持 ENTITY 与既有模式元信息；更新 source hash 和写计数，使旧反向导出失效；不切回 LEGACY |
| community_entity_sequences / schema_migrations | 逐行保留，检查消费者编号高水位高于现存编号；不重新执行迁移 |
| Redis | 仅接受本专用 DB 的 `bull:campaign-lifecycle:*`、`admin-login:*`、`hometown:reconciliation:lease`；未知 namespace 或 active job 拒绝；不 FLUSHDB/FLUSHALL |
| 运行配置、微信/地图/数据库密钥、HTTPS、进程定义、独立备份 | 保留不变；不轮换、不输出敏感值 |
| product-images、profiles头像、文件系统媒体 | 本脚本不操作文件。商品/头像引用随业务数据删除，文件可能成为孤立资产。保留超管头像/系统引用；若后续明确清文件，另做逐引用清单和受限备份，不递归盲删媒体根目录。本地素材/原型不在范围内 |

脚本按精确九表白名单和全部已知 entity collection 检查。出现未知表、列、集合、触发器/事件/存储过程、非 InnoDB、非 MySQL 8.4、非 ENTITY 状态或迁移校验和不符即停止。业务快照上限 100000 行 / 64 MiB，超过需重新设计流式操作，不默认全量加载。

## 执行前提与窗口

- 先核对本轮源码提交、独立审核结果、测试机的真实演练和恢复证据。部署人工对账移除与生产重置分别记结果。
- 主编排核对正式 192.144.136.205 的应用、MySQL容器与专用库 identity。已只读观察到库 `hometown_food`、server UUID `8a48799d-aa5c-11f1-8297-4a0d012feec7`，每次执行前重新核对，不能把文档当实时证明。保留超管 ID 放在受限 env 参数，脚本实时验证角色、账号、staff、credential 和授权版本。
- 封住公网业务入口和回调，停止**全部 API 副本、worker、脚本、定时任务写者**，确认没有未完成 provider 调用。仅改 `MAINTENANCE_MODE` 但保留旧进程不够；旧请求可能仍持有内存状态。服务应停止到数据库/Redis检查结束。恢复数据库前同样停写。
- 运行脚本的 MySQL账号必须有该专用 schema 所需 DML、只读 information_schema 和 PROCESS 权限，以核实其他客户端；缺权限不是继续执行理由。脚本拒绝该库其他连接（包括空闲连接），持有迁移共用锁并在 SERIALIZABLE 事务中锁定所读记录。此检查不能代替运维确认所有写者已停止。
- 删除前检查订单/退款/通知状态；未完成支付/退款、活动 claim、未知通知发送状态会拒绝。停止服务前后都查实际义务；不要借清库消除未结算渠道事项。脚本从不调用微信查单、支付、退款、关单或通知接口。
- 先做已有正式备份流程并保留独立恢复副本。将备份下载到受限恢复环境完成演练；不得覆盖其他项目。脚本另在操作时写完整受限 preimage，文件 600、目录 700，fsync后读回校验通过才开始 DML。备份含凭据及历史数据，不能入 Git、聊天附件或普通日志。

## 命令与参数

在冻结源码根目录、Node 22+、已安装同锁依赖和构建 domain/contracts 后执行。下列命令只定义如何运行，不表示已执行生产操作。连接密码使用现有私有 env 文件；不要放 shell 命令行、stdout、报告中。输出目录须先由发布者创建为 700，路径必须绝对且无符号链接。每次调用用新输出文件名，文件已存在会拒绝覆盖。

MySQL 私有 env 所需变量：

```
DATABASE_URL=<现有专用连接串>
RESET_EXPECTED_HOST=<连接串中经核对的精确主机名>
RESET_EXPECTED_SERVER_UUID=<实时核对的 MySQL UUID>
RESET_EXPECTED_SCHEMA=<专用库名>
RESET_KEEP_ADMIN_ID=<保留的现存唯一超管 userId>
RESET_OUTPUT=<绝对私有目录>/inspect.json
```

```sh
node --env-file=/absolute/private/reset.env --import tsx apps/api/src/scripts/business-reset.ts inspect
```

inspect只返回非敏感 identity、beforeHash、schemaHash、每表及每集合前后数量、保留记录摘要。主编排核对清单后，将下列参数加入私有 env 并换新输出路径：

```
RESET_EXPECTED_BEFORE_SHA256=<inspect.beforeHash>
RESET_WRITERS_STOPPED=CONFIRMED
RESET_CONFIRM=OPS-20260929-REMOVE-RECON-RESET
RESET_OUTPUT=<绝对私有目录>/apply.json
```

```sh
node --env-file=/absolute/private/reset.env --import tsx apps/api/src/scripts/business-reset.ts apply
```

写前再次核对全库记录/模式/迁移/identity指纹；任一变化即拒绝旧计划。九表变化在一个 InnoDB 事务完成，使用 DELETE/INSERT，无 TRUNCATE/DDL/外键保护绕过。事务内重读逐记录比较预期，不只是计数。`apply.json.preimage.json` 是完整前像，`apply.json.prepared.json` 是提交前回执，`apply.json` 为 commit 返回后的回执。终端只输出数量/摘要。重复提交旧beforeHash被拒绝，不再次清库。

Redis 私有 env 另需：

```
REDIS_URL=<同项目专用 Redis URL>
RESET_REDIS_EXPECTED_HOST=<核对的主机名>
RESET_REDIS_EXPECTED_DB=<显式 DB 编号，例如 0>
RESET_REDIS_EXPECTED_RUN_ID=<实时 INFO server 的 run_id>
RESET_OUTPUT=<绝对私有目录>/redis-inspect.json
```

```sh
node --env-file=/absolute/private/redis-reset.env --import tsx apps/api/src/scripts/business-reset-redis.ts inspect
```

apply需要相同停写确认、task确认、`RESET_REDIS_EXPECTED_BEFORE_SHA256`、MySQL `RESET_DB_COMMIT_RECEIPT` 私有文件及其规范JSON SHA256 `RESET_DB_COMMIT_RECEIPT_SHA256`。换新输出路径后运行同脚本 `apply`。Redis先写受限 DUMP 前像，再在同一 Lua 中核对整个有界 DB key集合及每个序列化值，全部匹配才逐key删除。TTL变化不影响内容摘要，key到期会造成计划失效，需重新inspect。禁止在两步间恢复流量。DB和Redis不是跨系统原子事务；任一步失败都保持维护窗口，按回执核实后再恢复或重做计划。

## 恢复与失败处理

- COMMIT之前失败由连接回滚；保留preimage和失败证据。COMMIT之后输出失败不能推定未删除：检查prepared回执、只读重采实际 afterHash，禁止盲重试。
- 数据库恢复使用本次preimage，要求 identity/schema/备份摘要一致，并显式提供**当前**数据库的预期beforeHash。恢复也先保存当前前像，所有行恢复在事务内，重读逐记录校验。

```
RESET_BACKUP=<私有目录>/apply.json.preimage.json
RESET_BACKUP_SHA256=<apply回执 backupHash>
RESET_EXPECTED_BEFORE_SHA256=<恢复前实时 inspect 的 beforeHash>
RESET_OUTPUT=<私有目录>/restore.json
```

```sh
node --env-file=/absolute/private/reset.env --import tsx apps/api/src/scripts/business-reset.ts restore
```

- 只在停写期间用同库身份恢复；脚本不支持跨生产/测试 identity 强制恢复。需要灾备换服务器时另用经核对的备份流程，不能跳过校验。
- Redis缓存/限流计数不做自动回放；恢复数据库后，由调度器从恢复的 OPEN 团期重新构建待执行任务，登录限流重新建立。不要直接重放旧已完成/失败/active队列以免造成旧业务动作。Redis前像保留用于核对，若恢复缓存确有必要应由发布者另行核对每项TTL与业务状态。
- 从清理开始至正式重新开放前，API应停止。核对保留账号/credential/staff/roles/config逐记录摘要与清理后业务零量、Redis无旧key。启动后检查正常超管密码登录、旧会话失效、权限配置、空商品/区域/点位/订单页面和health；再放行业务流量。不得为验证用正式账号创建演示数据或真实交易。

## 迟到回调与初始化边界

支付成功回调查不到订单时事务抛404，去重插入回滚；退款回调找不到退款时保留一条新回调去重记录，重复同事件不再写，既不重建订单/refund/ledger，也不调用退款。已有自动核对仍保留。清理时点业务为零和之后真实新事件产生必要去重记录要分开验收，不为永久零记录改支付协议。代码没有初始化演示业务，MemoryStore构造不seed；内置权限定义仍可用，这属于系统配置。真实演练验证重开后无区域/商品/点位/团期/订单回填。

## 隔离验证命令

主编排已准备测试机专用 `ops_reset_test` MySQL 8.4 和独立 Redis 7.4，测试拒绝其他库名和正式 UUID。先用受限env迁移空库；此步骤只适用于新建测试库。

```sh
pnpm --filter @hometown/domain build
pnpm --filter @hometown/api-contracts build
pnpm --filter @hometown/api db:migrate
RESET_REHEARSAL=true REQUIRE_RESET_REHEARSAL=true pnpm --filter @hometown/api exec vitest run src/scripts/business-reset.integration.test.ts
```

env须包含专用 DATABASE_URL、INTEGRATION_DATABASE_URL、INTEGRATION_REDIS_URL。首次演练要求全新空schema，失败复测由主编排处理本轮专属资源，测试不会自动清空未知已有数据。测试合成覆盖全部collection、旧快照、逐记录保留、MySQL中途回滚、CLI reset/restore、旧hash重放拒绝、超管密码/会话、高水位、空库重启、Redis未知namespace拒绝和定向删除；证据路径由测试输出。未实际运行不能标通过，合成演练不代表真实微信回调/交易验收。
