import { beforeEach, describe, expect, it, vi } from "vitest";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

type CampaignDetailPage = {
  data: Record<string, unknown>;
  setData?: (patch: Record<string, unknown>) => void;
  onLoad: (options: Record<string, string | undefined>) => void;
  onShow: () => void;
  onHide: () => void;
  changeQuantity: (event: { currentTarget: { dataset: { step: number } } }) => void;
  retryLoad: () => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

vi.mock("../../utils/api", () => ({
  api: { getCampaign: vi.fn() },
  customerAuth: { captureSessionEpoch: vi.fn(() => 0) },
}));
vi.mock("../../utils/service-area", () => ({
  loadServiceAreaContext: vi.fn(async () => ({ selected: null })),
}));
vi.mock("../../utils/pickup-point", () => ({
  loadPickupPoints: vi.fn(async () => ({ points: [] })),
  readPickupPointSelection: vi.fn(() => null),
}));
vi.mock("../../utils/cart", () => ({
  addCartLine: vi.fn(),
  cartCount: vi.fn(() => 0),
  clearCart: vi.fn(),
  readCart: vi.fn(() => []),
  saveCheckoutDraft: vi.fn(),
}));

describe("campaign detail loading", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("getApp", () => ({ globalData: { apiBaseUrl: "https://api.example.test" } }));
    vi.stubGlobal("wx", {
      getStorageSync: vi.fn(),
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
      navigateTo: vi.fn(),
      showToast: vi.fn(),
      openLocation: vi.fn(),
      makePhoneCall: vi.fn(),
    });
  });

  it("keeps the latest retry result when an older request fails later", async () => {
    const first = deferred<CampaignDto>();
    const second = deferred<CampaignDto>();
    const campaign: CampaignDto = {
      id: "campaign-1",
      title: "社区团购测试团期",
      serviceAreaId: "area-1",
      deliveryPlan: null,
      pickupPoint: null,
      cutoffAt: "2099-01-01T00:00:00.000Z",
      dispatchAt: "2099-01-01T01:00:00.000Z",
      estimatedArrivalStartAt: "2099-01-02T00:00:00.000Z",
      estimatedArrivalEndAt: "2099-01-02T06:00:00.000Z",
      paidQuantity: 0,
      failureAction: "CANCEL_AND_REFUND",
      minTotalQuantity: 1,
      items: [
        {
          skuId: "sku-1",
          title: "应季蔬菜",
          category: "蔬菜",
          origin: "本地",
          skuName: "一份",
          imageUrl: "/api/v1/product-images/one.webp",
          imageUrls: ["/api/v1/product-images/one.webp", "/api/v1/product-images/two.webp"],
          description: "新鲜直采\n售后说明",
          detailImageUrls: ["/api/v1/product-images/detail.webp"],
          salesQuantity: 23,
          unitPriceCents: 100,
          stock: 10,
          soldQuantity: 0,
        },
      ],
      status: "CANCELLED",
    };
    const { api } = await import("../../utils/api");
    vi.mocked(api.getCampaign)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let definition: CampaignDetailPage | undefined;
    vi.stubGlobal("Page", (value: CampaignDetailPage) => {
      definition = value;
      return value;
    });
    await import("./detail");
    if (!definition) throw new Error("campaign detail page was not registered");
    definition.setData = (patch) => Object.assign(definition!.data, patch);

    definition.onLoad.call(definition, { id: campaign.id, skuId: "sku-1" });
    expect(definition.data.loading).toBe(true);
    definition.retryLoad.call(definition);
    expect(definition.data.loading).toBe(true);

    second.resolve(campaign);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(definition.data.campaign).toMatchObject({ id: campaign.id });
    expect(definition.data.error).toBe("");
    expect(definition.data.loading).toBe(false);
    expect(definition.data.gallery).toEqual(["https://api.example.test/api/v1/product-images/one.webp", "https://api.example.test/api/v1/product-images/two.webp"]);
    expect(definition.data.detailImages).toEqual([{ url: "https://api.example.test/api/v1/product-images/detail.webp", failed: false }]);
    expect(definition.data.product).toMatchObject({ salesQuantity: 23, description: "新鲜直采\n售后说明" });

    first.reject(new Error("GET /api/v1/campaigns/campaign-1 failed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(definition.data.campaign).toMatchObject({ id: campaign.id });
    expect(definition.data.error).toBe("");
    expect(definition.data.loading).toBe(false);
  });

  it("restarts an interrupted initial load on return without resetting the selected quantity", async () => {
    const first = deferred<CampaignDto>();
    const second = deferred<CampaignDto>();
    const campaign: CampaignDto = {
      id: "campaign-1", title: "社区团购测试团期", serviceAreaId: "area-1", deliveryPlan: null, pickupPoint: null,
      cutoffAt: "2099-01-01T00:00:00.000Z", dispatchAt: "2099-01-01T01:00:00.000Z",
      estimatedArrivalStartAt: "2099-01-02T00:00:00.000Z", estimatedArrivalEndAt: "2099-01-02T06:00:00.000Z",
      paidQuantity: 0, failureAction: "CANCEL_AND_REFUND", minTotalQuantity: 1,
      items: [{ skuId: "sku-1", title: "应季蔬菜", category: "蔬菜", origin: "本地", skuName: "一份",
        imageUrl: "/one.webp", salesQuantity: 0, unitPriceCents: 100, stock: 10, soldQuantity: 0 }], status: "CANCELLED",
    };
    const { api } = await import("../../utils/api");
    const callBaseline = vi.mocked(api.getCampaign).mock.calls.length;
    vi.mocked(api.getCampaign).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let definition: CampaignDetailPage | undefined;
    vi.stubGlobal("Page", (value: CampaignDetailPage) => { definition = value; return value; });
    await import("./detail");
    if (!definition) throw new Error("campaign detail page was not registered");
    definition.setData = (patch) => Object.assign(definition!.data, patch);

    definition.onLoad.call(definition, { id: campaign.id, skuId: "sku-1" });
    definition.onShow.call(definition);
    definition.changeQuantity.call(definition, { currentTarget: { dataset: { step: 2 } } });
    expect(definition.data.quantity).toBe(3);
    definition.onHide.call(definition);
    definition.onShow.call(definition);
    expect(api.getCampaign).toHaveBeenCalledTimes(callBaseline + 2);

    second.resolve(campaign);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    first.resolve({ ...campaign, title: "旧响应" });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(definition.data).toMatchObject({ campaign: { title: "社区团购测试团期" }, quantity: 3, total: "3.00", loading: false });
  });
});
