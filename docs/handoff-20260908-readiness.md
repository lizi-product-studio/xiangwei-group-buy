# 接手说明：容量与业务完整性修复

任务：TASK-20260908-READINESS-REPAIR。更新日期：2026-09-08。

**confirmed：用户要求停止继续修复和部署，将最新代码及剩余问题同步 GitHub，交另一 agent 接手。本批为未发布交接版本，不是上线批准。** 当前分支 `codex/audit-remediation`。本决定替代此前继续修复的安排。

## 线上与仓库版本

生产仍运行已验收批次 A：GitHub 提交 `a904ad98135e790ad9828750dc2de50e538ec7c1`，源码树 `cb446f96639bcfe0ca4782233f5f5a2f698a3d12`。API 镜像 `sha256:f494d34d44ab05baf7aa0377d14ab75a4ac80f1819ed3d3d840d374fa65a8fbf`，后台静态目录 `/var/www/hometown-admin-a904ad9`。生产目标 `192.144.136.205`，API https://liziqi.icu，后台 https://admin.liziqi.icu，点位工作台 https://saas.liziqi.icu。不得连接旧百度云服务器。

A 已修复两类 P1：待处理队列先筛选再分页，避免旧待办被固定 500 条截断；历史退款使用精确订单关联，缺少订单/明细/分配关系时禁止计算和执行。队列组件还处理重复请求及迟到响应。产品测试 466 PASS，其中真实 MySQL/Redis 8/8，无跳过；最终受影响 E2E 5/5 PASS，独立发布后验 PASS。不是全量 E2E 单次全绿：历史失败保留在修复记录。根 `pnpm check` 仍有 prototypes 中 21 项 lint 问题，未通过删除或忽略掩盖。

**本次交接新增 B 和后续认证优化，尚未发布、尚未完成最终独立 QA。不要因 GitHub 已同步而自动部署。** 无 schema 迁移，无真实交易或通知发送。

## 已实现但待验收的 B

- `CommerceStore.readSnapshot` 与独立 MySQL 快照上下文；只读路径不加 FOR UPDATE、不回写整个聚合。未知方法默认写路径，只读 scope 拒绝写入及事务，写事务保留锁和回滚。
- 公开商品/团期查询复用单个读取快照，减少重复加载。
- `getActiveAuthSession` 纯只读认证查询；管理员和微信认证使用新方法，旧清理型 `getAuthSession` 保留。`mysql2 jsonStrings` 减少重复 JSON 转换。
- 通知每轮最多 100 条，每波最多 5 条，20 秒处理预算，保留 claim、fence、UNKNOWN 处理。
- 新增真实快照集成测试、通知吞吐测试和隔离容量脚本。

最新工程自验：API typecheck PASS；认证及快照定向测试 53/53 PASS（含真实 MySQL 快照 13 项）；通知测试 11/11 PASS。1000 条通知、替身 provider 每次 100 ms 的 MemoryStore 墙钟测量约 23.16 秒；不能当作真实数据库或微信吞吐。B 最终全量门禁、E2E、独立完整审核均未完成。

## 容量实测：仍不达标

数据为隔离合成库：1000 身份、10000 历史订单，聚合 payload 8,428,905 字节。macOS ARM、MySQL 8.4.11、Redis 7.4.11；每档约 5 秒、准入上限 20。V8 heap 256 MiB 不等于生产容器 384 MiB，RSS 为子进程生命周期峰值。这是短诊断，不能证明长期稳定性或 Linux 生产容量。

| 场景 | 优化前 | 最新认证/JSON 优化后 |
|---|---|---|
| 公开 10 RPS | p95 68 ms，RSS 454 MiB | p95 54 ms，RSS 432 MiB |
| 公开 100 RPS | 实际 17.11 RPS，397/501 未发送，p95 1.34 s，RSS 580 MiB | 实际 26.96 RPS，348/501 未发送，p95 825 ms，RSS 502 MiB |
| Bearer 10 RPS | 实际 1.73 RPS，p95 10.65 s | 实际 9.85 RPS，p95 222 ms，锁写为零，RSS 505 MiB |
| Bearer 100 RPS | 实际 1.65 RPS，481/501 未发送，p95 11.53 s，RSS 688 MiB | 实际 10.26 RPS，440/501 未发送，p95 2.06 s，RSS 656 MiB |

