import type { CommerceStore } from '../core/store.js';
import type { DeliveryPlan, Order } from '../core/types.js';

function groupByOrder<T extends { orderId: string }>(values: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) grouped.set(value.orderId, [...(grouped.get(value.orderId) ?? []), value]);
  return grouped;
}

function publicDeliveryPlan(plan: DeliveryPlan | undefined) {
  if (!plan) return null;
  return { id: plan.id, campaignId: plan.campaignId, serviceAreaId: plan.serviceAreaId, pickupPointId: plan.pickupPointId, status: plan.status, siteName: plan.siteName, address: plan.address, arrivalStartAt: plan.arrivalStartAt, arrivalEndAt: plan.arrivalEndAt, estimatedArrivalAt: plan.estimatedArrivalAt ?? null };
}

/** Assembles consumer/admin order views from a bounded set of batched facts. */
export async function buildOrderDeliveryViews(store: CommerceStore, orders: Order[]) {
  const facts = await store.listOrderDeliveryFacts(orders.map((order) => order.id));
  const plans = new Map(facts.deliveryPlans.map((value) => [value.id, value]));
  const afterSales = groupByOrder(facts.afterSales);
  const refunds = groupByOrder(facts.partialRefunds);
  const qualityCases = groupByOrder(facts.qualityCases);
  const allocations = groupByOrder(facts.allocations);
  const exceptions = new Map(facts.exceptions.map((value) => [value.id, value]));
  const cancellations = new Map(facts.cancellations.map((value) => [value.orderId, value]));
  const pickupWindows = new Map(facts.pickupWindows.map((value) => [value.orderId, value]));

  return orders.map((order) => {
    const { merchantOrders: _merchantOrders, commissionCents: _commissionCents, items, ...consumerOrder } = order;
    void _merchantOrders;
    void _commissionCents;
    const orderRefunds = refunds.get(order.id) ?? [];
    const refundsByException = new Map(orderRefunds.map((refund) => [refund.exceptionId, refund]));
    const exceptionRows = new Map<string, typeof facts.allocations>();
    for (const allocation of allocations.get(order.id) ?? []) exceptionRows.set(allocation.exceptionId, [...(exceptionRows.get(allocation.exceptionId) ?? []), allocation]);
    const cancellation = cancellations.get(order.id);
    return {
      ...consumerOrder,
      items: items.map((item) => {
        const itemAllocations = (allocations.get(order.id) ?? []).filter((allocation) => allocation.salesOrderItemId === item.salesOrderItemId);
        const active = itemAllocations.find((allocation) => allocation.exceptionQuantity > 0);
        const pendingRefund = active ? refundsByException.get(active.exceptionId) : undefined;
        const refundableQuantity = Math.max(0, item.exceptionQuantity - item.refundedQuantity);
        return { skuId: item.skuId, productId: item.productId, name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents, amountCents: item.amountCents, fulfilledQuantity: item.fulfilledQuantity, pickedUpQuantity: item.pickedUpQuantity, remainingPickupQuantity: Math.max(0, item.fulfilledQuantity - item.pickedUpQuantity), exceptionQuantity: item.exceptionQuantity, refundedQuantity: item.refundedQuantity, refundedAmountCents: item.refundedAmountCents, refundStatus: item.refundedQuantity > 0 ? 'SUCCEEDED' : pendingRefund?.status ?? (active && exceptions.get(active.exceptionId)?.status === 'REFUND_CONFIRMED' ? 'PENDING' : null), refundAmountCents: refundableQuantity > 0 ? Number(item.unitPriceCents) * refundableQuantity : Number(item.refundedAmountCents) };
      }),
      deliveryPlan: publicDeliveryPlan(plans.get(order.deliveryPlanId)),
      afterSales: afterSales.get(order.id) ?? [],
      communityQualityCases: qualityCases.get(order.id) ?? [],
      pickupWindow: pickupWindows.get(order.id) ?? null,
      cancellation: cancellation ? { status: cancellation.status, reason: cancellation.reason, reviewNote: cancellation.reviewNote, requestedAt: cancellation.requestedAt, refundId: cancellation.refundId } : null,
      fulfillmentExceptions: [...exceptionRows.entries()].flatMap(([exceptionId, rows]) => {
        const exception = exceptions.get(exceptionId);
        if (!exception) return [];
        return [{ id: exception.id, status: exception.status, sourceStage: exception.sourceStage, responsibility: exception.responsibility, resolutionNote: exception.resolutionNote, items: rows.map((allocation) => ({ platformSkuId: allocation.platformSkuId, fulfilledQuantity: allocation.fulfilledQuantity, exceptionQuantity: allocation.exceptionQuantity, refundedQuantity: allocation.refundedQuantity, reason: exception.items.find((item) => item.id === allocation.exceptionItemId)?.reason ?? null })) }];
      }),
      partialRefunds: orderRefunds.map((refund) => ({ id: refund.id, exceptionId: refund.exceptionId, status: refund.status, amountCents: refund.amountCents })),
    };
  });
}
