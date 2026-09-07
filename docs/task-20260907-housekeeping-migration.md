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

A+B COMPLETE：家政退役与账目保留、最终备份恢复、维护入口、新数据服务与生产空业务基线通过最终独立验收。D COMPLETE：用户追加的旧家政资源清理已通过独立 QA attempt 20，财务和恢复资料转为异机保留，旧服务器容器与数据卷已删除。C BLOCKED：真实 API 与小程序交易上线未完成，不宣布完整迁移上线。

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

- 实际订阅模板 ID、关键词编号/类型与审核状态待微信后台取得；推荐设计中的订单号、领取截止和退款金额需要发送器适配与验证。
- API 运行配置、资源预算与现 Nginx 连接方案尚未完成发布，未创建管理员账号；当前首页仅维护，不支持业务登录或下单。
- 小程序仅完成消费者 AppID 对齐，尚未上传体验版/正式版或替换微信线上代码；真实登录、支付、退款及消息落点尚未验收。
- 外部公网 IPv6 探测失败，无法区分本机网络路径与服务端可达性；服务器 IPv6 loopback 路由已通过，未把外部 IPv6 写成 PASS。
- 知识反馈检查：本次仅记录项目迁移事实，无需更新跨项目知识库。

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

### D：服务器旧家政资源清理（2026-09-07 用户追加）

- confirmed：用户在查看系统盘占用后明确要求“旧的跟家政相关的全给我清了。只保留跟拼团有关的”。本阶段优先于 C 配置工作。
- confirmed：此前“保留账目待结清”的决定继续适用；旧财务记录及完整恢复资料保存在本机受限异机备份目录，不把服务器清理视为结清或销毁全部备份。
- decision：最新清理授权替代 A+B 阶段“在服务器保留旧容器和旧卷”的措施，保留财务的方式改为已验证可恢复的异机资料。完成 D 后，下文 B 的直接启动旧容器回滚流程失效；如需恢复旧家政，必须从异机归档重建旧镜像、配置和数据库，并重新验证，不能称为快速回滚。
- scope：核实后删除服务器退役家政代码、静态历史版本、容器、旧库卷、旧镜像及确认为旧构建的缓存；旧库卷删除以异机最终备份完整性和恢复证据通过为前提。
- non-goals：不清理本机用户项目/备份，不操作旧百度服务器，不删除拼团数据或依赖，不删除拼团沿用的域名配置、HTTPS 证书、微信身份和支付密钥，不发起真实结算。
- ownership：主 Orchestrator 维护本记录；Engineering Lead 独占服务器清理写入；独立 QA 只读审核精确清单及清理后结果。
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
