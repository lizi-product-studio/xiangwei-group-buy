# TASK-20260907-HOUSEKEEPING-REPLACE

## 冻结目标与授权

- confirmed：用户于 2026-09-07 明确家政正式下线，家政服务器与域名交给拼团，并授权“直接开始迁移”。
- confirmed：本次迁移目标为 housekeeping-server / 192.144.136.205；当前服务器用途以根目录 `AGENTS.md` 第 3.1 节为准。
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

- 主 Agent：本文件唯一写入者；负责目标、决定、验收汇总。
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

Project Assessor：重大任务，高风险正式服务替换。最小角色为主线程、研发负责人、独立 QA。
切换前必须核验资源归属、一致性异机备份、数据库隔离恢复、空间余量和单一 HTTPS 入口。
微信配置完整不等于真实交易验收通过；真实交易开放单独验证。

## 当前状态

A+B COMPLETE：家政退役与账目保留、最终备份恢复、维护入口、新数据服务与生产空业务基线通过最终独立验收。D COMPLETE：用户追加的旧家政资源清理已通过独立 QA attempt 20，财务和恢复资料转为异机保留，旧服务器容器与数据卷已删除。C-LIVE 服务部署 PASS：真实 API、后台静态资源及授权管理员已部署，公网健康和服务边界通过独立后验；浏览器UI与真实微信交易仍未验收，小程序体验版/正式版未发布，不宣布完整交易上线。

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
QA attempt 5：PASS（仅 A 证据审核及 B 分阶段执行条件审核），不是 B 部署结果或 C 交易上线 PASS。
最终停写备份恢复 PASS；B1 研发 11 项公网冒烟 PASS，主线程另核 admin=200、API=503、saas=410。
QA attempt 7：维护补丁审核 PASS，B2 基础设施及指定真实集成验收 PASS，模板设计审核 PASS；C 仍 BLOCKED。真实集成 7/7 PASS、零 skipped；微信真实链路 NOT_RUN。
QA attempt 8 原始最终结论：A+B 阶段 PASS；范围为家政退役与账目保留、异机备份恢复、拼团维护入口部署、新数据服务及空业务基线准备；C 未验收，完整交易上线仍 BLOCKED。

## 已执行结果与版本

