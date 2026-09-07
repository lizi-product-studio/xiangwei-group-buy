# TASK-20260907-HOUSEKEEPING-REPLACE

## 冻结目标与授权

- confirmed：用户于 2026-09-07 明确家政正式下线，家政服务器与域名交给拼团，并授权“直接开始迁移”。
- confirmed：目标为 housekeeping-server / 192.144.136.205；当前决定替代本次迁移中原有唯一百度云发布目标，不授权修改原百度云服务器。
- confirmed：禁止调用、恢复或安装 project-delivery-router。
- confirmed（用户后续决定）：拼团小程序接替原家政小程序，AppID 与微信支付沿用家政；采用原消费者 C 端身份，保洁端身份不自动纳入。允许安全复用既有配置，但不包含修改密钥、真实支付交易或省略模板/回调验收。
- 范围：异机备份家政、验证恢复、准备拼团产物与生产配置、家政退役、拼团接管域名、健康与版本验证。
- 非目标：更改业务规则、删除本机家政源码、真实支付交易、未经审查的微信平台写入；既有支付身份复用仍核对 C 端和商户绑定。
- default-assumption：liziqi.icu 用于拼团 API，admin.liziqi.icu 用于后台，saas.liziqi.icu 旧入口关闭；最终以经审核的 Nginx 清单为准。

## 现状证据

2026-09-07 SSH 只读检查：2 核 x86_64，内存约 2GB；系统盘 40GB，使用 86%，余 5.6GB。
运行 housekeeping-api、housekeeping-db（MySQL 8.0）；Nginx 提供现有域名与 8443 入口，API 上游为 127.0.0.1:3000。
媒体目录为 /root/backend/uploads、public-media；数据库卷为 root_mysql_data；后台版本链接为 /var/www/housekeeping-admin-current。
拼团初始版本 39751e2573016c4be197ae89602ca184d7d3cb5f，分支 codex/audit-remediation，初始工作树干净。

## 角色与所有权

- 主 Orchestrator：本文件唯一写入者；负责目标、决定、验收汇总。
- Project Assessor：只读评估切换与删除条件。
- Engineering Lead（migration_engineering）：唯一源码、测试、部署脚本及服务器写入负责人；备份与准备可执行，切换前冻结清单交独立审核。
- 独立 QA：只读审核备份恢复证据、待发布差异和部署结果，不实施修复。

## 门禁与停止条件

1. 家政异机备份涵盖数据库、媒体、匹配应用、配置和证书，提供完整性与隔离恢复证据。
2. 未结订单、退款或待处理外部回调必须核对，不因下线丢失处理义务。
3. 拼团新建 MySQL 8.4 与 Redis 7.4 独立数据卷；不复用家政 MySQL 8.0 卷。
4. 生产采用 HTTPS 和真实微信适配器，不绕过配置校验或将 mock 当生产完成。
5. pnpm check、pnpm test:e2e、真实 MySQL/Redis 集成及 git diff --check；缺项不记 PASS。
6. 80/443 仅由一个入口服务管理；独立审核后切换，发布版本与已同步 Git 提交一致。
7. 删除仅限归属明确且已备份验证的家政专属资源，不使用全局 Docker prune。
8. 部署后验证健康、版本、后台与 API；失败停止并按回滚方案恢复。产生新交易后不得直接用旧快照覆盖。

## 评估结论

Project Assessor：GOVERNED_DELIVERY，高风险正式服务替换。最小角色为主线程、研发负责人、独立 QA。
切换前必须核验资源归属、一致性异机备份、数据库隔离恢复、空间余量和单一 HTTPS 入口。
微信配置完整不等于真实交易验收通过；真实交易开放单独验证。

## 当前状态

IN_PROGRESS：研发正在完成备份与本地发布准备，尚未批准切换。

### 预检更新

