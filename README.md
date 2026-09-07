# 社区团购

面向社区集中自提的单一业务系统。运营在后台配置服务区域、自提点、商品和团期；消费者通过微信小程序下单并支付；点位负责人只使用网页工作台确认到货和核销。

## 唯一业务流程

1. 只有已启用、允许下单且有真实启用自提点的区域对消费者开放。未覆盖地区只能登记开通意向；运营显式配置区域、点位、商品、团期和运输。一个团期固定一个自提点，开售后不能更换。
2. 消费者在微信小程序选择团期并下单，生产环境使用真实微信登录与 JSAPI 支付。
3. 截单后按已付款订单生成拣货装袋标签；运营人工备货、约车并登记运输信息。
4. 点位负责人在网页工作台逐商品确认到货。存在差异时，系统按支付时间、订单号生成分配草案，运营确认后生效。
5. 消费者可分次领取。领取截止为到货后第 3 个自然日 23:59:59（中国时区），逾期由运营处理。
6. 品质售后按每次领取凭证逐商品计算，确认领取后未满 24 小时可提交，满 24 小时截止。
7. 全额或部分退款由运营确认、财务执行，结果通过微信回调落账；通知失败进入人工联系队列。
8. 未成团最多顺延一次，二次未达量自动取消退款；同一次领取可对多个商品一次提交售后。

## 代码结构

- `apps/api`：认证、目录、团期、订单、支付退款、配送领取、通知、账本和审计。
- `apps/admin-web`：运营、客服、财务、超级管理员和点位负责人网页工作台。
- `apps/miniprogram`：消费者微信小程序，不包含内部员工工作入口。
- `packages/domain`：金额与状态机等共享领域规则。
- `packages/api-contracts`：请求参数和公共接口契约。
- `infra`：本地及生产编排、干净数据库基线迁移。

## 本地运行

需要 Node.js 22+ 与 pnpm 11+。

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会同时启动使用内存数据的 API（3100）和运营后台（5173），适合不依赖 Docker 的基础预览；停止命令后两个进程会一起退出。也可以继续分别启动：

```bash
pnpm dev:api
pnpm dev:admin
```

运营后台：`http://127.0.0.1:5173`

小程序：在微信开发者工具中导入 `apps/miniprogram`。开发者工具的 `develop` 环境默认访问新 HTTPS API `https://liziqi.icu`，使用真实微信登录，无需先启动本地 API 即可预览首页。

如需本地联调，可将 `apps/miniprogram/src/config/deployment.local.example.ts` 复制为被 gitignore 的 `apps/miniprogram/src/config/deployment.local.ts`，并显式设置 `development = { mode: 'local' }`（示例默认 `remote`；已有本地配置时仅修改该字段，保留已有模板），再在项目根目录运行 `pnpm dev`。该切换只对 `develop/local` 的开发体验登录生效；`trial/release` 仍必须使用备案 HTTPS 域名、真实微信登录和已审核模板配置，不能填 HTTP 地址或固定凭据。

如需使用 MySQL 与 Redis：

```bash
cp .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm dev:api
```

当前项目没有需要保留的真实业务数据，数据库从 `infra/mysql/migrations/0001_community_baseline.sql` 建立干净基线。不要把该基线直接覆盖到未知旧库；旧环境应新建空数据库后迁移。

## 验证

```bash
pnpm check
pnpm test:e2e
```

真实 MySQL/Redis 集成测试在提供 `INTEGRATION_DATABASE_URL` 与 `INTEGRATION_REDIS_URL` 后执行。上线前还必须在微信预发布环境完成真实登录、小额支付、全额/部分退款回调和订阅消息触达验收。

## 生产要求

- 生产必须使用 MySQL、Redis、HTTPS、真实微信登录和真实微信支付，启动配置缺失时服务拒绝启动。
- 周期调和在单实例防重入，并用 Redis 租约避免多个 API 副本重复执行；调和失败会使当前副本 readiness 降级。当前 readiness 只记录本副本最近一次执行结果，不足以证明非持锁副本的全局调和健康，多副本发布前必须补全共享健康信号或拆出独立 worker。
- 当前 MySQL 单行聚合只适合有容量门槛的受控试点。上线前必须取得真实 MySQL/Redis 压测和恢复证据，未达标不得扩区。
- 服务不会自动创建全国区域或默认自提点；消费者只会看到已有真实启用点位的可下单区域。迁移不写入具体城市名单、点位或演示订单。
- 内部角色仅为 `SUPER_ADMIN`、`OPERATOR`、`CUSTOMER_SERVICE`、`FINANCE`、`PICKUP_MANAGER`；消费者使用 `USER`。
- 微信私钥、公钥和 API v3 密钥不得提交到代码库。

详细规则见 [产品需求](docs/PRD.md)、[架构说明](docs/architecture.md) 和 [上线清单](docs/go-live-checklist.md)。

订阅消息采用五模板覆盖七事件；字段示例见 `infra/deploy.env.example`。服务端 `WECHAT_SUBSCRIBE_MINIPROGRAM_STATE` 必须与小程序 trial/formal 发布环境一致。旧模板偏好须按实际模板 ID 重新订阅；一次接受不等于无限额度。真实模板 ID、类目及字段接收仍须平台验收。
