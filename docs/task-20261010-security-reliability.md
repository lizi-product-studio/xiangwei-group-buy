# SEC-20261010 安全、恢复与可维护性改进

2026-10-10 用户要求先保护用户和数据，再逐步改进可维护性、扩展性及故障定位，必须实际验证；登录不得恢复倒计时或长期账号封锁。异常/恢复/需要处理邮件的接收人仅记录在受限配置中。

## 来源、职责及边界

- 起点为公开 GitHub main `8a405b2b3c6c8864d5bd074701a601a46a2e1104`，树 `a89e3d7ddfe59d1e73c9cc022ff9c77d4f99dccd`；apps/packages/infra/scripts/.github 共478个文件与已验收 `0767bf0eea85ed86e08e6921aeb0e33a49fa9b8e` 路径/模式/blob相同。保留远端后续资料。
- 当前隔离目录 `/Users/lizi/.codex/worktrees/security-reliability-sixth-20261010/拼团项目`；ROTATE-2 已完整迁入并核验原源码、未提交文档及忽略资产，新主编排持有独立附件，旧路径不再作为业务入口。桌面旧 main 及用户未提交资产不改写。
- 主编排 `01a12508-8b80-74c3-a587-03a00d814bc3`：任务记录、范围、服务器和发布写入窗口。工程 `01a12508-899c-7040-b1ef-3f2a5af7a3ac`：本轮实现及必要测试唯一写入者。QA `01a12508-8776-7281-b7b2-3d4c08d22c55`：指定冻结版本只读审核及隔离反例证据。2026-10-10 监控已确认三角色安全移交、旧角色停止并归档，新索引已核对；最新交接见桌面 `output/security-reliability-20261010/HANDOFF-20261010-ROTATE-2-coordinator.md` 及同目录迁移/完成回执，不重复已完成正式操作。
- 正式机192.144.136.205，测试机180.76.100.156。授权普通可逆服务器发布、GitHub同步、合成数据验证和指定邮箱告警；不包含真实交易、微信发布、凭据改变、真实库恢复/清库、不可逆迁移、额外付费。模型与推理设置只由用户本人修改。
- 复盘聊天正在处理的资料/技能不归本轮写入者；不恢复被禁止插件，不新增聊天或子代理。

## 稳定验收项

| 编号 | 用户可见结果与验收边界 | 状态 |
| --- | --- | --- |
| S01 | 错误密码后能立即重试；自动猜测和恶意并发受控；挑战伪造/重放拒绝，错误响应不泄露账号；高权限敏感操作再认证，不代理设置MFA/密码 | 适用验收通过，正式机已部署；真实员工/微信外部边界另记 |
| S02 | 员工网页长期凭据不暴露给脚本；Cookie/CSRF/同源/过期/登出/撤权及两域多身份实际浏览器通过；微信消费者Bearer契约不串用；CSP/防嵌入/HSTS兼容实际渲染 | 适用验收通过，正式机已部署；N01非阻塞建议保留 |
| D01 | 核对数据库暴露/权限、最新备份/异机副本和密钥保全；可逆改善；缩短数据损失窗口并用合成数据实际回放与故障恢复；验证金额/状态/归属，明确RPO/RTO，生产数据不进测试机 | OPEN |
| O01 | 指定邮箱仅异常/恢复/处理通知，去重/重试/发送失败可追踪；覆盖健康、备份、副本、退款、通知；请求ID与脱敏日志实际可定位，不把本机监控说成24小时服务器能力 | 监控/只读接线已部署，独立QA及自然周期通过；真实SMTP送达受既有网络阻断，尚未完成 |
| Q01 | 修复原型lint检查范围而保留业务门禁；实跑检查，确定真实CI名称后实施适当main保护，权限不足明确报告 | PASS；main保护已保存并按成功CI普通快进，见最新回执 |
| M01 | 安全交付后按相关页面/路由模块拆分，统一入口定位器及测试，不整仓重写 | 本轮商品/分类页最小提取PASS；隔离验证、独立QA、同包正式静态及GitHub源码同步完成 |
| C01 | 真实MySQL/Redis并发/历史量/SQL成本测量；必要有界查询/任务调度优化，实测关闭通知容量；全局锁变更必须独立一致性反例验证，不直接去锁 | 本轮两档吞吐与故障边界独立验收PASS；保留测量范围及未收集指标，不外推生产容量 |

## 分阶段交付

先形成 S01/S02/Q01 安全候选，按同版隔离实测、独立QA及授权发布完成后及时报告；并行推进 D01/O01 的实际环境核对和可执行方案，不用未完成广泛优化拖住安全交付。然后推进恢复/告警及 M01/C01；阶段完成不表示所有项关闭。

证据目录：桌面 `output/security-reliability-20261010/`。原有 LOGIN-T01、D04 和真实微信验收边界保留。

## 当前前置证据

起始核对时正式API为login-20261008镜像b4551ef...且healthy；后续实际发布见安全阶段回执。MySQL/Redis无宿主端口暴露；MySQL log_bin=ON/ROW、sync_binlog=1、innodb_flush_log_at_trx_commit=1，binlog过期86400秒，已有日志约2.8GB。最近快照BACKUP_OK并PUBLISHED；测试机异机pull成功且最新副本VERIFIED_CIPHERTEXT_ONLY，age identity目录0700/文件0600。现有快照没有本轮证明的连续日志归档/位点恢复链；不能把数据库开启binlog说成PITR通过。

服务器无现成SMTP配置或发信程序。已连接Gmail向指定收件人发送一次授权合成异常/恢复测试，messageId 1a123c49096d19e1，SENT；用户随后确认Outlook已收件，并选择Gmail SMTP作为独立服务器发信通道。应用专用密码由用户本人配置，不能通过Connector导出；独立持续告警仍OPEN。邮件回执仅存本地证据。

用户随后亲自填写受限配置，并明确决定按现配置继续。主编排仅通过受限文件传输安装 `/etc/hometown-alert/smtp.json`（目录0700、文件0600）；没有从聊天取值或将秘密放入源码、命令参数和日志。2026-10-10 首次正式机 SMTP 请求在认证前超时，`authenticated=false/messageAccepted=false`，尚无服务器邮件送达证据。下一步按实际网络断点定位，不把该结果写成凭据无效；去重、重试和持续监控仍待候选实测。回执 `output/security-reliability-20261010/smtp-server-smoke-receipt.json`。

2026-10-10 用户反馈已收件并要求停止重复测试邮件，撤回向真实邮箱继续合成/烟测/异常恢复测试外发的授权。只保留真实异常/恢复/需处理告警；允许无DATA的连接/TLS/AUTH/NOOP验证，以及隔离邮件捕获器中的去重/重试/恢复测试。现有收件陈述未明确对应服务器测试主题，不能推断服务器SMTP已验收；不再次发信或向用户追问收件。旧 `smtp_server_smoke.py` 仅为执行证据，不再运行。

