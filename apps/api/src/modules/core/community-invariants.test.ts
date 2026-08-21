import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { moneyCents } from "@hometown/domain";
import { MemoryStore } from "./store.js";
import type { Campaign, DeliveryPlan, Order } from "./types.js";
import { LedgerService } from "../finance/ledger-service.js";
import { FulfillmentService } from "../fulfillment/fulfillment-service.js";
import { NotificationService } from "../notifications/notification-service.js";

const now = "2026-08-21T00:00:00.000Z";
const pickupSecret = "pickup-secret-at-least-16";
const pickupCode = (orderId: string) =>
  String(
    Number.parseInt(
      createHmac("sha256", pickupSecret)
        .update(`pickup:${orderId}`)
        .digest("hex")
        .slice(0, 12),
      16,
    ) % 1_000_000,
  ).padStart(6, "0");
const campaign: Campaign = {
  id: "campaign",
  title: "社区团",
  serviceAreaId: "area",
  cutoffAt: "2026-08-20T00:00:00.000Z",
  dispatchAt: "2026-08-21T00:00:00.000Z",
  minTotalQuantity: 1,
  failureAction: "CANCEL_AND_REFUND",
  items: [],
  status: "FULFILLING",
  version: 1,
  createdAt: now,
};
const plan: DeliveryPlan = {
  id: "plan",
  campaignId: "campaign",
  serviceAreaId: "area",
  pickupPointId: "point-a",
  status: "ARRIVED",
  siteName: "A 点",
  address: "A 地址",
  arrivalStartAt: null,
  arrivalEndAt: null,
  contactName: null,
  contactPhone: null,
  vehicleOrderNo: "V-1",
  driverName: null,
  driverPhone: null,
  vehiclePlate: null,
  logisticsPlatform: "人工约车",
  estimatedArrivalAt: null,
  remark: null,
  confirmedAt: now,
  bookedAt: now,
  dispatchedAt: now,
  arrivedAt: now,
  createdAt: now,
  updatedAt: now,
};
const order: Order = {
  id: "order",
  orderNo: "ORDER-1",
  userId: "customer",
  campaignId: "campaign",
  serviceAreaId: "area",
  pickupPointId: "point-a",
  deliveryPlanId: "plan",
  status: "READY_FOR_PICKUP",
  totalCents: moneyCents(2000),
  items: [],
  createdAt: now,
  expiresAt: now,
  paidAt: now,
  pickedUpAt: null,
};
async function pickupFixture() {
  const store = new MemoryStore(false);
  await store.saveCampaign(campaign);
  await store.saveServiceArea({
    id: "area",
    regionCode: "110101",
    name: "区域",
    status: "ENABLED",
    orderEnabled: true,
    createdAt: now,
  });
  await store.savePickupPoint({
    id: "point-a",
    serviceAreaId: "area",
    name: "A 点",
    address: "A 地址",
    status: "ACTIVE",
    capacityPerDay: null,
    createdAt: now,
  });
  await store.savePickupPoint({
    id: "point-b",
    serviceAreaId: "area",
    name: "B 点",
    address: "B 地址",
    status: "ACTIVE",
    capacityPerDay: null,
    createdAt: now,
  });
  await store.saveDeliveryPlan(plan);
  await store.saveUser({
    id: "manager",
    wechatOpenId: null,
    status: "ACTIVE",
    createdAt: now,
  });
  await store.saveInternalStaff({
    userId: "manager",
    staffNo: "STF-1",
    displayName: "负责人",
    phone: "13800000000",
    role: "PICKUP_MANAGER",
    status: "ACTIVE",
    createdBy: "admin",
    activatedAt: now,
    suspendedAt: null,
    suspensionReason: null,
    createdAt: now,
    updatedAt: now,
  });
  await store.replaceStaffPickupPointAssignments("manager", [
    {
      staffUserId: "manager",
      pickupPointId: "point-a",
      assignedBy: "admin",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await store.saveOrder(order);
  await store.saveOrderLines(order.id, [
    {
      id: "line",
      catalogSkuId: "sku",
      productId: "product",
      title: "商品",
      skuName: "一份",
      quantity: 2,
      unitPriceCents: 1000,
      amountCents: 2000,
    },
  ]);
  const future = "2026-08-24T15:59:59.999Z";
  await store.updateOrderLine({
    ...(await store.listOrderLinesByOrderForUpdate(order.id))[0]!,
    fulfilledQuantity: 2,
  });
  await store.savePickupCredential({
    orderId: order.id,
    codeHash: createHmac("sha256", pickupSecret)
      .update(pickupCode(order.id))
      .digest("hex"),
    status: "ACTIVE",
    expiresAt: future,
  });
  await store.saveCommunityPickupWindow({
    orderId: order.id,
    deliveryPlanId: plan.id,
    arrivedAt: now,
    deadlineAt: future,
    status: "ACTIVE",
    extensionCount: 0,
    extendedBy: null,
    extendedAt: null,
    dispositionBy: null,
    dispositionAt: null,
    dispositionNote: null,
    refundExceptionId: null,
    lossExceptionId: null,
  });
  return store;
}

describe("community safety invariants", () => {
  it("rejects cross-point lookup and suspended staff sessions", async () => {
    const store = await pickupFixture();
    expect(
      await store.hasActivePickupPointAssignment("manager", "point-b"),
    ).toBe(false);
    await store.saveAuthSession({
      tokenHash: "token",
      userId: "manager",
      roles: ["PICKUP_MANAGER"],
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    const staff = (await store.getInternalStaff("manager"))!;
    staff.status = "SUSPENDED";
    await store.saveInternalStaff(staff);
    expect(await store.getAuthSession("token")).toBeNull();
  });
  it("deduplicates a concurrent partial pickup and allows a later remainder pickup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T00:00:00.000Z"));
    const store = await pickupFixture();
    const service = new FulfillmentService(
      store,
      pickupSecret,
      new LedgerService(),
    );
    const first = {
      orderId: "order",
      deliveryPlanId: "plan",
      code: pickupCode("order"),
      verifierId: "manager",
      requestedItems: [{ catalogSkuId: "sku", quantity: 1 }],
      pickupRequestId: "00000000-0000-4000-8000-000000000001",
    };
    await Promise.all([service.verify(first), service.verify(first)]);
    expect(
      (await store.listOrderLinesByOrderForUpdate("order"))[0]
        ?.pickedUpQuantity,
    ).toBe(1);
    await service.verify({
      ...first,
      pickupRequestId: "00000000-0000-4000-8000-000000000002",
    });
    expect((await store.getOrder("order"))?.status).toBe("PICKED_UP");
    vi.useRealTimers();
  });
  it("moves failed subscription delivery to a durable manual queue", async () => {
    const store = await pickupFixture();
    await store.saveUser({
      id: "customer",
      wechatOpenId: "openid",
      status: "ACTIVE",
      createdAt: now,
    });
    await store.createOrderNotificationIfAbsent({
      id: "notification",
      eventKey: "arrival:event",
      userId: "customer",
      orderId: "order",
      type: "ARRIVED",
      title: "已到货",
      content: "请领取",
      status: "PENDING_DELIVERY",
      readAt: null,
      manualCompletedAt: null,
      createdAt: now,
      deliveryAttempts: 7,
      nextAttemptAt: now,
      deliveryLeaseUntil: null,
      deliveryClaimToken: null,
      lastDeliveryError: null,
      deliveredAt: null,
    });
    const service = new NotificationService(store, {
      send: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    });
    await service.drainPending();
    expect((await store.listManualOrderNotifications(10))[0]?.status).toBe(
      "MANUAL_REQUIRED",
    );
  });
  it("prevents pickup exactly at the persisted deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T15:59:59.999Z"));
    const store = await pickupFixture();
    const service = new FulfillmentService(
      store,
      "pickup-secret-at-least-16",
      new LedgerService(),
    );
    await expect(
      service.verify({
        orderId: "order",
        deliveryPlanId: "plan",
        code: "000000",
        verifierId: "manager",
        requestedItems: [{ catalogSkuId: "sku", quantity: 1 }],
        pickupRequestId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toMatchObject({ code: "PICKUP_CODE_EXPIRED" });
    vi.useRealTimers();
  });
});
