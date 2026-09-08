import {
  clearAuthIntent,
  clearCancelReturnSuppression,
  createAuthIntent,
  isTabReturnUrl,
  readAuthIntent,
  saveAuthIntent,
  saveCancelReturnSuppression,
  isValidAuthReturnUrl,
  isValidWriteAction,
  type AuthIntentSource,
  type AuthWriteAction,
} from "./auth-intent";

let loginNavigationPending: symbol | null = null;

export function navigateToCustomerLogin(
  source: AuthIntentSource,
  returnUrl: string,
  writeAction?: AuthWriteAction,
): void {
  // Validate the caller's route before normalizing it. Normalizing an unsafe
  // value to the profile page would otherwise turn an invalid protected
  // destination into a seemingly valid login intent.
  if (!isValidAuthReturnUrl(source, returnUrl) || !isValidWriteAction(source, writeAction)) {
    clearAuthIntent();
    clearCancelReturnSuppression();
    void wx.showToast({ title: "登录入口已失效，请从我的重新进入", icon: "none" });
    void wx.switchTab({ url: "/pages/profile/index" });
    return;
  }
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  if (loginNavigationPending || pages[pages.length - 1]?.route === "pages/login/index") return;
  const normalizedReturnUrl = returnUrl;
  const existing = readAuthIntent();
  const intent = existing && existing.source === source && existing.returnUrl === normalizedReturnUrl && existing.writeAction === writeAction
    ? existing
    : createAuthIntent(source, normalizedReturnUrl, writeAction);
  saveAuthIntent(intent);
  const navigationId = Symbol("login-navigation");
  loginNavigationPending = navigationId;
  const release = () => { if (loginNavigationPending === navigationId) loginNavigationPending = null; };
  try {
    wx.navigateTo({
      url: `/pages/login/index?source=${encodeURIComponent(intent.source)}`,
      complete: release,
    });

  } catch {
    release();
    void wx.showToast({ title: "暂时无法打开登录页，请重试", icon: "none" });
  }
}

export function finishCustomerLogin(): void {
  const intent = readAuthIntent();
  clearAuthIntent();
  clearCancelReturnSuppression();
  const validIntent = Boolean(intent &&
    isValidAuthReturnUrl(intent.source, intent.returnUrl) &&
    isValidWriteAction(intent.source, intent.writeAction));
  const returnUrl = validIntent ? intent!.returnUrl : "/pages/profile/index";
  if (!validIntent)
    void wx.showToast({ title: "登录信息已失效，请重新进入", icon: "none" });
  if (isTabReturnUrl(returnUrl)) {
    void wx.switchTab({ url: returnUrl.split("?", 1)[0] ?? returnUrl });
    return;
  }
  void wx.redirectTo({ url: returnUrl });
}

export function cancelCustomerLogin(now = Date.now()): void {
  // Keep the intent while returning to the protected page. A later login
  // attempt replaces it; explicit logout/401 session boundaries clear it.
  const intent = readAuthIntent(now);
  if (intent && isValidAuthReturnUrl(intent.source, intent.returnUrl) && isValidWriteAction(intent.source, intent.writeAction)) {
    saveCancelReturnSuppression(intent);
    void wx.navigateBack({ delta: 1 });
    return;
  }
  clearAuthIntent();
  clearCancelReturnSuppression();
  void wx.showToast({ title: "登录信息已失效，请重新进入", icon: "none" });
  void wx.switchTab({ url: "/pages/profile/index" });
}
