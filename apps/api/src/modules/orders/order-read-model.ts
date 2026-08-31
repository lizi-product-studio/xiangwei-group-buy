import type { CommerceStore } from "../core/store.js";
import type { DeliveryPlan, Order } from "../core/types.js";

function groupByOrder<T extends { orderId: string }>(
  values: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values)
    grouped.set(value.orderId, [...(grouped.get(value.orderId) ?? []), value]);
  return grouped;
}

function publicDeliveryPlan(plan: DeliveryPlan | undefined) {
  if (!plan) return null;
  return {
    id: plan.id,
    campaignId: plan.campaignId,
    serviceAreaId: plan.serviceAreaId,
    pickupPointId: plan.pickupPointId,
    status: plan.status,
    siteName: plan.siteName,
    address: plan.address,
    arrivalStartAt: plan.arrivalStartAt,
    arrivalEndAt: plan.arrivalEndAt,
    estimatedArrivalAt: plan.estimatedArrivalAt ?? null,
  };
}

/** Assembles consumer/admin order views from a bounded set of batched facts. */
export async function buildOrderDeliveryViews(
  store: CommerceStore,
  orders: Order[],
) {
  const facts = await store.listOrderDeliveryFacts(
    orders.map((order) => order.id),
  );
  const plans = new Map(facts.deliveryPlans.map((value) => [value.id, value]));
  const refunds = groupByOrder(facts.partialRefunds);
  const qualityCases = groupByOrder(facts.qualityCases);
  const pickupReceipts = groupByOrder(facts.pickupReceipts);
  const allocations = groupByOrder(facts.allocations);
  const exceptions = new Map(
    facts.exceptions.map((value) => [value.id, value]),
  );
  const cancellations = new Map(
    facts.cancellations.map((value) => [value.orderId, value]),
  );
  const pickupWindows = new Map(
    facts.pickupWindows.map((value) => [value.orderId, value]),
  );

  const now = Date.parse(await store.databaseNow());
  return orders.map((order) => {
    const { items, ...consumerOrder } = order;
    const orderRefunds = refunds.get(order.id) ?? [];
    const refundsByException = new Map(
      orderRefunds.map((refund) => [refund.exceptionId, refund]),
    );
    const exceptionRows = new Map<string, typeof facts.allocations>();
    for (const allocation of allocations.get(order.id) ?? [])
      exceptionRows.set(allocation.exceptionId, [
        ...(exceptionRows.get(allocation.exceptionId) ?? []),
        allocation,
      ]);
    const cancellation = cancellations.get(order.id);
    const orderQualityCases = qualityCases.get(order.id) ?? [];
    const disputedByReceiptAndSku = new Map<string, number>();
    for (const qualityCase of orderQualityCases)
      for (const item of qualityCase.items) {
        const key = `${item.pickupReceiptId}:${item.catalogSkuId}`;
        disputedByReceiptAndSku.set(
          key,
          (disputedByReceiptAndSku.get(key) ?? 0) + item.disputedQuantity,
        );
      }
    const eligibleReceipts = (pickupReceipts.get(order.id) ?? []).filter(
      (receipt) => Date.parse(receipt.createdAt) + 24 * 60 * 60 * 1000 > now,
    );
    const publicPickupReceipts = (pickupReceipts.get(order.id) ?? [])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((receipt) => {
        const qualityDeadlineAt = new Date(
          Date.parse(receipt.createdAt) + 24 * 60 * 60 * 1000,
        ).toISOString();
        return {
          id: receipt.id,
          pickedUpAt: receipt.createdAt,
          qualityDeadlineAt,
          qualityWindowOpen: Date.parse(qualityDeadlineAt) > now,
          quantity: receipt.items.reduce(
            (total, item) => total + item.quantity,
            0,
          ),
          items: receipt.items.map((item) => ({
            skuId: item.catalogSkuId,
            quantity: item.quantity,
          })),
        };
      });
    const qualityDeadlineAt = eligibleReceipts.length
      ? new Date(
          Math.max(
            ...eligibleReceipts.map(
              (receipt) => Date.parse(receipt.createdAt) + 24 * 60 * 60 * 1000,
            ),
          ),
        ).toISOString()
      : null;
    return {
      ...consumerOrder,
      items: items.map((item) => {
        const itemAllocations = (allocations.get(order.id) ?? []).filter(
          (allocation) => allocation.orderLineId === item.orderLineId,
        );
        const active = itemAllocations.find(
          (allocation) => allocation.exceptionQuantity > 0,
        );
        const pendingRefund = active
          ? refundsByException.get(active.exceptionId)
          : undefined;
        const refundableQuantity = Math.max(
          0,
          item.exceptionQuantity - item.refundedQuantity,
        );
        return {
          skuId: item.skuId,
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          amountCents: item.amountCents,
          fulfilledQuantity: item.fulfilledQuantity,
          pickedUpQuantity: item.pickedUpQuantity,
          qualityEligibleQuantity: eligibleReceipts.reduce((sum, receipt) => {
            const pickedUp = receipt.items
              .filter((value) => value.catalogSkuId === item.skuId)
              .reduce((quantity, value) => quantity + value.quantity, 0);
            return (
              sum -
              (disputedByReceiptAndSku.get(`${receipt.id}:${item.skuId}`) ??
                0) +
              pickedUp
            );
          }, 0),
          remainingPickupQuantity: Math.max(
            0,
            item.fulfilledQuantity - item.pickedUpQuantity,
          ),
          exceptionQuantity: item.exceptionQuantity,
          refundedQuantity: item.refundedQuantity,
          refundedAmountCents: item.refundedAmountCents,
          refundStatus:
            item.refundedQuantity > 0
              ? "SUCCEEDED"
              : (pendingRefund?.status ??
                (active &&
                exceptions.get(active.exceptionId)?.status ===
                  "REFUND_CONFIRMED"
                  ? "PENDING"
                  : null)),
          refundAmountCents:
            refundableQuantity > 0
              ? Number(item.unitPriceCents) * refundableQuantity
              : Number(item.refundedAmountCents),
        };
      }),
      deliveryPlan: publicDeliveryPlan(plans.get(order.deliveryPlanId)),
      communityQualityCases: orderQualityCases,
      qualityDeadlineAt,
      pickupReceipts: publicPickupReceipts,
      pickupDeadlineAt: pickupWindows.get(order.id)?.deadlineAt ?? null,
      pickupWindowOpen: ["ACTIVE", "EXTENDED"].includes(
        pickupWindows.get(order.id)?.status ?? "",
      ),
      pickupWindow: pickupWindows.get(order.id) ?? null,
      cancellation: cancellation
        ? {
            status: cancellation.status,
            reason: cancellation.reason,
            reviewNote: cancellation.reviewNote,
            requestedAt: cancellation.requestedAt,
            refundId: cancellation.refundId,
          }
        : null,
      fulfillmentExceptions: [...exceptionRows.entries()].flatMap(
        ([exceptionId, rows]) => {
          const exception = exceptions.get(exceptionId);
          if (!exception) return [];
          return [
            {
              id: exception.id,
              status: exception.status,
              sourceStage: exception.sourceStage,
              responsibility: exception.responsibility,
              resolutionNote: exception.resolutionNote,
              items: rows.map((allocation) => ({
                catalogSkuId: allocation.catalogSkuId,
                fulfilledQuantity: allocation.fulfilledQuantity,
                exceptionQuantity: allocation.exceptionQuantity,
                refundedQuantity: allocation.refundedQuantity,
                reason:
                  exception.items.find(
                    (item) => item.id === allocation.exceptionItemId,
                  )?.reason ?? null,
              })),
            },
          ];
        },
      ),
      partialRefunds: orderRefunds.map((refund) => ({
        id: refund.id,
        exceptionId: refund.exceptionId,
        status: refund.status,
        amountCents: refund.amountCents,
      })),
    };
  });
}
