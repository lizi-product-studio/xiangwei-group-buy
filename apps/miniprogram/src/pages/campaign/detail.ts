import { api } from '../../utils/api';
import { formatDateTime, formatMoney } from '../../utils/format';
import { loadServiceAreaContext, type ServiceAreaSelection } from '../../utils/service-area';
import { addCartLine, cartCount, clearCart, readCart, saveCheckoutDraft, type CartSnapshot } from '../../utils/cart';
import { readPickupPointSelection } from '../../utils/pickup-point';

function deliveryCopy(plan: DeliveryPlanDto | null): { title: string; note: string } {
  if (!plan || plan.status === 'PENDING_SITE') return { title: '固定自提点暂未配置', note: '本团暂不可下单，请选择其他团期或稍后刷新' };
  if (plan.status === 'SITE_CONFIRMED' || plan.status === 'VEHICLE_BOOKED') return { title: plan.siteName ?? '固定自提点', note: plan.address ?? '到货时间会在订单中更新' };
  if (plan.status === 'IN_TRANSIT') return { title: plan.siteName ?? '货物运输中', note: plan.address ?? '车辆已发出，到货后通知领取' };
  return { title: plan.siteName ?? '货物已到达固定自提点', note: plan.address ?? '请在订单中查看取货码' };
}

Page({
  data: { campaign: null as CampaignDto | null, product: null as CampaignDto['items'][number] | null, cutoffText: '', dispatchText: '', quantity: 1, loading: true, error: '', area: null as ServiceAreaSelection | null, deliveryTitle: '', deliveryNote: '', total: '0.00', priceText: '0.00', cartCount: 0, soldOut: false, campaignSoldQuantity: 0, progressPercent: 0 },

  onLoad(options: Record<string, string | undefined>) {
    if (!options.id) { this.setData({ loading: false, error: '团期参数缺失' }); return; }
    void this.loadCampaign(options.id, options.skuId);
  },

  async loadCampaign(id: string, skuId?: string) {
    try {
      const campaign = await api.getCampaign(id);
      const product = campaign.items.find((item) => item.skuId === skuId) ?? campaign.items[0];
      if (!product) throw new Error('本团暂时没有可售商品');
      const context = await loadServiceAreaContext(campaign.serviceAreaId);
      const delivery = deliveryCopy(campaign.deliveryPlan);
      const campaignSoldQuantity = campaign.items.reduce((sum, item) => sum + item.soldQuantity, 0);
      this.setData({ campaign, product, area: context.selected, deliveryTitle: delivery.title, deliveryNote: delivery.note, cartCount: cartCount(), soldOut: product.stock - product.soldQuantity <= 0, campaignSoldQuantity, progressPercent: Math.min(100, Math.round(campaignSoldQuantity / campaign.minTotalQuantity * 100)), priceText: formatMoney(product.unitPriceCents), total: formatMoney(product.unitPriceCents * this.data.quantity), cutoffText: formatDateTime(campaign.cutoffAt), dispatchText: formatDateTime(campaign.dispatchAt) });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '团期加载失败' }); }
    finally { this.setData({ loading: false }); }
  },

  async onShow() {
    this.setData({ cartCount: cartCount() });
    if (!this.data.campaign) return;
    try { this.setData({ area: (await loadServiceAreaContext(this.data.campaign.serviceAreaId)).selected }); }
    catch { this.setData({ area: null }); }
  },

  changeQuantity(event: WechatMiniprogram.BaseEvent) {
    const available = this.data.product ? Math.max(1, this.data.product.stock - this.data.product.soldQuantity) : 99;
    const quantity = Math.max(1, Math.min(99, available, this.data.quantity + Number(event.currentTarget.dataset.step)));
    this.setData({ quantity, total: this.data.product ? formatMoney(this.data.product.unitPriceCents * quantity) : '0.00' });
  },

  goCheckout() {
    const point=readPickupPointSelection();if(!point||point.id!==this.data.campaign?.deliveryPlan?.pickupPointId){this.openPickup();return;}
    if (!this.data.campaign || !this.data.product || !this.data.area) { void wx.showToast({ title: '请先选择本团收货区域', icon: 'none' }); return; }
    const draft = this.buildDraft(); if (!draft) return;
    saveCheckoutDraft(draft); void wx.navigateTo({ url: '/pages/checkout/index' });
  },
  openPickup() { if (this.data.campaign) void wx.navigateTo({ url: `/pages/pickup-select/index?campaignId=${encodeURIComponent(this.data.campaign.id)}&serviceAreaId=${encodeURIComponent(this.data.campaign.serviceAreaId)}` }); },

  buildDraft(): CartSnapshot | null {
    const { campaign, product, area, quantity } = this.data;
    const point=readPickupPointSelection();
    if (!campaign || !product || !area || !point || point.id!==campaign.deliveryPlan?.pickupPointId) return null;
    return { source: 'buyNow', campaignId: campaign.id, campaignTitle: campaign.title, serviceAreaId: area.id, serviceAreaName: area.name,pickupPointId:point.id,pickupPointName:point.name,pickupPointAddress:point.address, updatedAt: Date.now(), items: [{ skuId: product.skuId, title: product.title, skuName: product.skuName, imageUrl: product.imageUrl, unitPriceCents: product.unitPriceCents, quantity, maxQuantity: Math.max(0, product.stock - product.soldQuantity) }] };
  },

  async addToCart() {
    const draft = this.buildDraft(); if (!draft || this.data.soldOut) return;
    const current = readCart();
    if (current && (current.campaignId !== draft.campaignId || current.serviceAreaId !== draft.serviceAreaId)) {
      const result = await wx.showModal({ title: '更换购物车商品？', content: '购物车只能保留同一团期、同一收货区域的商品。', confirmText: '清空并加入', confirmColor: '#d7472f' });
      if (!result.confirm) return; clearCart();
    }
    addCartLine({
      source: 'cart',
      campaignId: draft.campaignId,
      campaignTitle: draft.campaignTitle,
      serviceAreaId: draft.serviceAreaId,
      serviceAreaName: draft.serviceAreaName,
      pickupPointId: draft.pickupPointId,
      pickupPointName: draft.pickupPointName,
      pickupPointAddress: draft.pickupPointAddress,
    }, draft.items[0]!);
    this.setData({ cartCount: cartCount() }); void wx.showToast({ title: '已加入购物车', icon: 'success' });
  },
  openCart() { void wx.switchTab({ url: '/pages/cart/index' }); },
});
