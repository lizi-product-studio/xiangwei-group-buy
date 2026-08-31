import { describe, expect, it } from "vitest";
import {
  authStatusText,
  initialAuthState,
  reduceAuthState,
} from "./auth-state";

describe("consumer login state machine", () => {
  it("requires consent before entering the authenticating state", () => {
    const waiting = reduceAuthState(initialAuthState, {
      type: "CONSENT_CHANGED",
      accepted: true,
    });
    expect(waiting).toMatchObject({
      status: "AWAITING_CONSENT",
      privacyAccepted: true,
    });
    const authenticating = reduceAuthState(waiting, { type: "LOGIN_STARTED" });
    expect(authenticating.status).toBe("AUTHENTICATING");
    expect(authStatusText(authenticating.status)).toContain("微信");
  });

  it("keeps a failed attempt retryable and never authenticates on cancel", () => {
    const failed = reduceAuthState(
      reduceAuthState(initialAuthState, {
        type: "CONSENT_CHANGED",
        accepted: true,
      }),
      { type: "LOGIN_FAILED", message: "网络连接失败" },
    );
    expect(failed).toMatchObject({ status: "ERROR", error: "网络连接失败" });
    expect(
      reduceAuthState(failed, { type: "LOGIN_CANCELLED" }),
    ).toMatchObject({ status: "SIGNED_OUT", privacyAccepted: true, error: "" });
  });

  it("clears consent and transient error when a session expires or logs out", () => {
    const authenticated = reduceAuthState(initialAuthState, {
      type: "LOGIN_SUCCEEDED",
    });
    expect(
      reduceAuthState(authenticated, { type: "SESSION_EXPIRED" }),
    ).toEqual(initialAuthState);
    expect(
      reduceAuthState(
        { ...authenticated, error: "旧错误" },
        { type: "LOGGED_OUT" },
      ),
    ).toEqual(initialAuthState);
  });
});
