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
};

type PageDefinition = {
  data: Record<string, unknown>;
  loadOrder: (this: PageInstance) => Promise<void>;
  pay: (this: PageInstance) => Promise<void>;
};

describe("order detail payment recovery", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  it("continues payment on the existing order without creating another order", async () => {
    const requests: RequestOption[] = [];
    const showModal = vi.fn(() => Promise.resolve({ confirm: false }));
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
    expect(showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "支付未完成",
        content: "支付暂未完成，请稍后在订单详情继续支付。",
      }),
    );
  });
});
