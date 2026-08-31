import {
  createDecipheriv,
  createHash,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { BusinessError } from "@hometown/domain";
import type { Order } from "../core/types.js";

export interface PaymentInitiation {
  providerPaymentId: string | null;
  clientPayload: Record<string, string>;
  providerContext: Record<string, unknown>;
}
export interface PaymentNotification {
  eventId: string;
  type: string;
  orderNo: string;
  providerPaymentId: string;
  amountCents: number;
  bodyHash: string;
}
export interface RefundRequest {
  providerRefundNo: string;
  outTradeNo: string;
  amountCents: number;
  totalCents: number;
}
export interface RefundResult {
  providerRefundId: string | null;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
}
export interface RefundNotFound {
  kind: "NOT_FOUND";
}
export type RefundQueryResult = RefundResult | RefundNotFound;
export interface RefundNotification {
  eventId: string;
  type: string;
  providerRefundNo: string;
  providerRefundId: string | null;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
  bodyHash: string;
}

export interface PaymentProvider {
  readonly name: "mock" | "wechat";
  initiate(
    order: Order,
    payerOpenId: string | null,
  ): Promise<PaymentInitiation>;
  parseNotification(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): PaymentNotification;
  refund(input: RefundRequest): Promise<RefundResult>;
  queryRefund(
    input: Pick<RefundRequest, "providerRefundNo">,
  ): Promise<RefundQueryResult>;
  parseRefundNotification(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): RefundNotification;
}

export class MockPaymentProvider implements PaymentProvider {
  public readonly name = "mock" as const;
  public async initiate(order: Order): Promise<PaymentInitiation> {
    return {
      providerPaymentId: null,
      clientPayload: { mock: "true" },
      providerContext: { outTradeNo: order.orderNo },
    };
  }
  public parseNotification(): PaymentNotification {
    throw new BusinessError("FORBIDDEN", "模拟支付不接收外部回调", 403);
  }
  public async refund(): Promise<RefundResult> {
    return {
      providerRefundId: `MOCK-REFUND-${Date.now()}`,
      status: "SUCCEEDED",
    };
  }
  public async queryRefund(): Promise<RefundQueryResult> {
    return { providerRefundId: null, status: "SUCCEEDED" };
  }
  public parseRefundNotification(): RefundNotification {
    throw new BusinessError("FORBIDDEN", "模拟支付不接收外部回调", 403);
  }
}

export interface WechatPaymentConfig {
  appId: string;
  mchid: string;
  certificateSerial: string;
  privateKeyPath: string;
  publicKeyId: string;
  publicKeyPath: string;
  apiV3Key: string;
  notifyUrl: string;
  refundNotifyUrl: string;
  merchantName: string;
}
interface WechatEncryptedResource {
  algorithm: string;
  ciphertext: string;
  associated_data?: string;
  nonce: string;
}

export class WechatPaymentProvider implements PaymentProvider {
  public readonly name = "wechat" as const;
  private readonly privateKey: string;
  private readonly publicKey: string;
  public constructor(private readonly config: WechatPaymentConfig) {
    this.privateKey = readFileSync(config.privateKeyPath, "utf8");
    this.publicKey = readFileSync(config.publicKeyPath, "utf8");
  }

  public async initiate(
    order: Order,
    payerOpenId: string | null,
  ): Promise<PaymentInitiation> {
    if (!payerOpenId)
      throw new BusinessError(
        "VALIDATION_ERROR",
        "支付用户缺少微信 OpenID",
        409,
      );
    const response = await this.request<{ prepay_id: string }>(
      "POST",
      "/v3/pay/transactions/jsapi",
      {
        appid: this.config.appId,
        mchid: this.config.mchid,
        out_trade_no: order.orderNo,
        description: `${this.config.merchantName}社区团购订单`.slice(0, 127),
        notify_url: this.config.notifyUrl,
        amount: { total: Number(order.totalCents), currency: "CNY" },
        payer: { openid: payerOpenId },
      },
    );
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = randomBytes(16).toString("hex");
    const packageValue = `prepay_id=${response.prepay_id}`;
    return {
      providerPaymentId: response.prepay_id,
      clientPayload: {
        timeStamp,
        nonceStr,
        package: packageValue,
        signType: "RSA",
        paySign: this.sign(
          `${this.config.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`,
        ),
      },
      providerContext: { outTradeNo: order.orderNo },
    };
  }

  public parseNotification(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): PaymentNotification {
    this.verifyMessage(rawBody, headers);
    const envelope = JSON.parse(rawBody) as {
      id: string;
      event_type: string;
      resource: WechatEncryptedResource;
    };
    const value = this.decrypt(envelope.resource) as {
      out_trade_no?: string;
      transaction_id?: string;
      amount?: { total?: number };
    };
    if (
      !envelope.id ||
      !value.out_trade_no ||
      !value.transaction_id ||
      !Number.isSafeInteger(value.amount?.total)
    )
      throw new BusinessError(
        "VALIDATION_ERROR",
        "微信支付回调内容不完整",
        400,
      );
    return {
      eventId: envelope.id,
      type: envelope.event_type,
      orderNo: value.out_trade_no,
      providerPaymentId: value.transaction_id,
      amountCents: Number(value.amount!.total),
      bodyHash: createHash("sha256").update(rawBody).digest("hex"),
    };
  }

  public async refund(input: RefundRequest): Promise<RefundResult> {
    const response = await this.request<{
      refund_id?: string;
      status?: string;
    }>("POST", "/v3/refund/domestic/refunds", {
      out_trade_no: input.outTradeNo,
      out_refund_no: input.providerRefundNo,
      reason: "社区团购订单退款",
      notify_url: this.config.refundNotifyUrl,
      amount: {
        refund: input.amountCents,
        total: input.totalCents,
        currency: "CNY",
      },
    });
    return {
      providerRefundId: response.refund_id ?? null,
      status: this.refundStatus(response.status),
    };
  }
  public async queryRefund(
    input: Pick<RefundRequest, "providerRefundNo">,
  ): Promise<RefundQueryResult> {
    let response: { refund_id?: string; status?: string };
    try {
      response = await this.request<{
        refund_id?: string;
        status?: string;
      }>(
        "GET",
        `/v3/refund/domestic/refunds/${encodeURIComponent(input.providerRefundNo)}`,
      );
    } catch (error) {
      if (
        error instanceof BusinessError &&
        (error.details as { httpStatus?: number } | undefined)?.httpStatus ===
          404
      )
        return { kind: "NOT_FOUND" };
      throw error;
    }
    return {
      providerRefundId: response.refund_id ?? null,
      status: this.refundStatus(response.status),
    };
  }
  public parseRefundNotification(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): RefundNotification {
    this.verifyMessage(rawBody, headers);
    const envelope = JSON.parse(rawBody) as {
      id: string;
      event_type: string;
      resource: WechatEncryptedResource;
    };
    const value = this.decrypt(envelope.resource) as {
      out_refund_no?: string;
      refund_id?: string;
      refund_status?: string;
    };
    if (!envelope.id || !value.out_refund_no)
      throw new BusinessError(
        "VALIDATION_ERROR",
        "微信退款回调内容不完整",
        400,
      );
    return {
      eventId: envelope.id,
      type: envelope.event_type,
      providerRefundNo: value.out_refund_no,
      providerRefundId: value.refund_id ?? null,
      status: this.refundStatus(value.refund_status),
      bodyHash: createHash("sha256").update(rawBody).digest("hex"),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    payload?: unknown,
  ): Promise<T> {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.mchid}",nonce_str="${nonce}",signature="${this.sign(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`)}",timestamp="${timestamp}",serial_no="${this.config.certificateSerial}"`;
    const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method,
      ...(body ? { body } : {}),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "community-group-buying/1.0",
        Authorization: authorization,
        "Wechatpay-Serial": this.config.publicKeyId,
      },
      signal: AbortSignal.timeout(8000),
    });
    const raw = await response.text();
    this.verifyMessage(raw, {
      "wechatpay-timestamp":
        response.headers.get("wechatpay-timestamp") ?? undefined,
      "wechatpay-nonce": response.headers.get("wechatpay-nonce") ?? undefined,
      "wechatpay-signature":
        response.headers.get("wechatpay-signature") ?? undefined,
      "wechatpay-serial": response.headers.get("wechatpay-serial") ?? undefined,
    });
    if (!response.ok) {
      const error = JSON.parse(raw) as { code?: string; message?: string };
      throw new BusinessError(
        "EXTERNAL_SERVICE_ERROR",
        error.message ?? "微信支付服务暂时不可用",
        502,
        { providerCode: error.code, httpStatus: response.status },
      );
    }
    return JSON.parse(raw) as T;
  }
  private sign(message: string): string {
    return sign("RSA-SHA256", Buffer.from(message), this.privateKey).toString(
      "base64",
    );
  }
  private verifyMessage(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): void {
    const timestamp = headers["wechatpay-timestamp"];
    const nonce = headers["wechatpay-nonce"];
    const signature = headers["wechatpay-signature"];
    const serial = headers["wechatpay-serial"];
    if (
      !timestamp ||
      !nonce ||
      !signature ||
      serial !== this.config.publicKeyId ||
      signature.startsWith("WECHATPAY/SIGNTEST/")
    )
      throw new BusinessError("FORBIDDEN", "微信支付签名无效", 401);
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
      throw new BusinessError("FORBIDDEN", "微信支付通知已过期", 401);
    if (
      !verify(
        "RSA-SHA256",
        Buffer.from(`${timestamp}\n${nonce}\n${rawBody}\n`),
        this.publicKey,
        Buffer.from(signature, "base64"),
      )
    )
      throw new BusinessError("FORBIDDEN", "微信支付签名无效", 401);
  }
  private decrypt(resource: WechatEncryptedResource): unknown {
    if (resource.algorithm !== "AEAD_AES_256_GCM")
      throw new BusinessError(
        "VALIDATION_ERROR",
        "不支持的微信支付回调加密算法",
        400,
      );
    const encrypted = Buffer.from(resource.ciphertext, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(this.config.apiV3Key),
      Buffer.from(resource.nonce),
    );
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    decipher.setAAD(Buffer.from(resource.associated_data ?? ""));
    return JSON.parse(
      Buffer.concat([
        decipher.update(encrypted.subarray(0, -16)),
        decipher.final(),
      ]).toString("utf8"),
    ) as unknown;
  }
  private refundStatus(status: string | undefined): RefundResult["status"] {
    return status === "SUCCESS"
      ? "SUCCEEDED"
      : status === "PROCESSING"
        ? "PROCESSING"
        : "FAILED";
  }
}
