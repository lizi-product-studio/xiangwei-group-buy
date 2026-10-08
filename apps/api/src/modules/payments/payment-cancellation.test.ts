import { describe, expect, it, vi } from "vitest";
import { BusinessError } from "@hometown/domain";
import { MemoryStore } from "../core/store.js";
import type { Order, Payment } from "../core/types.js";
import { PaymentService } from "./payment-service.js";
import type { PaymentProvider } from "./payment-provider.js";
import type { LedgerService } from "../finance/ledger-service.js";

function pendingOrder(): Order {
  return {
    id: "order-1", orderNo: "WX-ORDER-1", userId: "user-1", campaignId: "campaign-1",
    serviceAreaId: "area-1", pickupPointId: "point-1", deliveryPlanId: "plan-1",
    status: "PENDING_PAYMENT", totalCents: 1200, items: [], createdAt: "2026-09-28T00:00:00.000Z",
    expiresAt: "2026-09-28T00:15:00.000Z", paidAt: null, pickedUpAt: null,
  };
}
function initiatedPayment(): Payment {
  return {
    id: "payment-1", orderId: "order-1", provider: "wechat", providerPaymentId: "prepay-1",
    status: "CREATED", amountCents: 1200, clientPayload: { package: "prepay_id=prepay-1" },
    providerContext: { outTradeNo: "WX-ORDER-1" }, initiationLeaseUntil: null,
    initiationClaimToken: null, createdAt: "2026-09-28T00:00:00.000Z", succeededAt: null,
  };
}
function service(store: MemoryStore, provider: Partial<PaymentProvider>) {
  return new PaymentService(store, { name: "wechat", initiate: vi.fn(), parseNotification: vi.fn(), refund: vi.fn(), queryRefund: vi.fn(), parseRefundNotification: vi.fn(), ...provider } as PaymentProvider, { recordPayment: vi.fn() } as unknown as LedgerService);
}

