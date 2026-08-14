import { clearCart, readCart } from '../../utils/cart';
import { api } from '../../utils/api';
import { loadServiceAreaContext, saveServiceAreaSelection, type ServiceAreaSelection } from '../../utils/service-area';
import { loadPickupPoints, readPickupPointSelection, savePickupPointSelection, type PickupPointSelection } from '../../utils/pickup-point';

Page({
  data: {
    loading: true,
    error: '',
    campaignId: '',
    allowedAreaId: '',
    selectedAreaId:'',
    selectedId: '',
    areas: [] as ServiceAreaSelection[], points:[] as PickupPointSelection[],
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ campaignId: options.campaignId ?? '', allowedAreaId: options.serviceAreaId ?? '' });
    void this.loadAreas();
  },

  onPullDownRefresh() {
    void this.loadAreas().finally(() => wx.stopPullDownRefresh());
  },

  async loadAreas() {
    this.setData({ loading: true, error: '' });
    try {
      const context = await loadServiceAreaContext(this.data.allowedAreaId || undefined);
      const area=context.selected??context.areas[0]??null;
      if(!area){this.setData({areas:context.areas,points:[],selectedId:''});return;}
      saveServiceAreaSelection(area);
      const points=await loadPickupPoints(area.id);
      const campaign=this.data.campaignId?await api.getCampaign(this.data.campaignId):null;
      const allowed=campaign?.deliveryPlan?.pickupPointId?points.points.filter((item)=>item.id===campaign.deliveryPlan?.pickupPointId):points.points;
      const selected=readPickupPointSelection();
      this.setData({ areas: context.areas,selectedAreaId:area.id,points:allowed, selectedId: allowed.some((item)=>item.id===selected?.id)?selected?.id??'':'' });
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : '收货区域加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async chooseArea(event: WechatMiniprogram.BaseEvent) {
    const id = event.currentTarget.dataset.id as string;
    const area = this.data.areas.find((item) => item.id === id);
    if (!area) return;
    const cart = readCart();
    if (cart && cart.serviceAreaId !== area.id) {
      const result = await wx.showModal({ title: '切换收货区域？', content: '购物车商品属于其他收货区域，切换后需要清空购物车。', confirmText: '清空并切换', confirmColor: '#d7472f' });
      if (!result.confirm) return;
      clearCart();
    }
    saveServiceAreaSelection(area);
    const points=await loadPickupPoints(area.id);const selected=readPickupPointSelection();
    this.setData({selectedAreaId:area.id,points:points.points,selectedId:points.points.some((item)=>item.id===selected?.id)?selected?.id??'':''});
  },

  choosePoint(event:WechatMiniprogram.BaseEvent){const point=this.data.points.find((item)=>item.id===event.currentTarget.dataset.id);if(!point)return;savePickupPointSelection(point);this.setData({selectedId:point.id});void wx.navigateBack();},

  showInterest() {
    void wx.navigateTo({ url: '/pages/interest/index' });
  },
});
