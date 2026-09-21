import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createAdminCredential } from "./modules/auth/admin-auth.js";
import { MemoryStore } from "./modules/core/store.js";
import type { Order, PickupPoint } from "./modules/core/types.js";

const admin = { "x-demo-user-id": "admin", "x-demo-role": "SUPER_ADMIN" };
const point = (id: string, name = id): PickupPoint => ({
  id,
  serviceAreaId: "area",
  name,
  address: `${name}地址`,
  businessHours: "09:00-20:00",
  pickupInstructions: "凭码领取",
  latitude: 39.9,
  longitude: 116.4,
  contactName: "",
  contactPhone: "",
  status: "ACTIVE",
  capacityPerDay: null,
  createdAt: new Date().toISOString(),
});
const order = (id: string, pickupPointId: string, status: Order["status"]): Order => ({
  id,
  orderNo: `ORDER-${id}`,
  userId: "user",
  campaignId: "campaign",
  serviceAreaId: "area",
  pickupPointId,
  deliveryPlanId: "plan",
  status,
  totalCents: 1000,
  items: [],
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  paidAt: null,
  pickedUpAt: null,
});

describe("pickup point deletion", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => app?.close());

  it("deletes an unused point, preserves ended orders, and releases only its staff scope", async () => {
    const store = new MemoryStore(false);
    await store.savePickupPoint(point("removed", "历史点位"));
    await store.savePickupPoint(point("kept", "保留点位"));
    await store.saveOrder(order("ended", "removed", "COMPLETED"));
    await store.saveUser({ id: "manager", wechatOpenId: null, status: "ACTIVE", createdAt: new Date().toISOString() });
    await store.saveInternalStaff({
      userId: "manager", staffNo: "STF-1", displayName: "点位负责人", phone: "13800000001",
      role: "PICKUP_MANAGER", status: "ACTIVE", createdBy: "admin", activatedAt: new Date().toISOString(),
      suspendedAt: null, suspensionReason: null, authorizationVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await store.replaceStaffPickupPointAssignments("manager", [
      { staffUserId: "manager", pickupPointId: "removed", assignedBy: "admin", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { staffUserId: "manager", pickupPointId: "kept", assignedBy: "admin", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    await store.saveAuthSession({ tokenHash: "manager-session", userId: "manager", roles: ["PICKUP_MANAGER"], authorizationVersion: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });

    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/pickup-points/removed", headers: admin });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ data: { deleted: true, affectedStaffCount: 1 } });
    expect((await store.listPickupPoints()).map((value) => [value.id, value.archivedAt ?? null])).toEqual([["removed", expect.any(String)], ["kept", null]]);
    expect((await store.listPickupPoints()).find((value) => value.id === "removed")?.name).toBe("历史点位");
    expect((await store.listStaffPickupPointAssignments("manager")).map((value) => value.pickupPointId)).toEqual(["kept"]);
    expect((await store.getInternalStaff("manager"))?.authorizationVersion).toBe(2);
    expect(await store.getAuthSession("manager-session")).toBeNull();
    expect((await store.getOrder("ended"))?.pickupPointId).toBe("removed");
    expect((await store.listAuditLogs(20)).map((value) => value.action)).toContain("PICKUP_POINT_DELETED");
    const reenable = await app.inject({ method: "PATCH", url: "/api/v1/admin/pickup-points/removed", headers: admin, payload: { status: "ACTIVE" } });
    expect(reenable.statusCode, reenable.body).toBe(409);
  });

  it("allows an orphaned manager binding to be cleared without changing the role", async () => {
    const store = new MemoryStore(false);
    await store.savePickupPoint(point("valid", "有效点位"));
    await store.saveUser({ id: "orphan-manager", wechatOpenId: null, status: "ACTIVE", createdAt: new Date().toISOString() });
    await store.saveInternalStaff({
      userId: "orphan-manager", staffNo: "STF-ORPHAN", displayName: "失效关联负责人", phone: "13800000002",
      role: "PICKUP_MANAGER", status: "ACTIVE", createdBy: "admin", activatedAt: new Date().toISOString(),
      suspendedAt: null, suspensionReason: null, authorizationVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await store.saveAdminCredential(await createAdminCredential("orphan-manager", "orphan-manager", "TestOrphan123", ["PICKUP_MANAGER"], false, 1));
    await store.replaceStaffPickupPointAssignments("orphan-manager", [{ staffUserId: "orphan-manager", pickupPointId: "missing-old-point", assignedBy: "admin", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
    const response = await app.inject({
      method: "PATCH", url: "/api/v1/admin/staff/orphan-manager", headers: admin,
      payload: { role: "PICKUP_MANAGER", pickupPointIds: [], reason: "移除失效点位关联" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({ role: "PICKUP_MANAGER", pickupPointIds: [] });
    expect(await store.listStaffPickupPointAssignments("orphan-manager")).toEqual([]);
  });

  it.each([
    ["unfinished order", async (store: MemoryStore) => store.saveOrder(order("unfinished", "blocked", "PENDING_PAYMENT"))],
    ["active campaign plan", async (store: MemoryStore) => store.saveDeliveryPlan({
      id: "plan", campaignId: "campaign", serviceAreaId: "area", pickupPointId: "blocked", status: "ARRIVED",
      siteName: "阻止点位", address: "阻止点位地址", arrivalStartAt: null, arrivalEndAt: null, contactName: null,
      contactPhone: null, vehicleOrderNo: null, driverName: null, driverPhone: null, vehiclePlate: null,
      logisticsPlatform: null, estimatedArrivalAt: null, remark: null, confirmedAt: new Date().toISOString(),
      bookedAt: null, dispatchedAt: null, arrivedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })],
  ])("blocks deletion when %s remains", async (_reason, seed) => {
    const store = new MemoryStore(false);
    await store.savePickupPoint(point("blocked"));
    if (_reason === "active campaign plan") {
      await store.saveCampaign({
        id: "campaign", title: "进行中团期", serviceAreaId: "area", cutoffAt: new Date(Date.now() + 3_600_000).toISOString(),
        dispatchAt: new Date(Date.now() + 7_200_000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null,
        minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND", items: [], status: "FULFILLING", version: 1, createdAt: new Date().toISOString(),
      });
    }
    await seed(store);
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/pickup-points/blocked", headers: admin });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: "RESOURCE_IN_USE" });
    expect(await store.listPickupPoints()).toHaveLength(1);
  });

  it("rejects non-operator deletion", async () => {
    const store = new MemoryStore(false);
    await store.savePickupPoint(point("private"));
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/pickup-points/private", headers: { "x-demo-user-id": "finance", "x-demo-role": "FINANCE" } });
    expect(response.statusCode).toBe(403);
    expect(await store.listPickupPoints()).toHaveLength(1);
  });
});
