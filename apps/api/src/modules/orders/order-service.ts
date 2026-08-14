import { createHash, randomUUID } from 'node:crypto';
import type { OrderRequest } from '@hometown/api-contracts';
import {
  BusinessError,
  calculateCommission,
  moneyCents,
  multiplyMoney,
  sumMoney,
  transitionOrder,
} from '@hometown/domain';
import type { CampaignService } from '../campaigns/campaign-service.js';
import type { CommerceStore } from '../core/store.js';
import type { MerchantOrder, Order, OrderItem } from '../core/types.js';
import { isDeliveryPlanReadyForSale } from '../campaigns/sellability.js';

export class OrderService {
  public constructor(
    private readonly store: CommerceStore,
    private readonly campaigns: CampaignService,
  ) {}

  private fingerprint(input: OrderRequest): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  public async preview(userId: string, input: OrderRequest, store: CommerceStore = this.store): Promise<Omit<Order, 'id' | 'orderNo' | 'createdAt' | 'expiresAt' | 'paidAt'|'pickedUpAt'>> {
    // Checkout runs inside a store transaction. Lock the campaign before checking
    // sellability so campaign close cannot race a just-created reservation.
    const campaign = await store.getCampaignForUpdate(input.campaignId);
    if (!campaign) throw new BusinessError('RESOURCE_NOT_FOUND', '团期不存在', 404);
    if (campaign.status !== 'OPEN') throw new BusinessError('CAMPAIGN_NOT_OPEN', '团期当前不可下单', 409);
    if (Date.parse(campaign.cutoffAt) <= Date.now()) throw new BusinessError('CAMPAIGN_CLOSED', '团期已截单', 409);
    if (campaign.serviceAreaId !== input.serviceAreaId) {
      throw new BusinessError('VALIDATION_ERROR', '所选收货区域不在本团期服务范围内');
    }
    const serviceArea = (await store.listServiceAreas()).find((item) => item.id === campaign.serviceAreaId);
    if (!serviceArea || serviceArea.status !== 'ENABLED' || !serviceArea.orderEnabled) {
      throw new BusinessError('SERVICE_AREA_DISABLED', '当前收货区域暂未开放下单', 409);
    }
    const pickupPoint=(await store.listPickupPoints(campaign.serviceAreaId)).find((item)=>item.id===input.pickupPointId);
    if(!pickupPoint||pickupPoint.status!=='ACTIVE')throw new BusinessError('VALIDATION_ERROR','所选自提点不在本团期服务范围内或已暂停',400);
    const deliveryPlan = await store.getDeliveryPlanByCampaign(campaign.id);
    if (!deliveryPlan) throw new BusinessError('FULFILLMENT_PLAN_MISSING', '本团配送计划尚未创建，请联系平台处理', 409);
    if (deliveryPlan.pickupPointId !== pickupPoint.id || !isDeliveryPlanReadyForSale(deliveryPlan)) {
      throw new BusinessError('VALIDATION_ERROR', '所选自提点不是本团期指定领取点', 400);
    }

    if (campaign.businessModelVersion === 'PLATFORM_PROCUREMENT') {
      const merged = new Map<string, number>();
      for (const line of input.items) merged.set(line.skuId, (merged.get(line.skuId) ?? 0) + line.quantity);
      const items: OrderItem[] = [];
      for (const [platformSkuId, quantity] of merged) {
        const item = await store.getCampaignPlatformItem(campaign.id, platformSkuId);
        if (!item) throw new BusinessError('RESOURCE_NOT_FOUND', `平台商品 ${platformSkuId} 不属于当前团期`, 404);
        if (item.sellableQuantity - item.reservedQuantity < quantity) throw new BusinessError('SKU_STOCK_INSUFFICIENT', `${item.skuName} 可售数量不足`, 409, { platformSkuId, available: item.sellableQuantity - item.reservedQuantity });
        const amountCents = multiplyMoney(item.retailPriceCents, quantity);
        items.push({ salesOrderItemId:null, skuId: platformSkuId, productId: item.productId, merchantId: null, name: item.skuName, quantity, unitPriceCents: item.retailPriceCents, amountCents, commissionRateBps: 0, commissionCents: moneyCents(0), purchaseUnitCents: item.purchasePriceCents, fulfilledQuantity:0, exceptionQuantity:0, refundedQuantity:0, refundedAmountCents:moneyCents(0) });
      }
      return { userId, campaignId: input.campaignId, serviceAreaId: input.serviceAreaId, pickupPointId: input.pickupPointId, deliveryPlanId: deliveryPlan.id, businessModelVersion: 'PLATFORM_PROCUREMENT', paymentRoute: 'PLATFORM_DIRECT', status: 'PENDING_PAYMENT', totalCents: sumMoney(items.map((item) => item.amountCents)), commissionCents: moneyCents(0), items, merchantOrders: [] };
    }

    const merged = new Map<string, number>();
    for (const line of input.items) merged.set(line.skuId, (merged.get(line.skuId) ?? 0) + line.quantity);

    const items: OrderItem[] = [];
    for (const [skuId, quantity] of merged.entries()) {
      const sku = await store.getCampaignSku(campaign.id, skuId);
      if (!sku || !campaign.skuIds.includes(skuId)) {
        throw new BusinessError('RESOURCE_NOT_FOUND', `SKU ${skuId} 不属于当前团期`, 404);
      }
      if (sku.stock - sku.soldQuantity < quantity) {
        throw new BusinessError('SKU_STOCK_INSUFFICIENT', `${sku.name} 库存不足`, 409, {
          skuId,
          available: sku.stock - sku.soldQuantity,
        });
      }
      const amountCents = multiplyMoney(sku.unitPriceCents, quantity);
      items.push({
        salesOrderItemId:null,
        skuId,
        productId: sku.productId,
        merchantId: sku.merchantId,
        name: sku.name,
        quantity,
        unitPriceCents: sku.unitPriceCents,
        amountCents,
        commissionRateBps: sku.commissionRateBps,
        commissionCents: calculateCommission(amountCents, sku.commissionRateBps),
        fulfilledQuantity:0,
        exceptionQuantity:0,
        refundedQuantity:0,
        refundedAmountCents:moneyCents(0),
      });
    }
    const totalCents = sumMoney(items.map((item) => item.amountCents));
    const commissionCents = sumMoney(items.map((item) => item.commissionCents));

    const byMerchant = new Map<string, OrderItem[]>();
    for (const item of items) { if(!item.merchantId)throw new BusinessError('FINANCIAL_INCONSISTENT','历史撮合订单缺少商户归属',500); byMerchant.set(item.merchantId, [...(byMerchant.get(item.merchantId) ?? []), item]); }
    const merchantOrders: MerchantOrder[] = [...byMerchant.entries()].map(([merchantId, merchantItems]) => {
      const itemAmountCents = sumMoney(merchantItems.map((item) => item.amountCents));
      const merchantCommissionCents = sumMoney(merchantItems.map((item) => item.commissionCents));
      return {
        id: randomUUID(),
        merchantId,
        itemAmountCents,
        commissionCents: merchantCommissionCents,
        merchantReceivableCents: moneyCents(itemAmountCents - merchantCommissionCents),
      };
    });

    return {
      userId,
      campaignId: input.campaignId,
      serviceAreaId: input.serviceAreaId,
      pickupPointId: input.pickupPointId,
      deliveryPlanId: deliveryPlan.id,
      businessModelVersion:'LEGACY_MARKETPLACE',
      paymentRoute:'LEGACY_COMBINE',
      status: 'PENDING_PAYMENT',
      totalCents,
      commissionCents,
      items,
      merchantOrders,
    };
  }

