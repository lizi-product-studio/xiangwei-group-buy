# 上线问题与解决方案

对照 `docs/go-live-checklist.md`、P0/P1 验收文档和 2026-08-25 本机实测。
目标：把剩余工作分成「本机能做」「你拍板后才能做」「外部平台才能做」。

当前结论：**产品主线代码大体齐了，还不能宣布可上线。** 仓库在 `codex/audit-remediation`，工作树约有 5700 行未提交改动。本会话未能在默认 PATH 下跑通 `pnpm check` / `pnpm test:e2e`。真实微信预发布不能用本地 mock 代替。

---

## 建议执行顺序

1. 修好本机 PATH，确认内存模式能开后台和小程序开发版。
2. 安装 Docker（或等价 MySQL 8.4 + Redis 7.4），再启用 `.env`、迁移、bootstrap。
3. 你确认后提交当前工作树；用 `pnpm check` + `pnpm test:e2e` 补门禁证据。有 Docker 时再带集成 URL。
4. 你拍板：P1-C 是否必须首发、微信/域名/商户是否就绪、法务两项如何处理。
5. 在安全机器上填生产 env 与小程序 `deployment.local.ts`（不入库）。
6. 单独授权后再做生产部署、证书、商户进件和预发布实操。

---

## A. 本机运行

### A1. 默认终端找不到 Node / pnpm

| | |
|---|---|
| 现象 | `node` / `pnpm` 报 command not found；Cursor 默认 PATH 里也没有 |
| 原因 | Node 22.22.3 与 pnpm 11.16.0 已装在 `~/.local/node/bin`，未加入 PATH |
| 解决 | 写入 `~/.zshrc`（或 `~/.zprofile`）后开新终端： |

```bash
export PATH="$HOME/.local/node/bin:$PATH"
node -v   # 期望 v22.x
pnpm -v   # 期望 11.x
```

完成标准：新开终端能直接执行 `pnpm dev:api`。不要用旁边的 Node 20（`~/.local/node-v20.20.2-darwin-arm64`），项目要求 `>=22`。

### A2. 复制 `.env.example` 后 API 立刻退出

| | |
|---|---|
| 现象 | `Error: connect ECONNREFUSED 127.0.0.1:3306` |
| 原因 | 示例环境默认 `DATA_STORE=mysql` + `QUEUE_DRIVER=redis`；本机 3306/6379 未监听 |
| 解决 | 日常联调**先不要**复制 `.env.example`。无 `.env` 时 API 用内存库，实测 `/health/ready` 正常。 |

需要持久化时再：

```bash
# 先有 Docker 或本机 MySQL 8.4 + Redis 7.4
cp .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm dev:api
```

完成标准：无 `.env` 时内存模式可启动；有 `.env` 时 3306/6379 必须先就绪。

### A3. 没有 Docker，无法起项目配套库

| | |
|---|---|
| 现象 | `pnpm infra:up` 不可用；3306、6379 连接拒绝 |
| 原因 | 本机没有 Docker / OrbStack / Colima。旁路 MySQL 8.0.40（曾在 3399）不是本项目栈，也不满足清单要求的 8.4 |
| 解决 | 安装 Docker Desktop 或 OrbStack，再执行 `pnpm infra:up`。不要把 8.0/其他端口的旧库接到 `.env.example` 的 3306 |

完成标准：`docker compose -f infra/compose.yaml ps` 中 mysql、redis 健康；`pnpm db:migrate` 在空库上可重复执行。

### A4. 内存模式下账号密码登录失败

| | |
|---|---|
| 现象 | `POST /api/v1/auth/admin/login` 返回「账号或密码不正确」 |
| 原因 | 内存库无超管。`pnpm admin:bootstrap` 只写 MySQL，且需要 `DATABASE_URL` 与 bootstrap 账号变量 |
| 解决 | 开发态后台（Vite，未设 `VITE_AUTH_MODE=bearer`）会自动带 `SUPER_ADMIN` demo 头，空库也能进界面。要测正式登录：先 A3，再： |

```bash
# 仅在本机临时导出，不要写入仓库
export BOOTSTRAP_ADMIN_USERNAME=ops.admin
export BOOTSTRAP_ADMIN_PASSWORD='至少12位的随机密码'
export BOOTSTRAP_ADMIN_DISPLAY_NAME='值班超管'
export BOOTSTRAP_ADMIN_PHONE='1xxxxxxxxxx'   # 有效大陆手机号
pnpm admin:bootstrap
```

