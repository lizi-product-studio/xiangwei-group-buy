---
title: "社区团购 — Product Requirements"
status: APPROVED
version: 1.2.0
last_updated: "2026-08-31"
owner: requirements
source_of_truth: project-document-set
---

# Product requirements document

## Goal and scope

- Product outcome: 在真实区域与固定自提点内完成参团、支付、成团、集中配送、到货、分次核销、退款和售后闭环。
- Acceptance authority: 用户；真实微信与生产发布另行授权。
- In scope / out of scope / must preserve: `00-project-context.md#scope`。

## Requirements

| Requirement ID | Priority | Role/object | Requirement | Business value | Rule refs | Feature refs | Acceptance refs | Fact state |
|---|---|---|---|---|---|---|---|---|
| REQ-001 | P0 | USER/区域点位 | 只展示拥有真实启用点位的可下单区域；未覆盖地区仅登记意向 | 不制造虚假履约承诺 | DR-001/002 | FEAT-DISCOVERY | AC-AREA-01 | CONFIRMED |
| REQ-002 | P0 | USER/订单库存 | 下单固定团期与点位，库存和幂等同事务收敛 | 防超卖和重复订单 | DR-003/005 | FEAT-ORDER | AC-ORDER-01 | CONFIRMED |
| REQ-003 | P0 | USER/支付 | 生产仅真实微信登录与 JSAPI 支付；回调验签、金额和重复事件 fail-closed | 保证收款可信 | DR-005/010 | FEAT-ORDER | AC-PAY-01 | CONFIRMED |
| REQ-004 | P0 | 团期 | 截单成团；未成团最多顺延一次，再次失败自动取消并产生退款义务 | 限制资金占用 | DR-004/014 | FEAT-CAMPAIGN | AC-CAMPAIGN-01 | CONFIRMED |
| REQ-005 | P0 | OPERATOR/配送 | 运输登记、发车、异常纠正和责任提示可审计 | 建立配送事实 | DR-006 | FEAT-LOGISTICS | AC-LOGISTICS-01 | CONFIRMED |
| REQ-006 | P0 | PICKUP_MANAGER/到货 | 仅授权点位可确认；OPERATOR 禁止；超管紧急代办必须有原因 | 防跨点和越权签收 | DR-006 | FEAT-LOGISTICS | AC-ARRIVAL-01 | CONFIRMED |
| REQ-007 | P0 | 差异 | 草案可复算，运营确认前不得核销受影响量或退款 | 公平处理短少破损 | DR-007 | FEAT-LOGISTICS | AC-ALLOCATION-01 | CONFIRMED |
| REQ-008 | P0 | 核销 | 本点六码核销，支持分次、并发和请求幂等；截止时刻禁止普通核销 | 准确交付商品 | DR-008 | FEAT-PICKUP | AC-PICKUP-01 | CONFIRMED |
| REQ-009 | P0 | 售后 | 按领取凭证逐商品 24 小时；一次案件可包含多个商品问题行 | 降低消费者申诉成本 | DR-009 | FEAT-AFTERSALE | AC-CASE-01 | CONFIRMED |
| REQ-010 | P0 | 退款/财务 | 已批准退款才可执行；固定退款号、租约、未知提交、重试和人工挂起一次落账 | 防重复退款和错账 | DR-010/011 | FEAT-REFUND | AC-REFUND-01 | CONFIRMED |
| REQ-011 | P0 | 通知/客服 | 事件、用户授权和模板语义一致；失败人工处理必须记录渠道、外部引用与结果 | 关键履约变化可追踪 | DR-012 | FEAT-NOTIFY | AC-NOTIFY-01 | CONFIRMED |
| REQ-012 | P1 | USER/隐私 | 用户可查看自己的区域意向，并提交更正/撤回；保留例外须说明并审计 | 落实最小数据权利 | DR-013 | FEAT-PRIVACY | AC-PRIVACY-01 | CONFIRMED |
| REQ-013 | P0 | 员工权限 | 状态、角色或点位变化使旧会话立即失效；后端每次敏感操作复验 | 限制内部越权 | DR-015 | FEAT-ADMIN-AUTH | AC-AUTH-01 | CONFIRMED |
| REQ-014 | P0 | 生产 | 空库不写演示数据；MySQL/Redis/HTTPS/真实微信配置缺失时拒启动 | 防 mock/伪数据进入生产 | DR-016 | FEAT-DEPLOY | AC-DEPLOY-01 | CONFIRMED |
| REQ-015 | P1 | OPERATOR/SUPER_ADMIN/自提点定位 | 新建按“服务区域→地址/POI→地图确认/微调→保存”完成。仅校验坐标逆编码的行政目录节点与服务区域节点的路径相容；地址、地图或浏览器字段不得自行改行政归属。它不证明实际配送几何边界、门牌或可达性 | 降低行政归属冲突和跨行政路径配置风险；不夸大为地点正确性证明 | DR-017–019 | FEAT-PICKUP-LOCATION | AC-PICKUP-LOC-01–05/08 | CONFIRMED（单一行政链方向）；单节点语义为 DEFAULT_ASSUMPTION |
| REQ-016 | P1 | OPERATOR/SUPER_ADMIN/既有点位 | 无持久核验状态；只在新建、地址/坐标变更或 INACTIVE→ACTIVE 当场核验。其他编辑原样保留。疑似重复提示可明确覆写，不自动合并或删除 | 不以提供方不可用或不可证明的历史状态破坏既有履约事实，同时减少重复配置 | DR-019/020 | FEAT-PICKUP-LOCATION | AC-PICKUP-LOC-06/07 | CONFIRMED（无状态触发方向）；50 米阈值为 DEFAULT_ASSUMPTION |