- 2026-09-07 09:27:05（中国时区）：停止家政 API 和两条专属 cron；数据库无未完事务、无应用连接、启用事件为 0。
- 最终 SQL 117302 字节，SHA-256 fffa6f4c989658bd928869e5c6bff9a8d88e58cc74a8ea081e1b1e907319b08a；最终文件归档 14407922 字节，SHA-256 905c444255cdab187fd5953537def45c0b4fc04299a5c49e4033c70d07097927。流式双端退出 0。
- 干净独立 MySQL 8.0 恢复最终 SQL 成功，46 表及账目聚合与停写后源一致；OOM=false，恢复容器停止。QA 已直接核验最终比对证据。
- 本地范围提交 9856735；原生 Git HTTPS 鉴权失败，未修改凭据。通过已连接 GitHub 工具确认远端 aa2d162 与本地原基线 39751e2 的树相同，以远端为父创建提交 4d2ce58a56a14aadb36212bc79bbfebf6dd37637，force:false 更新 codex/audit-remediation。
- 本地 9856735 与远端 4d2ce58 的树均为 dd7d99c6baf880d1dac42e98ef6f71384d19164b；本地历史未重写，未强推。部署版本为远端 4d2ce58。
- 2026-09-07 09:34:16：B1 完成，旧 API/DB 停止，root_mysql_data 保留，Nginx 校验和 reload 成功。主/admin 静态页面 200、API/health 503、旧入口/saas/8443 410。
- 静态包 SHA-256 9106519eddb3da0a72576834968bc0253ebe9e3c1a5084a1e67f8ca4eaa6b4ef；index SHA-256 c0ee030cc3172e857e472f98596d22de3619ba1c5bff3d13eb86bfad673cb4a9。
- 脱敏运行证据在受限备份目录的 final-backup-integrity.json、final-restore-compare.json、b1-public-smoke.json、b1-version.json；秘密、SQL和归档不进入 Git。
- 家政未结账目由用户后续结清，不能把停服务记作财务清偿。
- B2：新 MySQL 8.4.11、Redis 7.4.11 健康、无宿主公开端口、OOM=false；隔离测试库执行迁移两次均成功，真实 MySQL/Redis 7 项通过。测试 Redis 与 SSH 隧道已停止。生产 hometown_food 仍为 0 表，无测试数据或管理员初始化；不能称 API 数据迁移已完成。
- 资源采样：可用内存约 630MB，磁盘约 3.9GB；后续 API 需重新核算单实例运行预算。
- 用户已提供支付公钥 ID 和营业执照主体全称；研发已补入受限配置，真实模板 ID 与字段映射仍待完成。公钥 ID 与既有文件的实际平台对应关系尚无真实回调验证。
- 模板设计见 docs/wechat-subscription-template-design.md；设计不等于微信后台模板已选用/审核。
- C 阶段禁止直接启动原 compose.production.yaml 全栈：Caddy 会与现 Nginx 冲突，资源限制也不同。真实 API 需经审核的现 Nginx 连接方案、数据库基线与管理员初始化，以及完整微信配置后另行验收。
- 2026-09-07 09:45:48：维护页修补部署完成，远端 7d3ed618648bf6fa279ec7fc7166bbd39da85f91（父 4d2ce58）；本地 12f1f1e 与远端树均为 0c19b0f231786357cd96187ee0e74b416947ff75。主/admin 首页明确配置中、暂未开放登录下单，无登录表单。
- 维护 HTML 本地与两个公网哈希均为 da8fe5097fc16c31f97687ce01eccb98bd28028a797377004d9e4c9363085ccf；API 503/旧路由 410 回归通过。最终证据 maintenance-final-version.json 与 maintenance-live 截图。
- 此后在已复核为空的生产 hometown_food 中执行未修改基线两次，均退出 0，3 条迁移 APPLIED、schema_version=3，仅初始化空 staff/sessions/credentials 数组，无业务数据或账号。此记录替代前述“生产库 0 表”的阶段状态；API 仍未启动。
- 新基线备份 1332 字节，SHA-256 7d37b13d766a55e9a4b0c7a9ef308bc8d3e6f5c9958d07f91040ee9300dc69e8；隧道关闭。证据 production-baseline-evidence.json、production-schema-verification.txt 与两次 migration 日志。

## 剩余工作与限制

- 五个实际订阅模板 ID、关键词映射及发送器本地适配已完成并验收；实际账号归属、类目/场景及平台真实字段接受和发送仍未验收。
- API 运行配置、资源预算与现 Nginx 连接方案尚未完成发布，未创建管理员账号；当前首页仅维护，不支持业务登录或下单。
- 小程序仅完成消费者 AppID 对齐，尚未上传体验版/正式版或替换微信线上代码；真实登录、支付、退款及消息落点尚未验收。
- 外部公网 IPv6 探测失败，无法区分本机网络路径与服务端可达性；服务器 IPv6 loopback 路由已通过，未把外部 IPv6 写成 PASS。
- 知识反馈检查：本次仅记录项目迁移事实，无需更新跨项目知识库。

## 分阶段执行清单（研发冻结，经 QA attempt 4 补充）

QA attempt 4：A 可执行，须纳入以下补项；不是 B 批准或完整迁移 PASS。主 Agent 已批准研发执行 A。
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

#### C-SUBSCRIPTION：五模板适配（2026-09-07 新交接）

