import { api, AuthExpiredError, customerAuth, customerErrorMessage } from "../../utils/api";
import {
  canSubmitCommunityQualityCase,
  communityQualityCaseStatusText,
} from "../../utils/community-quality";
import { formatDateTime, formatMoney } from "../../utils/format";
import {
  cancellationStatusText,
  formatChinaDateTime,
  orderStatusCopy,
  orderStatusTone,
  pickupDeadlineText,
  pickupWindowStatusText,
  qualityDeadlineText,
  refundStatusText,
} from "../../utils/consumer-display";
import { payOrder, payOrderCheckout, type PaymentAttemptOutcome } from "../../utils/payment";
import { openPaymentResult } from "../../utils/payment-result-context";
import { navigateToCustomerLogin } from "../../utils/auth-navigation";
import { consumeCancelReturnSuppression } from "../../utils/auth-intent";
import { PageLoadCoordinator } from "../../utils/page-load-guard";
import { PageActionCoordinator, isOwnedAuthExpiry } from "../../utils/page-action-coordinator";

type ItemView = OrderDto["items"][number] & {
  priceText: string;
  amountText: string;
  fulfillmentText: string;
  exceptionReasonText: string | null;
  refundText: string | null;
};

interface OrderDetailView extends OrderDto {
  totalText: string;
  createdText: string;
  statusText: string;
  statusTone: string;
  statusHint: string;
  canPay: boolean;
  canCancel: boolean;
  canPickup: boolean;
  canAfterSale: boolean;
  afterSaleViews: Array<{
    id: string;
    reason: string;
    statusText: string;
    createdText: string;
  }>;
  itemViews: ItemView[];
  deliveryName: string;
  deliveryAddress: string;
  deliveryTime: string;
  partialRefundText: string | null;
  fulfillmentExceptionHint: string | null;
  pickupWindowText: string | null;
  cancellationText: string | null;
  pickupDeadlineText: string;
  pickupReceiptViews: Array<{
    id: string;
    pickedUpText: string;
    quantityText: string;
    qualityDeadlineText: string;
  }>;
}

const EXCEPTION_REASON: Record<string, string> = {
  SHORT_RECEIPT: "到货短少",
  QUALITY_REJECTED: "质量拒收",
  PACKAGE_DAMAGED: "包装破损",
  TRANSIT_SHORTAGE: "配送短少",
  TRANSIT_DAMAGE: "配送破损",
  PICKUP_POINT_REJECTED: "点位拒收",
  PICKUP_SHORTAGE: "领取短少",
  PICKUP_DAMAGE: "领取破损",
  QUALITY_CLAIM: "质量问题",
};

function locationCopy(plan: DeliveryPlanDto | null) {
  if (!plan)
    return {
      name: "领取地点信息暂不可用",
      address: "请联系平台客服确认",
      time: "地点信息待补充",
    };
  const eta = plan.estimatedArrivalAt ?? plan.arrivalStartAt;
  return {
    name: plan.siteName ?? "集中领取地点已确认",
    address: plan.address ?? "",
    time: eta ? `预计到货时段：${formatDateTime(eta)}` : "到货时间待确认，到货后通知",
  };
}

const loadCoordinator = new PageLoadCoordinator();
const actionCoordinator = new PageActionCoordinator();
const visiblePages = new WeakSet<object>();
const paymentTimers = new WeakMap<object, ReturnType<typeof setInterval>>();
const paymentClockOffsets = new WeakMap<object, number>();
const expiryChecks = new WeakSet<object>();
const pendingPayments = new WeakSet<object>();
const pendingCancellations = new WeakSet<object>();
const deferredPaymentResults = new WeakMap<object, { resource: "order" | "checkout"; id: string; outcome: PaymentAttemptOutcome; epoch: number }>();
function stopPaymentTimer(page: object) {
  const timer = paymentTimers.get(page);
  if (timer) clearInterval(timer);
  paymentTimers.delete(page);
}

