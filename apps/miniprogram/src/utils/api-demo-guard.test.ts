import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDeployment } from "../config/deployment";
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
    ["production HTTPS even with demo capability", "https://liziqi.icu", true],
    ["demo capability disabled", "http://127.0.0.1:3100", false],
  ])("does not create a demo session for %s", async (_label, apiBaseUrl, enabled) => {
    const { customerAuth } = await loadApi({ apiBaseUrl, demoLoginEnabled: enabled });
    await expect(customerAuth.login(PRIVACY_NOTICE_VERSION)).rejects.toThrow(
      "开发登录仅可用于本地开发环境",
    );
    expect(storage.has("hometown-demo-customer-session")).toBe(false);
    expect(storage.has("hometown-privacy-notice-version")).toBe(false);
  });

  it("allows demo auth for the explicit local HTTP target and does not let stored state bypass the guard", async () => {
    const { api, customerAuth, app, request } = await loadApi();
    await expect(customerAuth.login(PRIVACY_NOTICE_VERSION)).resolves.toBeUndefined();
    expect(customerAuth.isLoggedIn()).toBe(true);
    expect(storage.get("hometown-demo-customer-session")).toBe(true);

    app.globalData.apiBaseUrl = "https://api.example.test";
    expect(customerAuth.isLoggedIn()).toBe(false);
    await expect(api.listOrders()).rejects.toThrow("当前环境未启用开发登录");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects remote demo requests even with stored demo identity", async () => {
    storage.set("hometown-demo-customer-session", true);
    const { api, customerAuth, request } = await loadApi({ apiBaseUrl: "https://liziqi.icu" });
    expect(customerAuth.isLoggedIn()).toBe(false);
    await expect(api.listOrders()).rejects.toThrow("当前环境未启用开发登录");
    expect(request).not.toHaveBeenCalled();
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
  it("uses wx.login and bearer auth at the default migrated target without demo headers", async () => {
    storage.set("hometown-demo-customer-session", true);
    const { api, customerAuth, request } = await loadApi(resolveDeployment("develop"));
    const login = vi.fn((options: { success: (result: { code: string }) => void }) => options.success({ code: "test-wechat-code" }));
    Object.assign(wx, { login });
    request.mockImplementation((options) => options.success({
      statusCode: 200,
      data: { data: options.url.endsWith("/auth/wechat/login") ? { accessToken: "test-wechat-token" } : [] },
    }));
    await customerAuth.login(PRIVACY_NOTICE_VERSION);
    await api.listOrders();
    expect(login).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      url: "https://liziqi.icu/api/v1/auth/wechat/login",
      data: { code: "test-wechat-code", privacyAccepted: true, privacyVersion: PRIVACY_NOTICE_VERSION },
    });
    expect(request.mock.calls[1]?.[0].header.authorization).toBe("Bearer test-wechat-token");
    for (const [options] of request.mock.calls) {
      expect(options.header).not.toHaveProperty("x-demo-user-id");
      expect(options.header).not.toHaveProperty("x-demo-role");
    }
  });

});
