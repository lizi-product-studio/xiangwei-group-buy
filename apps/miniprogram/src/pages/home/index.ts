import { api, customerErrorMessage } from '../../utils/api';
import { formatMoney } from '../../utils/format';
import { estimatedArrivalText, formatChinaDateTime, isCampaignPurchasable, shouldShowFloatingCart } from '../../utils/consumer-display';
import { cartCount as readCartCount } from '../../utils/cart';
import { loadServiceAreaContext, type ServiceAreaSelection } from '../../utils/service-area';
import { readPickupPointSelection, type PickupPointSelection } from '../../utils/pickup-point';

interface CampaignView extends CampaignDto {
  cutoffText: string;
  dispatchText: string;
  skuId: string;
  productTitle: string;
  skuName: string;
  origin: string;
  priceText: string;
  soldQuantity: number;
  category: string;
  imageUrl: string | null;
  arrivalText: string;
}

interface CategoryItem { value: string; label: string; icon: string; }

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
    deliveryText: '下单前确认固定自提点，到货时间会持续更新',
    cartCount: 0,
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
      const [allCampaigns, areaContext] = await Promise.all([api.listCampaigns(), loadServiceAreaContext()]);
      const selectedPoint=readPickupPointSelection();
      const campaigns = allCampaigns
        .filter((campaign) => isCampaignPurchasable(campaign) && areaContext.selected && selectedPoint && campaign.serviceAreaId === areaContext.selected.id && campaign.deliveryPlan?.pickupPointId === selectedPoint.id)
        .flatMap((campaign) => campaign.items.map((product) => ({
          ...campaign, skuId: product.skuId, productTitle: product.title, skuName: product.skuName, category: product.category,
          imageUrl: product.imageUrl, origin: product.origin, priceText: formatMoney(product.unitPriceCents), soldQuantity: product.soldQuantity,
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
      this.setData({ availableAreaCount: areaContext.areas.length, campaigns, allProducts: campaigns, categories, categoryItems, activeCategory: '全部', imageRefreshKey: this.data.imageRefreshKey + 1, area: areaContext.selected,pickupPoint:selectedPoint, deliveryText, cartCount: shouldShowFloatingCart(currentCartCount) ? currentCartCount : 0 });
    } catch (error) {
      this.setData({ error: customerErrorMessage(error, '商品加载失败，请稍后重试') });
    } finally { this.setData({ loading: false }); }
  },

  openCampaign(event: WechatMiniprogram.BaseEvent) {
    void wx.navigateTo({ url: `/pages/campaign/detail?id=${encodeURIComponent(event.currentTarget.dataset.id as string)}&skuId=${encodeURIComponent(event.currentTarget.dataset.sku as string)}` });
  },
  openInterest() { void wx.navigateTo({ url: '/pages/interest/index' }); },
  openMessages() { void wx.navigateTo({ url: '/pages/messages/index' }); },
  openOrders() { void wx.switchTab({ url: '/pages/orders/index' }); },
  openPickup() { void wx.navigateTo({ url: '/pages/pickup-select/index' }); },
  openCart() { void wx.switchTab({ url: '/pages/cart/index' }); },
  changeCategory(event: WechatMiniprogram.BaseEvent) {
    const activeCategory = event.currentTarget.dataset.category as string;
    this.setData({ activeCategory, imageRefreshKey: this.data.imageRefreshKey + 1, campaigns: activeCategory === '全部' ? this.data.allProducts : this.data.allProducts.filter((item) => item.category === activeCategory) });
  },
});
