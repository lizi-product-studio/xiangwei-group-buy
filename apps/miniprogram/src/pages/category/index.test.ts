import { beforeEach, describe, expect, it, vi } from "vitest";

type CategoryPage = { data: Record<string, unknown>; setData?: (patch: Record<string, unknown>) => void; selectCategory: (event: unknown) => void; loadProducts: () => Promise<void> };

const mocks = vi.hoisted(() => ({
  listCampaigns: vi.fn(),
  loadServiceAreaContext: vi.fn(),
  readPickupPointSelection: vi.fn(),
  isCampaignPurchasable: vi.fn(),
}));
vi.mock("../../utils/api", () => ({ api: { listCampaigns: mocks.listCampaigns }, customerErrorMessage: (_error: unknown, fallback: string) => fallback }));
vi.mock("../../utils/service-area", () => ({ loadServiceAreaContext: mocks.loadServiceAreaContext }));
vi.mock("../../utils/pickup-point", () => ({ readPickupPointSelection: mocks.readPickupPointSelection }));
vi.mock("../../utils/consumer-display", () => ({ isCampaignPurchasable: mocks.isCampaignPurchasable, formatChinaDateTime: vi.fn(() => "今晚 21:00"), estimatedArrivalText: vi.fn(() => "到货后通知") }));
vi.mock("../../utils/cart", () => ({ addCartLine: vi.fn(), cartCount: vi.fn(() => 0), readCart: vi.fn() }));

describe("category page", () => {
  const storage = new Map<string, unknown>();
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      removeStorageSync: (key: string) => storage.delete(key),
      showToast: vi.fn(),
      showModal: vi.fn(),
    });
  });

  it("increments the image refresh key when returning from a category to all products", async () => {
    let page: CategoryPage | undefined;
    vi.stubGlobal("Page", (definition: CategoryPage) => { page = definition; return definition; });
    await import("./index");
    if (!page) throw new Error("category page was not registered");
    page.data = { allProducts: [{ category: "工具", skuId: "a" }, { category: "食品", skuId: "b" }], products: [], activeCategory: "全部", imageRefreshKey: 3 };
    page.setData = (patch) => Object.assign(page!.data, patch);
    page.selectCategory.call(page, { currentTarget: { dataset: { category: "工具" } } });
    expect(page.data.products).toHaveLength(1);
    expect(page.data.imageRefreshKey).toBe(4);
    page.selectCategory.call(page, { currentTarget: { dataset: { category: "全部" } } });
    expect(page.data.products).toHaveLength(2);
    expect(page.data.imageRefreshKey).toBe(5);
  });

  it("keeps a banner category intent until products finish loading on first entry", async () => {
    storage.set("categoryFilter", "工具");
    mocks.loadServiceAreaContext.mockResolvedValue({ selected: { id: "area-1", name: "服务区" } });
    mocks.readPickupPointSelection.mockReturnValue({ id: "point-1", name: "自提点", address: "测试地址" });
    mocks.isCampaignPurchasable.mockReturnValue(true);
    mocks.listCampaigns.mockResolvedValue([{ id: "campaign-1", title: "团期", serviceAreaId: "area-1", cutoffAt: "2099-01-01T00:00:00Z", dispatchAt: "2099-01-02T00:00:00Z", deliveryPlan: { pickupPointId: "point-1" }, items: [
      { skuId: "tool-1", title: "铅笔", skuName: "一支", category: "工具", origin: "定兴", imageUrl: null, unitPriceCents: 100, stock: 10, soldQuantity: 0 },
      { skuId: "food-1", title: "玉米", skuName: "一根", category: "食品", origin: "定兴", imageUrl: null, unitPriceCents: 200, stock: 10, soldQuantity: 0 },
    ] }]);
    let page: CategoryPage | undefined;
    vi.stubGlobal("Page", (definition: CategoryPage) => { page = definition; return definition; });
    await import("./index");
    if (!page) throw new Error("category page was not registered");
    page.setData = (patch) => Object.assign(page!.data, patch);
    await page.loadProducts.call(page);
    expect(page.data.activeCategory).toBe("工具");
    expect(page.data.products).toHaveLength(1);
    expect(storage.has("categoryFilter")).toBe(false);
  });
});
