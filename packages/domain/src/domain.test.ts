import { describe, expect, it } from "vitest";
import {
  allocateMoney,
  moneyCents,
  transitionCampaign,
  transitionOrder,
} from "./index.js";

describe("money", () => {
  it("uses largest remainder allocation without losing one cent", () => {
    const allocated = allocateMoney(moneyCents(10), [1, 1, 1]);
    expect(allocated).toEqual([4, 3, 3]);
    expect(allocated.reduce((sum, item) => sum + item, 0)).toBe(10);
  });

  it("rejects floating-point amounts", () => {
    expect(() => moneyCents(1.2)).toThrow("金额必须是非负安全整数");
  });
});

describe("state machines", () => {
  it("allows the normal campaign and order path", () => {
    expect(transitionCampaign("OPEN", "CLOSING")).toBe("CLOSING");
    expect(transitionOrder("PENDING_PAYMENT", "PAID_WAITING_CLOSE")).toBe(
      "PAID_WAITING_CLOSE",
    );
  });

  it("blocks skipping fulfillment states", () => {
    expect(() => transitionOrder("PAID_WAITING_CLOSE", "COMPLETED")).toThrow(
      "订单状态不能",
    );
  });
});
