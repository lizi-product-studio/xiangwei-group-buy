import { beforeEach, describe, expect, it, vi } from "vitest";

type PageInstance = {
  data: Record<string, unknown>;
  setData: (patch: Record<string, unknown>) => void;
};

type PageDefinition = {
  data: Record<string, unknown>;
  submit: (this: PageInstance) => Promise<void>;
};

describe("after-sale page multi-item submission", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    storage.set("hometown-demo-customer-session", true);
    vi.resetModules();
  });

  it("submits every selected SKU with its own quantity, reason and description", async () => {
    const requests: Array<{ url: string; method?: string; data?: unknown }> = [];
    const showModal = vi.fn(() => Promise.resolve({ confirm: true }));
    vi.stubGlobal("getApp", () => ({
      globalData: {
        apiBaseUrl: "http://127.0.0.1:3100",
        authMode: "demo",
        demoLoginEnabled: true,
        accessToken: null,
        subscriptionTemplates: [],
      },
    }));
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      showToast: vi.fn(() => Promise.resolve()),
      showModal,
      navigateBack: vi.fn(() => Promise.resolve()),
      navigateTo: vi.fn(() => Promise.resolve()),
      request: vi.fn((request: {
        url: string;
        method?: string;
        data?: unknown;
        success?: (response: unknown) => void;
      }) => {
        requests.push(request);
        request.success?.({ statusCode: 201, data: { data: { id: "case-1" } } });
      }),
    });
    let definition: PageDefinition | undefined;
    vi.stubGlobal("Page", (value: unknown) => {
      definition = value as PageDefinition;
      return value;
    });
    await import("./index");
    if (!definition) throw new Error("after-sale page was not registered");
    const instance: PageInstance = {
      data: {
        ...(JSON.parse(JSON.stringify(definition.data)) as Record<string, unknown>),
        orderId: "order-1",
        claimRequestId: "claim-order-1",
        submitting: false,
        order: { id: "order-1", status: "READY_FOR_PICKUP" },
        claimRows: [
          {
            skuId: "sku-eggs",
            name: "土鸡蛋",
            maxQuantity: 3,
            quantity: 2,
            selected: true,
            reasonIndex: 0,
            description: "鸡蛋存在明显品质问题",
          },
          {
            skuId: "sku-beef",
            name: "酱牛肉",
            maxQuantity: 2,
            quantity: 1,
            selected: true,
            reasonIndex: 2,
            description: "包装破损并有明显渗漏",
          },
        ],
      },
      setData(patch) {
        Object.assign(this.data, patch);
      },
    };

    await definition.submit.call(instance);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      data: {
        clientRequestId: "claim-order-1",
        items: [
          {
            catalogSkuId: "sku-eggs",
            quantity: 2,
            reason: "QUALITY_CLAIM",
            description: "鸡蛋存在明显品质问题",
          },
          {
            catalogSkuId: "sku-beef",
            quantity: 1,
            reason: "PICKUP_DAMAGE",
            description: "包装破损并有明显渗漏",
          },
        ],
      },
    });
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({ title: "已提交售后申请" }));
  });
});