协调会话随后实际查看用户Outlook截图：11:04收件对应原主题“告警通道验证：合成异常与恢复”，事件SEC-20261010-MAIL-TEST-01；正文说明经已连接Gmail发送且独立服务器持续告警仍待接线。收件证据确认属于原Connector测试，未填补服务器SMTP验收缺口。截图仅保存在本轮受限本地证据，不上传公开仓库。

D01 合成 PITR 前提实测通过：快照 `sec-binlog.000003:3707` 连续跨三段回放至 `.000005:1098`；4订单/2部分退款，金额、状态、消费者和点位逐行匹配，目标之后事务排除。包含恢复容器冷启动12.002秒，仅为极小样本，不代表生产RTO。QA恢复容器已停止，主业务测试schema未触碰。报告 `output/security-reliability-20261010/qa/D01-PITR-precondition-review.md`；正式应用结构、age连续异机归档及缺段/篡改/截断/过期/收集和恢复中断反例仍OPEN。

D01 权限待修：正式运行账号 `hometown@%` 仍持有业务schema的ALL PRIVILEGES（含DDL）；`database-grants.json` 的PASS只表示探测成功，不证明最小权限已完成。迁移脚本与日常运行的权限用途须在隔离MySQL实际验证后，再由主编排按可恢复授权收窄；保留当前授予清单及恢复办法，不改密码或新增正式凭据，不直接撤除未知发布依赖。

main当前无保护/rulesets空；原CI实际名称scope/checks/browser/images(admin)/images(api)/verify，待修复后的实际成功结果确定必需检查。连接器只有GET分支保护能力及业务Git写工具，尚未发现管理写API；未造token。

## 阶段A冻结审核

工程冻结 `118a02578d39bc96bf34cd28b0236c7f0cb7dece`，树 `fb7ed2af8d74be44b7610a29b8eb1ab378671ea1`，完整源包SHA256 `0e252dd8b5f33c84cd181b6073e7ab277f6c91da6e7745fc1fd5ec5be45c2e39`，682/682文件内容/模式核对通过。本地候选检查与部署约束见 `.audit/security-stage-a-20261010/verification.json`；不能把本地37项真实依赖跳过写成通过。

独立QA对该版本未通过：`SEC-A-R01` 普通会话未再认证，专用消费者手机号接口拒绝，但消费者详情接口仍返回完整手机号并写查看审计，绕过同一敏感资料边界。主编排已退回工程按两路径和直接调用方最小整改，待增量冻结及QA复验；此候选不发布。独立缺失Origin/跨会话CSRF/重复Cookie反例均正确拒绝。

同版真实MySQL/Redis验证已在授权隔离资源启动，容器 `hometown-sec-stagea-check-20261010`，1400MiB/1.8CPU，无宿主端口；Node22.23.2/pnpm11.16.0，安装依赖输入与冻结源一致（package.json仅脚本差异）。根任务文档和未收拢桌面资产不纳入工程提交，正式机尚未切换。

首轮测试机结果：466通过、2失败、6跳过。失败为通知容量fake-timer用例15秒超时（C01保持未通过）及遗漏MIGRATION_TEST_DATABASE_URL前置；未将API全量写为PASS。主编排补建独立迁移/LEGACY/ENTITY合成schema和受限连接配置后，按冻结修复候选执行相关真实依赖及最终构建，不重复未变的全部检查。任务MySQL/Redis仍隔离，无正式数据。

工程已冻结R01修复 `e39de52b9e41419537f1827df32f5fb29bce2aef`，源包SHA256 `3ac0e52cbd8c7ea4141f0621e9685dcfb2b1b8f2956793137dba149084b1ba1e`；三文件为消费者页面、API app及campaign-crud回归。主编排核对完整682文件blob一致，Nginx配置与原候选相同且实际nginx -t通过。完整号码仅由有权限且近期再认证的专用接口提供，普通详情不写成功查看审计；QA独立矩阵及遮罩页面已验证，正式独立结论待其回执。主编排另向QA指出无订单消费者是否仍有合法联系入口的直接回归线索，尚不将其当作已证实缺陷。

QA增量结论：SEC-A-R01独立复验关闭。主编排提示后，QA实际浏览器证实 `SEC-A-R02/P2/OPEN`：有手机号权限、已绑定但无订单的消费者详情缺少受保护查看入口，原合法能力丢失，不能由订单页动作覆盖。已退回同一工程写入者，补明确操作并复用全局再认证，验证错误/取消不泄露和不写成功审计、合法成功和关闭/换人状态清除；普通详情继续遮罩，不改S01/S02边界。

e39测试机相关检查69通过（包括真实LEGACY/Redis与新增迁移前置），另两个ENTITY专用旧用例按当前模式不适用。ENTITY prepare/verify成功，首次activate因缺少SINGLE_WRITER_CONFIRMED停在PREPARED/NULL/0，没有切换。核对任务仅MySQL/Redis在运行、无应用写入者后，保留首次回执并单独续做合法activate、两项ENTITY会话验证和最终构建，未重跑已通过69项。

后续 e39 ENTITY会话验证2/2通过、API与后台构建成功，恢复执行容器退出0且无OOM。工程冻结零订单用户入口修复 e8688e94751a75807bb4bea01d438e762e47f46c，树 b17c88ca8f3e86f3806c19bfaca73388f539686e；源包SHA256 b2a1db3382f7677e0ae7c8089c7a40b95060ee7f55dddaded6987b9b42ef739e，完整682文件匹配。QA独立关闭R02，R01保持关闭；无权限、错误/取消/成功再认证、关闭重开和换用户的入口及隐私边界实测通过。正式发布仍待Nginx与产物最终核对。

测试机实际Nginx双域采用冻结e868前端产物和e39编译API镜像 f326ac9bc2de2fc454d18d70c71ec3464d806795c4685fd44c9ff198f058bc1f；e868 API增量仅合成浏览器fixture，不是服务启动依赖，运行输入等价性已核对。测试只使用任务Docker域名别名、自签测试证书和合成数据，无宿主端口或真实生产资料。浏览器已验证两域Cookie/身份独立、刷新、错误及取消再认证、合法零订单手机号入口、关闭换人清除、实际商品图片加载。响应头实测遇到API Helmet和Nginx重复HSTS/XFO，交独立QA判断影响；不把停止在断言处的脚本标为完整通过。

阶段B继续由同一工程实现写入者推进D01/O01；主编排从A不可变归档核对发布，避免把后续未完成代码混入。真实SMTP测试外发继续暂停；fake SMTP及恢复反例不以真实收件为前置。

## 安全阶段正式交付回执

2026-10-10 独立QA最终确认e868的S01/S02适用代码及隔离环境验收通过；R01/R02关闭，SEC-A-N01（代理资源重复安全响应字段）为非阻塞建议。实际原始HSTS首字段有效且为既有策略，两域HTML及JS均为单一edge策略；未把测试证书结果说成正式HSTS缓存验收。最终报告在 `output/security-reliability-20261010/qa/stageA/nginx-final-environment-review.md`。