  public async create(userId: string, input: OrderRequest, idempotencyKey: string): Promise<Order> {
    return this.store.transaction(async (store) => {
    const fingerprint = this.fingerprint(input);
    // This lock is taken before the campaign/inventory lock. It makes two
    // simultaneous retries for one idempotency key converge on one order
    // instead of both reserving stock and letting the unique key surface as 500.
    const existing = await store.getIdempotencyForUpdate(userId, idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new BusinessError('IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同订单内容', 409);
      }
      return this.getForUser(existing.orderId, userId, store);
    }

    const preview = await this.preview(userId, input, store);
    for (const item of preview.items) {
      const reserved = preview.businessModelVersion === 'PLATFORM_PROCUREMENT'
        ? await store.reserveCampaignPlatformStock(input.campaignId, item.skuId, item.quantity)
        : await store.reserveCampaignSkuStock(input.campaignId, item.skuId, item.quantity);
      if (!reserved) {
        throw new BusinessError('SKU_STOCK_INSUFFICIENT', `${item.name} 库存不足`, 409);
      }
    }
    const id = randomUUID();
    const createdAt=new Date().toISOString();
    const campaign=await store.getCampaign(input.campaignId);
    if(!campaign)throw new BusinessError('RESOURCE_NOT_FOUND','团期不存在',404);
    const order: Order = {
      id,
      orderNo: `HT${Date.now()}${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      ...preview,
      createdAt,
      expiresAt:new Date(Math.min(Date.now()+15*60_000,Date.parse(campaign.cutoffAt))).toISOString(),
      paidAt: null,
      pickedUpAt:null,
    };
    await store.saveOrder(order);
    if (order.businessModelVersion === 'PLATFORM_PROCUREMENT') await store.saveSalesOrderItems(order.id, order.items.map((item) => ({ id:randomUUID(), platformSkuId: item.skuId, productId: item.productId, title: item.name, skuName: item.name, quantity: item.quantity, unitPriceCents: Number(item.unitPriceCents), purchaseUnitCents: Number(item.purchaseUnitCents ?? 0), amountCents: Number(item.amountCents) })));
    await store.saveIdempotency(userId, idempotencyKey, { fingerprint, orderId: id });
    return order;
    });
  }

  public async expirePendingOrders(limit=100):Promise<number>{
    let expired=0;
    for(const candidate of await this.store.listExpiredPendingOrders(new Date().toISOString(),limit)){
      await this.store.transaction(async(store)=>{const order=await store.getOrder(candidate.id);if(!order||order.status!=='PENDING_PAYMENT'||Date.parse(order.expiresAt)>Date.now())return;
        if(!(await this.cancelPendingOrder(store,order)))return;
        expired+=1;});
    }
    return expired;
  }

  public async cancelPending(id:string,userId:string):Promise<Order>{
    return this.store.transaction(async(store)=>{
      const order=await this.getForUser(id,userId,store);
      if(order.status==='CANCELLED')return order;
      if(order.status!=='PENDING_PAYMENT')throw new BusinessError('INVALID_STATE_TRANSITION','仅待支付订单可以取消；已支付订单请通过售后流程处理',409);
      const cancelledStatus=transitionOrder(order.status,'CANCELLED');
      if(!(await this.cancelPendingOrder(store,order))){
        const latest=await this.getForUser(id,userId,store);
        if(latest.status==='CANCELLED')return latest;
        throw new BusinessError('CONCURRENT_MODIFICATION','订单状态已被其他操作更新，请刷新后重试',409);
      }
      order.status=cancelledStatus;
      return order;
    });
  }

  public async getForUser(id: string, userId: string, store: CommerceStore = this.store): Promise<Order> {
    const order = await store.getOrder(id);
    if (!order) throw new BusinessError('RESOURCE_NOT_FOUND', '订单不存在', 404);
    if (order.userId !== userId) throw new BusinessError('FORBIDDEN', '无权查看该订单', 403);
    return order;
  }

  public async mockPay(id: string, userId: string): Promise<Order> {
    return this.store.transaction(async(store)=>{
      const order=await this.getForUser(id,userId,store);
      if(order.status==='PAID_WAITING_CLOSE')return order;
      if(order.status!=='PENDING_PAYMENT')throw new BusinessError('INVALID_STATE_TRANSITION','订单当前不可支付',409);
      const paidAt=new Date().toISOString();
      if(!(await store.markPendingOrderPaid(order.id,paidAt))){
        const latest=await this.getForUser(id,userId,store);
        if(latest.status==='PAID_WAITING_CLOSE')return latest;
        throw new BusinessError('INVALID_STATE_TRANSITION',latest.status==='CANCELLED'?'订单已取消，不能支付':'订单当前不可支付',409);
      }
      order.status=transitionOrder(order.status,'PAID_WAITING_CLOSE');order.paidAt=paidAt;
      return order;
    });
  }

  private async cancelPendingOrder(store:CommerceStore,order:Order):Promise<boolean>{
    if(!(await store.cancelPendingOrder(order.id)))return false;
    for(const item of order.items){const released=order.businessModelVersion==='PLATFORM_PROCUREMENT'?await store.releaseCampaignPlatformStock(order.campaignId,item.skuId,item.quantity):await store.releaseCampaignSkuStock(order.campaignId,item.skuId,item.quantity);if(!released)throw new BusinessError('INVENTORY_INCONSISTENT','订单取消后可售数量释放失败',500,{orderId:order.id,skuId:item.skuId});}
    const payment=await store.getPaymentByOrder(order.id);
    if(payment?.status==='CREATED'){payment.status='FAILED';await store.savePayment(payment);}
    return true;
  }
}
