/**
 * The login page uses a small explicit state machine so a failed or cancelled
 * WeChat flow never gets mistaken for an authenticated session.
 */
export type AuthStatus =
  | "SIGNED_OUT"
  | "AWAITING_CONSENT"
  | "AUTHENTICATING"
  | "AUTHENTICATED"
  | "ERROR";

export interface AuthState {
  status: AuthStatus;
  privacyAccepted: boolean;
  error: string;
}

export type AuthEvent =
  | { type: "CONSENT_CHANGED"; accepted: boolean }
  | { type: "LOGIN_STARTED" }
  | { type: "LOGIN_SUCCEEDED" }
  | { type: "LOGIN_FAILED"; message: string }
  | { type: "LOGIN_CANCELLED" }
  | { type: "SESSION_EXPIRED" }
  | { type: "LOGGED_OUT" };

export const initialAuthState: AuthState = {
  status: "SIGNED_OUT",
  privacyAccepted: false,
  error: "",
};

export function reduceAuthState(
  state: AuthState,
  event: AuthEvent,
): AuthState {
  switch (event.type) {
    case "CONSENT_CHANGED":
      return {
        ...state,
        privacyAccepted: event.accepted,
        status: event.accepted ? "AWAITING_CONSENT" : "SIGNED_OUT",
        error: "",
      };
    case "LOGIN_STARTED":
      return { ...state, status: "AUTHENTICATING", error: "" };
    case "LOGIN_SUCCEEDED":
      return {
        ...state,
        status: "AUTHENTICATED",
        privacyAccepted: true,
        error: "",
      };
    case "LOGIN_FAILED":
      return { ...state, status: "ERROR", error: event.message };
    case "LOGIN_CANCELLED":
      return { ...state, status: "SIGNED_OUT", error: "" };
    case "SESSION_EXPIRED":
    case "LOGGED_OUT":
      return {
        ...state,
        status: "SIGNED_OUT",
        privacyAccepted: false,
        error: "",
      };
  }
}

export function authStatusText(status: AuthStatus): string {
  switch (status) {
    case "AUTHENTICATING":
      return "正在连接微信…";
    case "AUTHENTICATED":
      return "已登录";
    case "ERROR":
      return "登录未完成";
    case "AWAITING_CONSENT":
      return "请确认协议后继续";
    default:
      return "未登录";
  }
}
