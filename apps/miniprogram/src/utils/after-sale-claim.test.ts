import { describe, expect, it } from "vitest";
import { buildClaimRows, validateSelectedClaimRows } from "./after-sale-claim";

describe("after-sale claim rows", () => {
  it("merges split order lines by SKU without losing the claimable quantity", () => {
    expect(buildClaimRows([
      { skuId: "sku-a", name: "土鸡蛋", claimableQuantity: 2 },
      { skuId: "sku-b", name: "酱牛肉", claimableQuantity: 1 },
      { skuId: "sku-a", name: "土鸡蛋", claimableQuantity: 3 },
    ])).toEqual([
      expect.objectContaining({ skuId: "sku-a", maxQuantity: 5, quantity: 5, selected: true }),
      expect.objectContaining({ skuId: "sku-b", maxQuantity: 1, quantity: 1, selected: false }),
    ]);
  });

  it("validates every selected line and returns all valid claim lines", () => {
    const rows = buildClaimRows([
      { skuId: "sku-a", name: "土鸡蛋", claimableQuantity: 2 },
      { skuId: "sku-b", name: "酱牛肉", claimableQuantity: 1 },
    ]).map((row) => ({ ...row, selected: true, description: "商品存在明显异常" }));
    expect(validateSelectedClaimRows(rows)).toEqual({ ok: true, selected: rows });
    expect(validateSelectedClaimRows([{ ...rows[0]!, quantity: 3 }])).toEqual({
      ok: false,
      message: "土鸡蛋数量应为 1 到 2",
    });
  });
});
