import { api, AuthExpiredError, customerAuth } from "../../utils/api";
import {
  canSubmitCommunityQualityCase,
  communityQualityCaseStatusText,
} from "../../utils/community-quality";
import { formatDateTime, formatMoney } from "../../utils/format";
import {
  cancellationStatusText,
  formatChinaDateTime,
  orderStatusCopy,
  pickupDeadlineText,
  pickupWindowStatusText,
  qualityDeadlineText,
  refundStatusText,
} from "../../utils/consumer-display";
import { payOrder } from "../../utils/payment";
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
    time: eta ? `预计 ${formatDateTime(eta)} 到达` : "到货时间待确认",
  };
}

const loadCoordinator = new PageLoadCoordinator();
const actionCoordinator = new PageActionCoordinator();

Page({
  data: {
    id: "",
    loading: true,
    error: "",
    order: null as OrderDetailView | null,
    paying: false,
    cancelling: false,
  },
  onHide() { loadCoordinator.hide(); actionCoordinator.invalidate(); },
  onUnload() { loadCoordinator.unload(); actionCoordinator.invalidate(); },
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
    if (this.data.id) void this.loadOrder();
  },
  openLogin() {
    navigateToCustomerLogin(
      "order-detail",
      `/pages/order-detail/index?id=${encodeURIComponent(this.data.id)}`,
    );
  },
  async loadOrder() {
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    // Clear the prior identity's detail before issuing a new protected read.
    this.setData({ loading: true, error: "", order: null });
    if (!customerAuth.isLoggedIn()) {
      this.setData({ loading: false, error: "登录后可查看订单详情", order: null });
      if (consumeCancelReturnSuppression({ source: "order-detail", returnUrl: `/pages/order-detail/index?id=${encodeURIComponent(this.data.id)}` })) return;
      navigateToCustomerLogin(
        "order-detail",
        `/pages/order-detail/index?id=${encodeURIComponent(this.data.id)}`,
      );
      return;
    }
    try {
      const order = await api.getOrder(this.data.id);
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return;
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
            ? `部分商品异常，退款${partialRefunds.some((item) => item.status === "PROCESSING" || item.status === "CREATED") ? "处理中" : "已处理"}：${formatMoney(partialRefunds.reduce((sum, item) => sum + item.amountCents, 0))}`
            : null,
          itemViews,
        },
      });
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError &&
        error.sessionWasCleared &&
        error.requestEpoch === loadGuard.epoch &&
        customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      if (error instanceof AuthExpiredError) {
        if (!ownExpiry || !loadCoordinator.isLive(loadGuard)) return;
        this.setData({ order: null, loading: false, error: error.message });
        navigateToCustomerLogin(
          "order-detail",
          `/pages/order-detail/index?id=${encodeURIComponent(this.data.id)}`,
        );
        return;
      }
      this.setData({
        error: error instanceof Error ? error.message : "订单加载失败",
      });
    } finally {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ loading: false });
    }
  },
  async pay() {
    const order = this.data.order;
    if (!order || !order.canPay || this.data.paying) return;
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const current = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    if (!current()) return;
    this.setData({ paying: true });
    try {
      await payOrder(order.id, current);
      if (!current()) return;
      await this.loadOrder();
      if (!current()) return;
      void wx.showToast({ title: "支付完成", icon: "success" });
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
      if (current()) this.setData({ paying: false });
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
    try {
      await api.cancelOrder(order.id);
      if (!current()) return;
      await this.loadOrder();
      if (!current()) return;
      void wx.showToast({
        title: paidOrder ? "取消申请已提交" : "订单已取消",
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
        content: error instanceof Error ? error.message : "请稍后重试",
        showCancel: false,
      });
    } finally {
      if (current()) this.setData({ cancelling: false });
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
