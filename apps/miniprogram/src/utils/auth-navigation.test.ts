import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelCustomerLogin,
  finishCustomerLogin,
  navigateToCustomerLogin,
} from "./auth-navigation";
import {
  AUTH_INTENT_TTL_MS,
  createAuthIntent,
  readAuthIntent,
  saveAuthIntent,
} from "./auth-intent";

describe("customer auth navigation", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("wx", {
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      getStorageSync: (key: string) => storage.get(key),
      removeStorageSync: (key: string) => storage.delete(key),
      navigateBack: vi.fn(() => Promise.resolve()),
      navigateTo: vi.fn((options: { complete?: () => void }) => { options.complete?.(); }),
      switchTab: vi.fn(() => Promise.resolve()),
      redirectTo: vi.fn(() => Promise.resolve()),
      showToast: vi.fn(() => Promise.resolve()),
    });
  });

  it("keeps the intent when login is cancelled", () => {
    const intent = createAuthIntent(
      "after-sale",
      "/pages/after-sale/index?orderId=o-1",
      "submit-after-sale",
      Date.now(),
    );
    saveAuthIntent(intent);
    cancelCustomerLogin();
    expect(readAuthIntent()).toEqual(intent);
  });

  it("clears the intent after a successful return", () => {
    const intent = createAuthIntent("orders", "/pages/orders/index", undefined, Date.now());
    saveAuthIntent(intent);
    storage.set("hometown-auth-cancel-return", JSON.stringify({ intentId: intent.intentId, source: intent.source, returnUrl: intent.returnUrl }));
    finishCustomerLogin();
    expect(readAuthIntent()).toBeNull();
    expect(storage.has("hometown-auth-cancel-return")).toBe(false);
    expect(wx.switchTab).toHaveBeenCalledWith({ url: "/pages/orders/index" });
  });

  it("reuses an active intent for the same explicit protected entry", () => {
    const intent = createAuthIntent("checkout", "/pages/checkout/index?campaignId=c-1", "submit-order", Date.now());
    saveAuthIntent(intent);
    navigateToCustomerLogin("checkout", "/pages/checkout/index?campaignId=c-1", "submit-order");
    expect(readAuthIntent()?.intentId).toBe(intent.intentId);
    expect(wx.navigateTo).toHaveBeenCalled();
  });

  it("does not navigate back when cancellation has no valid intent", () => {
    storage.set("hometown-auth-intent", '{"source":"orders","returnUrl":"/pages/orders/index","createdAt":0}');
    storage.set("hometown-auth-cancel-return", "stale");
    cancelCustomerLogin();
    expect(wx.navigateBack).not.toHaveBeenCalled();
    expect(wx.switchTab).toHaveBeenCalledWith({ url: "/pages/profile/index" });
    expect(storage.size).toBe(0);
  });

  it("routes every invalid or missing intent cancellation to the profile", () => {
    const now = 1000;
    const invalidRaw = [
      JSON.stringify({ intentId: "expired", source: "orders", returnUrl: "/pages/orders/index", createdAt: now - AUTH_INTENT_TTL_MS }),
      JSON.stringify({ intentId: "future", source: "orders", returnUrl: "/pages/orders/index", createdAt: now + 1 }),
      JSON.stringify({ intentId: "bad", source: "orders", returnUrl: "/pages/orders/index", createdAt: "not-a-number" }),
      "",
    ];
    for (const raw of invalidRaw) {
      storage.clear();
      vi.mocked(wx.navigateBack).mockClear();
      vi.mocked(wx.switchTab).mockClear();
      storage.set("hometown-auth-intent", raw);
      storage.set("hometown-auth-cancel-return", "stale");
      cancelCustomerLogin(now);
      expect(wx.navigateBack).not.toHaveBeenCalled();
      expect(wx.switchTab).toHaveBeenCalledTimes(1);
      expect(storage.size).toBe(0);
    }
    storage.clear();
    vi.mocked(wx.navigateBack).mockClear();
    vi.mocked(wx.switchTab).mockClear();
    cancelCustomerLogin(now);
    expect(wx.navigateBack).not.toHaveBeenCalled();
    expect(wx.switchTab).toHaveBeenCalledTimes(1);
    expect(storage.size).toBe(0);
    expect(AUTH_INTENT_TTL_MS).toBe(30 * 60 * 1000);
  });

  it("rejects an invalid destination before opening the login page", () => {
    navigateToCustomerLogin("orders", "/pages/not-registered/index");
    expect(wx.navigateTo).not.toHaveBeenCalled();
    expect(wx.switchTab).toHaveBeenCalledWith({ url: "/pages/profile/index" });
    expect(storage.size).toBe(0);
  });

  it("rejects source/route and required-parameter mismatches", () => {
    navigateToCustomerLogin("orders", "/pages/order-detail/index?id=o-1");
    navigateToCustomerLogin("checkout", "/pages/checkout/index");
    expect(wx.navigateTo).not.toHaveBeenCalled();
    expect(wx.switchTab).toHaveBeenCalledTimes(2);
    expect(storage.size).toBe(0);
  });
});
