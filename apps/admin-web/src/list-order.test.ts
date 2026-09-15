import { expect, it } from "vitest";
import { earliestFirst, newestFirst, refundHistory } from "./list-order.ts";

it("orders by creation time across timezones without moving edited records or mutating input", () => {
  const values = [
    { id: "old", createdAt: "2026-09-10T10:00:00Z", updatedAt: "2026-09-20T00:00:00Z" },
    { id: "missing" },
    { id: "new", createdAt: "2026-09-11T12:00:00+08:00" },
    { id: "invalid", createdAt: "invalid" },
  ];
  expect(newestFirst(values).map(v => v.id)).toEqual(["new", "old", "missing", "invalid"]);
  expect(values[0]!.id).toBe("old");
  expect(earliestFirst(values, v => v.createdAt).map(v => v.id)).toEqual(["old", "new", "missing", "invalid"]);
});

it("interleaves full and partial refunds chronologically before pagination", () => {
  const refund = (id: string, createdAt: string) => ({id, createdAt, orderId: "order", providerRefundNo: id, amountCents: 100, status: "SUCCEEDED"});
  const result = refundHistory({ full: [refund("full", "2026-09-10T00:00:00Z")], partial: [refund("partial", "2026-09-11T00:00:00Z")] });
  expect(result.map(v => [v.id, v.refundType])).toEqual([["partial", "部分退款"], ["full", "整单退款"]]);
  expect(refundHistory(null)).toEqual([]);
});
