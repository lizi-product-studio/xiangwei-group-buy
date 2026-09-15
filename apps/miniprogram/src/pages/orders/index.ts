import { formatDateTime, formatMoney } from "../../utils/format";
import { api, AuthExpiredError, customerAuth, customerErrorMessage } from "../../utils/api";
import { orderStatusCopy, orderStatusTone } from "../../utils/consumer-display";
import { navigateToCustomerLogin } from "../../utils/auth-navigation";
import { PageLoadCoordinator } from "../../utils/page-load-guard";

interface OrderView extends OrderDto {
  total: string;
  createdText: string;
  statusText: string;
  statusTone: string;
  canPickup: boolean;
  deliveryName: string;
  deliveryAddress: string;
  itemSummary: string;
  imageUrl: string;
}
interface OrdersCache {
  epoch: number;
  generation: number;
  items: OrderView[];
}
let cachedOrders: OrdersCache | null = null;
const loadCoordinator = new PageLoadCoordinator();
function inFilter(order: OrderView, filter: string): boolean {
  if (filter === "PENDING") return order.status === "PENDING_PAYMENT";
  if (filter === "ACTIVE")
    return [
      "PAID_WAITING_CLOSE",
      "LOCKED",
      "ALLOCATING",
      "IN_TRANSIT",
    ].includes(order.status);
  if (filter === "DONE") return ["PICKED_UP", "COMPLETED"].includes(order.status);
  if (filter === "READY") return order.status === "READY_FOR_PICKUP";
  if (filter === "AFTER")
    return (
      ["REFUNDING", "REFUNDED", "CANCELLED"].includes(order.status) ||
      Boolean(order.communityQualityCases?.length)
    );
  return true;
}
function deliveryText(plan: DeliveryPlanDto | null): {
  name: string;
  address: string;
} {
  if (!plan)
    return { name: "领取地点信息暂不可用", address: "请联系平台客服确认" };
  return { name: plan.siteName, address: plan.address };
}

Page({
  data: {
    orders: [] as OrderView[],
    loading: true,
    error: "",
    activeFilter: "ALL",
  },
  async onShow() {
    loadCoordinator.show();
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    const storedFilter = wx.getStorageSync<string>("orderFilter");
    const activeFilter = storedFilter || "ALL";
    if (storedFilter) wx.removeStorageSync("orderFilter");
    // Clear the previous identity before the new request starts. A logged-in
    // account may change while this tab is kept alive, so rendering the old
    // rows during loading would leak the previous account's orders.
    cachedOrders = null;
    this.setData({ loading: true, error: "", activeFilter, orders: [] });
    if (!customerAuth.isLoggedIn()) {
      this.setData({
        loading: false,
        error: "登录后可查看你的订单与领取进度",
        orders: [],
      });
      return;
    }
    try {
      const [orders, campaigns] = await Promise.all([
        api.listOrders(),
        api.listCampaigns().catch(() => []),
      ]);
      const imageMap = new Map(
        campaigns.flatMap((campaign) =>
          campaign.items.map((item) => [item.skuId, item.imageUrl] as const),
        ),
      );
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return;
      const items = orders.map((order) => {
        const delivery = deliveryText(order.deliveryPlan);
        const firstSkuId = order.items[0]?.skuId;
        return {
          ...order,
          total: formatMoney(order.totalCents),
          createdText: formatDateTime(order.createdAt),
          statusText: orderStatusCopy(order.status).text,
          statusTone: orderStatusTone(order.status),
          canPickup: order.status === "READY_FOR_PICKUP",
          deliveryName: delivery.name,
          deliveryAddress: delivery.address,
          itemSummary: order.items
            .map((item) => `${item.name} × ${item.quantity}`)
            .join("、"),
          imageUrl: firstSkuId
            ? (imageMap.get(firstSkuId) ?? "")
            : "",
        };
      });
      cachedOrders = { epoch: loadGuard.epoch, generation: loadGuard.generation, items };
      this.setData({ orders: items.filter((order) => inFilter(order, activeFilter)) });
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError &&
        error.sessionWasCleared &&
        error.requestEpoch === loadGuard.epoch &&
        customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      if (error instanceof AuthExpiredError) {
        if (!ownExpiry || !loadCoordinator.isLive(loadGuard)) return;
        cachedOrders = null;
      this.setData({ orders: [], loading: false, error: customerErrorMessage(error, "订单加载失败，请稍后重试") });
        navigateToCustomerLogin("orders", "/pages/orders/index");
        return;
      }
      this.setData({
        error: customerErrorMessage(error, "订单加载失败，请稍后重试"),
      });
    } finally {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ loading: false });
    }
  },
  onHide() { loadCoordinator.hide(); },
  onUnload() { loadCoordinator.unload(); },
  changeFilter(event: WechatMiniprogram.BaseEvent) {
    const activeFilter = event.currentTarget.dataset.filter as string;
    const cache = cachedOrders;
    const cacheGuard = cache && {
      epoch: cache.epoch,
      generation: cache.generation,
      isActive: true as const,
    };
    if (
      !cache ||
      !cacheGuard ||
      !customerAuth.isLoggedIn() ||
      !loadCoordinator.isCurrent(cacheGuard, customerAuth.captureSessionEpoch())
    ) {
      cachedOrders = null;
      this.setData({ activeFilter, orders: [] });
      return;
    }
    this.setData({
      activeFilter,
      orders: cache.items.filter((order) => inFilter(order, activeFilter)),
    });
  },
  openOrder(event: WechatMiniprogram.BaseEvent) {
    void wx.navigateTo({
      url: `/pages/order-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id as string)}`,
    });
  },
  openLogin() {
    navigateToCustomerLogin("orders", "/pages/orders/index");
  },
});
