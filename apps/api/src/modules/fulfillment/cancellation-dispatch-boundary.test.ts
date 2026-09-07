import { describe, expect, it, vi } from "vitest";
import { moneyCents } from "@hometown/domain";
import { MemoryStore } from "../core/store.js";
import { PaymentService } from "../payments/payment-service.js";
import { MockPaymentProvider } from "../payments/payment-provider.js";
import { LedgerService } from "../finance/ledger-service.js";
import type { NotificationService } from "../notifications/notification-service.js";
import { CommunityOperationsService } from "./community-operations-service.js";

async function fixture() {
  const store = new MemoryStore(false);
  const now = new Date().toISOString();
  await store.saveOrder({ id: "order", orderNo: "ORDER", userId: "user", campaignId: "campaign", serviceAreaId: "area", pickupPointId: "point", deliveryPlanId: "plan", status: "LOCKED", totalCents: moneyCents(1200), items: [], createdAt: now, expiresAt: now, paidAt: now, pickedUpAt: null });
  await store.savePayment({ id: "payment", orderId: "order", provider: "mock", providerPaymentId: "paid", status: "SUCCEEDED", amountCents: moneyCents(1200), clientPayload: {}, providerContext: {}, initiationLeaseUntil: null, initiationClaimToken: null, createdAt: now, succeededAt: now });
  await store.saveCommunityCancellationRequest({ id: "request", orderId: "order", userId: "user", reason: "取消", status: "PENDING_REVIEW", requestedAt: now, reviewedBy: null, reviewedAt: null, reviewNote: null, financeExecutedBy: null, financeExecutedAt: null, refundId: null });
  const payments = new PaymentService(store, new MockPaymentProvider(), new LedgerService());
  const ops = new CommunityOperationsService(store, payments, {} as NotificationService);
  return { store, ops, payments };
}

describe("cancellation revalidates fulfillment before approval and finance", () => {
  it.each(["IN_TRANSIT", "READY_FOR_PICKUP", "PICKED_UP", "COMPLETED", "REFUNDING", "REFUNDED"] as const)("rejects approval and finance after order becomes %s", async (status) => {
    const { store, ops, payments } = await fixture();
    const refund = vi.spyOn(payments, "refundOrder");
    await store.saveOrderStatus({ ...(await store.getOrder("order"))!, status });
    await expect(ops.reviewCancellation("order", "operator", true, "批准", "review")).rejects.toThrow();
    expect((await store.getCommunityCancellationRequestByOrderForUpdate("order"))?.status).toBe("PENDING_REVIEW");
    await store.saveCommunityCancellationRequest({ ...(await store.getCommunityCancellationRequestByOrderForUpdate("order"))!, status: "APPROVED_WAITING_FINANCE" });
    await expect(ops.executeCancellationRefund("order", "finance", "execute")).rejects.toThrow();
    expect((await store.getOrder("order"))?.status).toBe(status);
    expect(await store.listOrderRefunds(10)).toHaveLength(0);
    expect(refund).not.toHaveBeenCalled();
  });
  it.each(["IN_TRANSIT", "ARRIVED", "CLOSED"] as const)("rejects a %s batch even when the order status has not advanced", async (status) => {
    const { store, ops } = await fixture();
    await ops.reviewCancellation("order", "operator", true, "批准", "review");
    await store.saveDispatchBatch({ id: "batch", campaignId: "campaign", serviceAreaId: "area", status, createdAt: new Date().toISOString(), dispatchedAt: new Date().toISOString(), arrivedAt: null });
    await expect(ops.executeCancellationRefund("order", "finance", "execute")).rejects.toThrow();
    expect(await store.listOrderRefunds(10)).toHaveLength(0);
  });
  it("preserves rejection and permits pre-dispatch finance exactly once despite an unrelated batch", async () => {
    const { store, ops } = await fixture();
    await store.saveDispatchBatch({ id: "unrelated", campaignId: "other-campaign", serviceAreaId: "area", status: "IN_TRANSIT", createdAt: new Date().toISOString(), dispatchedAt: new Date().toISOString(), arrivedAt: null });
    await ops.reviewCancellation("order", "operator", true, "批准", "review");
    await ops.executeCancellationRefund("order", "finance", "execute");
    await ops.executeCancellationRefund("order", "finance", "repeat");
    expect(await store.listOrderRefunds(10)).toHaveLength(1);
    const second = await fixture();
    await second.store.saveOrderStatus({ ...(await second.store.getOrder("order"))!, status: "PICKED_UP" });
    expect((await second.ops.reviewCancellation("order", "operator", false, "已发车", "reject")).status).toBe("REJECTED");
  });
});
