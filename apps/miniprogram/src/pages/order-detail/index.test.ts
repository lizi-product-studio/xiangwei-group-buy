import { beforeEach, describe, expect, it, vi } from "vitest";

type RequestOption = {
  url: string;
  method?: string;
  success?: (response: unknown) => void;
  fail?: (error: { errMsg?: string }) => void;
};

type PageInstance = {
  data: Record<string, unknown>;
  setData: (patch: Record<string, unknown>) => void;
  loadOrder?: () => Promise<boolean>;
  refreshPaymentCountdown?: () => void;
  refreshPaymentStateAfterExpiry?: () => Promise<void>;
};

type PageDefinition = {
  data: Record<string, unknown>;
  loadOrder: (this: PageInstance) => Promise<boolean>;
  retryLoad: (this: PageInstance) => Promise<void>;
  onShow: (this: PageInstance) => void;
  onHide: (this: PageInstance) => void;
  pay: (this: PageInstance) => Promise<void>;
  cancel: (this: PageInstance) => Promise<void>;
  refreshPaymentCountdown: (this: PageInstance) => void;
  refreshPaymentStateAfterExpiry: (this: PageInstance) => Promise<void>;
};

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}
async function flushPromises() { for (let index = 0; index < 10; index += 1) await Promise.resolve(); }

