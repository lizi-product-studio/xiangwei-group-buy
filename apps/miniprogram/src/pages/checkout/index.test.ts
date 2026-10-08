import { beforeEach, describe, expect, it, vi } from "vitest";

type RequestOption = {
  url: string;
  method?: string;
  data?: unknown;
  success?: (response: unknown) => void;
  fail?: (error: { errMsg?: string }) => void;
};

type CheckoutPageInstance = {
  data: Record<string, unknown>;
  setData: (patch: Record<string, unknown>) => void;
  loadMultiCheckout: (loadGuard: unknown) => Promise<void>;
  submitMultiOrder: () => Promise<void>;
};

type CheckoutPageDefinition = {
  data: Record<string, unknown>;
  onLoad: (this: CheckoutPageInstance, options: Record<string, string | undefined>) => void;
  loadCheckout: (this: CheckoutPageInstance) => Promise<void>;
  loadMultiCheckout: (this: CheckoutPageInstance, loadGuard: unknown) => Promise<void>;
  submitMultiOrder: (this: CheckoutPageInstance) => Promise<void>;
  submitOrder: (this: CheckoutPageInstance) => Promise<void>;
  backToCart: (this: CheckoutPageInstance) => void;
};

function validCampaign() {
  return {
    id: "campaign-1",
    title: "当季蔬菜团",
    serviceAreaId: "area-1",
    status: "OPEN" as const,
    cutoffAt: "2099-01-01T00:00:00.000Z",
    dispatchAt: "2099-01-01T01:00:00.000Z",
    estimatedArrivalStartAt: "2099-01-02T00:00:00.000Z",
    estimatedArrivalEndAt: "2099-01-02T02:00:00.000Z",
    deliveryPlan: {
      id: "plan-1",
      campaignId: "campaign-1",
      serviceAreaId: "area-1",
      pickupPointId: "point-1",
      status: "SITE_CONFIRMED" as const,
      siteName: "幸福自提点",
      address: "幸福路 1 号",
      arrivalStartAt: "2099-01-02T00:00:00.000Z",
      arrivalEndAt: "2099-01-02T02:00:00.000Z",
    },
    items: [{
      skuId: "sku-1",
      title: "有机番茄",
      category: "蔬菜",
      skuName: "500g",
      origin: "本地",
      imageUrl: null,
      unitPriceCents: 1290,
      stock: 20,
      soldQuantity: 0,
    }],
    failureAction: "CANCEL_AND_REFUND" as const,
    minTotalQuantity: 1,
  };
}

function validDraft() {
  return {
    source: "buyNow" as const,
    campaignId: "campaign-1",
    campaignTitle: "当季蔬菜团",
    serviceAreaId: "area-1",
    serviceAreaName: "幸福区",
    pickupPointId: "point-1",
    pickupPointName: "幸福自提点",
    pickupPointAddress: "幸福路 1 号",
    items: [{
      skuId: "sku-1",
      title: "有机番茄",
      skuName: "500g",
      imageUrl: null,
      unitPriceCents: 1290,
      quantity: 2,
      maxQuantity: 20,
    }],
    updatedAt: Date.now(),
  };
}

