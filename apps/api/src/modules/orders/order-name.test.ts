import { moneyCents } from '@hometown/domain';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../core/store.js';
import type { Order } from '../core/types.js';
import { buildOrderDeliveryViews } from './order-read-model.js';
import { orderItemSnapshotName } from './order-service.js';

describe('order product identity snapshot', () => {
  it.each([
    ['番茄', '每份2斤', '番茄 · 每份2斤'],
    [' 番茄 ', ' 番茄 ', '番茄'],
    ['', '历史规格', '历史规格'],
    ['番茄', '', '番茄'],
  ])('keeps product and specification readable without exact duplicates (%s / %s)', (title, specification, expected) => {
    expect(orderItemSnapshotName(title, specification)).toBe(expected);
  });

  it('preserves a historical specification-only name instead of inventing the missing product title', async () => {
    const store = new MemoryStore(false);
    const now = new Date().toISOString();
    await store.saveCatalogSku({ id: 'sku', productId: 'product', name: '现在的规格', retailPriceCents: moneyCents(1500), defaultSellableQuantity: 20, status: 'ACTIVE', product: { id: 'product', title: '现在的商品名称', category: '蔬菜', origin: '测试', imageUrl: null, storageType: 'NORMAL_TEMPERATURE', status: 'ACTIVE' }, createdAt: now, updatedAt: now });
    const historicalOrder: Order = {
      id: 'historical-order', orderNo: 'HISTORICAL-ORDER', userId: 'historical-user', campaignId: 'historical-campaign', serviceAreaId: 'area', pickupPointId: 'point', deliveryPlanId: 'plan', status: 'PENDING_PAYMENT', totalCents: moneyCents(1500), createdAt: now, expiresAt: now, paidAt: null, pickedUpAt: null,
      items: [{ orderLineId: null, skuId: 'sku', productId: 'product', name: '一份', imageUrl: '/historical-product.webp', quantity: 1, unitPriceCents: moneyCents(1500), amountCents: moneyCents(1500), fulfilledQuantity: 0, pickedUpQuantity: 0, exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: moneyCents(0) }],
    };
    const before = structuredClone(historicalOrder);
    const [view] = await buildOrderDeliveryViews(store, [historicalOrder]);
    expect(view!.items[0]!.name).toBe('一份');
    expect(view!.items[0]!.imageUrl).toBe('/historical-product.webp');
    expect(historicalOrder).toEqual(before);
  });

  it("serves saved product images from the order line when the public campaign is absent", async () => {
    const store = new MemoryStore(false);
    const now = new Date().toISOString();
    const order: Order = {
      id: "snapshot-order", orderNo: "SNAPSHOT-ORDER", userId: "user", campaignId: "deleted-campaign", serviceAreaId: "area", pickupPointId: "point", deliveryPlanId: "plan", status: "PENDING_PAYMENT", totalCents: moneyCents(1200), createdAt: now, expiresAt: now, paidAt: null, pickedUpAt: null,
      items: [{ orderLineId: null, skuId: "sku", productId: "product", name: "苹果 · 2斤", imageUrl: "/apple-at-purchase.webp", quantity: 1, unitPriceCents: moneyCents(1200), amountCents: moneyCents(1200), fulfilledQuantity: 0, pickedUpQuantity: 0, exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: moneyCents(0) }],
    };
    await store.saveOrder(order);
    await store.saveOrderLines(order.id, [{ id: "line", catalogSkuId: "sku", productId: "product", title: "苹果 · 2斤", skuName: "苹果 · 2斤", quantity: 1, unitPriceCents: 1200, amountCents: 1200, imageUrl: "/apple-at-purchase.webp" }]);

    const [view] = await buildOrderDeliveryViews(store, [(await store.getOrder(order.id))!]);
    expect(await store.listCampaigns()).toEqual([]);
    expect(view!.items[0]).toMatchObject({ name: "苹果 · 2斤", imageUrl: "/apple-at-purchase.webp" });
  });
});
