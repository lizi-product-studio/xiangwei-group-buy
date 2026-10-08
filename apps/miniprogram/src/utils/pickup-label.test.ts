import { describe, expect, it } from "vitest";
import { compactPickupAddress } from "./pickup-label";

const example = "河北省保定市定兴县定兴镇河北定兴第三中学";

describe("compactPickupAddress", () => {
  it("hides the approved real short-name/full-name example without modifying its source", () => {
    expect(compactPickupAddress("定兴三中自提点", example)).toBe("");
    expect(example).toBe("河北省保定市定兴县定兴镇河北定兴第三中学");
    expect(compactPickupAddress("定兴三中", "定兴三中")).toBe("");
    expect(compactPickupAddress("定兴三中", "河北省保定市定兴县定兴三中")).toBe("");
    expect(compactPickupAddress("松林社区自提点", "松林社区")).toBe("");
  });

  it("retains all entrance, building, house-number and extra location information", () => {
    for (const detail of ["西门 1 号楼 102 室", "人民路88号", "东门右侧服务站", "北校区", "旁边便利店", "北侧楼栋和入口说明".repeat(30)]) {
      expect(compactPickupAddress("定兴三中自提点", `${example}${detail}`)).toBe(detail);
    }
    expect(compactPickupAddress("松林社区", "松林社区北门取货点，2号楼门卫室")).toBe("北门取货点，2号楼门卫室");
  });

  it("normalizes numeric ordinals without mixing school numbers or localities", () => {
    expect(compactPickupAddress("河源三中自提点", "河源第3中学")).toBe("");
    expect(compactPickupAddress("河源十二中自提点", "河源第12中学")).toBe("");
    expect(compactPickupAddress("临海十二中自提点", "浙江省台州市浙江临海第十二中学")).toBe("");
    expect(compactPickupAddress("河源三中自提点", "河源第103中学")).toBe("河源第103中学");
    for (const address of ["河源第十三中学", "河源第三十中学", "河源第二中学", "河源县实验第三中学", "东河源第三中学", "河源三中附属小学"]) {
      expect(compactPickupAddress("河源三中自提点", address)).toBe(address);
    }
  });

  it("keeps uncertain prefixes, unfamiliar aliases and separate addresses", () => {
    for (const address of ["人民路88号定兴第三中学", "定兴第三中学西门对面小学", "河北定兴第三中学", "另一服务站附近定兴第三中学"]) {
      const expected = address === "定兴第三中学西门对面小学" ? "西门对面小学" : address;
      expect(compactPickupAddress("定兴三中自提点", address)).toBe(expected);
    }
    expect(compactPickupAddress("松林社区", "松林路 8 号院内便利店旁")).toBe("松林路 8 号院内便利店旁");
    expect(compactPickupAddress("", "河北省定兴县人民路 88 号")).toBe("河北省定兴县人民路 88 号");
    expect(compactPickupAddress("定兴三中", "  ")).toBe("");
    expect(compactPickupAddress(undefined, undefined)).toBe("");
    expect(compactPickupAddress("自提点", "自提点旁便利店")).toBe("自提点旁便利店");
  });
});