- task_id：TASK-20260907-HOUSEKEEPING-REPLACE；route：重大任务；状态：本地适配 QA PASS，真实微信上线 BLOCKED。
- confirmed：已读取用户授权交接任务「撰写小程序介绍」及五张模板详情截图；用户确认纯数字取货码、同意逾期优先复用订单状态变更。截止时间沿用项目权威领取规则，由研发统一中国时区格式化，不要求用户另设日期规则。
- delta：原四模板改为五模板映射七事件，补齐真实订单/退款/取货字段、逐类型格式与长度校验，检查数字码生成及已有有效码兼容、跨端授权映射和体验版/正式版跳转。
- authority：实际字段与差异以 docs/wechat-subscription-template-design.md 顶部五模板决定为准；完整账号 template_id 待复制文本校验，模板类目/场景匹配与真实发送未通过。
- ownership：主线程维护本记录和模板设计；现有研发负责人独占相关源码/测试/环境示例及代码关联文档；Assessor 只读评估关键风险，独立 QA 只读验收。保留 .codex 用户资产。
- acceptance：五模板七事件前后端一致；数字码不使旧有效码失效；截止与订单页同源；退款引用真实成功对象；逐字段类型/长度合法；拒绝订阅与失败处理、消息订单归属及 trial/formal 明确；pnpm check、E2E、相应定向和必要真实集成通过，真实渠道结果另记。
- non_goals：本小批次不切生产 API、不上传/发布小程序、不修改微信类目、不发送真实消息/支付/退款、不绕过电脑操作工具对微信后台 URL 的限制。
- stop_conditions：已有有效码需不可逆变更、退款来源不明、必须擅自改变领取规则或平台场景、敏感凭据暴露时停相关路径并上报；真实模板 ID 缺失不阻止不依赖其值的本地适配。
- 已实施：五模板严格字段映射与五个不同账号 ID 校验；小程序 3+2 授权分组和主动再次订阅；偏好绑定实际模板 ID，旧无绑定偏好不当作新授权，两端 ID 不一致返回 409。共享事件偏好不制造多次发送额度。
- 已实施：通知读取真实订单、点位及持久窗口截止；六位数字码的 HMAC 输入/secret 保持，发送前核验有效凭证 hash。新窗口截止按 PRD 秒级规则，旧持久窗口原样；延期等导致过时的截止/逾期事件停止发送。
- 已实施：部分退款通知新增可选 refundId 关联，读取这一笔 SUCCEEDED 退款的金额及微信 providerRefundId；商户退款号和资金幂等逻辑不变。关键上下文缺失在提交前转人工，提交后结果未知不盲目重试。
- 兼容与配置：新增可选 JSON 字段，无 SQL 表结构迁移；保留旧凭证和窗口。旧四模板配置需更新五模板配置后才能启用；生产通知跳转环境显式配置 trial/formal。本批无生产 env/路由修改、无微信写入或小程序上传。
- 最终验证：pnpm check PASS（domain 4 / contracts 24 / mini 108 / admin 70 / API 132）；真实 MySQL 8.4/Redis 7.4 独立集成 8/8 PASS 零跳过；最终 E2E 13/13 PASS。普通 check 的 8 项集成 skip 由单独真实运行补齐。首轮旧测试消息残留导致一项失败已保留日志，限定隔离测试聚合清理后全量重验通过，生产库未写；临时 Redis 和隧道关闭。
- QA attempt 22 原始结论：本地五模板适配 PASS；真实微信上线仍 BLOCKED。冻结 29 实施文件及 4 日志 SHA 审核一致；唯一 P3 非阻塞项为部署示例旧占位符注释，安排单点修订后补验。
- QA attempt 23 最终结论 PASS；P3 注释已 FIXED，仅该注释变化，其余 28 实施文件不变。新冻结 manifest SHA 17334c3371422a83e8ca5dcb54a89c539fa4c783157a0d7ab2bea75d603338b5；三份主线程文档一致性复核通过，可提交本批次，真实微信上线仍 BLOCKED。
- 证据入口：受限备份目录中的 subscription-freeze-manifest.json、subscription-validation-evidence.json、subscription-check.log、subscription-real-integration.log、subscription-e2e.log 与 subscription-integration-evidence.json。没有真机截图/真实发送凭证，不能将本地通过记为渠道通过。

#### C-TEMPLATE-CONFIG：复制文本落地

- task_id：TASK-20260907-HOUSEKEEPING-REPLACE；route：范围明确的迭代（已验收逻辑上的本地配置小批次，无生产/渠道写入）；状态 COMPLETE（本地配置落地，独立 QA attempt 24 PASS；完整生产 preflight 未通过）。
- confirmed：用户在来源任务提供五个完整模板 ID；主线程已读取原始用户消息。仅首条 Markdown 转义下划线规范化，其余字符原样。长度/字符集/唯一性初检通过，实际账号归属与平台接受仍未验证。
- ownership：研发单写受限本地 deploy env 和 Git 忽略的小程序部署配置；主线程持有任务及模板文档；独立 QA 只读检查实际读回和定向验证证据。
- acceptance：五 ID 与用户文本逐字符一致，后端五字段 schema 与前端七事件映射一致，HTTPS/微信登录及显式 trial 配置通过本地校验；既有凭据和用户文件保持，真实配置不进入 Git。
- non_goals：不修改已验收业务逻辑、不重复全量业务测试、不切生产、不上传或实发、不访问受限微信后台、不猜测修正相似字符。
- stop_conditions：发现已有配置冲突或需改凭据时只停相关写入并报告；ID 缺项或形态异常保留原文上报，不再要求用户提供已经收到的值。

