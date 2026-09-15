import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryStore } from './modules/core/store.js';
import { createAdminCredential } from './modules/auth/admin-auth.js';
import { MockPaymentProvider, type PaymentNotification } from './modules/payments/payment-provider.js';

// TASK-20260908-FULL-FLOW: isolated HTTP business journey. Only external WeChat
// identity/phone/payment decoding and notification delivery are substituted.
// Signature verification remains covered by the payment-provider tests.
class CallbackTestProvider extends MockPaymentProvider {
  public override parseNotification(rawBody: string): PaymentNotification {
    return { ...JSON.parse(rawBody), bodyHash: createHash('sha256').update(rawBody).digest('hex') } as PaymentNotification;
  }
}
type Headers = { authorization: string };
let app: FastifyInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  await app?.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('registered consumer and authenticated staff full business flow', () => {
  it('uploads a product image, registers, pays through callbacks, dispatches and performs two scoped pickups with rejection invariants', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2026-09-08T01:00:00.000Z');
    vi.setSystemTime(start);
    const network = vi.fn(() => { throw new Error('External network is forbidden in this isolated journey'); });
    vi.stubGlobal('fetch', network);
    directory = await mkdtemp(join(tmpdir(), 'full-business-flow-'));
    const config = loadConfig({ NODE_ENV: 'test', AUTH_PROVIDER: 'wechat', WECHAT_APP_ID: 'test-only-app', WECHAT_APP_SECRET: 'test-only-secret', PRODUCT_IMAGE_DIR: directory });
    const store = new MemoryStore(false);
    const now = start.toISOString();
    // Initial bootstrap only. Every subsequent account and business write uses HTTP.
    await store.saveUser({ id: 'bootstrap', wechatOpenId: null, status: 'ACTIVE', createdAt: now });
    await store.replaceUserRoles('bootstrap', ['SUPER_ADMIN']);
    await store.saveInternalStaff({ userId: 'bootstrap', staffNo: 'BOOTSTRAP', displayName: '测试管理员', phone: '13800000000', role: 'SUPER_ADMIN', status: 'ACTIVE', createdBy: null, activatedAt: now, suspendedAt: null, suspensionReason: null, authorizationVersion: 1, createdAt: now, updatedAt: now });
    await store.saveAdminCredential(await createAdminCredential('bootstrap', 'bootstrap', 'TestBootstrap123', ['SUPER_ADMIN'], false, 1));
    const phoneExchange = vi.fn(async () => ({ phoneNumber: '13800138000', phoneVerifiedAt: now }));
    app = await buildApp({ config, store, paymentProvider: new CallbackTestProvider(), wechatCodeExchange: { exchange: async (code) => ({ openId: `test-openid-${code}` }) }, wechatPhoneExchange: { exchange: phoneExchange }, subscriptionMessageProvider: { send: async () => { throw new Error('No subscription delivery authorized'); } } });
    const request = async (options: InjectOptions, status = 200) => {
      const response = await app!.inject(options);
      expect(response.statusCode, `${options.method} ${options.url}: ${response.body}`).toBe(status);
      return response;
    };
    const post = async (url: string, headers: Headers, payload?: Record<string, unknown>, status = 200) => (await request({ method: 'POST', url, headers, ...(payload ? { payload } : {}) }, status)).json().data;
    const get = async (url: string, headers?: Headers) => (await request({ method: 'GET', url, ...(headers ? { headers } : {}) })).json().data;
    const bearer = (accessToken: string): Headers => ({ authorization: `Bearer ${accessToken}` });
    const root = bearer((await request({ method: 'POST', url: '/api/v1/auth/admin/login', payload: { username: 'bootstrap', password: 'TestBootstrap123' } })).json().data.accessToken);
    const staff = async (role: string, username: string, phone: string, pickupPointIds: string[] = []) => {
      const created = await post('/api/v1/admin/staff', root, { role, username, phone, pickupPointIds, status: 'ACTIVE', displayName: username }, 201);
      expect(created.staff.status).toBe('PASSWORD_SETUP_REQUIRED');
      const login = (await request({ method: 'POST', url: '/api/v1/auth/admin/login', payload: { username, password: created.temporaryPassword } })).json().data;
      expect(login.nextAction).toBe('CHANGE_PASSWORD');
      expect(login.accessToken).toBeUndefined();
      await request({ method: 'GET', url: '/api/v1/pickup/delivery-plans', headers: bearer(login.passwordChangeToken) }, 401);
      const changed = (await request({ method: 'POST', url: '/api/v1/auth/admin/complete-password-change', payload: { passwordChangeToken: login.passwordChangeToken, newPassword: 'ChangedPassword123' } })).json().data;
      return { headers: bearer(changed.accessToken), id: created.staff.userId };
    };
    const operator = (await staff('OPERATOR', 'operator', '13800000001')).headers;
    const area = await post('/api/v1/admin/service-areas', operator, { regionCode: '110101' }, 201);
    const point = async (name: string, latitude: number) => post('/api/v1/admin/pickup-points', operator, { serviceAreaId: area.id, name, address: `${name}测试地址`, businessHours: '09:00-20:00', pickupInstructions: '请出示取货码', latitude, longitude: 116.4074, contactName: '测试负责人', contactPhone: '13800000002', capacityPerDay: 100 }, 201);
    const pointA = await point('东门', 39.9042);
    const pointB = await point('西门', 39.91);
    const manager = await staff('PICKUP_MANAGER', 'manager', '13800000003', [pointA.id]);
    const otherManager = await staff('PICKUP_MANAGER', 'other.manager', '13800000004', [pointB.id]);
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'green' } }).png().toBuffer();
    const uploaded = await request({ method: 'POST', url: '/api/v1/admin/product-images', headers: { ...operator, 'content-type': 'image/png' }, payload: image }, 201);
    const imageUrl = uploaded.json().data.imageUrl as string;
    expect((await request({ method: 'GET', url: imageUrl })).headers['content-type']).toBe('image/webp');
    const sku = await post('/api/v1/admin/catalog/skus', operator, { title: '全流程测试蔬菜', category: '蔬菜', origin: '测试农场', imageUrl, skuName: '一份', retailPriceCents: 1500, defaultSellableQuantity: 20, status: 'ACTIVE' }, 201);
    expect(sku.product.imageUrl).toBe(imageUrl);
    const campaign = await post('/api/v1/admin/campaigns', operator, { title: '全流程测试团', serviceAreaId: area.id, pickupPointId: pointA.id, cutoffAt: new Date(+start + 3600000).toISOString(), dispatchAt: new Date(+start + 7200000).toISOString(), estimatedArrivalStartAt: new Date(+start + 10800000).toISOString(), estimatedArrivalEndAt: new Date(+start + 14400000).toISOString(), minTotalQuantity: 1, failureAction: 'CANCEL_AND_REFUND', items: [{ catalogSkuId: sku.id, retailPriceCents: 1500, sellableQuantity: 20 }] }, 201);
    await post(`/api/v1/admin/campaigns/${campaign.id}/open`, operator);
    const publicCampaign = await get(`/api/v1/campaigns/${campaign.id}`);
    expect(publicCampaign.items[0].imageUrl).toBe(imageUrl);
    const loginPayload = { code: 'consumer-a', privacyAccepted: true, privacyVersion: config.PRIVACY_NOTICE_VERSION };
    await request({ method: 'POST', url: '/api/v1/auth/wechat/login', payload: { ...loginPayload, privacyAccepted: false, phoneCode: 'phone' } }, 400);
    const unbound = (await request({ method: 'POST', url: '/api/v1/auth/wechat/login', payload: { ...loginPayload, openid: 'forged', phoneNumber: '13900000000' } })).json().data;
    expect(unbound).toEqual({ phoneRequired: true });
    expect(await store.findUserByWechatOpenId('test-openid-consumer-a')).toBeNull();
    await request({ method: 'GET', url: '/api/v1/orders', headers: { 'x-demo-user-id': 'bootstrap', 'x-demo-role': 'SUPER_ADMIN' } }, 401);
    const registered = (await request({ method: 'POST', url: '/api/v1/auth/wechat/login', payload: { ...loginPayload, phoneCode: 'phone-a' } })).json().data;
    const customer = bearer(registered.accessToken);
    expect(await store.findUserByWechatOpenId('test-openid-consumer-a')).toMatchObject({ id: registered.userId, phoneNumber: '13800138000' });
    const phoneCallsAfterRegistration = phoneExchange.mock.calls.length;
    const returning = (await request({ method: 'POST', url: '/api/v1/auth/wechat/login', payload: loginPayload })).json().data;
    expect(returning).toMatchObject({ userId: registered.userId, phoneRequired: false });
    expect(phoneExchange).toHaveBeenCalledTimes(phoneCallsAfterRegistration);
    expect(await get('/api/v1/orders', bearer(returning.accessToken))).toEqual([]);
    const secondLogin = (await request({ method: 'POST', url: '/api/v1/auth/wechat/login', payload: { ...loginPayload, code: 'consumer-b', phoneCode: 'phone-b' } })).json().data;
    const otherCustomer = bearer(secondLogin.accessToken);
    const checkout = { campaignId: campaign.id, serviceAreaId: area.id, pickupPointId: pointA.id, items: [{ skuId: sku.id, quantity: 2 }] };
    expect((await post('/api/v1/orders/preview', customer, checkout)).totalCents).toBe(3000);
    const orderHeaders = { ...customer, 'idempotency-key': 'full-flow-checkout' };
    const order = await post('/api/v1/orders', orderHeaders, checkout, 201);
    expect(order.status).toBe('PENDING_PAYMENT');
    const expectedItemName = '全流程测试蔬菜 · 一份';
    expect(order.items[0].name).toBe(expectedItemName);
    // Catalog edits must not become a replacement for the order's sale snapshot.
    const renamedSku = await post('/api/v1/admin/catalog/skus', operator, { id: sku.id, productId: sku.productId, title: '改名后的蔬菜', category: '蔬菜', origin: '测试农场', imageUrl, skuName: '新规格', retailPriceCents: 1500, defaultSellableQuantity: 20, status: 'ACTIVE' });
    expect(renamedSku.product.title).toBe('改名后的蔬菜');
    expect((await get(`/api/v1/orders/${order.id}`, customer)).items[0].name).toBe(expectedItemName);
    expect((await post('/api/v1/orders/preview', customer, checkout)).items[0].name).toBe(expectedItemName);
    expect((await post('/api/v1/orders', orderHeaders, checkout, 201)).id).toBe(order.id);
    const snapshot = () => get(`/api/v1/orders/${order.id}`, customer);
    const unchanged = async (operation: () => Promise<unknown>) => {
      const before = await snapshot();
      const receipts = await store.listCommunityPickupReceiptsByOrder(order.id);
      const ledger = await store.listLedgerTransactions();
      const orders = await store.listOrdersByCampaign(campaign.id);
      const inventory = await store.getCampaignItem(campaign.id, sku.id);
      const lines = await store.listOrderLinesByCampaign(campaign.id);
      await operation();
      expect(await snapshot()).toEqual(before);
      expect(await store.listCommunityPickupReceiptsByOrder(order.id)).toEqual(receipts);
      expect(await store.listLedgerTransactions()).toEqual(ledger);
      expect(await store.listOrdersByCampaign(campaign.id)).toEqual(orders);
      expect(await store.getCampaignItem(campaign.id, sku.id)).toEqual(inventory);
      expect(await store.listOrderLinesByCampaign(campaign.id)).toEqual(lines);
    };
    const prematurePickup = () => request({ method: 'POST', url: '/api/v1/pickup/verify', headers: manager.headers, payload: { orderId: order.id, deliveryPlanId: campaign.deliveryPlan.id, code: '000000', pickupRequestId: randomUUID(), items: [{ catalogSkuId: sku.id, quantity: 1 }] } }, 409);
    await unchanged(async () => {
      const rejected = await request({ method: 'POST', url: '/api/v1/orders', headers: { ...customer, 'idempotency-key': 'insufficient-stock' }, payload: { ...checkout, items: [{ skuId: sku.id, quantity: 21 }] } }, 409);
      expect(rejected.json().code).toBe('SKU_STOCK_INSUFFICIENT');
    });
    await unchanged(prematurePickup); // Unpaid orders cannot be collected.
    await unchanged(() => request({ method: 'POST', url: '/api/v1/orders', headers: orderHeaders, payload: { ...checkout, items: [{ skuId: sku.id, quantity: 3 }] } }, 409));
    await unchanged(() => request({ method: 'GET', url: `/api/v1/orders/${order.id}`, headers: otherCustomer }, 403));
    await unchanged(() => request({ method: 'POST', url: `/api/v1/orders/${order.id}/pay`, headers: otherCustomer }, 404));
    await post(`/api/v1/orders/${order.id}/pay`, customer);
    const callback = { eventId: 'full-flow-payment', type: 'TRANSACTION.SUCCESS', orderNo: order.orderNo, providerPaymentId: 'test-provider-payment', amountCents: 3000 };
    await unchanged(() => request({ method: 'POST', url: '/api/v1/payments/wechat/notify', payload: { ...callback, eventId: 'wrong-amount', amountCents: 3001 } }, 409));
    expect((await store.getPaymentByOrder(order.id))?.status).toBe('CREATED');
    await request({ method: 'POST', url: '/api/v1/payments/wechat/notify', payload: callback });
    expect((await snapshot()).status).toBe('PAID_WAITING_CLOSE');
    const ledgerAfterPay = await store.listLedgerTransactions();
    expect(ledgerAfterPay).toHaveLength(1);
    expect(ledgerAfterPay[0]).toMatchObject({ referenceType: 'ORDER', referenceId: order.id, eventType: 'PAYMENT_SUCCEEDED', lines: [
      { accountCode: 'PAYMENT_CLEARING', direction: 'DEBIT', amountCents: 3000 },
      { accountCode: 'CUSTOMER_CONTRACT_LIABILITY', direction: 'CREDIT', amountCents: 3000 },
    ] });
    for (const transaction of ledgerAfterPay) {
      const amount = (direction: 'DEBIT' | 'CREDIT') => transaction.lines.filter((line) => line.direction === direction).reduce((sum, line) => sum + Number(line.amountCents), 0);
      expect(amount('DEBIT')).toBe(3000);
      expect(amount('DEBIT')).toBe(amount('CREDIT'));
    }
    const paidCampaign = await get(`/api/v1/campaigns/${campaign.id}`);
    await unchanged(() => request({ method: 'POST', url: '/api/v1/payments/wechat/notify', payload: callback }));
    expect(await store.listLedgerTransactions()).toEqual(ledgerAfterPay);
    expect(await get(`/api/v1/campaigns/${campaign.id}`)).toEqual(paidCampaign);
    expect((await store.getPaymentByOrder(order.id))?.status).toBe('SUCCEEDED');
    const unpaidOrder = await post('/api/v1/orders', { ...customer, 'idempotency-key': 'manual-close-unpaid' }, { ...checkout, items: [{ skuId: sku.id, quantity: 1 }] }, 201);
    expect(unpaidOrder.status).toBe('PENDING_PAYMENT');
    expect((await post(`/api/v1/admin/campaigns/${campaign.id}/close`, operator, { reason: '运营测试提前截单' })).status).toBe('LOCKED');
    expect((await get(`/api/v1/orders/${unpaidOrder.id}`, customer)).status).toBe('CANCELLED');
    expect((await store.getCampaignItem(campaign.id, sku.id))?.reservedQuantity).toBe(2);
    expect((await store.listAuditLogs(100)).find((entry) => entry.action === 'CAMPAIGN_CLOSE')?.afterData).toMatchObject({ reason: '运营测试提前截单' });
    await unchanged(async () => {
      const rejected = await request({ method: 'POST', url: '/api/v1/orders', headers: { ...customer, 'idempotency-key': 'after-manual-cutoff' }, payload: checkout }, 409);
      expect(rejected.json().code).toBe('CAMPAIGN_NOT_OPEN');
    });
    expect((await post(`/api/v1/admin/campaigns/${campaign.id}/close`, operator)).status).toBe('LOCKED');
    await unchanged(async () => {
      const rejected = await request({ method: 'POST', url: '/api/v1/orders', headers: { ...customer, 'idempotency-key': 'after-locked' }, payload: checkout }, 409);
      expect(rejected.json().code).toBe('CAMPAIGN_NOT_OPEN');
    });
    expect(await get(`/api/v1/admin/campaigns/${campaign.id}/packing-labels`, operator)).toMatchObject([{ orderId: order.id }]);
    await post(`/api/v1/admin/delivery-plans/${campaign.deliveryPlan.id}/book-vehicle`, operator, { logisticsPlatform: '测试车队', vehicleOrderNo: 'TEST-CAR-1', driverName: '测试司机', driverPhone: '13800000005', vehiclePlate: '京A12345', estimatedArrivalAt: new Date(+start + 10800000).toISOString() });
    const batch = await post('/api/v1/admin/dispatch-batches', operator, { campaignId: campaign.id }, 201);
    const arrivalUrl = `/api/v1/admin/community/dispatch-batches/${batch.id}/arrival`;
    const arrival = { receivedBy: '测试负责人', confirmationNote: '清点完成', items: [{ catalogSkuId: sku.id, receivedQuantity: 2, rejectedQuantity: 0, shortQuantity: 0, damagedQuantity: 0, reason: null, evidenceNote: null }] };
    await unchanged(async () => {
      const rejected = await request({ method: 'POST', url: arrivalUrl, headers: manager.headers, payload: arrival }, 409);
      expect(rejected.json().code).toBe('INVALID_STATE_TRANSITION');
    });
    expect(await store.getCommunityDeliveryConfirmationByBatch(batch.id)).toBeNull();
    expect((await post(`/api/v1/admin/dispatch-batches/${batch.id}/dispatch`, operator)).status).toBe('IN_TRANSIT');
    await unchanged(prematurePickup); // Paid and dispatched, but not arrived.
    for (const headers of [operator, otherManager.headers]) await unchanged(() => request({ method: 'POST', url: arrivalUrl, headers, payload: arrival }, 403));
    const arrived = await post(arrivalUrl, manager.headers, arrival);
    expect(arrived.status).toBe('COMPLETED');
    expect((await post(arrivalUrl, manager.headers, arrival)).id).toBe(arrived.id);
    expect((await snapshot()).status).toBe('READY_FOR_PICKUP');
    const lookup = await get(`/api/v1/pickup/orders/lookup?deliveryPlanId=${campaign.deliveryPlan.id}&orderNo=${order.orderNo}`, manager.headers);
    expect(lookup.items[0].name).toBe(expectedItemName);
    const code = (await get(`/api/v1/pickup-code?orderId=${order.id}`, customer)).code as string;
    expect(code).toMatch(/^\d{6}$/);
    const pickup = { orderId: order.id, deliveryPlanId: campaign.deliveryPlan.id, code, pickupRequestId: randomUUID(), items: [{ catalogSkuId: sku.id, quantity: 1 }] };
    for (const headers of [operator, otherManager.headers, customer]) await unchanged(() => request({ method: 'POST', url: '/api/v1/pickup/verify', headers, payload: pickup }, 403));
    await unchanged(() => request({ method: 'POST', url: '/api/v1/pickup/verify', headers: manager.headers, payload: { ...pickup, code: code === '000000' ? '000001' : '000000' } }, 409));
    await unchanged(() => request({ method: 'POST', url: '/api/v1/pickup/verify', headers: manager.headers, payload: { ...pickup, items: [{ catalogSkuId: sku.id, quantity: 3 }] } }, 400));
    expect((await post('/api/v1/pickup/verify', manager.headers, pickup)).items[0].pickedUpQuantity).toBe(1);
    const afterFirst = await snapshot();
    const receiptsAfterFirst = await store.listCommunityPickupReceiptsByOrder(order.id);
    const ledgerAfterFirst = await store.listLedgerTransactions();
    // Isolated clock-boundary probe: the code above successfully collected one
    // item and is still valid for the remaining one. No business state is seeded
    // or extended. Restore only the test clock before resuming the normal path.
    const normalFlowTime = new Date();
    const windowBeforeExpiryProbe = await store.getCommunityPickupWindowForUpdate(order.id);
    try {
      vi.setSystemTime(new Date(afterFirst.pickupDeadlineAt));
      await unchanged(async () => {
        const rejected = await request({ method: 'POST', url: '/api/v1/pickup/verify', headers: manager.headers, payload: { ...pickup, pickupRequestId: randomUUID() } }, 409);
        expect(rejected.json().code).toBe('PICKUP_CODE_EXPIRED');
      });
    } finally {
      vi.setSystemTime(normalFlowTime);
    }
    expect(await store.getCommunityPickupWindowForUpdate(order.id)).toEqual(windowBeforeExpiryProbe);
    expect(await snapshot()).toEqual(afterFirst);
    await post('/api/v1/pickup/verify', manager.headers, pickup);
    expect(await snapshot()).toEqual(afterFirst);
    expect(await store.listCommunityPickupReceiptsByOrder(order.id)).toEqual(receiptsAfterFirst);
    expect(await store.listLedgerTransactions()).toEqual(ledgerAfterFirst);
    await unchanged(() => request({ method: 'POST', url: '/api/v1/pickup/verify', headers: manager.headers, payload: { ...pickup, items: [{ catalogSkuId: sku.id, quantity: 2 }] } }, 409));
    expect((await post('/api/v1/pickup/verify', manager.headers, { ...pickup, pickupRequestId: randomUUID() })).items[0].pickedUpQuantity).toBe(2);
    const complete = await snapshot();
    expect(complete.status).toBe('PICKED_UP');
    expect(complete.items[0].name).toBe(expectedItemName);
    expect(complete.items[0].pickedUpQuantity).toBe(2);
    expect(complete.pickupReceipts).toHaveLength(2);
    expect(complete.pickupReceipts.reduce((sum: number, receipt: { quantity: number }) => sum + receipt.quantity, 0)).toBe(2);
    for (const receipt of complete.pickupReceipts) expect(Date.parse(receipt.qualityDeadlineAt) - Date.parse(receipt.pickedUpAt)).toBe(86400000);
    await unchanged(() => request({ method: 'POST', url: '/api/v1/pickup/verify', headers: manager.headers, payload: { ...pickup, pickupRequestId: randomUUID() } }, 409));
    await request({ method: 'POST', url: '/api/v1/auth/logout', headers: customer, payload: {} }, 204);
    await request({ method: 'GET', url: '/api/v1/orders', headers: customer }, 401);
    expect(network).not.toHaveBeenCalled();
  });
});
