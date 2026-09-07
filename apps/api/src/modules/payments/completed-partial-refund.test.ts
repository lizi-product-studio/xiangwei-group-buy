import { expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import { MemoryStore } from "../core/store.js";
import { LedgerService } from "../finance/ledger-service.js";
import { PaymentService } from "./payment-service.js";
import { MockPaymentProvider } from "./payment-provider.js";

it("settles a completed order's final approved partial refund once without losing its ledger or allocations", async () => {
  const store = new MemoryStore(false);
  const now = new Date().toISOString();
  await store.saveOrder({ id: "order", orderNo: "ORDER", userId: "user", campaignId: "campaign", serviceAreaId: "area", pickupPointId: "point", deliveryPlanId: "plan", status: "COMPLETED", totalCents: moneyCents(1200), items: [], createdAt: now, expiresAt: now, paidAt: now, pickedUpAt: now });
  await store.saveOrderLines("order", [{ id: "line", catalogSkuId: "sku", productId: "product", title: "商品", skuName: "份", quantity: 2, unitPriceCents: 600, amountCents: 1200 }]);
  await store.savePayment({ id: "payment", orderId: "order", provider: "mock", providerPaymentId: "paid", status: "SUCCEEDED", amountCents: moneyCents(1200), clientPayload: {}, providerContext: {}, initiationLeaseUntil: null, initiationClaimToken: null, createdAt: now, succeededAt: now });
  await store.saveFulfillmentException({ id: "quality", campaignId: "campaign", orderId: "order", clientRequestId: "claim", deliveryPlanId: "plan", sourceStage: "CUSTOMER_CLAIM", refundAccountingStage: "POST_REVENUE", status: "REFUND_PROCESSING", responsibility: "PLATFORM", registeredBy: "operator", confirmedBy: "operator", resolutionNote: "批准", registeredAt: now, confirmedAt: now, items: [] });
  await store.saveFulfillmentAllocations([{ id: "allocation", exceptionId: "quality", exceptionItemId: "item", orderLineId: "line", orderId: "order", catalogSkuId: "sku", fulfilledQuantity: 0, exceptionQuantity: 1, refundedQuantity: 0, createdAt: now, refundedAt: null }]);
  for (const [id, status] of [["expired", "SUCCEEDED"], ["quality", "PROCESSING"]] as const)
    await store.savePartialRefund({ id, exceptionId: id, orderId: "order", paymentId: "payment", providerRefundNo: id, providerRefundId: id, status, amountCents: moneyCents(600), createdAt: now, submissionLeaseUntil: null, submissionClaimToken: null });
  const service = new PaymentService(store, new MockPaymentProvider(), new LedgerService());
  const callback = { eventId: "quality-success", type: "REFUND.SUCCESS", providerRefundNo: "quality", providerRefundId: "quality", status: "SUCCEEDED" as const, bodyHash: "hash" };
  await service.handleRefundNotification(callback);
  await service.handleRefundNotification(callback);
  await service.handleRefundNotification({ ...callback, eventId: "again" });
  expect((await store.getOrder("order"))?.status).toBe("REFUNDED");
  expect((await store.getPaymentByOrder("order"))?.status).toBe("REFUNDED");
  expect((await store.listFulfillmentAllocations("quality"))[0]?.refundedQuantity).toBe(1);
  const entries = await store.listLedgerTransactions("quality");
  expect(entries).toHaveLength(1);
  expect(entries[0]?.eventType).toBe("PARTIAL_REFUND_SUCCEEDED");
  expect(entries[0]?.lines).toContainEqual(expect.objectContaining({ accountCode: "SALES_REVENUE", direction: "DEBIT", amountCents: 600 }));
});
