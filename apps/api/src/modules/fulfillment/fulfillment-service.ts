import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { BusinessError, transitionCampaign, transitionOrder } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { DispatchBatch, Order } from '../core/types.js';
import type { LedgerService } from '../finance/ledger-service.js';
import type { NotificationService } from '../notifications/notification-service.js';

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
      const campaign = await store.getCampaign(campaignId);
      if (!campaign) throw new BusinessError('RESOURCE_NOT_FOUND', '团期不存在', 404);
      if(campaign.businessModelVersion==='PLATFORM_PROCUREMENT')throw new BusinessError('GOODS_RECEIPT_REQUIRED','平台采购团期必须完成采购、中心仓验收、分拣和出库后再交接，不能使用历史发车批次',409);
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

  public async verify(orderId: string, deliveryPlanId: string, code: string, verifierId: string, bypassPointAuthorization = false): Promise<Order> {
    const result = await this.store.transaction(async (store) => {
      const order = await store.getOrder(orderId);
      if (!order) throw new BusinessError('RESOURCE_NOT_FOUND', '订单不存在', 404);
      if (order.deliveryPlanId !== deliveryPlanId) throw new BusinessError('FORBIDDEN', '订单不属于当前到货点', 403);
      const plan=await store.getDeliveryPlan(deliveryPlanId);
      if(!plan||!plan.pickupPointId||plan.pickupPointId!==order.pickupPointId)throw new BusinessError('FORBIDDEN','订单自提点与当前核销点不一致',403);
      const verifier=await store.getUser(verifierId);
      if(!verifier||verifier.status!=='ACTIVE')throw new BusinessError('FORBIDDEN','当前核销人员不可用',403);
      const pickupPoint=(await store.listPickupPoints(plan.serviceAreaId)).find((item)=>item.id===plan.pickupPointId);
      if(!pickupPoint||pickupPoint.status!=='ACTIVE')throw new BusinessError('FORBIDDEN','当前自提点未启用，不能核销',403);
      if(!bypassPointAuthorization&&!(await store.hasActivePickupVerifierAssignment(verifierId,plan.pickupPointId)))throw new BusinessError('FORBIDDEN','当前核销人员未获该自提点授权',403);
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
