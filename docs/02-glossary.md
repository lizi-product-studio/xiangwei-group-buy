---
title: "社区团购 — Glossary"
status: APPROVED
version: 1.0.0
last_updated: "2026-08-31"
owner: requirements
source_of_truth: project-document-set
---

# Glossary

| Term | Canonical definition | Not to be confused with | Rule | Fact state |
|---|---|---|---|---|
| 服务区域 | 运营配置的可服务范围；只有满足公开条件才向消费者展示 | 自动生成的“全国覆盖” | DR-001 | CONFIRMED |
| 自提点 | 真实存在、启用并承担集中领取的地点 | 配送地址/虚拟默认点位 | DR-002 | CONFIRMED |
| 团期 | 绑定固定自提点、销售窗口和履约窗口的拼团批次 | 商品活动页 | DR-003 | CONFIRMED |
| 成团 | 截单时满足规则并锁定进入履约 | 支付成功 | DR-004 | CONFIRMED |
| 顺延 | 团期未成团后仅允许的一次重新开售机会 | 无限延期 | DR-014 | CONFIRMED |
| 到货确认 | 点位负责人逐商品提交实际正常、短少、破损事实 | 运营发车/用户领取 | DR-006 | CONFIRMED |
| 差异草案 | 按支付时间、订单号确定性计算的短少分配建议 | 已生效退款决定 | DR-007 | CONFIRMED |
| 分次核销 | 同一订单在领取窗口内可分多次领取，累计不超可领量 | 重复核销 | DR-008 | CONFIRMED |
| 退款义务 | 已批准且必须向支付机构执行的唯一、可恢复退款记录 | 临时内存任务 | DR-010 | CONFIRMED |
| SUBMISSION_UNKNOWN | 外部退款可能已提交但结果未知，不得以新退款号盲重试 | 普通失败/成功 | DR-010 | CONFIRMED |
| 品质售后 | 以某次领取凭证为起点、逐商品计算 24 小时的申诉 | 未领取商品取消 | DR-009 | CONFIRMED |
| 人工通知任务 | 微信订阅消息无法可靠送达后生成的客服待办 | 已证明联系成功 | DR-012 | CONFIRMED |
