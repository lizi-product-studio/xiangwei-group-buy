# 家乡美食集单自提平台技术架构

> 当前领域基准（2026-08-13）：系统正在由历史 `legacy-marketplace`（多商户撮合）迁移到 `platform-procurement`（平台统一采购、销售和履约）。新模式使用独立销售明细、供应商采购、中心仓批次库存、分拣出库和点位交接表；旧 `merchant_orders`、佣金、分账与结算只处理历史订单。两套模型以订单/团期业务版本隔离，所有数据库变化为 additive migration，禁止转换或删除历史资金记录。

## 模式 B 现行架构

```text
sales (platform order / direct payment / refund)
  └─ locked campaign ──> procurement (supplier offers / purchase orders / payables)
                            └─ warehouse (receipt / quality / lots / movements / sorting)
                                  └─ fulfillment (outbound / fixed-point handover)
                                        └─ pickup verification
finance records platform clearing, contract liability, revenue, inventory cost and supplier payables

legacy-marketplace remains read/settle/refund compatible behind business_model_version=LEGACY_MARKETPLACE
```

- 模式 B 消费者支付走平台单商户直连支付，支付/退款回调以 `payments.payment_route` 路由；绝不根据旧 `provider_context` 猜测。
- 批次余额是 `inventory_movements` 的可验证投影；`product_skus.stock/sold_quantity` 仅保留 legacy 目录/团期分配，绝不作为模式 B 中心仓实物库存。
- 交接完成前不创建模式 B 取货码；交接少货/拒收只记录异常并阻断自动部分退款，等待财务人工处理。
- 生产默认关闭模式 B 新流量，待微信平台主体、供应商资质、期初库存与预发演练确认后灰度打开；回滚只关闭新建，不回写已创建订单。

> 架构更新说明：当前交易和履约链路使用 `campaign_delivery_plans`；每个开售团期必须在其中绑定一个已启用的固定自提点，新订单记录 `service_area_id`、`pickup_point_id`、`delivery_plan_id`。旧 `campaign_pickup_points` 仅用于历史兼容；详细数据模型与权限边界见 [履约与界面说明](interface-prototype-map.md)。

## 架构原则

- 首期采用模块化单体，避免微服务带来的部署、事务和运维复杂度。
- API 服务无状态化，可通过增加实例横向扩容。
- 支付回调、退款、团期关闭、消息通知和分账使用持久化任务队列。
- 金额统一使用整数分存储，不使用浮点数。
- 订单、支付、退款、核销和分账均要求幂等。
- 财务流水和审计日志仅追加，不允许物理删除或原地篡改。
- 行政区字典与实际服务区县分离：首期仅启用保定市下辖区县，只有启用且配置自提点的区域允许下单。

## 技术栈

### 用户端

- 微信原生小程序
- TypeScript
- 微信登录、订阅消息、地图与支付能力

### 运营后台

- React + TypeScript
- Vite
- Ant Design
- TanStack Query

### 服务端

- Node.js LTS + TypeScript
- NestJS 或 Fastify 模块化应用层
- MySQL 8
- Redis
- BullMQ 持久化任务队列
- OpenAPI
- 对象存储（腾讯云 COS/兼容 S3 的适配层）

### 工程

- pnpm workspace
- Vitest
- ESLint + Prettier
- Docker Compose（本地与测试）
- 容器化部署

## 前端结构

```text
apps/
  miniprogram/       微信小程序
  admin-web/         运营后台
packages/
  api-contracts/     API 类型与校验规则
  domain/            可复用领域枚举、金额和状态机
  config/            共享工程配置
```

小程序使用角色化工作台：普通用户、已获点位授权的核销员和商户使用同一账号体系，但由服务端权限决定可见入口和可执行操作。自提点负责人角色待建立可审计点位映射后再开放到货确认等操作。

## 后端结构

```text
apps/api/src/modules/
  auth/
  users/
  merchants/
  catalog/
  service-areas/
  pickup-points/
  campaigns/
  orders/
  payments/
  fulfillment/
  pickup/
  commissions/
  settlements/
  after-sales/
  notifications/
  audit/
```

模块间通过应用服务和显式接口协作，不直接跨模块写表。支付、订单、履约和结算使用本地事务加 outbox 事件，避免业务提交成功但异步消息丢失。

## 数据库设计