然后用 `VITE_AUTH_MODE=bearer pnpm dev:admin` 测登录。既有超管轮密必须额外设 `BOOTSTRAP_ADMIN_ROTATE_CONFIRM=ROTATE`。

完成标准：开发态 demo 可进后台；MySQL 模式下 bootstrap 后账号密码可登录。

### A5. 本机验证过的正常路径（对照，避免误修）

- 不设 `.env`：`pnpm dev:api` 监听 `127.0.0.1:3100`，`/health/live` 与 `/health/ready` 为 ok。
- `pnpm dev:admin` 打开 `http://127.0.0.1:5173`，`/api` 代理到 3100 正常。
- 小程序开发版默认 `http://127.0.0.1:3100`、`authMode=demo`，可联调。

---

## B. 质量门禁与仓库

### B1. 本轮没有 `pnpm check` / `pnpm test:e2e` 运行证据

| | |
|---|---|
| 现象 | 上线清单第一条无法签字 |
| 原因 | 默认 PATH 找不到 Node；未在本环境跑完整门禁 |
| 解决 | PATH 修好后： |

```bash
pnpm install
pnpm check
pnpm exec playwright install chromium   # 首次
pnpm test:e2e
git diff --check
```

有 Docker 时本地集成不要靠 skip：

```bash
export INTEGRATION_DATABASE_URL=mysql://app:app_password@127.0.0.1:3306/hometown_food
export INTEGRATION_REDIS_URL=redis://127.0.0.1:6379
export REQUIRE_INTEGRATION_TESTS=true
pnpm --filter @hometown/api test -- mysql-redis.integration
```

完成标准：上述命令通过；CI（`.github/workflows/quality.yml`）在 PR 上全绿。

### B2. 本地集成测试是 skip，验收要求 BLOCKED

| | |
|---|---|
| 现象 | 未设集成 URL 时 `describe.skipIf` 跳过用例，报告像 PASS |
| 原因 | 仅当 `REQUIRE_INTEGRATION_TESTS=true` 才 fail-closed；本地默认未开 |
| 解决 | 本地要签集成项时必须设 B1 中的三个变量。代码若要与验收文档完全一致，可把 skip 改为显式失败并输出 `BLOCKED（环境缺失）`；这是小改动，需你确认后再改 |

完成标准：CI 缺 URL 失败；本地未提供 URL 时不得把集成项标成已通过。

### B3. 约 5700 行未提交改动不在 `main`

| | |
|---|---|
| 现象 | 员工权限、退款恢复、通知 at-most-once、P1-C 治理页、验收文档、`AGENTS.md` 仍在工作树 |
| 原因 | 未授权 commit；分支是 `codex/audit-remediation` |
| 解决 | 先审 diff。确认后由你明确说「提交」再 commit。不把 `.env`、密钥、`deployment.local.ts` 加进去 |

完成标准：相关改动进入版本库；`main` 或发布分支包含要上线的提交。

---

## C. 微信预发布与生产配置

这些不能用本地 mock 代替。密钥只放安全主机，不入库。

### C1. 小程序登录、隐私版本

| | |
|---|---|
| 缺什么 | 真实 AppID/AppSecret；隐私协议版本与后台一致 |
| 解决 | 微信公众平台配置与 `.env` / `infra/deploy.env` 中 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`PRIVACY_NOTICE_VERSION` 对齐。当前代码默认版本 `2026-08-12`，改文案必须前后台一起改 |
| 验收 | 预发布小程序真实登录成功；隐私版本不一致时被拒绝 |

`apps/miniprogram/project.config.json` 已有 AppID `wx323bfd5b1c550534`。需你确认这就是正式要用的应用。

### C2. JSAPI 支付与退款回调

| | |
|---|---|
| 缺什么 | 商户号、证书序列号、私钥、平台公钥、API v3 密钥、备案 HTTPS 回调 |
| 解决 | 按 `infra/deploy.env.example` 在**未入库**的 `infra/deploy.env` 填写真实值。`WECHAT_PAY_NOTIFY_URL` / `WECHAT_PAY_REFUND_NOTIFY_URL` 必须是真实备案 HTTPS，不能是 `example.com` / `.invalid` / localhost。生产 `NODE_ENV=production` 缺任一项会拒启动 |
| 验收 | 小额支付成功；全额与按行部分退款成功；重复通知只入账一次；支付/取消竞争符合预期 |

### C3. 四类订阅消息

