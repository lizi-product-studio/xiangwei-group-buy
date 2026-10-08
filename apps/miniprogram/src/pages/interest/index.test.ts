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

it("releases the submit state after a successful write starts its follow-up list refresh", async () => {
  const createServiceAreaInterest = vi.fn(async () => ({ id: "interest-1", status: "NEW" }));
  const listOwnServiceAreaInterests = vi.fn(async () => []);
  const showModal = vi.fn();
  vi.doMock("../../utils/api", () => ({
    AuthExpiredError: class AuthExpiredError extends Error {},
    customerAuth: { captureSessionEpoch: () => 1, isLoggedIn: () => true },
    customerErrorMessage: (_error: unknown, fallback: string) => fallback,
    api: { createServiceAreaInterest, listOwnServiceAreaInterests },
  }));
  vi.doMock("../../utils/auth-navigation", () => ({ navigateToCustomerLogin: vi.fn() }));
  vi.stubGlobal("wx", { showModal, showToast: vi.fn() });
  type InterestPage = {
    data: Record<string, unknown>;
    setData: (patch: Record<string, unknown>) => void;
    submit: () => Promise<void>;
  };
  let page!: InterestPage;
  vi.stubGlobal("Page", (definition: InterestPage) => {
    page = { ...definition, setData: (patch) => Object.assign(page.data, patch) };
  });
  await import("./index");
  Object.assign(page.data, { regionText: "幸福区", contactName: "李女士", contactPhone: "13800000000", privacyAccepted: true });

  await page.submit();

  expect(createServiceAreaInterest).toHaveBeenCalledOnce();
  expect(listOwnServiceAreaInterests).toHaveBeenCalledOnce();
  expect(page.data).toMatchObject({ submitting: false, loading: false, editingId: "", interests: [] });
  expect(showModal).toHaveBeenCalledWith(expect.objectContaining({ title: "登记成功" }));
});