## Non-functional requirements

| ID | Category | Requirement | Threshold / evidence | Fact state |
|---|---|---|---|---|
| NFR-001 | Correctness | 金额使用整数分；借贷平衡；库存/退款/核销不可重复 | 单元+集成+预发布 | CONFIRMED |
| NFR-002 | Security | 后端鉴权、最小数据范围、敏感操作审计、密钥不入库 | 角色正反例+secret scan | CONFIRMED |
| NFR-003 | Recovery | 外部退款与通知不以自动重试制造重复副作用 | 故障注入+人工队列 | CONFIRMED |
| NFR-004 | Availability | 首发单 API 副本；调度失败可见；扩容前完成 worker 所有权设计 | 部署校验+运行手册 | EVIDENCE_INFERRED |
| NFR-005 | Capacity | 首发受控规模；单 JSON 存储在性能基线超阈值前不得扩容承诺 | 集成压测记录 | EVIDENCE_INFERRED |
| NFR-006 | Accessibility | 关键任务具可访问名称、状态、足够触控目标和清晰错误恢复 | 静态检查+真机走查 | CONFIRMED |

## Dependencies and release risks

| ID | Dependency/risk | Mitigation | Status |
|---|---|---|---|
| RISK-001 | 微信 AppID/商户/证书/模板/备案域名 | 真实预发布逐项验收，密钥不入库 | BLOCKING_EXTERNAL |
| RISK-002 | 客服外部合规联系渠道未知 | 发布前确定渠道并要求外部引用 | BLOCKING_UNKNOWN |
| RISK-003 | 单行聚合存储全局锁 | 首发单副本受控规模；采集性能基线；2.0 行级拆分 | OPEN_GUARDRAIL |
| RISK-004 | 多实例周期 worker | 首发副本数固定 1；扩容前独立 worker/租约/告警 | OPEN_GUARDRAIL |
| RISK-005 | 用户注销与法定留存规则未批准 | 不宣称自助注销；保留人工数据权利请求 | BLOCKING_FOR_ACCOUNT_DELETION_ONLY |
| RISK-006 | 生产地点提供方 Key 与乡镇覆盖质量尚无证据 | 本轮仅冻结可恢复、安全拒绝的本地契约；真实预发布抽样验证后再作为发布证据 | BLOCKING_EXTERNAL（不阻塞需求冻结） |
| RISK-007 | 行政目录相容不等于实际业务配送几何边界或具体门牌正确 | 本轮只使用行政路径措辞；若 ServiceArea 不是单一目录节点，停止实现并另行决策 | BLOCKING_UNKNOWN |