主编排于04:53:01Z完成正式机可逆切换：API同一镜像f326ac9...、e868后台完整10文件摘要33f440ac...、冻结Nginx摘要b875bd1...。就绪检查、两域页面及全部JS回读匹配；native nginx -t与reload通过。Docker随后为healthy，正式三域TLS链/域名验证通过、证书到期2027-01-03；匿名员工接口均401并有requestId。原镜像b4551ef...、旧后台link、compose及Nginx备份保留。本次无SQL迁移、密码改变、真实交易、SMTP测试外发或微信上传。发布回执在 `output/security-reliability-20261010/stageA-r02/{release,deployment-result,post-deploy-readback}.json`。

GitHub候选分支sec-20261010-stage-a的单父快照fe13b9b841242d24e1a758c6ff3fea4229b3e85d，树b17与本地e868相同，完整682路径/mode/blob/root树回读通过；624个未改远端文件保留，受限配置和output未上传。CI run38025360621的scope/checks及两项镜像已通过，browser/verify仍待最终结果，main尚未更新。用户已完成GitHub设置页登录；拟实施verify（GitHub Actions来源）必需检查、最新基线、管理员同样遵守、禁强推/禁删除，待本候选实际verify通过后保存并回读。

后续CI实际结果为browser/verify失败，业务浏览器19通过、3失败、1重试后通过；TLS独立门禁因前一门禁失败未执行，不能标为通过。失败对象为pickup-location-recovery（新建点位行缺失）、role-defaults（同名状态文本定位到3元素）、url-state（初次改密等待权限加载/工作台失败）；此前仅见重试行号的staff-entry两项不是最终失败。原日志在 `output/security-reliability-20261010/stageA-r02/github-browser-38025360621.log`，trace artifact已实际上传成功但不替代失败结论。交固定QA区分测试适配与业务回归；main及保护规则保存保持暂停，必要修复仍交唯一工程，不据定位器错误擅自回退正式服务。

## 数据恢复与告警候选

工程冻结B为b9327b3ccb9d2422bfaf9da086bac917970c3a6c，树d0d91aa4aadeb7fd13941bed528d0661048c0020，父e868。23项infra差异，完整Git树702文件；交接包包含31个infra文件（23差异及8未变依赖），不是全仓源码包。主编排已按该版本核对31/31 blob和执行模式，包SHA256 b649d62b801446f1ff13898aa2500695617ea14f2bcadff2c99af95957b4a8d3；不包含根任务记录、受限配置或输出。证据 `output/security-reliability-20261010/stageB/source-readback.json`。

工程37项Python定向检查及MySQL8.4.11五迁移/摘要重复执行/临时表/journal、表级运行CRUD和DDL拒绝矩阵通过；一致快照位点sec-b-binlog.000003:19783已实际取得。QA补齐真实迁移CLI、LEGACY及ENTITY的受限账号Store/API验证，权限形状的应用级前提成立；正式账号尚未收窄。

B独立验证尚未通过：真实SHOW BINARY LOGS三列被采集器二列解析假设排除；默认pull拒绝其自己的临时目录；相同段重新发布不幂等；监控同大小错误摘要快照误判BACKUP_OK、源端PUBLISHED误判异机副本正常；带一致位点的快照恢复检查还遇到dump摘要不同，待区分元数据与数据。默认正式pull unit还要求解密，与测试机正式副本仅密文/metadata的边界待协调。保留失败证据和未执行项，正式备份/副本及监控配置不启用该候选，稳定问题与最小整改以QA最终报告为准。工程在B冻结后转Q01诊断，不把活动差异混入被审B。

QA最终B报告 `output/security-reliability-20261010/qa/stageB/b9327b3-review.md` 保持整体未通过，稳定问题SEC-B-R01–R09已交同一工程；新增覆盖已归档anchor自然过期后停采、业务查询未知误报恢复。完整应用对象PITR及故障链仍未完成。权限子范围独立适用验收通过，允许与未通过归档/监控分开交付。05:27Z正式只读映射确认f326、CURRENT_USER=hometown@%、DATABASE=hometown_food、UUID8a48799d-aa5c-11f1-8297-4a0d012feec7及五表可读；旧授权仅global USAGE与schema ALL，mysql.db真实scope为转义的hometown\_food，无额外table/role。完整旧grants及精确恢复预备资料受限保存在正式/root/security-runtime-grants-20261010；尚未执行收窄。运行账号收窄脚本先授予五表CRUD再精确撤旧schema权限，部分失败先恢复旧schema再撤仅本轮新增table，并要求最终grants与原值完全相同；待独立脚本复核。

05:31:17Z–05:31:20Z主编排在独立脚本复核通过后实际完成权限子范围：六步全部成功，正式grants精确为global USAGE+五表CRUD，无schema级或其他DDL授予；fresh实际API连接的身份/库/UUID及五表LIMIT0读回通过，HTTPS ready及全部依赖ok。镜像仍f326，没有应用数据写入、SQL迁移、账号或凭据改变。回执 `output/security-reliability-20261010/runtime-grants-result.json`；完整旧清单、apply/精确rollback/逐步progress保存在正式0700目录，失败中断必须据状态恢复而不能盲重跑。已交付此子范围不关闭D01/B整体。

Q01工程冻结78c085e476207becca2e41701965b7803870c969，仅四个E2E文件差异，typecheck和本地完整23项顺序无重试通过。其父包含未通过B，主编排从已验A e868仅投影四个冻结测试文件，得到完整682文件树f124e63ed726831575238ac53eb3d1bf7a509302，源包SHA256 d477d3d7d264a6a2bd887df881abec30a26f7728449425f94db1b13888d952ec；临时index不改变工程HEAD/工作树。GitHub main及候选仍原SHA，公开性和候选完整682树已再读；投影只用于Q独立送审/真实CI，未把B上传。QA增量复核和真实CI/TLS/verify仍待，运行代码未改变故无需服务器重建。

Q01独立四文件增量审核随后通过；保持原业务断言且不降低门禁。候选分支以expected_sha=fe13b9b...、force=false快进到单父快照8a408b945d63ef7a1b9a23a9d9aebc788719fefe，完整682路径/mode/blob/根树与上述投影匹配，678个未改远端文件保留。真实Quality run38027883305已启动，main仍8a405b2...、保护表单未保存；仅在真实业务/TLS/verify通过后推进。回执 `output/security-reliability-20261010/stageQ/github-candidate-receipt.json`。

SMTP新网络证据：05:33Z DNS曾转为173.194.203.108；05:34Z受限NO-DATA探针实际解析108.177.98.108（不同于原失败108.177.98.109）仍在CONNECT阶段8秒超时。tlsVerified/authenticated/noop/dataCommandIssued/messageSent全部false；本机IPv4/IPv6 OUTPUT策略ACCEPT，无ufw。不能归因为密码，也尚未区分上游网络/服务商限制；此通道停止继续重试，不发送真实测试邮件。回执 `output/security-reliability-20261010/smtp-no-data-result.json`；服务器自主发信仍受阻，监控候选故障逻辑继续隔离验证。

## 最新整改及追加授权

