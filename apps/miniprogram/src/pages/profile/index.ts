import { api, AuthExpiredError, customerAuth } from "../../utils/api";
import {
  loadServiceAreaContext,
  type ServiceAreaSelection,
} from "../../utils/service-area";
import {
  readPickupPointSelection,
  type PickupPointSelection,
} from "../../utils/pickup-point";
import { navigateToCustomerLogin } from "../../utils/auth-navigation";
import { PageLoadCoordinator } from "../../utils/page-load-guard";
import { PageActionCoordinator } from "../../utils/page-action-coordinator";

interface OrderCounts {
  pending: number;
  active: number;
  ready: number;
  afterSale: number;
}
const loadCoordinator = new PageLoadCoordinator();
const areaCoordinator = new PageLoadCoordinator();
const actionCoordinator = new PageActionCoordinator();

Page({
  data: {
    loading: true,
    error: "",
    userName: "微信用户",
    loggedIn: false,
    wechatMode: false,
    area: null as ServiceAreaSelection | null,
    pickupPoint: null as PickupPointSelection | null,
    orderTotal: 0,
    counts: { pending: 0, active: 0, ready: 0, afterSale: 0 } as OrderCounts,
  },
  onShow() {
    loadCoordinator.show();
    areaCoordinator.show();
    actionCoordinator.activate();
    this.setData({ area: null, pickupPoint: null });
    void this.loadSummary();
    void this.loadArea();
  },
  async loadArea() {
    const loadGuard = areaCoordinator.begin(customerAuth.captureSessionEpoch());
    try {
      const context = await loadServiceAreaContext();
      if (!areaCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      this.setData({
        area: context.selected,
        pickupPoint: readPickupPointSelection(),
      });
    } catch {
      if (areaCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ area: null, pickupPoint: readPickupPointSelection() });
    }
  },
  async loadSummary() {
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    const loggedIn = customerAuth.isLoggedIn();
    this.setData({
      loading: loggedIn,
      error: "",
      loggedIn,
      wechatMode: customerAuth.isWechatMode(),
      userName: "微信用户",
      orderTotal: 0,
      counts: { pending: 0, active: 0, ready: 0, afterSale: 0 },
    });
    if (!loggedIn) return;
    try {
      const orders = await api.listOrders();
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return;
      const counts: OrderCounts = {
        pending: 0,
        active: 0,
        ready: 0,
        afterSale: orders
          .flatMap((item) => item.communityQualityCases ?? [])
          .filter((item) =>
            ["REGISTERED", "ACCEPTED", "REFUNDING"].includes(item.status),
          ).length,
      };
      for (const order of orders) {
        if (order.status === "PENDING_PAYMENT") counts.pending += 1;
        else if (
          ["PAID_WAITING_CLOSE", "LOCKED", "ALLOCATING", "IN_TRANSIT"].includes(
            order.status,
          )
        )
          counts.active += 1;
        else if (order.status === "READY_FOR_PICKUP") counts.ready += 1;
      }
      this.setData({ orderTotal: orders.length, counts });
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError &&
        error.sessionWasCleared &&
        error.requestEpoch === loadGuard.epoch &&
        customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      if (error instanceof AuthExpiredError) {
        if (!ownExpiry || !loadCoordinator.isLive(loadGuard)) return;
        this.setData({
          loggedIn: false,
          wechatMode: false,
          loading: false,
          error: error.message,
          orderTotal: 0,
          counts: { pending: 0, active: 0, ready: 0, afterSale: 0 },
        });
        navigateToCustomerLogin("profile", "/pages/profile/index");
        return;
      }
      this.setData({
        error: error instanceof Error ? error.message : "订单概览加载失败",
      });
    } finally {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ loading: false });
    }
  },
  onHide() { loadCoordinator.hide(); areaCoordinator.hide(); actionCoordinator.invalidate(); },
  onUnload() { loadCoordinator.unload(); areaCoordinator.unload(); actionCoordinator.invalidate(); },
  openLogin() {
    navigateToCustomerLogin("profile", "/pages/profile/index");
  },
  async logout() {
    const epochBeforeLogout = customerAuth.captureSessionEpoch();
    const action = actionCoordinator.begin(epochBeforeLogout);
    const logoutPromise = customerAuth.logout();
    // customerAuth invalidates the identity synchronously; clear this page
    // immediately, while fencing the update so a later account cannot be
    // erased when the remote revoke response arrives.
    if (actionCoordinator.isActive(action) &&
        customerAuth.captureSessionEpoch() === epochBeforeLogout + 1) {
      this.setData({
        loggedIn: false,
        wechatMode: false,
        loading: false,
        error: "",
        orderTotal: 0,
        counts: { pending: 0, active: 0, ready: 0, afterSale: 0 },
      });
    }
    await logoutPromise;
  },
  openOrders(event: WechatMiniprogram.BaseEvent) {
    wx.setStorageSync(
      "orderFilter",
      (event.currentTarget.dataset.filter as string | undefined) ?? "ALL",
    );
    if (!customerAuth.isLoggedIn()) {
      navigateToCustomerLogin("orders", "/pages/orders/index");
      return;
    }
    void wx.switchTab({ url: "/pages/orders/index" });
  },
  openPickup() {
    void wx.navigateTo({ url: "/pages/pickup-select/index" });
  },
  openInterest() {
    void wx.navigateTo({ url: "/pages/interest/index" });
  },
  openMessages() {
    void wx.navigateTo({ url: "/pages/messages/index" });
  },
  openTerms() {
    void wx.navigateTo({ url: "/pages/legal/index?document=terms" });
  },
  openPrivacy() {
    void wx.navigateTo({ url: "/pages/legal/index?document=privacy" });
  },
  showHelp() {
    void wx.showModal({
      title: "下单与集中领取",
      content:
        "先选择固定自提点，再选购并支付。平台统一收单、备货和预约车辆；预计到货时间会更新到订单，到货后订单会生成取货码。",
      showCancel: false,
      confirmText: "知道了",
    });
  },
  showAbout() {
    void wx.showModal({
      title: "乡味集",
      content:
        "统一收单，按团期集中送达。正式运行时使用微信授权登录，订单与取货码仅对本人可见。",
      showCancel: false,
      confirmText: "关闭",
    });
  },
});
