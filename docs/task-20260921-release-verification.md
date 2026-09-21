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
| REL-02 | lint、类型、单元、真实隔离 MySQL/Redis 集成、构建和浏览器正常/异常流程 | 进行中 | 执行者；需零隐瞒失败/跳过 |
| REL-03 | 独立审核核心权限、金额/退款、并发核销、失败恢复和验收覆盖 | dfeba12代码复核通过，浏览器与发布后验待完成 | 审核者 |
| REL-04 | 核实生产日志、请求定位、脱敏、轮转与使用说明 | 进行中 | 主负责人 |
| REL-05 | 审核通过后同步及服务器发布，备份/回滚和上线后核心检查 | 源码已同步，候选API构建完成；因E2E失败暂停发布 | 主负责人控制唯一发布窗口 |
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
