import { api, AuthExpiredError, copyLatestRequestId, customerAuth, customerErrorMessage, getLatestRequestId } from "../../utils/api";
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
    avatarUrl: "",
    phoneNumber: "",
    loggedIn: false,
    wechatMode: false,
    area: null as ServiceAreaSelection | null,
    pickupPoint: null as PickupPointSelection | null,
    areaError: "",
    latestRequestId: "",
    orderTotal: 0,
    counts: { pending: 0, active: 0, ready: 0, afterSale: 0 } as OrderCounts,
  },
  onShow() {
    loadCoordinator.show();
    areaCoordinator.show();
    actionCoordinator.activate();
    this.setData({ area: null, pickupPoint: null, areaError: "", latestRequestId: getLatestRequestId() ?? "" });
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
        areaError: "",
      });
    } catch (error) {
      if (areaCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()))
        this.setData({
          area: null,
          pickupPoint: null,
          areaError: customerErrorMessage(error, "收货区域加载失败，请稍后重试"),
        });
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
      avatarUrl: "",
      phoneNumber: "",
      orderTotal: 0,
      counts: { pending: 0, active: 0, ready: 0, afterSale: 0 },
    });
    if (!loggedIn) return;
    try {
      const [orders, profile] = await Promise.all([
        api.listOrders(),
        api.getMyProfile().catch((error) => {
          if (error instanceof AuthExpiredError) throw error;
          return null;
        }),
      ]);
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
      const avatarUrl = profile?.avatarUrl
        ? await api.downloadMyProfileImage(profile.avatarUrl).catch((error) => {
            if (error instanceof AuthExpiredError) throw error;
            return "";
          })
        : "";
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return;
      this.setData({ orderTotal: orders.length, counts, userName: profile?.displayName || "微信用户", avatarUrl, phoneNumber: profile?.phoneNumber ?? "" });
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
        error: customerErrorMessage(error, "订单概览加载失败，请稍后重试"),
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
  openProfileEdit() {
    if (!customerAuth.isLoggedIn()) { this.openLogin(); return; }
    void wx.navigateTo({ url: "/pages/profile-edit/index" });
  },
  openPickupCode() { this.openOrders({ currentTarget: { dataset: { filter: "READY" } } } as unknown as WechatMiniprogram.BaseEvent); },
  confirmLogout() {
    void wx.showModal({ title: "退出当前账号？", content: "退出后仍可重新登录，历史订单不会丢失。", confirmText: "退出登录", confirmColor: "#c2412d", success: (result) => { if (result.confirm) void this.logout(); } });
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
    void wx.navigateTo({ url: "/pages/orders/index" });
  },
  openPickup() {
    void wx.navigateTo({ url: "/pages/pickup-select/index" });
  },
  openMessages() {
    void wx.navigateTo({ url: "/pages/messages/index" });
  },
  copyLatestRequestId() {
    copyLatestRequestId();
  },
  openPrivacy() {
    void wx.navigateTo({ url: "/pages/legal/index?document=privacy" });
  },
});