- 研发 attempt 24：两个实际配置逐字符读回、五模板七事件映射、字段契约、Git ignore 与 diff 检查通过；定向配置及 provider 测试 11/11 PASS。仅 trial 使用 HTTPS 和微信登录，release 保持拒绝启动，无 develop override。受限 env 原 16 个键值不变，原件已备份，两个配置均权限 600。脱敏证据：受限备份目录 `template-config-evidence.json`。
- 完整生产 preflight 未通过：当前 deploy.env.incomplete 是 Compose 插值片段，不能直接作为 API runtime env；直接加载会落入 development/demo/mock 默认。完整运行层的数据源、队列、认证/支付 provider、HTTPS 及支付密钥容器路径尚须部署阶段组装验证。本批未猜测补入，不代表 API 或微信发送可用。

- QA attempt 24 原始结论：PASS，仅限本地配置落地。完整生产 preflight 未通过，真实渠道 NOT_RUN。独立验证实际文件指纹/权限、五组 DATA/七事件、私有来源 ID 一致、原 16 键未变及 Git 忽略。原始用户消息与首条转义规范化由主线程确认，QA 未宣称独立读取用户原文。

### D：服务器旧家政资源清理（2026-09-07 用户追加）

- confirmed：用户在查看系统盘占用后明确要求“旧的跟家政相关的全给我清了。只保留跟拼团有关的”。本阶段优先于 C 配置工作。
- confirmed：此前“保留账目待结清”的决定继续适用；旧财务记录及完整恢复资料保存在本机受限异机备份目录，不把服务器清理视为结清或销毁全部备份。
- decision：最新清理授权替代 A+B 阶段“在服务器保留旧容器和旧卷”的措施，保留财务的方式改为已验证可恢复的异机资料。完成 D 后，下文 B 的直接启动旧容器回滚流程失效；如需恢复旧家政，必须从异机归档重建旧镜像、配置和数据库，并重新验证，不能称为快速回滚。
- scope：核实后删除服务器退役家政代码、静态历史版本、容器、旧库卷、旧镜像及确认为旧构建的缓存；旧库卷删除以异机最终备份完整性和恢复证据通过为前提。
- non-goals：不清理本机用户项目/备份，不删除拼团数据或依赖，不删除拼团沿用的域名配置、HTTPS 证书、微信身份和支付密钥，不发起真实结算。
- ownership：主 Agent 维护本记录；Engineering Lead 独占服务器清理写入；独立 QA 只读审核精确清单及清理后结果。
- required checks：冻结删除与保留清单，检查共享引用、异机备份与恢复证据；QA 预审后执行；记录磁盘前后及真实释放量、拼团 MySQL/Redis 健康、维护页 200/API 503/退役入口 410 和关键保留文件存在。
- stop conditions：备份不完整、资源归属不明、共享依赖或运行健康异常时暂停对应对象，不使用全局 Docker prune 替代精确清单。
- status：IN_PROGRESS；初查 Docker 镜像 18.85GB、构建缓存 9.285GB，两者包含共享内容，不能相加作为确定可释放空间。
- QA attempt 9：异机最终 SQL/文件归档重新计算 SHA 与 gzip 完整性 PASS，46 表与财务恢复证据仍有效；其余对象待逐项冻结。
- QA attempt 10：首批两个旧家政日志预审 PASS，分别为 `/root/.pm2/logs/housekeeping-error.log`（10,141,246,476 字节，inode 117454897）和 `housekeeping-out.log`（135,609,508 字节，inode 117454896）。均为单硬链接普通文件，登记于旧 housekeeping PM2 应用，当前无应用进程或打开句柄。主线程授权研发复核元数据后精确删除；未扩大到整个 PM2 目录。实际释放量待执行后记录。
- D0 已执行：两日志删除且未重建；XFS 异步回收后已用 28,381,917,184 字节、可用 14,499,577,856 字节，占用 67%，较执行前释放约 10,276,896,768 字节。独立 QA 再测仍为 67%，拼团 MySQL/Redis 健康。其余对象不因 D0 通过而自动放行。
- QA attempt 11：D1 清单预审 PASS，manifest SHA bca43326aa74a7457bdd2b9e0ac0531e912d364ae855e0d7c7890447c5de6c45；允许 4 个停止旧容器、3 个旧卷、3 个旧源码目录、37 个旧静态路径与空 root_default 网络。原初备未覆盖的 admin/frontend 已补异机归档，QA 重算 SHA 并解析 13,128 成员通过；复用 AppID/AppSecret/APIv3 的受限保留配置一致性布尔验证通过。主线程批准按清单、不跟随符号链接删除；镜像/缓存尚未放行。
- D1 已执行并独立后验 PASS：上述资源均不存在，拼团数据容器健康、维护 HTML 哈希一致、API 503；清理后使用率 64%、可用约 15.72GB。
- QA attempt 12：D2 预审 PASS，manifest SHA 7756d018b341327b749f8794b6d12a49d45543ca9821542392ec10fac51df244；31 个旧镜像与保留镜像及容器无 ID 交集，105 条缓存均 unused/nonshared。主线程批准精确 ID 清理；原生 builder 若不支持精确 ID 过滤则停止缓存批次，不改用全局清理。14 条归属不明确或共享缓存继续保留，实际释放量待后验。
- D2 镜像后验 PASS：31 个旧镜像 ID 均消失，3 个拼团基础镜像保留；磁盘使用率降至 49%，可用 22,284,656,640 字节。原 105 个缓存命令均退出 0 但释放 0B，实际 ID 仍在，未记为成功。
- D2 原因更正：不能据 legacy 提示推断不支持 BuildKit 清理；QA 已核 Docker 29.3.1 对应官方代码，`shared=false` 被转为字符串等值匹配，实际 shared 字段以存在性表达，导致未匹配。QA attempt 14 仅批准原清单内一个叶缓存 ID、前置 unused/nonshared 验证和锚定 ID 条件试删；剩余批次待试验结果，不扩大至全局清理。源依据：https://raw.githubusercontent.com/moby/moby/docker-v29.3.1/daemon/internal/builder-next/builder.go 与 https://raw.githubusercontent.com/moby/buildkit/v0.28.1/cache/manager.go 。
- QA attempt 13：D3 v3 55 路径清单预审 PASS，SHA ab12486522eee65640d938dc804fd8099b1dd9cc980d207896d2f201018dba57。52 项必要资料异机归档 46,331,474 字节，SHA 3463d8190eda779cc920fb5bf1e1b6e26bb51a7ec9ab716703463373740e4f70，4,194 成员和路径覆盖验证通过；3 个历史备份目录按最终恢复集保全策略清理，不要求保存每个淘汰历史快照。个人简历、output 父目录、通用工具和 .cursor 明确保留。主线程批准精确删除。
- QA attempt 15：D3 删除后验 PASS，55 路径均不存在、指定保留目录与配置存在；维护 SHA 一致、API 503、saas 410。D3 释放 1,034,223,616 字节，可用空间 23,318,818,816 字节。
- QA attempt 16：缓存单 ID 试验后验 PASS，仅目标消失、其余缓存和镜像 ID 不变；批准剩余 104 个原清单 ID 的锚定正则集合单批清理（manifest SHA b5030123b583e45189a772abc5586644267aed6e0db0ac4d66dfe99dfe8968d7）。删前逐项 unused/nonshared 且无真实构建，后验不得有范围外 ID 消失。
- QA attempt 17：发现运行约 13 天的两个旧家政构建等待孤儿进程，完整命令只循环检查 housekeeping-refund-main-add 并 sleep；核查 PPID1、cwd 与命令后，主线程批准精确 SIGTERM 两个父进程，不使用广泛 pkill。
- QA attempt 18：104 缓存单批后验 PASS，仅清单 104 项消失、无新增或范围外变化，镜像保持；Docker 报告 reclaimed 约 3.694GB，此值不等于磁盘实际释放量。两个旧轮询进程精确 SIGTERM 后不存在，数据容器健康。
- QA attempt 19：最后 18 项旧构建缓存预审 PASS，manifest SHA 7ef02e59a684048f2816fe0e3ba094a52baf6013eeea2289dc9588204384d8a5；原 17 清单标 STALE 未执行，新增一项已由异机归档内旧 admin Nginx Dockerfile 逐字核对来源。主线程批准精确 18 项批次；其余 109 项通用/共享缓存保留，不扩大清理。阶段磁盘占用 44%、可用 24,393,252,864 字节。
- D 最终执行结果：按审清单移除 31 个旧镜像、123 项旧构建缓存、4 个停止旧容器、3 个旧数据库卷、3 个旧源码目录、37 个旧静态路径、55 个旧发布记录路径、2 份大日志和 2 个旧轮询进程。109 项通用/共享缓存及拼团依赖保留；系统、个人资料、复用证书及微信支付配置未清理。
- 最终磁盘实测：已用从 38,658,670,592 字节降至 18,400,108,544 字节，物理释放 20,258,562,048 字节（约 18.87GiB），占用从 91% 降至 43%；可用 24,481,386,496 字节（约 22.80GiB）。以 df 差值为准，不将各批 Docker 逻辑回收量相加。
- 研发最终烟测：主/admin 200，维护 HTML SHA 与已验收版本一致；API/health 仍按维护预期 503，saas/8443 410；拼团 MySQL/Redis healthy。证据入口：受限备份目录 `cleanup-final-evidence.json`。C 仍未上线，本次清理不代表真实交易功能验收。
- 知识反馈检查：仅保存本项目授权、清单及清理证据；没有用户要求更新长期记忆，本次不更新知识库。
- QA attempt 20 最终原始结论：D 阶段 PASS，冻结的旧家政资源清理完成，拼团服务及保留资产未受影响；C 未完成。独立后验磁盘 43%、可用 24,481,390,592 字节；重算最终财务 SQL、文件包、匹配镜像、admin/frontend 源码和必要发布记录五份异机归档 SHA 均一致。123 缓存仅目标消失，109 项通用/共享或归属不足缓存有意保留；不宣称所有含家政字样内容已清空。