| Table | Purpose | Key Fields | Notes |
| --- | --- | --- | --- |
| users | 用户 | id, wechat_openid, phone, status | openid 唯一，手机号加密/脱敏 |
| roles / permissions | RBAC | code, scope | 支持平台、商户、自提点数据范围 |
| user_roles | 用户角色 | user_id, role_id, tenant_type, tenant_id | 角色可限定到商户或自提点 |
| merchants | 商户 | id, name, status, default_commission_bps | 佣金用基点表示 |
| merchant_qualifications | 商户资质 | merchant_id, type, number, expires_at, status | 文件存对象存储，保留审核记录 |
| merchant_payment_accounts | 微信二级商户 | merchant_id, sub_mchid, status | 不保存支付平台密钥 |
| products | 商品 | merchant_id, title, origin, status | 平台代运营，发布需审核 |
| product_skus | SKU | product_id, price_cents, weight_grams, status | 价格和重量使用整数 |
| food_profiles | 食品信息 | product_id, shelf_life_days, storage_type, label_data | MVP 仅 NORMAL_TEMPERATURE |
| regions | 行政区字典 | code, parent_code, level | 首期维护保定市下辖区县，结构支持后续扩展 |
| service_areas | 开通区域 | region_code, status, order_enabled | 未开通区域不可下单 |
| pickup_points | 自提点 | service_area_id, owner_user_id, location, status, capacity | 支持申请与平台创建 |
| pickup_applications | 自提点申请 | applicant_id, form_data, status | 审核过程可追溯 |
| campaigns | 团期 | service_area_id, cutoff_at, dispatch_at, status, failure_action | 关闭操作需版本号/锁 |
| campaign_rules | 团期规则 | campaign_id, rule_type, threshold, config | FIXED_TIME/MIN_QTY/MIN_AMOUNT 等 |
| campaign_skus | 团期商品 | campaign_id, sku_id, stock, sold_qty | 独立团期库存 |
| campaign_pickup_points | 团期自提点 | campaign_id, pickup_point_id | 控制可选点位 |
| orders | 父订单 | user_id, campaign_id, pickup_point_id, status, total_cents | 用户支付视图 |
| merchant_orders | 商户子订单 | order_id, merchant_id, status, payable_cents | 退款/结算边界 |
| order_items | 明细 | merchant_order_id, sku_id, qty, amount_cents | 保存商品快照 |
| discount_allocations | 优惠分摊 | order_item_id, source, amount_cents, funding_party | 平台/商户承担可追溯 |
| payments | 支付单 | order_id, out_trade_no, transaction_id, status | 业务单号和微信单号唯一 |
| payment_callbacks | 回调原文摘要 | payment_id, callback_id, received_at, result | 幂等与审计 |
| refunds | 退款单 | merchant_order_id, amount_cents, status, reason | 支持部分退款 |
| dispatch_batches | 发车批次 | service_area_id, code, status, dispatched_at | 可包含多个团期 |
| allocations | 批次分拣 | batch_id, pickup_point_id, sku_id, qty | 自提点商品汇总 |
| packages | 包裹 | batch_id, pickup_point_id, code, status | 可选物理包裹层 |
| pickup_codes | 取货码 | order_id, code_hash, status, expires_at | 不明文长期保存 |
| pickup_records | 核销记录 | order_id, pickup_point_id, verifier_id, verified_at | 唯一约束防重复 |
| fulfillment_exceptions | 履约异常 | batch_id, order_item_id, type, evidence | 异常冻结结算 |
| commission_rules | 佣金规则 | scope_type, scope_id, rate_bps, priority | 商品/活动/商户多级覆盖 |
| ledger_entries | 财务流水 | account, direction, amount_cents, reference | 仅追加、借贷平衡 |
| settlements | 商户结算单 | merchant_id, period, status, amount_cents | 对应微信分账结果 |
| after_sales | 售后单 | order_item_id, type, status, requested_amount | 状态化处理 |
| outbox_events | 可靠事件 | aggregate_type, aggregate_id, event_type, payload | 事务内写入 |
| audit_logs | 审计日志 | actor_id, action, resource, before, after | 禁止物理删除 |

## API 设计

API 使用 `/api/v1` 版本前缀，错误响应统一包含 `code`、`message`、`requestId` 和可选 `details`。

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| POST | /auth/wechat/login | 微信登录换取平台会话 | Public |
| GET | /service-areas | 获取已开通城市 | Optional |
| GET | /pickup-points | 查询城市自提点 | Optional |
| POST | /pickup-applications | 申请自提点 | User |
| GET | /campaigns | 团期列表 | Optional |
| GET | /campaigns/:id | 团期与商品详情 | Optional |
| POST | /orders/preview | 订单试算、优惠和库存校验 | User |
| POST | /orders | 创建父订单和商户子订单 | User + Idempotency-Key |
| POST | /orders/:id/payments | 创建微信支付参数 | User |
| GET | /orders/:id | 订单详情 | Owner/Authorized |
| POST | /orders/:id/cancel | 取消订单 | Owner |
| POST | /after-sales | 发起售后 | Owner |
| GET | /pickup-code | 获取当前取货码 | Owner |
| POST | /pickup/verify | 核销取货码 | Pickup Verifier + Idempotency-Key |
| POST | /payment-callbacks/wechat | 微信支付回调 | WeChat Signature |
| POST | /refund-callbacks/wechat | 微信退款回调 | WeChat Signature |
| POST | /admin/merchants | 平台创建商户 | Operator |
| POST | /admin/merchants/:id/review | 审核商户 | Reviewer |
| POST | /admin/products | 代商户创建商品 | Operator |
| POST | /admin/products/:id/review | 审核发布 | Reviewer |
| POST | /admin/campaigns | 创建团期 | Operator |
| POST | /admin/campaigns/:id/open | 开售 | Operator |
| POST | /admin/campaigns/:id/close | 手动关闭/结团 | Operator + Idempotency-Key |
| POST | /admin/dispatch-batches | 创建发车批次 | Fulfillment |
| POST | /admin/dispatch-batches/:id/dispatch | 发车 | Fulfillment |
| POST | /pickup/batches/:id/receive | 自提点确认到货 | Pickup Manager |
| GET | /admin/settlements | 结算单列表 | Finance |
| POST | /admin/settlements/:id/execute | 发起解冻/分账 | Finance + Re-auth |

