import { api, AuthExpiredError, customerAuth, customerErrorMessage } from "../../utils/api";
import {
  ensureCheckoutIdempotencyKey,
  ensureMultiCheckoutIdempotencyKey,
  cartGroupKey,
  captureCartGroupVersions,
  readMultiCheckoutDraft,
  readCheckoutDraft,
  saveCheckoutDraft,
  saveMultiCheckoutDraft,
  type CartLine,
  type CartSnapshot,
} from "../../utils/cart";
import { formatMoney } from "../../utils/format";
import { estimatedArrivalText, formatChinaDateTime, isCampaignPurchasable, unformedRuleText } from "../../utils/consumer-display";
import { payOrder, payOrderCheckout } from "../../utils/payment";
import { openPaymentResult, savePaymentResultContext } from "../../utils/payment-result-context";

function omitProperties<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) Reflect.deleteProperty(copy, key);
  return copy as Omit<T, K>;
}
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
interface CheckoutGroupView extends CartSnapshot {
  groupKey: string;
  items: CheckoutLine[];
  total: string;
  itemCount: number;
  arrivalText: string;
  cutoffText: string;
  priceChanged: boolean;
  minimumQuantity: number;
  failureRuleText: string;
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
      arrivalText ? `预计到货时段：${arrivalText}` : "到货时间待确认，到货后通知",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

Page({
  data: {
    mode: "single" as "single" | "multi",
    groups: [] as CheckoutGroupView[],
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
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ mode: options.source === "multi" ? "multi" : "single" });
  },
  onShow() {
    loadCoordinator.show();
    actionCoordinator.activate();
    this.setData({ submitting: false });
    void this.loadCheckout();
  },
  async loadCheckout() {
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    if (this.data.mode === "multi") return this.loadMultiCheckout(loadGuard);
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
      const arrivalText = estimatedArrivalText(campaign) ?? "";
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
        error: customerErrorMessage(error, "结算信息加载失败，请稍后重试"),
        items: [],
        area: null,
      });
    } finally {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ loading: false });
    }
  },
  async loadMultiCheckout(loadGuard: ReturnType<typeof loadCoordinator.begin>) {
    const draft = readMultiCheckoutDraft();
    if (!draft) {
      this.setData({ loading: false, error: "结算商品已失效，请返回购物车重新选择" });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const groups = await Promise.all(draft.groups.map(async (group): Promise<CheckoutGroupView> => {
        const [campaign, areas, points] = await Promise.all([
          api.getCampaign(group.campaignId),
          api.listServiceAreas(),
          api.listPickupPoints(group.serviceAreaId),
        ]);
        if (!isCampaignPurchasable(campaign)) throw new Error(`“${group.campaignTitle}”已截单或暂不可下单`);
        const area = areas.find((value) => value.id === group.serviceAreaId && value.orderEnabled);
        const point = points.find((value) => value.id === group.pickupPointId && value.status === "ACTIVE");
        if (!area || campaign.serviceAreaId !== group.serviceAreaId) throw new Error(`“${group.campaignTitle}”的收货区域已不可用`);
        if (!point || campaign.deliveryPlan?.pickupPointId !== point.id) throw new Error(`“${group.campaignTitle}”的固定自提点已不可用`);
        const items = group.items.map((line): CheckoutLine => {
          const current = campaign.items.find((item) => item.skuId === line.skuId);
          if (!current) throw new Error(`${line.title} 已不在本团销售`);
          const available = current.stock - current.soldQuantity;
          if (available < line.quantity) throw new Error(`${current.title} 仅剩 ${available} 件，请返回购物车调整数量`);
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
        const priceChanged = items.some((item) => group.items.find((line) => line.skuId === item.skuId)?.unitPriceCents !== item.unitPriceCents);
        const updated: CartSnapshot = {
          ...group,
          campaignTitle: campaign.title,
          serviceAreaName: area.name,
          pickupPointName: point.name,
          pickupPointAddress: point.address,
          cutoffAt: campaign.cutoffAt,
          arrivalText: estimatedArrivalText(campaign) ?? "到货时间待确认",
          items: items.map((item) => omitProperties(item, "priceText", "amountText")),
          updatedAt: Date.now(),
        };
        return {
          ...updated,
          groupKey: cartGroupKey(updated),
          items,
          total: formatMoney(items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)),
          itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
          arrivalText: updated.arrivalText ?? "到货时间待确认",
          cutoffText: formatChinaDateTime(campaign.cutoffAt, true),
          priceChanged,
          minimumQuantity: campaign.minTotalQuantity,
          failureRuleText: unformedRuleText(campaign),
        };
      }));
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      saveMultiCheckoutDraft(
        groups.map((group) => omitProperties(group, "groupKey", "total", "itemCount", "cutoffText", "priceChanged", "minimumQuantity", "failureRuleText")),
        draft.idempotencyKey,
        draft.sourceCartGroups ?? [],
      );
      this.setData({
        groups,
        total: formatMoney(groups.reduce((sum, group) => sum + group.items.reduce((itemSum, item) => itemSum + item.unitPriceCents * item.quantity, 0), 0)),
        loading: false,
        error: "",
      });
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError && error.sessionWasCleared && error.requestEpoch === loadGuard.epoch && customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      this.setData({ error: customerErrorMessage(error, "结算信息加载失败，请稍后重试"), groups: [], area: null });
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
  backToCart() {
    if (this.data.submitting) return;
    void wx.switchTab({ url: "/pages/cart/index" });
  },
  async submitMultiOrder() {
    const draft = readMultiCheckoutDraft();
    const groups = this.data.groups;
    if (this.data.submitting || !draft || !groups.length) return;
    if (!customerAuth.isLoggedIn()) {
      navigateToCustomerLogin("checkout", "/pages/checkout/index?source=multi", "submit-order");
      return;
    }
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const currentAction = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    if (!currentAction()) return;
    this.setData({ submitting: true });
    let created: Awaited<ReturnType<typeof api.createOrderCheckout>> | null = null;
    const cartGroups = groups.map((group) => omitProperties(group, "groupKey", "total", "itemCount", "cutoffText", "priceChanged", "minimumQuantity", "failureRuleText"));
    const expectedCartGroups = draft.sourceCartGroups ?? [];
    try {
      const keyedDraft = ensureMultiCheckoutIdempotencyKey({ ...draft, groups: cartGroups });
      const result = await api.createOrderCheckout(
        groups.map((group) => ({
          campaignId: group.campaignId,
          serviceAreaId: group.serviceAreaId,
          pickupPointId: group.pickupPointId,
          items: group.items.map((item) => ({ skuId: item.skuId, quantity: item.quantity })),
        })),
        keyedDraft.idempotencyKey!,
      );
      created = result;
      if (!currentAction()) return;
      if (result.checkoutBatch.status === "PAID") {
        savePaymentResultContext("checkout", result.checkoutBatch.id, {
          idempotencyKey: keyedDraft.idempotencyKey!,
          cartGroups: expectedCartGroups,
        });
        openPaymentResult("checkout", result.checkoutBatch.id, "returned");
        return;
      }
      if (result.checkoutBatch.status !== "PENDING_PAYMENT" || Date.parse(result.checkoutBatch.expiresAt) <= Date.now()) {
        saveMultiCheckoutDraft(cartGroups, undefined, expectedCartGroups);
        await wx.showModal({ title: "本次结算已失效", content: "订单已取消或超过支付期限，库存已释放。请重新核对购物车后再次结算。", showCancel: false });
        if (currentAction()) await this.loadCheckout();
        return;
      }
      const matches = result.orders.length === groups.length && groups.every((group) => {
        const order = result.orders.find((value) => value.campaignId === group.campaignId && value.pickupPointId === group.pickupPointId);
        if (!order || order.serviceAreaId !== group.serviceAreaId || order.status !== "PENDING_PAYMENT") return false;
        const expected = new Map(group.items.map((item) => [item.skuId, item]));
        if (order.items.length !== expected.size) return false;
        const linesMatch = order.items.every((line) => {
          const current = expected.get(line.skuId);
          return Boolean(current && line.quantity === current.quantity && Number(line.unitPriceCents) === current.unitPriceCents && Number(line.amountCents) === current.unitPriceCents * current.quantity);
        });
        const total = group.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
        return linesMatch && Number(order.totalCents) === total;
      });
      if (!matches || Number(result.checkoutBatch.totalCents) !== groups.reduce((sum, group) => sum + group.items.reduce((inner, item) => inner + item.unitPriceCents * item.quantity, 0), 0)) {
        const firstOrder = result.orders[0];
        if (firstOrder) await api.cancelOrder(firstOrder.id);
        saveMultiCheckoutDraft(cartGroups, undefined, expectedCartGroups);
        await wx.showModal({ title: "价格或库存刚刚变化", content: "本批订单未发起支付，已取消并释放预占库存。请重新核对各组金额后再付款。", showCancel: false });
        if (currentAction()) await this.loadCheckout();
        return;
      }
      savePaymentResultContext("checkout", result.checkoutBatch.id, {
        idempotencyKey: keyedDraft.idempotencyKey!,
        cartGroups: expectedCartGroups,
      });
      const outcome = await payOrderCheckout(result.checkoutBatch.id, currentAction);
      if (!currentAction()) return;
      openPaymentResult("checkout", result.checkoutBatch.id, outcome);
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) || !actionCoordinator.isActive(action)) return;
        navigateToCustomerLogin("checkout", "/pages/checkout/index?source=multi", "submit-order");
        return;
      }
      if (!currentAction()) return;
      const message = created
        ? "订单已创建但支付未完成，购物车商品仍保留。可稍后在订单列表继续支付，或返回购物车取消整组订单。"
        : customerErrorMessage(error, "核对或创建订单失败，请刷新后重试");
      const result = await wx.showModal({ title: created ? "订单已保留，暂未支付" : "暂时无法结算", content: message, showCancel: Boolean(created), cancelText: "留在此页", confirmText: created ? "查看订单" : "知道了" });
      if (created && result.confirm && currentAction()) void wx.redirectTo({ url: "/pages/orders/index" });
    } finally {
      if (actionCoordinator.isActive(action)) this.setData({ submitting: false });
    }
  },
  async submitOrder() {
    if (this.data.mode === "multi") return this.submitMultiOrder();
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
    let createdOrderId: string | null = null;
    try {
      // Save the key before the request. If the network loses the response, the next tap
      // returns this same order instead of creating and reserving stock for a second one.
      if (!currentAction()) return;
      const submissionDraft = ensureCheckoutIdempotencyKey(draft);
      if (!currentAction()) return;
      this.setData({ draft: submissionDraft });
      const expectedCartGroups = submissionDraft.source === "cart"
        ? captureCartGroupVersions([submissionDraft])
        : [];
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
      createdOrderId = order.id;
      if (!currentAction()) return;
      savePaymentResultContext("order", order.id, {
        idempotencyKey: submissionDraft.orderIdempotencyKey!,
        cartGroups: expectedCartGroups,
      });
      const outcome = await payOrder(order.id, currentAction);
      if (!currentAction()) return;
      openPaymentResult("order", order.id, outcome);
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
      if (createdOrderId) {
        const result = await wx.showModal({
          title: "订单已创建，支付暂未完成",
          content: "订单已保留，支付可以稍后在订单详情继续完成。",
          showCancel: true,
          cancelText: "稍后处理",
          confirmText: "查看订单",
        });
        if (!currentAction()) return;
        if (result.confirm)
          void wx.redirectTo({
            url: `/pages/order-detail/index?id=${encodeURIComponent(createdOrderId)}`,
          });
        return;
      }
      void wx.showModal({
        title: "订单提交失败",
        content: "订单提交失败，请稍后重试。",
        showCancel: false,
      });
    } finally {
      if (currentAction()) this.setData({ submitting: false });
    }
  },
});
