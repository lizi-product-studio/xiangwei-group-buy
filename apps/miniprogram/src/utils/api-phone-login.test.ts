import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVACY_NOTICE_VERSION } from "../config/legal";

type RequestOptions = {
  url: string;
  data: Record<string, unknown>;
  success: (result: { statusCode: number; data: unknown }) => void;
  fail: (error: unknown) => void;
};

describe("WeChat phone binding login", () => {
  const storage = new Map<string, unknown>();
  beforeEach(() => { storage.clear(); vi.resetModules(); });

  async function load() {
    let nextCode = 0;
    const pending: RequestOptions[] = [];
    const app = { globalData: { apiBaseUrl: "https://api.example.test", authMode: "wechat", accessToken: null as string | null, subscriptionTemplates: [] } };
    const login = vi.fn((options: { success: (result: { code: string }) => void }) => options.success({ code: `identity-${++nextCode}` }));
    const request = vi.fn((options: RequestOptions) => pending.push(options));
    vi.stubGlobal("getApp", () => app);
    vi.stubGlobal("wx", {
      login, request,
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
    });
    const module = await import("./api");
    return { ...module, app, login, request, pending };
  }
  const success = (accessToken: string) => ({ phoneRequired: false, accessToken, userId: "user-1", expiresAt: "2099-01-01T00:00:00Z" });
  const respond = (request: RequestOptions, data: unknown, statusCode = 200) => request.success({ statusCode, data: { data } });
  const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

  it("does not establish a session until phone authorization succeeds with a fresh identity code", async () => {
    const { customerAuth, pending, login } = await load();
    const first = customerAuth.loginWechat(PRIVACY_NOTICE_VERSION);
    await tick();
    respond(pending[0]!, { phoneRequired: true });
    await expect(first).resolves.toBe("PHONE_REQUIRED");
    expect(customerAuth.isLoggedIn()).toBe(false);
    expect(customerAuth.getSessionEpoch()).toBe(0);
    expect(storage.size).toBe(0);
    const binding = customerAuth.loginWechat(PRIVACY_NOTICE_VERSION, "phone-once");
    await tick();
    expect(pending[0]!.data).toEqual({ code: "identity-1", privacyAccepted: true, privacyVersion: PRIVACY_NOTICE_VERSION });
    expect(pending[1]!.data).toEqual({ code: "identity-2", phoneCode: "phone-once", privacyAccepted: true, privacyVersion: PRIVACY_NOTICE_VERSION });
    respond(pending[1]!, success("bound-token"));
    await expect(binding).resolves.toBe("AUTHENTICATED");
    expect(customerAuth.isLoggedIn()).toBe(true);
    expect(customerAuth.getSessionEpoch()).toBe(1);
    expect([...storage.values()]).not.toContain("phone-once");
    await expect(customerAuth.loginWechat(PRIVACY_NOTICE_VERSION)).resolves.toBe("AUTHENTICATED");
    expect(login).toHaveBeenCalledTimes(2);
  });

  it("lets an already-bound identity log in without a phone code", async () => {
    const { customerAuth, pending } = await load();
    const attempt = customerAuth.loginWechat(PRIVACY_NOTICE_VERSION);
    await tick();
    respond(pending[0]!, success("returning-token"));
    await expect(attempt).resolves.toBe("AUTHENTICATED");
    expect(pending[0]!.data).not.toHaveProperty("phoneCode");
  });

  it("does not reuse a stale-privacy token or silently restart login from protected API calls", async () => {
    const { customerAuth, api, AuthExpiredError, app, pending, login } = await load();
    app.globalData.accessToken = "old-token";
    storage.set("accessToken", "old-token");
    storage.set("hometown-privacy-notice-version", "2026-08-12");
    expect(customerAuth.isLoggedIn()).toBe(false);
    const attempt = customerAuth.loginWechat(PRIVACY_NOTICE_VERSION);
    await tick();
    respond(pending[0]!, { phoneRequired: true });
    await expect(attempt).resolves.toBe("PHONE_REQUIRED");
    await expect(api.listOrders()).rejects.toBeInstanceOf(AuthExpiredError);
    expect(login).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);
    expect(app.globalData.accessToken).toBeNull();
    expect(storage.get("hometown-privacy-notice-version")).toBe("2026-08-12");
  });

  it("forgets a failed or expired phone code and permits a fresh retry", async () => {
    const { customerAuth, pending } = await load();
    const attempt = customerAuth.loginWechat(PRIVACY_NOTICE_VERSION, "expired-phone");
    await tick();
    pending[0]!.success({ statusCode: 400, data: { message: "手机号授权已过期，请重试" } });
    await expect(attempt).rejects.toThrow("手机号授权已过期");
    expect(customerAuth.isLoggedIn()).toBe(false);
    const retry = customerAuth.loginWechat(PRIVACY_NOTICE_VERSION, "new-phone");
    await tick();
    expect(pending[1]!.data).toMatchObject({ code: "identity-2", phoneCode: "new-phone" });
    respond(pending[1]!, success("retry-token"));
    await expect(retry).resolves.toBe("AUTHENTICATED");
    expect([...storage.values()]).not.toContain("expired-phone");
  });

  it("fences late binding responses and does not let their cleanup cancel the new flight", async () => {
    const { customerAuth, pending, app } = await load();
    const old = customerAuth.loginWechat(PRIVACY_NOTICE_VERSION, "old-phone");
    await tick();
    customerAuth.clearSession();
    const current = customerAuth.loginWechat(PRIVACY_NOTICE_VERSION);
    await tick();
    respond(pending[0]!, success("stale-token"));
    await expect(old).rejects.toThrow("登录状态已变化");
    expect(app.globalData.accessToken).toBeNull();
    const joined = customerAuth.loginWechat(PRIVACY_NOTICE_VERSION);
    await tick();
    expect(pending).toHaveLength(2);
    respond(pending[1]!, success("current-token"));
    await expect(current).resolves.toBe("AUTHENTICATED");
    await expect(joined).resolves.toBe("AUTHENTICATED");
    expect(app.globalData.accessToken).toBe("current-token");
    expect(customerAuth.getSessionEpoch()).toBe(2);
  });

  it("rejects an ambiguous legacy response without writing session data", async () => {
    const { customerAuth, pending } = await load();
    const attempt = customerAuth.loginWechat(PRIVACY_NOTICE_VERSION);
    await tick();
    respond(pending[0]!, { accessToken: "legacy-token" });
    await expect(attempt).rejects.toThrow("登录响应未完成");
    expect(storage.size).toBe(0);
  });
});
