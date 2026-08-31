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
};

type CheckoutPageDefinition = {
  data: Record<string, unknown>;
  loadCheckout: (this: CheckoutPageInstance) => Promise<void>;
  submitOrder: (this: CheckoutPageInstance) => Promise<void>;
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

  async function loadPage() {
    const campaign = validCampaign();
    const requests: RequestOption[] = [];
    const navigateTo = vi.fn(() => Promise.resolve());
    const redirectTo = vi.fn(() => Promise.resolve());
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
      showModal,
      showToast: vi.fn(() => Promise.resolve()),
      request: vi.fn((request: RequestOption) => {
        requests.push(request);
        const path = request.url.replace(app.globalData.apiBaseUrl, "");
        if (path === "/api/v1/campaigns/campaign-1") {
          request.success?.({ statusCode: 200, data: { data: campaign } });
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
        } else if (path === "/api/v1/orders/order-1/pay") {
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
    };
    storage.set("checkoutDraft", validDraft());
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
    return { app, requests, navigateTo, redirectTo, showModal, page, instance };
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
    expect(navigateTo).toHaveBeenCalledWith({ url: expect.stringContaining("/pages/login/index") });
    expect(JSON.parse(String(storage.get("hometown-auth-intent")))).toMatchObject({
      source: "checkout",
      writeAction: "submit-order",
    });
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
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({ title: "订单已提交" }));
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/order-detail/index?id=order-1" });
  });
});
