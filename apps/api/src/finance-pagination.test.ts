import { describe, expect, it } from "vitest";
import { MemoryStore } from "./modules/core/store.js";
import type { LedgerTransaction, Order, OrderRefund, PartialRefund } from "./modules/core/types.js";

const date = "2026-09-30T00:00:00.000Z";

describe("bounded finance history pages", () => {
  it("keeps full refunds before partial refunds for equal timestamps and preserves filtered totals across cursors", async () => {
    const store = new MemoryStore(false);
    await store.saveOrderRefund({ id: "full-1", orderId: "order-1", createdAt: date, status: "SUCCEEDED", amountCents: 100 } as OrderRefund);
    await store.savePartialRefund({ id: "partial-1", orderId: "order-1", createdAt: date, status: "FAILED", amountCents: 20 } as PartialRefund);
    await store.saveOrderRefund({ id: "full-2", orderId: "order-2", createdAt: "2026-09-29T00:00:00.000Z", status: "FAILED", amountCents: 200 } as OrderRefund);
    await store.saveOrder({ id: "order-1", orderNo: "GB-1001" } as Order);
    await store.saveOrderRefund({ id: "full-search", orderId: "order-3", providerRefundNo: "RF-1003", createdAt: "2026-09-28T00:00:00.000Z", status: "MANUAL_HOLD", amountCents: 50 } as OrderRefund);
    await store.saveOrder({ id: "order-3", orderNo: "GB-1003" } as Order);
    const first = await store.listFinanceRefundPage({ limit: 1 });
    expect(first.items.map(value => [value.id, value.refundType])).toEqual([["full-1", "FULL"]]);
    expect(first.total).toBe(4);
    const second = await store.listFinanceRefundPage({ limit: 1, ...(first.nextCursor ? { cursor: first.nextCursor } : {}) });
    expect(second.items.map(value => [value.id, value.refundType])).toEqual([["partial-1", "PARTIAL"]]);
    expect(second.total).toBe(4);
    expect((await store.listFinanceRefundPage({ limit: 10, status: "FAILED", orderId: "order-1" })).items.map(value => value.id)).toEqual(["partial-1"]);
    expect((await store.listFinanceRefundPage({ limit: 10, reference: "GB-1001" })).items.map(value => value.id).sort()).toEqual(["full-1", "partial-1"]);
    expect((await store.listFinanceRefundPage({ limit: 10, reference: "GB-1003" })).items.map(value => value.id)).toEqual(["full-search"]);
    expect((await store.listFinanceRefundPage({ limit: 10, reference: "RF-1003" })).items.map(value => value.id)).toEqual(["full-search"]);
  });

  it("bounds ledger pages and filters by exact reference while keeping stable order", async () => {
    const store = new MemoryStore(false);
    const entry = (id: string, referenceId: string, createdAt: string) => ({
      id, referenceId, referenceType: "ORDER", eventType: `PAYMENT_SUCCEEDED_${id}`, createdAt, lines: [],
    }) as LedgerTransaction;
    await store.appendLedgerTransaction(entry("l-1", "order-1", date));
    await store.appendLedgerTransaction(entry("l-2", "order-1", "2026-09-29T00:00:00.000Z"));
    await store.appendLedgerTransaction(entry("l-3", "order-2", date));
    const first = await store.listFinanceLedgerPage({ limit: 1, referenceId: "order-1" });
    expect(first.items.map(value => value.id)).toEqual(["l-1"]);
    expect(first.total).toBe(2);
    const second = await store.listFinanceLedgerPage({ limit: 1, referenceId: "order-1", ...(first.nextCursor ? { cursor: first.nextCursor } : {}) });
    expect(second.items.map(value => value.id)).toEqual(["l-2"]);
    expect(second.total).toBe(2);
  });
});
