import { describe, expect, it } from "vitest";
import { isPickupLocationSubmissionBlocked } from "./pickup-location-picker.tsx";

describe("pickup location submission guard", () => {
  it("blocks a new or changed location until reverse confirmation succeeds", () => {
    expect(isPickupLocationSubmissionBlocked(true, "UNCONFIRMED")).toBe(true);
    expect(isPickupLocationSubmissionBlocked(true, "VERIFYING")).toBe(true);
    expect(isPickupLocationSubmissionBlocked(true, "FAILED")).toBe(true);
    expect(isPickupLocationSubmissionBlocked(true, "CONFIRMED")).toBe(false);
  });

  it("keeps a pure non-location edit available when the map is unavailable", () => {
    expect(isPickupLocationSubmissionBlocked(false, "FAILED")).toBe(false);
    expect(isPickupLocationSubmissionBlocked(false, "UNCONFIRMED")).toBe(false);
  });
});