QA对B-r1 e596的独立反例结论：原R01–R07、R09在报告限定范围内关闭；R03只覆盖新增binlog接收，旧快照unit要求age解密不能充当正式密文接收验收。SEC-B-R08仍OPEN：同MySQL UUID下跨database快照与另一database链被误报健康。新增SEC-B-R10 OPEN：真实应用LEGACY Map-entry格式的七类12对象恢复触发TypeError，工程文档数组样本不能代表实际应用结构。已退回同一工程以B-r2最小整改并交回任务DB窗口。工程进一步真实MySQL探针发现同一序列化原因使LEGACY/PREPARED监控JSON_TABLE按文档路径统计为0，登记SEC-B-R11 OPEN：只随R10修status/createdAt/nextAttemptAt直接消费者及真实Map样本，ENTITY与R09 unknown状态机保留。证据qa/stageB/e596176-review.md。

Q02冻结43b699990a5b5e96b2e1594a695040afedae1942，六测试文件源包SHA256 1797dc6655eb5076aaec718a1bc04f9e6a427810d69f5892f042e0f2c73a1862；原四Q路径字节不变，新通知测试与TLS测试定向17项及手机号目标通过。QA增量允许按A仅投影六路径送真实Node22 CI，原数量、并发、期限及UNKNOWN/fence、18-bit、成功响应和CSRF/session断言保留；C01和完整CI仍OPEN。证据qa/Q02/43b6999-incremental-review.md。

用户明确答复“授权专用只读通道”：允许为正式机读取测试机副本摘要/状态新增专用SSH key及固定只读forced-command入口；无解密、交互shell、转发、密码变更，已有备份/拉取连接保持原样。方案output/security-reliability-20261010/receiver-status-channel-plan.md。此授权只覆盖该机器认证通道；实施/启用仍核对B-r2同版QA、固定目录/主机指纹、有界读取和精确回退，不重复询问同范围权限。

用户新增后续任务：“弄好之后帮我把服务器存储优化优化清理清理”。当前安全/恢复收口后执行两机占用核对，优先已结束本项目临时包、构建缓存与可再生产物，保留正式数据库、备份、密钥、用户资产、在用及回退资源。尚需B/C复验的合成资源先保留；实际释放空间与持久运行限制据测量记录，不把请求推断成跨项目或数据库/备份删除授权。此前20–30分钟仅为本轮修复/验收的条件估计，非全SEC完成承诺。

Q02仅A+六测试路径的投影树0a8d5498bdab297d3760589d6942b416c614b200，源tar SHA256 f7b9755a7e2938aa28fd81a0542627b257671029f556e9ef9db4b6a613f4662f。候选分支以expected_sha=8a408b9、force=false更新到单父提交868f6f4d6d7bda7a4a545861724e8f1b2a0b19ec；公开性及完整682路径/mode/blob/根树回读匹配，680未改文件保留。真实Quality run38031499589 attempt1已自然触发并进行中，没有手动重试；main及保护尚未更新。证据stageQ/Q02/{projection,github-candidate-receipt,run-binding}.json。

旧snapshot pull要求age解密且报告CIPHERTEXT_ONLY的正式接收约束登记SEC-B-R12 OPEN。同一工程获派原D01/O01必要修复：提供有源身份/metadata/cipher hash校验、无age调用的明确接收入口及安装unit，保留现有SSH连接与独立恢复验证功能；不把只读状态观察误当接收边界已符合。与R08/R10/R11统一冻结后仅复验受影响范围。

Q02真实run38031499589最终failure，绑定868f6f4、attempt1。checks、scope、两镜像成功；API471通过/4跳过/0失败，原千通知15秒调度断言通过，完整MemoryStore wall-clock约26480.35ms仍仅内存样本。业务23/23无重试；TLS3通过/1失败，停点提前到web-security.spec.ts:108错误密码提交后5000ms等待alert未出现，正确密码响应监听阶段没有执行，原因尚待精确响应/挑战定向诊断。SEC-Q01-R05有真实Node22通过依据，R06与整体Q继续OPEN；原失败、跳过和C01限制保留。已交同一工程最小修复，未原样重试CI，main和保护未更新。证据stageQ/Q02/{github-checks-38031499589.log,github-browser-38031499589.log,ci-final-38031499589.json}。

只读SSH通道第一版由QA本地反例发现SEC-CH-R01（wrapper字符串与receiver的Path契约不兼容）及SEC-CH-R02（fetch的key前置失败保留新鲜成功文件）。原四文件字节保持，主编排在receiver-channel/r2新目录最小整改：固定Path参数；可信STATE及锁之后将PRIVATE/key检查移入会原子写FAILED的try。新manifest已核对，QA只补两项；尚无key生成/安装、服务器写入或B-r2实际集成通过。正式存储只读摸底剩余26574860288字节，Docker仅估算933.7MB镜像可回收，不能直接视为删除清单；数据库/卷与回退镜像保留。证据storage/production-readonly-20261010.json。

## 五代续接与资产恢复

B-r1工程于14:01:52+08:00冻结e596176703c482158e34122bf0dfc0984f08777c（父fc953b6），源包SHA256 1fb20c30284c194186c3a01b7fd7fc2acf2e1c9582a9b6c55e5cbde791b4f9f3，32infra文件内容及模式与最终测试源码一致。真实ENTITY/LEGACY各连续四段及受限SFTP往返PITR分别核对七类12对象与目标后事务排除，18故障/SQL矩阵及测试机Python3.12的45项通过。工程报审 `output/security-reliability-20261010/engineering/B-r1/ENGINEERING-FREEZE.md` 及frozen-manifest/readback已收到；九项仍待独立QA关闭，生产receiver/SMTP和部署约束未验。B任务数据库窗口已交新QA，工程仅在不重叠资源接续Q-R05/R06，冻结infra不修改；用户催促后收敛额外准备并复用有效验证，不降低门禁。

C01只读准备已完成，证据 `output/security-reliability-20261010/qa/C01/e868-readonly-validation-preparation.md`：旧真实MySQL测量入口可复用造图、HTTP统计和EXPLAIN，但需适配Cookie/CSRF、真实Redis与当前通知样本，并补SQL/锁等待及独立持久状态oracle。旧13.5万历史造数/EXPLAIN成功、measure OOM/无完整结果分别保留，不提升为本轮容量通过。后续先小样本校准，再按1000待发、100ms假provider、单drainer并发5及真实调和周期测量；历史背景数量仅作为明确测试场景，不新许诺经营容量上限。B窗口释放前不并跑数据库负载，C01仍OPEN。

O01额外有界网络验证：依据Google官方smtp.gmail.com 465隐式TLS说明，于05:49:31Z进行一次替代传输NO-DATA探针，现有smtp.json只读、无配置或凭据变化。05:49:39Z仍在CONNECT_TLS阶段8秒超时；connected/tlsVerified/authenticated/noop及MAIL/RCPT/DATA/messageSent均false，未发邮件。回执 `output/security-reliability-20261010/smtp-465-no-data-result.json`；465与既有587失败证据不能证明密码无效，也未定位上游原因。两条已失败通道停止原样重试，服务器自主邮件外发仍受阻，隔离fake SMTP与告警状态验证继续。依据 https://support.google.com/a/answer/176600 。

 三角色移交后，工程接续保留的10个未测infra差异，统一整改SEC-B-R01–R09及必要真实恢复链路；工程独占任务B测试资源数据库负载，主编排不分走实现，QA待同版冻结后复验。根任务记录仍归主编排，不混入工程冻结；正式A、权限收窄及停止的SMTP通道不重复执行。

