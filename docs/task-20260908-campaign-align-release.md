# 团期商品行对齐与默认价格说明

- task_id: TASK-20260908-CAMPAIGN-ALIGN-RELEASE
- confirmed：用户认可商品默认价与本团售价的解释，要求修正“移除”按钮对齐；随后明确要求使用 GitHub 连接“给我推完自动更新服务器”。本轮授权为该批次同步后发布，不创建持续自动部署规则。
- confirmed：发布目标沿用 AGENTS.md 3.1 的 192.144.136.205；后台 admin.liziqi.icu 与点位工作台 saas.liziqi.icu 共用静态产物。发布运维任务已确认无并行写入。
- scope：App.tsx 的商品默认售价标签、团期自动带入价格说明和移除按钮表单布局；不改变价格计算、订单、权限、API、数据库、Nginx、环境变量或小程序。
- ownership：flow_engineering 唯一代码、Git 同步与服务器写入者；root 维护本记录；flow_qa 独立只读审核与后验。
- local_commit：cb7e049a8663e7897ec04cca3bcdc66db51527e8，仅一个源码文件，10 行新增、5 行删除。保留用户 project.config.json、.codex/、prototypes/。

## 本地验收

- evidence-inferred：类型检查、后台构建、差异检查通过；既有构建 chunk 体积提示保留。
- 正常、校验错误、480px 窄屏下，售价输入框与移除按钮顶边分别同为 693.5、693.5、816.5px。
- 独立 QA attempt 1：预审 PASS；未改变字段、校验、自动带入或移除处理，仅调整展示。待发布后只读后验。
- 证据：`/Users/lizi/Backups/TASK-20260908-CAMPAIGN-ALIGN/` 内截图、bounds.json、typecheck.log、build.log。

## Git 与发布

- 本机 HTTPS Git 推送失败原因：命令行无法读取 GitHub 用户名。GitHub 插件已实时确认对目标仓库有 push 权限，使用连接器继续非强制同步；不更换或索取密钥。
- 状态：正式静态页面已更新，工程后验通过；独立后验结论见下方。
- 发布条件：新鲜远端树与已验收本地树一致；服务器现有静态目标与预期一致；版本化静态目录逐文件校验后原子切换；回滚指向切换前真实目标。验证两域首页与资源 SHA、现有 API 健康，并确认未修改运行容器或服务配置。

## 发布结果与异常恢复

- GitHub 非强制同步：`673e72e3d480600530364934fda7f517822ad2b0`；整树 `03224b10dedfe0e0ec5d61773a6c28102a8f05fb` 与已验收本地提交一致。root 通过 GitHub compare_commits 独立确认当前分支与该提交 identical（ahead/behind 均 0）。fetch_commit 工具传输失败不代表其他连接器接口不可用。
- 构建来自精确 git archive；9 个静态文件及压缩包逐项校验。当前静态版本目录 `/var/www/hometown-admin-673e72e`，回滚目标为切换前的 `/var/www/hometown-admin-ad379a8`。备份双端 SHA256 `ac86b621c640ce7932bbf046f84cea619142a70f501380281084190e5fe29125`。
- attempt 1：受限证据命令的 umask 使新静态目录为 0700，切换后首页探针返回 503，立即原子回滚。失败记录保留；没有把首次切换记为成功。
- attempt 2：仅修正本轮公开静态目录为 0755、文件 0644，验证 Nginx 用户逐文件可读后重新切换。工程两轮各 30 项精确 HTTPS 检查通过；两域首页及 8 个资源 SHA 一致，显式 `/index.html` 仍按现有契约返回 410。
- 新首页 SHA256 `c524a57639f8296735683c17bb2b3d3aecbeaf871a939fe016f95490fa497d48`。三域健康检查通过，API/MySQL/Redis 容器 ID、镜像、启动时间、健康状态、重启次数，以及 API 环境和 Nginx 指纹均与发布前一致。
- 本轮未进行生产登录或业务数据写入、数据库查询、真实微信操作或 API 重建。
- 发布证据：`/Users/lizi/Backups/TASK-20260908-CAMPAIGN-ALIGN-RELEASE/release-evidence.json`；双端 SHA256 `08e89ba27233a07def79894f8ea66f2040077352de1eb4883ed0a34d23ebf1e9`。
- root 收尾实时复核：admin/saas 两域首页均 HTTP 200，响应 SHA256 均精确等于上述新版 index SHA，确认正式入口已提供新版。
- 独立 QA attempt 3 最终 PASS，限静态发布与只读健康后验：实时资源 SHA、正式 ready/reconciliation 端点、证据指纹及前后容器/Nginx 快照通过；保留首次 503 与权限修正恢复事实。QA 的 GitHub 在线接口传输失败，使用工程原始操作记录与 root 成功的独立在线 ref 比较补充；不声称 QA 自己完成了 GitHub 活读。
- COMPLETE：代码已同步 GitHub，静态页面已正式更新，工程与独立后验完成。本记录仅文档同步，不重建或再次发布服务。
