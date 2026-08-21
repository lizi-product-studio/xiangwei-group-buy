import { describe, expect, it, vi } from 'vitest';
import { moneyCents } from '@hometown/domain';
import { MemoryStore } from '../core/store.js';
import type { Order, OrderNotification } from '../core/types.js';
import { NotificationService } from './notification-service.js';
import { CommunityOperationsService } from '../fulfillment/community-operations-service.js';
import type { PaymentService } from '../payments/payment-service.js';

describe('NotificationService durable outbox', () => {
  it('persists an authorised send first and drains it independently', async () => {
    const store = new MemoryStore();
    const now = new Date().toISOString();
    const userId = 'notification-user';
    const order: Order = {
      id: 'notification-order', orderNo: 'N-001', userId, campaignId: 'campaign-demo-001', serviceAreaId: 'service-bd-lianchi', pickupPointId: 'pickup-demo-001', deliveryPlanId: 'delivery-plan-demo-001',
      status: 'PAID_WAITING_CLOSE', totalCents: moneyCents(100), commissionCents: moneyCents(0), items: [], merchantOrders: [], createdAt: now, expiresAt: now, paidAt: now, pickedUpAt: null,
    };
    await store.saveUser({ id: userId, wechatOpenId: 'openid-notification-user', status: 'ACTIVE', createdAt: now });
    await store.saveOrder(order);
    await store.saveNotificationPreference({ userId, types: ['ARRIVED'], updatedAt: now });
    const send = vi.fn(async () => undefined);
    const service = new NotificationService(store, { send });
    const plan = await store.getDeliveryPlan('delivery-plan-demo-001');
    if (!plan) throw new Error('expected seeded delivery plan');

    await service.notifyCampaign('ARRIVED', order.campaignId, plan, 'arrival:test');
    expect(send).not.toHaveBeenCalled();
    expect((await store.listOrderNotificationsByUser(userId))[0]?.status).toBe('PENDING_DELIVERY');

    expect(await service.drainPending()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await store.listOrderNotificationsByUser(userId))[0]).toMatchObject({ status: 'WECHAT_SENT', deliveryAttempts: 1 });
    expect(await service.drainPending()).toBe(0);
  });

  it('uses small claims and rejects a stale claimant write', async () => {
    const store = new MemoryStore(false);
    const now = '2026-01-01T00:00:00.000Z';
    const notification = (index: number): OrderNotification => ({
      id: `outbox-${index}`, eventKey: `event-${index}`, userId: 'user-1', orderId: `order-${index}`, type: 'ARRIVED', title: 'Arrival', content: 'Ready',
      status: 'PENDING_DELIVERY', readAt: null, manualCompletedAt: null, createdAt: new Date(Date.parse(now) + index).toISOString(),
      deliveryAttempts: 0, nextAttemptAt: now, deliveryLeaseUntil: null, deliveryClaimToken: null, lastDeliveryError: null, deliveredAt: null,
    });
    for (let index = 0; index < 6; index += 1) await store.createOrderNotificationIfAbsent(notification(index));

    const firstLeaseUntil = '2026-01-01T00:00:10.000Z';
    const firstClaim = await store.claimPendingOrderNotifications(100, firstLeaseUntil, now, 'worker-one');
    expect(firstClaim).toHaveLength(5);
    expect(firstClaim.every((item) => item.deliveryClaimToken === 'worker-one')).toBe(true);

    const secondClaim = await store.claimPendingOrderNotifications(1, '2026-01-01T00:01:00.000Z', '2026-01-01T00:00:11.000Z', 'worker-two');
    expect(secondClaim).toHaveLength(1);
    expect(secondClaim[0]?.id).toBe(firstClaim[0]?.id);
    const staleResult: OrderNotification = { ...firstClaim[0]!, status: 'WECHAT_SENT', deliveryAttempts: 1, nextAttemptAt: null, deliveryLeaseUntil: null, deliveryClaimToken: null, lastDeliveryError: null, deliveredAt: now };
    expect(await store.saveOrderNotificationIfClaimed(staleResult, 'worker-one')).toBe(false);
    expect((await store.getOrderNotification(staleResult.id))?.deliveryClaimToken).toBe('worker-two');

    const currentResult: OrderNotification = { ...secondClaim[0]!, status: 'WECHAT_SENT', deliveryAttempts: 1, nextAttemptAt: null, deliveryLeaseUntil: null, deliveryClaimToken: null, lastDeliveryError: null, deliveredAt: now };
    expect(await store.saveOrderNotificationIfClaimed(currentResult, 'worker-two')).toBe(true);
    expect((await store.getOrderNotification(currentResult.id))).toMatchObject({ status: 'WECHAT_SENT', deliveryClaimToken: null });
  });

  it('uses persisted pickup-window deadlines to enqueue idempotent reminder and expiry outbox facts', async () => {
    const store=new MemoryStore(false);const now='2026-12-31T15:30:00.000Z';const userId='pickup-notification-user';const orderId='pickup-notification-order';const planId='pickup-notification-plan';
    await store.saveUser({id:userId,wechatOpenId:'openid-pickup-notification',status:'ACTIVE',createdAt:now});
    await store.saveOrder({id:orderId,orderNo:'N-PICKUP-001',userId,campaignId:'pickup-notification-campaign',serviceAreaId:'service-bd-lianchi',pickupPointId:'pickup-demo-001',deliveryPlanId:planId,businessModelVersion:'PLATFORM_COMMUNITY',paymentRoute:'PLATFORM_DIRECT',status:'READY_FOR_PICKUP',totalCents:moneyCents(100),commissionCents:moneyCents(0),items:[],merchantOrders:[],createdAt:now,expiresAt:now,paidAt:now,pickedUpAt:null});
    await store.saveDeliveryPlan({id:planId,campaignId:'pickup-notification-campaign',serviceAreaId:'service-bd-lianchi',pickupPointId:'pickup-demo-001',status:'ARRIVED',siteName:'测试点位',address:'测试地址',arrivalStartAt:now,arrivalEndAt:null,contactName:null,contactPhone:null,vehicleOrderNo:null,driverName:null,driverPhone:null,vehiclePlate:null,logisticsPlatform:null,estimatedArrivalAt:null,remark:null,confirmedAt:now,bookedAt:now,dispatchedAt:now,arrivedAt:now,createdAt:now,updatedAt:now});
    await store.saveNotificationPreference({userId,types:['PICKUP_DEADLINE','PICKUP_EXPIRED'],updatedAt:now});
    await store.saveCommunityPickupWindow({orderId,deliveryPlanId:planId,arrivedAt:now,deadlineAt:'2026-12-31T16:00:00.000Z',status:'ACTIVE',extensionCount:0,extendedBy:null,extendedAt:null,dispositionBy:null,dispositionAt:null,dispositionNote:null,refundExceptionId:null,lossExceptionId:null});
    vi.useFakeTimers();vi.setSystemTime(new Date(now));
    try{
      const service=new CommunityOperationsService(store,{} as PaymentService,new NotificationService(store,{send:async()=>undefined}));
      expect(await service.reconcilePickupDeadlines()).toBe(0);
      expect((await store.listOrderNotificationsByUser(userId)).map((item)=>item.type)).toEqual(['PICKUP_DEADLINE']);
      await service.reconcilePickupDeadlines();expect(await store.listOrderNotificationsByUser(userId)).toHaveLength(1);
      vi.setSystemTime(new Date('2026-12-31T16:00:01.000Z'));
      expect(await service.reconcilePickupDeadlines()).toBe(1);
      expect(await store.getCommunityPickupWindowForUpdate(orderId)).toMatchObject({status:'EXPIRED_PENDING'});
      expect((await store.listOrderNotificationsByUser(userId)).map((item)=>item.type)).toEqual(expect.arrayContaining(['PICKUP_DEADLINE','PICKUP_EXPIRED']));
    }finally{vi.useRealTimers();}
  });

  it('records an overdue loss once, closes the window and revokes the pickup credential', async () => {
    const store=new MemoryStore(false);const now='2027-01-01T00:00:00.000Z';const orderId='pickup-loss-order';
    await store.saveOrder({id:orderId,orderNo:'N-LOSS-001',userId:'pickup-loss-user',campaignId:'pickup-loss-campaign',serviceAreaId:'service-bd-lianchi',pickupPointId:'pickup-demo-001',deliveryPlanId:'pickup-loss-plan',businessModelVersion:'PLATFORM_COMMUNITY',paymentRoute:'PLATFORM_DIRECT',status:'READY_FOR_PICKUP',totalCents:moneyCents(100),commissionCents:moneyCents(0),items:[],merchantOrders:[],createdAt:now,expiresAt:now,paidAt:now,pickedUpAt:null});
    await store.saveSalesOrderItems(orderId,[{id:'pickup-loss-line',platformSkuId:'pickup-loss-sku',productId:'pickup-loss-product',title:'逾期报损商品',skuName:'一份',quantity:1,unitPriceCents:100,purchaseUnitCents:0,amountCents:100}]);
    await store.updatePlatformSalesLine({id:'pickup-loss-line',orderId,platformSkuId:'pickup-loss-sku',quantity:1,unitPriceCents:moneyCents(100),purchaseUnitCents:moneyCents(0),amountCents:moneyCents(100),fulfilledQuantity:1,pickedUpQuantity:0,exceptionQuantity:0,refundedQuantity:0,refundedAmountCents:moneyCents(0),paidAt:now});
    await store.saveCommunityPickupWindow({orderId,deliveryPlanId:'pickup-loss-plan',arrivedAt:'2026-12-29T00:00:00.000Z',deadlineAt:'2027-01-01T00:00:00.000Z',status:'EXPIRED_PENDING',extensionCount:0,extendedBy:null,extendedAt:null,dispositionBy:null,dispositionAt:null,dispositionNote:null,refundExceptionId:null,lossExceptionId:null});
    await store.savePickupCredential({orderId,codeHash:'not-a-real-code',status:'ACTIVE',expiresAt:'2027-01-01T00:00:00.000Z'});
    vi.useFakeTimers();vi.setSystemTime(new Date(now));
    try{
      const service=new CommunityOperationsService(store,{} as PaymentService,new NotificationService(store,{send:async()=>undefined}));
      await expect(service.disposeExpiredPickup(orderId,'operator-1','LOSS','逾期且多次联系未领取','loss-request-1')).resolves.toMatchObject({status:'CLOSED'});
      expect(await store.getCommunityPickupWindowForUpdate(orderId)).toMatchObject({status:'CLOSED',dispositionBy:'operator-1',lossExceptionId:expect.any(String)});
      expect(await store.getPickupCredential(orderId)).toMatchObject({status:'REVOKED'});
      expect(await store.getOrder(orderId)).toMatchObject({status:'COMPLETED'});
      const [loss]=await store.listFulfillmentExceptions();const [item]=loss?.items??[];
      expect(loss).toMatchObject({status:'RESOLVED',responsibility:'PICKUP_POINT'});expect(item).toMatchObject({expectedQuantity:1,acceptedQuantity:0,rejectedQuantity:0,shortQuantity:1,damagedQuantity:0});expect((item?.acceptedQuantity??0)+(item?.rejectedQuantity??0)+(item?.shortQuantity??0)+(item?.damagedQuantity??0)).toBe(item?.expectedQuantity);
      await expect(service.disposeExpiredPickup(orderId,'operator-1','LOSS','重复报损','loss-request-2')).rejects.toMatchObject({code:'INVALID_STATE_TRANSITION'});
    }finally{vi.useRealTimers();}
  });

  it('closes an overdue refund window only after the durable provider refund reaches success', async () => {
    const store=new MemoryStore(false);const now='2027-01-02T00:00:00.000Z';const orderId='pickup-refund-order';const exceptionId='pickup-refund-exception';
    await store.saveOrder({id:orderId,orderNo:'N-REFUND-001',userId:'pickup-refund-user',campaignId:'pickup-refund-campaign',serviceAreaId:'service-bd-lianchi',pickupPointId:'pickup-demo-001',deliveryPlanId:'pickup-refund-plan',businessModelVersion:'PLATFORM_COMMUNITY',paymentRoute:'PLATFORM_DIRECT',status:'READY_FOR_PICKUP',totalCents:moneyCents(100),commissionCents:moneyCents(0),items:[],merchantOrders:[],createdAt:now,expiresAt:now,paidAt:now,pickedUpAt:null});
    await store.saveCommunityPickupWindow({orderId,deliveryPlanId:'pickup-refund-plan',arrivedAt:'2026-12-30T00:00:00.000Z',deadlineAt:'2027-01-01T00:00:00.000Z',status:'REFUND_PENDING',extensionCount:0,extendedBy:null,extendedAt:null,dispositionBy:'operator-1',dispositionAt:now,dispositionNote:'逾期退款',refundExceptionId:exceptionId,lossExceptionId:null});
    await store.savePlatformPartialRefund({id:'pickup-refund-failed',exceptionId,orderId,paymentId:'payment-1',providerRefundNo:'partial-refund-1',providerRefundId:null,status:'FAILED',amountCents:moneyCents(100),createdAt:now,submissionLeaseUntil:null,submissionClaimToken:null});
    const service=new CommunityOperationsService(store,{} as PaymentService,new NotificationService(store,{send:async()=>undefined}));
    expect(await service.reconcileExpiredPickupRefunds()).toBe(0);expect(await store.getCommunityPickupWindowForUpdate(orderId)).toMatchObject({status:'REFUND_PENDING'});
    // The payment reconciler overwrites this stable refund fact after its
    // provider query/retry succeeds; only then may the pickup window close.
    await store.savePlatformPartialRefund({id:'pickup-refund-failed',exceptionId,orderId,paymentId:'payment-1',providerRefundNo:'partial-refund-1',providerRefundId:'provider-refund-1',status:'SUCCEEDED',amountCents:moneyCents(100),createdAt:now,submissionLeaseUntil:null,submissionClaimToken:null});
    expect(await service.reconcileExpiredPickupRefunds()).toBe(1);expect(await store.getCommunityPickupWindowForUpdate(orderId)).toMatchObject({status:'CLOSED'});expect(await store.getOrder(orderId)).toMatchObject({status:'READY_FOR_PICKUP'});
  });
});
