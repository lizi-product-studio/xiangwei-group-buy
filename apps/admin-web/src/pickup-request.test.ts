import { describe, expect, it } from "vitest";
import {
  beginPickupRequest,
  clearPickupRequest,
  getPendingPickupRequest,
  isTerminalPickupError,
  mapPickupRequestItemsToOrder,
  markPickupRequestConfirmed,
} from "./pickup-request.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  public removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("point-workbench pickup request persistence", () => {
  it("restores the original operation after a committed response is lost and never replaces its ID when quantities change", () => {
    const storage = new MemoryStorage();
    const base = {
      orderId: "order-1",
      deliveryPlanId: "plan-1",
      items: [{ catalogSkuId: "sku-a", quantity: 1 }],
    };
    const first = beginPickupRequest(
      storage,
      base,
      () => "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    );
    expect(getPendingPickupRequest(storage, base)).toEqual({
      ...first,
      pickupRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(
      beginPickupRequest(
        storage,
        base,
        () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ),
    ).toEqual({
      ...first,
      pickupRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const changedInput = {
      ...base,
      items: [{ catalogSkuId: "sku-a", quantity: 2 }],
    };
    expect(() =>
      beginPickupRequest(
        storage,
        changedInput,
        () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ),
    ).toThrow("存在结果未确认的领取");
    expect(getPendingPickupRequest(storage, base)?.items).toEqual(base.items);
    markPickupRequestConfirmed(storage, first);
    expect(() => beginPickupRequest(storage, base)).toThrow("领取已确认");
    clearPickupRequest(storage, base);
    expect(
      beginPickupRequest(
        storage,
        changedInput,
        () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ).pickupRequestId,
    ).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("only clears IDs for explicit terminal business failures", () => {
    expect(
      isTerminalPickupError({ statusCode: 400, code: "VALIDATION_ERROR" }),
    ).toBe(true);
    expect(
      isTerminalPickupError({ statusCode: 409, code: "IDEMPOTENCY_CONFLICT" }),
    ).toBe(true);
    expect(
      isTerminalPickupError({ statusCode: 408, code: "VALIDATION_ERROR" }),
    ).toBe(false);
    expect(
      isTerminalPickupError({ statusCode: 425, code: "VALIDATION_ERROR" }),
    ).toBe(false);
    expect(
      isTerminalPickupError({ statusCode: 429, code: "VALIDATION_ERROR" }),
    ).toBe(false);
    expect(
      isTerminalPickupError({
        statusCode: 409,
        code: "CONCURRENT_MODIFICATION",
      }),
    ).toBe(false);
    expect(
      isTerminalPickupError({
        statusCode: 503,
        code: "EXTERNAL_SERVICE_ERROR",
      }),
    ).toBe(false);
  });

  it("maps a restored sorted subset by SKU rather than by the order row index", () => {
    const orderItems = [
      { skuId: "sku-z", remainingPickupQuantity: 0 },
      { skuId: "sku-a", remainingPickupQuantity: 2 },
    ];
    expect(
      mapPickupRequestItemsToOrder(orderItems, [
        { catalogSkuId: "sku-a", quantity: 1 },
      ]),
    ).toEqual([
      { catalogSkuId: "sku-z", quantity: 0 },
      { catalogSkuId: "sku-a", quantity: 1 },
    ]);
  });
});
