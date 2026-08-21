import { api } from '../../utils/api';
import { canSubmitCommunityQualityCase, communityQualityCaseStatusText } from '../../utils/community-quality';
import { formatDateTime, formatMoney } from '../../utils/format';
import { isModeBOrder, refundProgressText } from '../../utils/mode-b-order';
import { payOrder } from '../../utils/payment';

type ItemView = OrderDto['items'][number] & {
  priceText: string;
  amountText: string;
  fulfillmentText: string;
  exceptionReasonText: string | null;
  refundText: string | null;
};

interface OrderDetailView extends OrderDto {
  totalText: string;
  createdText: string;
  statusText: string;
  statusHint: string;
  canPay: boolean;
  canCancel: boolean;
  canPickup: boolean;
  canAfterSale: boolean;
  afterSaleViews: Array<{ id:string; reason:string; statusText:string; createdText:string }>;
  itemViews: ItemView[];
  deliveryName: string;
  deliveryAddress: string;
  deliveryTime: string;
  partialRefundText: string | null;
  modeBExceptionHint: string | null;
  pickupWindowText: string | null;
  cancellationText: string | null;
}

const STATUS: Record<string, { text: string; hint: string }> = {
  PENDING_PAYMENT: { text: '待付款', hint: '请在支付有效期内完成付款' },
  PAID_WAITING_CLOSE: { text: '等待截单', hint: '平台正在统一收单' },
  LOCKED: { text: '已截单', hint: '平台正在统一备货并安排配送' },
  ALLOCATING: { text: '待发车', hint: '平台正在确认本团配送安排' },
  IN_TRANSIT: { text: '运输中', hint: '货物正在配送至本团固定自提点' },
  READY_FOR_PICKUP: { text: '待领取', hint: '点位已完成交接，请凭取货码领取' },
  PICKED_UP: { text: '已领取', hint: '本次领取已经核销' },
  COMPLETED: { text: '已完成', hint: '订单已完成' },
  REFUNDING: { text: '退款中', hint: '平台正在原路处理退款' },
  REFUNDED: { text: '已退款', hint: '退款已经完成' },
  CANCELLED: { text: '已取消', hint: '订单已关闭' },
};

const EXCEPTION_REASON: Record<string, string> = {
  SHORT_RECEIPT: '供应商短收', QUALITY_REJECTED: '质量拒收', PACKAGE_DAMAGED: '包装破损',
  WAREHOUSE_SHORTAGE: '仓库短少', WAREHOUSE_DAMAGE: '仓内破损', MIS_SORTED: '分拣错配',
  TRANSIT_SHORTAGE: '配送短少', TRANSIT_DAMAGE: '配送破损', WRONG_POINT: '错点配送',
  PICKUP_POINT_REJECTED: '点位拒收', PICKUP_SHORTAGE: '领取短少', PICKUP_DAMAGE: '领取破损', QUALITY_CLAIM: '质量问题',
};

function locationCopy(plan: DeliveryPlanDto | null) {
  if (!plan || plan.status === 'PENDING_SITE') return { name: '领取地点信息暂不可用', address: '请联系平台客服确认', time: '地点信息待补充' };
  const eta=plan.estimatedArrivalAt??plan.arrivalStartAt;
  return { name: plan.siteName ?? '集中领取地点已确认', address: plan.address ?? '', time: eta ? `预计 ${formatDateTime(eta)} 到达` : '到货时间待确认' };
}