旧角色归档触发Codex在05:42:01Z执行archive-cleanup，原工程目录随后不可访问，主编排和工程发现后均停止该路径的实现/测试。应用先保存的资产快照fc953b6afde52edb41a64668dcf565acf2c7c825，父b9327b3，包含10infra修复、新AGENTS及原未跟踪任务文档；对b932的infra binary diff SHA256为b31cfde7d88eb33afae609c7574a167922934c3df795614be8facea45f6af431，与交接前完全一致。由新主编排create_worktree从该快照恢复到本记录开头的新目录，附件注册成功；监控独立核验703 Git blob及必要模式，12关键文件摘要逐一匹配后放行。回执 `output/security-reliability-20261010/recovery/restoration-receipt.json`。此HEAD是资产恢复快照，不是B验收通过；Git忽略的依赖/受限配置不在此次文件保全证据范围内，必要时从现有保留来源核对。

主编排核对现有Quality run38027883305已完成，绑定远端候选8a408b945d63ef7a1b9a23a9d9aebc788719fefe，attempt1，05:42:02Z最终failure。scope及images(api/admin)成功；checks job114142536233失败，API coverage共469通过、1失败、4跳过。唯一失败是notification-throughput.test.ts:55的fake-timer千通知用例15000ms超时；同文件wall-clock千通知、100ms模拟provider延迟、并发5测得30079.085904ms且通过，明确使用内存Store，不代表真实MySQL容量。业务浏览器23/23通过无重试；TLS浏览器3通过、1失败，web-security.spec.ts:87在正确再认证后等待用户详情手机号可见5000ms超时。browser与verify均失败，没有重触发CI；main推进和保护保存继续暂停。原始日志及回执 `output/security-reliability-20261010/stageQ/{github-checks-38027883305.log,github-browser-38027883305.log,ci-final-38027883305.json,run-binding-38027883305.json}`。新停点登记为SEC-Q01-R05（通知检查超时）和SEC-Q01-R06（正确再认证后的手机号TLS链路未完成）；原SEC-Q01-R01–R04有本轮业务23项通过依据，可在后续同候选完整门禁和复核后关闭。QA只读报告 `output/security-reliability-20261010/qa/Q01/run38027883305-readonly-diagnosis.md` 已交唯一工程：通知存在全state快照及异步计时器驱动成本，主因仍待定向计数/计时；TLS流程未发现已证实的旧CSRF固定复用，但5秒观察包含18-bit挑战求解且缺正确响应，需精确响应和UI结果复验。两项未定性为纯测试问题；原失败及C01真实容量边界保留，不通过放宽门禁消除问题。


## 15时实际收口进展

B-r2候选3034396e73055f59584806f82a711f6b12a07d32、33 infra路径源包SHA256 304653edd58f87f7c6804f95c27547aef1f479f5435497f1097275241349f2de，与冻结manifest逐blob/byte相符；tar原模式0664，正式安装明确统一0644。QA独立18风险与1失败集成通过，R08/R10/R11/R12关闭到代码及隔离合成边界；恢复采用真实MemoryStore.exportState的Map-entry、七类12对象、四段链及中文utf8mb4，目标后事务被排除。纯密文接收CIPHERTEXT_VERIFIED和显式解密DECRYPTION_VERIFIED分开，未进行生产解密或恢复。报告 qa/stageB/3034396-review.md。

只读通道r2的SEC-CH-R01/R02及installer-r2的CH-R03均经独立反例关闭。用户授权专用只读通道后实际生成仅留正式机的key，指纹SHA256:KAnpW94swetr6Hv6s4cBiQMQSDASLXrelARIIw9NRWU；测试机authorized_keys原前缀完整保留，新增restrict/from固定正式IP/forced status，无shell/转发/解密。已安装未激活，实际正负命令与receiver新链路仍待到达验证。配置、脚本摘要及私钥不复制证据 receiver-channel/installation-receipt.json。

正式机、测试机实际安装B-r2相应库/units，hash与mode核对通过；正式日备份base unit及原replica.conf参数完整保留。测试旧解密snapshot timer停止，source.env新增固定UUID的实际独立行已核对，未改已有密钥。安装器提前写installation-before.json导致旧timer原始记录false；真实安装回执true。原记录保留、追加installation-before-audit.json纠正，没有凭据或运行配置影响。失败的本地校验未阻断后续shell命令，程序实际安装已查实；以后依赖校验和写入分开执行。

11旧源export仅有null坐标，依已审计划在.publish.lock下保全移至historical-20261010，逐文件字节、模式、owner全部一致；未删原正式备份或测试历史副本。新快照20261010T071141Z-680bf27e按现有effective unit成功，源UUID8a48799d-aa5c-11f1-8297-4a0d012feec7、schema hometown_food、坐标binlog.000022:688227594。新capture闭段成功，headIndex22/headsha b0765a1c358a7a17b3528ee0eaff852642a1203dbbbc5fe705773dd2da3f6296；测试snapshot纯密文pull通过。第一次binlog pull在源发布完成前启动而安全拒绝，失败保留，源完成后启动第二次；首段实际约688MB仍在传输，未将尚未到达写成通过。证据stageB/{installation-receipt,legacy-export-preservation-receipt,fresh-snapshot-verification,receiver-manual-pull}.json或jsonl。Timer尚未激活，实际部署独立复核中。

Q03源a3d08de269692ada4a95fd9e2c2e965465344e55仅一个错误密码观察路径变化：监听确切POST再认证响应并断言401/INVALID_CREDENTIALS后保留原5秒UI错误断言，原18-bit挑战和正确/取消/手机号/CSRF/旧session断言完整。独立增量审查通过。候选914eccc756c3bcf3eb1b9e2743edc2c45329d03d、树092bf80da031f6ba5395c0dcaace9fb70b2c98dd，完整682 paths/blob/mode回读一致。Quality run38032750914 attempt1于07:06:26Z全部success；API471通过/4跳过，业务23/23、TLS4/4无重试，verify成功。Q-R05/R06有对应真实通过证据，先前失败保留。GitHub保存main保护时触发sudo向h********@outlook.com发送验证码，连接邮箱不同、已请求用户验证码，未保存规则、未推进main。证据stageQ/Q03/ci-final.json及完整两jobs日志。未以通过CI关闭C01真实MySQL容量或微信真实渠道事项。

C01用已发布A runtime固定输入进行工具真实性校准：100历史+10合法待发通知、真实100ms fake provider、direct0.881秒、实际30秒调和30.104秒，最大并发5，独立MySQL pool读到持久SUBMISSION_UNKNOWN fence；持久全对象oracle及九类反例通过，真实Redis竞争/释放/失权检查通过。初次镜像UID目录前置失败保留并按实际1001修正；仅新增合成schema及C Redis，原B身份/schema/限额未动。1000待发、历史对照、SQL/锁等待及失败矩阵尚未完成，C01/M01仍OPEN。大性能测量等密文接线后独立窗口。


