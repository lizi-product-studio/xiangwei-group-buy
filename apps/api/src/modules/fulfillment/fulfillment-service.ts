import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { BusinessError, transitionCampaign, transitionOrder } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { DispatchBatch, Order } from '../core/types.js';
import type { LedgerService } from '../finance/ledger-service.js';
import type { NotificationService } from '../notifications/notification-service.js';

export type VerifyPickupCommand = {
  orderId: string;
  deliveryPlanId: string;
  code: string;
  verifierId: string;
  bypassPointAuthorization?: boolean;
  requestedItems?: Array<{platformSkuId:string;quantity:number}>;
  pickupRequestId?: string;
};

export class FulfillmentService {
  public constructor(
    private readonly store: CommerceStore,
    private readonly secret: string,
    private readonly ledger: LedgerService,
    private readonly notifications?: NotificationService,
  ) {}

  private code(orderId: string): string {
    const hex = createHmac('sha256', this.secret).update(`pickup:${orderId}`).digest('hex');
    return String(Number.parseInt(hex.slice(0, 12), 16) % 1_000_000).padStart(6, '0');
  }

  private hash(code: string): string { return createHmac('sha256', this.secret).update(code).digest('hex'); }

  private async batch(id: string, store: CommerceStore = this.store): Promise<DispatchBatch> {
    const batch = await store.getDispatchBatch(id);
    if (!batch) throw new BusinessError('RESOURCE_NOT_FOUND', '发车批次不存在', 404);
    return batch;
  }

  private async deliveryPlanForCampaign(campaignId: string, store: CommerceStore) {
    const plan = await store.getDeliveryPlanByCampaign(campaignId);
    if (!plan) throw new BusinessError('FULFILLMENT_PLAN_MISSING', '团期配送计划不存在', 409);
    return plan;
  }

  public async createBatch(campaignId: string): Promise<DispatchBatch> {
    return this.store.transaction(async (store) => {
      // Lock the campaign before looking for an existing batch.  A repeated
      // click must return the first lightweight batch rather than creating a
      // second vehicle journey for the same one-point group.
      const campaign = await store.getCampaignForUpdate(campaignId);
      if (!campaign) throw new BusinessError('RESOURCE_NOT_FOUND', '团期不存在', 404);
      const existing=(await store.listDispatchBatches()).find((batch)=>batch.campaignId===campaignId);
      if(existing)return existing;
      if(campaign.businessModelVersion==='PLATFORM_PROCUREMENT')throw new BusinessError('GOODS_RECEIPT_REQUIRED','平台采购团期必须完成采购、中心仓验收、分拣和出库后再交接，不能使用轻量配送批次',409);
      if (campaign.status !== 'LOCKED') throw new BusinessError('INVALID_STATE_TRANSITION', '只有已成团锁单的团期可以创建发车批次', 409);
      const plan = await this.deliveryPlanForCampaign(campaignId, store);
      if (plan.status !== 'VEHICLE_BOOKED') {
        throw new BusinessError('DELIVERY_PLAN_NOT_READY', '请先确认到货地点并登记货拉拉预约信息', 409);
      }
      const batch: DispatchBatch = {
        id: randomUUID(), campaignId, serviceAreaId: campaign.serviceAreaId, status: 'DRAFT',
        createdAt: new Date().toISOString(), dispatchedAt: null, arrivedAt: null,
      };
      await store.saveDispatchBatch(batch);
      const expectedVersion = campaign.version;
      campaign.status = transitionCampaign(campaign.status, 'FULFILLING');
      campaign.version += 1;
      if (!(await store.updateCampaign(campaign, expectedVersion))) {
        throw new BusinessError('CONCURRENT_MODIFICATION', '团期已被其他操作更新，请刷新后重试', 409);
      }
      for (const order of await store.listOrdersByCampaign(campaignId)) {
        if (order.status === 'LOCKED') {
          order.status = transitionOrder(order.status, 'ALLOCATING');
          await store.saveOrderStatus(order);
        }
      }
      return batch;
    });
  }