## 权限模型

- RBAC 控制功能权限，数据范围控制用户能访问的平台、商户或自提点数据。
- 一个用户可以同时是消费者、商户联系人和自提点负责人。
- 审核采用“提交人与审核人不可为同一人”的可配置四眼原则。
- 财务操作、商户收款账户变更和大额退款要求重新验证身份。
- 后台列表默认脱敏手机号、身份证号、银行卡号和许可证敏感字段。

## 状态流转

### 团期

`DRAFT -> SCHEDULED -> OPEN -> CLOSING -> LOCKED -> FULFILLING -> COMPLETED`

异常分支：`OPEN/CLOSING -> POSTPONED | CANCELLED`。

### 订单

`PENDING_PAYMENT -> PAID_WAITING_CLOSE -> LOCKED -> ALLOCATING -> IN_TRANSIT -> READY_FOR_PICKUP -> PICKED_UP -> COMPLETED`

异常分支：`CANCELLING -> REFUNDING -> REFUNDED`；任意履约阶段可进入 `AFTER_SALE_PARTIAL`，但明细状态独立管理。

### 发车批次

`DRAFT -> PICKING -> READY_TO_DISPATCH -> IN_TRANSIT -> ARRIVED -> DISTRIBUTED -> CLOSED`

### 结算

`PENDING -> ELIGIBLE -> PROCESSING -> SUCCEEDED | FAILED -> RECONCILED`

所有状态迁移都在领域服务中校验，不允许控制器或后台直接更新状态字段。

## 并发与容量设计

- API 无状态，负载均衡后可运行多个实例。
- 团期关闭、库存扣减、支付回调和核销使用数据库唯一约束、事务和 Redis 锁组合保护。
- 热门团期和自提点列表可缓存；库存真值保留在数据库事务中。
- 通知、导出、退款、分账和团期批处理放入队列，不阻塞用户请求。
- 大型导出生成异步文件，不在 HTTP 请求内加载全部订单。
- 数据量增长后优先使用索引优化、归档、只读副本和队列扩容，再考虑拆分服务。
- 设计目标不是首期一次建设“无限容量”，而是在无业务重写情况下逐级扩容。

建议容量阶段：

1. 起步：2 个 API 实例、1 个 Worker、单 MySQL 主库、单 Redis 高可用实例。
2. 增长：API/Worker 水平扩容，MySQL 增加只读副本，对象存储承载文件。
3. 大促：按订单、支付、团期 Worker 分队列，限流、预热缓存、数据库连接池隔离。
4. 达到明确瓶颈后，优先拆出通知、导出和结算，再评估订单/支付独立服务。

## 错误处理

- 外部接口统一超时、指数退避、最大重试次数和熔断告警。
- 支付结果以微信查询/回调为准，前端响应不作为最终资金状态。
- 所有写操作携带 `requestId`，关键创建操作支持 `Idempotency-Key`。
- 不向客户端返回堆栈、SQL、微信密钥或内部账号信息。
- 业务错误使用稳定错误码，例如 `CAMPAIGN_CLOSED`、`SKU_STOCK_INSUFFICIENT`、`PICKUP_CODE_USED`。

## 配置与环境变量

- 数据库、Redis、对象存储和微信密钥仅通过环境变量或密钥管理服务注入。
- 提供 `.env.example`，不提交真实 AppSecret、APIv3 Key、商户证书和用户数据。
- 团期、佣金、退款时限等业务配置存数据库并保留版本，不写死在环境变量。
- 生产环境关闭调试接口和默认账号，强制 HTTPS。

## 部署方式

- 本地开发：Docker Compose 启动 MySQL、Redis、API 和 Worker。
- 测试/生产：容器镜像部署到中国大陆云服务，使用托管 MySQL、Redis、对象存储和负载均衡。
- 域名、服务器、小程序主体和备案主体保持一致或符合备案及微信审核要求。
- 生产数据库自动备份并定期做恢复演练。
- 健康检查分为进程存活、依赖可用和任务积压指标。

## 风险与权衡

- 模块化单体降低首期成本，但必须通过模块边界、代码所有权和数据库访问规则防止变成“大泥球”。
- 原生小程序能获得最佳微信兼容性，但以后增加其他平台时需要新建终端或抽取更多共享逻辑。
- MySQL 事务便于保证订单一致性；高并发热点库存需要压测后选择数据库锁或 Redis 预扣方案。
- 平台收付通比普通微信支付复杂，但能降低商户资金归集风险并支持平台抽佣。
- 自提点增长后必须分页、空间索引、审核和风险控制；首期查询范围限制在保定市服务区县。
