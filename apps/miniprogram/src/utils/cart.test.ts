import { describe, expect, it, vi } from 'vitest';

const values = new Map<string, unknown>();
vi.stubGlobal('wx', {
  getStorageSync: (key: string) => values.get(key),
  setStorageSync: (key: string, value: unknown) => values.set(key, value),
  removeStorageSync: (key: string) => values.delete(key),
});

const cart = await import('./cart.js');

const base = {
  source: 'cart' as const, campaignId: 'campaign-1', campaignTitle: '团期',
  serviceAreaId: 'area-1', serviceAreaName: '区域', pickupPointId: 'point-1',
  pickupPointName: '自提点', pickupPointAddress: '地址',
};
const line = { skuId: 'sku-1', title: '商品', skuName: '规格', imageUrl: null, unitPriceCents: 100, quantity: 1, maxQuantity: 3 };

describe('cart pickup binding and checkout idempotency', () => {
  it('keeps pickup point fields and reuses one checkout idempotency key', () => {
    values.clear();
    cart.addCartLine(base, line);
    const snapshot = cart.readCart();
    expect(snapshot).toMatchObject({ pickupPointId: 'point-1', pickupPointName: '自提点', pickupPointAddress: '地址' });
    cart.saveCheckoutDraft(snapshot!);
    const first = cart.ensureCheckoutIdempotencyKey(cart.readCheckoutDraft()!);
    const second = cart.ensureCheckoutIdempotencyKey(cart.readCheckoutDraft()!);
    expect(second.orderIdempotencyKey).toBe(first.orderIdempotencyKey);
  });

  it('removes legacy cart snapshots that cannot prove their pickup point', () => {
    values.set('standardCart', { ...base, pickupPointId: undefined, items: [line] });
    expect(cart.readCart()).toBeNull();
  });
});
