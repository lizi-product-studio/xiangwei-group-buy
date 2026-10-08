import { describe, expect, it } from "vitest";
import { MemoryStore } from "../core/store.js";
import type { Order, OrderRefund } from "../core/types.js";
import { calculateNetSalesQuantities } from "./catalog-sales.js";

const now = "2026-09-23T00:00:00.000Z";
const order = (id: string, status: Order["status"], quantity: number, refundedQuantity = 0): Order => ({
  id,
  orderNo: id,
  userId: "user",
  campaignId: `campaign-${id}`,
  serviceAreaId: "area",
  pickupPointId: "point",
  deliveryPlanId: "plan",
  status,
  totalCents: 1000,
  items: [{
    orderLineId: `${id}-line`, skuId: "sku", productId: "product", name: "商品", quantity,
    unitPriceCents: 100, amountCents: quantity * 100, fulfilledQuantity: quantity,
    pickedUpQuantity: 0, exceptionQuantity: refundedQuantity, refundedQuantity, refundedAmountCents: refundedQuantity * 100,
  }],
  createdAt: now,
  expiresAt: now,
  paidAt: now,
  pickedUpAt: null,
});

describe("catalog net sales", () => {
  it("counts paid quantities across campaigns and subtracts partial/full successful refunds", async () => {
    const store = new MemoryStore(false);
    await store.saveOrder(order("paid", "COMPLETED", 5));
    await store.saveOrder(order("partial", "COMPLETED", 4, 2));
    const fullyRefunded = order("full", "REFUNDING", 3);
    await store.saveOrder(fullyRefunded);
    const refund: OrderRefund = {
      id: "refund", orderId: fullyRefunded.id, paymentId: "payment", providerRefundNo: "refund-no",
      providerRefundId: "provider-refund", status: "SUCCEEDED", amountCents: 300,
      createdAt: now, submissionLeaseUntil: null, submissionClaimToken: null,
    };
    await store.saveOrderRefund(refund);
    await store.saveOrder(order("cancelled", "CANCELLED", 99));
    expect((await calculateNetSalesQuantities(store)).get("sku")).toBe(7);
  });

  it("uses one bulk refund read instead of one lookup per order", async () => {
    class CountingStore extends MemoryStore {
      public aggregateReads = 0;
      public override async getNetSalesQuantities(campaignId?: string) { this.aggregateReads += 1; return super.getNetSalesQuantities(campaignId); }
    }
    const store = new CountingStore(false);
    for (let index = 0; index < 20; index += 1) await store.saveOrder(order(`order-${index}`, "COMPLETED", 1));
    await calculateNetSalesQuantities(store);
    expect(store.aggregateReads).toBe(1);
  });
});
