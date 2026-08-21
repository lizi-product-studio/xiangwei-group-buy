import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../core/store.js';
import type { Order } from '../core/types.js';
import { buildOrderDeliveryViews } from './order-read-model.js';

const order = (id: string): Order => ({
  id,
  orderNo: `NO-${id}`,
  userId: 'user',
  campaignId: 'campaign',
  serviceAreaId: 'area',
  pickupPointId: 'point',
  deliveryPlanId: `plan-${id}`,
  businessModelVersion: 'PLATFORM_COMMUNITY',
  paymentRoute: 'WECHAT_PLATFORM',
  status: 'READY_FOR_PICKUP',
  totalCents: 100,
  commissionCents: 0,
  items: [{ salesOrderItemId: `line-${id}`, skuId: 'sku', productId: 'product', merchantId: null, name: '商品', quantity: 1, unitPriceCents: 100, amountCents: 100, commissionRateBps: 0, commissionCents: 0, fulfilledQuantity: 1, exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: 0, pickedUpQuantity: 0 }],
  merchantOrders: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-02T00:00:00.000Z',
  paidAt: null,
  pickedUpAt: null,
});

describe('buildOrderDeliveryViews', () => {
  it('loads all associated facts once for two orders', async () => {
    const store = new MemoryStore(false);
    const spy = vi.spyOn(store, 'listOrderDeliveryFacts');
    const views = await buildOrderDeliveryViews(store, [order('one'), order('two')]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(['one', 'two']);
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({ id: 'one', partialRefunds: [], fulfillmentExceptions: [] });
    expect('merchantOrders' in views[0]).toBe(false);
    expect('commissionCents' in views[0]).toBe(false);
    expect(views[0].items[0]).toMatchObject({ remainingPickupQuantity: 1, refundStatus: null });
  });
});