### B 回滚

停止新栈并保留新卷，恢复原 Nginx 配置及静态链接；启动旧 DB 健康后再启动旧 API，验证 Nginx 及旧健康。
任何新业务数据产生后禁止直接快照回滚，先保全新增数据。


### C-LIVE：恢复生产 API 与后台交付

- task_id：TASK-20260907-HOUSEKEEPING-REPLACE；route：重大任务；状态 COMPLETE（API/后台服务部署范围 PASS；浏览器UI与真实微信外部验收 NOT_RUN）。
- confirmed：用户再次指出已提供 ID 并要求解释为何未开放。原“直接开始迁移”、复用家政服务器/域名/消费者身份与支付配置的授权继续适用；不再把已收到的五模板 ID 当作缺失材料。前一配置批次的本地限定已完成，后续部署仍需独立审核和备份回滚。
- objective：完成当前真实 API、后台产物和 Nginx 连接的准备、审核及获授权部署，提供可测试入口和真实剩余依赖；不把服务健康等同真实支付验收。
- ownership：研发独占实现、私有配置和服务器写入；主线程持有本任务文档；评估与 QA 只读。
- acceptance：完整 runtime 配置严格校验，HTTPS/真实 provider、数据隔离及资源预算正确；版本与 Git 树一致；部署前备份与回滚可用；部署后 API 健康、后台资源及授权边界通过检查。管理员首次初始化若需用户指定凭据，先明确具体缺项，其他准备继续。
- non_goals：不发起真实支付/退款/订阅消息，不上传或发布微信代码，不访问受限微信后台，不轮换已有凭据，不写演示业务数据，不恢复旧家政。
- gates：研发先冻结部署差异、配置预检和回滚证据交独立 QA，审核后主线程放行服务器切换；测试按实际部署变更和已有通过证据覆盖，禁止把待做工程工作描述成用户未提供 ID。