describe("order detail payment recovery", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("continues payment on the existing order without creating another order", async () => {
    const requests: RequestOption[] = [];
    const showModal = vi.fn(() => Promise.resolve({ confirm: false }));
    const redirectTo = vi.fn(() => Promise.resolve());
    const order = {
      id: "order-existing",
      orderNo: "NO-EXISTING",
      userId: "customer",
      campaignId: "campaign-1",
      serviceAreaId: "area-1",
      pickupPointId: "point-1",
      deliveryPlanId: "plan-1",
      status: "PENDING_PAYMENT",
      totalCents: 1290,
      createdAt: "2099-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:15:00.000Z",
      serverTime: new Date().toISOString(),
      paidAt: null,
      pickedUpAt: null,
      items: [
        {
          skuId: "sku-1",
          name: "有机番茄",
          quantity: 1,
          unitPriceCents: 1290,
          amountCents: 1290,
          fulfilledQuantity: 0,
          pickedUpQuantity: 0,
          exceptionQuantity: 0,
          refundedQuantity: 0,
          refundedAmountCents: 0,
        },
      ],
      deliveryPlan: {
        id: "plan-1",
        campaignId: "campaign-1",
        serviceAreaId: "area-1",
        pickupPointId: "point-1",
        status: "SITE_CONFIRMED",
        siteName: "幸福自提点",
        address: "幸福路 1 号",
        arrivalStartAt: "2099-01-02T00:00:00.000Z",
        arrivalEndAt: "2099-01-02T02:00:00.000Z",
        estimatedArrivalAt: null,
      },
      partialRefunds: [],
      fulfillmentExceptions: [],
      communityQualityCases: [],
      pickupReceipts: [],
      cancellation: null,
    };
    storage.set("hometown-demo-customer-session", true);
    const app = {
      globalData: {
        apiBaseUrl: "http://127.0.0.1:3100",
        authMode: "demo" as const,
        demoLoginEnabled: true,
        accessToken: null,
        subscriptionTemplates: [],
      },
    };
    vi.stubGlobal("getApp", () => app);
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      showModal,
      showToast: vi.fn(() => Promise.resolve()),
      navigateTo: vi.fn(() => Promise.resolve()),
      redirectTo,
      request: vi.fn((request: RequestOption) => {
        requests.push(request);
        if (request.url.endsWith("/api/v1/orders/order-existing")) {
          request.success?.({ statusCode: 200, data: { data: order } });
        } else if (request.url.endsWith("/api/v1/orders/order-existing/pay")) {
          request.fail?.({ errMsg: "支付服务暂时不可用" });
        } else {
          request.fail?.({ errMsg: `unexpected request ${request.url}` });
        }
      }),
    });

    let definition: PageDefinition | undefined;
    vi.stubGlobal("Page", (value: unknown) => {
      definition = value as PageDefinition;
      return value;
    });
    await import("./index");
    if (!definition) throw new Error("order detail page was not registered");
    const instance: PageInstance = {
      data: { ...definition.data, id: "order-existing" },
      setData(patch) {
        Object.assign(this.data, patch);
      },
    };
    await definition.loadOrder.call(instance);
    await definition.pay.call(instance);

    expect(
      requests.filter(
        (request) =>
          request.method === "POST" && request.url.endsWith("/api/v1/orders"),
      ),
    ).toHaveLength(0);
    expect(
      requests.filter(
        (request) =>
          request.method === "POST" &&
          request.url.endsWith("/api/v1/orders/order-existing/pay"),
      ),
    ).toHaveLength(1);
    expect(showModal).not.toHaveBeenCalled();
    expect(redirectTo).toHaveBeenCalledWith(expect.objectContaining({
      url: "/pages/payment-result/index?resource=order&id=order-existing&outcome=uncertain",
    }));
  });

  it("continues a multi-order payment through its original checkout batch", async () => {
    const payOrder = vi.fn();
    const payOrderCheckout = vi.fn(async () => "cancelled" as const);
    const redirectTo = vi.fn();
    vi.doMock("../../utils/api", () => ({
      api: {},
      AuthExpiredError: class AuthExpiredError extends Error {},
      customerAuth: { captureSessionEpoch: () => 1, isLoggedIn: () => true },
      customerErrorMessage: (_error: unknown, fallback: string) => fallback,
    }));
    vi.doMock("../../utils/payment", () => ({ payOrder, payOrderCheckout }));
    vi.doMock("../../utils/auth-navigation", () => ({ navigateToCustomerLogin: vi.fn() }));
    vi.stubGlobal("wx", { redirectTo, showModal: vi.fn() });
    let definition!: PageDefinition;
    vi.stubGlobal("Page", (page: unknown) => { definition = page as PageDefinition; });
    await import("./index");
    const instance: PageInstance = {
      data: {
        id: "child-order-1",
        order: {
          id: "child-order-1", status: "PENDING_PAYMENT", canPay: true,
          checkoutBatch: { id: "batch-original", orderCount: 2, totalCents: 2500, status: "PENDING_PAYMENT" },
        },
      },
      setData(patch) { Object.assign(this.data, patch); },
    };

    await definition.pay.call(instance);

    expect(payOrderCheckout).toHaveBeenCalledWith("batch-original", expect.any(Function));
    expect(payOrder).not.toHaveBeenCalled();
    expect(redirectTo).toHaveBeenCalledWith(expect.objectContaining({
      url: "/pages/payment-result/index?resource=checkout&id=batch-original&outcome=cancelled",
    }));
  });

  it("revalidates the order and keeps an in-flight payment result after hide/show", async () => {
    const payment = deferred<"returned">();
    const order = {
      id: "order-existing", status: "PENDING_PAYMENT", totalCents: 1290,
      createdAt: "2099-01-01T00:00:00.000Z", items: [], deliveryPlan: null,
      expiresAt: "2099-01-01T00:15:00.000Z", serverTime: new Date().toISOString(),
      partialRefunds: [], fulfillmentExceptions: [], communityQualityCases: [], pickupReceipts: [], cancellation: null,
    };
    const api = { getOrder: vi.fn(async () => order) };
    const payOrder = vi.fn(() => payment.promise);
    const openPaymentResult = vi.fn();
    vi.doMock("../../utils/api", () => ({
      api, AuthExpiredError: class extends Error {},
      customerAuth: { captureSessionEpoch: () => 1, isLoggedIn: () => true },
      customerErrorMessage: (_error: unknown, fallback: string) => fallback,
    }));
    vi.doMock("../../utils/payment", () => ({ payOrder, payOrderCheckout: vi.fn() }));
    vi.doMock("../../utils/payment-result-context", () => ({ openPaymentResult }));
    vi.doMock("../../utils/auth-navigation", () => ({ navigateToCustomerLogin: vi.fn() }));
    vi.doMock("../../utils/auth-intent", () => ({ consumeCancelReturnSuppression: vi.fn(() => false) }));
    vi.stubGlobal("wx", { showModal: vi.fn(async () => ({ confirm: false })), showToast: vi.fn() });
    let definition!: PageDefinition;
    vi.stubGlobal("Page", (page: unknown) => { definition = page as PageDefinition; });
    await import("./index");
    const instance: PageInstance = {
      data: { ...definition.data, id: "order-existing", order: { ...order, canPay: true } },
      setData(patch) { Object.assign(this.data, patch); },
    };
    instance.loadOrder = () => definition.loadOrder.call(instance);
    instance.refreshPaymentCountdown = () => definition.refreshPaymentCountdown.call(instance);

    const pay = definition.pay.call(instance);
    await flushPromises();
    expect(instance.data.paying).toBe(true);
    definition.onHide.call(instance);
    payment.resolve("returned");
    await pay;
    expect(openPaymentResult).not.toHaveBeenCalled();
    definition.onShow.call(instance);
    await flushPromises();
    expect(api.getOrder).toHaveBeenCalledTimes(1);
    expect(instance.data).toMatchObject({ error: "" });
    expect(openPaymentResult).toHaveBeenCalledWith("order", "order-existing", "returned");
  });

  it("uses server time for the countdown and disables payment at expiry", async () => {
    let now = Date.parse("2026-09-28T18:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const expiresAt = new Date(now + 90_000).toISOString();
    const order = {
      id: "order-countdown", orderNo: "COUNTDOWN", userId: "customer", campaignId: "campaign-1",
      serviceAreaId: "area-1", pickupPointId: "point-1", deliveryPlanId: "plan-1", status: "PENDING_PAYMENT",
      totalCents: 1290, createdAt: new Date(now).toISOString(), expiresAt, serverTime: new Date(now).toISOString(),
      items: [], deliveryPlan: null, partialRefunds: [], fulfillmentExceptions: [], communityQualityCases: [], pickupReceipts: [], cancellation: null,
    };
    const api = { getOrder: vi.fn(async () => order) };
    vi.doMock("../../utils/api", () => ({
      api, AuthExpiredError: class extends Error {},
      customerAuth: { captureSessionEpoch: () => 1, isLoggedIn: () => true },
      customerErrorMessage: (_error: unknown, fallback: string) => fallback,
    }));
    vi.doMock("../../utils/payment", () => ({ payOrder: vi.fn(), payOrderCheckout: vi.fn() }));
    vi.doMock("../../utils/payment-result-context", () => ({ openPaymentResult: vi.fn() }));
    vi.doMock("../../utils/auth-navigation", () => ({ navigateToCustomerLogin: vi.fn() }));
    vi.doMock("../../utils/auth-intent", () => ({ consumeCancelReturnSuppression: vi.fn(() => false) }));
    vi.stubGlobal("wx", {});
    let definition!: PageDefinition;
    vi.stubGlobal("Page", (page: unknown) => { definition = page as PageDefinition; });
    await import("./index");
    const instance: PageInstance = {
      data: { ...definition.data, id: order.id },
      setData(patch) { Object.assign(this.data, patch); },
    };
    instance.refreshPaymentCountdown = () => definition.refreshPaymentCountdown.call(instance);
    instance.refreshPaymentStateAfterExpiry = () => definition.refreshPaymentStateAfterExpiry.call(instance);
    await definition.loadOrder.call(instance);
    expect(instance.data).toMatchObject({ paymentCountdownText: "剩余支付时间 01:30" });
    expect(instance.data.order).toMatchObject({ canPay: true });

    now += 91_000;
    instance.refreshPaymentCountdown();
    await flushPromises();
    expect(instance.data.paymentCountdownText).toContain("正在核实支付状态");
    expect(instance.data.order).toMatchObject({ canPay: false, status: "PENDING_PAYMENT" });
    expect(api.getOrder).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("reloads after a hidden cancellation settles before restoring its action button", async () => {
    const cancellation = deferred<void>();
    const order = {
      id: "order-existing", status: "PENDING_PAYMENT", totalCents: 1290,
      createdAt: "2099-01-01T00:00:00.000Z", items: [], deliveryPlan: null,
      expiresAt: "2099-01-01T00:15:00.000Z", serverTime: new Date().toISOString(),
      partialRefunds: [], fulfillmentExceptions: [], communityQualityCases: [], pickupReceipts: [], cancellation: null,
    };
    const api = { getOrder: vi.fn(async () => order), cancelOrder: vi.fn(() => cancellation.promise) };
    vi.doMock("../../utils/api", () => ({
      api, AuthExpiredError: class extends Error {},
      customerAuth: { captureSessionEpoch: () => 1, isLoggedIn: () => true },
      customerErrorMessage: (_error: unknown, fallback: string) => fallback,
    }));
    vi.doMock("../../utils/payment", () => ({ payOrder: vi.fn(), payOrderCheckout: vi.fn() }));
    vi.doMock("../../utils/payment-result-context", () => ({ openPaymentResult: vi.fn() }));
    vi.doMock("../../utils/auth-navigation", () => ({ navigateToCustomerLogin: vi.fn() }));
    vi.doMock("../../utils/auth-intent", () => ({ consumeCancelReturnSuppression: vi.fn(() => false) }));
    vi.stubGlobal("wx", { showModal: vi.fn(async () => ({ confirm: true })), showToast: vi.fn() });
    let definition!: PageDefinition;
    vi.stubGlobal("Page", (page: unknown) => { definition = page as PageDefinition; });
    await import("./index");
    const instance: PageInstance = {
      data: { ...definition.data, id: "order-existing", order: { ...order, canCancel: true } },
      setData(patch) { Object.assign(this.data, patch); },
    };
    instance.loadOrder = () => definition.loadOrder.call(instance);

    const cancel = definition.cancel.call(instance);
    await flushPromises();
    expect(instance.data.cancelling).toBe(true);
    definition.onHide.call(instance);
    definition.onShow.call(instance);
    expect(instance.data.cancelling).toBe(true);
    cancellation.resolve();
    await cancel;
    await flushPromises();
    expect(api.getOrder).toHaveBeenCalledTimes(1);
    expect(instance.data.cancelling).toBe(false);
  });

  it("does not re-enable payment actions when the return status check fails", async () => {
    const api = { getOrder: vi.fn(async () => { throw new Error("offline"); }) };
    vi.doMock("../../utils/api", () => ({
      api, AuthExpiredError: class extends Error {},
      customerAuth: { captureSessionEpoch: () => 1, isLoggedIn: () => true },
      customerErrorMessage: (_error: unknown, fallback: string) => fallback,
    }));
    vi.doMock("../../utils/payment", () => ({ payOrder: vi.fn(), payOrderCheckout: vi.fn() }));
    vi.doMock("../../utils/payment-result-context", () => ({ openPaymentResult: vi.fn() }));
    vi.doMock("../../utils/auth-navigation", () => ({ navigateToCustomerLogin: vi.fn() }));
    vi.doMock("../../utils/auth-intent", () => ({ consumeCancelReturnSuppression: vi.fn(() => false) }));
    vi.stubGlobal("wx", {});
    let definition!: PageDefinition;
    vi.stubGlobal("Page", (page: unknown) => { definition = page as PageDefinition; });
    await import("./index");
    const instance: PageInstance = {
      data: { ...definition.data, id: "order-existing", paying: true, cancelling: true },
      setData(patch) { Object.assign(this.data, patch); },
    };
    instance.loadOrder = () => definition.loadOrder.call(instance);

    definition.onShow.call(instance);
    await flushPromises();
    expect(instance.data).toMatchObject({ paying: true, cancelling: true, loading: false, error: "订单详情加载失败，请稍后重试" });
    await definition.retryLoad.call(instance);
    expect(instance.data.paying).toBe(true);
  });
});
