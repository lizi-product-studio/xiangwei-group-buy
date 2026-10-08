import { api, AuthExpiredError, customerAuth, customerErrorMessage } from "../../utils/api";
import { clearCheckoutDraft, clearMultiCheckoutDraft, readCheckoutDraft, readMultiCheckoutDraft, removeCartGroupsIfUnchanged, saveCheckoutDraft, saveMultiCheckoutDraft } from "../../utils/cart";
import { formatMoney } from "../../utils/format";
import { orderStatusCopy } from "../../utils/consumer-display";
import { navigateToCustomerLogin } from "../../utils/auth-navigation";
import { PageLoadCoordinator } from "../../utils/page-load-guard";
import { PageActionCoordinator } from "../../utils/page-action-coordinator";
import { clearPaymentResultContext, readPaymentResultContext, type PaymentClientOutcome, type PaymentResultResource } from "../../utils/payment-result-context";
import { payOrder, payOrderCheckout, type PaymentAttemptOutcome } from "../../utils/payment";

type PaymentResultState = "PAID" | "CHECKING" | "FAILED" | "CANCELLED" | "EXPIRED" | "CLOSED" | "UNAVAILABLE";
interface ResultOrder {
  id: string;
  statusText: string;
  pickupPointName: string;
  pickupPointAddress: string;
  amountText: string;
}

const PAID_ORDER_STATUSES = ["PAID_WAITING_CLOSE", "LOCKED", "ALLOCATING", "IN_TRANSIT", "ARRIVED", "READY_FOR_PICKUP", "PICKED_UP", "COMPLETED"];
const loadCoordinator = new PageLoadCoordinator();
const actionCoordinator = new PageActionCoordinator();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollAttempts = 0;

function clearPollTimer() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

function isPaymentResultResource(value: string | undefined): value is PaymentResultResource {
  return value === "order" || value === "checkout";
}

function isClientOutcome(value: string | undefined): value is PaymentClientOutcome {
  return value === "returned" || value === "cancelled" || value === "failed" || value === "uncertain";
}

function outcomeState(outcome: PaymentClientOutcome): PaymentResultState {
  if (outcome === "cancelled") return "CANCELLED";
  if (outcome === "failed") return "FAILED";
  return "CHECKING";
}

function copyFor(state: PaymentResultState, latePayment = false): { title: string; message: string } {
  if (state === "PAID") return { title: "支付成功", message: "可查看订单进度和提货信息。" };
  if (state === "CHECKING") return { title: "正在确认支付", message: "暂未收到最终结果，请刷新或查看订单；确认期间不要再次支付。" };
  if (state === "FAILED") return { title: "支付未完成", message: "原订单仍保留，可重试这笔订单或查看订单。" };
  if (state === "CANCELLED") return { title: "已取消支付", message: "原订单仍在支付期限内，可继续支付或查看订单。" };
  if (state === "EXPIRED") return { title: "付款期限已过", message: latePayment ? "请在订单查看退款进度；购物车商品仍保留。" : "该订单不能继续支付，购物车商品仍保留，可返回重新结算。" };
  if (state === "CLOSED") return { title: "订单已关闭", message: latePayment ? "请在订单查看退款进度；购物车商品仍保留。" : "请查看订单处理进度，购物车商品仍保留。" };
  return { title: "暂时无法确认", message: "请刷新或查看订单；确认前不要重新下单。" };
}

