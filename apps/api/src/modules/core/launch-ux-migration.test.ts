import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CampaignService } from "../campaigns/campaign-service.js";
import { NoopCampaignScheduler } from "../campaigns/campaign-scheduler.js";
import { OrderService } from "../orders/order-service.js";
import { MemoryStore } from "./store.js";

class SnapshotStore extends MemoryStore {
  public loadLegacyState(value: Record<string, unknown>): void {
    this.importState(JSON.stringify(value));
  }
}

const completePoint = {
  id: "point-1",
  serviceAreaId: "area-1",
  name: "社区东门自提点",
  address: "东门服务站 1 号",
  businessHours: "09:00-20:00",
  pickupInstructions: "请出示核销码",
  latitude: 39.9042,
  longitude: 116.4074,
  contactName: "张店长",
  contactPhone: "13800000000",
  status: "ACTIVE",
  capacityPerDay: null,
  createdAt: "2026-08-21T00:00:00.000Z",
};

describe("launch UX forward migration", () => {
  it("suspends a legacy pickup point that lacks required launch details", async () => {
    const store = new SnapshotStore(false);
    const legacyPoint = { ...completePoint, businessHours: undefined };
    store.loadLegacyState({ points: [[legacyPoint.id, legacyPoint]] });

    expect(await store.listPickupPoints()).toMatchObject([
      {
        id: legacyPoint.id,
        status: "INACTIVE",
        businessHours: "",
      },
    ]);
  });

  it("keeps a pickup point active before a manager contact is assigned", async () => {
    const store = new SnapshotStore(false);
    store.loadLegacyState({
      points: [[completePoint.id, { ...completePoint, contactName: "", contactPhone: "" }]],
    });

    expect(await store.listPickupPoints()).toMatchObject([
      {
        id: completePoint.id,
        status: "ACTIVE",
        contactName: "",
        contactPhone: "",
      },
    ]);
  });

  it("does not expose a legacy open campaign without an arrival window", async () => {
    const store = new SnapshotStore(false);
    const now = new Date().toISOString();
    const campaign = {
      id: "campaign-1",
      title: "旧团期",
      serviceAreaId: "area-1",
      cutoffAt: "2099-08-21T02:00:00.000Z",
      dispatchAt: "2099-08-21T03:00:00.000Z",
      minTotalQuantity: 1,
      failureAction: "CANCEL_AND_REFUND",
      items: [],
      status: "OPEN",
      version: 1,
      createdAt: now,
    };
    const plan = {
      id: "plan-1",
      campaignId: campaign.id,
      serviceAreaId: "area-1",
      pickupPointId: completePoint.id,
      status: "SITE_CONFIRMED",
      siteName: completePoint.name,
      address: completePoint.address,
      arrivalStartAt: null,
      arrivalEndAt: null,
      contactName: completePoint.contactName,
      contactPhone: completePoint.contactPhone,
      vehicleOrderNo: null,
      driverName: null,
      driverPhone: null,
      vehiclePlate: null,
      logisticsPlatform: null,
      estimatedArrivalAt: null,
      remark: null,
      confirmedAt: now,
      bookedAt: null,
      dispatchedAt: null,
      arrivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    store.loadLegacyState({
      areas: [
        [
          "area-1",
          {
            id: "area-1",
            regionCode: "110101",
            name: "测试区域",
            status: "ENABLED",
            orderEnabled: true,
            createdAt: now,
          },
        ],
      ],
      points: [[completePoint.id, completePoint]],
      campaigns: [[campaign.id, campaign]],
      plans: [[plan.id, plan]],
    });

    const campaigns = new CampaignService(store, new NoopCampaignScheduler());
    expect(await campaigns.listPublic(Date.parse("2099-01-01T00:00:00Z"))).toEqual(
      [],
    );
    const orders = new OrderService(store, campaigns);
    await expect(
      orders.preview("user-1", {
        campaignId: campaign.id,
        serviceAreaId: "area-1",
        pickupPointId: completePoint.id,
        items: [{ skuId: "sku-1", quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: "CAMPAIGN_NOT_OPEN" });
    expect((await store.getCampaign(campaign.id))?.estimatedArrivalStartAt).toBe(
      "",
    );
  });

  it("advances only the aggregate schema version without clearing payload", () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "../../infra/mysql/migrations/0002_launch_ux_fields.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("schema_version = 2");
    expect(sql).not.toMatch(/DELETE\s+FROM|DROP\s+TABLE|payload\s*=/i);
  });
});
