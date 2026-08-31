import { describe, expect, it } from "vitest";
import { notificationEnableDecision } from "./notification-guard";

describe("notification enable guard", () => {
  it("requires login before considering a busy/proceed state", () => {
    expect(notificationEnableDecision(false, false)).toBe("LOGIN_REQUIRED");
    expect(notificationEnableDecision(false, true)).toBe("LOGIN_REQUIRED");
    expect(notificationEnableDecision(true, true)).toBe("BUSY");
    expect(notificationEnableDecision(true, false)).toBe("PROCEED");
  });
});
