# RELEASE-20260921-01 全项目验证与发布

用户授权：修复整个项目检查失败，验证正常和异常场景，确认无阻塞后上线，并明确日志定位入口。生产清库、真实扣款退款不属于自动测试授权。

## 版本与所有权

- 主负责人：桌面仓库，仅维护本记录与发布/日志核查；基线 c02e3235af60a493d14edc1d4934cd08bfdb4eed。
- 唯一业务代码写入者：工程执行·开发修复 `01a0c195-b197-7451-b622-302229b53616`，路径 `/Users/lizi/.codex/worktrees/61b8/拼团项目`，同基线。
- 独立只读审核：质量审核·验收复核 `01a0c195-b199-7813-b368-8c60f6f01fdf`，审核执行者冻结版本，不以审核副本默认代表新代码。
- 本地与 GitHub 提交历史不同；起始源码树一致。发布时绑定最终提交及产物摘要。

## 验收及问题索引

| 编号 | 要求/问题 | 状态 | 责任人及证据 |
|---|---|---|---|
| REL-01 | 修复 MySQL snapshot 5 项资料默认字段断言失败，不降低数据契约 | 已修复并复验 | 执行者；真实集成21/21，当前CI check通过 |
| REL-02 | lint、类型、单元、真实隔离 MySQL/Redis 集成、构建和浏览器正常/异常流程 | 通过 | 最终CI35560813857，浏览器18/18；保留此前失败证据 |
| REL-03 | 独立审核核心权限、金额/退款、并发核销、失败恢复和验收覆盖 | 源码/测试/产物及发布后只读抽查通过 | 审核者 |
| REL-04 | 核实生产日志、请求定位、脱敏、轮转与使用说明 | 通过 | 实际API/Nginx编号联查与query脱敏验证PASS |
| REL-05 | 审核通过后同步及服务器发布，备份/回滚和上线后核心检查 | 第二次部署与运行后验PASS | 主负责人控制唯一发布窗口；首次失败及回退证据保留 |
| REL-06 | 微信隐私声明、真实授权与上传/审核/发布状态 | 待核实 | 平台依赖单独记录，不用 mock 替代 |

## 初审发现与当前证据

- QA-REL-03：补真正并发核销请求与 receipt/ledger 唯一性验证，已派发执行者。
- QA-REL-04：核实退款/通知失败队列任务标识，并补必要脱敏结构化日志。
- QA-REL-05：取货码不应进入请求 URL/access log；新后台改 POST body，旧 GET 应用日志序列化移除 query。历史及标准 Nginx error log 的潜在敏感请求行保留访问限制，不宣称已清空。
- QA-REL-06：前端错误保留可定位编号并提供复制途径；无服务端响应不能伪造编号。
- QA-REL-07：Nginx 候选日志格式需 API 实际返回 `X-Request-Id` 才能联查；代码与运行验证待集成关闭。
- 生产只读核实：API `hometown-api:e0bbdce`，后台 `/var/www/hometown-admin-d533ba5`，readiness 200；API/MySQL/Redis 均健康。Docker API 日志每份10MB、最多3份；Nginx每日轮转10份。
- 主线程候选 `infra/nginx.host-api.conf` 与线上仅差8行脱敏日志配置，2026-09-21隔离 `nginx -t -c /tmp/xiangwei-nginx-validation-20260921.conf` 成功，尚未 reload。该文件 SHA256 `6d79c1df0246a5b6d716ddf0baebbb67eec2db0f2b036dcb0812a6577618c5b2`。
- 用户确认当前小程序“已发布”；这不等于本轮修复已发布或头像隐私声明已验证。微信公众平台网页被工具站点安全策略阻止访问，不绕过；需人工完成平台核实。
- 本机无Docker CLI。用户2026-09-21提供百度云实例截图，结合“可以去测试服务器跑”授权，将旧百度云180.76.100.156用作本轮测试机，替代原记录“不连接旧机”在本轮测试范围内的限制；生产目标不变。SSH已核实实例instance-u64whg6i，Docker无运行中容器、16GB磁盘空闲、2.6GB内存可用。执行者为独立测试环境唯一写入人；新目录/网络/数据库/卷，保留旧readiness/staging容器和数据，不做真实支付。Quality CI仍按发布基线执行。

