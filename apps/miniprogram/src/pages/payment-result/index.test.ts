import { beforeEach, describe, expect, it, vi } from "vitest";

interface PageInstance {
  data: Record<string, unknown>;
  setData: (patch: Record<string, unknown>) => void;
  finishConfirmedPayment: () => void;
  releaseClosedDraft: () => void;
  refreshStatus: () => Promise<void>;
}
interface PageDefinition {
  data: Record<string, unknown>;
  onLoad: (this: PageInstance, options: Record<string, string | undefined>) => void;
  onShow: (this: PageInstance) => void;
  onHide: (this: PageInstance) => void;
  onUnload: (this: PageInstance) => void;
  refreshStatus: (this: PageInstance) => Promise<void>;
  retryPayment: (this: PageInstance) => Promise<void>;
  finishConfirmedPayment: (this: PageInstance) => void;
  releaseClosedDraft: (this: PageInstance) => void;
}

describe("payment result confirmation", () => {
  const storage = new Map<string, unknown>();
  let api: { getOrder: ReturnType<typeof vi.fn>; getCheckoutBatchPaymentStatus: ReturnType<typeof vi.fn> };
  let payment: { payOrder: ReturnType<typeof vi.fn>; payOrderCheckout: ReturnType<typeof vi.fn> };
  let definition: PageDefinition;

  beforeEach(async () => {
    storage.clear();
    vi.resetModules();
    vi.useRealTimers();
    api = {
      getOrder: vi.fn(),
      getCheckoutBatchPaymentStatus: vi.fn(),
    };
    payment = { payOrder: vi.fn(), payOrderCheckout: vi.fn() };
    vi.doMock("../../utils/api", () => ({
      api,
      AuthExpiredError: class AuthExpiredError extends Error {},
      customerAuth: { captureSessionEpoch: () => 1, isLoggedIn: () => true },
      customerErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
    }));
    vi.doMock("../../utils/payment", () => payment);
    vi.doMock("../../utils/auth-navigation", () => ({ navigateToCustomerLogin: vi.fn() }));
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      navigateTo: vi.fn(), redirectTo: vi.fn(), switchTab: vi.fn(), showToast: vi.fn(), showModal: vi.fn(),
    });
    vi.stubGlobal("Page", (page: unknown) => { definition = page as PageDefinition; return page; });
    await import("./index");
  });

  function instance(options: { resource: string; id: string; outcome: string }): PageInstance {
    const value: PageInstance = {
      data: JSON.parse(JSON.stringify(definition.data)) as Record<string, unknown>,
      setData(patch) { Object.assign(this.data, patch); },
      finishConfirmedPayment() { definition.finishConfirmedPayment.call(value); },
      releaseClosedDraft() { definition.releaseClosedDraft.call(value); },
      refreshStatus() { return definition.refreshStatus.call(value); },
    };
    definition.onLoad.call(value, options);
    return value;
  }

  function order(status: string, paidAt: string | null = null) {
    return {
      id: "order-1", orderNo: "NO-1", status, totalCents: 1250,
      createdAt: "2026-09-28T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
      serverTime: "2026-09-28T00:00:00.000Z", paidAt,
      deliveryPlan: { siteName: "幸福自提点", address: "幸福路 1 号" },
    };
  }

  it("treats the WeChat success callback as checking until the server confirms the order", async () => {
    api.getOrder.mockResolvedValueOnce(order("PENDING_PAYMENT"));
    const page = instance({ resource: "order", id: "order-1", outcome: "returned" });
    await definition.refreshStatus.call(page);

    expect(page.data.status).toBe("CHECKING");
    expect(page.data.title).toBe("正在确认支付");
    expect(page.data.canRetry).toBe(false);
    expect(api.getOrder).toHaveBeenCalledWith("order-1");
  });

  it("shows per-order pickup points and cleans only the unchanged cart after batch confirmation", async () => {
    const group = { campaignId: "campaign-1", campaignTitle: "团期", serviceAreaId: "area-1", serviceAreaName: "幸福区", pickupPointId: "point-1", pickupPointName: "幸福自提点", pickupPointAddress: "幸福路 1 号", items: [{ skuId: "sku-1", title: "番茄", skuName: "份", imageUrl: null, unitPriceCents: 1000, quantity: 1, maxQuantity: 3 }], updatedAt: 12 };
    storage.set("standardCart", { version: 2, groups: [group] });
    storage.set("multiCheckoutDraft", { groups: [{ ...group, updatedAt: 99 }], sourceCartGroups: [{ campaignId: "campaign-1", pickupPointId: "point-1", updatedAt: 12 }], idempotencyKey: "batch-key", updatedAt: 99 });
    storage.set("payment-result-context:checkout:batch-1", { idempotencyKey: "batch-key", cartGroups: [{ campaignId: "campaign-1", pickupPointId: "point-1", updatedAt: 12 }] });
    api.getCheckoutBatchPaymentStatus.mockResolvedValueOnce({
      checkoutBatch: { id: "batch-1", status: "PAID", totalCents: 2700, expiresAt: "2099-01-01T00:00:00.000Z", expired: false, serverTime: "2026-09-28T00:00:00.000Z" },
      orders: [
        { id: "order-1", status: "PAID_WAITING_CLOSE", totalCents: 1200, expiresAt: "2099-01-01T00:00:00.000Z", paidAt: "2026-09-28T00:00:01.000Z", pickupPointId: "point-1", pickupPointName: "幸福自提点", pickupPointAddress: "幸福路 1 号" },
        { id: "order-2", status: "PAID_WAITING_CLOSE", totalCents: 1500, expiresAt: "2099-01-01T00:00:00.000Z", paidAt: "2026-09-28T00:00:01.000Z", pickupPointId: "point-2", pickupPointName: "河畔自提点", pickupPointAddress: "河畔路 2 号" },
      ],
    });
    const page = instance({ resource: "checkout", id: "batch-1", outcome: "returned" });
    await definition.refreshStatus.call(page);

    expect(page.data.status, String(page.data.error)).toBe("PAID");
    expect(page.data.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({ pickupPointName: "幸福自提点" }),
      expect.objectContaining({ pickupPointName: "河畔自提点" }),
    ]));
    expect(storage.has("standardCart")).toBe(false);
    expect(storage.has("multiCheckoutDraft")).toBe(false);
    expect(storage.has("payment-result-context:checkout:batch-1")).toBe(false);
  });

  it("offers retry only for a server-pending original order and never creates another order", async () => {
    api.getOrder.mockResolvedValueOnce(order("PENDING_PAYMENT"));
    payment.payOrder.mockResolvedValueOnce("cancelled");
    api.getOrder.mockResolvedValueOnce(order("PENDING_PAYMENT"));
    const page = instance({ resource: "order", id: "order-1", outcome: "cancelled" });
    await definition.refreshStatus.call(page);
    expect(page.data.status).toBe("CANCELLED");
    expect(page.data.canRetry).toBe(true);

    await definition.retryPayment.call(page);
    expect(payment.payOrder).toHaveBeenCalledWith("order-1", expect.any(Function));
    expect(payment.payOrderCheckout).not.toHaveBeenCalled();
    expect(page.data.status).toBe("CANCELLED");
  });

  it("uses server time to mark an expired single order and keeps the cart", async () => {
    const group = { campaignId: "campaign-1", campaignTitle: "团期", serviceAreaId: "area-1", serviceAreaName: "幸福区", pickupPointId: "point-1", pickupPointName: "幸福自提点", pickupPointAddress: "幸福路 1 号", items: [], updatedAt: 12 };
    storage.set("standardCart", { version: 2, groups: [group] });
    storage.set("checkoutDraft", { ...group, orderIdempotencyKey: "order-key" });
    storage.set("payment-result-context:order:order-1", { idempotencyKey: "order-key", cartGroups: [{ campaignId: "campaign-1", pickupPointId: "point-1", updatedAt: 12 }] });
    api.getOrder.mockResolvedValueOnce({ ...order("PENDING_PAYMENT"), expiresAt: "2026-09-27T00:00:00.000Z", serverTime: "2026-09-28T00:00:00.000Z" });
    const page = instance({ resource: "order", id: "order-1", outcome: "uncertain" });
    await definition.refreshStatus.call(page);

    expect(page.data.status, String(page.data.error)).toBe("EXPIRED");
    expect(page.data.canRetry).toBe(false);
    expect(storage.has("standardCart")).toBe(true);
    expect((storage.get("checkoutDraft") as { orderIdempotencyKey?: string }).orderIdempotencyKey).toBeUndefined();
  });

  it("preserves an edited purchased group and unrelated cart groups after batch confirmation", async () => {
    const purchased = { campaignId: "campaign-1", campaignTitle: "团期", serviceAreaId: "area-1", serviceAreaName: "幸福区", pickupPointId: "point-1", pickupPointName: "幸福自提点", pickupPointAddress: "幸福路 1 号", items: [{ skuId: "sku-1", title: "番茄", skuName: "份", imageUrl: null, unitPriceCents: 1000, quantity: 2, maxQuantity: 3 }], updatedAt: 13 };
    const other = { ...purchased, campaignId: "campaign-2", pickupPointId: "point-2", updatedAt: 21 };
    storage.set("standardCart", { version: 2, groups: [purchased, other] });
    storage.set("multiCheckoutDraft", { groups: [{ ...purchased, updatedAt: 99 }], sourceCartGroups: [{ campaignId: "campaign-1", pickupPointId: "point-1", updatedAt: 12 }], idempotencyKey: "batch-key", updatedAt: 99 });
    storage.set("payment-result-context:checkout:batch-1", { idempotencyKey: "batch-key", cartGroups: [{ campaignId: "campaign-1", pickupPointId: "point-1", updatedAt: 12 }] });
    api.getCheckoutBatchPaymentStatus.mockResolvedValueOnce({
      checkoutBatch: { id: "batch-1", status: "PAID", totalCents: 2000, expiresAt: "2099-01-01T00:00:00.000Z", expired: false, serverTime: "2026-09-28T00:00:00.000Z" },
      orders: [{ id: "order-1", status: "PAID_WAITING_CLOSE", totalCents: 2000, expiresAt: "2099-01-01T00:00:00.000Z", paidAt: "2026-09-28T00:00:01.000Z", pickupPointId: "point-1", pickupPointName: "幸福自提点", pickupPointAddress: "幸福路 1 号" }],
    });
    const page = instance({ resource: "checkout", id: "batch-1", outcome: "returned" });
    await definition.refreshStatus.call(page);

    const remaining = (storage.get("standardCart") as { groups: Array<{ campaignId: string; pickupPointId: string }> }).groups;
    expect(remaining).toEqual(expect.arrayContaining([
      expect.objectContaining({ campaignId: "campaign-1", pickupPointId: "point-1" }),
      expect.objectContaining({ campaignId: "campaign-2", pickupPointId: "point-2" }),
    ]));
    expect(remaining).toHaveLength(2);
  });

  it("clears scheduled status polling when the result page hides", async () => {
    vi.useFakeTimers();
    api.getOrder.mockResolvedValue(order("PENDING_PAYMENT"));
    const page = instance({ resource: "order", id: "order-1", outcome: "returned" });
    await definition.refreshStatus.call(page);
    expect(vi.getTimerCount()).toBe(1);

    definition.onHide.call(page);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the loading state after the session expires during a status refresh", async () => {
    let epoch = 1;
    class MockAuthExpiredError extends Error {
      sessionWasCleared = true;
      requestEpoch = 1;
    }
    vi.doMock("../../utils/api", () => ({
      api,
      AuthExpiredError: MockAuthExpiredError,
      customerAuth: { captureSessionEpoch: () => epoch, isLoggedIn: () => epoch === 1 },
      customerErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
    }));
    vi.resetModules();
    await import("./index");
    api.getOrder.mockImplementationOnce(async () => {
      epoch = 2;
      throw new MockAuthExpiredError("session expired");
    });
    const page = instance({ resource: "order", id: "order-1", outcome: "returned" });
    await definition.refreshStatus.call(page);

    expect(page.data.loggedIn).toBe(false);
    expect(page.data.refreshing).toBe(false);
    expect(page.data.title).toBe("登录后查看支付状态");
  });

  it("ignores a hidden refresh and reloads current status when the page returns", async () => {
    let resolveOld!: (value: ReturnType<typeof order>) => void;
    api.getOrder
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(order("PAID_WAITING_CLOSE", "2026-09-28T00:00:01.000Z"));
    const page = instance({ resource: "order", id: "order-1", outcome: "returned" });
    const oldRefresh = definition.refreshStatus.call(page);
    await Promise.resolve();
    definition.onHide.call(page);
    definition.onShow.call(page);
    resolveOld(order("PENDING_PAYMENT"));
    await oldRefresh;
    await Promise.resolve();
    await Promise.resolve();

    expect(api.getOrder).toHaveBeenCalledTimes(2);
    expect(page.data.status).toBe("PAID");
    expect(page.data.refreshing).toBe(false);
  });
});