- confirmed（后续回复）：用户同意生成初始密码，并要求直接在对话交付，登录后自行修改；管理员登录名默认 admin、显示名默认“管理员”。真实手机号待用户指定，未提供前不创建账号；此项不阻塞其它部署准备。必须核实实际改密码流程，不承诺不存在的入口。

- confirmed（管理员补齐）：用户已指定真实管理员手机号，准确值仅保存在受限初始化输入，不写入本仓库。首次创建 admin / 管理员并随机生成强密码获授权；不得覆盖任何现有账号或轮换既有密码。手机号缺项已解除。

- 研发 attempt 25：完整 37 键 runtime 配置实际生产预检 PASS，API/admin 本地 build PASS，已有“修改我的密码”UI。API-only 容器接现有数据网络，loopback 3100，复用宿主 Nginx；本机无 Docker，服务器受限构建须冻结精确监控与停止方案后再审。镜像构建审核不等同 API 启动或切换批准。

- QA attempt 25 受限构建预审 PASS：停止脚本两项缺陷已修复（清理异常仍保证终止客户端、最终数据健康失败非零退出），冻结 SHA c0d6caafd1aed2a40ad44d67d85472479cebf64d188e63f0dacc5fe6e07b391f。主线程允许前置内存≥640MiB、磁盘≥4GiB、数据健康时执行一次512MiB/0.5CPU构建，每2秒监控，低于256MiB或20分钟停止，不自动重试。仅覆盖构建，未放行API启动/账号初始化/切流。

