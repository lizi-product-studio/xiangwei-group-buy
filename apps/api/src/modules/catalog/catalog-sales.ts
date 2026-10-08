import type { CommerceStore } from "../core/store.js";
import type { Order, OrderRefund } from "../core/types.js";

export type NetSalesSnapshot = {
  quantities: Map<string, number>;
  fullyRefundedOrderIds: ReadonlySet<string>;
};

export function calculateNetSalesFromOrders(
  orders: Order[],
  fullyRefundedOrderIds: ReadonlySet<string>,
): Map<string, number> {
  const sales = new Map<string, number>();
  for (const order of orders) {
    if (!order.paidAt || ["PENDING_PAYMENT", "CANCELLED"].includes(order.status)) continue;
    const fullyRefunded = order.status === "REFUNDED" || fullyRefundedOrderIds.has(order.id);
    for (const item of order.items) {
      const quantity = fullyRefunded ? 0 : Math.max(0, item.quantity - item.refundedQuantity);
      if (quantity) sales.set(item.skuId, (sales.get(item.skuId) ?? 0) + quantity);
    }
  }
  return sales;
}

export async function calculateNetSalesSnapshot(
  store: CommerceStore,
  orders?: Awaited<ReturnType<CommerceStore["listOrders"]>>,
): Promise<NetSalesSnapshot> {
  if (!orders) {
    return {
      quantities: await store.getNetSalesQuantities(),
      fullyRefundedOrderIds: new Set(),
    };
  }
  const values = orders ?? await store.listOrders(Number.MAX_SAFE_INTEGER);
  const refunds = await store.listOrderRefunds(Number.MAX_SAFE_INTEGER);
  const fullyRefundedOrderIds = new Set(
    refunds.filter((refund: OrderRefund) => refund.status === "SUCCEEDED").map((refund) => refund.orderId),
  );
  for (const order of values) if (order.status === "REFUNDED") fullyRefundedOrderIds.add(order.id);
  return {
    quantities: calculateNetSalesFromOrders(values, fullyRefundedOrderIds),
    fullyRefundedOrderIds,
  };
}

/**
 * Computes the cross-campaign paid quantity without mutating historical order
 * snapshots. Full refunds zero the order; partial refunds use the persisted
 * order-line refundedQuantity fact.
 */
export async function calculateNetSalesQuantities(
  store: CommerceStore,
  orders?: Awaited<ReturnType<CommerceStore["listOrders"]>>,
): Promise<Map<string, number>> {
  return (await calculateNetSalesSnapshot(store, orders)).quantities;
}