## 发布边界

目标为既有 housekeeping-server / 192.144.136.205，API https://liziqi.icu，后台 https://admin.liziqi.icu 与 https://saas.liziqi.icu。未获得最终通过证据前不切换生产版本；不在生产创建自动测试订单。保留未跟踪原型及既有用户配置、数据与备份。

- QA-REL-08：发布镜像须可验证绑定sourceCommit/sourceTree；主负责人补受控构建receipt、归档/manifest/日志摘要和镜像来源标签校验，脚本增量复核通过；实际build receipt与构建证据需最终审核。
- QA-REL-09：发布前规范化并验证现有后台软链的绝对回滚目录；实际线上原链接为绝对路径。独立增量复核通过。

- QA-REL-10：readiness依赖探针故障未稳定输出degraded/503，执行者已核实并补失败关闭与队列/数据源异常测试；待同版本复验。
- 受控构建脚本build-verified.py与部署脚本deploy.py已独立只读复核通过；未执行，最终构建receipt、测试结果、镜像摘要需再核对后发布。

## 测试机阶段证据（待最终候选复核）

- 执行者候选0b09efda988c31b6faba3cc9ff6bd25cb136cc6d：独立测试机Node22/pnpm11.16.0、MySQL8.4/Redis7.4；基线迁移执行两次，真实集成21/21无跳过；完整pnpm check通过，API38文件264测试。源码仍待QA整改，不能据此上线。
- QA-REL-03未关闭：已加MemoryStore并发回归，但需真实MySQL跨pool核销验证；执行者补充。
- QA-REL-06未关闭：编号只拼接到短暂提示，缺复制入口；执行者整改。
- QA-REL-12：未捕获异常/调和日志丢失异常类型与调用栈定位信息；需保留安全的代码帧且避免原始provider payload，执行者整改。

## 发布辅助脚本冻结摘要

独立只读审核通过，正式版本未执行。构建与发布前仍需最终候选和证据审核。

- `/tmp/xiangwei-release-20260921/prepare-source.py` SHA256 `5dcf62b1f635cbb5a3949f2ea2e9dd63273970359c3c810b3922515340aab295`。
- `/tmp/xiangwei-release-20260921/build-verified.py` SHA256 `a38165abd3201825594f3cf2fcc568faee6baf93f050770ee509d55e8c62b526`。
- `/tmp/xiangwei-release-20260921/deploy.py` SHA256 `ff1612a9e63da1feaba56d693c47881969a54717fa7d453d7845b65f60818c9e`。

- 上线后只读verify-runtime.py独立审查通过；补显式Nginx编号相等及执行时间，最终脚本SHA256 `4df0751637ae719c702b5ca3f53992a0a8f16065dcf265494eeeb44cd748df7a`，未执行。

## 第二轮冻结与独立复核

- 执行候选dfeba123a963567e4aa4488ee08bcf5b3992dea4，桌面整合f9b351c，源码树均为aa15521d3e1357e0953166aed8867659477595c3。独立QA按冻结版本增量检查，QA03/06/10/12代码范围通过；真实MySQL专项9/9由执行者日志佐证，Chromium浏览器与实际部署日志后验仍待完成。
- 当前测试机仅本轮专属MySQL/Redis与浏览器runner运行；生产健康检查各依赖仍ok。
- 已知非阻塞边界：登录失效直接导航路径没有把401编号写入小程序最近失败入口；常规业务失败支持复制，不宣称所有入口都已覆盖。

## 浏览器实际执行与发布暂停

