import { api, customerAuth, customerErrorMessage } from "../../utils/api";
import { formatMoney } from "../../utils/format";
import {
  campaignPaidQuantity,
  campaignProgressPercent,
  cutoffCountdown,
  estimatedArrivalText,
  formatChinaDateTime,
  isCampaignPurchasable,
  unformedRuleText,
} from "../../utils/consumer-display";
import {
  loadServiceAreaContext,
  type ServiceAreaSelection,
} from "../../utils/service-area";
import {
  addCartLine,
  clearCart,
  readCart,
  saveCheckoutDraft,
  type CartSnapshot,
} from "../../utils/cart";
import {
  loadPickupPoints,
  readPickupPointSelection,
  type PickupPointSelection,
} from "../../utils/pickup-point";
import { PageLoadCoordinator } from "../../utils/page-load-guard";

let countdownTimer: number | null = null;
const loadCoordinator = new PageLoadCoordinator();

function deliveryCopy(plan: DeliveryPlanDto | null): {
  title: string;
  note: string;
} {
  if (!plan)
    return {
      title: "固定自提点暂未配置",
      note: "本团暂不可下单，请选择其他团期或稍后刷新",
    };
  if (plan.status === "SITE_CONFIRMED" || plan.status === "VEHICLE_BOOKED")
    return {
      title: plan.siteName ?? "固定自提点",
      note: plan.address ?? "到货时间会在订单中更新",
    };
  if (plan.status === "IN_TRANSIT")
    return {
      title: plan.siteName ?? "货物运输中",
      note: plan.address ?? "车辆已发出，到货后通知领取",
    };
  return {
    title: plan.siteName ?? "货物已到达固定自提点",
    note: plan.address ?? "请在订单中查看取货码",
  };
}

