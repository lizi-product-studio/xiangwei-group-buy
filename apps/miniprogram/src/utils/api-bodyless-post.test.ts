import { beforeEach, describe, expect, it, vi } from "vitest";

describe("JSON command requests", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  it("sends an empty JSON object for every bodyless POST", async () => {
    const requests: Array<Record<string, unknown>> = [];
    storage.set("hometown-demo-customer-session", true);
    const app = {
      globalData: {
        apiBaseUrl: "http://127.0.0.1:3100",
        authMode: "demo" as const,
        demoLoginEnabled: true,
        accessToken: null,
        subscriptionTemplates: [],
      },
    };
    vi.stubGlobal("getApp", () => app);
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      request: vi.fn((options: Record<string, unknown>) => {
        requests.push(options);
        const success = options.success as
          | ((response: unknown) => void)
          | undefined;
        success?.({ statusCode: 200, data: { data: {} } });
      }),
    });

    const { api } = await import("./api");
    await api.initiatePayment("order-1");
    await api.mockPay("order-1");
    await api.cancelOrder("order-1");
    await api.withdrawOwnServiceAreaInterest("interest-1");
    await api.markNotificationRead("notification-1");

    expect(requests).toHaveLength(5);
    expect(requests.map((request) => request.method)).toEqual([
      "POST",
      "POST",
      "POST",
      "POST",
      "POST",
    ]);
    expect(requests.map((request) => request.data)).toEqual([
      {},
      {},
      {},
      {},
      {},
    ]);
  });
});
