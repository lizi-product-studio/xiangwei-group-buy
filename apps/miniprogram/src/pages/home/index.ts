import { api, customerErrorMessage } from '../../utils/api';
import { formatMoney } from '../../utils/format';
import { estimatedArrivalText, formatChinaDateTime, isCampaignPurchasable, shouldShowFloatingCart } from '../../utils/consumer-display';
import { cartCount as readCartCount } from '../../utils/cart';
import { addCartLine, readCart, type CartSnapshot } from '../../utils/cart';
import { resolveProductImageUrl } from '../../utils/product-image';
import { loadServiceAreaContext, type ServiceAreaSelection } from '../../utils/service-area';
import { loadPickupPoints, type PickupPointSelection } from '../../utils/pickup-point';

interface CampaignView extends CampaignDto {
  renderKey: string;
  cutoffText: string;
  dispatchText: string;
  skuId: string;
  productTitle: string;
  skuName: string;
  origin: string;
  priceText: string;
  soldQuantity: number;
  salesQuantity: number;
  category: string;
  imageUrl: string | null;
  arrivalText: string;
  unitPriceCents: number;
  stock: number;
}

interface CategoryItem { value: string; label: string; icon: string; }
interface BannerView extends HomepageBannerDto { imageUrl: string; }

const CATEGORY_ICON_PATHS = [
  '/assets/category-icon-leaf.png', '/assets/category-icon-grain.png', '/assets/category-icon-beans.png',
  '/assets/category-icon-ready-food.png', '/assets/category-icon-seasoning.png',
];

