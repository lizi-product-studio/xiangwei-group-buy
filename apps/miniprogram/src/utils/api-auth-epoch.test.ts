import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVACY_NOTICE_VERSION } from "../config/legal";

type CallbackOptions = {
  success?: (value: unknown) => void;
  fail?: (value: unknown) => void;
  complete?: () => void;
};

describe("customer auth session epoch", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  function installWechatGlobals() {
    let loginCallbacks: CallbackOptions | undefined;
    let loginRequestCallbacks: CallbackOptions | undefined;
    let protectedRequestCallbacks: CallbackOptions | undefined;
    let logoutComplete: (() => void) | undefined;
    const app = {
      globalData: {
        apiBaseUrl: "https://api.example.test",
        authMode: "wechat" as const,
        accessToken: null as string | null,
        subscriptionTemplates: [],
      },
    };
    vi.stubGlobal("getApp", () => app);
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      login: vi.fn((options: CallbackOptions) => {
        loginCallbacks = options;
      }),
      request: vi.fn((options: { url: string } & CallbackOptions) => {
        if (options.url.includes("/auth/wechat/login")) loginRequestCallbacks = options;
        else if (options.url.includes("/auth/logout")) logoutComplete = options.complete;
        else protectedRequestCallbacks = options;
      }),
    });
    return {
      app,
      resolveWechatLogin(code = "wx-code") {
        loginCallbacks?.success?.({ code });
      },
      resolveLoginExchange(accessToken = "token-a") {
        loginRequestCallbacks?.success?.({
          statusCode: 200,
          data: { data: { accessToken, expiresAt: "2099-01-01T00:00:00.000Z", userId: "user-a" } },
        });
      },
      respondProtected(response: unknown) {
        protectedRequestCallbacks?.success?.(response);
      },
      completeLogout() {
        logoutComplete?.();
      },
    };
  }

  it("increments on login and clearSession, and leaves a late login cancelled", async () => {
    const globals = installWechatGlobals();
    const { customerAuth } = await import("./api");
    const pendingLogin = customerAuth.login(PRIVACY_NOTICE_VERSION);
    const initialEpoch = customerAuth.getSessionEpoch();
    customerAuth.clearSession();
    expect(customerAuth.getSessionEpoch()).toBe(initialEpoch + 1);

    globals.resolveWechatLogin();
    await Promise.resolve();
    globals.resolveLoginExchange();
    await expect(pendingLogin).rejects.toThrow("登录状态已变化");
    expect(customerAuth.isLoggedIn()).toBe(false);
    expect(globals.app.globalData.accessToken).toBeNull();
    expect(storage.has("accessToken")).toBe(false);
  });

  it("establishes an epoch only after a successful login", async () => {
    const globals = installWechatGlobals();
    const { customerAuth } = await import("./api");
    const pendingLogin = customerAuth.login(PRIVACY_NOTICE_VERSION);
    globals.resolveWechatLogin();
    await Promise.resolve();
    globals.resolveLoginExchange("token-b");
    await pendingLogin;
    expect(customerAuth.isLoggedIn()).toBe(true);
    expect(customerAuth.getSessionEpoch()).toBe(1);
    expect(customerAuth.captureSessionEpoch()).toBe(1);
  });

  it("does not let a stale 401 clear a newer identity", async () => {
    const globals = installWechatGlobals();
    globals.app.globalData.accessToken = "token-a";
    storage.set("accessToken", "token-a");
    storage.set("hometown-privacy-notice-version", PRIVACY_NOTICE_VERSION);
    const { api, customerAuth, AuthExpiredError } = await import("./api");
    const pending = api.listOrders();
    await Promise.resolve();
    customerAuth.clearSession();
    globals.app.globalData.accessToken = "token-b";
    storage.set("accessToken", "token-b");
    storage.set("hometown-privacy-notice-version", PRIVACY_NOTICE_VERSION);
    globals.respondProtected({ statusCode: 401, data: { message: "expired" } });
    await expect(pending).rejects.toBeInstanceOf(AuthExpiredError);
    expect(globals.app.globalData.accessToken).toBe("token-b");
    expect(storage.get("accessToken")).toBe("token-b");
    expect(customerAuth.getSessionEpoch()).toBe(1);
  });

  it("invalidates the session before a remote logout response arrives", async () => {
    const globals = installWechatGlobals();
    globals.app.globalData.accessToken = "token-a";
    storage.set("accessToken", "token-a");
    storage.set("hometown-privacy-notice-version", PRIVACY_NOTICE_VERSION);
    const { customerAuth } = await import("./api");
    const before = customerAuth.getSessionEpoch();
    const pendingLogout = customerAuth.logout();

    // The remote revoke is still pending, but the local identity boundary is
    // already established and all page actions must observe the new epoch.
    expect(customerAuth.getSessionEpoch()).toBe(before + 1);
    expect(customerAuth.isLoggedIn()).toBe(false);
    expect(storage.has("accessToken")).toBe(false);

    globals.completeLogout();
    await pendingLogout;
  });
});
