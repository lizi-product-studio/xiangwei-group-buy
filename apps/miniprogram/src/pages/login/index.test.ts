import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthEvent, AuthState } from "../../utils/auth-state";

type PageInstance = {
  data: Record<string, unknown>;
  setData: (patch: Record<string, unknown>) => void;
  stateData: (event: AuthEvent) => AuthState & { statusText: string };
  onLoad: (options: Record<string, string | undefined>) => void;
  changePrivacy: (event: { detail: { value: string[] } }) => void;
  login: () => Promise<void>;
  experienceLogin: () => Promise<void>;
  cancel: () => void;
  openTerms: () => void;
  openPrivacy: () => void;
};

describe("consumer login page", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  async function loadPage(overrides: { authMode?: "demo" | "wechat"; demoLoginEnabled?: boolean; apiBaseUrl?: string } = {}) {
    const switchTab = vi.fn(() => Promise.resolve());
    const navigateTo = vi.fn(() => Promise.resolve());
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
      navigateTo,
      getMenuButtonBoundingClientRect: () => ({ top: 54, height: 32 }),
      navigateBack: vi.fn(() => Promise.resolve()),
      redirectTo: vi.fn(() => Promise.resolve()),
      switchTab,
      showToast: vi.fn(() => Promise.resolve()),
    });
    let pageDefinition: PageInstance | undefined;
    vi.stubGlobal("Page", (definition: unknown) => {
      pageDefinition = definition as PageInstance;
      return definition;
    });
    await import("./index");
    if (!pageDefinition) throw new Error("login page was not registered");
    const instance: PageInstance = {
      data: JSON.parse(JSON.stringify(pageDefinition.data)) as Record<string, unknown>,
      setData(patch: Record<string, unknown>) {
        Object.assign(this.data, patch);
      },
      stateData: pageDefinition.stateData,
      onLoad: pageDefinition.onLoad,
      changePrivacy: pageDefinition.changePrivacy,
      login: pageDefinition.login,
      experienceLogin: pageDefinition.experienceLogin,
      cancel: pageDefinition.cancel,
      openTerms: pageDefinition.openTerms,
      openPrivacy: pageDefinition.openPrivacy,
    };
    return { instance, switchTab, navigateTo, app };
  }

  it("aligns custom navigation to the WeChat capsule and starts unchecked", async () => {
    const { instance } = await loadPage();
    instance.onLoad({});
    expect(instance.data.navigationTop).toBe(54);
    expect(instance.data.navigationHeight).toBe(32);
    expect(instance.data.privacyAccepted).toBe(false);
  });

  it("opens both legal documents without accepting consent", async () => {
    const { instance, navigateTo } = await loadPage();
    instance.openTerms();
    instance.openPrivacy();
    expect(navigateTo).toHaveBeenNthCalledWith(1, { url: "/pages/legal/index?document=terms" });
    expect(navigateTo).toHaveBeenNthCalledWith(2, { url: "/pages/legal/index?document=privacy" });
    expect(instance.data.privacyAccepted).toBe(false);
  });

  it("prevents both back actions from interrupting a pending login", async () => {
    const { instance, switchTab } = await loadPage();
    instance.data.status = "AUTHENTICATING";
    instance.cancel();
    expect(instance.data.status).toBe("AUTHENTICATING");
    expect(switchTab).not.toHaveBeenCalled();
  });

  it("shows inline consent validation and creates no session when unchecked", async () => {
    const { instance, navigateTo } = await loadPage();
    instance.onLoad({ source: "checkout" });
    await instance.login.call(instance);
    expect(instance.data.privacyError).toBe("请先勾选并同意用户服务协议和隐私说明");
    expect(storage.has("hometown-demo-customer-session")).toBe(false);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("logs in only after consent and returns to the recorded destination", async () => {
    const { instance, switchTab } = await loadPage();
    instance.onLoad({ source: "orders" });
    instance.changePrivacy.call(instance, { detail: { value: ["accepted"] } });
    expect(instance.data.demoLoginAvailable).toBe(true);
    await instance.experienceLogin.call(instance);
    expect(storage.get("hometown-demo-customer-session")).toBe(true);
    expect(switchTab).toHaveBeenCalledWith({ url: "/pages/profile/index" });
  });

  it("keeps the primary WeChat entry and blocks the experience action without consent", async () => {
    const { instance } = await loadPage();
    instance.onLoad({ source: "checkout" });
    expect(instance.data.demoLoginAvailable).toBe(true);
    await instance.experienceLogin.call(instance);
    expect(storage.has("hometown-demo-customer-session")).toBe(false);
    expect(instance.data.privacyError).toBe("请先勾选并同意用户服务协议和隐私说明");
  });

  it("does not render or invoke experience login outside local demo deployment", async () => {
    const { instance, app, switchTab, navigateTo } = await loadPage({
      authMode: "wechat",
      demoLoginEnabled: false,
      apiBaseUrl: "https://api.example.test",
    });
    instance.onLoad({ source: "orders" });
    expect(instance.data.demoLoginAvailable).toBe(false);
    await instance.experienceLogin.call(instance);
    expect(storage.has("hometown-demo-customer-session")).toBe(false);
    expect(switchTab).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(app.globalData.authMode).toBe("wechat");
  });

  it("does not let the primary WeChat button create a demo session in local preview", async () => {
    const { instance, navigateTo } = await loadPage();
    instance.onLoad({ source: "orders" });
    instance.changePrivacy.call(instance, { detail: { value: ["accepted"] } });
    await instance.login.call(instance);
    expect(storage.has("hometown-demo-customer-session")).toBe(false);
    expect(instance.data.status).toBe("ERROR");
    expect(instance.data.error).toBe("当前未配置微信快捷登录，请使用开发体验登录");
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