- QA attempt 26 合并执行预审 PASS：镜像构建exit0已独立核实，原wrapper exit1保留为大小写误报（11个RUN均不存在、数据健康）；仅监控脚本一行修复，不重构镜像。network-none配置/密钥隔离检查后，复核无资金/待发业务和既有管理员；只允许明确 ADMIN_BOOTSTRAP_REQUIRED 的预期503进入首次bootstrap，其它依赖和reconciliation必须正常。bootstrap后ready200、调和状态ok/fresh/hasError=false、登录及资源版本一致才切Nginx。主线程按原授权放行此合并步骤，失败回维护并保留数据/已建账号。部署最终结果待后验。

- C-LIVE 研发执行：API已启动，首次仅ADMIN_BOOTSTRAP_REQUIRED，其它依赖正常；已执行授权admin首次初始化，ready200及reconciliation状态ok，通过loopback真实管理员登录。Nginx校验成功并完成公网切换；主域/admin200，未授权staff401，saas/8443/旧uploads410。完整后验由QA继续。
- UI后验限制：主线程内置浏览器访问admin时ERR_CONNECTION_CLOSED，随后错误页data URL被工具URL策略拒绝；停止该浏览器路径，不绕过。同期本机HTTPS HEAD为200；这不能替代浏览器登录UI验收，UI明确NOT_RUN。

- 独立QA最终服务后验 PASS：主域/admin200且index与入口资源字节一致，ready各依赖ok/reconciliationok，staff未授权401及旧入口410；Nginx文件指纹和IPv6loopback检查一致；API镜像414fbcf2b14e36b29e1740afd09b9193ac7bd412176595619681ffd74f7a42f4、UID1001、384MiB、0.75CPU、loopback端口、OOM=false/restart=0，两数据服务健康无公开端口。只读SQL确认身份/审计/会话初始化各1，其余全部业务对象0。浏览器UI和真实微信仍NOT_RUN。
- 部署来源：本地31847fac与远端db1cf1ceaf20238b25c68322f4a0e8122973b0ab的tree同bf3b0e4e62e436f80e508c058e5107031e57c1c4；源归档SHA6f3d3bacc2ee0b7b6de11bd77cee79cf772437f215ca76be5fdc8b14f282c9ac。仅后续监控脚本大小写修复和本文记录不进入API运行镜像，不为非运行代码重构镜像。静态9文件双端SHA一致，证据live-static-hashes.json；公开后验live-public-check.json。
- 最终资源：研发实测磁盘47%，已用19839631360字节、可用23041863680字节，可用内存约978MiB。用户指定凭据仅受限文件保存，并按授权对话交付；不写入Git。知识反馈检查：仅更新本项目证据，无长期知识库更新授权，本批不更新知识库。
