# TASK-20260907-MINI-TARGET — 小程序目标迁移

- run_id / task_id: `TASK-20260907-MINI-TARGET`
- attempt: 1
- route: `重大任务`（配置决定 demo / 微信认证；实现严格限定本地配置迁移）
- role: Engineering Lead；report_to: 主 Agent
- 状态：实现与开发验证完成；独立 QA attempt 2 PASS（仅本地小程序配置迁移）。

## 已核对输入和决定

- `CONFIRMED`：本轮主 Agent 任务包转述用户决定：默认 develop 使用 `https://liziqi.icu` 和真实微信登录；仅显式 local 保留本地 demo；本机 release 复用现有 trial 域名和模板映射。
- `CONFIRMED`：已加载 `AGENTS.md`、`docs/project-status.json`、`docs/00-project-context.md`、`docs/01-domain-rules.md`、`docs/02-glossary.md`、`README.md`、`docs/PRD.md`、`docs/architecture.md`、`docs/go-live-checklist.md`。
- `EVIDENCE_INFERRED`：原 `remoteDevelop` 指向旧 HTTP 目标且 authMode=demo；`isDemoDeployment` 允许该远程地址，README 仍指导旧地址；本机 ignored 配置只有 trial。
- `CONFIRMED`：当前明确迁移决定替代 README 中旧开发目标说明，历史验收证据及历史部署地址不改。
- `NOT_APPLICABLE`：UI/交互设计、数据迁移、后端 API 变更、新依赖、真实渠道写入均不在本轮范围。

## 任务边界与所有权

目标：默认开发者工具连接新 HTTPS API，真实微信登录，不向远程发送 demo 身份；显式本地 demo 可用；trial/release 原有失败保护保留。

Engineering Lead 唯一写入：`README.md`、`apps/miniprogram/src/config/deployment.ts`、`deployment.local.example.ts`、`deployment.test.ts`（后二者同 config 目录）、`apps/miniprogram/deployment-generated.test.mjs`、`apps/miniprogram/src/app.test.ts`、`apps/miniprogram/src/pages/home/index.test.ts`、`apps/miniprogram/src/utils/api-demo-guard.test.ts`、`customer-error.test.ts`（同 utils 目录）、本任务文档；另获授权修改 gitignored `apps/miniprogram/src/config/deployment.local.ts`，禁止纳入 Git。

非目标：认证系统重构、服务端设置变更、微信上传/发布、真实登录/支付/订阅消息调用、生产部署。`apps/miniprogram/project.config.json` 的既有用户改动及未跟踪 `.codex/` 完整保留。

停止条件：须改真实密钥、写生产、放宽安全校验、无法隔离用户改动、需扩大授权范围时停止并报告。

## 实现与验收

- develop 默认 `https://liziqi.icu`、`wechat`、demo capability=false。
- demo 白名单仅 localhost/127.0.0.1 HTTP；显式 local 继续使用 `http://127.0.0.1:3100`。
- 示例配置默认 remote，README 明确 local 需显式设置；不覆盖已有本地模板。
- 本机 ignored 文件 release 引用原 trial 对象，未修改原域名或模板 ID；真实模板不进入跟踪文件。
- trial/release 校验逻辑保持原样，测试覆盖缺配置、HTTP、占位域名/模板、demo auth、不完整映射拒绝启动，以及强制关闭 demo capability。
- 默认登录测试仅使用模拟 wx.login/request，验证新域名、微信 code 交换、Bearer header 和没有 demo headers。

## 验证证据

- 原行为基线：定向 3 文件 21 测试 PASS。
- 修改后：`pnpm --filter @hometown/miniprogram test`，27 文件 / 112 测试 PASS。
- `git diff --check` PASS；`rg '180\\.76\\.100\\.156' apps/miniprogram README.md` 无匹配。
- `git check-ignore apps/miniprogram/src/config/deployment.local.ts` 确认被忽略。
- `pnpm check` exit 0：lint/typecheck/test/build PASS，342 测试通过、8 MySQL/Redis 集成测试因未提供集成环境而跳过；现有前端大 chunk 构建警告保留。原始日志 `/tmp/task-20260907-mini-target-check.log`、`/tmp/task-20260907-mini-target-e2e.log`。
- 首轮 E2E：12 PASS / 1 FAIL，`apps/admin-web/e2e/community-ui.spec.ts:253` 点击“重试核验”超时，trace 显示按钮不稳定后 DOM detached；按主 Agent 指令单例重跑 exit 0，1/1 PASS（30.3 秒），日志 `/tmp/task-20260907-mini-target-e2e-retry.log`。首次全量 exit 1 与失败原貌保留，不将其改写成首次全量通过；未修改后台源码。
- 新增测试先出现 lint 类型导入约束、随后出现小程序仅微信类型环境不支持 Node 测试 helper，以及 ignored release 可选类型赋值错误；按主 Agent 授权将 helper 移到根目录 `.test.mjs` 并显式检查 trial，定向 lint、typecheck、112 测试复验 PASS。
- 首次测试启动因 shell PATH 无 node 失败（exit 127）；使用宿主已有 bundled Node 后基线及回归成功。未安装软件或改持久环境。

## 兼容、回滚与外部边界

- 无 API/数据库/依赖迁移。登录从远程 demo 改为真实微信是本轮确认变化；原 demo storage 不会被新远程认证视为登录凭据。
- 回滚仅限本轮文件的定向反向差异和删除 ignored 文件新增的 release 引用；保留用户配置与原 trial 数据，不 reset 工作树。回到旧远程 demo 不是批准的生产修复路径，异常时优先显式 local 诊断。
- `BLOCKING_UNKNOWN`（仅阻塞发布）：微信合法域名、实际模板两端一致性、订阅消息 `WECHAT_SUBSCRIBE_MINIPROGRAM_STATE` 与 trial/formal 落点须发布前核验。配置准备不等于微信上线或真实渠道验收通过。
- `CONFIRMED`：本轮无生产/真实微信写入、无部署和上传发布；真实外部链路没有本轮验收证据。

## Git 与交接

- 基线 HEAD：`d78bb90e60d6f4fb37b247718642f468b6eba378`；分支 `codex/audit-remediation`。
- 主 Agent 已转交独立 QA attempt 2 原始结论 PASS，并授权仅本轮 10 个明确文件创建本地提交；不推送，GitHub 鉴权阻断保留。
- GitHub 同步外部阻断：主 Agent 报告 `git ls-remote origin` exit 128，`could not read Username for https://github.com: Device not configured`；不改凭据、不重复尝试。
- 下一责任人：主 Agent 汇总验收、本地提交与 Git 同步阻断。

## 独立 QA 交接

- run_id / task_id：`TASK-20260907-MINI-TARGET`；QA attempt：2。
- `CONFIRMED`：主 Agent 转交独立 QA 原始结论 `PASS`，仅限本地小程序配置迁移，无未解决实现发现。
- 8 项集成测试 skip、真实微信未验收、E2E 首轮失败及单例重跑通过记录全部保留。
- 本地提交按本轮 10 文件白名单执行，关联任务 ID；不纳入用户 `project.config.json`、`.codex/` 或 ignored 本地配置。提交号由 Git 历史和最终交接记录给出，避免文档自引用。
