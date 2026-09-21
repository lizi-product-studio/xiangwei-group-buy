import { describe, expect, it, vi } from "vitest";
import type { CommerceStore } from "../core/store.js";
import type { FulfillmentException, Order, PartialRefund } from "../core/types.js";
import { exceptionRefundFacts, orderRefundFacts } from "./refund-readmodel.js";

const exception = {id: "exception", items: []} as unknown as FulfillmentException;
const order = {id: "order", totalCents: 1200} as unknown as Order;
const storeWith = (overrides: Partial<CommerceStore>) => ({
  listPartialRefundsByException: vi.fn(async () => []),
  listFulfillmentAllocations: vi.fn(async () => []),
  getOrder: vi.fn(async () => order),
  ...overrides,
} as unknown as CommerceStore);

describe("refund read model", () => {
  it("values only the remaining allocated quantity", async () => {
    const store = storeWith({
      listFulfillmentAllocations: vi.fn(async () => [{exceptionQuantity: 3, refundedQuantity: 1, orderId: "order", orderLineId: "line"}]),
      getOrder: vi.fn(async () => ({...order, items: [{orderLineId: "line", unitPriceCents: 1200}]} as unknown as Order)),
    });
    await expect(exceptionRefundFacts(store, exception)).resolves.toMatchObject({refundAmountCents: 2400, refundAmountKind: "PENDING"});
  });
  it("prefers recorded amounts and does not collapse mixed statuses to success", async () => {
    const recorded = [{amountCents: 1200, status: "SUCCEEDED"}, {amountCents: 600, status: "PROCESSING"}] as PartialRefund[];
    const facts = await exceptionRefundFacts(storeWith({listPartialRefundsByException: vi.fn(async () => recorded)}), exception);
    expect(facts).toMatchObject({refundAmountCents: 1800, refundAmountKind: "RECORDED", refundStatus: "PROCESSING"});
  });
  it("rejects missing, zero, and overflowing facts", async () => {
    await expect(exceptionRefundFacts(storeWith({}), exception)).resolves.toMatchObject({refundAmountCents: null});
    const zero = await exceptionRefundFacts(storeWith({listPartialRefundsByException: vi.fn(async () => [{amountCents: 0, status: "SUCCEEDED"} as PartialRefund])}), exception);
    expect(zero.refundAmountCents).toBeNull();
    const overflow = await exceptionRefundFacts(storeWith({listPartialRefundsByException: vi.fn(async () => [{amountCents: Number.MAX_SAFE_INTEGER, status: "SUCCEEDED"}, {amountCents: 1, status: "SUCCEEDED"}] as PartialRefund[])}), exception);
    expect(overflow.refundAmountCents).toBeNull();
    expect(orderRefundFacts(order, null).refundAmountCents).toBe(1200);
  });
});