首段22实际688,395,854密文字节在固定SFTP120秒时限只到42,823,680bytes并TimeoutExpired；systemd1h不能覆盖子进程时限，推算传完需约32分钟非实测完成。独立QA/工程确认fresh-root可行前提：整代保全test binlog根及source archive/export根（anchor/state/receipts/失败目录/锁一并移走），无active进程及锁、目标碰撞则停、全文件hash/mode/owner保持、新位点只读新成功receipt不预填。主编排依冻结ops计划实际保全到binlog-failed-bootstrap-20261010、binlog-local-bootstrap-20261010及historical-20261010/binlog-bootstrap-20261010，3次全目录inventory均匹配，无删除。

07:18:51Z新完整快照20261010T071851Z-c73997be、源UUID/schema不变，实际坐标binlog.000023:158、SQLsha052ba66fdb7df822488204d9cb2717fb18c6c0236d450dff25efe3fd99023609。07:18:55–07:19:00Z sourcecapture→test纯snapshot/binlog→prod受限status严格顺序均exit0；receiver为root0600，headIndex23/headsha655e60cab8a3bf6e710e598f0717e2fd276b0d2bfa2000ddd69205e8db0ab826，严格同新快照摘要/位点绑定，monitor.collect实际四健康、六业务聚合0且无SMTP。证据stageB/fresh-bootstrap-live-progress.json。独立QA实际首轮绑定确认；这是一段新链，不能宣布旧22接收、通用大段传输限制或既定生产RPO/RTO通过。

07:20:12–14Z已启用source5min、test snapshot旧15min及binlog5min、prod status5min及monitor1min timers，原日备份timer保留。source OnBoot立即自然推进24而receiver仍23。新增SEC-B-R13 OPEN：monitor把独立五分钟正常传播窗直接判为binlog_gap，07:20:15产生误报事件426d7949-89f3-48c3-b90f-11d6c705c076。状态和outbox保留，未发送邮件；root已暂停仅monitor timer，备份/pull/status继续自然运行，工程唯一写入者优先最小有界传播消费者修复，QA定向复核，不放宽真正身份/摘要/链/超时异常、不以fresh fetch或新source发布重置无进展时间。初始timers-first-readback脚本误读incidents而真实字段为active，后续已按active/outbox独立核查，原回执保留。邮件配置另有具体形状不兼容：原私有from/to（一项list）与load_smtp_config sender/recipient不符，因此网络前ValueError，现核对原值不输出，拟受限补兼容别名/保全备份；这不证明原网络阻断消失。

已验B33路径按Q通过树仅投影27infra变化，完整704路径/mode/blob与远端候选树6d8016af6fe4355f09bc472da331c71e3e7a2f6b逐项一致；候选普通expected914eccc/forcefalse快进b3567c9211ca63f2b13300cd314320dad617452c。完整runtime app/Q字节不变，根记录、敏感配置、恢复资产未上传。真实CI38034153908自然启动仍待，R13须修复后增量冻结/复核。main8a405b2及保护依旧未推进，GitHub sudo验证码待用户。


GitHub sudo身份复核由用户提供最新验证码完成；验证码不记录。main经典保护rule84582974已创建且作用于1branch，通过saved edit UI回读verify来源GitHub Actions、strict=true、admins included=true、force/delete=false，PR强制保持原批准的false。连接器管理GET返回403 Resource not accessible by integration，此限制以真实网页回读补证，不新增token/改保护/绕过。截图stageQ/Q03/main-protection-saved.jpg，结构化回读同目录main-protection-readback.json。

已成功在生效保护下将main expected8a405b2/force=false普通快进至已通过Q03的914eccc756c3bcf3eb1b9e2743edc2c45329d03d，树092bf80da031f6ba5395c0dcaace9fb70b2c98dd，完整682路径、模式、blob逐项一致。只包含已发布A+六reviewedQtests，未混入B/R13/根记录或私有配置。回执stageQ/Q03/main-fast-forward-receipt.json；Q01适用验收关闭。B候选b3567c9的真实Quality run38034153908也全部success，API471PASS4SKIP、业务23/23和TLS4/4无重试、verify成功；但新R13误报整改还未冻结，B仍在候选分支，未用CI通过代替O01交付。

SMTP字段形状及误报隔离、snapshot timer dropin已获QA独立增量通过：原7字段逐值不变、sender/recipient匹配原地址、无network；唯一误报event e4f078e8-4c25-4f64-95ee-ec095d96d18a/incident426d7949...在root0600 quarantine与原state一致，其余状态逐值保留。snapshot有效周期300秒±30、base/pure unit不改。报告qa/stageB/deployed-3034396/config-quarantine-cadence-review.md。操作时service/timer已暂停且root唯一写入，不存在并发丢失；该一次执行证据未持.monitor.lock，未来状态变更必须显式持锁，不能运行时复用。R13/真实SMTP/RPO边界仍OPEN。

R13 工程于07:42Z冻结301981f467706c31ff5832f46102e3782fb717a5（父3034396），仅monitor、两份定向测试及说明四文件；差异包2961287db81cde1143c5f165ccd429ea7e57272817a9e5c00de604165031664e，脚本3ad2d2655c5b55b75e1523d7a4a7c8a50dc148b8fbfea9e7d5a40c9c145762a7，源/blob/模式回读一致，测试机9+11定向通过。源绑定的合法连续前缀在900秒内LAGGING、快照正常传播PENDING不告警；超时依据接收head对应源capturedAt及首个未收快照exportedAt，fresh fetch/重复source发布不得重置；身份、根SQL、代际、链与摘要错误仍失败。QA同版独立时序反例正在复核，正式monitor仍303暂停。

主编排将301同源脚本及两个未变verifier放入正式机私有分目录进行真实输入、禁止网络SMTP探针；未写生产state。07:46Z receiver27/source28是合法LAGGING，实际源对应head age588.97秒、latestHeadVerified=false，conditions空；07:51Z未经手动追赶的自然定时推进已为CONTIGUOUS，两次API/snapshot/replica正常、transition/send/fakeSMTP均0。证据engineering/B-r3/root-real-input-{preflight,second}.json。前两次动态加载仅私有probe库可能生成pyc，后续实际安装库观察用python3 -B；不把真实当前探针扩大为所有故障或生产RPO/RTO通过。最小单脚本安装已准备并保留原303恢复路径，等待同版QA结论。

07:53Z主编排将C01独立合成测量窗口交回原工程，根只写正式机monitor，QA运行轻量隔离反例；C不改B冻结对象或既有生产/测试机数据服务。按已校准实际A镜像、真实MySQL/Redis及原限额测量1000待发/100历史、10000历史和完整持久化oracle，不加资源或改锁。M01仍按原批准Products模块最小提取继续，尚未实施；此并行只复用三角色，无新增会话或设置覆盖。

