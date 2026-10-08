import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminErrorText,
  api,
  auth,
  isValidStaffRoles,
  hasValidAdminSession,
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
    expect(
      adminErrorText({
        statusCode: 409,
        code: "INVALID_STATE_TRANSITION",
        message: "当前团期已经截单，无需重复操作",
      }),
    ).toBe("当前团期已经截单，无需重复操作");
    expect(
      adminErrorText({
        statusCode: 409,
        code: "CONCURRENT_MODIFICATION",
        message: "团期已被其他操作更新",
      }),
    ).toBe("数据刚刚被其他操作更新，请刷新列表后再试");
  });

  it("wraps a rejected fetch before any page can render it as an empty response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.skus()).rejects.toMatchObject({ code: "NETWORK_UNAVAILABLE" });
    expect(adminErrorText(await api.skus().catch((error) => error))).toContain(
      "暂时无法连接后台服务",
    );
  });

  it("parses Retry-After for ordinary API throttling", () => {
    const now = Date.parse("2026-09-03T00:00:00.000Z");
    expect(parseRetryAfterSeconds("321", now)).toBe(321);
    expect(parseRetryAfterSeconds("Thu, 03 Sep 2026 00:05:21 GMT", now)).toBe(321);
    expect(parseRetryAfterSeconds("invalid", now)).toBeUndefined();
  });

  it("keeps the response Retry-After value on ordinary API rate-limit errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ code: "RATE_LIMITED", message: "请求过于频繁" }),
          { status: 429, headers: { "content-type": "application/json", "retry-after": "42" } },
        ),
      ),
    );
    await expect(api.skus()).rejects.toMatchObject({
      code: "RATE_LIMITED",
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
  it("returns service-area interests in the direct operations-queue page contract", async () => {
    const interest = {
      id: "interest-1",
      contactName: "顾客",
      maskedContactPhone: "138****0000",
      regionText: "望京",
      privacyConsentedAt: "2026-10-08T00:00:00.000Z",
      createdAt: "2026-10-08T00:00:00.000Z",
      status: "NEW",
      statusNote: null,
      statusChangedAt: null,
    };
    const page = { data: [interest], pagination: { total: 21, page: 2, pageSize: 20 } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.serviceAreaInterestsPage({ page: 2, pageSize: 20, status: "NEW" });

    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toEqual([interest]);
    expect(result.pagination).toEqual({ total: 21, page: 2, pageSize: 20 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/service-area-interests?page=2&pageSize=20&status=NEW",
      expect.any(Object),
    );
  });
  it("returns the server-reported row count with the filtered order export", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("csv", {
      status: 200,
      headers: { "content-type": "text/csv", "x-exported-row-count": "7" },
    })));
    const exported = await api.exportOrders({ keyword: "用户", dateType: "CREATED_AT" });
    expect(exported.rowCount).toBe(7);
    expect(await exported.blob.text()).toBe("csv");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/orders/export?keyword=%E7%94%A8%E6%88%B7&dateType=CREATED_AT",
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

  it("looks up pickup code within a point and only supplies an order number for disambiguation", async () => {
    await api.lookupPickupCode("point-1", "012345");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/v1/pickup/orders/lookup",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ pickupPointId: "point-1", code: "012345" }) }),
    );
    await api.lookupPickupCode("point-1", "012345", "ORDER-1");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/v1/pickup/orders/lookup",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ pickupPointId: "point-1", code: "012345", orderNo: "ORDER-1" }) }),
    );
  });

  it("keeps a safe server request id in operator-facing failure copy", () => {
    expect(adminErrorText({ statusCode: 500, requestId: "123e4567-e89b-42d3-a456-426614174000" })).toContain(
      "请求编号：123e4567-e89b-42d3-a456-426614174000",
    );
    expect(adminErrorText({ statusCode: 500, requestId: "raw-provider-payload" })).not.toContain("raw-provider-payload");
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
