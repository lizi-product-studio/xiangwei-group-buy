import { expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import { MemoryStore } from "../core/store.js";
import { LedgerService } from "../finance/ledger-service.js";
import type { CommunityQualityCase } from "../core/types.js";
import { CommunityQualityService } from "../fulfillment/community-quality-service.js";
import { completeCampaignIfSettled } from "../fulfillment/campaign-completion.js";
import { PaymentService } from "./payment-service.js";
import { MockPaymentProvider } from "./payment-provider.js";

async function qualityRefundFixture(
  exceptionStatus: "REFUND_CONFIRMED" | "REFUND_PROCESSING",
) {
  const store = new MemoryStore(false);
  const now = new Date().toISOString();
  await store.saveCampaign({ id: "campaign", title: "团期", serviceAreaId: "area", cutoffAt: now, dispatchAt: now, estimatedArrivalStartAt: now, estimatedArrivalEndAt: now, minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND", items: [], status: "FULFILLING", version: 1, createdAt: now });
  await store.saveOrder({ id: "order", orderNo: "ORDER", userId: "user", campaignId: "campaign", serviceAreaId: "area", pickupPointId: "point", deliveryPlanId: "plan", status: "COMPLETED", totalCents: moneyCents(2000), items: [{ orderLineId: "line", skuId: "sku", productId: "product", name: "商品", quantity: 2, unitPriceCents: moneyCents(1000), amountCents: moneyCents(2000), fulfilledQuantity: 2, pickedUpQuantity: 2, exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: moneyCents(0) }], createdAt: now, expiresAt: now, paidAt: now, pickedUpAt: now });
  await store.saveOrderLines("order", [{ id: "line", catalogSkuId: "sku", productId: "product", title: "商品", skuName: "份", quantity: 2, unitPriceCents: 1000, amountCents: 2000 }]);
  const line = (await store.listOrderLinesByOrderForUpdate("order"))[0]!;
  line.fulfilledQuantity = 2;
  line.pickedUpQuantity = 2;
  await store.updateOrderLine(line);
  await store.savePayment({ id: "payment", orderId: "order", provider: "mock", providerPaymentId: "paid", status: "SUCCEEDED", amountCents: moneyCents(2000), clientPayload: {}, providerContext: {}, initiationLeaseUntil: null, initiationClaimToken: null, createdAt: now, succeededAt: now });
  await store.saveFulfillmentException({ id: "quality", campaignId: "campaign", orderId: "order", clientRequestId: "quality-request", deliveryPlanId: "plan", sourceStage: "CUSTOMER_CLAIM", refundAccountingStage: "POST_REVENUE", status: exceptionStatus, responsibility: "PLATFORM", registeredBy: "user", confirmedBy: "operator", resolutionNote: "批准", registeredAt: now, confirmedAt: now, items: [] });
  await store.saveFulfillmentAllocations([{ id: "allocation", exceptionId: "quality", exceptionItemId: "quality-item", orderLineId: "line", orderId: "order", catalogSkuId: "sku", fulfilledQuantity: 0, exceptionQuantity: 1, refundedQuantity: 0, createdAt: now, refundedAt: null }]);
  const qualityCase: CommunityQualityCase = {
    id: "quality-case",
    orderId: "order",
    userId: "user",
    clientRequestId: "quality-request",
    payloadHash: "payload-hash",
    status: "REFUNDING",
    registeredAt: now,
    acceptedBy: "customer-service",
    acceptedAt: now,
    acceptanceNote: "已受理",
    decisionBy: "operator",
    decidedAt: now,
    decisionNote: "批准退款",
    refundApprovedBy: "operator",
    refundApprovedAt: now,
    financeExecutedBy: null,
    financeExecutedAt: null,
    refundExceptionId: "quality",
    items: [{ id: "quality-item", communityQualityCaseId: "quality-case", pickupReceiptId: "receipt", orderLineId: "line", catalogSkuId: "sku", pickedUpQuantitySnapshot: 1, disputedQuantity: 1, reason: "QUALITY_CLAIM", description: "品质问题" }],
  };
  await store.saveCommunityQualityCase(qualityCase);
  return { store, now };
}

it("keeps the campaign open after the final refund callback until finance confirms the quality case", async () => {
  const { store, now } = await qualityRefundFixture("REFUND_PROCESSING");
  await store.savePartialRefund({ id: "quality", exceptionId: "quality", orderId: "order", paymentId: "payment", providerRefundNo: "quality", providerRefundId: "quality", status: "PROCESSING", amountCents: moneyCents(1000), createdAt: now, submissionLeaseUntil: null, submissionClaimToken: null });

  const payments = new PaymentService(store, new MockPaymentProvider(), new LedgerService());
  const callback = { eventId: "quality-success", type: "REFUND.SUCCESS", providerRefundNo: "quality", providerRefundId: "quality", status: "SUCCEEDED" as const, bodyHash: "hash" };
  await payments.handleRefundNotification(callback);
  await payments.handleRefundNotification(callback);
  await payments.handleRefundNotification({ ...callback, eventId: "again" });
  expect((await store.getOrder("order"))?.status).toBe("COMPLETED");
  expect((await store.getPaymentByOrder("order"))?.status).toBe("SUCCEEDED");
  expect((await store.getCampaign("campaign"))?.status).toBe("FULFILLING");
  expect((await store.listFulfillmentAllocations("quality"))[0]?.refundedQuantity).toBe(1);
  const entries = await store.listLedgerTransactions("quality");
  expect(entries).toHaveLength(1);
  expect(entries[0]?.eventType).toBe("PARTIAL_REFUND_SUCCEEDED");
  expect(entries[0]?.lines).toContainEqual(expect.objectContaining({ accountCode: "SALES_REVENUE", direction: "DEBIT", amountCents: 1000 }));

  expect((await store.getCommunityQualityCaseForUpdate("quality-case"))?.status).toBe("REFUNDING");
  expect((await store.getCampaign("campaign"))?.status).toBe("FULFILLING");
});

it("keeps the campaign open after synchronous refund success until finance confirms the quality case", async () => {
  const { store } = await qualityRefundFixture("REFUND_CONFIRMED");
  const payments = new PaymentService(store, new MockPaymentProvider(), new LedgerService());
  await payments.executePartialRefund("quality", { actorId: "finance", requestId: "refund-submit", confirmationNote: "已核对" });
  expect((await store.listPartialRefundsByException("quality"))[0]?.status).toBe("SUCCEEDED");
  expect((await store.getCommunityQualityCaseForUpdate("quality-case"))?.status).toBe("REFUNDING");
  expect((await store.getCampaign("campaign"))?.status).toBe("FULFILLING");

  expect((await store.getCommunityQualityCaseForUpdate("quality-case"))?.status).toBe("REFUNDING");
  expect((await store.getCampaign("campaign"))?.status).toBe("FULFILLING");
});

it("closes the campaign when its final accepted quality case is rejected", async () => {
  const store = new MemoryStore(false);
  const now = new Date().toISOString();
  await store.saveCampaign({ id: "reject-campaign", title: "团期", serviceAreaId: "area", cutoffAt: now, dispatchAt: now, estimatedArrivalStartAt: now, estimatedArrivalEndAt: now, minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND", items: [], status: "FULFILLING", version: 1, createdAt: now });
  await store.saveOrder({ id: "reject-order", orderNo: "REJECT-ORDER", userId: "user", campaignId: "reject-campaign", serviceAreaId: "area", pickupPointId: "point", deliveryPlanId: "plan", status: "COMPLETED", totalCents: moneyCents(2000), items: [], createdAt: now, expiresAt: now, paidAt: now, pickedUpAt: now });
  const qualityCase: CommunityQualityCase = {
    id: "final-quality-case",
    orderId: "reject-order",
    userId: "user",
    clientRequestId: "final-quality-request",
    payloadHash: "payload-hash",
    status: "ACCEPTED",
    registeredAt: now,
    acceptedBy: "customer-service",
    acceptedAt: now,
    acceptanceNote: "已受理",
    decisionBy: null,
    decidedAt: null,
    decisionNote: null,
    refundApprovedBy: null,
    refundApprovedAt: null,
    financeExecutedBy: null,
    financeExecutedAt: null,
    refundExceptionId: null,
    items: [],
  };
  await store.saveCommunityQualityCase(qualityCase);

  expect(await completeCampaignIfSettled(store, "reject-campaign")).toBe(false);
  expect((await store.getCampaign("reject-campaign"))?.status).toBe("FULFILLING");
  const rejected = await new CommunityQualityService(store).decide(
    qualityCase.id,
    "operator",
    false,
    "不符合退款条件",
    "quality-rejected",
  );

  expect(rejected.status).toBe("REJECTED");
  expect(rejected.refundExceptionId).toBeNull();
  expect((await store.getOrder("reject-order"))?.status).toBe("COMPLETED");
  expect((await store.getCampaign("reject-campaign"))?.status).toBe("COMPLETED");
});
