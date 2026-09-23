import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthIntent,
  isTabReturnUrl,
  normalizeReturnUrl,
  parseAuthIntent,
  serializeAuthIntent,
  sourceText,
  clearAuthIntent,
  consumeCancelReturnSuppression,
  saveAuthIntent,
  saveCancelReturnSuppression,
  readAuthIntent,
  AUTH_INTENT_STORAGE_KEY,
  AUTH_CANCEL_SUPPRESSION_STORAGE_KEY,
  isValidAuthReturnUrl,
  isRegisteredMiniProgramPage,
} from "./auth-intent";

describe("consumer auth intent", () => {
  const storage = new Map<string, unknown>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("wx", {
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      getStorageSync: (key: string) => storage.get(key),
      removeStorageSync: (key: string) => storage.delete(key),
    });
  });
  it("records source, safe return route and non-replayed write intent", () => {
    const intent = createAuthIntent(
      "checkout",
      "/pages/checkout/index?campaignId=c-1",
      "submit-order",
      123,
    );
    expect(parseAuthIntent(serializeAuthIntent(intent))).toEqual(intent);
    expect(intent).toMatchObject({
      intentId: expect.any(String),
      source: "checkout",
      returnUrl: "/pages/checkout/index?campaignId=c-1",
      writeAction: "submit-order",
      createdAt: 123,
    });
  });

  it("keeps the intent id stable when persisted and separates repeated attempts", () => {
    const first = createAuthIntent("orders", "/pages/orders/index", undefined, 123);
    const second = createAuthIntent("orders", "/pages/orders/index", undefined, 123);
    expect(first.intentId).not.toBe(second.intentId);
    expect(parseAuthIntent(serializeAuthIntent(first))?.intentId).toBe(first.intentId);
  });

  it("expires at 30 minutes, while 29:59 remains valid", () => {
    const intent = createAuthIntent("orders", "/pages/orders/index", undefined, 1000);
    saveAuthIntent(intent);
    expect(parseAuthIntent(serializeAuthIntent(intent))).not.toBeNull();
    expect(readAuthIntent(1000 + 30 * 60 * 1000 - 1)).toEqual(intent);
    expect(readAuthIntent(1000 + 30 * 60 * 1000)).toBeNull();
    expect(storage.size).toBe(0);
  });

  it("consumes cancel suppression once and never across sources", () => {
    const intent = createAuthIntent("messages", "/pages/messages/index", undefined, 1000);
    saveAuthIntent(intent);
    saveCancelReturnSuppression(intent);
    expect(consumeCancelReturnSuppression({ source: "order-detail", returnUrl: "/pages/messages/index" }, 1001)).toBe(false);
    expect(storage.has(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY)).toBe(true);
    saveCancelReturnSuppression(intent);
    expect(consumeCancelReturnSuppression({ source: "messages", returnUrl: "/pages/messages/index" }, 1001)).toBe(true);
    expect(consumeCancelReturnSuppression({ source: "messages", returnUrl: "/pages/messages/index" }, 1001)).toBe(false);
    clearAuthIntent();
  });

  it("clears malformed or missing-timestamp intents and their suppression", () => {
    storage.set(AUTH_INTENT_STORAGE_KEY, '{"intentId":"i-1","source":"orders","returnUrl":"/pages/orders/index"}');
    storage.set(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY, '{"intentId":"i-1","source":"orders","returnUrl":"/pages/orders/index"}');
    expect(readAuthIntent(1000)).toBeNull();
    expect(storage.has(AUTH_INTENT_STORAGE_KEY)).toBe(false);
    expect(storage.has(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY)).toBe(false);

    storage.set(AUTH_INTENT_STORAGE_KEY, '{"intentId":"i-2","source":"orders","returnUrl":"/pages/orders/index","createdAt":null}');
    storage.set(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY, "not-json");
    expect(readAuthIntent(1000)).toBeNull();
    expect(storage.has(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY)).toBe(false);
  });

  it("rejects unknown source and write action values", () => {
    for (const raw of [
      '{"intentId":"i-3","source":"unknown","returnUrl":"/pages/orders/index","createdAt":1000}',
      '{"intentId":"i-4","source":"orders","returnUrl":"/pages/orders/index","writeAction":"unknown","createdAt":1000}',
    ]) {
      storage.set(AUTH_INTENT_STORAGE_KEY, raw);
      storage.set(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY, "stale");
      expect(readAuthIntent(1000)).toBeNull();
      expect(storage.has(AUTH_INTENT_STORAGE_KEY)).toBe(false);
      expect(storage.has(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY)).toBe(false);
    }
  });

  it("removes an empty raw intent key while clearing suppression", () => {
    storage.set(AUTH_INTENT_STORAGE_KEY, "");
    storage.set(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY, "stale");
    expect(readAuthIntent(1000)).toBeNull();
    expect(storage.has(AUTH_INTENT_STORAGE_KEY)).toBe(false);
    expect(storage.has(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY)).toBe(false);
  });

  it("rejects external and malformed return paths", () => {
    expect(normalizeReturnUrl("https://bad.example/steal")).toBe(
      "/pages/profile/index",
    );
    expect(parseAuthIntent('{"source":"orders"}')).toBeNull();
    expect(isTabReturnUrl("/pages/orders/index")).toBe(false);
    expect(isTabReturnUrl("/pages/category/index")).toBe(false);
    expect(isTabReturnUrl("/pages/order-detail/index?id=1")).toBe(false);
  });

  it("binds each source to a registered route and required parameters", () => {
    expect(isRegisteredMiniProgramPage("/pages/orders/index")).toBe(true);
    expect(isRegisteredMiniProgramPage("/pages/category/index")).toBe(true);
    expect(isRegisteredMiniProgramPage("/pages/not-registered/index")).toBe(false);
    expect(isValidAuthReturnUrl("orders", "/pages/orders/index")).toBe(true);
    expect(isValidAuthReturnUrl("orders", "/pages/order-detail/index?id=o-1")).toBe(false);
    expect(isValidAuthReturnUrl("order-detail", "/pages/order-detail/index")).toBe(false);
    expect(isValidAuthReturnUrl("order-detail", "/pages/order-detail/index?id=o-1")).toBe(true);
    expect(isValidAuthReturnUrl("checkout", "/pages/checkout/index")).toBe(false);
    expect(isValidAuthReturnUrl("checkout", "/pages/checkout/index?campaignId=c-1")).toBe(true);
    expect(isValidAuthReturnUrl("orders", "/pages/login/index")).toBe(false);
    expect(isValidAuthReturnUrl("orders", "/pages/orders/index?unexpected=value")).toBe(false);
    expect(isValidAuthReturnUrl("orders", "/pages/orders/index?unexpected")).toBe(false);
    expect(isValidAuthReturnUrl("orders", "/pages/orders/index?filter=ALL")).toBe(false);
    expect(isValidAuthReturnUrl("messages", "/pages/messages/index?source=messages")).toBe(false);
    expect(isValidAuthReturnUrl("messages", "/pages/messages/index?source=messages&source=messages")).toBe(false);
    expect(isValidAuthReturnUrl("order-detail", "/pages/order-detail/index?id=o-1=stale")).toBe(false);
    expect(isValidAuthReturnUrl("order-detail", "/pages/order-detail/index?id=o-1&extra=value")).toBe(false);
    expect(isValidAuthReturnUrl("messages", "/pages/messages/index?")).toBe(false);
    expect(isValidAuthReturnUrl("orders", "/pages/orders/index?next=%E0%A4%A")).toBe(false);
    expect(isValidAuthReturnUrl("order-detail", "/pages/order-detail/index?id=%E0%A4%A")).toBe(false);
  });

  it("rejects a write action that belongs to a different source", () => {
    const mismatched = {
      intentId: "mismatch",
      source: "orders",
      returnUrl: "/pages/orders/index",
      writeAction: "submit-after-sale",
      createdAt: 1000,
    };
    expect(parseAuthIntent(JSON.stringify(mismatched))).toBeNull();
  });

  it("does not persist an invalid intent or suppression", () => {
    const invalid = createAuthIntent("orders", "/pages/order-detail/index?id=o-1", undefined, 1000);
    saveAuthIntent(invalid);
    expect(storage.has(AUTH_INTENT_STORAGE_KEY)).toBe(false);
    saveCancelReturnSuppression(invalid);
    expect(storage.has(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY)).toBe(false);
  });

  it("keeps consumer copy free of internal enum names", () => {
    expect(sourceText("after-sale")).toBe("售后申请");
    expect(sourceText("session-expired")).toBe("当前服务");
  });
});
