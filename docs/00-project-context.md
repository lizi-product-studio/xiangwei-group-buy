---
title: "社区团购 — Project Context"
status: APPROVED
version: 1.0.0
last_updated: "2026-08-31"
owner: requirements
source_of_truth: project-document-set
---

# Project context

## One-sentence goal

- Value: 为尚未被稳定零售配送覆盖的社区提供按真实区域和固定自提点组织的地方农产品、常温熟食集中拼团服务。
- Fact state: CONFIRMED
- Source/decision: 用户项目说明、`README.md`、`docs/PRD.md`。

## Core problem and product thesis

- Who experiences it: 希望购买地方农产品和常温熟食、可接受集中到货与社区自提的消费者，以及负责团期、配送、点位和退款的运营人员。
- Current workaround/cost: 分散登记、人工统计、人工通知和线下核销难以稳定处理库存、资金、点位范围、差异和售后证据。
- Why now: 当前仓库已经形成消费者小程序、运营后台和 API 主链，需要以受控上线门禁验证真实微信与单社区运营闭环。
- Observable evidence: 仓库已有下单、支付、团期、配送、核销、退款、售后、通知与审计实现；商业需求频率和付费意愿尚无生产数据，属于上线后验证项。
- Strongest alternative: 继续使用微信群、表格和人工收款；它适合极小规模，但缺少资金幂等、权限隔离、审计和异常恢复。
- Smallest valuable test: 一个真实服务区域、至少一个真实启用点位、少量真实商品和一个团期的受控预发布/试运营。
- Falsifier: 真实试运营无法达到可接受的成团率，或退款、履约、人工处理成本持续高于订单价值时停止扩张并复盘。
- Fact state: EVIDENCE_INFERRED（产品价值仍需真实试运营验证）。

## Business model and value exchange

- Customer/user/payer: 消费者为付款人；运营、客服、财务、点位负责人共同履约；平台统一采购、销售和履约。
- Value model: 通过集中采购、集中配送和固定点位自提降低长尾农产品的单笔履约成本。
- Constraint: 常温商品、按团期集中送达、固定点位自提；不承诺即时配送、送货上门或全国无条件覆盖。
- Fact state: EVIDENCE_INFERRED，来源 `README.md`、现有表与界面。

## Roles

| Role ID | Goal | Data scope | Fact state | Source |
|---|---|---|---|---|
| USER | 选区域/点位、参团支付、查看履约、领取、售后 | 自己的订单、消息、意向 | CONFIRMED | `docs/PRD.md` |
| PICKUP_MANAGER | 确认本点到货并核销 | 被授权点位 | CONFIRMED | `docs/PRD.md` |
| OPERATOR | 配置并执行团期和履约 | 全局运营对象 | CONFIRMED | `docs/PRD.md` |
| CUSTOMER_SERVICE | 受理售后和人工通知任务 | 客服待办所需订单/案件 | CONFIRMED | `docs/PRD.md` |
| FINANCE | 执行已批准退款、查账 | 退款义务和账本 | CONFIRMED | `docs/PRD.md` |
| SUPER_ADMIN | 员工、权限、审计与紧急代办 | 全局；敏感操作必须审计 | CONFIRMED | `docs/PRD.md` |

## Core objects and flows

| Object | Definition / lifecycle |
|---|---|
| 服务区域/自提点 | 只有启用、允许下单且关联真实启用点位的区域可公开；点位是团期履约边界 |
| 商品/SKU | 可售商品与价格、库存输入；不代表点位容量承诺 |
| 团期 | `DRAFT → SCHEDULED/OPEN → CLOSING → LOCKED → FULFILLING → COMPLETED`，可取消；顺延规则见 DR-014 |
| 订单/订单行 | 创建、支付、锁定、运输、领取、完成或退款；订单绑定下单时点位快照 |
| 配送/到货差异 | 运营登记运输；点位负责人确认事实；运营确认确定性差异草案 |
| 领取凭证 | 六码核销，支持分次领取和请求幂等 |
| 退款义务/账本 | 状态转换与唯一义务同事务；财务执行；回调一次落账 |
| 售后案件 | 按领取凭证逐商品计算 24 小时边界，客服受理、运营裁决、财务退款 |
| 通知/outbox | 事务内事件，微信订阅消息失败后进入可审计人工处理 |

## Scope

### Must preserve

- 单一社区团购业务；真实区域和固定点位；资金、库存、权限和审计一致性；微信生产链路 fail-closed。

### In scope

- 运营后台、API、消费者微信小程序；登录、商品/区域/点位/团期、订单库存、支付退款、配送到货、核销、售后、通知、客服/财务/审计。

### Out of scope

- 多商家撮合、多仓多温层、送货上门、即时配送、会员积分、复杂点位预约排班、自动生成演示区域/点位/订单。

## Technical and release constraints

- Node 22+、pnpm 11+；生产 MySQL 8.4、Redis 7.4、HTTPS、真实微信登录与 JSAPI 支付。
- 生产密钥不入库；未知旧库不原地覆盖；真实微信预发布和生产部署需要单独授权。
- 当前 MySQL 单行聚合模型仅允许首发单 API 副本和受控规模；扩容前必须完成行级拆分和 worker 所有权设计。

## Success and acceptance

| Metric | Target | Evidence | Fact state |
|---|---|---|---|
| 本地质量门禁 | `pnpm check`、`pnpm test:e2e` 全通过 | CI/本地日志 | CONFIRMED |
| 资金正确性 | 重复回调/重试不重复扣库存、退款或记账 | 单元、集成、预发布 | CONFIRMED |
| 权限隔离 | 五个内部角色正反例和跨点位拒绝通过 | API/E2E/预发布 | CONFIRMED |
| 外部链路 | 真实登录、支付、全额/部分退款、订阅消息、HTTPS 回调通过 | 脱敏预发布记录 | CONFIRMED |
| 商业结果 | 成团率、退款时长、差异率和人工处理时长在试运营后设基线 | 运营数据 | BLOCKING_UNKNOWN（不阻塞代码完成，阻塞规模扩张） |

- Acceptance authority: 用户；外部微信/生产操作另行授权。
- Complexity: Complex；跨三端、资金、权限、状态、外部副作用和迁移。
- Quota mode: balanced；独立 QA 必需。

## Fact register and open questions

| ID | Statement | State | Evidence | Impact / trigger |
|---|---|---|---|---|
| FACT-001 | 产品只做单一社区集中自提模式 | CONFIRMED | 用户说明、README/PRD | 禁止扩展第二业务模型 |
| FACT-002 | 真实微信预发布尚无本轮证据 | CONFIRMED | `docs/go-live-checklist.md` | 阻塞 RELEASE_READY |
| FACT-003 | 旧“当前无必须保留的生产数据”已被迁移后事实替代；现有生产业务与用户操作必须保留 | CONFIRMED | `AGENTS.md` 3.1、`docs/task-20260907-wechat-phone.md` 部署与真实授权进展 | 不得据早期空库结论清库或恢复覆盖当前数据；回归测试使用隔离模拟环境 |
| FACT-004 | 客服使用哪条外部合规联系渠道 | BLOCKING_UNKNOWN | 无批准渠道/CRM 契约 | 阻塞“人工已联系”发布声明 |
| FACT-005 | 商业成团率与规模阈值 | BLOCKING_UNKNOWN | 无生产数据 | 受控试运营后决定是否扩张 |