  public async dispatch(id: string): Promise<DispatchBatch> {
    return this.store.transaction(async (store) => {
      const batch = await this.batch(id, store);
      if (batch.status === 'IN_TRANSIT') return batch;
      if (batch.status !== 'DRAFT') throw new BusinessError('INVALID_STATE_TRANSITION', '批次当前不能发车', 409);
      const plan = await this.deliveryPlanForCampaign(batch.campaignId, store);
      if (plan.status !== 'VEHICLE_BOOKED') throw new BusinessError('DELIVERY_PLAN_NOT_READY', '配送地点或车辆预约信息尚未完成', 409);
      const now = new Date().toISOString();
      batch.status = 'IN_TRANSIT';
      batch.dispatchedAt = now;
      await store.saveDispatchBatch(batch);
      plan.status = 'IN_TRANSIT';
      plan.dispatchedAt = now;
      plan.updatedAt = now;
      await store.saveDeliveryPlan(plan);
      for (const order of await store.listOrdersByCampaign(batch.campaignId)) {
        if (order.status === 'ALLOCATING') {
          order.status = transitionOrder(order.status, 'IN_TRANSIT');
          await store.saveOrderStatus(order);
        }
      }
      if (this.notifications && batch.dispatchedAt) {
        await this.notifications.enqueueCampaign(store, 'VEHICLE_DISPATCHED', batch.campaignId, plan, `dispatch:${batch.id}:${batch.dispatchedAt}`);
      }
      return batch;
    });
  }

  public async receive(id: string, deliveryPlanId: string): Promise<{ batch: DispatchBatch; readyOrders: number }> {
    return this.store.transaction(async (store) => {
      const batch = await this.batch(id, store);
      const campaign = await store.getCampaignForUpdate(batch.campaignId);
      if (!campaign) throw new BusinessError('RESOURCE_NOT_FOUND', '团期不存在', 404);
      if (campaign.businessModelVersion === 'PLATFORM_COMMUNITY') {
        throw new BusinessError('INVALID_STATE_TRANSITION', '社区团购必须由绑定点位按逐商品实到数量确认到货，不能使用通用确认到货接口', 409);
      }
      if (batch.status !== 'IN_TRANSIT' && batch.status !== 'ARRIVED') {
        throw new BusinessError('INVALID_STATE_TRANSITION', '只有运输中的批次可以确认到货', 409);
      }
      const plan = await this.deliveryPlanForCampaign(batch.campaignId, store);
      if (plan.id !== deliveryPlanId) throw new BusinessError('FORBIDDEN', '配送计划与发车批次不匹配', 403);
      const now = new Date().toISOString();
      batch.status = 'ARRIVED';
      batch.arrivedAt ??= now;
      await store.saveDispatchBatch(batch);
      plan.status = 'ARRIVED';
      plan.arrivedAt ??= now;
      plan.updatedAt = now;
      await store.saveDeliveryPlan(plan);
      let readyOrders = 0;
      for (const order of await store.listOrdersByCampaign(batch.campaignId)) {
        if (order.deliveryPlanId !== plan.id || order.status !== 'IN_TRANSIT') continue;
        order.status = transitionOrder(order.status, 'READY_FOR_PICKUP');
        await store.saveOrderStatus(order);
        await store.savePickupCredential({
          orderId: order.id,
          codeHash: this.hash(this.code(order.id)),
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        });
        readyOrders += 1;
      }
      if (this.notifications && batch.arrivedAt) {
        await this.notifications.enqueueCampaign(store, 'ARRIVED', batch.campaignId, plan, `arrival:${batch.id}:${batch.arrivedAt}`);
      }
      return { batch, readyOrders };
    });
  }

  public async getCode(orderId: string, userId: string): Promise<{ code: string; expiresAt: string }> {
    const order = await this.store.getOrder(orderId);
    if (!order) throw new BusinessError('RESOURCE_NOT_FOUND', '订单不存在', 404);
    if (order.userId !== userId) throw new BusinessError('FORBIDDEN', '无权查看该订单取货码', 403);
    const credential = await this.store.getPickupCredential(orderId);
    if (!credential || credential.status !== 'ACTIVE') throw new BusinessError('PICKUP_CODE_UNAVAILABLE', '取货码尚未生成或已使用', 409);
    if (Date.parse(credential.expiresAt) < Date.now()) throw new BusinessError('PICKUP_CODE_EXPIRED', '取货码已过期', 409);
    return { code: this.code(orderId), expiresAt: credential.expiresAt };
  }

