import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config.js';
import { MemoryStore } from '../core/store.js';
import { NotificationService } from './notification-service.js';
import { WechatSubscriptionMessageProvider, type SubscriptionInput } from './wechat-subscription-provider.js';
import { subscriptionData, subscriptionGroups, subscriptionGroup, chinaTime, validateSubscriptionValue } from './subscription-templates.js';
import { pickupCode, pickupCodeHash } from '../fulfillment/pickup-code.js';
import type { OrderNotificationType } from '../core/types.js';

const secret = 'unchanged-existing-pickup-secret';
const config = (state = 'trial') => loadConfig({ NODE_ENV: 'test', PICKUP_CODE_SECRET: secret,
  WECHAT_APP_ID: 'wechat-test-app', WECHAT_APP_SECRET: 'test-secret-value', WECHAT_SUBSCRIBE_MINIPROGRAM_STATE: state,
  ...Object.fromEntries(subscriptionGroups.flatMap((group) => [[`WECHAT_SUBSCRIBE_${group}_TEMPLATE_ID`, `account-${group}`], [`WECHAT_SUBSCRIBE_${group}_TEMPLATE_DATA`, JSON.stringify(subscriptionData[group])]])),
});
function fixture(type: OrderNotificationType = 'ARRIVED'): SubscriptionInput {
  const id = Array.from({ length: 1000 }, (_, i) => `order-${i}`).find((id) => pickupCode(id, secret).startsWith('0'))!;
  const date = type === 'PICKUP_EXPIRED' ? '2030-08-23T15:59:59.000Z' : '2030-08-24T15:59:59.000Z';
  return {
    user: { id: 'user', wechatOpenId: 'openid', status: 'ACTIVE', createdAt: '2026-09-07T01:00:00Z' },
    plan: { id: 'plan', campaignId: 'campaign', serviceAreaId: 'area', pickupPointId: 'point', status: 'ARRIVED', siteName: '社区自提点', address: '实际地址', arrivalStartAt: '2020-01-01T00:00:00Z', arrivalEndAt: '2020-01-02T00:00:00Z', contactName: null, contactPhone: null, vehicleOrderNo: null, driverName: null, driverPhone: null, vehiclePlate: null, logisticsPlatform: null, estimatedArrivalAt: null, remark: null, confirmedAt: null, bookedAt: null, dispatchedAt: null, arrivedAt: '2030-08-21T00:00:00Z', createdAt: '2026-09-07T01:00:00Z', updatedAt: '2026-09-07T01:00:00Z' },
    order: { id, orderNo: 'HT202609071234567890', userId: 'user', campaignId: 'campaign', serviceAreaId: 'area', pickupPointId: 'point', deliveryPlanId: 'plan', status: 'READY_FOR_PICKUP', totalCents: 5000, items: [{ orderLineId: 'line', skuId: 'sku', productId: 'product', name: '当季蔬菜', quantity: 1, unitPriceCents: 5000, amountCents: 5000, fulfilledQuantity: 1, pickedUpQuantity: 0, exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: 0 }], createdAt: '2026-09-07T01:00:00Z', expiresAt: date, paidAt: '2026-09-07T01:00:00Z', pickedUpAt: null },
    notification: { id: 'notice', eventKey: type === 'PICKUP_DEADLINE' ? `pickup-deadline:${id}:${date}` : type === 'PICKUP_EXPIRED' ? `pickup-expired:${id}:${date}` : 'event', userId: 'user', orderId: id, type, siteConfirmed: true, refundId: 'refund-a', title: '请查看订单领取安排', content: '内容', status: 'PENDING_DELIVERY', readAt: null, manualCompletedAt: null, manualCompletedBy: null, manualCompletionNote: null, createdAt: '2026-09-07T01:00:00Z', deliveryAttempts: 0, nextAttemptAt: '2026-09-07T01:00:00Z', deliveryLeaseUntil: null, deliveryClaimToken: null, providerSubmissionAttemptId: null, providerSubmissionStartedAt: null, providerResultRecordedAt: null, providerReceiptId: null, submissionUnknownReason: null, lastDeliveryError: null, deliveredAt: null },
    window: { orderId: id, deliveryPlanId: 'plan', arrivedAt: '2030-08-21T00:00:00Z', deadlineAt: date, status: type === 'PICKUP_EXPIRED' ? 'EXPIRED_PENDING' : 'ACTIVE', extensionCount: 0, extendedBy: null, extendedAt: null, dispositionBy: null, dispositionAt: null, dispositionNote: null, refundExceptionId: null, lossExceptionId: null },
    credential: { orderId: id, codeHash: pickupCodeHash(pickupCode(id, secret), secret), status: 'ACTIVE', expiresAt: date },
    refund: { id: 'refund-a', exceptionId: 'exception', orderId: id, paymentId: 'payment', providerRefundNo: 'historical-merchant-no-longer-than-32-preserved', providerRefundId: '5030000000202609071234567890', status: 'SUCCEEDED', amountCents: 1234, createdAt: '2026-09-07T01:00:00Z', submissionLeaseUntil: null, submissionClaimToken: null },
  };
}
function mockWechat() {
  const send = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes('/token?') ? { access_token: 'token', expires_in: 7200 } : { errcode: 0 }), { status: 200 })));
  vi.stubGlobal('fetch', send); return send;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2030-08-24T00:00:00Z')); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('five account templates and seven semantic events', () => {
  it('sends exactly reviewed keys, five IDs, string pickup code and one authoritative deadline', async () => {
    const fetch = mockWechat(); const provider = new WechatSubscriptionMessageProvider(config());
    const types: OrderNotificationType[] = ['SITE_CONFIRMED', 'CAMPAIGN_POSTPONED', 'PICKUP_EXPIRED', 'VEHICLE_DISPATCHED', 'ARRIVED', 'PICKUP_DEADLINE', 'PARTIAL_REFUND'];
    for (const type of types) await provider.send(fixture(type));
    const payloads = fetch.mock.calls.filter(([url]) => String(url).includes('/subscribe/send')).map(([, options]) => JSON.parse(options.body));
    expect(new Set(payloads.map((p) => p.template_id)).size).toBe(5);
    payloads.forEach((payload, i) => {
      expect(Object.keys(payload.data).sort()).toEqual(Object.keys(subscriptionData[subscriptionGroup(types[i]!)]).sort());
      expect(payload.miniprogram_state).toBe('trial');
      expect(payload.page).toBe(`pages/order-detail/index?id=${fixture().order!.id}`);
    });
    expect(payloads[4].data.number10.value).toMatch(/^0\d{5}$/);
    expect(payloads[4].data.date8.value).toBe('2030-08-24 23:59:59');
    expect(payloads[5].data.time3.value).toBe(payloads[4].data.date8.value);
    expect(payloads[6].data.amount1.value).toBe('12.34');
    expect(payloads[6].data.character_string3.value).toBe(fixture().refund!.providerRefundId);
  });
  it('uses an extended arrival window but suppresses obsolete deadline and expiry events', async () => {
    const fetch = mockWechat(); const provider = new WechatSubscriptionMessageProvider(config());
    const arrival = fixture(); arrival.window!.deadlineAt = '2030-08-26T04:00:00Z'; arrival.window!.status = 'EXTENDED'; arrival.credential!.expiresAt = arrival.window!.deadlineAt;
    await provider.send(arrival);
    expect(JSON.parse(fetch.mock.calls[1]![1].body).data.date8.value).toBe('2030-08-26 12:00:00');
    for (const type of ['PICKUP_DEADLINE', 'PICKUP_EXPIRED'] as const) {
      const stale = fixture(type); stale.window!.deadlineAt = '2030-08-26T04:00:00Z'; stale.window!.status = 'EXTENDED';
      await expect(provider.send(stale)).rejects.toThrow(/已过时|已失效/);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('uses captured site facts and current real status, with explicit formal landing', async () => {
    const fetch = mockWechat(); const input = fixture('SITE_CONFIRMED'); input.plan.siteName = null;
    await new WechatSubscriptionMessageProvider(config('formal')).send(input);
    const payload = JSON.parse(fetch.mock.calls[1]![1].body);
    expect(payload.data.phrase3.value).toBe('已确认'); expect(payload.data.phrase5.value).toBe('待领取'); expect(payload.miniprogram_state).toBe('formal');
  });
  it('fails before any HTTP for missing, cross-order, unsuccessful or oversized refund references', async () => {
    const fetch = mockWechat(); const provider = new WechatSubscriptionMessageProvider(config());
    for (const change of [
      (x: SubscriptionInput) => { delete x.notification.refundId; },
      (x: SubscriptionInput) => { x.refund!.id = 'different-refund'; },
      (x: SubscriptionInput) => { x.refund!.orderId = 'another-order'; },
      (x: SubscriptionInput) => { x.refund!.status = 'PROCESSING'; },
      (x: SubscriptionInput) => { x.refund!.providerRefundId = null; },
      (x: SubscriptionInput) => { x.refund!.providerRefundId = 'X'.repeat(33); },
    ]) { const input = fixture('PARTIAL_REFUND'); change(input); await expect(provider.send(input)).rejects.toThrow(); }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not rotate or expose a generated code when an existing credential differs', async () => {
    const fetch = mockWechat(); const input = fixture(); input.credential!.codeHash = pickupCodeHash('OLDABC', secret);
    const before = structuredClone(input.credential);
    await expect(new WechatSubscriptionMessageProvider(config()).send(input)).rejects.toThrow(/原凭证/);
    expect(input.credential).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps preflight failures manual without crossing the at-most-once provider fence', async () => {
    const input = fixture('PARTIAL_REFUND'); delete input.notification.refundId;
    const store = new MemoryStore(false); await store.saveUser(input.user); await store.saveOrder(input.order!); await store.saveDeliveryPlan(input.plan);
    await store.saveNotificationPreference({ userId: 'user', types: ['PARTIAL_REFUND'], templateIds: { PARTIAL_REFUND: 'account-PARTIAL_REFUND' }, updatedAt: input.notification.createdAt });
    await store.createOrderNotificationIfAbsent(input.notification); const fetch = mockWechat();
    await new NotificationService(store, new WechatSubscriptionMessageProvider(config())).drainPending();
    expect(await store.getOrderNotification('notice')).toMatchObject({ status: 'MANUAL_REQUIRED', providerSubmissionStartedAt: null }); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not promote legacy accepted types to the new account template IDs', async () => {
    const input = fixture(); const store = new MemoryStore(false); await store.saveOrder(input.order!);
    await store.saveNotificationPreference({ userId: 'user', types: ['ARRIVED'], updatedAt: input.notification.createdAt });
    await new NotificationService(store, new WechatSubscriptionMessageProvider(config())).enqueueOrder(store, 'ARRIVED', input.order!.id, input.plan, 'new-arrival');
    expect((await store.listOrderNotificationsByUser('user'))[0]?.status).toBe('MANUAL_REQUIRED');
  });
  it('validates boundaries without truncating identifiers, codes or amounts', () => {
    expect(validateSubscriptionValue('thing2', '很'.repeat(21))).toHaveLength(20);
    expect(validateSubscriptionValue('number10', '000007')).toBe('000007');
    expect(() => validateSubscriptionValue('character_string1', 'a'.repeat(33))).toThrow();
    expect(() => validateSubscriptionValue('number10', '12AB')).toThrow();
    expect(() => validateSubscriptionValue('phrase3', '超过五个中文汉字')).toThrow();
    expect(() => validateSubscriptionValue('amount1', 'NaN')).toThrow();
    expect(chinaTime('2030-08-24T15:59:59.999Z')).toBe('2030-08-24 23:59:59');
  });
});
