import type { CommerceStore } from "../core/store.js";
import type { FulfillmentException, Order, OrderRefund } from "../core/types.js";

export type RefundFacts = {
  refundAmountCents: number | null;
  financialFactsError: string | null;
  refundAmountKind: "PENDING" | "RECORDED" | null;
  refundStatus: string | null;
};

const unavailable = (message: string): RefundFacts => ({
  refundAmountCents: null,
  financialFactsError: message,
  refundAmountKind: null,
  refundStatus: null,
});

/** Read-only facts; this helper never changes the amount sent to a provider. */
export async function exceptionRefundFacts(
  store: CommerceStore,
  exception: FulfillmentException,
): Promise<RefundFacts> {
  const recorded = await store.listPartialRefundsByException(exception.id);
  if (recorded.length) {
    const amounts = recorded.map((value) => Number(value.amountCents));
    if (amounts.some((value) => !Number.isSafeInteger(value) || value < 0))
      return unavailable("退款事实金额无效，请联系管理员核查，暂不可执行退款");
    const amount = amounts.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(amount) || amount <= 0)
      return unavailable("退款金额超出有效范围，请联系管理员核查，暂不可执行退款");
    return {
      refundAmountCents: amount,
      financialFactsError: null,
      refundAmountKind: "RECORDED",
      refundStatus: recorded.every((value) => value.status === "SUCCEEDED")
        ? "SUCCEEDED"
        : recorded.find((value) => value.status !== "SUCCEEDED")?.status ?? null,
    };
  }
  const allocations = await store.listFulfillmentAllocations(exception.id);
  if (!allocations.length)
    return unavailable("退款分配事实缺失，请联系管理员核查，暂不可执行退款");
  const orders = await Promise.all(
    [...new Set(allocations.map((value) => value.orderId))].map((id) => store.getOrder(id)),
  );
  const byId = new Map(orders.filter((value): value is Order => value !== null).map((value) => [value.id, value]));
  let amount = 0;
  for (const allocation of allocations) {
    const line = byId.get(allocation.orderId)?.items.find((value) => value.orderLineId === allocation.orderLineId);
    const remaining = allocation.exceptionQuantity - allocation.refundedQuantity;
    const unitPrice = Number(line?.unitPriceCents);
    if (!line || !Number.isSafeInteger(unitPrice) || unitPrice <= 0 || !Number.isSafeInteger(remaining) || remaining < 0)
      return unavailable("关联订单行或价格快照缺失，请联系管理员核查，暂不可执行退款");
    amount += unitPrice * remaining;
  }
  if (!Number.isSafeInteger(amount))
    return unavailable("退款金额超出有效范围，请联系管理员核查，暂不可执行退款");
  if (amount <= 0)
    return unavailable("没有可执行的剩余退款金额，请联系管理员核查");
  return {refundAmountCents: amount, financialFactsError: null, refundAmountKind: "PENDING", refundStatus: null};
}

export function orderRefundFacts(order: Order | null, refund: OrderRefund | null): RefundFacts {
  if (refund) {
    const amount = Number(refund.amountCents);
    if (!Number.isSafeInteger(amount) || amount < 0)
      return unavailable("退款事实金额无效，请联系管理员核查，暂不可执行退款");
    return {refundAmountCents: amount, financialFactsError: null, refundAmountKind: "RECORDED", refundStatus: refund.status};
  }
  const amount = Number(order?.totalCents);
  if (!order || !Number.isSafeInteger(amount) || amount <= 0)
    return unavailable("关联订单金额快照缺失，请联系管理员核查，暂不可执行退款");
  return {refundAmountCents: amount, financialFactsError: null, refundAmountKind: "PENDING", refundStatus: null};
}
