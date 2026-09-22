import { beforeEach, describe, expect, it, vi } from "vitest";

type PageDefinition = {
  data: Record<string, unknown>;
  setData: (patch: Record<string, unknown>) => void;
  openOrders: (event: { currentTarget: { dataset: { filter?: string } } }) => void;
  loadArea: () => Promise<void>;
  logout: () => Promise<void>;
};

describe("profile page protected entry behavior", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.resetModules();
    vi.stubGlobal("getApp", () => ({
      globalData: {
        apiBaseUrl: "http://127.0.0.1:3100",
        authMode: "demo",
        demoLoginEnabled: true,
        accessToken: null,
        subscriptionTemplates: [],
      },
    }));
  });

  async function loadPage(options: { areaError?: boolean } = {}) {
    const navigateTo = vi.fn(() => Promise.resolve());
    const switchTab = vi.fn(() => Promise.resolve());
    const request = vi.fn();
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      navigateTo,
      navigateBack: vi.fn(() => Promise.resolve()),
      redirectTo: vi.fn(() => Promise.resolve()),
      switchTab,
      showToast: vi.fn(() => Promise.resolve()),
      showModal: vi.fn(() => Promise.resolve({ confirm: true })),
      request,
    });
    let definition: PageDefinition | undefined;
    vi.stubGlobal("Page", (value: unknown) => {
      definition = value as PageDefinition;
      return value;
    });
    vi.doMock("../../utils/service-area", () => ({
      loadServiceAreaContext: options.areaError
        ? vi.fn(async () => {
            throw new Error("GET /api/v1/service-areas failed");
          })
        : vi.fn(async () => ({ selected: null })),
    }));
    vi.doMock("../../utils/pickup-point", () => ({
      loadPickupPoints: vi.fn(async () => ({ points: [], selected: null })),
    }));
    await import("./index");
    if (!definition) throw new Error("profile page was not registered");
    definition.setData = (patch) => Object.assign(definition!.data, patch);
    return { definition, navigateTo, switchTab };
  }

  it("sends a guest order entry through the existing auth intent", async () => {
    const { definition, navigateTo, switchTab } = await loadPage();
    definition.openOrders.call(definition, {
      currentTarget: { dataset: { filter: "READY" } },
    });

    expect(storage.get("orderFilter")).toBe("READY");
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/login/index?source=orders" , complete: expect.any(Function) });
    expect(switchTab).not.toHaveBeenCalled();
  });

  it("opens logged-in orders as a regular page from the profile tab", async () => {
    storage.set("hometown-demo-customer-session", true);
    const { definition, navigateTo, switchTab } = await loadPage();
    definition.openOrders.call(definition, {
      currentTarget: { dataset: { filter: "ALL" } },
    });

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/orders/index" });
    expect(switchTab).not.toHaveBeenCalled();
  });

  it("keeps area failures separate from the order summary and offers an area retry", async () => {
    const { definition } = await loadPage({ areaError: true });
    await definition.loadArea.call(definition);

    expect(definition.data.areaError).toBe(
      "本地服务未启动，请在项目根目录运行 pnpm dev 后重试",
    );
    expect(definition.data.pickupPoint).toBeNull();
  });
});
