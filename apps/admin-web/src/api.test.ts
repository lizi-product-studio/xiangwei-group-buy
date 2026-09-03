import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminErrorText,
  api,
  auth,
  isValidStaffRoles,
  hasValidAdminSession,
  loginRetryMessage,
  loginRetryRemainingSeconds,
  parseRetryAfterSeconds,
} from "./api.ts";

describe("community admin API", () => {
  it("maps browser/network and structured API failures to recoverable Chinese copy", () => {
    expect(adminErrorText(new TypeError("Load failed"))).toContain("暂时无法连接后台服务");
    expect(adminErrorText({ statusCode: 403, code: "FORBIDDEN" })).toBe(
      "当前账号没有执行此操作的权限",
    );
    expect(
      adminErrorText({
        statusCode: 400,
        code: "VALIDATION_ERROR",
        details: [{ path: ["category"], message: "String must contain at least 2 character(s)" }],
      }),
    ).toContain("分类");
  });

  it("wraps a rejected fetch before any page can render it as an empty response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.skus()).rejects.toMatchObject({ code: "NETWORK_UNAVAILABLE" });
    expect(adminErrorText(await api.skus().catch((error) => error))).toContain(
      "暂时无法连接后台服务",
    );
  });

  it("parses Retry-After and exposes a controlled login countdown", () => {
    const now = Date.parse("2026-09-03T00:00:00.000Z");
    expect(parseRetryAfterSeconds("321", now)).toBe(321);
    expect(parseRetryAfterSeconds("Thu, 03 Sep 2026 00:05:21 GMT", now)).toBe(321);
    expect(parseRetryAfterSeconds("invalid", now)).toBeUndefined();
    const until = now + 321_000;
    expect(loginRetryRemainingSeconds(until, now)).toBe(321);
    expect(loginRetryRemainingSeconds(until, now + 321_000)).toBe(0);
    expect(loginRetryMessage(321)).toBe(
      "登录尝试过于频繁，请在 5 分 21 秒后重试；持续失败请联系超级管理员",
    );
  });

  it("keeps the response Retry-After value on login rate-limit errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ code: "LOGIN_RATE_LIMITED", message: "登录尝试过于频繁" }),
          { status: 429, headers: { "content-type": "application/json", "retry-after": "42" } },
        ),
      ),
    );
    await expect(api.login("ops.admin", "not a real password")).rejects.toMatchObject({
      code: "LOGIN_RATE_LIMITED",
      statusCode: 429,
      retryAfterSeconds: 42,
    });
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  });
  it("uses the community catalog and campaign routes", async () => {
    await api.skus();
    await api.campaigns();
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/v1/admin/catalog/skus",
      expect.any(Object),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/v1/admin/campaigns",
      expect.any(Object),
    );
  });
  it("uses the web-only pickup workbench routes", async () => {
    await api.pickupPlans();
    await api.lookupPickup("plan-1", "ORDER-1");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/v1/pickup/orders/lookup?deliveryPlanId=plan-1&orderNo=ORDER-1",
      expect.any(Object),
    );
  });

  it("fails closed for malformed bearer role arrays while accepting the staff role enum", () => {
    expect(isValidStaffRoles(["SUPER_ADMIN", "FINANCE"])).toBe(true);
    expect(isValidStaffRoles([])).toBe(false);
    expect(isValidStaffRoles(["SUPER_ADMIN", 123])).toBe(false);
    expect(isValidStaffRoles(["SUPER_ADMIN", "ROOT"])).toBe(false);

    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    localStorage.setItem("community-admin-roles", JSON.stringify(["SUPER_ADMIN", 123]));
    expect(auth.roles()).toEqual([]);
    localStorage.setItem("community-admin-roles", JSON.stringify(["PICKUP_MANAGER"]));
    expect(auth.roles()).toEqual(["PICKUP_MANAGER"]);
    auth.clear();
  });

  it("fails closed when a bearer cache lacks the user identity required by the account menu", () => {
    expect(hasValidAdminSession(true, "token", ["FINANCE"], null, "finance")).toBe(false);
    expect(hasValidAdminSession(true, "token", ["FINANCE"], "user-1", null)).toBe(false);
    expect(hasValidAdminSession(true, "token", ["FINANCE"], "user-1", "finance")).toBe(true);
  });

  it("updates launch-critical pickup point details with PATCH", async () => {
    const body = {
      name: "东门社区点",
      address: "社区大街 88 号",
      businessHours: "每日 09:00–20:00",
      pickupInstructions: "出示领取码",
      latitude: 39.9,
      longitude: 116.4,
      contactName: "王店长",
      contactPhone: "13800138000",
      capacityPerDay: 100,
    };
    await api.updatePoint("point-1", body);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/v1/admin/pickup-points/point-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(body) }),
    );
  });
});
