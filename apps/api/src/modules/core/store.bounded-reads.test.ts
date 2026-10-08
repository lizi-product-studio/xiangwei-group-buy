import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, orderStatusesExcept } from "./mysql-store.js";
import { MemoryStore } from "./store.js";
import type { Campaign, DeliveryPlan } from "./types.js";

describe("bounded campaign and status reads", () => {
  it("rewrites excluded order statuses as the exhaustive complement", () => {
    expect(orderStatusesExcept([])).toEqual([...ORDER_STATUSES]);
    const live = orderStatusesExcept(["COMPLETED", "CANCELLED", "REFUNDED"]);
    expect(live).not.toContain("COMPLETED");
    expect(live).toContain("READY_FOR_PICKUP");
    expect(live.length + 3).toBe(ORDER_STATUSES.length);
    expect(orderStatusesExcept([...ORDER_STATUSES])).toEqual([]);
  });

  it("lists only campaigns in the requested statuses and plans for the given campaigns", async () => {
    const store = new MemoryStore(false);
    const campaign = (id: string, status: Campaign["status"]) => ({
      id, title: id, serviceAreaId: "area", cutoffAt: "2026-10-01T00:00:00.000Z", dispatchAt: "2026-10-02T00:00:00.000Z",
      estimatedArrivalStartAt: null, estimatedArrivalEndAt: null, minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND",
      status, version: 1, createdAt: "2026-09-28T00:00:00.000Z", items: [],
    }) as unknown as Campaign;
    await store.saveCampaign(campaign("open-a", "OPEN"));
    await store.saveCampaign(campaign("closed-b", "COMPLETED"));
    const plan = (id: string, campaignId: string) => ({ id, campaignId, serviceAreaId: "area", pickupPointId: "point", status: "SITE_CONFIRMED" }) as unknown as DeliveryPlan;
    await store.saveDeliveryPlan(plan("plan-a", "open-a"));
    await store.saveDeliveryPlan(plan("plan-b", "closed-b"));

    expect((await store.listCampaignsByStatus(["OPEN"])).map((value) => value.id)).toEqual(["open-a"]);
    expect(await store.listCampaignsByStatus([])).toEqual([]);
    expect((await store.listDeliveryPlansByCampaigns(["open-a"])).map((value) => value.id)).toEqual(["plan-a"]);
    expect(await store.listDeliveryPlansByCampaigns([])).toEqual([]);
  });
});