| | |
|---|---|
| 缺什么 | 站点确认、发车、到货、部分退款 四套已审模板 ID + 字段 JSON |
| 解决 | 微信后台审核通过后，把 ID 和字段映射写入 `WECHAT_SUBSCRIBE_*_TEMPLATE_ID` / `_DATA`，占位符与 `deploy.env.example` 注释一致（`{{title}}` 等） |
| 验收 | 四类消息可发；失败进入客服人工队列，人工完成只记一次 |

### C4. 体验版/正式版小程序上传会失败

| | |
|---|---|
| 现象 | 缺少 `deployment.local.ts` 时抛错，要求备案 HTTPS 与四类模板 |
| 原因 | 有意 fail-closed，避免把示例域名传上去 |
| 解决 | 仅在安全上传环境复制 `apps/miniprogram/src/config/deployment.local.example.ts` → `deployment.local.ts`，填真实 `https://` API 与已审模板 ID。该文件保持 gitignore |

完成标准：开发版仍走本地；trial/release 能解析到真实部署，上传不再因占位符失败。

### C5. 生产编排与密钥保管

| | |
|---|---|
| 缺什么 | `infra/deploy.env` 仍是占位符；本机也还没有生产主机 |
| 解决 | 选一台不入库的机器保存 `infra/deploy.env`、微信支付 PEM、bootstrap 超管密码、`PICKUP_CODE_SECRET`（≥32 且不是 `development-only-pickup-secret`）。用 `infra/compose.production.yaml` 部署。生产必须 MySQL、Redis、`REQUIRE_HTTPS=true`、真实微信登录和支付 |
| 注意 | 生产部署、买证书、商户进件必须你单独授权后才做 |

完成标准：生产进程能启动；缺配置时明确拒启动而不是带 mock 上线。

---

## D. 运营与法务（代码替代不了）

### D1. 运营手工签收（代码面已覆盖，预发布再抽检）

按 `docs/go-live-checklist.md`「运营验收」逐条在预发布点选：

- 不自动创建全国区域或默认自提点；仅有真实启用点位的可下单区域对消费者开放，未覆盖地区仅登记开通意向
- 开售后自提点不可变
- 差异分配可复算；确认前不可核销/退款
- 五角色到货正反例（含超管紧急代办必须填原因）
- 跨点位、重复/并发/分次核销、截止时刻、24 小时品质边界
- 员工停用/换角色/换点位后旧会话立即失效

完成标准：运营、财务、点位负责人和超管各签一页，而不是只看单元测试。

### D2. 人工联系渠道与隐私政策（P1-C 外部 BLOCKED）

系统不持有、也不应假设可外呼消费者手机号。需要产品 + 法务批准：客服用哪条既有合规渠道、如何告知、如何留存。未批前，通知失败的「人工完成」只记录处理说明，不在产品内拨打电话。

### D3. 消费者账号注销未做（P1-C 外部 BLOCKED）

与订单留存、支付凭据、未结售后和法定数据处理冲突。未获产品/法务/财务批准的数据生命周期规则前，**不实现注销**。可选：首发书面接受「上线后事项」，或暂停上线直到规则齐。

### D4. P1-C 治理是否必须首发

工作树已含品质职责分离、截单后取消、通知人工队列、区域意向、审计脱敏、账本、商品/点位启停/团期延期。若首发只要 P0 + P1-A/B 履约主线，需你书面确认治理后补；否则提交时应带上这批改动并完成对应 E2E。

---

## E. 明确不做（除非另批）

- 不扩大产品范围，不做第二套业务模型
- 不把真实密钥、证书、`deployment.local.ts` 提交进仓库
- 不把基线迁移打到未知旧库；旧环境新建空库再迁
- 不在未授权时生产部署、付费商户操作、对外发消息
- 不实现账号注销，除非 D3 的规则已批

---

## 待你确认（挡住后续排期）

1. 首发是否必须含 P1-C 治理？
2. AppID `wx323bfd5b1c550534`、备案 HTTPS 域名、商户号是否已有？预发布窗口？
3. 运营 / 财务 / 法务 / 技术谁签收？谁进开发者工具做支付退款和订阅消息？
4. 生产密钥放哪台机器、谁保管？
5. 四类订阅模板是否已审？字段能否按 `deploy.env.example` 配？
6. 隐私渠道与账号注销：首发接受后补，还是必须先有法务规则？
7. 未提交改动：是否先只整理补测、等你说「提交」再 commit？
8. 是否现在就把 `~/.local/node/bin` 写入 shell，并安装 Docker？

回复这 8 项后，可在授权范围内继续：修 PATH 文档、跑门禁、按你的范围整理工作树；生产与商户操作仍等单独授权。