- evidence-inferred（研发只读聚合查询）：家政订单 COMPLETED 1、CANCELLED 7；支付 SUCCESS 1、FAILED 7；退款与两类结算批次均为 0。
- confirmed：一位保洁员余额合计 1.61 元、冻结余额 0；一笔已完成订单存在应结算字段，未见对应结算记录。不能以订单已完成推断结算完成。用户已明确选择“下线服务，保留账目待结清”。该决定替代本轮清理旧数据库的初始范围：允许停旧服务，但保留旧数据库卷、财务记录与备份，不执行真实清偿；结清由用户负责。
- evidence-inferred：拼团本地仅开发配置。用户已决定沿用家政 AppID 和支付配置，研发正在核对原 C 端身份并准备安全复用；四类模板适配和真实链路尚未验证。
- evidence-inferred：现 HTTPS 证书 SAN 覆盖主域、admin、saas，有效期至 2026-11-04，公网主域和后台当前均返回家政页面 200。
- 初始 SQL 流式备份已完成，46 表；仅完整性初检通过，尚非停写一致性最终备份或恢复验收。
- 研发报告 pnpm check PASS；首次 E2E 因缺少 Chromium headless shell 启动失败，未形成行为验收结果，正在准备浏览器。
- 受限权限异机备份路径：/Users/lizi/Backups/TASK-20260907-HOUSEKEEPING-REPLACE；敏感归档不进入仓库。初始 SQL gzip 完整性通过，文件归档仍在传输。
- 研发已冻结 infra/nginx.migration-maintenance.conf 与 infra/compose.migration-data.yaml 供独立 QA 预审；尚未安装或生效。
- 独立 QA attempt 1 原始结论 BLOCKED：仅分阶段条件审核，缺冻结差异、备份恢复与入口验证，不代表完整交易上线通过。当前正在 attempt 2 预审新增配置及隔离恢复方案。
- 独立 QA attempt 2 原始结论仍为 BLOCKED（最终切换），但允许一次受限隔离恢复尝试：同版 MySQL 8.0、独立临时卷、无网络与端口、无自动重启、事件调度关闭，memory+swap 共 384MiB、CPU 0.5；MemAvailable 低于 256MiB、旧服务异常或 OOM 时停止，不擅自提高限额。
- 研发报告初始文件归档 77,410,099 字节、39,194 成员，gzip/tar 及必备路径核验通过；archive-integrity.json 与 SHA256SUMS.initial 留在受限备份目录。在线初备仍不等同停写一致快照。
- 隔离恢复已验证：46 表精确 COUNT、余额及订单结算/退款聚合与源逐行一致，导入退出 0、OOM=false；临时容器停止，旧服务仍健康。独立 QA 已核对 source/target 证据。
- 独立 QA 已核对 E2E 重跑日志 13/13 PASS；pnpm check 完整通过，但其中 MySQL/Redis 集成 7 项 skipped，故真实集成仍 NOT_RUN，必须另行 fail-closed 执行。
- 支付验签核查：旧文件为纯公钥，不能从中推导序列号；旧运行配置的平台证书序列号与公钥 ID 均空。现拼团强制匹配验签 ID，禁止猜测或放宽。研发继续只读核对已批准档案。

## 待证实事项

- blocking-unknown：原家政 C 端配置映射完整性、订阅模板适配；用途已由用户确认。
- blocking-unknown：家政未结交易情况及可恢复备份。
- evidence-inferred：资源较紧，构建优先放本机，部署容量需实测。

## 验收状态

初备恢复 PASS；pnpm check PASS（7 个真实集成 skip，真实集成未通过）；E2E 13/13 PASS。
QA attempt 3：冻结差异未发现新的阻塞性代码问题；最终切换仍 BLOCKED，待切换清单、最终一致快照与剩余门禁。
正式切换、真实集成和微信真实链路均 NOT_RUN。

## 分阶段执行清单（研发冻结，经 QA attempt 4 补充）

QA attempt 4：A 可执行，须纳入以下补项；不是 B 批准或完整迁移 PASS。主 Orchestrator 已批准研发执行 A。
恢复容器启动前 MemAvailable 至少 640MiB，运行中 256MiB 为止损阈值；停 API 后核查事务、事件与其他 writer。
最终源聚合必须停写后重取，恢复必须干净临时库；失败先停恢复容器再恢复旧 API/任务。
仅停家政备份/巡检 cron，保留腾讯服务器管理任务和 certbot-renew。
B 的数据验证使用独立临时 Redis，或先证明共享实例无跨 DB 副作用；不能把 DB15 自动当作充分隔离。
HTTP 已知域名预期 301 至 HTTPS，再核对 200/503/410；IP 证书不匹配不作为 HTTP 410 的证据。

### A：最终停写备份

确认旧 API/DB 健康、MemAvailable 至少 256MiB、磁盘至少 2GiB；备份任务配置并只停止家政专属写任务。
停止 housekeeping-api，保留旧 DB 运行。流式导出最终 SQL、媒体、配置和证书到异机，检查双端退出码、完整性与哈希。
在独立受限恢复容器重验最终 SQL 及所有表、账目聚合，随后停恢复容器。
A 失败时恢复旧 API 和任务，保持原 Nginx。

### B：家政退役与拼团维护部署

A 通过后停止旧 DB，保留旧容器、root_mysql_data 卷、媒体和密钥。安装已验收拼团静态产物。
备份并替换两个家政 Nginx 配置；nginx -t 失败恢复，成功才 reload。
核验主域/admin 静态页面、API/health 503，旧路由/saas/8443/IP/未知 Host 退役响应。
启动独立新 MySQL 8.4、Redis 7.4；在独立临时测试库和 Redis DB15 执行真实集成，生产库不写演示。
数据层失败则停止新栈，保留明确维护入口，不宣布完整迁移完成。

### C：真实 API 与小程序

仅在真实微信参数与模板齐全、独立审核通过后启动真实 API、迁移空库并切接口路由；体验版与真实渠道另验。

### B 回滚

停止新栈并保留新卷，恢复原 Nginx 配置及静态链接；启动旧 DB 健康后再启动旧 API，验证 Nginx 及旧健康。
任何新业务数据产生后禁止直接快照回滚，先保全新增数据。
