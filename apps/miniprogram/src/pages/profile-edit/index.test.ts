import { beforeEach, describe, expect, it, vi } from "vitest";

type ProfileEditPage = {
  data: Record<string, unknown>;
  setData: (patch: Record<string, unknown>) => void;
  onLoad: () => void;
  onShow: () => void;
  onHide: () => void;
  onNameInput: (event: { detail: { value: string } }) => void;
  saveProfile: () => Promise<void>;
  loadProfile: () => Promise<void>;
  authorizePhone: (event: { detail: { errMsg: string; code?: string } }) => Promise<void>;
};

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}
async function flushPromises() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }

describe("profile editor session recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  async function fixture(options: { loggedIn?: boolean; expired?: boolean; emptyName?: boolean; legacyAvatar?: string } = {}) {
    let epoch = 4;
    let loggedIn = options.loggedIn !== false;
    class ExpiredError extends Error {
      readonly sessionWasCleared: boolean;
      readonly requestEpoch: number;

      constructor(requestEpoch = epoch, sessionWasCleared = true) {
        super("登录已失效，请重新登录");
        this.requestEpoch = requestEpoch;
        this.sessionWasCleared = sessionWasCleared;
      }
    }
    const navigateToCustomerLogin = vi.fn();
    const downloadMyProfileImage = vi.fn();
    const getMyProfile = vi.fn(async () => {
      if (options.expired) {
        epoch += 1;
        throw new ExpiredError(4, true);
      }
      return { displayName: options.emptyName ? "" : "微信用户", avatarUrl: options.legacyAvatar ?? null, phoneNumber: "199****9869", profileVersion: 1 };
    });
    const updateMyProfile = vi.fn(async (payload) => ({ ...payload, profileVersion: 2 }));
    const rebindMyPhone = vi.fn(async () => ({ phoneNumber: "188****0000", profileVersion: 2 }));
    const expireSession = () => {
      const requestEpoch = epoch;
      epoch += 1;
      loggedIn = false;
      return new ExpiredError(requestEpoch, true);
    };
    vi.doMock("../../utils/api", () => ({
      AuthExpiredError: ExpiredError,
      customerErrorMessage: (_error: unknown, fallback: string) => fallback,
      customerAuth: {
        isLoggedIn: () => loggedIn,
        captureSessionEpoch: () => epoch,
      },
      api: {
        getMyProfile,
        downloadMyProfileImage,
        updateMyProfile,
        rebindMyPhone,
      },
    }));
    vi.doMock("../../utils/auth-navigation", () => ({ navigateToCustomerLogin }));
    vi.stubGlobal("wx", { showToast: vi.fn() });
    let page: ProfileEditPage | undefined;
    vi.stubGlobal("Page", (definition: ProfileEditPage) => { page = definition; });
    await import("./index");
    if (!page) throw new Error("profile edit page was not registered");
    page.setData = (patch) => Object.assign(page!.data, patch);
    return { page, navigateToCustomerLogin, downloadMyProfileImage, updateMyProfile, rebindMyPhone, getMyProfile, expireSession };
  }

  it("routes a signed-out visitor through the shared login intent instead of keeping the editor open", async () => {
    const { page, navigateToCustomerLogin } = await fixture({ loggedIn: false });
    await page.loadProfile.call(page);

    expect(navigateToCustomerLogin).toHaveBeenCalledWith("profile", "/pages/profile/index");
    expect(page.data.loading).toBe(false);
  });

  it("clears profile fields and opens login when a stored token receives 401", async () => {
    const { page, navigateToCustomerLogin } = await fixture({ expired: true });
    Object.assign(page.data, { displayName: "旧账号", avatarRef: "old", phoneNumber: "199****9869", profileVersion: 8 });

    await page.loadProfile.call(page);

    expect(navigateToCustomerLogin).toHaveBeenCalledWith("profile", "/pages/profile/index");
    expect(page.data).toMatchObject({ loading: false, displayName: "", avatarRef: "", phoneNumber: "", profileVersion: 0 });
  });

  it("keeps a loaded empty-name profile and bound phone when replacement is cancelled", async () => {
    const { page } = await fixture({ emptyName: true });
    await page.loadProfile();
    await page.authorizePhone({ detail: { errMsg: "getPhoneNumber:fail user deny" } });
    expect(page.data).toMatchObject({ profileLoaded: true, displayName: "", phoneNumber: "199****9869", error: "本次更换已取消，原手机号未变更" });
  });

  it("ignores historical avatars for display and preserves them when saving the name", async () => {
    const legacyAvatar = "/api/v1/profile-images/old.webp";
    const { page, downloadMyProfileImage, updateMyProfile } = await fixture({ legacyAvatar });
    await page.loadProfile();
    expect(downloadMyProfileImage).not.toHaveBeenCalled();
    expect(page.data).toMatchObject({ profileLoaded: true, displayName: "微信用户" });
    page.setData({ displayName: "新的姓名" });
    await page.saveProfile();
    expect(updateMyProfile).toHaveBeenCalledWith({ displayName: "新的姓名", avatarUrl: legacyAvatar, expectedVersion: 1 });
    expect(page.data.profileVersion).toBe(2);
  });

  it("reloads an interrupted profile fetch on return and ignores its stale response", async () => {
    const { page, getMyProfile } = await fixture();
    const stale = deferred<{ displayName: string; avatarUrl: null; phoneNumber: string; profileVersion: number }>();
    const fresh = deferred<{ displayName: string; avatarUrl: null; phoneNumber: string; profileVersion: number }>();
    getMyProfile.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    page.onLoad.call(page);
    page.onShow.call(page);
    page.onHide.call(page);
    page.onShow.call(page);
    expect(getMyProfile).toHaveBeenCalledTimes(2);

    fresh.resolve({ displayName: "最新资料", avatarUrl: null, phoneNumber: "199****9869", profileVersion: 2 });
    await flushPromises();
    stale.resolve({ displayName: "旧响应", avatarUrl: null, phoneNumber: "199****9869", profileVersion: 1 });
    await flushPromises();
    expect(page.data).toMatchObject({ loading: false, displayName: "最新资料", profileVersion: 2 });
  });

  it("rechecks the profile version on return without discarding an unsubmitted name", async () => {
    const { page, getMyProfile } = await fixture();
    page.onLoad.call(page);
    await flushPromises();
    page.onShow.call(page);
    page.onNameInput.call(page, { detail: { value: "未提交姓名" } });
    const refreshed = deferred<{ displayName: string; avatarUrl: null; phoneNumber: string; profileVersion: number }>();
    getMyProfile.mockReturnValueOnce(refreshed.promise);

    page.onHide.call(page);
    page.onShow.call(page);
    expect(getMyProfile).toHaveBeenCalledTimes(2);
    refreshed.resolve({ displayName: "微信用户", avatarUrl: null, phoneNumber: "199****9869", profileVersion: 3 });
    await flushPromises();

    expect(page.data).toMatchObject({ loading: false, saving: false, displayName: "未提交姓名", profileVersion: 3 });
  });

  it("waits for a hidden save to settle, then reloads the authoritative profile version", async () => {
    const { page, getMyProfile, updateMyProfile } = await fixture();
    page.onLoad.call(page);
    await flushPromises();
    page.onShow.call(page);
    page.onNameInput.call(page, { detail: { value: "已提交姓名" } });
    const saveResult = deferred<{ displayName: string; avatarUrl: null; profileVersion: number }>();
    updateMyProfile.mockReturnValueOnce(saveResult.promise);
    getMyProfile.mockResolvedValueOnce({ displayName: "已提交姓名", avatarUrl: null, phoneNumber: "199****9869", profileVersion: 2 });
    const save = page.saveProfile.call(page);
    expect(page.data.saving).toBe(true);
    page.onHide.call(page);
    page.onShow.call(page);
    expect(page.data.loading).toBe(true);
    expect(getMyProfile).toHaveBeenCalledTimes(1);

    saveResult.resolve({ displayName: "已提交姓名", avatarUrl: null, profileVersion: 2 });
    await save;
    await flushPromises();
    expect(getMyProfile).toHaveBeenCalledTimes(2);
    expect(page.data).toMatchObject({ loading: false, saving: false, displayName: "已提交姓名", profileVersion: 2 });
  });

  it.each(["save", "phone"])("recovers login after a hidden %s request returns 401 on show", async (kind) => {
    const { page, navigateToCustomerLogin, updateMyProfile, rebindMyPhone, expireSession } = await fixture();
    page.onLoad.call(page);
    await flushPromises();
    page.onShow.call(page);
    const result = deferred<never>();
    if (kind === "save") {
      page.onNameInput.call(page, { detail: { value: "待保存姓名" } });
      updateMyProfile.mockReturnValueOnce(result.promise);
    } else {
      rebindMyPhone.mockReturnValueOnce(result.promise);
    }
    const action = kind === "save"
      ? page.saveProfile.call(page)
      : page.authorizePhone.call(page, { detail: { errMsg: "getPhoneNumber:ok", code: "phone-code" } });
    page.onHide.call(page);
    page.onShow.call(page);
    expect(page.data.loading).toBe(true);

    result.reject(expireSession());
    await action;
    expect(page.data).toMatchObject({ loading: false, saving: false, profileLoaded: false });
    expect(navigateToCustomerLogin).toHaveBeenCalledOnce();
    expect(navigateToCustomerLogin).toHaveBeenCalledWith("profile", "/pages/profile/index");
  });

  it.each(["save", "phone"])("keeps the existing login recovery for a visible %s request", async (kind) => {
    const { page, navigateToCustomerLogin, updateMyProfile, rebindMyPhone, expireSession } = await fixture();
    page.onLoad.call(page);
    await flushPromises();
    page.onShow.call(page);
    if (kind === "save") {
      updateMyProfile.mockImplementationOnce(async () => { throw expireSession(); });
      await page.saveProfile.call(page);
    } else {
      rebindMyPhone.mockImplementationOnce(async () => { throw expireSession(); });
      await page.authorizePhone.call(page, { detail: { errMsg: "getPhoneNumber:ok", code: "phone-code" } });
    }
    expect(page.data).toMatchObject({ loading: false, saving: false, profileLoaded: false });
    expect(navigateToCustomerLogin).toHaveBeenCalledOnce();
  });

  it("routes to login when a hidden request clears the session before the page returns", async () => {
    const { page, navigateToCustomerLogin, updateMyProfile, expireSession } = await fixture();
    page.onLoad.call(page);
    await flushPromises();
    page.onShow.call(page);
    const result = deferred<never>();
    updateMyProfile.mockReturnValueOnce(result.promise);
    const save = page.saveProfile.call(page);
    page.onHide.call(page);
    result.reject(expireSession());
    await save;
    expect(navigateToCustomerLogin).not.toHaveBeenCalled();

    page.onShow.call(page);
    await flushPromises();
    expect(page.data.loading).toBe(false);
    expect(navigateToCustomerLogin).toHaveBeenCalledOnce();
  });
});
