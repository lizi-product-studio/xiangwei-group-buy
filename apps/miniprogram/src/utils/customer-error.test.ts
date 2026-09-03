import { beforeEach, describe, expect, it, vi } from "vitest";

describe("consumer-safe request errors", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function load(overrides: Partial<{ apiBaseUrl: string; authMode: "demo" | "wechat"; demoLoginEnabled: boolean }> = {}) {
    const app = {
      globalData: {
        apiBaseUrl: overrides.apiBaseUrl ?? "http://127.0.0.1:3100",
        authMode: overrides.authMode ?? "demo",
        demoLoginEnabled: overrides.demoLoginEnabled ?? true,
        accessToken: null,
        subscriptionTemplates: [],
      },
    };
    vi.stubGlobal("getApp", () => app);
    vi.stubGlobal("wx", { getStorageSync: vi.fn(), setStorageSync: vi.fn(), removeStorageSync: vi.fn() });
    return { ...(await import("./api")), app };
  }

  it("maps SDK failures to the local recovery hint", async () => {
    const { customerErrorMessage } = await load();
    expect(customerErrorMessage(new Error("request:fail timeout"))).toBe(
      "本地服务未启动，请在项目根目录运行 pnpm dev 后重试",
    );
  });

  it("never exposes status codes or URLs outside local demo", async () => {
    const { customerErrorMessage } = await load({
      apiBaseUrl: "https://api.example.test",
      authMode: "wechat",
      demoLoginEnabled: false,
    });
    const message = customerErrorMessage(new Error("HTTP 503 https://api.example.test/orders"));
    expect(message).toBe("暂时无法完成请求，请稍后重试");
    expect(message).not.toMatch(/503|https?:\/\//);
  });

  it("keeps safe business conflicts readable", async () => {
    const { customerErrorMessage } = await load();
    expect(customerErrorMessage(new Error("当前团期已截单"), "当前操作暂不可用，请刷新后重试")).toBe(
      "当前团期已截单",
    );
  });

  it("does not expose internal status codes", async () => {
    const { customerErrorMessage } = await load();
    expect(customerErrorMessage(new Error("P3"))).toBe(
      "本地服务未启动，请在项目根目录运行 pnpm dev 后重试",
    );
  });

  it("filters relative API paths and queries in development", async () => {
    const { customerErrorMessage } = await load();
    expect(
      customerErrorMessage(new Error("GET /api/v1/orders?customerId=abc failed")),
    ).toBe("本地服务未启动，请在项目根目录运行 pnpm dev 后重试");
  });

  it("filters relative API paths and queries in release", async () => {
    const { customerErrorMessage } = await load({
      apiBaseUrl: "https://api.example.test",
      authMode: "wechat",
      demoLoginEnabled: false,
    });
    const message = customerErrorMessage(new Error("GET /api/v1/orders?customerId=abc failed"));
    expect(message).toBe("暂时无法完成请求，请稍后重试");
    expect(message).not.toMatch(/api\/v1|customerId|abc/);
  });
});
