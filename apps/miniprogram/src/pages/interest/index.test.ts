import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

it("does not show withdrawal success after the follow-up refresh expires the session", async () => {
  let epoch = 1;
  let loggedIn = true;
  class AuthExpiredError extends Error {
    requestEpoch = 1;
    sessionWasCleared = true;
  }
  const showToast = vi.fn();
  const navigateToCustomerLogin = vi.fn();
  vi.doMock("../../utils/api", () => ({
    AuthExpiredError,
    customerAuth: { captureSessionEpoch: () => epoch, isLoggedIn: () => loggedIn },
    customerErrorMessage: (_error: unknown, fallback: string) => fallback,
    api: {
      withdrawOwnServiceAreaInterest: async () => undefined,
      listOwnServiceAreaInterests: async () => { epoch++; loggedIn = false; throw new AuthExpiredError(); },
    },
  }));
  vi.doMock("../../utils/auth-navigation", () => ({ navigateToCustomerLogin }));
  vi.stubGlobal("wx", { showToast });
  type InterestPage = {
    data: Record<string, unknown>;
    setData: (patch: Record<string, unknown>) => void;
    confirmWithdraw: (id: string) => Promise<void>;
  };
  let page!: InterestPage;
  vi.stubGlobal("Page", (definition: InterestPage) => { page = definition; });
  await import("./index");
  page.setData = (patch: Record<string, unknown>) => Object.assign(page.data, patch);
  await page.confirmWithdraw("interest-1");
  expect(navigateToCustomerLogin).toHaveBeenCalled();
  expect(page.data.interests).toEqual([]);
  expect(showToast).not.toHaveBeenCalled();
});