- 桌面候选f22109bb40fd86915c0ecb84c3883833e9c0811b、GitHub main 900525e4baf8af25dfc89765057582b025ff948a的源码树均为13f20a209ce3157725ab6a17462110bfee20fa61。内置连接器完成同步；CI run 35555159065的check及coverage通过，浏览器门禁执行中，不能称为CI全通过。
- 测试机首次缺Chromium，安装依赖后已进入18项实际浏览器流程。发现6项控件定位失败：campaign-crud:54、community-ui:237、full-business-flow:85、governance-ui:290、operations-closure:149、pickup-location-recovery:77。部分是改版前标签，其他弹窗/表单定位需核对实际DOM。不能删去业务门禁断言，也不能把运行后的失败归为浏览器未安装。
- 原始失败证据：测试机 `/root/release-20260921/test-results/*/trace.zip`。已交工程执行修复，并要求独立QA检查测试契约和增量修复。
- 主负责人候选构建与执行者测试环境隔离：`/root/release-20260921-artifact-f22109b`。API镜像 `hometown-api:f22109bb40fd86915c0ecb84c3883833e9c0811b`，镜像ID `sha256:0fba6847bf5618af7cd91744f5d9aec883cb13aefe77478976e19517b0492e94`。构建前后源码manifest一致；receipt保存在该目录build-receipt.json。此包未部署，后续代码变更须重新绑定候选并验证。
- 该候选源码归档SHA256 `2633cff05fc3e22fecdc01a85e80475ffb8de93c001823ae6bd8f10c2bc4f0dd`；manifest SHA256 `403d842c6cbf217e6fa762efdf53639bf0123e47e0a0108827ad48734f183eae`；API构建日志SHA256 `a2c6f9adc0318307d6527fd982e88caa464815646a417ecadb208aa5f45273c7`。
- 发布辅助脚本增量审查后的当前摘要：build-admin-verified.py `e2122bf1f2577aa153fe104561db09d6912f587bad2544100bade8ee1aed5d04`；deploy.py `5536f004b90773a7e963cb36ee5f51ad01327128af531b0dc1a24d58b91d5132`（替代上文早期摘要）。后台静态包将按逐文件SHA256核验，不在生产运行后台Docker镜像。
- 生产未切换API、后台或Nginx；未执行真实交易或清库。
- 首轮测试机完整结果18项：9通过、9失败；原始失败包 `/root/release-20260921-artifact-f22109b/e2e-first-run-failed.tar.gz`（64,727,080 bytes），SHA256 `692c94e80fa557777304728631a0bdf536c3aeb6066e6173c770680021c8d983`。为保留失败证据独立归档，后续复跑不得替代此记录。
- CI run35555159065最终失败：E2E6失败、1不稳定重试通过、11通过；正常检查及覆盖率均通过（API267、后台93、小程序153、契约28、领域5项测试）。额外发现GitHub artifact storage quota hit，报告上传失败，两个镜像构建步骤被跳过。
- 报告上传可用性与业务门禁分开：quality.yml仅Upload Playwright evidence设continue-on-error；上传失败或报告缺文件显式warning及job摘要，if-no-files-found为warn。E2E、check、coverage、REQUIRE_INTEGRATION_TESTS及Docker构建仍为阻断检查。独立QA增量审查通过；摘要shell语法与失败/缺文件/成功三分支验证通过。本次发布必须另存匹配版本原始测试报告、位置与SHA256；CI绿色不代表报告已上传。

## 测试机内存回收（用户要求优先处理）

- 本轮重复启动的 E2E 容器造成测试机内存压力：此前可用内存仅 107 MiB，SSH 多次握手超时。SSH 断开没有终止远端容器，主负责人未及时约束单一测试窗口。并行复跑结果不能作为验收依据。
- 恢复连接后成功停止 release-20260921-e2e-selector-rerun2 与 release-20260921-e2e-modal-rerun；release-20260921-e2e-selector-rerun 已不存在。首次回收后可用内存 2295 MiB，再次复核 2282 MiB，总内存 3403 MiB。当前运行容器仅本轮 MySQL 与 Redis。
- 工程执行、独立 QA 已通知暂停远端测试和查询；不自动重启 runner。未删除数据库卷、源码、备份或失败证据，生产环境未改动。后续恢复测试必须单一 runner、限定内存，并在连接中断后检查真实容器状态，不重复启动。

## 继续验收与资源保护

