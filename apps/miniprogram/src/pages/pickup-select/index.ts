import { api, customerErrorMessage } from '../../utils/api';
import { loadServiceAreaContext, saveServiceAreaSelection, type ServiceAreaSelection } from '../../utils/service-area';
import { loadPickupPoints, readPickupPointSelection, savePickupPointSelection, type PickupPointSelection } from '../../utils/pickup-point';
import { isCampaignPurchasable } from '../../utils/consumer-display';

type PickupPointView = PickupPointSelection & { purchasable: boolean; distanceLabel: string; distanceMeters: number | null };

function distanceMeters(from: { latitude: number; longitude: number }, to: PickupPointSelection): number | null {
  if (to.latitude == null || to.longitude == null) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(to.latitude - from.latitude);
  const lonDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lonDelta / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function authorizedLocation(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const settings = await new Promise<WechatMiniprogram.GetSettingSuccessCallbackResult>((resolve, reject) => wx.getSetting({ success: resolve, fail: reject }));
    if (settings.authSetting['scope.userLocation'] !== true) return null;
    return await new Promise((resolve, reject) => wx.getLocation({ type: 'gcj02', success: (value) => resolve({ latitude: value.latitude, longitude: value.longitude }), fail: reject }));
  } catch { return null; }
}

async function sortPickupPoints(points: PickupPointSelection[], serviceAreaId: string, campaignId: string): Promise<PickupPointView[]> {
  const campaignsPromise = (async () => {
    try { return campaignId ? [await api.getCampaign(campaignId)] : await api.listCampaigns(); }
    catch { return []; /* Availability is unknown; retain a stable, usable list. */ }
  })();
  const locationPromise = Promise.race([
    authorizedLocation(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 700)),
  ]);
  const [campaigns, location] = await Promise.all([campaignsPromise, locationPromise]);
  const decorated = points.map((point, index) => {
    const purchasable = campaigns.some((campaign) => campaign.serviceAreaId === serviceAreaId && campaign.deliveryPlan?.pickupPointId === point.id && isCampaignPurchasable(campaign));
    const meters = location ? distanceMeters(location, point) : null;
    return { point, index, purchasable, meters };
  });
  const orderWithinAvailability = (items: typeof decorated) => {
    if (!location) return items.sort((left, right) => left.index - right.index);
    const located = items.filter((item) => item.meters != null).sort((left, right) => left.meters! - right.meters! || left.index - right.index);
    let cursor = 0;
    return items.filter((item) => item.meters != null).map(() => located[cursor++]!)
      .concat(items.filter((item) => item.meters == null).sort((left, right) => left.index - right.index));
  };
  const ordered = [...orderWithinAvailability(decorated.filter((item) => item.purchasable)), ...orderWithinAvailability(decorated.filter((item) => !item.purchasable))];
  return ordered.map(({ point, purchasable, meters }) => ({
      ...point,
      purchasable,
      distanceMeters: meters,
      distanceLabel: meters == null ? '' : meters < 1000 ? `${meters}米` : `${(meters / 1000).toFixed(1)}公里`,
    }));
}

Page({
  data: {
    loading: true,
    error: '',
    campaignId: '',
    allowedAreaId: '',
    selectedAreaId:'',
    selectedId: '',
    areas: [] as ServiceAreaSelection[], points:[] as PickupPointView[],
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
      let allowed = points.points;
      if (this.data.campaignId) {
        try {
          const campaign = await api.getCampaign(this.data.campaignId);
          const fixedPointId = campaign.deliveryPlan?.pickupPointId;
          if (!fixedPointId)
            throw new Error('CAMPAIGN_PICKUP_POINT_MISSING');
          allowed = points.points.filter((item) => item.id === fixedPointId);
          if (!allowed.length)
            throw new Error('CAMPAIGN_PICKUP_POINT_UNAVAILABLE');
        } catch {
          this.setData({
            areas: context.areas,
            selectedAreaId: area.id,
            points: [],
            selectedId: '',
            error: '本团自提点信息已失效，请返回首页重新选择商品',
          });
          return;
        }
      }
      const selected=readPickupPointSelection();
      const selectedId = allowed.some((item)=>item.id===selected?.id) ? selected?.id ?? '' : '';
      const sorted = await sortPickupPoints(allowed, area.id, this.data.campaignId);
      this.setData({ areas: context.areas,selectedAreaId:area.id,points:sorted, selectedId });
    } catch (error) {
      this.setData({ error: customerErrorMessage(error, '收货区域加载失败，请稍后重试') });
    } finally {
      this.setData({ loading: false });
    }
  },

  async chooseArea(event: WechatMiniprogram.BaseEvent) {
    const id = event.currentTarget.dataset.id as string;
    const area = this.data.areas.find((item) => item.id === id);
    if (!area) return;
    saveServiceAreaSelection(area);
    try {
      const points = await loadPickupPoints(area.id);
      if (this.data.campaignId) {
        this.setData({
          selectedAreaId: area.id,
          points: [],
          selectedId: '',
          error: '本团已绑定固定自提点，请返回首页重新选择商品',
        });
        return;
      }
      const selected = readPickupPointSelection();
      const selectedId = points.points.some((item) => item.id === selected?.id) ? selected?.id ?? '' : '';
      const sorted = await sortPickupPoints(points.points, area.id, '');
      this.setData({ selectedAreaId: area.id, points: sorted, selectedId, error: '' });
    } catch (error) {
      this.setData({ points: [], selectedId: '', error: customerErrorMessage(error, '自提点加载失败，请稍后重试') });
    }
  },

  choosePoint(event:WechatMiniprogram.BaseEvent){const point=this.data.points.find((item)=>item.id===event.currentTarget.dataset.id);if(!point)return;savePickupPointSelection(point);this.setData({selectedId:point.id});void wx.navigateBack();},

  openLocation(event: WechatMiniprogram.BaseEvent) {
    const point = this.data.points.find((item) => item.id === event.currentTarget.dataset.id);
    if (point?.latitude == null || point.longitude == null) {
      void wx.showToast({ title: '该自提点暂未配置导航坐标', icon: 'none' });
      return;
    }
    void wx.openLocation({ latitude: point.latitude, longitude: point.longitude, name: point.name, address: point.address });
  },

  callPoint(event: WechatMiniprogram.BaseEvent) {
    const point = this.data.points.find((item) => item.id === event.currentTarget.dataset.id);
    if (!point?.contactPhone) {
      void wx.showToast({ title: '该自提点暂未配置联系电话', icon: 'none' });
      return;
    }
    void wx.makePhoneCall({ phoneNumber: point.contactPhone });
  },

  showInterest() {
    void wx.navigateTo({ url: '/pages/interest/index' });
  },
});
