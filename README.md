# 社区团购

面向社区集中自提的单一业务系统。运营在后台配置服务区域、自提点、商品和团期；消费者通过微信小程序下单并支付；点位负责人只使用网页工作台确认到货和核销。

## 唯一业务流程

1. 运营配置服务区域、自提点、商品和团期。一个团期固定一个自提点，开售后不能更换。
2. 消费者在微信小程序选择团期并下单，生产环境使用真实微信登录与 JSAPI 支付。
3. 截单后按已付款订单生成拣货装袋标签；运营人工备货、约车并登记运输信息。
4. 点位负责人在网页工作台逐商品确认到货。存在差异时，系统按支付时间、订单号生成分配草案，运营确认后生效。
5. 消费者可分次领取。领取截止为到货后第 3 个自然日 23:59:59（中国时区），逾期由运营处理。
6. 品质售后按每次领取凭证逐商品计算，确认领取后未满 24 小时可提交，满 24 小时截止。
7. 全额或部分退款由运营确认、财务执行，结果通过微信回调落账；通知失败进入人工联系队列。

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
pnpm dev:api
pnpm dev:admin
```

运营后台：`http://127.0.0.1:5173`

小程序：在微信开发者工具中导入 `apps/miniprogram`。本地 API 默认地址为 `http://127.0.0.1:3100`。

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
- 服务区域、自提点、商品、团期和运输参数均由后台配置；迁移不写入城市、点位、商品或演示订单。
- 内部角色仅为 `SUPER_ADMIN`、`OPERATOR`、`CUSTOMER_SERVICE`、`FINANCE`、`PICKUP_MANAGER`；消费者使用 `USER`。
- 微信私钥、公钥和 API v3 密钥不得提交到代码库。

详细规则见 [产品需求](docs/PRD.md)、[架构说明](docs/architecture.md) 和 [上线清单](docs/go-live-checklist.md)。
