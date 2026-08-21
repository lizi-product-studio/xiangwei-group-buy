import { api, customerAuth } from "../../utils/api";
import {
  clearCart,
  clearCheckoutDraft,
  ensureCheckoutIdempotencyKey,
  readCart,
  readCheckoutDraft,
  saveCheckoutDraft,
  type CartLine,
  type CartSnapshot,
} from "../../utils/cart";
import { formatDateTime, formatMoney } from "../../utils/format";
import { payOrder } from "../../utils/payment";
import {
  loadServiceAreaContext,
  type ServiceAreaSelection,
} from "../../utils/service-area";
import {
  loadPickupPoints,
  type PickupPointSelection,
} from "../../utils/pickup-point";

interface CheckoutLine extends CartLine {
  priceText: string;
  amountText: string;
}
function planCopy(plan: DeliveryPlanDto | null): {
  title: string;
  note: string;
} {
  if (!plan)
    return {
      title: "固定自提点暂未配置",
      note: "本团暂不可下单，请稍后刷新或选择其他团期",
    };
  return {
    title: plan.siteName ?? "固定自提点",
    note: [
      plan.address,
      plan.arrivalStartAt
        ? `预计 ${formatDateTime(plan.arrivalStartAt)}`
        : "到货时间待更新",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

Page({
  data: {
    draft: null as CartSnapshot | null,
    items: [] as CheckoutLine[],
    total: "0.00",
    submitting: false,
    loading: true,
    error: "",
    area: null as ServiceAreaSelection | null,
    pickupPoint: null as PickupPointSelection | null,
    deliveryTitle: "",
    deliveryNote: "",
  },
  onShow() {
    void this.loadCheckout();
  },
  async loadCheckout() {
    const draft = readCheckoutDraft();
    if (!draft) {
      this.setData({
        loading: false,
        error: "结算商品已失效，请返回购物车重新选择",
      });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const campaign = await api.getCampaign(draft.campaignId);
      const context = await loadServiceAreaContext(campaign.serviceAreaId);
      const points = await loadPickupPoints(campaign.serviceAreaId);
      const pickupPoint =
        points.selected?.id === campaign.deliveryPlan?.pickupPointId
          ? points.selected
          : null;
      if (!context.selected) throw new Error("请先选择本团支持的收货区域");
      if (!pickupPoint) throw new Error("请先选择本团指定的固定自提点");
      const items: CheckoutLine[] = draft.items.map((line) => {
        const current = campaign.items.find(
          (item) => item.skuId === line.skuId,
        );
        if (!current) throw new Error(`${line.title} 已不在本团销售`);
        const available = current.stock - current.soldQuantity;
        if (available < line.quantity)
          throw new Error(
            `${current.title} 仅剩 ${available} 件，请返回购物车调整数量`,
          );
        return {
          ...line,
          title: current.title,
          skuName: current.skuName,
          imageUrl: current.imageUrl,
          unitPriceCents: current.unitPriceCents,
          maxQuantity: available,
          priceText: formatMoney(current.unitPriceCents),
          amountText: formatMoney(current.unitPriceCents * line.quantity),
        };
      });
      if (
        draft.serviceAreaId !== context.selected.id ||
        draft.pickupPointId !== pickupPoint.id
      ) {
        throw new Error("购物车的收货区域或自提点已变更，请返回购物车重新选择");
      }
      const refreshed = {
        ...draft,
        items: items.map((item) => ({
          skuId: item.skuId,
          title: item.title,
          skuName: item.skuName,
          imageUrl: item.imageUrl,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
          maxQuantity: item.maxQuantity,
        })),
        updatedAt: Date.now(),
      };
      saveCheckoutDraft(refreshed);
      const delivery = planCopy(campaign.deliveryPlan);
      this.setData({
        draft: refreshed,
        items,
        area: context.selected,
        pickupPoint,
        deliveryTitle: delivery.title,
        deliveryNote: delivery.note,
        total: formatMoney(
          items.reduce(
            (sum, item) => sum + item.unitPriceCents * item.quantity,
            0,
          ),
        ),
      });
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "结算信息加载失败",
        items: [],
        area: null,
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  openPickup() {
    if (this.data.draft)
      void wx.navigateTo({
        url: `/pages/pickup-select/index?campaignId=${encodeURIComponent(this.data.draft.campaignId)}&serviceAreaId=${encodeURIComponent(this.data.draft.serviceAreaId)}`,
      });
  },
  async submitOrder() {
    const { draft, area, pickupPoint, items } = this.data;
    if (
      this.data.submitting ||
      !draft ||
      !area ||
      !pickupPoint ||
      !items.length
    )
      return;
    if (!customerAuth.isLoggedIn()) {
      const result = await wx.showModal({
        title: "登录后再提交订单",
        content: "登录后才能保存订单、支付记录和领取码。",
        confirmText: "去登录",
        confirmColor: "#e04c30",
      });
      if (result.confirm) void wx.switchTab({ url: "/pages/profile/index" });
      return;
    }
    this.setData({ submitting: true });
    try {
      // Save the key before the request. If the network loses the response, the next tap
      // returns this same order instead of creating and reserving stock for a second one.
      const submissionDraft = ensureCheckoutIdempotencyKey(draft);
      this.setData({ draft: submissionDraft });
      const order = await api.createOrder(
        {
          campaignId: submissionDraft.campaignId,
          serviceAreaId: area.id,
          pickupPointId: pickupPoint.id,
          items: items.map((item) => ({
            skuId: item.skuId,
            quantity: item.quantity,
          })),
        },
        submissionDraft.orderIdempotencyKey!,
      );
      const provider = await payOrder(order.id);
      const cart = readCart();
      if (
        submissionDraft.source === "cart" &&
        cart &&
        cart.campaignId === submissionDraft.campaignId &&
        items.every((item) =>
          cart.items.some((line) => line.skuId === item.skuId),
        )
      )
        clearCart();
      clearCheckoutDraft();
      await wx.showModal({
        title: "订单已提交",
        content:
          provider === "mock"
            ? "演示支付已完成；自提点和到货状态会在订单中持续更新。"
            : "支付结果正在由微信确认；自提点和到货状态会在订单中持续更新。",
        showCancel: false,
        confirmText: "查看订单",
      });
      void wx.redirectTo({
        url: `/pages/order-detail/index?id=${encodeURIComponent(order.id)}`,
      });
    } catch (error) {
      void wx.showModal({
        title: "这次没有下成",
        content: error instanceof Error ? error.message : "请稍后重试",
        showCancel: false,
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
