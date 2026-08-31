import { api, AuthExpiredError, customerAuth } from "../../utils/api";
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
import { formatMoney } from "../../utils/format";
import { estimatedArrivalText, isCampaignPurchasable, unformedRuleText } from "../../utils/consumer-display";
import { payOrder } from "../../utils/payment";
import {
  loadServiceAreaContext,
  type ServiceAreaSelection,
} from "../../utils/service-area";
import {
  loadPickupPoints,
  type PickupPointSelection,
} from "../../utils/pickup-point";
import { navigateToCustomerLogin } from "../../utils/auth-navigation";
import { PageLoadCoordinator } from "../../utils/page-load-guard";
import { PageActionCoordinator, isOwnedAuthExpiry } from "../../utils/page-action-coordinator";
const loadCoordinator = new PageLoadCoordinator();
const actionCoordinator = new PageActionCoordinator();

interface CheckoutLine extends CartLine {
  priceText: string;
  amountText: string;
}
function planCopy(plan: DeliveryPlanDto | null, arrivalText: string): {
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
      `预计 ${arrivalText} 到货`,
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
    unformedRuleText: "",
  },
  onShow() {
    loadCoordinator.show();
    actionCoordinator.activate();
    this.setData({ submitting: false });
    void this.loadCheckout();
  },
  async loadCheckout() {
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
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
      if (!isCampaignPurchasable(campaign))
        throw new Error("本团已截单或预计到货时间尚未配置，暂时不能结算");
      const context = await loadServiceAreaContext(campaign.serviceAreaId);
      const points = await loadPickupPoints(campaign.serviceAreaId);
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
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
      // The checkout draft is local user-selected state.  Campaign, area and
      // fixed pickup-point facts are public, so a valid guest checkout must
      // render them too.  The load guard still prevents a late response from
      // overwriting a newer identity or load generation.
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      saveCheckoutDraft(refreshed);
      const arrivalText = estimatedArrivalText(campaign)!;
      const delivery = planCopy(campaign.deliveryPlan, arrivalText);
      this.setData({
        draft: refreshed,
        items,
        area: context.selected,
        pickupPoint,
        deliveryTitle: delivery.title,
        deliveryNote: delivery.note,
        unformedRuleText: unformedRuleText(campaign),
        total: formatMoney(
          items.reduce(
            (sum, item) => sum + item.unitPriceCents * item.quantity,
            0,
          ),
        ),
      });
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError &&
        error.sessionWasCleared &&
        error.requestEpoch === loadGuard.epoch &&
        customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      this.setData({
        error: error instanceof Error ? error.message : "结算信息加载失败",
        items: [],
        area: null,
      });
    } finally {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ loading: false });
    }
  },
  onHide() { loadCoordinator.hide(); actionCoordinator.invalidate(); },
  onUnload() { loadCoordinator.unload(); actionCoordinator.invalidate(); },
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
      navigateToCustomerLogin(
        "checkout",
        `/pages/checkout/index?campaignId=${encodeURIComponent(this.data.draft?.campaignId ?? "")}`,
        "submit-order",
      );
      return;
    }
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const currentAction = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    if (!currentAction()) return;
    this.setData({ submitting: true });
    try {
      // Save the key before the request. If the network loses the response, the next tap
      // returns this same order instead of creating and reserving stock for a second one.
      if (!currentAction()) return;
      const submissionDraft = ensureCheckoutIdempotencyKey(draft);
      if (!currentAction()) return;
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
      if (!currentAction()) return;
      const provider = await payOrder(order.id, currentAction);
      if (!currentAction()) return;
      const cart = readCart();
      if (currentAction() &&
        submissionDraft.source === "cart" &&
        cart &&
        cart.campaignId === submissionDraft.campaignId &&
        items.every((item) =>
          cart.items.some((line) => line.skuId === item.skuId),
        )
      )
        clearCart();
      if (!currentAction()) return;
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
      if (!currentAction()) return;
      void wx.redirectTo({
        url: `/pages/order-detail/index?id=${encodeURIComponent(order.id)}`,
      });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) || !actionCoordinator.isActive(action)) return;
        navigateToCustomerLogin(
          "checkout",
          `/pages/checkout/index?campaignId=${encodeURIComponent(this.data.draft?.campaignId ?? "")}`,
          "submit-order",
        );
        return;
      }
      if (!currentAction()) return;
      void wx.showModal({
        title: "这次没有下成",
        content: error instanceof Error ? error.message : "请稍后重试",
        showCancel: false,
      });
    } finally {
      if (currentAction()) this.setData({ submitting: false });
    }
  },
});