Page({
  data: { id: '', loading: true, error: '', order: null as OrderDetailView | null, paying: false, cancelling: false },
  onLoad(options: Record<string, string | undefined>) {
    if (!options.id) { this.setData({ loading: false, error: '订单参数缺失' }); return; }
    this.setData({ id: options.id });
  },
  onShow() { if (this.data.id) void this.loadOrder(); },
  async loadOrder() {
    this.setData({ loading: true, error: '' });
    try {
      const order = await api.getOrder(this.data.id);
      const status = STATUS[order.status] ?? { text: order.status, hint: '订单状态已更新' };
      const location = locationCopy(order.deliveryPlan);
      const afterSales = order.afterSales ?? [];
      const afterSaleLabels: Record<string, string> = { SUBMITTED: '待客服受理', PROCESSING: '客服处理中', RESOLVED: '已处理完成', REJECTED: '申请未通过' };
      const protectionOpen = order.status !== 'COMPLETED' && !(order.status === 'PICKED_UP' && order.pickedUpAt && Date.parse(order.pickedUpAt) + 7 * 86_400_000 <= Date.now());
      const modeB = isModeBOrder(order);
      const reasonBySku = new Map<string, string>();
      for (const exception of order.fulfillmentExceptions ?? []) for (const item of exception.items) if (item.exceptionQuantity > 0 && item.reason) reasonBySku.set(item.platformSkuId, EXCEPTION_REASON[item.reason] ?? item.reason);
      const itemViews: ItemView[] = order.items.map((item) => {
        const refundText = item.refundStatus
          ? `${refundProgressText(item.refundStatus)} ${formatMoney(item.refundAmountCents ?? item.refundedAmountCents)}`
          : item.refundedAmountCents > 0 ? `已退 ${formatMoney(item.refundedAmountCents)}` : null;
        return {
          ...item,
          priceText: formatMoney(item.unitPriceCents),
          amountText: formatMoney(item.amountCents),
          fulfillmentText: item.exceptionQuantity > 0 ? `待领 ${item.remainingPickupQuantity ?? item.fulfilledQuantity} 件 · 异常 ${item.exceptionQuantity} 件` : item.fulfilledQuantity > 0 ? `待领 ${item.remainingPickupQuantity ?? item.fulfilledQuantity} 件` : '待履约',
          exceptionReasonText: item.exceptionQuantity > 0 ? `异常原因：${reasonBySku.get(item.skuId) ?? '待确认'}` : null,
          refundText,
        };
      });
      const partialRefunds = order.partialRefunds ?? [];
      const skuNameById = new Map(order.items.map((item) => [item.skuId, item.name]));
      const communityQualityViews = (order.communityQualityCases ?? []).map((qualityCase) => ({
        id: qualityCase.id,
        reason: `品质售后：${qualityCase.items.map((item) => `${skuNameById.get(item.platformSkuId) ?? '商品'} × ${item.disputedQuantity}`).join('、')}`,
        statusText: communityQualityCaseStatusText(qualityCase.status),
        createdText: formatDateTime(qualityCase.registeredAt),
      }));
      const communityQualityOpen = canSubmitCommunityQualityCase(order);
      const pickupWindowText = order.pickupWindow ? ({ ACTIVE:'请在截止前领取', EXTENDED:'已获一次延期，请在新截止前领取', EXPIRED_PENDING:'领取已逾期，运营正在确认后续处理', REFUND_PENDING:'逾期退款正在由财务处理', LOSS_RECORDED:'未领取商品已完成报损关闭', CLOSED:'领取窗口已关闭' }[order.pickupWindow.status] ?? order.pickupWindow.status) : null;
      const cancellationText = order.cancellation ? ({ DIRECT_REFUNDING:'取消退款处理中', PENDING_REVIEW:'取消申请待运营审核', REJECTED:`取消申请未通过：${order.cancellation.reviewNote ?? '未提供原因'}`, APPROVED_WAITING_FINANCE:'取消申请已通过，待财务退款', REFUNDING:'退款处理中', REFUNDED:'取消退款已完成' }[order.cancellation.status] ?? order.cancellation.status) : null;
      this.setData({ order: {
        ...order,
        totalText: formatMoney(order.totalCents), createdText: formatDateTime(order.createdAt), statusText: status.text, statusHint: status.hint,
        canPay: order.status === 'PENDING_PAYMENT', canCancel: order.status === 'PENDING_PAYMENT'||(order.businessModelVersion==='PLATFORM_COMMUNITY'&&['PAID_WAITING_CLOSE','LOCKED','ALLOCATING'].includes(order.status)), canPickup: order.status === 'READY_FOR_PICKUP',
        canAfterSale: communityQualityOpen || (!modeB && protectionOpen && !['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED'].includes(order.status) && !afterSales.some((item) => ['SUBMITTED', 'PROCESSING'].includes(item.status))),
        afterSaleViews: [...afterSales.map((item) => ({ id:item.id, reason:item.reason, statusText: afterSaleLabels[item.status] ?? item.status, createdText: formatDateTime(item.createdAt) })), ...communityQualityViews],
        deliveryName: location.name, deliveryAddress: location.address, deliveryTime: location.time,
        modeBExceptionHint: modeB && !['PICKED_UP', 'COMPLETED'].includes(order.status) ? '商品异常由平台按明细核实和退款；正常商品不受影响，可继续领取。' : null,
        pickupWindowText, cancellationText,
        partialRefundText: partialRefunds.length ? `部分商品异常，退款${partialRefunds.some((item) => item.status === 'PROCESSING' || item.status === 'CREATED') ? '处理中' : '已处理'}：${formatMoney(partialRefunds.reduce((sum, item) => sum + item.amountCents, 0))}` : null,
        itemViews,
      } });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '订单加载失败' }); }
    finally { this.setData({ loading: false }); }
  },
  async pay() {
    const order = this.data.order; if (!order || !order.canPay || this.data.paying) return;
    this.setData({ paying: true });
    try { await payOrder(order.id); await this.loadOrder(); void wx.showToast({ title: '支付完成', icon: 'success' }); }
    catch (error) { void wx.showModal({ title: '支付未完成', content: error instanceof Error ? error.message : '请稍后重试', showCancel: false }); }
    finally { this.setData({ paying: false }); }
  },
  async cancel() {
    const order = this.data.order; if (!order || !order.canCancel || this.data.cancelling) return;
    const paidCommunity=order.businessModelVersion==='PLATFORM_COMMUNITY'&&order.status!=='PENDING_PAYMENT';
    const result = await wx.showModal({ title: paidCommunity?'申请取消社区订单？':'取消未支付订单？', content: paidCommunity?'截单前将原路全额退款；截单后会进入运营审核与财务退款流程。':'取消后商品会回到本团可售库存，需重新下单才能支付。', confirmText: paidCommunity?'提交申请':'确认取消', confirmColor: '#cf492f' });
    if (!result.confirm) return;
    this.setData({ cancelling: true });
    try { await api.cancelOrder(order.id); await this.loadOrder(); void wx.showToast({ title: paidCommunity?'取消申请已提交':'订单已取消', icon: 'success' }); }
    catch (error) { void wx.showModal({ title: '取消失败', content: error instanceof Error ? error.message : '请稍后重试', showCancel: false }); }
    finally { this.setData({ cancelling: false }); }
  },
  openPickupCode() { if (this.data.order) void wx.navigateTo({ url: `/pages/pickup-code/index?orderId=${encodeURIComponent(this.data.order.id)}` }); },
  openAfterSale() {
    if (!this.data.order) return;
    if (this.data.order.businessModelVersion === 'PLATFORM_PROCUREMENT') { void wx.showToast({ title: '该订单请按既有售后规则处理', icon: 'none' }); return; }
    void wx.navigateTo({ url: `/pages/after-sale/index?orderId=${encodeURIComponent(this.data.order.id)}` });
  },
});
