import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.ts";

describe("community admin API", () => {
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
