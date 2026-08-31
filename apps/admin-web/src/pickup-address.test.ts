import { describe, expect, it } from "vitest";
import {
  isPickupAddressPlaceholder,
  resolvePickupAddress,
  composePickupAddress,
  pickupSearchQuery,
} from "./pickup-address.ts";

describe("pickup address from map selection", () => {
  it("prefers reverse geocode, then a real typed address", () => {
    expect(
      resolvePickupAddress({
        reverseAddress: "北京市西城区西便门内大街 1 号",
        typed: "望京",
      }),
    ).toBe("北京市西城区西便门内大街 1 号");
    expect(
      resolvePickupAddress({
        typed: "望京SOHO塔3",
      }),
    ).toBe("望京SOHO塔3");
  });

  it("does not invent a city placeholder when reverse geocode is empty", () => {
    expect(resolvePickupAddress({ typed: "杭州（地图选点）" })).toBe("");
    expect(resolvePickupAddress({})).toBe("");
    expect(isPickupAddressPlaceholder("深圳（地图选点）")).toBe(true);
  });

  it("prefixes a short street address with the selected region", () => {
    expect(composePickupAddress("北京市朝阳区", "朝阳北路101号大悦城B1层")).toBe(
      "北京市朝阳区朝阳北路101号大悦城B1层",
    );
    expect(
      composePickupAddress("北京市朝阳区", "北京市朝阳区朝阳北路101号"),
    ).toBe("北京市朝阳区朝阳北路101号");
  });

  it("biases place search with the selected region", () => {
    expect(pickupSearchQuery("北京市朝阳区", "大悦城")).toBe(
      "北京市朝阳区大悦城",
    );
    expect(pickupSearchQuery("北京市朝阳区", "北京市朝阳区大悦城")).toBe(
      "北京市朝阳区大悦城",
    );
  });
});
