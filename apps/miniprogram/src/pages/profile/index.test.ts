import { beforeEach, describe, expect, it, vi } from "vitest";

type PageDefinition = {
  data: Record<string, unknown>;
  openOrders: (event: { currentTarget: { dataset: { filter?: string } } }) => void;
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

  async function loadPage() {
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
    await import("./index");
    if (!definition) throw new Error("profile page was not registered");
    return { definition, navigateTo, switchTab };
  }

  it("sends a guest order entry through the existing auth intent", async () => {
    const { definition, navigateTo, switchTab } = await loadPage();
    definition.openOrders.call(definition, {
      currentTarget: { dataset: { filter: "READY" } },
    });

    expect(storage.get("orderFilter")).toBe("READY");
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/login/index?source=orders" });
    expect(switchTab).not.toHaveBeenCalled();
  });

  it("keeps a logged-in order entry on the orders tab", async () => {
    storage.set("hometown-demo-customer-session", true);
    const { definition, navigateTo, switchTab } = await loadPage();
    definition.openOrders.call(definition, {
      currentTarget: { dataset: { filter: "ALL" } },
    });

    expect(switchTab).toHaveBeenCalledWith({ url: "/pages/orders/index" });
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