认证锁写瓶颈显著改善，但内存和高负载准入仍不合格。已接收请求零错误不等于容量通过，不能宣称支持千人同时使用，也未完成千人日活对应业务模型的验收。

原始指标脱敏副本：[优化前](evidence/readiness-20260908/capacity-before-auth.json)、[优化后](evidence/readiness-20260908/capacity-after-auth.json)。优化后包含源码 SHA，优化前通过历史冻结记录关联；保留两份结果，不覆盖失败证据。

## 剩余问题与建议顺序

1. **B 验收未完成**：先冻结接手 SHA，审核只读快照生命周期、读写隔离、回滚、权限与会话失效（过期、撤销、改密、角色/点位变更），运行产品检查、真实 MySQL/Redis 集成与全流程 E2E。
2. **通知超时限制待修**：独立 QA 发现 `notification-service.ts` 的 `Promise.race` 超时不取消底层 `provider.send`。5 并发只限制当前波次，跨轮残留请求不受已证实的全局限制；“返回前所有在途工作结束”注释过强。尚未复现实际故障。调查可取消 provider 请求或全局在途预算，测试慢请求、超时、迟到完成和 lease；保持 UNKNOWN 不自动重发。
3. **内存与吞吐**：继续测量整包 JSON 的解析、复制、快照保留和读取并发。可评估受控读取准入或有明确一致性的版本快照复用，不能用 TTL 认证缓存破坏立即撤销。若聚合架构仍是瓶颈，设计订单/明细、会话、支付退款、通知 outbox 等热数据拆表与索引迁移；此方案未实施，不视为不可逆生产迁移授权。
4. **重新做容量验证**：固定源码、数据和环境，报告实际 RPS、未发送数、p95/p99、RSS、写入及通知混合负载；延长稳态和突发阶段，使用接近生产 Linux 资源限制的环境。不可只提高资源或实例数后宣称解决。
5. **运维闭环**：自动备份、异机恢复演练、RPO/RTO、告警仍需完成；现有手工发布备份不等于自动备份体系。云控制台是否另有配置尚未核实。
6. **真实渠道**：用户已确认手机号授权登录成功。真实 JSAPI、全额/部分退款、订阅实际触达、当前微信正式包仍需各自证据，不能以 mock 替代；已配置的模板 ID 不要再次误报缺失。

## 本地复现与数据边界

Node 22+、pnpm 11+。测试入口见项目 package scripts；集成测试需要 `INTEGRATION_DATABASE_URL`、`INTEGRATION_REDIS_URL`，从本机受限配置加载，切勿写入 GitHub。

容量脚本 `apps/api/src/scripts/capacity-readiness.ts` 只允许本机 MySQL `127.0.0.1:13306/community_capacity_20260908` 和 Redis `127.0.0.1:16379/5`。它会覆盖该专用库的聚合 payload，必须建立独立合成测试库并初始化基线，不能放宽保护或指向生产。进入 `apps/api` 后用 `node --import tsx src/scripts/capacity-readiness.ts`，配置 `CAPACITY_OUTPUT` 和可选 `CAPACITY_DURATION_MS`。脚本启动本机 13101 API，合成会话不调用微信、支付 mock、通知不真实发送。

本任务 MySQL/Redis 已正常关闭：13306、16379 均无监听；数据目录、日志和受限配置保留在本机任务备份目录。没有清库、停止生产或系统级安装。另一个环境需自行建立隔离依赖，不能依赖当前机器的绝对路径。

## 同步范围及证据入口

本次同步全部最新项目运行源码、测试、容量脚本、当前小程序 `project.config.json`（仅既有格式变动）、本交接和两份脱敏容量 JSON。`.env`、密钥、真实数据库/备份和本机 runtime 不入库；`.codex/` 生成状态及 `prototypes/` 未确认非运行资产保留本地，未混入代码提交。

详细历史：[修复记录](task-20260908-readiness-repair.md)、[初始评估](task-20260908-thousand-readiness.md)。本机受限证据位于 `/Users/lizi/Backups/TASK-20260908-READINESS-REPAIR/`，含 A 发布/回滚材料、B 测试日志和运行环境；该目录不推送。生产 A 之前的回滚静态目录 `/var/www/hometown-admin-9eb41d7`，镜像 `sha256:d3855653527b1fbb0e8e8dabeb048c1f7e53f8874ff4b5baae1c6e3b13b64632`；本次停止指令不要求执行回滚。