R13 独立QA已PASS，报告qa/stageB/R13-301981f/review.md：固定四文件与两依赖一致，复用工程20项并补6组独立时序反例，通过重载/刷新不重置超时、无效证据立即失败、合法PENDING/LAGGING不投递及未知业务指标保留原事件。主编排据此仅原子替换正式ops_monitor.py为301的3ad2d265…，root0644；原303完整副本及mode/owner/hash metadata保存在/root/security-stageb-r3-20261010，config/state/原units及verifiers均不变，持.monitor.lock。安装后python3 -B真实输入私有探针为receiver29/source30合法LAGGING、age575.79秒，conditions空、fakeSMTP0、未写生产state；07:56:53Z首次启动原service exit0后恢复原已enabled timer，真实active/outbox/deadLetters均0。自然1min周期证据仍待，不把单次激活写成长期稳定或邮件已送达。

R13同版四文件已仅增量投影到已验B候选，普通expected b3567c9/force=false快进d7f42c27766043e2b01ba0f6ad910cb7be122271（唯一父b3567c9），树f9e08b29977fcec7df36c82d84b2bbd0500c81a0、完整705路径/mode/blob逐项回读一致；runtime apps/Q与已通过版本不变。Quality38036195607 attempt1自然触发进行中；main仍914eccc，待对应通过后普通快进，未弱化保护或强制推送。证据engineering/B-r3/github-candidate-receipt.json。

08:21Z根及QA实际读回301正式monitor连续约25分钟23个完成周期（含首次激活），全为MONITORED、transition/sent/failed/queued/deadLetters均0；最新16:21:49北京时间service成功退出0、原timer enabled/active、真实active/outbox/deadLetters空。QA已更新R13报告，代码及部署面PASS关闭异步传播误报；真实邮件送达、长期RPO/大段容量及正式库恢复不在此关闭范围。根证据engineering/B-r3/monitor-natural-cycle-readback.json。

Quality38036195607新候选d7f42c2实际网页状态Success，scope/checks/browser/两images/verify均success，8m37s；公开API直读因共享匿名rate-limit403失败，未原样重试，改用已登录官方Actions网页核对。原GitHub connector本轮已不可用，普通Git通道已核远端main914eccc、候选d7f42c2并仅fetch固定对象，不改工程HEAD；CI网页回读及截图engineering/B-r3/ci-success-ui-readback.txt、ci-success.jpg。main同步操作正在按现有保护普通快进进行，尚未将尝试写为成功。

main普通git push d7f42c2:refs/heads/main被既有认证缺失拒绝：terminal prompts disabled / could not read Username；未产生远端写入、未创建token/密钥或绕过保护。connector工具已从本轮可用工具移除，已上传候选及CI成功仍有效，main推进需要原GitHub通道恢复；正式301运行不受此阻断。先完成其他已有授权工作，不重复同一未登录推送。

08:23:53Z按用户后续存储清理请求，正式OpenCloudOS9.4用官方dnf clean all完成22缓存文件清理，cache实际分配从85,585,920降至4,739,072字节，释放80,846,848字节；同期available变化80,859,136字节，当前28,157,497,344可用。已安装RPM清单摘要、monitor/config/SMTP摘要和三个在用容器ID/健康完全不变；数据库/备份/密钥/镜像/卷/日志及唯一发布包均保留。证据storage/production-package-cache-cleanup.json。测试Ubuntu apt archives仅24,576字节，无必要为该微小缓存删apt lists；/tmp本任务约1.274GB仍供C/M及复验使用，未清理、不能把其它旧容器/卷当授权对象。

用户08:27Z明确表示已恢复GitHub，最新工具及实际API读回验证通道恢复；Quality38036195607 completed/success、绑定d7f42c2、attempt1与官方网页一致。主编排已按expected main914eccc/force=false普通快进受保护main至d7f42c27766043e2b01ba0f6ad910cb7be122271，完整705路径/mode/blob及树f9e08b2再读逐项匹配，原保护未改，GitHub阻断关闭。回执engineering/B-r3/main-fast-forward-receipt.json；不把未完成C/M混入本次同步。

C01 两档真实ENTITY吞吐已完成并以原A runtime执行：1000due+100history为280865.6ms、1000due+10000history为285078.3ms，都1000调用/max并发5/全WECHAT_SENT、无OOM；前后9932/99032个完整对象oracle各通过，无新增/丢失/无关变化。worker SQL均39340、返回rows均26694、聚合FOR UPDATE均2210，RSS峰181088256/199229440；支持所测历史量对照，不能外推13.5万、生产容量或已有新优化。h100成本原始记录4000 failedStatements未取errorCode，ER_DUP_ENTRY仅依据已存在对象INSERT/源码catch+UPDATE路径解释，不能回填或称4000业务失败；新小样本另取实际脱敏ER_DUP_ENTRY/1062/23000。server rowsExamined/独立lockWait仍NOT_COLLECTED；FOR UPDATE耗时不等于纯锁等待。

主编排h100冻结9文件SHA清单已交QA，QA独立重算对象/调用账/并发与SQL汇总及9类证据破坏检查通过，单样本范围待报告；h10000首次根清单因尚未本地归档而assert失败，原失败保留并立即纠正派单，未把清单尝试写成冻结。08:35Z工程完整归档16文件与包6596fb5d6605d12f1b5a9eafb16a09a91cee11aac3b559dcc622941b5edf0b70，根成功核9文件SHA并生成root-h10000-review-manifest.json后再交QA增量，不复跑大型吞吐。四真实小故障工程已执行，包仍回读，独立QA尚未通过；M三文件提取local lint/admin build通过，相关本地/测试机浏览器仍验，未冻结或部署。


## 16时收尾与可复用结果

C01最终独立报告`output/security-reliability-20261010/qa/C01/final-review.md`已保存：原A运行输入、真实MySQL8.4/Redis7.4、原配额、100ms模拟provider及并发5，两档1000待发+100/10000历史分别280.866/285.078秒，完整持久化归属/状态与SQL成本证据通过。真实迟到provider、finalize更新返回后的客户端异常及回滚、授权更新/撤回、Redis续约响应丢失五场景独立复核通过。本轮不改API锁或资源额度，测试不证明真实通知送达、生产RPO/RTO或13.5万历史容量；server rowsExamined/独立lockWait仍未收集，旧4000 failedStatements未记录代码，保留原始证据。

M01最终源`bbb06c9ed3d90e3357b0da3e36cd71f07351fdab`在初始44fa938提取后只删除两新模块末尾多余空行；三个源码文件以商品/分类页提取及公共支持函数为边界，不改API/金额/权限。44测试机浏览器前三项通过，URL一项因测试server在ready后240秒主动exit124而ERR_CONNECTION_REFUSED，原失败与trace保留。工程仅修正服务生命周期并重验失败URL；配置原默认60秒、URL用例原单独120秒及原5秒断言均不变，bbb完整构建及最终产物等价核对未完成前不发布。


