import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TestPage = {
  route: string;
  data: Record<string, unknown>;
  setData: (value: Record<string, unknown>) => void;
  onLoad?: (options: Record<string, string>) => void;
  onShow: () => void;
  onHide?: () => void;
  load: () => Promise<void>;
  openLogin: () => void;
  login: () => Promise<void>;
  cancel: () => void;
  changePrivacy: (event: {detail: {value: string[]}}) => void;
  authorizePhone: (event: WechatMiniprogram.ButtonGetPhoneNumber) => Promise<void>;
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const storage = new Map<string, unknown>();
  const stack: TestPage[] = [];
  const app = {globalData: {authMode: "wechat", apiBaseUrl: "https://api.example.test", demoLoginEnabled: false, accessToken: null, subscriptionTemplates: []}};
  vi.stubGlobal("getApp", () => app);
  vi.stubGlobal("getCurrentPages", () => stack);
  let navigationComplete: (() => void) | undefined;
  const navigateTo = vi.fn((options: {complete?: () => void}) => { navigationComplete = options.complete; });
  const navigateBack = vi.fn();
  const redirectTo = vi.fn();
  const login = vi.fn((options: {success: (value: {code: string}) => void}) => options.success({code: "synthetic-identity-code"}));
  const request = vi.fn((options: {url: string; data?: {phoneCode?: string}; success: (value: unknown) => void}) => {
    const data = options.url.endsWith("/auth/wechat/login")
      ? options.data?.phoneCode ? {phoneRequired: false, accessToken: "synthetic-new-user-token", userId: "synthetic-user", expiresAt: "2099-01-01T00:00:00Z"} : {phoneRequired: true}
      : [];
    options.success({statusCode: 200, data: {data}});
  });
  vi.stubGlobal("wx", {navigateTo, navigateBack, redirectTo, switchTab: vi.fn(), showToast: vi.fn(), login, request,
    getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key)});
  let definition!: TestPage;
  vi.stubGlobal("Page", (value: TestPage) => { definition = value; });
  await import("../pages/messages/index");
  const messages = definition;
  messages.route = "pages/messages/index";
  messages.setData = patch => Object.assign(messages.data, patch);
  stack.push(messages);
  await import("../pages/login/index");
  const loginPage = definition;
  loginPage.route = "pages/login/index";
  loginPage.setData = patch => Object.assign(loginPage.data, patch);
  return {messages, loginPage, navigateTo, navigateBack, redirectTo, login, request, storage,
    enterLogin: () => { messages.onHide?.(); stack.push(loginPage); loginPage.onLoad?.({source: "messages"}); loginPage.onShow(); navigationComplete?.(); },
    returnToMessages: () => { stack.pop(); messages.onShow(); },
    failNavigation: () => navigationComplete?.(),
  };
}

describe("new consumer message/login navigation", () => {
  it("stays on the message CTA, rejects unchecked login, and does not bounce after cancellation", async () => {
    const f = await setup();
    f.messages.onShow(); await f.messages.load();
    expect(f.navigateTo).not.toHaveBeenCalled();
    f.messages.openLogin(); f.enterLogin();
    await f.loginPage.login();
    expect(f.loginPage.data.privacyAccepted).toBe(false);
    expect(f.login).not.toHaveBeenCalled();
    expect(f.redirectTo).not.toHaveBeenCalled();
    f.loginPage.cancel();
    expect(f.navigateBack).toHaveBeenCalledTimes(1);
    f.returnToMessages(); await f.messages.load(); f.messages.onShow();
    expect(f.navigateTo).toHaveBeenCalledTimes(1);
    expect(f.messages.data.error).toBe("登录后可查看订单消息");
  });
  it("deduplicates fast taps and current-login entries, and allows retry after failed navigation", async () => {
    const f = await setup();
    f.messages.openLogin(); f.messages.openLogin();
    expect(f.navigateTo).toHaveBeenCalledTimes(1);
    f.failNavigation();
    f.messages.openLogin();
    expect(f.navigateTo).toHaveBeenCalledTimes(2);
    f.enterLogin(); f.messages.openLogin();
    expect(f.navigateTo).toHaveBeenCalledTimes(2);
  });
  it("keeps phone refusal on login and returns exactly once only after actual two-step success", async () => {
    const f = await setup();
    f.messages.openLogin(); f.enterLogin();
    f.loginPage.changePrivacy({detail: {value: ["accepted"]}});
    await f.loginPage.login();
    expect(f.loginPage.data.phoneRequired).toBe(true);
    expect(f.storage.has("accessToken")).toBe(false);
    expect(f.redirectTo).not.toHaveBeenCalled();
    await f.loginPage.authorizePhone({detail: {errMsg: "getPhoneNumber:fail user deny"}} as WechatMiniprogram.ButtonGetPhoneNumber);
    expect(f.loginPage.data.loggedIn).toBe(false);
    expect(f.redirectTo).not.toHaveBeenCalled();
    await f.loginPage.authorizePhone({detail: {errMsg: "getPhoneNumber:ok", code: "synthetic-phone-code"}} as WechatMiniprogram.ButtonGetPhoneNumber);
    expect(f.login).toHaveBeenCalledTimes(2);
    expect(f.loginPage.data.loggedIn).toBe(true);
    expect(f.redirectTo).toHaveBeenCalledExactlyOnceWith({url: "/pages/messages/index"});
    f.returnToMessages(); await f.messages.load();
    expect(f.navigateTo).toHaveBeenCalledTimes(1);
  });
});