Page({
  data: {
    id: "",
    loading: true,
    error: "",
    order: null as OrderDetailView | null,
    paying: false,
    cancelling: false,
    paymentCountdownText: "",
    paymentDeadlineText: "",
    statusCheckLoading: false,
  },
  onHide() { visiblePages.delete(this); stopPaymentTimer(this); loadCoordinator.hide(); actionCoordinator.invalidate(); },
  onUnload() { visiblePages.delete(this); stopPaymentTimer(this); loadCoordinator.unload(); actionCoordinator.invalidate(); },
  onLoad(options: Record<string, string | undefined>) {
    if (!options.id) {
      this.setData({ loading: false, error: "订单参数缺失" });
      return;
    }
    this.setData({ id: options.id });
  },
  onShow() {
    loadCoordinator.show();
    actionCoordinator.activate();
    visiblePages.add(this);
    if (!this.data.id || pendingCancellations.has(this)) return;
    const deferredResult = deferredPaymentResults.get(this);
    void this.loadOrder().then((verified) => {
      if (!verified || !visiblePages.has(this)) return;
      if (deferredResult && deferredPaymentResults.get(this) === deferredResult) {
        deferredPaymentResults.delete(this);
        if (customerAuth.isLoggedIn() && customerAuth.captureSessionEpoch() === deferredResult.epoch)
          openPaymentResult(deferredResult.resource, deferredResult.id, deferredResult.outcome);
      }
    });
  },
  async retryLoad() {
    const verified = await this.loadOrder();
    const deferredResult = deferredPaymentResults.get(this);
    if (verified && deferredResult && visiblePages.has(this)) {
      deferredPaymentResults.delete(this);
      if (customerAuth.isLoggedIn() && customerAuth.captureSessionEpoch() === deferredResult.epoch)
        openPaymentResult(deferredResult.resource, deferredResult.id, deferredResult.outcome);
    }
  },
  openLogin() {
    navigateToCustomerLogin(
      "order-detail",
      `/pages/order-detail/index?id=${encodeURIComponent(this.data.id)}`,
    );
  },
  async loadOrder(): Promise<boolean> {
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    // Clear the prior identity's detail before issuing a new protected read.
    this.setData({ loading: true, error: "", order: null });
    if (!customerAuth.isLoggedIn()) {
      this.setData({ loading: false, error: "登录后可查看订单详情", order: null });
      if (consumeCancelReturnSuppression({ source: "order-detail", returnUrl: `/pages/order-detail/index?id=${encodeURIComponent(this.data.id)}` })) return false;
      navigateToCustomerLogin(
        "order-detail",
        `/pages/order-detail/index?id=${encodeURIComponent(this.data.id)}`,
      );
      return false;
    }
    try {
      const order = await api.getOrder(this.data.id);
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return false;
      const status = orderStatusCopy(order.status);
      const location = locationCopy(order.deliveryPlan);
      const reasonBySku = new Map<string, string>();
      for (const exception of order.fulfillmentExceptions ?? [])
        for (const item of exception.items)
          if (item.exceptionQuantity > 0 && item.reason)
            reasonBySku.set(
              item.catalogSkuId,
              EXCEPTION_REASON[item.reason] ?? "履约异常处理中",
            );
      const itemViews: ItemView[] = order.items.map((item) => {
        const refundText = item.refundStatus
          ? `${refundStatusText(item.refundStatus)} ${formatMoney(item.refundAmountCents ?? item.refundedAmountCents)}`
          : item.refundedAmountCents > 0
            ? `已退 ${formatMoney(item.refundedAmountCents)}`
            : null;
        return {
          ...item,
          priceText: formatMoney(item.unitPriceCents),
          amountText: formatMoney(item.amountCents),
          fulfillmentText:
            item.exceptionQuantity > 0
              ? `待领 ${item.remainingPickupQuantity ?? item.fulfilledQuantity} 件 · 异常 ${item.exceptionQuantity} 件`
              : item.fulfilledQuantity > 0
                ? `待领 ${item.remainingPickupQuantity ?? item.fulfilledQuantity} 件`
                : "待履约",
          exceptionReasonText:
            item.exceptionQuantity > 0
              ? `异常原因：${reasonBySku.get(item.skuId) ?? "待确认"}`
              : null,
          refundText,
        };
      });
      const partialRefunds = order.partialRefunds ?? [];
      const skuNameById = new Map(
        order.items.map((item) => [item.skuId, item.name]),
      );
      const communityQualityViews = (order.communityQualityCases ?? []).map(
        (qualityCase) => ({
          id: qualityCase.id,
          reason: `品质售后：${qualityCase.items.map((item) => `${skuNameById.get(item.catalogSkuId) ?? "商品"} × ${item.disputedQuantity}`).join("、")}`,
          statusText: communityQualityCaseStatusText(qualityCase.status),
          decisionNote: qualityCase.decisionNote ?? null,
          createdText: formatDateTime(qualityCase.registeredAt),
        }),
      );
      const communityQualityOpen = canSubmitCommunityQualityCase(order);
      const pickupWindowText = order.pickupWindow
        ? pickupWindowStatusText(order.pickupWindow.status)
        : null;
      const cancellationText = order.cancellation
        ? cancellationStatusText(order.cancellation.status, order.cancellation.reviewNote)
        : null;
      const pickupReceiptViews = (order.pickupReceipts ?? []).map((receipt) => ({
        id: receipt.id,
        pickedUpText: `领取时间：${formatChinaDateTime(receipt.pickedUpAt, true)}（中国时间）`,
        quantityText: `本次领取 ${receipt.quantity} 件`,
        qualityDeadlineText: qualityDeadlineText(receipt.qualityDeadlineAt),
      }));
      this.setData({
        order: {
          ...order,
          totalText: formatMoney(order.totalCents),
          createdText: formatDateTime(order.createdAt),
          statusText: status.text,
          statusTone: orderStatusTone(order.status),
          statusHint: status.hint,
          canPay: order.status === "PENDING_PAYMENT",
          canCancel: [
            "PENDING_PAYMENT",
            "PAID_WAITING_CLOSE",
            "LOCKED",
            "ALLOCATING",
          ].includes(order.status),
          canPickup: order.status === "READY_FOR_PICKUP",
          canAfterSale: communityQualityOpen,
          afterSaleViews: communityQualityViews,
          deliveryName: location.name,
          deliveryAddress: location.address,
          deliveryTime: location.time,
          fulfillmentExceptionHint: !["PICKED_UP", "COMPLETED"].includes(
            order.status,
          )
            ? "商品异常由平台按明细核实和退款；正常商品不受影响，可继续领取。"
            : null,
          pickupWindowText,
          pickupDeadlineText: pickupDeadlineText(order.pickupDeadlineAt ?? order.pickupWindow?.deadlineAt),
          pickupReceiptViews,
          cancellationText,
          partialRefundText: partialRefunds.length
            ? (() => {
                const groups = [
                  { statuses: ["SUCCEEDED"], label: "已退" },
                  { statuses: ["CREATED", "PROCESSING"], label: "退款处理中" },
                  { statuses: ["SUBMISSION_UNKNOWN"], label: "退款结果待核实" },
                  { statuses: ["RETRYABLE_FAILURE", "FAILED", "MANUAL_HOLD"], label: "退款异常待处理" },
                ].flatMap(({ statuses, label }) => {
                  const amount = partialRefunds.filter((item) => statuses.includes(item.status)).reduce((sum, item) => sum + Number(item.amountCents), 0);
                  return amount > 0 ? [`${label} ${formatMoney(amount)}`] : [];
                });
                return `部分商品退款：${groups.join("；")}`;
              })()
            : null,
          itemViews,
        },
        paymentDeadlineText: formatDateTime(order.checkoutBatch?.expiresAt ?? order.expiresAt),
        paymentCountdownText: "正在校准支付时间…",
        ...(pendingPayments.has(this) ? {} : { paying: false }),
        ...(pendingCancellations.has(this) ? {} : { cancelling: false }),
      });
      paymentClockOffsets.set(this, Date.parse(order.serverTime ?? "") - Date.now());
      expiryChecks.delete(this);
      this.refreshPaymentCountdown();
      stopPaymentTimer(this);
      if (visiblePages.has(this))
        paymentTimers.set(this, setInterval(() => this.refreshPaymentCountdown(), 1000));
      return true;
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError &&
        error.sessionWasCleared &&
        error.requestEpoch === loadGuard.epoch &&
        customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return false;
      if (error instanceof AuthExpiredError) {
        if (!ownExpiry || !loadCoordinator.isLive(loadGuard)) return false;
        this.setData({ order: null, loading: false, error: customerErrorMessage(error, "订单详情加载失败，请稍后重试") });
        navigateToCustomerLogin(
          "order-detail",
          `/pages/order-detail/index?id=${encodeURIComponent(this.data.id)}`,
        );
        return false;
      }
      this.setData({
        error: customerErrorMessage(error, "订单详情加载失败，请稍后重试"),
      });
      return false;
    } finally {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ loading: false });
    }
  },
  refreshPaymentCountdown() {
    const order = this.data.order;
    if (!order || order.status !== "PENDING_PAYMENT") {
      stopPaymentTimer(this);
      return;
    }
    const expiresAt = order.checkoutBatch?.expiresAt ?? order.expiresAt;
    const serverTime = Date.parse(order.serverTime ?? "");
    const offset = paymentClockOffsets.get(this);
    if (!Number.isFinite(serverTime) || offset === undefined) {
      this.setData({ paymentCountdownText: "支付状态校时中，请刷新订单确认", order: { ...order, canPay: false } });
      stopPaymentTimer(this);
      return;
    }
    const remaining = Date.parse(expiresAt) - (Date.now() + offset);
    if (remaining > 0) {
      const seconds = Math.ceil(remaining / 1000);
      const minutesText = String(Math.floor(seconds / 60)).padStart(2, "0");
      const secondsText = String(seconds % 60).padStart(2, "0");
      this.setData({ paymentCountdownText: `剩余支付时间 ${minutesText}:${secondsText}`, order: { ...order, canPay: true } });
      return;
    }
    this.setData({
      paymentCountdownText: "支付有效期已到，正在核实支付状态；确认前请勿再次付款",
      order: { ...order, canPay: false },
    });
    stopPaymentTimer(this);
    if (!expiryChecks.has(this)) {
      expiryChecks.add(this);
      void this.refreshPaymentStateAfterExpiry();
    }
  },
  async refreshPaymentStateAfterExpiry() {
    const order = this.data.order;
    if (!order || this.data.statusCheckLoading) return;
    this.setData({ statusCheckLoading: true });
    try {
      const latest = await api.getOrder(order.id);
      if (!visiblePages.has(this) || this.data.order?.id !== order.id || !customerAuth.isLoggedIn()) return;
      if (latest.status !== "PENDING_PAYMENT") {
        await this.loadOrder();
        return;
      }
      this.setData({
        paymentCountdownText: "支付期限已到，服务端仍在核对支付结果；请稍后刷新订单状态",
        order: { ...order, status: latest.status, ...(latest.serverTime ? { serverTime: latest.serverTime } : {}), canPay: false },
      });
    } catch (error) {
      this.setData({ paymentCountdownText: customerErrorMessage(error, "支付期限已到，支付状态暂不可用，请刷新核对") });
    } finally {
      this.setData({ statusCheckLoading: false });
    }
  },
  async pay() {
    const order = this.data.order;
    if (!order || !order.canPay || this.data.paying) return;
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const current = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    if (!current()) return;
    this.setData({ paying: true });
    pendingPayments.add(this);
    let resultOpened = false;
    try {
      const resource: "order" | "checkout" = order.checkoutBatch && order.checkoutBatch.orderCount > 1 ? "checkout" : "order";
      const outcome = resource === "checkout"
        ? await payOrderCheckout(order.checkoutBatch!.id, current)
        : await payOrder(order.id, current);
      const resultId = resource === "checkout" ? order.checkoutBatch!.id : order.id;
      if (current()) {
        openPaymentResult(resource, resultId, outcome);
        resultOpened = true;
      } else if (customerAuth.isLoggedIn() && customerAuth.captureSessionEpoch() === action.epoch) {
        const result = { resource, id: resultId, outcome, epoch: action.epoch };
        if (visiblePages.has(this)) {
          openPaymentResult(result.resource, result.id, result.outcome);
          resultOpened = true;
        } else deferredPaymentResults.set(this, result);
      }
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) || !actionCoordinator.isActive(action)) return;
        navigateToCustomerLogin("order-detail", `/pages/order-detail/index?id=${encodeURIComponent(order.id)}`);
        return;
      }
      if (!current()) return;
      void wx.showModal({
        title: "支付未完成",
        content: "支付暂未完成，请稍后在订单详情继续支付。",
        showCancel: false,
      });
    } finally {
      pendingPayments.delete(this);
      if (current()) this.setData({ paying: false });
      else if (visiblePages.has(this) && !resultOpened && !deferredPaymentResults.has(this)) {
        void this.loadOrder();
      }
    }
  },
  async cancel() {
    const order = this.data.order;
    if (!order || !order.canCancel || this.data.cancelling) return;
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const current = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    const paidOrder = order.status !== "PENDING_PAYMENT";
    if (!current()) return;
    const result = await wx.showModal({
      title: paidOrder ? "申请取消社区订单？" : "取消未支付订单？",
      content: paidOrder
        ? "截单前将原路全额退款；截单后会进入运营审核与财务退款流程。"
        : "取消后商品会回到本团可售库存，需重新下单才能支付。",
      confirmText: paidOrder ? "提交申请" : "确认取消",
      confirmColor: "#cf492f",
    });
    if (!current()) return;
    if (!result.confirm) return;
    this.setData({ cancelling: true });
    pendingCancellations.add(this);
    try {
      const cancellation = await api.cancelOrder(order.id);
      if (!current()) return;
      await this.loadOrder();
      if (!current()) return;
      const confirmedStatus = cancellation.status;
      const toast = confirmedStatus === "CANCELLED"
        ? "订单已取消"
        : confirmedStatus === "PENDING_PAYMENT" || confirmedStatus === "PAID_WAITING_CLOSE"
          ? "支付状态已核实，订单未取消"
          : paidOrder
            ? "取消申请已提交"
            : "订单状态已更新";
      void wx.showToast({
        title: toast,
        icon: "success",
      });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) || !actionCoordinator.isActive(action)) return;
        navigateToCustomerLogin("order-detail", `/pages/order-detail/index?id=${encodeURIComponent(order.id)}`);
        return;
      }
      if (!current()) return;
      void wx.showModal({
        title: "取消失败",
        content: customerErrorMessage(error, "操作失败，请稍后重试"),
        showCancel: false,
      });
    } finally {
      pendingCancellations.delete(this);
      if (current()) this.setData({ cancelling: false });
      else if (visiblePages.has(this)) {
        void this.loadOrder();
      }
    }
  },
  openPickupCode() {
    if (this.data.order)
      void wx.navigateTo({
        url: `/pages/pickup-code/index?orderId=${encodeURIComponent(this.data.order.id)}`,
      });
  },
  openAfterSale() {
    if (!this.data.order) return;
    void wx.navigateTo({
      url: `/pages/after-sale/index?orderId=${encodeURIComponent(this.data.order.id)}`,
    });
  },
});
