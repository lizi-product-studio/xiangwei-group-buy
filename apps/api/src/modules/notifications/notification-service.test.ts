import { describe, expect, it, vi } from 'vitest';
import { moneyCents } from '@hometown/domain';
import { MemoryStore } from '../core/store.js';
import type { Order, OrderNotification } from '../core/types.js';
import { NotificationService } from './notification-service.js';

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
});
