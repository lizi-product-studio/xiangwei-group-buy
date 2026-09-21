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
        latestRequestId: "",
        subscriptionTemplates: [],
      },
    };
    vi.stubGlobal("getApp", () => app);
    vi.stubGlobal("wx", { getStorageSync: vi.fn(), setStorageSync: vi.fn(), removeStorageSync: vi.fn(), setClipboardData: vi.fn(), showToast: vi.fn() });
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

  it("uses a remote-service recovery message for the remote develop target", async () => {
    const { customerErrorMessage } = await load({ apiBaseUrl: "https://liziqi.icu", authMode: "wechat", demoLoginEnabled: false });
    expect(customerErrorMessage(new Error("HTTP 503 https://liziqi.icu/api/v1/campaigns"))).toBe(
      "暂时无法完成请求，请稍后重试",
    );
  });

  it("keeps safe business conflicts readable", async () => {
    const { customerErrorMessage } = await load();
    expect(customerErrorMessage(new Error("当前团期已截单"), "当前操作暂不可用，请刷新后重试")).toBe(
      "当前团期已截单",
    );
  });

  it("keeps only a validated server request id for support", async () => {
    const { ConsumerApiError, customerErrorMessage } = await load({ authMode: "wechat", demoLoginEnabled: false });
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(customerErrorMessage(new ConsumerApiError("暂时无法完成请求，请稍后重试", { requestId: id }))).toContain(`请求编号：${id}`);
    expect(customerErrorMessage(new ConsumerApiError("暂时无法完成请求，请稍后重试", { requestId: "raw-secret" }))).not.toContain("raw-secret");
  });

  it("stores the latest safe id for the existing customer-support path and copies it explicitly", async () => {
    const { ConsumerApiError, customerErrorMessage, copyLatestRequestId, app } = await load({ authMode: "wechat", demoLoginEnabled: false });
    const id = "123e4567-e89b-42d3-a456-426614174000";
    customerErrorMessage(new ConsumerApiError("暂时无法完成请求，请稍后重试", { requestId: id }));
    copyLatestRequestId();
    expect(app.globalData.latestRequestId).toBe(id);
    expect(wx.setClipboardData).toHaveBeenCalledWith(expect.objectContaining({ data: id }));
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
