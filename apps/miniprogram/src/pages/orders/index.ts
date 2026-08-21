import { formatDateTime, formatMoney } from "../../utils/format";
import { api, customerAuth } from "../../utils/api";

interface OrderView extends OrderDto {
  total: string;
  createdText: string;
  statusText: string;
  canPickup: boolean;
  deliveryName: string;
  deliveryAddress: string;
  itemSummary: string;
  imageUrl: string;
}
let cachedOrders: OrderView[] = [];
function inFilter(order: OrderView, filter: string): boolean {
  if (filter === "PENDING") return order.status === "PENDING_PAYMENT";
  if (filter === "ACTIVE")
    return [
      "PAID_WAITING_CLOSE",
      "LOCKED",
      "ALLOCATING",
      "IN_TRANSIT",
    ].includes(order.status);
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
    const storedFilter = wx.getStorageSync<string>("orderFilter");
    const activeFilter = storedFilter || "ALL";
    if (storedFilter) wx.removeStorageSync("orderFilter");
    this.setData({ loading: true, error: "", activeFilter });
    if (!customerAuth.isLoggedIn()) {
      cachedOrders = [];
      this.setData({
        loading: false,
        error: "登录后可查看你的订单与领取进度",
        orders: [],
      });
      return;
    }
    const statusLabels: Record<string, string> = {
      PENDING_PAYMENT: "待支付",
      PAID_WAITING_CLOSE: "等待结团",
      LOCKED: "已截单，运营备货中",
      REFUNDING: "退款中",
      REFUNDED: "已退款",
      ALLOCATING: "装袋与发车准备中",
      IN_TRANSIT: "配送至自提点",
      READY_FOR_PICKUP: "待领取",
      PICKED_UP: "已领取",
      COMPLETED: "已完成",
      CANCELLED: "已取消",
    };
    try {
      const [orders, campaigns] = await Promise.all([
        api.listOrders(),
        api.listCampaigns(),
      ]);
      const imageMap = new Map(
        campaigns.flatMap((campaign) =>
          campaign.items.map((item) => [item.skuId, item.imageUrl] as const),
        ),
      );
      cachedOrders = orders.map((order) => {
        const delivery = deliveryText(order.deliveryPlan);
        const firstSkuId = order.items[0]?.skuId;
        return {
          ...order,
          total: formatMoney(order.totalCents),
          createdText: formatDateTime(order.createdAt),
          statusText: statusLabels[order.status] ?? order.status,
          canPickup: order.status === "READY_FOR_PICKUP",
          deliveryName: delivery.name,
          deliveryAddress: delivery.address,
          itemSummary: order.items
            .map((item) => `${item.name} × ${item.quantity}`)
            .join("、"),
          imageUrl: firstSkuId
            ? (imageMap.get(firstSkuId) ?? "/assets/product-rice-noodles.jpg")
            : "/assets/product-rice-noodles.jpg",
        };
      });
      this.setData({
        orders: cachedOrders.filter((order) => inFilter(order, activeFilter)),
      });
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "订单加载失败",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  changeFilter(event: WechatMiniprogram.BaseEvent) {
    const activeFilter = event.currentTarget.dataset.filter as string;
    this.setData({
      activeFilter,
      orders: cachedOrders.filter((order) => inFilter(order, activeFilter)),
    });
  },
  openOrder(event: WechatMiniprogram.BaseEvent) {
    void wx.navigateTo({
      url: `/pages/order-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id as string)}`,
    });
  },
});