Page({
  data: {
    campaignId: "",
    skuId: "",
    campaign: null as CampaignDto | null,
    product: null as CampaignDto["items"][number] | null,
    cutoffText: "",
    quantity: 1,
    loading: true,
    error: "",
    area: null as ServiceAreaSelection | null,
    deliveryTitle: "",
    deliveryNote: "",
    total: "0.00",
    priceText: "0.00",
    soldOut: false,
    campaignSoldQuantity: 0,
    progressPercent: 0,
    countdownText: "",
    estimatedArrivalText: "",
    unformedRuleText: "",
    pickupPoint: null as PickupPointSelection | null,
    canBuy: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (!options.id) {
      this.setData({ loading: false, error: "团期参数缺失" });
      return;
    }
    this.setData({ campaignId: options.id, skuId: options.skuId ?? "" });
    void this.loadCampaign(options.id, options.skuId);
  },

  async loadCampaign(id: string, skuId?: string) {
    const epoch = customerAuth.captureSessionEpoch();
    const loadGuard = loadCoordinator.begin(epoch);
    this.setData({ loading: true, error: "" });
    try {
      const campaign = await api.getCampaign(id);
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      const product =
        campaign.items.find((item) => item.skuId === skuId) ??
        campaign.items[0];
      if (!product) throw new Error("本团暂时没有可售商品");
      const [context, points] = await Promise.all([
        loadServiceAreaContext(campaign.serviceAreaId),
        loadPickupPoints(campaign.serviceAreaId),
      ]);
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      const delivery = deliveryCopy(campaign.deliveryPlan);
      const campaignSoldQuantity = campaignPaidQuantity(campaign);
      const pickupPoint = campaign.pickupPoint ?? points.points.find(
        (point) => point.id === campaign.deliveryPlan?.pickupPointId,
      ) ?? null;
      const arrivalText = estimatedArrivalText(campaign);
      const canBuy = isCampaignPurchasable(campaign);
      this.setData({
        campaign,
        product,
        area: context.selected,
        deliveryTitle: delivery.title,
        deliveryNote: delivery.note,
        pickupPoint,
        soldOut: product.stock - product.soldQuantity <= 0,
        campaignSoldQuantity,
        progressPercent: Math.min(
          100,
          campaignProgressPercent(campaignSoldQuantity, campaign.minTotalQuantity),
        ),
        priceText: formatMoney(product.unitPriceCents),
        total: formatMoney(product.unitPriceCents * this.data.quantity),
        cutoffText: formatChinaDateTime(campaign.cutoffAt, true),
        countdownText: cutoffCountdown(campaign.cutoffAt),
        estimatedArrivalText: arrivalText ? `预计到货时段：${arrivalText}` : "到货时间待确认，到货后通知",
        unformedRuleText: unformedRuleText(campaign),
        canBuy,
      });
      this.startCountdown();
    } catch (error) {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()))
        this.setData({ error: customerErrorMessage(error, "团期加载失败，请稍后重试") });
    } finally {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()))
        this.setData({ loading: false });
    }
  },

  retryLoad() {
    if (this.data.campaignId)
      void this.loadCampaign(this.data.campaignId, this.data.skuId || undefined);
  },

  async onShow() {
    loadCoordinator.show();
    if (!this.data.campaign) return;
    try {
      this.setData({
        area: (await loadServiceAreaContext(this.data.campaign.serviceAreaId))
          .selected,
      });
    } catch {
      this.setData({ area: null });
    }
  },

  onUnload() {
    loadCoordinator.unload();
    this.stopCountdown();
  },

  onHide() {
    loadCoordinator.hide();
  },

  startCountdown() {
    this.stopCountdown();
    const campaign = this.data.campaign;
    if (!campaign) return;
    const tick = () => {
      const countdownText = cutoffCountdown(campaign.cutoffAt);
      const canBuy = isCampaignPurchasable(campaign);
      this.setData({ countdownText, canBuy });
      if (!canBuy || countdownText === "已截单") this.stopCountdown();
    };
    tick();
    if (this.data.canBuy)
      countdownTimer = setInterval(tick, 1000) as unknown as number;
  },

  stopCountdown() {
    if (countdownTimer === null) return;
    clearInterval(countdownTimer);
    countdownTimer = null;
  },

  changeQuantity(event: WechatMiniprogram.BaseEvent) {
    const available = this.data.product
      ? Math.max(1, this.data.product.stock - this.data.product.soldQuantity)
      : 99;
    const quantity = Math.max(
      1,
      Math.min(
        99,
        available,
        this.data.quantity + Number(event.currentTarget.dataset.step),
      ),
    );
    this.setData({
      quantity,
      total: this.data.product
        ? formatMoney(this.data.product.unitPriceCents * quantity)
        : "0.00",
    });
  },

  goCheckout() {
    if (!this.data.canBuy || this.data.soldOut) return;
    const point = readPickupPointSelection();
    if (
      !point ||
      point.id !== this.data.campaign?.deliveryPlan?.pickupPointId
    ) {
      this.openPickup();
      return;
    }
    if (!this.data.campaign || !this.data.product || !this.data.area) {
      void wx.showToast({ title: "请先选择本团收货区域", icon: "none" });
      return;
    }
    const draft = this.buildDraft();
    if (!draft) return;
    saveCheckoutDraft(draft);
    void wx.navigateTo({ url: "/pages/checkout/index" });
  },
  openPickup() {
    if (this.data.campaign)
      void wx.navigateTo({
        url: `/pages/pickup-select/index?campaignId=${encodeURIComponent(this.data.campaign.id)}&serviceAreaId=${encodeURIComponent(this.data.campaign.serviceAreaId)}`,
      });
  },

  openLocation() {
    const point = this.data.pickupPoint;
    if (point?.latitude == null || point.longitude == null) {
      void wx.showToast({ title: "该自提点暂未配置导航坐标", icon: "none" });
      return;
    }
    void wx.openLocation({
      latitude: point.latitude,
      longitude: point.longitude,
      name: point.name,
      address: point.address,
    });
  },

  callPickupPoint() {
    const phone = this.data.pickupPoint?.contactPhone;
    if (!phone) {
      void wx.showToast({ title: "该自提点暂未配置联系电话", icon: "none" });
      return;
    }
    void wx.makePhoneCall({ phoneNumber: phone });
  },

  buildDraft(): CartSnapshot | null {
    const { campaign, product, area, quantity } = this.data;
    const point = readPickupPointSelection();
    if (
      !campaign ||
      !product ||
      !area ||
      !point ||
      point.id !== campaign.deliveryPlan?.pickupPointId
    )
      return null;
    return {
      source: "buyNow",
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      serviceAreaId: area.id,
      serviceAreaName: area.name,
      pickupPointId: point.id,
      pickupPointName: point.name,
      pickupPointAddress: point.address,
      updatedAt: Date.now(),
      items: [
        {
          skuId: product.skuId,
          title: product.title,
          skuName: product.skuName,
          imageUrl: product.imageUrl,
          unitPriceCents: product.unitPriceCents,
          quantity,
          maxQuantity: Math.max(0, product.stock - product.soldQuantity),
        },
      ],
    };
  },

  async addToCart() {
    const draft = this.buildDraft();
    if (!draft || this.data.soldOut || !this.data.canBuy) return;
    const current = readCart();
    if (
      current &&
      (current.campaignId !== draft.campaignId ||
        current.serviceAreaId !== draft.serviceAreaId)
    ) {
      const result = await wx.showModal({
        title: "更换购物车商品？",
        content: "购物车只能保留同一团期、同一收货区域的商品。",
        confirmText: "清空并加入",
        confirmColor: "#d7472f",
      });
      if (!result.confirm) return;
      clearCart();
    }
    addCartLine(
      {
        source: "cart",
        campaignId: draft.campaignId,
        campaignTitle: draft.campaignTitle,
        serviceAreaId: draft.serviceAreaId,
        serviceAreaName: draft.serviceAreaName,
        pickupPointId: draft.pickupPointId,
        pickupPointName: draft.pickupPointName,
        pickupPointAddress: draft.pickupPointAddress,
      },
      draft.items[0]!,
    );
    void wx.showToast({ title: "已加入购物车", icon: "success" });
  },
});
