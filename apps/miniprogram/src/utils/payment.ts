import { api } from "./api";

function requestWechatPayment(payload: Record<string, string>): Promise<void> {
  const { timeStamp, nonceStr, paySign } = payload;
  const packageValue = payload.package;
  if (!timeStamp || !nonceStr || !packageValue || !paySign)
    return Promise.reject(new Error("支付参数不完整"));
  return new Promise((resolve, reject) =>
    wx.requestPayment({
      timeStamp,
      nonceStr,
      package: packageValue,
      signType: "RSA",
      paySign,
      success: () => resolve(),
      fail: (error) => reject(new Error(error.errMsg || "支付未完成")),
    }),
  );
}

export async function payOrder(orderId: string, beforeNext?: () => boolean): Promise<"mock" | "wechat"> {
  const payment = await api.initiatePayment(orderId);
  if (beforeNext && !beforeNext()) throw new Error("支付状态已变化，请重新查看订单");
  if (payment.provider === "mock") {
    await api.mockPay(orderId);
    if (beforeNext && !beforeNext()) throw new Error("支付状态已变化，请重新查看订单");
  } else {
    await requestWechatPayment(payment.clientPayload);
    if (beforeNext && !beforeNext()) throw new Error("支付状态已变化，请重新查看订单");
  }
  return payment.provider;
}
