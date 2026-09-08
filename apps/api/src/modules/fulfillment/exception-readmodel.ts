import type { CommerceStore } from "../core/store.js";
import type { FulfillmentException } from "../core/types.js";

/** Resolve financial facts by immutable references, never by a recent-order window. */
export async function exceptionReadModel(store: CommerceStore, exception: FulfillmentException) {
  const allocations = await store.listFulfillmentAllocations(exception.id);
  const ids = [...new Set([...(exception.orderId ? [exception.orderId] : []), ...allocations.map(value => value.orderId)])];
  const orders = await Promise.all(ids.map(id => store.getOrder(id)));
  const byId = new Map(orders.filter(value => value !== null).map(value => [value.id, value]));
  let reason: string | null = ids.length && orders.every(Boolean) ? null : "关联订单快照缺失，请联系管理员核查，暂不可执行退款";
  if (exception.status === "REFUND_CONFIRMED" && !allocations.length) reason = "退款分配事实缺失，暂不可执行退款";
  const items = exception.items.map(item => {
    const matches = allocations.filter(value => value.exceptionItemId === item.id);
    const parts = matches.map(allocation => ({
      line: byId.get(allocation.orderId)?.items.find(line => line.orderLineId === allocation.orderLineId && line.skuId === allocation.catalogSkuId),
      quantity: allocation.exceptionQuantity,
    }));
    // Draft/legacy order-scoped exceptions may precede allocation confirmation.
    if (!parts.length && exception.orderId) parts.push({
      line: byId.get(exception.orderId)?.items.find(line => line.skuId === item.catalogSkuId),
      quantity: Math.max(0, item.expectedQuantity - item.acceptedQuantity),
    });
    const valid = parts.length > 0 && parts.every(value => value.line && Number.isSafeInteger(Number(value.line.unitPriceCents)) && Number(value.line.unitPriceCents) > 0 && Number.isSafeInteger(value.quantity) && value.quantity >= 0);
    if (!valid) reason = "关联订单行或价格快照缺失，请联系管理员核查，暂不可执行退款";
    const prices = [...new Set(parts.map(value => value.line && Number(value.line.unitPriceCents)))];
    return {...item,
      name: [...new Set(parts.map(value => value.line?.name).filter(Boolean))].join("、") || "商品快照缺失",
      affectedQuantity: parts.reduce((sum, value) => sum + value.quantity, 0),
      unitPriceCents: valid && prices.length === 1 ? prices[0]! : null,
      amountCents: valid ? parts.reduce((sum, value) => sum + Number(value.line!.unitPriceCents) * value.quantity, 0) : null,
    };
  });
  const amount = items.reduce((sum, item) => sum + (item.amountCents ?? 0), 0);
  if (!Number.isSafeInteger(amount)) reason = "退款金额超出有效范围，请联系管理员核查";
  const first = orders.find(value => value !== null);
  const point = first ? (await store.listPickupPoints()).find(point => point.id === first.pickupPointId) : null;
  return {...exception, orderNo: orders.filter(value => value !== null).map(value => value.orderNo).join("、") || null,
    relatedOrderIds: ids, pickupPointId: first?.pickupPointId ?? null, pickupPointName: point?.name ?? null,
    refundAmountCents: reason ? null : amount, financialFactsError: reason, items};
}
