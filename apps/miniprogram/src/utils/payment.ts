import { api, AuthExpiredError } from "./api";

export type PaymentAttemptOutcome = "returned" | "cancelled" | "failed" | "uncertain";

function requestWechatPayment(payload: Record<string, string>): Promise<PaymentAttemptOutcome> {
  const { timeStamp, nonceStr, paySign } = payload;
  const packageValue = payload.package;
  if (!timeStamp || !nonceStr || !packageValue || !paySign)
    return Promise.resolve("uncertain");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: PaymentAttemptOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(outcome);
    };
    // A missing SDK callback must not trap the customer on checkout forever.
    const timeout = setTimeout(() => finish("uncertain"), 45_000);
    try {
      wx.requestPayment({
        timeStamp,
        nonceStr,
        package: packageValue,
        signType: "RSA",
        paySign,
        success: () => finish("returned"),
        fail: (error) => {
          const errorMessage = error.errMsg ?? "";
          finish(/cancel/i.test(errorMessage) ? "cancelled" : errorMessage ? "failed" : "uncertain");
        },
      });
    } catch {
      finish("uncertain");
    }
  });
}

/** Client callbacks are clues only; the result page must re-read server state. */
export async function payOrder(orderId: string, beforeNext?: () => boolean): Promise<PaymentAttemptOutcome> {
  try {
    const payment = await api.initiatePayment(orderId);
    if (beforeNext && !beforeNext()) return "uncertain";
    if (payment.provider === "mock") {
      await api.mockPay(orderId);
      return "returned";
    }
    return await requestWechatPayment(payment.clientPayload);
  } catch (error) {
    if (error instanceof AuthExpiredError) throw error;
    return "uncertain";
  }
}

/** Client callbacks are clues only; the result page must re-read server state. */
export async function payOrderCheckout(checkoutBatchId: string, beforeNext?: () => boolean): Promise<PaymentAttemptOutcome> {
  try {
    const payment = await api.initiateCheckoutPayment(checkoutBatchId);
    if (beforeNext && !beforeNext()) return "uncertain";
    if (payment.provider === "mock") {
      await api.mockPayCheckout(checkoutBatchId);
      return "returned";
    }
    return await requestWechatPayment(payment.clientPayload);
  } catch (error) {
    if (error instanceof AuthExpiredError) throw error;
    return "uncertain";
  }
}