Page({
  data: {
    resource: "" as PaymentResultResource | "",
    id: "",
    clientOutcome: "uncertain" as PaymentClientOutcome,
    status: "UNAVAILABLE" as PaymentResultState,
    title: "支付结果",
    message: "正在查询平台订单状态…",
    amountText: "0.00",
    orders: [] as ResultOrder[],
    refreshing: false,
    retrying: false,
    visible: false,
    loggedIn: true,
    error: "",
    canRetry: false,
    canReturnToCart: false,
  },
  onLoad(options: Record<string, string | undefined>) {
    if (!isPaymentResultResource(options.resource) || !options.id || !isClientOutcome(options.outcome)) {
      this.setData({ title: "支付结果暂不可用", message: "支付订单参数缺失，请从订单列表查看状态。", status: "UNAVAILABLE", error: "支付结果参数无效" });
      return;
    }
    this.setData({ resource: options.resource, id: options.id, clientOutcome: options.outcome });
  },
  onShow() {
    loadCoordinator.show();
    actionCoordinator.activate();
    this.setData({ visible: true, ...(this.data.retrying ? {} : { refreshing: false }) });
    if (this.data.id && !this.data.retrying) {
      pollAttempts = 0;
      void this.refreshStatus();
    }
  },
  onHide() {
    clearPollTimer();
    loadCoordinator.hide();
    if (!this.data.retrying) actionCoordinator.invalidate();
    this.setData({ visible: false, ...(this.data.retrying ? {} : { refreshing: false }) });
  },
  onUnload() { clearPollTimer(); loadCoordinator.unload(); actionCoordinator.invalidate(); this.setData({ visible: false, refreshing: false, retrying: false }); },
  async refreshStatus() {
    if (!this.data.id || this.data.refreshing) return;
    clearPollTimer();
    const guard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    const loggedIn = customerAuth.isLoggedIn();
    this.setData({ refreshing: true, loggedIn, error: "" });
    if (!loggedIn) {
      if (loadCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch())) {
        this.setData({ refreshing: false, status: "UNAVAILABLE", title: "登录后查看支付状态", message: "支付结果需从你的订单读取；订单不会因此重新创建。" });
      }
      return;
    }
    let nextState: PaymentResultState = "UNAVAILABLE";
    try {
      if (this.data.resource === "checkout") {
        const result = await api.getCheckoutBatchPaymentStatus(this.data.id);
        if (!loadCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch())) return;
        const batch = result.checkoutBatch;
        const latePayment = result.orders.some((order) => Boolean(order.paidAt));
        if (batch.status === "PAID") nextState = "PAID";
        else if (batch.status === "CANCELLED") nextState = "CLOSED";
        else if (batch.expired) nextState = "EXPIRED";
        else nextState = outcomeState(this.data.clientOutcome);
        const copy = copyFor(nextState, latePayment);
        const orders = result.orders.map((order) => ({
          id: order.id,
          statusText: orderStatusCopy(order.status).text,
          pickupPointName: order.pickupPointName,
          pickupPointAddress: order.pickupPointAddress,
          amountText: formatMoney(order.totalCents),
        }));
        this.setData({
          status: nextState,
          title: copy.title,
          message: copy.message,
          amountText: formatMoney(batch.totalCents),
          orders,
          canRetry: batch.status === "PENDING_PAYMENT" && !batch.expired && ["FAILED", "CANCELLED"].includes(nextState),
          canReturnToCart: ["FAILED", "CANCELLED", "EXPIRED", "CLOSED"].includes(nextState),
        });
      } else {
        const order = await api.getOrder(this.data.id);
        if (!loadCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch())) return;
        const expired = order.status === "PENDING_PAYMENT" && Boolean(order.serverTime) && Date.parse(order.expiresAt) <= Date.parse(order.serverTime!);
        const latePayment = Boolean(order.paidAt) && ["CANCELLED", "REFUNDING", "REFUNDED"].includes(order.status);
        if (order.paidAt && !latePayment || PAID_ORDER_STATUSES.includes(order.status)) nextState = "PAID";
        else if (["CANCELLED", "REFUNDING", "REFUNDED"].includes(order.status)) nextState = "CLOSED";
        else if (expired) nextState = "EXPIRED";
        else if (order.status === "PENDING_PAYMENT") nextState = outcomeState(this.data.clientOutcome);
        else nextState = "CLOSED";
        const copy = copyFor(nextState, latePayment);
        this.setData({
          status: nextState,
          title: copy.title,
          message: copy.message,
          amountText: formatMoney(order.totalCents),
          orders: [{
            id: order.id,
            statusText: orderStatusCopy(order.status).text,
            pickupPointName: order.deliveryPlan?.siteName ?? "自提点信息暂不可用",
            pickupPointAddress: order.deliveryPlan?.address ?? "",
            amountText: formatMoney(order.totalCents),
          }],
          canRetry: order.status === "PENDING_PAYMENT" && !expired && ["FAILED", "CANCELLED"].includes(nextState),
          canReturnToCart: ["FAILED", "CANCELLED", "EXPIRED", "CLOSED"].includes(nextState),
        });
      }
      this.setData({ error: "" });
      if (nextState === "PAID") this.finishConfirmedPayment();
      else if (nextState === "EXPIRED" || nextState === "CLOSED") this.releaseClosedDraft();
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError && error.sessionWasCleared && error.requestEpoch === guard.epoch && customerAuth.captureSessionEpoch() === guard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch())) return;
      if (error instanceof AuthExpiredError) {
        if (!ownExpiry || !loadCoordinator.isLive(guard)) return;
        this.setData({ loggedIn: false, refreshing: false, status: "UNAVAILABLE", title: "登录后查看支付状态", message: "登录后可查看订单进度。", canRetry: false, canReturnToCart: false });
        return;
      }
      nextState = "UNAVAILABLE";
      this.setData({ status: nextState, title: copyFor(nextState).title, message: copyFor(nextState).message, error: customerErrorMessage(error, "支付状态查询失败，请稍后重试"), canRetry: false, canReturnToCart: false });
    } finally {
      if (loadCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch())) this.setData({ refreshing: false });
    }
    if (nextState === "CHECKING" && pollAttempts < 5 && loadCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch())) {
      pollAttempts += 1;
      pollTimer = setTimeout(() => { pollTimer = null; void this.refreshStatus(); }, 1200);
    }
  },
  finishConfirmedPayment() {
    const resource = this.data.resource;
    if (!resource) return;
    const context = readPaymentResultContext(resource, this.data.id);
    if (!context) return;
    removeCartGroupsIfUnchanged(context.cartGroups);
    if (resource === "order") {
      if (readCheckoutDraft()?.orderIdempotencyKey === context.idempotencyKey) clearCheckoutDraft();
    } else if (readMultiCheckoutDraft()?.idempotencyKey === context.idempotencyKey) clearMultiCheckoutDraft();
    clearPaymentResultContext(resource, this.data.id);
  },
  releaseClosedDraft() {
    const resource = this.data.resource;
    if (!resource) return;
    const context = readPaymentResultContext(resource, this.data.id);
    if (!context) return;
    if (resource === "order") {
      const draft = readCheckoutDraft();
      if (draft?.orderIdempotencyKey === context.idempotencyKey) {
        const nextDraft = { ...draft };
        delete nextDraft.orderIdempotencyKey;
        saveCheckoutDraft(nextDraft);
      }
    } else {
      const draft = readMultiCheckoutDraft();
      if (draft?.idempotencyKey === context.idempotencyKey) saveMultiCheckoutDraft(draft.groups, undefined, draft.sourceCartGroups ?? []);
    }
    clearPaymentResultContext(resource, this.data.id);
  },
  async retryPayment() {
    if (!this.data.canRetry || this.data.retrying || !customerAuth.isLoggedIn()) return;
    const guard = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    this.setData({ retrying: true, clientOutcome: "uncertain", canRetry: false });
    let refreshed = false;
    try {
      const outcome: PaymentAttemptOutcome = this.data.resource === "checkout"
        ? await payOrderCheckout(this.data.id, () => actionCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn())
        : await payOrder(this.data.id, () => actionCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn());
      if (!actionCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch())) return;
      this.setData({ clientOutcome: outcome });
      if (this.data.visible) {
        await this.refreshStatus();
        refreshed = true;
      }
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!actionCoordinator.isActive(guard)) return;
        this.setData({ loggedIn: false, retrying: false, status: "UNAVAILABLE", title: "登录后继续支付", message: "请登录后从订单继续支付。" });
        return;
      }
      if (actionCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch())) this.setData({ error: customerErrorMessage(error, "暂时无法继续支付") });
    } finally {
      if (actionCoordinator.isCurrent(guard, customerAuth.captureSessionEpoch())) {
        this.setData({ retrying: false });
        if (this.data.visible && !refreshed) void this.refreshStatus();
      }
    }
  },
  openOrder(event: WechatMiniprogram.BaseEvent) {
    const id = event.currentTarget.dataset.id as string | undefined;
    if (id) void wx.navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(id)}` });
  },
  openOrders() { void wx.redirectTo({ url: "/pages/orders/index" }); },
  openCart() { void wx.switchTab({ url: "/pages/cart/index" }); },
  openLogin() { navigateToCustomerLogin("orders", "/pages/orders/index"); },
});