describe("payment-safe pending cancellation", () => {
  it("fails closed when a recorded provider payment cannot be queried and closed", async () => {
    const store = new MemoryStore();
    await store.saveOrder(pendingOrder());
    await store.savePayment(initiatedPayment());

    await expect(service(store, {}).reconcileBeforeCancellation("order-1", "user-1"))
      .rejects.toMatchObject({ statusCode: 503 });
    expect((await store.getOrder("order-1"))?.status).toBe("PENDING_PAYMENT");
  });

  it("does not release an order while provider status stays user-paying after close", async () => {
    const store = new MemoryStore();
    await store.saveOrder(pendingOrder());
    await store.savePayment(initiatedPayment());
    const queryPayment = vi.fn()
      .mockResolvedValueOnce({ status: "USERPAYING", outTradeNo: "WX-ORDER-1" })
      .mockResolvedValueOnce({ status: "USERPAYING", outTradeNo: "WX-ORDER-1" });
    const closePayment = vi.fn().mockResolvedValue({ status: "CLOSED" });

    await expect(service(store, { queryPayment, closePayment }).reconcileBeforeCancellation("order-1", "user-1"))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(closePayment).toHaveBeenCalledWith({ outTradeNo: "WX-ORDER-1" });
    expect((await store.getOrder("order-1"))?.status).toBe("PENDING_PAYMENT");
  });

  it("waits for an in-flight provider initiation before attempting cancellation", async () => {
    const store = new MemoryStore();
    await store.saveOrder(pendingOrder());
    await store.savePayment({ ...initiatedPayment(), clientPayload: null, initiationClaimToken: "claim-1", initiationLeaseUntil: new Date(Date.now() + 60_000).toISOString() });
    const queryPayment = vi.fn();

    await expect(service(store, { queryPayment, closePayment: vi.fn() }).reconcileBeforeCancellation("order-1", "user-1"))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(queryPayment).not.toHaveBeenCalled();
  });

  it("reconciles an expired initiation claim with the provider instead of blocking cancellation", async () => {
    const store = new MemoryStore();
    await store.saveOrder(pendingOrder());
    await store.savePayment({ ...initiatedPayment(), clientPayload: null, providerPaymentId: null, initiationClaimToken: "stale-claim", initiationLeaseUntil: "2026-09-28T00:02:00.000Z" });
    const queryPayment = vi.fn().mockResolvedValue({ status: "CLOSED", outTradeNo: "WX-ORDER-1" });
    const closePayment = vi.fn();

    await expect(service(store, { queryPayment, closePayment }).reconcileBeforeCancellation("order-1", "user-1"))
      .resolves.toBe(false);
    expect(queryPayment).toHaveBeenCalledWith({ outTradeNo: "WX-ORDER-1" });
    expect(closePayment).not.toHaveBeenCalled();
  });

  it("records a provider-confirmed payment through the ordinary payment callback path", async () => {
    const store = new MemoryStore();
    await store.saveOrder(pendingOrder());
    await store.savePayment(initiatedPayment());
    const queryPayment = vi.fn().mockResolvedValue({
      status: "SUCCEEDED", outTradeNo: "WX-ORDER-1", providerPaymentId: "provider-tx-1", amountCents: 1200,
    });
    const closePayment = vi.fn();

    await expect(service(store, { queryPayment, closePayment }).reconcileBeforeCancellation("order-1", "user-1"))
      .resolves.toBe(true);
    expect(closePayment).not.toHaveBeenCalled();
    expect((await store.getOrder("order-1"))?.status).toBe("PAID_WAITING_CLOSE");
    expect((await store.getPaymentByOrder("order-1"))?.status).toBe("SUCCEEDED");
  });

  it("keeps expired-order inventory reserved when provider closure remains ambiguous", async () => {
    const store = new MemoryStore();
    await store.saveOrder({ ...pendingOrder(), expiresAt: "2026-09-27T00:00:00.000Z" });
    await store.savePayment({ ...initiatedPayment(), createdAt: "2026-09-27T00:00:00.000Z" });
    const queryPayment = vi.fn()
      .mockResolvedValueOnce({ status: "USERPAYING", outTradeNo: "WX-ORDER-1" })
      .mockResolvedValueOnce({ status: "USERPAYING", outTradeNo: "WX-ORDER-1" });
    const cancel = vi.fn();

    await expect(service(store, { queryPayment, closePayment: vi.fn().mockResolvedValue({ status: "CLOSED" }) }).expirePendingOrders(cancel))
      .resolves.toEqual({ expired: 0, failed: 1 });
    expect(cancel).not.toHaveBeenCalled();
    expect((await store.getOrder("order-1"))?.status).toBe("PENDING_PAYMENT");
  });

  it("reuses an existing prepay payload inside the final minute without extending the order deadline", async () => {
    const store = new MemoryStore();
    const deadline = new Date(Date.now() + 30_000).toISOString();
    await store.saveOrder({ ...pendingOrder(), expiresAt: deadline });
    await store.savePayment({ ...initiatedPayment(), clientPayload: { package: "prepay_id=existing" } });
    const initiate = vi.fn();

    await expect(service(store, { initiate }).initiate("order-1", "user-1"))
      .resolves.toMatchObject({ clientPayload: { package: "prepay_id=existing" }, status: "CREATED" });
    expect(initiate).not.toHaveBeenCalled();
    expect((await store.getOrder("order-1"))?.expiresAt).toBe(deadline);
  });

  it("rejects a new prepay inside the final minute before creating an initiation claim", async () => {
    const store = new MemoryStore();
    await store.saveOrder({ ...pendingOrder(), expiresAt: new Date(Date.now() + 30_000).toISOString() });
    const initiate = vi.fn();

    await expect(service(store, { initiate }).initiate("order-1", "user-1"))
      .rejects.toMatchObject({ statusCode: 409, message: "剩余支付时间不足，无法安全发起微信支付；请取消当前订单后重新下单" });
    expect(initiate).not.toHaveBeenCalled();
    expect(await store.getPaymentByOrder("order-1")).toBeNull();
  });

  it("releases only its own initiation claim when the provider's final-minute guard wins a timing race", async () => {
    const store = new MemoryStore();
    await store.saveOrder({ ...pendingOrder(), expiresAt: new Date(Date.now() + 61_000).toISOString() });
    const initiate = vi.fn().mockRejectedValue(new BusinessError("INVALID_STATE_TRANSITION", "订单剩余支付时间不足，请重新下单", 409));
    await expect(service(store, { initiate }).initiate("order-1", "user-1")).rejects.toThrow("订单剩余支付时间不足");
    expect(await store.getPaymentByOrder("order-1")).toMatchObject({ status: "CREATED", initiationClaimToken: null, initiationLeaseUntil: null, clientPayload: null });
  });
});
