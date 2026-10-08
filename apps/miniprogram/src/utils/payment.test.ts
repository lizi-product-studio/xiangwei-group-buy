import { beforeEach, describe, expect, it, vi } from "vitest";

type PaymentCallbacks = { success?: () => void; fail?: (error: { errMsg?: string }) => void };

describe("payment client callback classification", () => {
  let api: { initiatePayment: ReturnType<typeof vi.fn>; initiateCheckoutPayment: ReturnType<typeof vi.fn>; mockPay: ReturnType<typeof vi.fn>; mockPayCheckout: ReturnType<typeof vi.fn> };
  let requestPayment: PaymentCallbacks | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    api = {
      initiatePayment: vi.fn(async () => ({ provider: "wechat", clientPayload: { timeStamp: "1", nonceStr: "n", package: "prepay_id=x", paySign: "s" } })),
      initiateCheckoutPayment: vi.fn(async () => ({ provider: "wechat", clientPayload: { timeStamp: "1", nonceStr: "n", package: "prepay_id=x", paySign: "s" } })),
      mockPay: vi.fn(),
      mockPayCheckout: vi.fn(),
    };
    requestPayment = undefined;
    vi.doMock("./api", () => ({ api, AuthExpiredError: class AuthExpiredError extends Error {} }));
    vi.stubGlobal("wx", {
      requestPayment: vi.fn((options: PaymentCallbacks) => { requestPayment = options; }),
    });
  });

  it("classifies a client success callback as returned, not server-confirmed", async () => {
    const { payOrder } = await import("./payment");
    const attempt = payOrder("order-1");
    await Promise.resolve();
    requestPayment?.success?.();
    await expect(attempt).resolves.toBe("returned");
    expect(api.initiatePayment).toHaveBeenCalledWith("order-1");
    expect(api.mockPay).not.toHaveBeenCalled();
  });

  it("distinguishes cancel and failure callbacks for safe same-order retry", async () => {
    const { payOrder } = await import("./payment");
    const cancelled = payOrder("order-1");
    await Promise.resolve();
    requestPayment?.fail?.({ errMsg: "requestPayment:fail cancel" });
    await expect(cancelled).resolves.toBe("cancelled");

    const failed = payOrder("order-1");
    await Promise.resolve();
    requestPayment?.fail?.({ errMsg: "requestPayment:fail service unavailable" });
    await expect(failed).resolves.toBe("failed");
    expect(api.initiatePayment).toHaveBeenCalledTimes(2);
  });

  it("returns uncertain when the SDK never calls back and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const { payOrder } = await import("./payment");
    const attempt = payOrder("order-1");
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(attempt).resolves.toBe("uncertain");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not open payment when the owning page action is no longer current", async () => {
    const { payOrder } = await import("./payment");
    await expect(payOrder("order-1", () => false)).resolves.toBe("uncertain");
    expect(wx.requestPayment).not.toHaveBeenCalled();
  });
});
