import { describe, expect, it } from "vitest";
import { centsToYuan, validateYuanInput, yuanToCents } from "./money-input.ts";

describe("yuan price input", () => {
  it.each([
    ["0.01", 1],
    ["1", 100],
    ["1.2", 120],
    ["19.90", 1990],
    [" 199.99 ", 19999],
    ["90071992547409.91", 9_007_199_254_740_991],
  ])("converts %s yuan to exact integer cents", (yuan, cents) => {
    expect(yuanToCents(yuan)).toBe(cents);
  });

  it.each(["", "0", "0.00", ".5", "01", "1.", "1.001", "1,000", "-1", "abc"])(
    "rejects unsafe or ambiguous input %s",
    (value) => {
      expect(() => yuanToCents(value)).toThrow();
      expect(validateYuanInput(value)).not.toBeNull();
    },
  );

  it("rejects amounts that cannot be represented as safe integer cents", () => {
    expect(() => yuanToCents("90071992547409.92")).toThrow(
      "售价超出系统可处理范围",
    );
  });

  it("formats API cents for editing without losing precision", () => {
    expect(centsToYuan(1)).toBe("0.01");
    expect(centsToYuan(1_990)).toBe("19.90");
    expect(() => centsToYuan(1.5)).toThrow();
  });
});
