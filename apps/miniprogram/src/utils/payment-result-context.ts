import type { CartSnapshot } from "./cart";

type PaymentResource = "order" | "checkout";
export type PaymentResultResource = PaymentResource;
export type PaymentClientOutcome = "returned" | "cancelled" | "failed" | "uncertain";

export interface PaymentResultContext {
  idempotencyKey: string;
  cartGroups: Array<Pick<CartSnapshot, "campaignId" | "pickupPointId" | "updatedAt">>;
}

const STORAGE_PREFIX = "payment-result-context:";

function storageKey(resource: PaymentResource, id: string): string {
  return `${STORAGE_PREFIX}${resource}:${id}`;
}

export function savePaymentResultContext(
  resource: PaymentResource,
  id: string,
  context: PaymentResultContext,
): void {
  wx.setStorageSync(storageKey(resource, id), context);
}

export function readPaymentResultContext(
  resource: PaymentResource,
  id: string,
): PaymentResultContext | null {
  const value: unknown = wx.getStorageSync(storageKey(resource, id));
  if (!value || typeof value !== "object") return null;
  const context = value as Partial<PaymentResultContext>;
  if (typeof context.idempotencyKey !== "string" || !Array.isArray(context.cartGroups)) return null;
  const cartGroups = context.cartGroups.filter((group): group is PaymentResultContext["cartGroups"][number] =>
    Boolean(group && typeof group.campaignId === "string" && typeof group.pickupPointId === "string" && Number.isFinite(group.updatedAt)),
  );
  return { idempotencyKey: context.idempotencyKey, cartGroups };
}

export function clearPaymentResultContext(resource: PaymentResource, id: string): void {
  wx.removeStorageSync(storageKey(resource, id));
}

export function openPaymentResult(
  resource: PaymentResource,
  id: string,
  outcome: PaymentClientOutcome,
): void {
  const url = `/pages/payment-result/index?resource=${resource}&id=${encodeURIComponent(id)}&outcome=${outcome}`;
  wx.redirectTo({
    url,
    fail: () => wx.navigateTo({
      url,
      fail: () => void wx.showModal({
        title: "支付结果待确认",
        content: "订单已保留。请从订单列表查看状态，勿重复下单。",
        showCancel: false,
      }),
    }),
  });
}
