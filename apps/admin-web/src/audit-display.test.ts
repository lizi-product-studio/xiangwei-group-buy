import { describe, expect, it } from "vitest";
import { formatAuditTime, resolveAuditActor, shortAuditId } from "./audit-display.ts";

describe("audit display", () => {
  it("keeps technical identifiers secondary and readable", () => {
    expect(shortAuditId("81167fc4-599d-4fc3-aff3-4225f633c5b6")).toBe("81167fc4…c5b6");
    expect(shortAuditId("short-id")).toBe("short-id");
  });

  it("formats timestamps for an operations user", () => {
    expect(formatAuditTime("2026-09-03T04:00:07.553Z")).toMatch(/^2026-09-03 \d{2}:00:07$/);
  });

  it("uses the staff display name when available", () => {
    expect(resolveAuditActor("user-1", [{
      userId: "user-1",
      staffNo: "ADMIN-001",
      displayName: "系统管理员",
      phone: "19900000000",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      pickupPointIds: [],
      createdAt: "2026-09-03T00:00:00Z",
    }])).toEqual({ name: "系统管理员", secondary: "ADMIN-001" });
  });
});
