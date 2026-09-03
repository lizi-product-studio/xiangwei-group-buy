import { PRIVACY_NOTICE_VERSION } from "../../config/legal";
import {
  readAuthIntent,
  sourceText,
  type AuthIntentSource,
} from "../../utils/auth-intent";
import {
  authStatusText,
  initialAuthState,
  reduceAuthState,
  type AuthState,
} from "../../utils/auth-state";
import { cancelCustomerLogin, finishCustomerLogin } from "../../utils/auth-navigation";
import { customerAuth, customerErrorMessage } from "../../utils/api";

function loginError(error: unknown): string {
  return customerErrorMessage(error, "微信登录暂时未完成，请检查网络后重试");
}

Page({
  data: {
    status: initialAuthState.status,
    privacyAccepted: initialAuthState.privacyAccepted,
    privacyError: "",
    error: "",
    privacyVersion: PRIVACY_NOTICE_VERSION,
    source: "profile" as AuthIntentSource,
    sourceText: "个人服务",
    statusText: authStatusText(initialAuthState.status),
    loggedIn: false,
    demoLoginAvailable: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const intent = readAuthIntent();
    const source = (intent?.source ?? options.source ?? "profile") as AuthIntentSource;
    const demoLoginAvailable = customerAuth.isDemoLoginAvailable();
    this.setData({
      source,
      sourceText: sourceText(source),
      demoLoginAvailable,
    });
  },

  onShow() {
    this.setData({ demoLoginAvailable: customerAuth.isDemoLoginAvailable() });
    if (customerAuth.isLoggedIn()) {
      this.setData({
        ...this.stateData({ type: "LOGIN_SUCCEEDED" }),
        loggedIn: true,
      });
    }
  },

  stateData(event: Parameters<typeof reduceAuthState>[1]): AuthState & { statusText: string } {
    const current: AuthState = {
      status: this.data.status,
      privacyAccepted: this.data.privacyAccepted,
      error: this.data.error,
    };
    const next = reduceAuthState(current, event);
    return { ...next, statusText: authStatusText(next.status) };
  },

  changePrivacy(event: WechatMiniprogram.CheckboxGroupChange) {
    const accepted = event.detail.value.includes("accepted");
    this.setData({
      ...this.stateData({ type: "CONSENT_CHANGED", accepted }),
      privacyError: "",
    });
  },

  async login() {
    if (this.data.status === "AUTHENTICATING") return;
    if (!this.data.privacyAccepted) {
      this.setData({
        privacyError: "请先勾选并同意用户服务协议和隐私说明",
        ...this.stateData({ type: "CONSENT_CHANGED", accepted: false }),
      });
      return;
    }
    this.setData({
      ...this.stateData({ type: "LOGIN_STARTED" }),
      privacyError: "",
      loggedIn: false,
    });
    try {
      await customerAuth.loginWechat(PRIVACY_NOTICE_VERSION);
      this.setData({ ...this.stateData({ type: "LOGIN_SUCCEEDED" }), loggedIn: true });
      void wx.showToast({ title: "登录成功", icon: "success" });
      finishCustomerLogin();
    } catch (error) {
      this.setData({
        ...this.stateData({ type: "LOGIN_FAILED", message: loginError(error) }),
        loggedIn: false,
      });
    }
  },

  async experienceLogin() {
    if (!this.data.demoLoginAvailable || this.data.status === "AUTHENTICATING") return;
    if (!this.data.privacyAccepted) {
      this.setData({
        privacyError: "请先勾选并同意用户服务协议和隐私说明",
        ...this.stateData({ type: "CONSENT_CHANGED", accepted: false }),
      });
      return;
    }
    this.setData({
      ...this.stateData({ type: "LOGIN_STARTED" }),
      privacyError: "",
      loggedIn: false,
    });
    try {
      // Keep the capability check at the action boundary as well as in the
      // rendered UI. A hidden method invocation must not create a demo
      // session in a trial/release or WeChat deployment.
      if (!customerAuth.isDemoLoginAvailable())
        throw new Error("开发体验登录仅可用于本地开发环境");
      await customerAuth.loginDemo(PRIVACY_NOTICE_VERSION);
      this.setData({ ...this.stateData({ type: "LOGIN_SUCCEEDED" }), loggedIn: true });
      void wx.showToast({ title: "开发体验登录成功", icon: "success" });
      finishCustomerLogin();
    } catch (error) {
      this.setData({
        ...this.stateData({ type: "LOGIN_FAILED", message: loginError(error) }),
        loggedIn: false,
      });
    }
  },

  cancel() {
    this.setData(this.stateData({ type: "LOGIN_CANCELLED" }));
    cancelCustomerLogin();
  },

  openTerms() {
    void wx.navigateTo({ url: "/pages/legal/index?document=terms" });
  },

  openPrivacy() {
    void wx.navigateTo({ url: "/pages/legal/index?document=privacy" });
  },
});