- 用户要求后续预防内存耗尽，并争取20分钟内验收。测试机只允许一个固定名 `release-20260921-e2e-final` runner：启动前 `MemAvailable >= 2000 MiB`、内存与内存加swap上限均1800 MiB、1.5 CPU、512 PIDs、单worker，最长15分钟。SSH断开后必须inspect实际容器；禁止换名并发复跑。
- 主负责人增加本轮独立内存保护：每10秒读取MemAvailable，连续两次低于512 MiB时停止固定runner。脚本与采样记录位于测试机 `/root/release-20260921-artifact-f22109b/memory-watch.py`、`memory-watch.jsonl`；不删除数据/卷。测试结束保护进程随runner退出。
- 浏览器重复ID根因：Vite继承NODE_ENV=test，rc-util/useId走测试fallback生成test-id。已显式仅将admin webServer设development，API测试环境保持test；真实label定位不以first()掩盖重复ID。
- 执行者31f29ce、桌面f4b88589e6646ee3a64797d9ffd1fb9994267c2f对应业务源码与先前已审dfeba12一致，增量为测试文案/数据隔离/环境及退款响应断言。桌面源码树7b797ca478dff9116e43b9b71d90668e012231b3已通过内置GitHub连接器同步到main提交3e72e798f1991b3f11b2cee86ed5670b6d96239b。
- 31f29ce实际完整浏览器结果：18项中17通过、1失败，耗时8.9分钟，无OOM；独立目录 `/root/release-20260921/e2e-final-31f29ce-results`。原计划分段的grep锚点未匹配完整测试名称，实际执行18项，不能写成17项分段全通过。
- 唯一失败operations-closure:199等待旧行内取消按钮；实际入口已为更多→取消团期。修复后定向复验该文件，并复验governance与staff，复用未变化的通过证据。
- 旧governance trace曾出现确认点击后没有退款POST，原因未确定，不能归因于glob。31f29ce加入精确退款POST成功断言后整条治理流程通过，仍补一次定向回归排除偶发结果。
- 这一轮完成后可用内存2307 MiB；生产未发布，微信平台真实授权与本轮小程序上传发布仍未核实。20分钟节点已如实报告尚有阻塞，没有按时间放宽门禁。


## 最终候选与定向验收

- 执行者最终候选4c51f4336301572fcc85a2d8e109872019ab0993；桌面main为86e27b0f960070094ac20438c39148389eecc6bc；内置GitHub连接器同步main为2b51947cac7fa2830ea3d057716fe1a85dc14a39，源码树均为24e4872c3be536be7687719d45594135356a1936。业务源码相对已审dfeba12无变化。
- f79e37d定向5项中4通过、1失败（更多按钮的图标使完整accessible name含down）；4c51f43使用行内“更多”语义匹配后operations-closure单项通过，32.8秒、exit0、无OOM。governance在31f完整轮和f79定向轮均通过，保留旧偶发失败原因未确定的事实。
- 18项浏览器业务场景由完整17/18与增量定向复验共同覆盖，不写成单轮18/18。独立QA核对三轮SHA256SUMS与测试契约，认可复用未变化场景。证据目录：测试机 /root/release-20260921-artifact-f22109b/e2e-final-full-31f29ce、e2e-final-targeted-5-f79e37d、e2e-final-operations-4c51f43。
- 常规与覆盖率546项：API267、后台93、小程序153、契约28、领域5；隔离MySQL/Redis集成21/21、真实MySQL跨pool核销专项9/9。最终CI 35560813857 的check及coverage已通过，浏览器及镜像构建仍待最终结果。
- 最终API/Admin构建在测试机按顺序运行，单次1GiB内存、1CPU；构建前后源码manifest一致。源码归档SHA256 5a231e95758eb81901995f887b8014c8a76c44e99a2cd66fa724dcd7747a07ea，manifest SHA256 bda4c5a78e3ce108863843cb4bace58045112c62111590402bfcaf75ec83ab95。
- API镜像sha256:aed3fc6f33aa4deea8405a90caf16ffb664e8868d95a954749a3ba381d4accf9；Admin构建镜像sha256:ae4ce55d5e18ccdef2292da83c45253416664bf622c777b472dba0e880442554；Admin index SHA256 63740443652ebe7ae650053bb975a19a7b97eebc63186aed0f579d75dc35df5a。测试机构建证据/root/release-20260921-artifact-86e27b0。
- 候选已暂存生产/root/release-20260921-86e27b0与/var/www/hometown-admin-86e27b0，10个静态文件摘要及nginx读取权限核对通过，镜像ID核对通过。此时线上仍为旧API与后台，不能将暂存称作上线。
- 独立QA确认receipt、计划字段、镜像绑定、部署锁、旧版本校验、备份和异常回滚脚本通过。ciPassed/independentQaPassed在最终门禁通过前保持false；发布后仍需运行日志联查和版本验收。
- 本轮资源策略：重试不增加runner；测试结束停止runner；受控构建串行；保留数据库、卷、备份及失败证据。阶段内测试机恢复约2.2GiB可用内存。


