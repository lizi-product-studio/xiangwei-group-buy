---
title: "社区团购 — System Design"
status: APPROVED
version: 1.0.0
last_updated: "2026-08-31"
owner: architect
source_of_truth: project-document-set
---

# System design

## Context and components

| Component | Responsibility / owned contracts | Dependencies | Failure isolation |
|---|---|---|---|
| 微信小程序 | USER 登录、目录、订单、消息、售后、意向 | API、微信登录/支付/订阅 | release 配置缺失拒上传 |
| 运营后台 | 五内部角色页面与动作 | API | 角色默认页/请求隔离 |
| API | auth/catalog/campaign/order/payment/fulfillment/notification/ledger/audit | MySQL、Redis、微信 | 生产配置 fail-closed |
| MySQL 8.4 | 当前 InnoDB 单行聚合业务状态；退款/审计等同事务 | durable disk | 单行锁保证原子但限制吞吐 |
| Redis 7.4 | 团期 close job、lifecycle scheduling、周期调和租约 | Redis | 租约过期后其他实例可接管 |
| 微信 | 登录、JSAPI、支付退款回调、订阅消息 | 备案 HTTPS/商户凭据 | unknown/manual recovery |

## Security and permissions

- 微信消费者令牌和员工账号/会话分离；敏感路由后端执行角色、状态和点位范围校验。
- 员工权限变化撤销旧会话；列表/详情/动作保持相同数据范围。
- 手机号仅区域意向主动提供，后台默认脱敏；审计输出递归脱敏。
- 密钥、PEM、API v3 key、`deployment.local.ts` 和真实数据不得入库。
- 生产禁止 demo auth/mock payment，缺 HTTPS/取货码密钥/模板配置拒启动。

## Consistency, concurrency, side effects

- 事务边界：订单+库存+幂等；状态+退款义务；到货事实+草案；业务状态+outbox+审计。
- 支付/退款：事件和正文摘要去重；固定 provider number；持久化 claim token/lease；unknown 先查后重试。
- 核销：request id+payload hash；行数量条件更新；累计不超 fulfilled。
- 通知：事务内 outbox；调用提供方前消耗 at-most-once 提交预算；未知结果不自动重发。
- 账本：整数分，借贷平衡；领取确认收入，未领取退款冲合同负债，领取后品质退款冲收入。

## Current storage and capacity decision

- 当前基线 `community_product_state` 单行 JSON + `FOR UPDATE` 是首发正确性方案，不是横向扩展方案。
- Release guardrail：受控社区/团期规模；多个 API 副本虽能共享数据锁和调和租约，但不得据此宣称无限订单规模。
- 扩容触发：p95 写事务持续超过 200ms、锁等待/超时、状态 payload 明显增长或需要多 API 副本时，优先拆订单/订单行、支付退款、outbox/audit 为行级表和唯一索引。
- 回滚：当前无生产数据时只在新空库运行基线；不得对未知旧库原地覆盖。

## Scheduler/worker decision

- 当前 API 内运行团期、订单过期、领取窗口、退款和通知调和；单实例禁止重入，多个实例以 120 秒、每 30 秒续期的 Redis 租约竞争运行权。
- 每个调和步骤前复核租约 token；续租异常、返回失锁或最后成功时间超过 150 秒都会使 readiness 降级。单个已开始步骤仍以自身幂等/claim fence 收敛，不能把租约描述为数据库级 fencing。
- 服务重启或持有者退出后由租约过期恢复；健康端点提供 last-success/错误标志，不返回内部错误详情。
- 扩大规模前仍应拆独立 worker，并补齐队列深度、人工待办和集中告警；当前租约只降低重复运行风险，不解决单行数据锁吞吐，也不能替代真实 Redis 多副本验证。

## Observability and operations

- 结构化错误、审计、退款/通知状态和人工队列是当前运行证据。
- 发布前需补：数据库/Redis 健康、迁移幂等、备份恢复、队列深度、调和 last-success、退款人工挂起、通知人工任务告警。
- 禁止将单元/mock E2E 结果当作真实微信或 MySQL/Redis 预发布证据。

## Deployment, migration, compatibility, and rollback

1. 新空 MySQL 8.4 执行 `0001`，重复迁移幂等；Redis 健康。
2. 在安全环境注入生产 env/证书/模板/取货码密钥，bootstrap 首个超管。
3. 单 API 副本 + admin + HTTPS 网关；健康检查通过。
4. 真实登录、小额支付、取消/全额退款、多商品部分退款、消息模板和回调验收。
5. 失败回滚应用镜像；如无生产订单可回新空库；一旦存在真实订单不得丢弃/回退业务数据。

## Decisions

| ID | Topic | Decision | Status |
|---|---|---|---|
| ADR-001 | 单业务模式 | 只保留社区固定点位集中自提 | APPROVED |
| ADR-002 | 首发存储 | 单行聚合仅用于受控单副本首发；扩容前行级拆分 | APPROVED_WITH_GUARDRAIL |
| ADR-003 | 外部副作用 | fixed id + lease/fence + unknown/manual recovery | APPROVED |
| ADR-004 | 通知模板 | 四个已审模板映射七个语义事件；单次最多请求三个唯一模板 | APPROVED_PENDING_EXTERNAL_TEMPLATE_REVIEW |
