import { api, customerErrorMessage } from "../../utils/api";
import { formatMoney } from "../../utils/format";
import { estimatedArrivalText, formatChinaDateTime, isCampaignPurchasable } from "../../utils/consumer-display";
import { addCartLine, cartCount as readCartCount, type CartSnapshot } from "../../utils/cart";
import { loadServiceAreaContext, type ServiceAreaSelection } from "../../utils/service-area";
import { loadPickupPoints, type PickupPointSelection } from "../../utils/pickup-point";

interface CategoryProduct extends CampaignDto {
  renderKey: string;
  skuId: string;
  productTitle: string;
  skuName: string;
  category: string;
  origin: string;
  priceText: string;
  cutoffText: string;
  arrivalText: string;
  imageUrl: string | null;
  unitPriceCents: number;
  stock: number;
  soldQuantity: number;
  salesQuantity: number;
}

Page({
  data: {
    loading: true,
    error: "",
    categories: [] as string[],
    activeCategory: "全部",
    products: [] as CategoryProduct[],
    allProducts: [] as CategoryProduct[],
    area: null as ServiceAreaSelection | null,
    pickupPoint: null as PickupPointSelection | null,
    imageRefreshKey: 0,
    cartCount: 0,
  },
  onLoad() { void this.loadProducts(); },
  onShow() {
    this.setData({ cartCount: readCartCount() });
    const stored = wx.getStorageSync<string>("categoryFilter");
    if (stored && this.data.categories.length > 0) {
      if (stored !== this.data.activeCategory && this.data.categories.includes(stored)) {
        this.selectCategory({ currentTarget: { dataset: { category: stored } } } as unknown as WechatMiniprogram.BaseEvent);
      }
      wx.removeStorageSync("categoryFilter");
    }
  },
  onPullDownRefresh() { void this.loadProducts().finally(() => wx.stopPullDownRefresh()); },
  async loadProducts() {
    this.setData({ loading: true, error: "" });
    try {
      const context = await loadServiceAreaContext();
      const [campaigns, pointContext, configuredCategories] = await Promise.all([
        api.listCampaigns(),
        context.selected ? loadPickupPoints(context.selected.id) : Promise.resolve({ points: [], selected: null }),
        api.listProductCategories().catch(() => null),
      ]);
      const pickupPoint = pointContext.selected;
      const products = campaigns
        .filter((campaign) => isCampaignPurchasable(campaign) && context.selected && pickupPoint && campaign.serviceAreaId === context.selected.id && campaign.deliveryPlan?.pickupPointId === pickupPoint.id)
        .flatMap((campaign) => campaign.items.map((item) => ({
          ...campaign,
          renderKey: `${campaign.id}:${item.skuId}`,
          skuId: item.skuId,
          productTitle: item.title,
          skuName: item.skuName,
          category: item.category,
          origin: item.origin,
          imageUrl: item.imageUrl,
          unitPriceCents: item.unitPriceCents,
          stock: item.stock,
          soldQuantity: item.soldQuantity,
          salesQuantity: item.salesQuantity ?? 0,
          priceText: formatMoney(item.unitPriceCents),
          cutoffText: formatChinaDateTime(campaign.cutoffAt, true),
          arrivalText: estimatedArrivalText(campaign) ?? "到货时间待确认",
        })));
      const categories = ["全部", ...(configuredCategories === null
        ? [...new Set(products.map((item) => item.category))]
        : configuredCategories.map((item) => item.name))];
      const requested = wx.getStorageSync<string>("categoryFilter");
      const activeCategory = requested && categories.includes(requested) ? requested : "全部";
      if (requested) wx.removeStorageSync("categoryFilter");
      const visibleProducts = activeCategory === "全部" ? products : products.filter((item) => item.category === activeCategory);
      this.setData({ allProducts: products, products: visibleProducts, categories, activeCategory, area: context.selected, pickupPoint, imageRefreshKey: this.data.imageRefreshKey + 1, cartCount: readCartCount() });
    } catch (error) {
      this.setData({ error: customerErrorMessage(error, "商品加载失败，请稍后重试") });
    } finally { this.setData({ loading: false }); }
  },
  selectCategory(event: WechatMiniprogram.BaseEvent) {
    const activeCategory = event.currentTarget.dataset.category as string;
    this.setData({ activeCategory, products: activeCategory === "全部" ? this.data.allProducts : this.data.allProducts.filter((item) => item.category === activeCategory), imageRefreshKey: this.data.imageRefreshKey + 1 });
  },
  openProduct(event: WechatMiniprogram.BaseEvent) {
    void wx.navigateTo({ url: `/pages/campaign/detail?id=${encodeURIComponent(event.currentTarget.dataset.id as string)}&skuId=${encodeURIComponent(event.currentTarget.dataset.sku as string)}` });
  },
  addToCart(event: WechatMiniprogram.BaseEvent) {
    const item = this.data.allProducts.find((candidate) => candidate.renderKey === event.currentTarget.dataset.key);
    if (!item || !this.data.area || !this.data.pickupPoint) return;
    const base: Omit<CartSnapshot, "items" | "updatedAt"> = { campaignId: item.id, campaignTitle: item.title, serviceAreaId: item.serviceAreaId, serviceAreaName: this.data.area.name, pickupPointId: this.data.pickupPoint.id, pickupPointName: this.data.pickupPoint.name, pickupPointAddress: this.data.pickupPoint.address, cutoffAt: item.cutoffAt, arrivalText: item.arrivalText };
    addCartLine(base, { skuId: item.skuId, title: item.productTitle, skuName: item.skuName, imageUrl: item.imageUrl, unitPriceCents: item.unitPriceCents, quantity: 1, maxQuantity: Math.max(1, item.stock - item.soldQuantity) });
    this.setData({ cartCount: readCartCount() });
    void wx.showToast({ title: "已加入购物车", icon: "success" });
  },
  openCart() { void wx.switchTab({ url: "/pages/cart/index" }); },
});