  public async verify({orderId,deliveryPlanId,code,verifierId,bypassPointAuthorization=false,requestedItems,pickupRequestId}: VerifyPickupCommand): Promise<Order> {
    const result = await this.store.transaction(async (store) => {
      const order = await store.getOrderForUpdate(orderId);
      if (!order) throw new BusinessError('RESOURCE_NOT_FOUND', '订单不存在', 404);
      if (order.deliveryPlanId !== deliveryPlanId) throw new BusinessError('FORBIDDEN', '订单不属于当前到货点', 403);
      const plan=await store.getDeliveryPlan(deliveryPlanId);
      if(!plan||!plan.pickupPointId||plan.pickupPointId!==order.pickupPointId)throw new BusinessError('FORBIDDEN','订单自提点与当前核销点不一致',403);
      const verifier=await store.getUser(verifierId);
      if(!verifier||verifier.status!=='ACTIVE')throw new BusinessError('FORBIDDEN','当前核销人员不可用',403);
      const pickupPoint=(await store.listPickupPoints(plan.serviceAreaId)).find((item)=>item.id===plan.pickupPointId);
      if(!pickupPoint||pickupPoint.status!=='ACTIVE')throw new BusinessError('FORBIDDEN','当前自提点未启用，不能核销',403);
      if(!bypassPointAuthorization&&!(await store.hasActivePickupPointAssignment(verifierId,plan.pickupPointId)))throw new BusinessError('FORBIDDEN','当前核销人员未获该自提点授权',403);
      if (order.businessModelVersion === 'PLATFORM_COMMUNITY') {
        if (!pickupRequestId) throw new BusinessError('UPGRADE_REQUIRED', '点位工作台版本过旧，请刷新页面后重新登录再核销', 426);
        if(!requestedItems?.length)throw new BusinessError('VALIDATION_ERROR','社区核销必须明确填写至少一项本次领取数量',400);
        const selected=requestedItems;
        const merged=new Map<string,number>();for(const item of selected){if(!Number.isSafeInteger(item.quantity)||item.quantity<1)throw new BusinessError('VALIDATION_ERROR','提货数量必须是正整数',400);merged.set(item.platformSkuId,(merged.get(item.platformSkuId)??0)+item.quantity);}
        if(!merged.size)throw new BusinessError('INVALID_STATE_TRANSITION','订单没有可领取的商品',409);
        const normalizedItems=[...merged.entries()].sort(([left],[right])=>left.localeCompare(right)).map(([platformSkuId,quantity])=>({platformSkuId,quantity}));
        const normalizedRequestId=pickupRequestId.toLowerCase();
        const payloadHash=createHmac('sha256',this.secret).update(JSON.stringify({protocolVersion:'COMMUNITY_PICKUP_V2',orderId:order.id,deliveryPlanId,verifierId,items:normalizedItems})).digest('hex');
        const existing=await store.getCommunityPickupReceiptByRequestIdForUpdate(order.id,normalizedRequestId);
        if(existing){if(existing.payloadHash!==payloadHash)throw new BusinessError('IDEMPOTENCY_CONFLICT','同一领取请求 ID 的内容不一致',409);return order;}
        const salesLines=await store.listPlatformSalesLinesByOrderForUpdate(order.id);
        const lineBySku=new Map(salesLines.map((line)=>[line.platformSkuId,line]));
        for(const {platformSkuId,quantity} of normalizedItems){const line=lineBySku.get(platformSkuId);if(!line||quantity>line.fulfilledQuantity-line.pickedUpQuantity)throw new BusinessError('VALIDATION_ERROR','提货数量不能超过当前待领取数量',400,{platformSkuId});}
        const credential = await store.getPickupCredential(orderId);
        if (!credential || credential.status !== 'ACTIVE') throw new BusinessError('PICKUP_CODE_UNAVAILABLE', '取货码无效', 409);
        const expected = Buffer.from(credential.codeHash, 'hex'); const actual = Buffer.from(this.hash(code), 'hex');
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new BusinessError('PICKUP_CODE_INVALID', '取货码不正确', 409);
        if (Date.parse(credential.expiresAt) < Date.now()) throw new BusinessError('PICKUP_CODE_EXPIRED', '取货码已过期', 409);
        if (order.status !== 'READY_FOR_PICKUP') throw new BusinessError('INVALID_STATE_TRANSITION', '订单当前不可核销', 409);
        const requestKey=createHmac('sha256',this.secret).update(`community-pickup-v2:request-id:${normalizedRequestId}`).digest('hex');
        const receipt={id:randomUUID(),orderId:order.id,deliveryPlanId,verifierId,requestKey,pickupRequestId:normalizedRequestId,payloadHash,createdAt:new Date().toISOString(),items:normalizedItems.map(({platformSkuId,quantity})=>({id:randomUUID(),communityPickupReceiptId:'',platformSkuId,quantity}))};receipt.items.forEach((item)=>item.communityPickupReceiptId=receipt.id);
        if(!await store.saveCommunityPickupReceipt(receipt)){const duplicate=await store.getCommunityPickupReceiptByRequestIdForUpdate(order.id,normalizedRequestId);if(duplicate){if(duplicate.payloadHash!==payloadHash)throw new BusinessError('IDEMPOTENCY_CONFLICT','同一领取请求 ID 的内容不一致',409);return order;}throw new BusinessError('CONCURRENT_MODIFICATION','领取操作正在处理中，请刷新后重试',409);}
        const auditItems:Array<{platformSkuId:string;quantity:number;pickedUpBefore:number;pickedUpAfter:number;fulfilledQuantity:number}>=[];
        for(const {platformSkuId,quantity} of normalizedItems){const line=lineBySku.get(platformSkuId)!;const pickedUpBefore=line.pickedUpQuantity;line.pickedUpQuantity+=quantity;const item=order.items.find((value)=>value.salesOrderItemId===line.id);if(!item)throw new BusinessError('INVENTORY_INCONSISTENT','销售订单明细缺失',500);item.pickedUpQuantity=line.pickedUpQuantity;if(!await store.updatePlatformSalesLine(line))throw new BusinessError('CONCURRENT_MODIFICATION','订单商品已被并发领取，请刷新后重试',409);auditItems.push({platformSkuId,quantity,pickedUpBefore,pickedUpAfter:line.pickedUpQuantity,fulfilledQuantity:line.fulfilledQuantity});}
        const allCollected=salesLines.filter((line)=>line.fulfilledQuantity>0).every((line)=>line.pickedUpQuantity===line.fulfilledQuantity);
        await store.saveAuditLog({id:randomUUID(),actorId:verifierId,action:allCollected?'COMMUNITY_PICKUP_COMPLETED':'COMMUNITY_PICKUP_PARTIAL','resourceType':'COMMUNITY_PICKUP_RECEIPT',resourceId:receipt.id,requestId:normalizedRequestId,beforeData:null,afterData:{protocolVersion:'COMMUNITY_PICKUP_V2',orderId:order.id,deliveryPlanId,pickupPointId:plan.pickupPointId,pickupRequestId:normalizedRequestId,receiptId:receipt.id,items:auditItems},createdAt:receipt.createdAt});
        if(allCollected){order.status=transitionOrder(order.status,'PICKED_UP');order.pickedUpAt=receipt.createdAt;credential.status='USED';await store.savePickupCredential(credential);await store.savePickupRecord(order.id,deliveryPlanId,verifierId);await store.saveOrderStatus(order);await this.ledger.recordPickup(store,order);}
        return order;
      }
      if (await store.pickupRecordExists(orderId)) return order;
      const credential = await store.getPickupCredential(orderId);
      if (!credential || credential.status !== 'ACTIVE') throw new BusinessError('PICKUP_CODE_UNAVAILABLE', '取货码无效', 409);
      const expected = Buffer.from(credential.codeHash, 'hex');
      const actual = Buffer.from(this.hash(code), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new BusinessError('PICKUP_CODE_INVALID', '取货码不正确', 409);
      if (Date.parse(credential.expiresAt) < Date.now()) throw new BusinessError('PICKUP_CODE_EXPIRED', '取货码已过期', 409);
      if (order.status !== 'READY_FOR_PICKUP') throw new BusinessError('INVALID_STATE_TRANSITION', '订单当前不可核销', 409);
      order.status = transitionOrder(order.status, 'PICKED_UP');
      order.pickedUpAt=new Date().toISOString();
      credential.status = 'USED';
      await store.savePickupCredential(credential);
      await store.savePickupRecord(order.id, deliveryPlanId, verifierId);
      await store.saveOrderStatus(order);
      await this.ledger.recordPickup(store, order);
      return order;
    });
    return result;
  }
}
