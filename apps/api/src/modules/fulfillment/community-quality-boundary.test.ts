import { afterEach, describe, expect, it, vi } from "vitest";
import { moneyCents } from "@hometown/domain";
import { MemoryStore } from "../core/store.js";
import type { Order } from "../core/types.js";
import { CommunityQualityService } from "./community-quality-service.js";

const receiptAt = "2026-08-21T08:00:00.000Z";

async function fixture(): Promise<MemoryStore> {
  const store = new MemoryStore(false);
  const order: Order = {
    id: "order",
    orderNo: "ORDER-1",
    userId: "customer",
    campaignId: "campaign",
    serviceAreaId: "area",
    pickupPointId: "point",
    deliveryPlanId: "plan",
    status: "READY_FOR_PICKUP",
    totalCents: moneyCents(2000),
    items: [],
    createdAt: receiptAt,
    expiresAt: receiptAt,
    paidAt: receiptAt,
    pickedUpAt: null,
  };
  await store.saveOrder(order);
  await store.saveOrderLines(order.id, [
    {
      id: "line",
      catalogSkuId: "sku",
      productId: "product",
      title: "商品",
      skuName: "一份",
      quantity: 2,
      unitPriceCents: 1000,
      amountCents: 2000,
    },
  ]);
  const line = (await store.listOrderLinesByOrderForUpdate(order.id))[0]!;
  line.fulfilledQuantity = 2;
  line.pickedUpQuantity = 1;
  await store.updateOrderLine(line);
  await store.saveCommunityPickupReceipt({
    id: "receipt",
    orderId: order.id,
    deliveryPlanId: "plan",
    verifierId: "manager",
    requestKey: "request-key",
    pickupRequestId: "00000000-0000-4000-8000-000000000001",
    payloadHash: "payload-hash",
    createdAt: receiptAt,
    items: [
      {
        id: "receipt-item",
        communityPickupReceiptId: "receipt",
        catalogSkuId: "sku",
        quantity: 1,
      },
    ],
  });
  return store;
}

const input = {
  clientRequestId: "00000000-0000-4000-8000-000000000002",
  items: [
    {
      catalogSkuId: "sku",
      quantity: 1,
      reason: "QUALITY_CLAIM" as const,
      description: "商品存在品质问题",
    },
  ],
};

describe("quality window per pickup receipt", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts a partially picked-up item before its own 24-hour deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T07:59:59.999Z"));
    const qualityCase = await new CommunityQualityService(
      await fixture(),
    ).submit("order", "customer", input, "request");
    expect(qualityCase.items).toEqual([
      expect.objectContaining({
        pickupReceiptId: "receipt",
        catalogSkuId: "sku",
        disputedQuantity: 1,
      }),
    ]);
  });

  it("rejects the item exactly 24 hours after that pickup receipt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T08:00:00.000Z"));
    await expect(
      new CommunityQualityService(await fixture()).submit(
        "order",
        "customer",
        input,
        "request",
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});
