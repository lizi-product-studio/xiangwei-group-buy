import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";
import { pickupCodeHash } from "./modules/fulfillment/pickup-code.js";

const secret = "test-pickup-secret";
const managerHeaders = {
  "x-demo-user-id": "manager",
  "x-demo-role": "PICKUP_MANAGER",
};

describe("pickup code order lookup", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let store: MemoryStore;
  const now = new Date().toISOString();

  beforeEach(async () => {
    store = new MemoryStore(false);
    await store.saveUser({ id: "manager", wechatOpenId: null, status: "ACTIVE", createdAt: now });
    await store.saveInternalStaff({
      userId: "manager", staffNo: "PM-1", displayName: "自提负责人", phone: "13800000000",
      role: "PICKUP_MANAGER", status: "ACTIVE", createdBy: null, activatedAt: now,
      suspendedAt: null, suspensionReason: null, authorizationVersion: 1, createdAt: now, updatedAt: now,
    });
    await store.savePickupPoint({
      id: "point-a", serviceAreaId: "area-a", name: "东门自提点", address: "东门服务站 1 号",
      businessHours: "09:00-20:00", pickupInstructions: "出示取货码", latitude: 1, longitude: 1,
      contactName: "负责人", contactPhone: "13800000000", status: "ACTIVE", capacityPerDay: 100, createdAt: now,
    });
    await store.savePickupPoint({
      id: "point-b", serviceAreaId: "area-a", name: "西门自提点", address: "西门服务站 2 号",
      businessHours: "09:00-20:00", pickupInstructions: "出示取货码", latitude: 1, longitude: 1,
      contactName: "负责人", contactPhone: "13800000000", status: "ACTIVE", capacityPerDay: 100, createdAt: now,
    });
    await store.replaceStaffPickupPointAssignments("manager", [{ staffUserId: "manager", pickupPointId: "point-a", assignedBy: "manager", createdAt: now, updatedAt: now }]);
    await store.saveDeliveryPlan({
      id: "plan-a", campaignId: "campaign-a", serviceAreaId: "area-a", pickupPointId: "point-a", status: "ARRIVED",
      siteName: "东门自提点", address: "东门服务站 1 号", arrivalStartAt: null, arrivalEndAt: null, contactName: null,
      contactPhone: null, vehicleOrderNo: null, driverName: null, driverPhone: null, vehiclePlate: null,
      logisticsPlatform: null, estimatedArrivalAt: null, remark: null, confirmedAt: now, bookedAt: now,
      dispatchedAt: now, arrivedAt: now, createdAt: now, updatedAt: now,
    });
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test", PICKUP_CODE_SECRET: secret }), store });
  });

  afterEach(async () => app.close());

  async function addOrder(id: string, orderNo: string, code: string, expiresAt: string, status = "READY_FOR_PICKUP" as const) {
    await store.saveOrder({
      id, orderNo, userId: "consumer", campaignId: "campaign-a", serviceAreaId: "area-a", pickupPointId: "point-a",
      deliveryPlanId: "plan-a", status, totalCents: moneyCents(1000), items: [{
        orderLineId: `${id}-line`, skuId: "sku", productId: "product", name: "番茄", quantity: 2,
        unitPriceCents: moneyCents(500), amountCents: moneyCents(1000), fulfilledQuantity: 2,
        pickedUpQuantity: 1, exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: moneyCents(0),
      }], createdAt: now, expiresAt, paidAt: now, pickedUpAt: null,
    });
    await store.savePickupCredential({ orderId: id, codeHash: pickupCodeHash(code, secret), status: "ACTIVE", expiresAt });
    await store.saveCommunityPickupWindow({
      orderId: id, deliveryPlanId: "plan-a", arrivedAt: now, deadlineAt: expiresAt,
      status: "ACTIVE", extensionCount: 0, extendedBy: null, extendedAt: null,
      dispositionBy: null, dispositionAt: null, dispositionNote: null,
      refundExceptionId: null, lossExceptionId: null,
    });
  }

  it("looks up a valid partially picked order and returns its actual plan", async () => {
    await addOrder("order-a", "ORDER-A", "123456", new Date(Date.now() + 60_000).toISOString());
    const response = await app.inject({ method: "GET", url: "/api/v1/pickup/orders/lookup?pickupPointId=point-a&code=123456", headers: managerHeaders });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({ id: "order-a", orderNo: "ORDER-A", deliveryPlanId: "plan-a" });
    expect(response.json().data.items[0].remainingPickupQuantity).toBe(1);
  });

  it.each([
    ["wrong code", "654321", 404],
    ["expired code", "123456", 404],
    ["revoked code", "123456", 404],
  ])("rejects %s without exposing order data", async (_label, code, expectedStatus) => {
    const expiresAt = _label === "expired code" ? new Date(Date.now() - 60_000).toISOString() : new Date(Date.now() + 60_000).toISOString();
    await addOrder("order-a", "ORDER-A", "123456", expiresAt);
    if (_label === "revoked code") await store.savePickupCredential({ orderId: "order-a", codeHash: pickupCodeHash("123456", secret), status: "REVOKED", expiresAt });
    const response = await app.inject({ method: "GET", url: `/api/v1/pickup/orders/lookup?pickupPointId=point-a&code=${code}`, headers: managerHeaders });
    expect(response.statusCode).toBe(expectedStatus);
    expect(response.body).not.toContain("ORDER-A");
  });

  it("fails closed for an ambiguous code", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await addOrder("order-a", "ORDER-A", "123456", expiresAt);
    await addOrder("order-b", "ORDER-B", "123456", expiresAt);
    const response = await app.inject({ method: "GET", url: "/api/v1/pickup/orders/lookup?pickupPointId=point-a&code=123456", headers: managerHeaders });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("PICKUP_CODE_AMBIGUOUS");
    expect(response.body).toContain("请提供订单号查询");
    expect(response.body).not.toContain("ORDER-A");
    expect(response.body).not.toContain("ORDER-B");
  });

  it("resolves a collision only with the exact same-point order number", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await addOrder("order-a", "ORDER-A", "123456", expiresAt);
    await addOrder("order-b", "ORDER-B", "123456", expiresAt);
    const resolved = await app.inject({ method: "GET", url: "/api/v1/pickup/orders/lookup?pickupPointId=point-a&code=123456&orderNo=ORDER-B", headers: managerHeaders });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data).toMatchObject({ id: "order-b", orderNo: "ORDER-B" });
    const wrong = await app.inject({ method: "GET", url: "/api/v1/pickup/orders/lookup?pickupPointId=point-a&code=123456&orderNo=ORDER-C", headers: managerHeaders });
    expect(wrong.statusCode).toBe(404);
    expect(wrong.body).not.toContain("ORDER-A");
    expect(wrong.body).not.toContain("ORDER-B");
  });

  it.each([
    ["EXPIRED_PENDING", new Date(Date.now() + 60_000).toISOString()],
    ["ACTIVE", new Date(Date.now() - 60_000).toISOString()],
  ] as const)("rejects a lookup when the pickup window is %s or past deadline", async (status, deadlineAt) => {
    await addOrder("order-a", "ORDER-A", "123456", new Date(Date.now() + 120_000).toISOString());
    await store.saveCommunityPickupWindow({
      orderId: "order-a", deliveryPlanId: "plan-a", arrivedAt: now, deadlineAt,
      status, extensionCount: 0, extendedBy: null, extendedAt: null,
      dispositionBy: null, dispositionAt: null, dispositionNote: null,
      refundExceptionId: null, lossExceptionId: null,
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/pickup/orders/lookup?pickupPointId=point-a&code=123456", headers: managerHeaders });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("ORDER-A");
  });

  it("does not cross pickup point scope", async () => {
    await addOrder("order-a", "ORDER-A", "123456", new Date(Date.now() + 60_000).toISOString());
    const response = await app.inject({ method: "GET", url: "/api/v1/pickup/orders/lookup?pickupPointId=point-b&code=123456", headers: managerHeaders });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("ORDER-A");
  });
});