## 最终CI与发布执行

- CI 35560813857，head 2b51947cac7fa2830ea3d057716fe1a85dc14a39，2026-09-21 04:37:53 UTC completed/success。job106213216814：check、coverage、真实隔离依赖门禁、迁移重放、API/Admin镜像构建通过；本次CI浏览器单轮18 passed (6.2m)，无flaky。与上文分段测试事实分开记录。
- GitHub artifact storage quota仍阻止报告上传，非阻断步骤不能误报上传成功；匹配候选的三轮原始报告及SHA256SUMS已独立核验保留在测试机。CI最终状态和日志摘录保存ci-evidence.json。
- 独立QA对最终86e27b0/tree24e4872条件放行，CI所有阻断检查成功后条件满足。未覆盖微信平台上传/审核/发布与真实交易。
- 测试机本轮MySQL/Redis容器已停止，所有本轮测试及构建进程退出；可用内存2651MiB/总3403MiB，数据卷及证据保留。
- 首次生产发布因Docker重建改变HostConfig.Binds列表顺序，严格顺序断言触发回退；同一断言使脚本结果记ROLLBACK_FAILED。独立实查旧API镜像已恢复且healthy，Env、资源限制、端口、日志配置、Binds集合和完整Mounts相同；compose.env已从before副本恢复。首次deployment-result、backup与rollback-verified.json原样保留在/root/release-20260921-86e27b0。
- deploy.py只将Binds排序比较，并增加按Destination/Source排序的完整Mounts比较；路径和读写权限仍严格校验。独立QA通过；专项校验验证顺序变化通过、bind参数或实际读写权限变化拒绝。修订SHA256 3ed39f958ce1f3ad2e383406ace93871767106a17de3f9c1c3f1286305443951。
- 第二次发布使用独立证据目录/root/release-20260921-86e27b0-attempt2，不覆盖第一次结果；相同源码/镜像/静态包，未重跑无关业务测试。


## 服务器实际部署结果

- 2026-09-21 12:42（中国时间），第二次deployment-result.json为PASS：API绑定86e27b0/tree24e4872与镜像aed3fc6；后台当前链接/var/www/hometown-admin-86e27b0；Nginx指纹6d79c1d。admin.liziqi.icu、saas.liziqi.icu公网index摘要均与候选63740443一致；MySQL/Redis容器身份未变化。
- 备份/root/release-20260921-86e27b0-attempt2/database.before.sql SHA256 128232f486252a81e19e4afe09b2b9ede15eda1328fe5b053ae39a42ae8a18d3，权限受限；保留旧API镜像/后台目录/Nginx和运行配置用于代码回退。本轮未更改schema、清库或执行真实交易。
- verify-runtime.py实际PASS，时间Unix1789965784，请求编号37221955-34fe-4123-b86b-306890635c28：未认证lookup返回401，API与Nginx均记录同一服务端生成编号，日志不含query探针或code=；dataStore/queue/loginProtection/reconciliation/adminBootstrap全部ok。
- 生产可用内存815MiB/1963MiB；测试机2651MiB/3403MiB，无本轮运行容器。未执行清缓存伪造available、删除业务卷或清理失败证据。
- 浏览器“复制排查编号”真实剪贴板点击未单独实测（有代码/单元验证）；微信头像隐私声明、真实手机号授权、登录支付/通知触达、本轮小程序上传审核发布仍未验证。现有小程序已发布不代表86e27b0已在微信发布。导入路径固定为/Users/lizi/Desktop/拼团项目/apps/miniprogram。

- 独立后验已核实线上API镜像、源码labels、健康、Nginx、Admin目录和运行验证。曾报告公网SHA eabde926差异，核实为审核命令shell command substitution删除尾换行导致；审核者已确认该测量错误。按原始response bytes复核admin/saas均682 bytes，SHA63740443，与候选文件逐字节相同，版本差异排除。
- 服务器验收完成；小程序本轮尚未上传发布，真实微信端验收未完成。常规服务器验收不扩展成整个平台所有外部能力已验证。
