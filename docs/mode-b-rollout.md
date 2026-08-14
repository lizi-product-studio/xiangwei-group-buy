# 模式 B 发布、迁移校验与回滚

## 范围与隔离

`0026_platform_procurement_domain.sql` 之后的变更全部是新增式迁移：不更新、不删除或转换既有 `orders`、`merchant_orders`、`refunds`、`settlements`、支付回调、分账记录和账务流水。

- 历史订单固定为 `business_model_version=LEGACY_MARKETPLACE`、`payment_route=LEGACY_COMBINE`，继续走合单支付、子商户退款和分账恢复任务。
- 新平台订单固定为 `business_model_version=PLATFORM_PROCUREMENT`、`payment_route=PLATFORM_DIRECT`，只写 `sales_order_items`、`platform_refunds` 和采购/仓储表，不创建 `merchant_orders` 或 `settlements`。
- 新旧的支付回调、退款和定时结算按版本与支付路由过滤，不能通过旧 `provider_context` 猜测。

## 执行顺序

1. 备份数据库，留存迁移前订单、支付、退款、结算和账务汇总。
2. 部署包含 0026 的版本，执行 `pnpm db:migrate`。迁移器持有全局 MySQL 锁，避免并发实例重复迁移。
3. 保持 `PLATFORM_PROCUREMENT_ENABLED=false`，先完成下方只读核对和预发演练。
4. 配置已启用中心仓、审核通过的供应商、采购价完整的供货关系及期初批次库存。
5. 配好平台直连微信支付主体/回调域名后，才可在单一灰度区域开启模式 B。

采购价、有效供货关系、中心仓或期初库存任一缺失时，服务端禁止创建模式 B 团期。

## 上线前只读校验

保存以下结果形成迁移报告；查询不得写入或修复历史数据。

```sql
SELECT business_model_version, status, COUNT(*) AS orders,
       COALESCE(SUM(total_cents),0) AS gross_cents
FROM orders GROUP BY business_model_version, status;

SELECT o.payment_route, p.status, COUNT(*) AS payments,
       COALESCE(SUM(p.amount_cents),0) AS amount_cents
FROM payments p JOIN orders o ON o.id=p.order_id
GROUP BY o.payment_route, p.status;

SELECT o.payment_route, r.status, COUNT(*) AS refunds,
       COALESCE(SUM(r.amount_cents),0) AS amount_cents
FROM refunds r JOIN orders o ON o.id=r.order_id
GROUP BY o.payment_route, r.status
UNION ALL
SELECT o.payment_route, pr.status, COUNT(*), COALESCE(SUM(pr.amount_cents),0)
FROM platform_refunds pr JOIN orders o ON o.id=pr.order_id
GROUP BY o.payment_route, pr.status;

SELECT COUNT(*) AS invalid_mode_b_settlements
FROM settlements s JOIN orders o ON o.id=s.order_id
WHERE o.business_model_version='PLATFORM_PROCUREMENT';

SELECT status, COUNT(*) AS pending_legacy_settlements
FROM settlements GROUP BY status;

SELECT l.id, l.lot_no, l.qualified_quantity,
       COALESCE(SUM(CASE WHEN m.to_bucket='QUALIFIED' THEN m.quantity ELSE 0 END)
              - SUM(CASE WHEN m.from_bucket='QUALIFIED' THEN m.quantity ELSE 0 END),0) AS qualified_balance
FROM inventory_lots l LEFT JOIN inventory_movements m ON m.inventory_lot_id=l.id
GROUP BY l.id, l.lot_no, l.qualified_quantity
HAVING qualified_balance < 0;
```

供应商应付只能是 `qualified_quantity × purchase_unit_cents`；不得由零售价、消费者退款或佣金反推。

## 回滚

灰度异常时，只关闭 `PLATFORM_PROCUREMENT_ENABLED` 并把默认版本改回 `LEGACY_MARKETPLACE`。这会停止新的模式 B 团期/订单，但绝不回写、删除或转换已经创建的模式 B 记录。

仍存在模式 B 待支付、退款中、库存、在途或待领取记录时，必须保留可识别 0026 表和字段的服务版本完成其回调、退款和履约恢复。物理删除表或历史数据是独立的人工审批任务，本次不做。

## 预发演练

1. 平台直连支付、重复点击、重复回调与平台原路退款。
2. 锁单后按供应商生成采购单，验收后生成批次、库存流水和供应商应付。
3. 未验收不能分拣；未分拣不能出库；未交接不能取码；交接后才可核销。
4. 同时演练一笔历史合单支付/退款/分账，确认不会读取模式 B 采购、应付或库存数据。