describe("checkout page guest/auth handoff", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  async function loadPage(
    options: { createFailure?: boolean; paymentFailure?: boolean; multiCheckout?: boolean; mixedMultiCheckout?: boolean } = {},
  ) {
    const campaign = validCampaign();
    const requests: RequestOption[] = [];
    const navigateTo = vi.fn(() => Promise.resolve());
    const redirectTo = vi.fn(() => Promise.resolve());
    const switchTab = vi.fn(() => Promise.resolve());
    const showModal = vi.fn(() => Promise.resolve({ confirm: true }));
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
      navigateTo,
      redirectTo,
      switchTab,
      showModal,
      showToast: vi.fn(() => Promise.resolve()),
      request: vi.fn((request: RequestOption) => {
        requests.push(request);
        const path = request.url.replace(app.globalData.apiBaseUrl, "");
        if (path.startsWith("/api/v1/campaigns/")) {
          const pathParts = path.split("/");
          const campaignId = pathParts[pathParts.length - 1]!;
          request.success?.({ statusCode: 200, data: { data: {
            ...campaign,
            id: campaignId,
            title: campaignId === "campaign-2" ? "第二个团期 · 标题较长用于检查换行" : campaign.title,
            minTotalQuantity: campaignId === "campaign-2" ? 7 : 3,
            failureAction: campaignId === "campaign-2" ? "POSTPONE" as const : "CANCEL_AND_REFUND" as const,
          } } });
        } else if (path === "/api/v1/service-areas") {
          request.success?.({ statusCode: 200, data: { data: [{
            id: "area-1",
            regionCode: "5101",
            name: "幸福区",
            status: "ENABLED",
            orderEnabled: true,
          }] } });
        } else if (path === "/api/v1/pickup-points?serviceAreaId=area-1") {
          request.success?.({ statusCode: 200, data: { data: [{
            id: "point-1",
            serviceAreaId: "area-1",
            name: "幸福自提点",
            address: "幸福路 1 号",
            businessHours: "09:00-18:00",
            pickupInstructions: "凭提货信息领取",
            latitude: 30,
            longitude: 104,
            contactName: "点位负责人",
            contactPhone: "13800000000",
            status: "ACTIVE",
            capacityPerDay: null,
          }] } });
        } else if (request.method === "POST" && path === "/api/v1/orders") {
          if (options.createFailure) {
            request.fail?.({ errMsg: "create service unavailable" });
            return;
          }
          request.success?.({ statusCode: 200, data: { data: {
            id: "order-1",
            orderNo: "NO-1",
            campaignId: "campaign-1",
            serviceAreaId: "area-1",
            pickupPointId: "point-1",
            deliveryPlanId: "plan-1",
            deliveryPlan: campaign.deliveryPlan,
            status: "PENDING_PAYMENT",
            totalCents: 2580,
            createdAt: "2099-01-01T00:00:00.000Z",
            expiresAt: "2099-01-01T00:15:00.000Z",
            paidAt: null,
            pickedUpAt: null,
            items: [],
          } } });
        } else if (request.method === "POST" && path === "/api/v1/order-checkouts") {
          const data = request.data as { groups: Array<{ campaignId: string; serviceAreaId: string; pickupPointId: string; items: Array<{ skuId: string; quantity: number }> }> };
          request.success?.({ statusCode: 201, data: { data: {
            checkoutBatch: { id: "batch-1", status: "PENDING_PAYMENT", totalCents: 2580, expiresAt: "2099-01-01T00:15:00.000Z" },
            orders: data.groups.map((group, index) => ({
              id: `batch-order-${index + 1}`,
              orderNo: `BATCH-${index + 1}`,
              campaignId: group.campaignId,
              serviceAreaId: group.serviceAreaId,
              pickupPointId: group.pickupPointId,
              status: "PENDING_PAYMENT",
              totalCents: 2580,
              items: group.items.map((item) => ({ ...item, unitPriceCents: 1290, amountCents: item.quantity * 1290 })),
            })),
          } } });
        } else if (path === "/api/v1/order-checkouts/batch-1/pay") {
          request.success?.({ statusCode: 200, data: { data: { provider: "mock", status: "READY", clientPayload: {} } } });
        } else if (path === "/api/v1/order-checkouts/batch-1/pay/mock-confirm") {
          request.success?.({ statusCode: 200, data: { data: { status: "PAID" } } });
        } else if (path === "/api/v1/orders/order-1/pay") {
          if (options.paymentFailure) {
            request.fail?.({ errMsg: "payment provider unavailable" });
            return;
          }
          request.success?.({ statusCode: 200, data: { data: {
            provider: "mock",
            status: "READY",
            clientPayload: {},
          } } });
        } else if (path === "/api/v1/orders/order-1/pay/mock-confirm") {
          request.success?.({ statusCode: 200, data: { data: {} } });
        } else {
          request.fail?.({ errMsg: `unexpected request ${request.url}` });
        }
      }),
    });

    let registeredPage: CheckoutPageDefinition | undefined;
    vi.stubGlobal("Page", (definition: unknown) => {
      registeredPage = definition as CheckoutPageDefinition;
      return definition;
    });
    await import("./index");
    if (!registeredPage) throw new Error("checkout page was not registered");
    const page = registeredPage;
    const instance: CheckoutPageInstance = {
      data: JSON.parse(JSON.stringify(page.data)) as Record<string, unknown>,
      setData(patch: Record<string, unknown>) {
        Object.assign(this.data, patch);
      },
      loadMultiCheckout(loadGuard: unknown) { return page.loadMultiCheckout.call(instance, loadGuard as never); },
      submitMultiOrder() { return page.submitMultiOrder.call(instance); },
    };
    if (options.multiCheckout) {
      const group = { ...validDraft(), source: "cart" as const, updatedAt: 12 };
      const second = options.mixedMultiCheckout ? { ...group, campaignId: "campaign-2", campaignTitle: "旧标题", updatedAt: 13 } : null;
      const groups = second ? [group, second] : [group];
      storage.set("standardCart", { version: 2, groups });
      storage.set("multiCheckoutDraft", { groups, sourceCartGroups: groups.map(value => ({ campaignId: value.campaignId, pickupPointId: value.pickupPointId, updatedAt: value.updatedAt })), updatedAt: 12 });
      page.onLoad.call(instance, { source: "multi" });
    } else {
      storage.set("checkoutDraft", validDraft());
      page.onLoad.call(instance, {});
    }
    storage.set("selectedServiceArea", {
      id: "area-1",
      regionCode: "5101",
      name: "幸福区",
      status: "ENABLED",
      orderEnabled: true,
    });
    storage.set("selectedPickupPoint", {
      id: "point-1",
      serviceAreaId: "area-1",
      name: "幸福自提点",
      address: "幸福路 1 号",
      businessHours: "09:00-18:00",
      pickupInstructions: "凭提货信息领取",
      latitude: 30,
      longitude: 104,
      contactName: "点位负责人",
      contactPhone: "13800000000",
      status: "ACTIVE",
      capacityPerDay: null,
    });
    return {
      app,
      requests,
      navigateTo,
      redirectTo,
      switchTab,
      showModal,
      page,
      instance,
    };
  }

  async function settle() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("renders a valid guest draft and does not write before login", async () => {
    const { page, instance, requests, navigateTo } = await loadPage();
    await page.loadCheckout.call(instance);
    await settle();
    expect(instance.data.items).toHaveLength(1);
    expect((instance.data.items as Array<Record<string, unknown>>)[0]?.quantity).toBe(2);
    expect((instance.data.pickupPoint as { name: string }).name).toBe("幸福自提点");
    expect(instance.data.total).toBe("25.80");

    await page.submitOrder.call(instance);
    const writes = requests.filter((request) => request.method === "POST" && request.url.includes("/api/v1/orders"));
    expect(writes).toHaveLength(0);
    expect(navigateTo).toHaveBeenCalledWith({ url: expect.stringContaining("/pages/login/index") , complete: expect.any(Function) });
    expect(JSON.parse(String(storage.get("hometown-auth-intent")))).toMatchObject({
      source: "checkout",
      writeAction: "submit-order",
    });
  });

  it("keeps an invalidated checkout recoverable through the cart without deleting its contents", async () => {
    const { page, instance, switchTab } = await loadPage();
    const draft = storage.get("checkoutDraft");
    storage.delete("checkoutDraft");
    storage.set("standardCart", draft);
    await page.loadCheckout.call(instance);
    expect(instance.data.error).toBe("结算商品已失效，请返回购物车重新选择");
    expect(storage.has("standardCart")).toBe(true);

    page.backToCart.call(instance);
    expect(switchTab).toHaveBeenCalledWith({ url: "/pages/cart/index" });
    expect(storage.has("standardCart")).toBe(true);
  });

  it("returns to cart from the normal multi-checkout entry and keeps cart contents", async () => {
    const cartEntry = await loadPage({ multiCheckout: true });
    await cartEntry.page.loadCheckout.call(cartEntry.instance);
    await settle();
    cartEntry.page.backToCart.call(cartEntry.instance);
    expect(cartEntry.switchTab).toHaveBeenCalledWith({ url: "/pages/cart/index" });
    expect(storage.has("standardCart")).toBe(true);
  });

  it("returns to cart from a direct checkout entry without relying on a page stack", async () => {
    const directEntry = await loadPage();
    await directEntry.page.loadCheckout.call(directEntry.instance);
    await settle();
    directEntry.page.backToCart.call(directEntry.instance);
    expect(directEntry.switchTab).toHaveBeenCalledWith({ url: "/pages/cart/index" });
    expect(storage.has("checkoutDraft")).toBe(true);
  });

  it("blocks return navigation while order/payment submission is processing", async () => {
    const { page, instance, switchTab } = await loadPage();
    instance.data.submitting = true;
    page.backToCart.call(instance);
    expect(switchTab).not.toHaveBeenCalled();
  });

  it("restores the draft after login and only submits on the second tap", async () => {
    const { page, instance, requests, redirectTo, showModal } = await loadPage();
    await page.loadCheckout.call(instance);
    await settle();
    storage.set("hometown-demo-customer-session", true);
    await page.loadCheckout.call(instance);
    await settle();
    expect(instance.data.items).toHaveLength(1);
    expect((instance.data.pickupPoint as { name: string }).name).toBe("幸福自提点");
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);

    await page.submitOrder.call(instance);
    await settle();
    const writes = requests.filter((request) => request.method === "POST");
    expect(writes.filter((request) => request.url.endsWith("/api/v1/orders"))).toHaveLength(1);
    expect(writes.filter((request) => request.url.endsWith("/pay"))).toHaveLength(1);
    expect(writes.filter((request) => request.url.endsWith("/pay/mock-confirm"))).toHaveLength(1);
    expect(showModal).not.toHaveBeenCalled();
    expect(redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/payment-result/index?resource=order&id=order-1&outcome=returned" }));
  });

  it("keeps the created order, checkout draft and cart after an uncertain payment initiation", async () => {
    const { page, instance, requests, redirectTo, showModal } = await loadPage({
      paymentFailure: true,
    });
    storage.set("hometown-demo-customer-session", true);
    storage.set("standardCart", { ...validDraft(), source: "cart" });
    await page.loadCheckout.call(instance);
    await settle();

    await page.submitOrder.call(instance);
    await settle();

    expect(requests.filter((request) => request.method === "POST" && request.url.endsWith("/api/v1/orders"))).toHaveLength(1);
    expect(requests.filter((request) => request.method === "POST" && request.url.endsWith("/pay"))).toHaveLength(1);
    expect(requests.filter((request) => request.method === "POST" && request.url.endsWith("/pay/mock-confirm"))).toHaveLength(0);
    expect(storage.has("checkoutDraft")).toBe(true);
    expect(storage.has("standardCart")).toBe(true);
    expect(showModal).not.toHaveBeenCalled();
    expect(redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/payment-result/index?resource=order&id=order-1&outcome=uncertain" }));
  });

  it("shows each multi-checkout group's own threshold and failure action", async () => {
    const { page, instance } = await loadPage({ multiCheckout: true, mixedMultiCheckout: true });
    await page.loadCheckout.call(instance);
    await settle();
    const groups = instance.data.groups as Array<{ minimumQuantity: number; failureRuleText: string; campaignTitle: string }>;
    expect(groups.map(value => [value.minimumQuantity, value.failureRuleText])).toEqual([
      [3, expect.stringContaining("全额退款")],
      [7, expect.stringContaining("延期一次")],
    ]);
    expect(groups[1]?.campaignTitle).toBe("第二个团期 · 标题较长用于检查换行");
  });

  it("carries the original cart version across multi-checkout draft revalidation", async () => {
    const { page, instance, redirectTo } = await loadPage({ multiCheckout: true });
    await page.loadCheckout.call(instance);
    await settle();
    const revalidatedDraft = storage.get("multiCheckoutDraft") as { groups: Array<{ updatedAt: number }>; sourceCartGroups: Array<{ updatedAt: number }> };
    expect(revalidatedDraft.groups[0]?.updatedAt).not.toBe(12);
    expect(revalidatedDraft.sourceCartGroups).toEqual([{ campaignId: "campaign-1", pickupPointId: "point-1", updatedAt: 12 }]);

    storage.set("hometown-demo-customer-session", true);
    await page.submitOrder.call(instance);
    await settle();

    expect(redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/payment-result/index?resource=checkout&id=batch-1&outcome=returned" }));
    expect(storage.get("payment-result-context:checkout:batch-1")).toMatchObject({
      cartGroups: [{ campaignId: "campaign-1", pickupPointId: "point-1", updatedAt: 12 }],
    });
  });

  it("uses a creation-specific recoverable message and no order redirect when creation fails", async () => {
    const { page, instance, requests, redirectTo, showModal } = await loadPage({
      createFailure: true,
    });
    storage.set("hometown-demo-customer-session", true);
    await page.loadCheckout.call(instance);
    await settle();

    await page.submitOrder.call(instance);
    await settle();

    expect(requests.filter((request) => request.method === "POST" && request.url.endsWith("/api/v1/orders"))).toHaveLength(1);
    expect(requests.filter((request) => request.method === "POST" && request.url.endsWith("/pay"))).toHaveLength(0);
    expect(showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "订单提交失败",
        content: "订单提交失败，请稍后重试。",
        showCancel: false,
      }),
    );
    expect(redirectTo).not.toHaveBeenCalled();
  });
});
