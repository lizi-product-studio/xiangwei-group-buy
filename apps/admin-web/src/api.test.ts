import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminErrorText, api, auth, isValidStaffRoles } from "./api.ts";

describe("community admin API", () => {
  it("maps browser/network and structured API failures to recoverable Chinese copy", () => {
    expect(adminErrorText(new TypeError("Load failed"))).toContain("后台服务暂时无法连接");
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
      "后台服务暂时无法连接",
    );
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
