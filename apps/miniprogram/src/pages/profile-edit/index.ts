import { api, AuthExpiredError, customerAuth, customerErrorMessage } from "../../utils/api";
import { navigateToCustomerLogin } from "../../utils/auth-navigation";
import { PageActionCoordinator, type PageActionGuard } from "../../utils/page-action-coordinator";
import { PageLoadCoordinator } from "../../utils/page-load-guard";

const loadCoordinator = new PageLoadCoordinator();
const actionCoordinator = new PageActionCoordinator();
const initialShows = new WeakSet<object>();
const visiblePages = new WeakSet<object>();
const pendingProfileMutations = new WeakMap<object, Promise<unknown>>();

function shouldRecoverMutationExpiry(page: object, error: AuthExpiredError, action: PageActionGuard, mutation?: Promise<unknown>): boolean {
  return Boolean(mutation && pendingProfileMutations.get(page) === mutation && visiblePages.has(page) &&
    error.sessionWasCleared && error.requestEpoch === action.epoch &&
    customerAuth.captureSessionEpoch() === action.epoch + 1);
}

function emptyProfileData() {
  return {
    profileLoaded: false,
    displayName: "",
    avatarRef: "",
    phoneNumber: "",
    profileVersion: 0,
  };
}

Page({
  data: { loading: true, saving: false, error: "", nameDirty: false, ...emptyProfileData() },
  onLoad() { void this.loadProfile(); },
  onShow() {
    loadCoordinator.show();
    actionCoordinator.activate();
    visiblePages.add(this);
    if (!initialShows.has(this)) { initialShows.add(this); return; }
    if (!customerAuth.isLoggedIn()) {
      pendingProfileMutations.delete(this);
      void this.loadProfile();
      return;
    }
    if (pendingProfileMutations.has(this)) {
      this.setData({ loading: true, saving: false, error: "" });
      return;
    }
    void this.loadProfile();
  },
  onHide() {
    visiblePages.delete(this);
    loadCoordinator.hide();
    actionCoordinator.invalidate();
    this.setData({ loading: false, saving: false });
  },
  onUnload() { visiblePages.delete(this); loadCoordinator.unload(); actionCoordinator.invalidate(); },
  async loadProfile() {
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    this.setData({ loading: true, error: "" });
    if (!customerAuth.isLoggedIn()) {
      this.setData({ loading: false, nameDirty: false, ...emptyProfileData() });
      navigateToCustomerLogin("profile", "/pages/profile/index");
      return;
    }
    try {
      const profile = await api.getMyProfile();
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return;
      const savedName = profile.displayName ?? "";
      const keepDraftName = this.data.nameDirty && this.data.displayName !== savedName;
      this.setData({ profileLoaded: true, displayName: keepDraftName ? this.data.displayName : savedName, nameDirty: keepDraftName, avatarRef: profile.avatarUrl ?? "", phoneNumber: profile.phoneNumber ?? "未绑定手机号", profileVersion: profile.profileVersion, loading: false });
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError &&
        error.sessionWasCleared &&
        error.requestEpoch === loadGuard.epoch &&
        customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      if (error instanceof AuthExpiredError) {
        if (!ownExpiry || !loadCoordinator.isLive(loadGuard)) return;
        this.setData({ loading: false, error: "", nameDirty: false, ...emptyProfileData() });
        navigateToCustomerLogin("profile", "/pages/profile/index");
        return;
      }
      this.setData({ loading: false, error: customerErrorMessage(error, "资料加载失败，请稍后重试") });
    } finally {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ loading: false });
    }
  },
  onNameInput(event: WechatMiniprogram.Input) { this.setData({ displayName: event.detail.value, nameDirty: true }); },
  async saveProfile() {
    const displayName = this.data.displayName.trim();
    if (!displayName) { this.setData({ error: "请输入姓名" }); return; }
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const current = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    if (!current()) return;
    this.setData({ saving: true, error: "" });
    let mutation: Promise<unknown> | undefined;
    try {
      const request = api.updateMyProfile({ displayName, avatarUrl: this.data.avatarRef || null, expectedVersion: this.data.profileVersion });
      mutation = request;
      pendingProfileMutations.set(this, request);
      const profile = await request;
      if (!current()) return;
      this.setData({ profileVersion: profile.profileVersion, displayName: profile.displayName ?? displayName, nameDirty: false, avatarRef: profile.avatarUrl ?? this.data.avatarRef });
      void wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!shouldRecoverMutationExpiry(this, error, action, mutation)) return;
        this.setData({ loading: false, saving: false, error: "", nameDirty: false, ...emptyProfileData() });
        navigateToCustomerLogin("profile", "/pages/profile/index");
        return;
      }
      if (current()) this.setData({ error: customerErrorMessage(error, "保存失败，请刷新后重试") });
    } finally {
      if (mutation && pendingProfileMutations.get(this) === mutation) pendingProfileMutations.delete(this);
      if (current()) this.setData({ saving: false });
      else if (visiblePages.has(this) && customerAuth.isLoggedIn()) void this.loadProfile();
    }
  },
  async authorizePhone(event: WechatMiniprogram.ButtonGetPhoneNumber) {
    const code = event.detail?.code;
    if (event.detail?.errMsg !== "getPhoneNumber:ok" || !code) {
      const detail = event.detail as { errMsg?: string; errno?: number } | undefined;
      const message = detail?.errMsg ?? "";
      const error = detail?.errno === 1400001
        ? "手机号服务暂不可用，请稍后再试或联系平台"
        : /deny|cancel/i.test(message)
          ? "本次更换已取消，原手机号未变更"
          : "未能获取本次更换所需的手机号授权，原手机号未变更，请重试";
      this.setData({ error });
      return;
    }
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const current = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    if (!current()) return;
    this.setData({ saving: true, error: "" });
    let mutation: Promise<unknown> | undefined;
    try {
      const request = api.rebindMyPhone(code, this.data.profileVersion);
      mutation = request;
      pendingProfileMutations.set(this, request);
      const profile = await request;
      if (!current()) return;
      this.setData({ profileVersion: profile.profileVersion, phoneNumber: profile.phoneNumber ?? "已绑定" });
      void wx.showToast({ title: "手机号已更新", icon: "success" });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!shouldRecoverMutationExpiry(this, error, action, mutation)) return;
        this.setData({ loading: false, saving: false, error: "", nameDirty: false, ...emptyProfileData() });
        navigateToCustomerLogin("profile", "/pages/profile/index");
        return;
      }
      if (current()) this.setData({ error: customerErrorMessage(error, "手机号更新失败，请稍后重试") });
    } finally {
      if (mutation && pendingProfileMutations.get(this) === mutation) pendingProfileMutations.delete(this);
      if (current()) this.setData({ saving: false });
      else if (visiblePages.has(this) && customerAuth.isLoggedIn()) void this.loadProfile();
    }
  },
});
