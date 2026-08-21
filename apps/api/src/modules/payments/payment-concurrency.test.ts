import { describe, expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import { MemoryStore } from "../core/store.js";
import { LedgerService } from "../finance/ledger-service.js";
import { PaymentService } from "./payment-service.js";
import type { PaymentProvider } from "./payment-provider.js";

const provider: PaymentProvider = {
  name: "mock",
  initiate: async () => ({
    providerPaymentId: null,
    clientPayload: { mock: "true" },
    providerContext: {},
  }),
  parseNotification: () => {
    throw new Error("unused");
  },
  refund: async () => ({
    providerRefundId: "provider-refund",
    status: "PROCESSING",
  }),
  queryRefund: async () => ({
    providerRefundId: "provider-refund",
    status: "SUCCEEDED",
  }),
  parseRefundNotification: () => {
    throw new Error("unused");
  },
};
async function fixture() {
  const store = new MemoryStore(false);
  const now = new Date().toISOString();
  await store.saveUser({
    id: "customer",
    wechatOpenId: "openid",
    status: "ACTIVE",
    createdAt: now,
  });
  await store.saveOrder({
    id: "order",
    orderNo: "ORDER-1",
    userId: "customer",
    campaignId: "campaign",
    serviceAreaId: "area",
    pickupPointId: "point",
    deliveryPlanId: "plan",
    status: "PENDING_PAYMENT",
    totalCents: moneyCents(1200),
    items: [],
    createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    paidAt: null,
    pickedUpAt: null,
  });
  await store.savePayment({
    id: "payment",
    orderId: "order",
    provider: "mock",
    providerPaymentId: null,
    status: "CREATED",
    amountCents: moneyCents(1200),
    clientPayload: { mock: "true" },
    providerContext: {},
    initiationLeaseUntil: null,
    initiationClaimToken: null,
    createdAt: now,
    succeededAt: null,
  });
  return store;
}

describe("payment and refund concurrency", () => {
  it("allows only payment or cancellation to win and deduplicates callbacks", async () => {
    const store = await fixture();
    const service = new PaymentService(store, provider, new LedgerService());
    const notification = {
      eventId: "payment-event",
      type: "TRANSACTION.SUCCESS",
      orderNo: "ORDER-1",
      providerPaymentId: "wechat-payment",
      amountCents: 1200,
      bodyHash: "hash",
    };
    const [paid, cancelled] = await Promise.allSettled([
      service.handleNotification(notification),
      store.cancelPendingOrder("order"),
    ]);
    expect([paid.status, cancelled.status]).toContain("fulfilled");
    const order = await store.getOrder("order");
    expect(["PAID_WAITING_CLOSE", "CANCELLED"]).toContain(order?.status);
    if (order?.status === "PAID_WAITING_CLOSE") {
      await expect(
        service.handleNotification(notification),
      ).resolves.toBeUndefined();
      expect(
        (await store.listLedgerTransactions("order")).filter(
          (v) => v.eventType === "PAYMENT_SUCCEEDED",
        ),
      ).toHaveLength(1);
    }
  });
  it("applies a repeated refund callback once", async () => {
    const store = await fixture();
    const service = new PaymentService(store, provider, new LedgerService());
    await service.handleNotification({
      eventId: "pay",
      type: "TRANSACTION.SUCCESS",
      orderNo: "ORDER-1",
      providerPaymentId: "wechat-payment",
      amountCents: 1200,
      bodyHash: "pay-hash",
    });
    await service.requestFullRefund("order");
    const refund = (await store.listOrderRefunds(10))[0]!;
    const callback = {
      eventId: "refund-event",
      type: "REFUND.SUCCESS",
      providerRefundNo: refund.providerRefundNo,
      providerRefundId: "wechat-refund",
      status: "SUCCEEDED" as const,
      bodyHash: "refund-hash",
    };
    await service.handleRefundNotification(callback);
    await service.handleRefundNotification(callback);
    expect((await store.getOrder("order"))?.status).toBe("REFUNDED");
    expect(
      (await store.listLedgerTransactions("order")).filter(
        (v) => v.eventType === "REFUND_SUCCEEDED",
      ),
    ).toHaveLength(1);
  });
});