Page({
  onShareAppMessage() {
    return { title: "乡味集｜好味道，一起分享", path: "/pages/home/index" };
  },
  onShareTimeline() {
    return { title: "乡味集｜好味道，一起分享", query: "" };
  },
  data: {
    loading: true, error: '', campaigns: [] as CampaignView[], allProducts: [] as CampaignView[], categories: [] as string[], categoryItems: [] as CategoryItem[],
    activeCategory: '全部', area: null as ServiceAreaSelection | null,pickupPoint:null as PickupPointSelection|null,
    searchQuery: '',
    deliveryText: '下单前确认固定自提点，到货时间会持续更新',
    cartCount: 0,
    banners: [] as BannerView[],
    imageRefreshKey: 0,
    availableAreaCount: 0,
  },

  onLoad() {
    if (typeof wx.showShareMenu === "function") wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },
  onShow() { void this.loadCampaigns(); },
  onPullDownRefresh() { void this.loadCampaigns().finally(() => wx.stopPullDownRefresh()); },

  async loadCampaigns() {
    this.setData({ loading: true, error: '' });
    try {
      const areaContext = await loadServiceAreaContext();
      const [allCampaigns, banners, pointContext] = await Promise.all([
        api.listCampaigns(),
        typeof api.listHomepageBanners === "function" ? api.listHomepageBanners(areaContext.selected?.id).catch(() => [] as HomepageBannerDto[]) : Promise.resolve([] as HomepageBannerDto[]),
        areaContext.selected ? loadPickupPoints(areaContext.selected.id) : Promise.resolve({ points: [], selected: null }),
      ]);
      const selectedPoint=pointContext.selected;
      const campaigns = allCampaigns
        .filter((campaign) => isCampaignPurchasable(campaign) && areaContext.selected && selectedPoint && campaign.serviceAreaId === areaContext.selected.id && campaign.deliveryPlan?.pickupPointId === selectedPoint.id)
        .flatMap((campaign) => campaign.items.map((product) => ({
          ...campaign, renderKey: `${campaign.id}:${product.skuId}`, skuId: product.skuId, productTitle: product.title, skuName: product.skuName, category: product.category, unitPriceCents: product.unitPriceCents, stock: product.stock,
          imageUrl: product.imageUrl, origin: product.origin, priceText: formatMoney(product.unitPriceCents), soldQuantity: product.soldQuantity, salesQuantity: product.salesQuantity ?? 0,
          cutoffText: formatChinaDateTime(campaign.cutoffAt, true), dispatchText: formatChinaDateTime(campaign.dispatchAt),
          arrivalText: estimatedArrivalText(campaign) ?? '到货时间待确认',
        })));
      const categories = [...new Set(campaigns.map((item) => item.category))];
      const categoryItems: CategoryItem[] = [
        { value: '全部', label: '全部', icon: CATEGORY_ICON_PATHS[0]! },
        ...categories.map((value, index) => ({ value, label: value, icon: CATEGORY_ICON_PATHS[(index + 1) % CATEGORY_ICON_PATHS.length]! })),
      ];
      const first = campaigns[0];
      const deliveryText = first?.deliveryPlan?.pickupPointId
        ? `截单 ${first.cutoffText} · ${first.arrivalText}`
        : selectedPoint ? '本期好物正在筹备，开团后即可选购' : '请选择方便领取的固定自提点';
      const currentCartCount = readCartCount();
      const activeCategory = categories.includes(this.data.activeCategory) ? this.data.activeCategory : '全部';
      this.setData({ availableAreaCount: areaContext.areas.length, campaigns: this.filterProducts(campaigns, activeCategory, this.data.searchQuery), allProducts: campaigns, categories, categoryItems, activeCategory, imageRefreshKey: this.data.imageRefreshKey + 1, area: areaContext.selected,pickupPoint:selectedPoint, deliveryText, cartCount: shouldShowFloatingCart(currentCartCount) ? currentCartCount : 0, banners: banners.map((item) => ({ ...item, imageUrl: resolveProductImageUrl(item.imageUrl, getApp<IAppOption>().globalData.apiBaseUrl) })).filter((item) => item.imageUrl) });
    } catch (error) {
      this.setData({ error: customerErrorMessage(error, '商品加载失败，请稍后重试') });
    } finally { this.setData({ loading: false }); }
  },

  openCampaign(event: WechatMiniprogram.BaseEvent) {
    void wx.navigateTo({ url: `/pages/campaign/detail?id=${encodeURIComponent(event.currentTarget.dataset.id as string)}&skuId=${encodeURIComponent(event.currentTarget.dataset.sku as string)}` });
  },
  openInterest() { void wx.navigateTo({ url: '/pages/interest/index' }); },
  openMessages() { void wx.navigateTo({ url: '/pages/messages/index' }); },
  openOrders() { void wx.navigateTo({ url: '/pages/orders/index' }); },
  openPickup() { void wx.navigateTo({ url: '/pages/pickup-select/index' }); },
  openCart() { void wx.switchTab({ url: '/pages/cart/index' }); },
  openBanner(event: WechatMiniprogram.BaseEvent) {
    const banner = this.data.banners[Number(event.currentTarget.dataset.index)] ?? this.data.banners[0];
    if (!banner) return;
    if (banner.targetType === 'CAMPAIGN' && banner.targetValue) {
      void wx.navigateTo({ url: `/pages/campaign/detail?id=${encodeURIComponent(banner.targetValue)}` });
    } else if (banner.targetType === 'CATEGORY') {
      wx.setStorageSync('categoryFilter', banner.targetValue ?? '全部');
      void wx.switchTab({ url: '/pages/category/index' });
    }
  },
  addToCart(event: WechatMiniprogram.BaseEvent) {
    const item = this.data.allProducts.find((candidate) => candidate.renderKey === event.currentTarget.dataset.key);
    if (!item || !this.data.area || !this.data.pickupPoint) return;
    const base: Omit<CartSnapshot, 'items' | 'updatedAt'> = {
      campaignId: item.id,
      campaignTitle: item.title,
      serviceAreaId: item.serviceAreaId,
      serviceAreaName: this.data.area.name,
      pickupPointId: this.data.pickupPoint.id,
      pickupPointName: this.data.pickupPoint.name,
      pickupPointAddress: this.data.pickupPoint.address,
    };
    const existing = readCart();
    if (existing && (existing.campaignId !== base.campaignId || existing.pickupPointId !== base.pickupPointId)) {
      void wx.showModal({ title: '购物车属于其他团期', content: `当前购物车是“${existing.campaignTitle}”，请先结算或清空后再加入本期商品。`, showCancel: false });
      return;
    }
    const cart = addCartLine(base, { skuId: item.skuId, title: item.productTitle, skuName: item.skuName, imageUrl: item.imageUrl, unitPriceCents: item.unitPriceCents, quantity: 1, maxQuantity: Math.max(1, item.stock - item.soldQuantity) });
    this.setData({ cartCount: readCartCount(cart) });
    void wx.showToast({ title: '已加入购物车', icon: 'success' });
  },
  changeCategory(event: WechatMiniprogram.BaseEvent) {
    const activeCategory = event.currentTarget.dataset.category as string;
    this.setData({ activeCategory, imageRefreshKey: this.data.imageRefreshKey + 1, campaigns: this.filterProducts(this.data.allProducts, activeCategory, this.data.searchQuery) });
  },
  filterProducts(products: CampaignView[], category: string, query: string): CampaignView[] {
    const normalized = query.trim().toLowerCase();
    return products.filter((item) => (category === '全部' || item.category === category) && (!normalized || `${item.productTitle} ${item.skuName} ${item.category}`.toLowerCase().includes(normalized)));
  },
  onSearchInput(event: WechatMiniprogram.Input) {
    const searchQuery = event.detail.value;
    this.setData({ searchQuery, campaigns: this.filterProducts(this.data.allProducts, this.data.activeCategory, searchQuery), imageRefreshKey: this.data.imageRefreshKey + 1 });
  },
  clearSearch() { this.setData({ searchQuery: '', campaigns: this.filterProducts(this.data.allProducts, this.data.activeCategory, ''), imageRefreshKey: this.data.imageRefreshKey + 1 }); },
});