08:56:44Z测试机按工程明确释放、QA确认不再使用的C范围完成清理：先保全5个已结束容器的原始logs/选定inspect至受限归档，桌面回读SHA256481bb0aab8cafe89dd156472b076961cd4ecff49502a1d7ea273a3835b2413bd后精确docker rm（不带-v）；仅删除performance/source-h100、source-h10000生成输入及两份independent-oracle.sqlite缓存，释放实际分配268,931,072字节，available16,104,538,112→16,373,882,880。所有MySQL/Redis、卷、schema、镜像、密钥/env、备份、原始NDJSON/完整本地证据与旧失败保留。回执storage/test-machine-C-cleanup.json。

M01第二次Vite单项补验也失败（刷新后订单详情5秒不可见），不能沿用第一次server截止解释；trace实际ERR_INSUFFICIENT_RESOURCES、App/reauthentication模块加载未完成、根节点空而URL参数保留。工程改用同BBB静态产物、固定A编译API memory/mock与私有Nginx验证，保留原两失败及前置脚本/图片空间保护失败；未变业务源码、资源额度或断言。08:58Z旧QA只读观察static browser exit0，但最终报告/产物绑定未审核，不能写为发布通过。正式机只预传8089cc...包及激活脚本cc3695...到/root/security-M01-20261010-bbb06c9，原A link尚未切换。GitHub只准备未挂分支的5ef0168beef58126cae056606b5437a4ffe5cad5，树b85e610d740046da9b6cf97fababffa988b51fa2，707path/mode/blob完整回读；main和候选仍d7，M未触发CI。

用户在监控会话明确要求新开session替换三个固定Agent（原始userMessage01a12507-6595-7251-b2e2-1c8f1aeac296、01a12507-7146-7b60-ad50-c40c7048f701已直接读回）。本轮安全收束引用SEC-20261010-ROTATE-2；主编排已停止新的发布/实现/派发，释放正式机/GitHub/根任务记录写入窗口。仍需使用的共享worktree必须先附着并核验到新主编排后再归档旧角色，防止再次自动清理。


## SEC-20261010-ROTATE-2 接管

用户明确要求替换三个固定Agent，六代主编排01a12508-8b80-74c3-a587-03a00d814bc3、五代工程01a12508-899c-7040-b1ef-3f2a5af7a3ac、五代QA01a12508-8776-7281-b7b2-3d4c08d22c55均已核对并接手。旧三角色已停止并释放窗口。本轮最新工作目录为 /Users/lizi/.codex/worktrees/security-reliability-sixth-20261010/拼团项目，HEAD bbb06c9ed3d90e3357b0da3e36cd71f07351fdab；新主编排持有独立managed附件，完整35310项源码/未提交/ignored资产迁入一致。原三文档差异保全后仅追加本节，README与architecture保持原样。证据根仍在桌面output/security-reliability-20261010，详见HANDOFF-20261010-ROTATE-2-coordinator.md及ROTATE-2-worktree-migration.json。

原安全/权限/B-R13/C01/Q/GitHub有效结果继续复用；M01 final-frozen-manifest已含原静态URL48.008s/0 retry结果，独立QA尚需同版绑定核对后再由主编排继续已准备的正式静态切换、自然CI及GitHub同步和明确M资源清理。原失败、不足与SMTP/120秒SFTP/真实微信等限制保留，不因换会话关闭。模型与思考强度未被智能体指定或调整。

## M01 最终交付

继任固定QA对冻结源 bbb06c9、2,517,156字节管理端包（SHA256 `8089cc32e2fe22502d9b5d148064d75adba58e881173fa0f4004971d2dc795e6`）及测试机实际挂载独立核对PASS。10个产物与44候选逐文件等价；隔离测试机原三项成功记录加最终静态URL单项48.008秒、零失败/重试/跳过为主要行为依据。默认60秒与用例单独120秒、expect5秒和浏览器512MiB/0.8CPU/pids128均保持。原本地四项只作历史补充，两次Vite失败及初始静态前置失败完整保留；不宣称修复了Vite开发模式资源问题。报告为 `output/security-reliability-20261010/qa/M01/final-review.md` 与 `final-binding-result.json`。

首次正式激活因发布核对脚本把 `/index.html` 当公开入口而遇HTTP410，已自动回滚并实际确认恢复A链接、API healthy、Nginx摘要未变。现行已验Nginx仅通过 `/` 提供首页，直接 `/index.html` 保持410。主编排只修正发布辅助脚本的路径核对，首页仍逐字/摘要校验，九资源逐文件校验，并增加直接文件路由必须410的检查；固定QA对脚本 `96b8410dfa886c694197fe9e145f11bff6a98de7e8f2576f289aae7e5bd49566` 增量PASS。独立root0700新尝试、0600新记录及无started/result前置条件现场核对；旧尝试三记录和已逐项核验的提取目录保留，未覆盖失败证据。

09:16:05Z正式静态同包发布完成，当前链接 `/var/www/hometown-admin-M01-20261010-bbb06c9`；两个管理域名共20文件通过实际入口回读，HSTS/CSP/XFO和退役路由通过，API readiness正常。API容器 `4bbdac17ed28f764a8e98d458461206723f262e269eaea7ffff59a94aa275b88`、A镜像f326及Nginx b875摘要完全不变，旧A静态目录仍可回滚。没有数据库、凭据、真实交易或微信操作。结果与再次现场读回见 `engineering/M01/production-deployment-result-r2.json`、`production-postdeploy-readback.json`；首次失败见 `production-first-attempt-rollback.json`，辅助脚本审核见 `qa/M01/deploy-helper-r2-review.md`（均在本任务output根）。

GitHub业务投影提交 `5ef0168beef58126cae056606b5437a4ffe5cad5` 的707文件路径/模式/blob全部读回匹配，树 `b85e610d740046da9b6cf97fababffa988b51fa2`，保留远端安全/备份/CI及其他资料。自然候选Quality运行 `38040440561` 的scope、checks、browser、admin image、verify全部success后，main按expected d7普通快进到该提交，现场分支读回protected=true；不force、merge、tag或改保护规则。连接器对保护详情GET返回403，不能将旧Q01证据写成新读回；本轮分支保护事实及受保护普通快进据实际结果记录。角色索引及本记录作为已核资料另行同步，README/architecture原有资产不纳入提交；远端最终记录版本写入本地回执，避免文档自引用。

09:19:48Z按已释放窗口精确删除九个本轮M容器：逐ID/name/image/task/owner核对exited、Pid0后执行docker rm，不带-v或force。之后31个其他容器ID、13个卷、镜像及原有bind输入均保持；逻辑可写层合计107,806,720字节，同次观测可用空间16,356,630,528→16,464,932,864字节。完整原验证归档SHA256 `0db7b979eabd9e72d6ae605e84c7c3fd66fe6ccd86a1c1e59844487d8aecba4f`、原始失败/trace、数据库/schema/Redis、配置及恢复资产保留。回执 `engineering/M01/M-cleanup-result.json`。

M01仅关闭本轮批准的商品/分类页最小提取及对应静态交付，不表示全部页面已拆分或全产品验收。D01通用生产RPO/RTO、旧22大段SFTP固定120秒限制及O01真实SMTP CONNECT阻断继续打开；真实微信登录、支付/退款、订阅触达和C01未收集指标沿原边界单列，不因本轮发布或换会话关闭。
