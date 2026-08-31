import { describe, expect, it } from "vitest";
import type { PickupPoint } from "../core/types.js";
import {
  gcj02DistanceMeters,
  hasPickupLocationVerificationTrigger,
  normalizePickupAddress,
} from "./pickup-location-validation.js";

const point = (overrides: Partial<PickupPoint> = {}): PickupPoint => ({
  id: "point-1",
  serviceAreaId: "area-1",
  name: "东门点",
  address: "北京市东城区，东门服务站 1 号",
  businessHours: "09:00-20:00",
  pickupInstructions: "出示领取码",
  latitude: 39.9042001,
  longitude: 116.4074001,
  contactName: "",
  contactPhone: "",
  status: "ACTIVE",
  capacityPerDay: null,
  createdAt: "2026-08-31T00:00:00.000Z",
  ...overrides,
});

describe("pickup location validation primitives", () => {
  it("normalizes NFKC, whitespace and Chinese/ASCII punctuation deterministically", () => {
    expect(normalizePickupAddress(" 北京市　东城区，东门服务站  1 号； ")).toBe(
      "北京市 东城区,东门服务站 1 号",
    );
    expect(normalizePickupAddress("北京市 东城区,东门服务站 1 号,")).toBe(
      "北京市 东城区,东门服务站 1 号",
    );
  });

  it("only triggers on normalized address, six-decimal coordinates or reactivation", () => {
    const before = point({ status: "INACTIVE" });
    expect(
      hasPickupLocationVerificationTrigger(before, {
        ...before,
        address: "北京市东城区,东门服务站 1 号",
      }),
    ).toBe(false);
    expect(
      hasPickupLocationVerificationTrigger(before, {
        ...before,
        latitude: 39.90420049,
      }),
    ).toBe(false);
    expect(
      hasPickupLocationVerificationTrigger(before, {
        ...before,
        latitude: 39.904201,
      }),
    ).toBe(true);
    expect(
      hasPickupLocationVerificationTrigger(before, { ...before, status: "ACTIVE" }),
    ).toBe(true);
    expect(
      hasPickupLocationVerificationTrigger(
        point(),
        { ...point(), status: "INACTIVE" },
      ),
    ).toBe(false);
  });

  it("uses the GCJ-02 Haversine metric for the 50m review prompt", () => {
    expect(gcj02DistanceMeters(point(), point({ longitude: 116.4074 }))).toBeLessThan(
      1,
    );
    expect(
      gcj02DistanceMeters(point(), point({ longitude: 116.4084 })),
    ).toBeGreaterThan(50);
  });
});
