import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVACY_NOTICE_VERSION } from "../config/legal";

describe("development demo auth guard", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  async function loadApi(
    overrides: Partial<{
      apiBaseUrl: string;
      authMode: "demo" | "wechat";
      demoLoginEnabled: boolean;
    }> = {},
  ) {
    const request = vi.fn();
    const app = {
      globalData: {
        apiBaseUrl: overrides.apiBaseUrl ?? "http://127.0.0.1:3100",
        authMode: overrides.authMode ?? ("demo" as const),
        demoLoginEnabled: overrides.demoLoginEnabled ?? true,
        accessToken: null,
        subscriptionTemplates: [],
      },
    };
    vi.stubGlobal("getApp", () => app);
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      request,
    });
    const apiModule = await import("./api");
    return { ...apiModule, app, request };
  }

  it.each([
    ["HTTPS", "https://127.0.0.1:3100", true],
    ["unapproved HTTP", "http://unapproved.example.test", true],
    ["remote demo with explicit port", "http://180.76.100.156:9999", true],
    ["demo capability disabled", "http://127.0.0.1:3100", false],
  ])("does not create a demo session for %s", async (_label, apiBaseUrl, enabled) => {
    const { customerAuth } = await loadApi({ apiBaseUrl, demoLoginEnabled: enabled });
    await expect(customerAuth.login(PRIVACY_NOTICE_VERSION)).rejects.toThrow(
      "开发登录仅可用于本地开发环境",
    );
    expect(storage.has("hometown-demo-customer-session")).toBe(false);
    expect(storage.has("hometown-privacy-notice-version")).toBe(false);
  });

  it("allows demo auth for the approved remote develop HTTP target and does not let stored state bypass the guard", async () => {
    const { api, customerAuth, app, request } = await loadApi();
    await expect(customerAuth.login(PRIVACY_NOTICE_VERSION)).resolves.toBeUndefined();
    expect(customerAuth.isLoggedIn()).toBe(true);
    expect(storage.get("hometown-demo-customer-session")).toBe(true);

    app.globalData.apiBaseUrl = "https://api.example.test";
    expect(customerAuth.isLoggedIn()).toBe(false);
    await expect(api.listOrders()).rejects.toThrow("当前环境未启用开发登录");
    expect(request).not.toHaveBeenCalled();
  });

  it("allows an explicitly configured shared remote demo target", async () => {
    const { customerAuth } = await loadApi({ apiBaseUrl: "http://180.76.100.156" });
    await expect(customerAuth.login(PRIVACY_NOTICE_VERSION)).resolves.toBeUndefined();
    expect(customerAuth.isLoggedIn()).toBe(true);
  });

  it("requires the current privacy version before writing any session state", async () => {
    const { customerAuth } = await loadApi();
    await expect(customerAuth.login("old-version")).rejects.toThrow(
      "请先阅读并同意最新隐私说明",
    );
    expect(storage.has("hometown-demo-customer-session")).toBe(false);
    expect(storage.has("hometown-privacy-notice-version")).toBe(false);
  });

  it("does not allow a wechat-mode app to use a stored demo session", async () => {
    storage.set("hometown-demo-customer-session", true);
    const { customerAuth } = await loadApi({ authMode: "wechat" });
    expect(customerAuth.isLoggedIn()).toBe(false);
  });
});
