import { beforeEach, describe, expect, it, vi } from "vitest";

type ProfileEditPage = {
  data: Record<string, unknown>;
  setData: (patch: Record<string, unknown>) => void;
  onLoad: () => void;
  loadProfile: () => Promise<void>;
  authorizePhone: (event: { detail: { errMsg: string; code?: string } }) => Promise<void>;
};

describe("profile editor session recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  async function fixture(options: { loggedIn?: boolean; expired?: boolean; emptyName?: boolean } = {}) {
    let epoch = 4;
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
    vi.doMock("../../utils/api", () => ({
      AuthExpiredError: ExpiredError,
      customerErrorMessage: (_error: unknown, fallback: string) => fallback,
      customerAuth: {
        isLoggedIn: () => options.loggedIn !== false,
        captureSessionEpoch: () => epoch,
      },
      api: {
        getMyProfile: async () => {
          if (options.expired) {
            epoch += 1;
            throw new ExpiredError(4, true);
          }
          return { displayName: options.emptyName ? "" : "微信用户", avatarUrl: null, phoneNumber: "199****9869", profileVersion: 1 };
        },
        downloadMyProfileImage: vi.fn(),
      },
    }));
    vi.doMock("../../utils/auth-navigation", () => ({ navigateToCustomerLogin }));
    vi.stubGlobal("wx", { showToast: vi.fn() });
    let page: ProfileEditPage | undefined;
    vi.stubGlobal("Page", (definition: ProfileEditPage) => { page = definition; });
    await import("./index");
    if (!page) throw new Error("profile edit page was not registered");
    page.setData = (patch) => Object.assign(page!.data, patch);
    return { page, navigateToCustomerLogin };
  }

  it("routes a signed-out visitor through the shared login intent instead of keeping the editor open", async () => {
    const { page, navigateToCustomerLogin } = await fixture({ loggedIn: false });
    await page.loadProfile.call(page);

    expect(navigateToCustomerLogin).toHaveBeenCalledWith("profile", "/pages/profile/index");
    expect(page.data.loading).toBe(false);
  });

  it("clears profile fields and opens login when a stored token receives 401", async () => {
    const { page, navigateToCustomerLogin } = await fixture({ expired: true });
    Object.assign(page.data, { displayName: "旧账号", avatarUrl: "old", phoneNumber: "199****9869", profileVersion: 8 });

    await page.loadProfile.call(page);

    expect(navigateToCustomerLogin).toHaveBeenCalledWith("profile", "/pages/profile/index");
    expect(page.data).toMatchObject({ loading: false, displayName: "", avatarUrl: "", phoneNumber: "", profileVersion: 0 });
  });

  it("keeps a loaded empty-name profile and bound phone when replacement is cancelled", async () => {
    const { page } = await fixture({ emptyName: true });
    await page.loadProfile();
    await page.authorizePhone({ detail: { errMsg: "getPhoneNumber:fail user deny" } });
    expect(page.data).toMatchObject({ profileLoaded: true, displayName: "", phoneNumber: "199****9869", error: "本次更换已取消，原手机号未变更" });
  });
});
