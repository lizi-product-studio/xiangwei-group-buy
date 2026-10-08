import { generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moneyCents } from "@hometown/domain";
import type { Order } from "../core/types.js";
import { WechatPaymentProvider } from "./payment-provider.js";

// Protocol references (2026-09-28): merchant docs 4012791860 / 4012791859 / 4012791897.
// All keys are generated for this test. Every fetch is stubbed; no real merchant request.
const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const directory = mkdtempSync(join(tmpdir(), "xwj-provider-close-"));
writeFileSync(join(directory, "merchant.pem"), merchant.privateKey.export({ format: "pem", type: "pkcs8" }));
writeFileSync(join(directory, "platform.pem"), platform.publicKey.export({ format: "pem", type: "spki" }));
const config = {
  appId: "wx-test", mchid: "mch-test", certificateSerial: "serial-test",
  privateKeyPath: join(directory, "merchant.pem"), publicKeyId: "PUB_KEY_ID_TEST",
  publicKeyPath: join(directory, "platform.pem"), apiV3Key: "x".repeat(32),
  notifyUrl: "https://example.invalid/pay", refundNotifyUrl: "https://example.invalid/refund", merchantName: "测试",
};
const provider = new WechatPaymentProvider(config);
const reference = { outTradeNo: "ORDER_TEST_123" };
const fetchMock = vi.fn<typeof fetch>();
function response(status: number, body: unknown = undefined, validSignature = true) {
  const raw = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "response-nonce";
  const signature = sign("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`), platform.privateKey).toString("base64");
  return new Response(status === 204 ? null : raw, { status, headers: {
    "wechatpay-timestamp": timestamp, "wechatpay-nonce": nonce,
    "wechatpay-signature": validSignature ? signature : "invalid",
    "wechatpay-serial": config.publicKeyId,
  } });
}
function queryBody(trade_state: string, extra: Record<string, unknown> = {}) {
  return { appid: config.appId, mchid: config.mchid, out_trade_no: reference.outTradeNo, trade_state, ...extra };
}
function order(expiresAt = new Date(Date.now() + 600_000).toISOString()): Order {
  return { id: "order-test", orderNo: reference.outTradeNo, userId: "test-user", campaignId: "campaign", serviceAreaId: "area", pickupPointId: "point", deliveryPlanId: "plan", status: "PENDING_PAYMENT", totalCents: moneyCents(1200), items: [], createdAt: new Date().toISOString(), expiresAt, paidAt: null, pickedUpAt: null };
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("WeChat cancellation protocol", () => {
  it("accepts signed empty 204 and signs the exact close path and merchant body", async () => {
    fetchMock.mockResolvedValue(response(204));
    await expect(provider.closePayment(reference)).resolves.toEqual({ status: "CLOSED" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${reference.outTradeNo}/close`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ mchid: config.mchid });
    const auth = new Headers(init?.headers).get("Authorization")!;
    const parts = Object.fromEntries([...auth.matchAll(/(\w+)="([^"]+)"/g)].map((m) => [m[1], m[2]]));
    const path = new URL(String(url)).pathname;
    expect(verify("RSA-SHA256", Buffer.from(`POST\n${path}\n${parts.timestamp}\n${parts.nonce_str}\n${init?.body}\n`), merchant.publicKey, Buffer.from(parts.signature!, "base64"))).toBe(true);
  });
  it("rejects signed but undocumented success responses for close", async () => {
    fetchMock.mockResolvedValue(response(200, {}));
    await expect(provider.closePayment(reference)).rejects.toThrow();
  });
  it("does not accept an unsigned or tampered close acknowledgement", async () => {
    fetchMock.mockResolvedValue(response(204, undefined, false));
    await expect(provider.closePayment(reference)).rejects.toThrow();
  });
  it.each(["ORDERPAID", "TRADE_ERROR", "INVALID_REQUEST", "SYSTEM_ERROR"])("does not classify %s as successfully closed", async (code) => {
    fetchMock.mockResolvedValue(response(400, { code, message: "provider refused close" }));
    await expect(provider.closePayment(reference)).rejects.toThrow();
  });
  it("returns verified paid identity and gross total for caller reconciliation", async () => {
    fetchMock.mockResolvedValue(response(200, queryBody("SUCCESS", { transaction_id: "wx-transaction", amount: { total: 1200, payer_total: 1000, currency: "CNY" } })));
    await expect(provider.queryPayment(reference)).resolves.toEqual({ status: "SUCCEEDED", outTradeNo: reference.outTradeNo, providerPaymentId: "wx-transaction", amountCents: 1200 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${reference.outTradeNo}?mchid=mch-test`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
  });
  it.each(["NOTPAY", "CLOSED", "REVOKED", "USERPAYING", "PAYERROR"])("preserves provider state %s", async (state) => {
    fetchMock.mockResolvedValue(response(200, queryBody(state)));
    await expect(provider.queryPayment(reference)).resolves.toEqual({ status: state, outTradeNo: reference.outTradeNo });
  });
  it("does not confuse refunded payment with an unpaid closed order", async () => {
    fetchMock.mockResolvedValue(response(200, queryBody("REFUND", { transaction_id: "wx-transaction", amount: { total: 1200, currency: "CNY" } })));
    await expect(provider.queryPayment(reference)).resolves.toEqual({ status: "REFUNDING", outTradeNo: reference.outTradeNo, providerPaymentId: "wx-transaction", amountCents: 1200 });
  });
  it.each(["SUCCESS", "REFUND"])("rejects a signed %s query with zero total", async (state) => {
    fetchMock.mockResolvedValue(response(200, queryBody(state, {
      transaction_id: "wx-transaction", amount: { total: 0, currency: "CNY" },
    })));
    await expect(provider.queryPayment(reference)).rejects.toThrow("微信支付查询交易或金额不完整");
  });
  it("recognizes only the documented order-not-exist error", async () => {
    fetchMock.mockResolvedValue(response(404, { code: "ORDER_NOT_EXIST", message: "not found" }));
    await expect(provider.queryPayment(reference)).resolves.toEqual({ status: "NOT_FOUND", outTradeNo: reference.outTradeNo });
    fetchMock.mockResolvedValue(response(404, { code: "SYSTEM_ERROR" }));
    await expect(provider.queryPayment(reference)).rejects.toThrow();
  });
  it.each([["SUCCESS", "SUCCEEDED"], ["PROCESSING", "PROCESSING"], ["CLOSED", "CLOSED"], ["ABNORMAL", "ABNORMAL"], ["FAIL", "FAILED"]] as const)("preserves provider refund state %s", async (providerStatus, expected) => {
    fetchMock.mockResolvedValue(response(200, { refund_id: "wx-refund", status: providerStatus }));
    await expect(provider.queryRefund({ providerRefundNo: "RF-ORDER-1" })).resolves.toEqual({ providerRefundId: "wx-refund", status: expected });
  });
  it("recognizes only RESOURCE_NOT_EXISTS as a safely retryable missing refund", async () => {
    fetchMock.mockResolvedValue(response(404, { code: "RESOURCE_NOT_EXISTS", message: "refund not found" }));
    await expect(provider.queryRefund({ providerRefundNo: "RF-ORDER-1" })).resolves.toEqual({ kind: "NOT_FOUND" });
    fetchMock.mockResolvedValue(response(404, { code: "SYSTEM_ERROR", message: "service failure" }));
    await expect(provider.queryRefund({ providerRefundNo: "RF-ORDER-1" })).rejects.toThrow();
  });
  it.each([
    { out_trade_no: "another-order" }, { mchid: "another-merchant" }, { appid: "another-app" },
    { trade_state: "UNKNOWN" }, { transaction_id: undefined },
    { amount: { total: -1, currency: "CNY" } }, { amount: { total: 12.5, currency: "CNY" } },
    { amount: { total: 1200, currency: "USD" } },
  ])("rejects unusable or mismatched signed query facts: %j", async (patch) => {
    fetchMock.mockResolvedValue(response(200, queryBody("SUCCESS", { transaction_id: "wx-transaction", amount: { total: 1200, currency: "CNY" }, ...patch })));
    await expect(provider.queryPayment(reference)).rejects.toThrow();
  });
  it("does not turn timeout, malformed JSON or bad signature into a known payment state", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    await expect(provider.closePayment(reference)).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(response(200, "not-json"));
    await expect(provider.queryPayment(reference)).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(response(200, queryBody("CLOSED"), false));
    await expect(provider.queryPayment(reference)).rejects.toThrow();
  });
  it("includes the local expiry in first JSAPI initiation", async () => {
    fetchMock.mockResolvedValue(response(200, { prepay_id: "test-prepay" }));
    const candidate = order();
    await provider.initiate(candidate, "test-openid");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(Date.parse(body.time_expire)).toBe(Date.parse(candidate.expiresAt));
  });
  it("does not silently extend a nearly expired order to WeChat's minimum payment window", async () => {
    await expect(provider.initiate(order(new Date(Date.now() + 30_000).toISOString()), "test-openid")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
