import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";

const admin = { "x-demo-user-id": "admin", "x-demo-role": "SUPER_ADMIN" };
const customer = { "x-demo-user-id": "customer", "x-demo-role": "USER" };

type Fixture = {
  areaId: string;
  pointId: string;
  skuId: string;
  campaignId: string;
  deliveryPlanId: string;
};

describe("community group-buying API lifecycle", () => {
  let app: FastifyInstance;
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(false);
    const now = new Date().toISOString();
    for (const id of ["admin", "customer"])
      await store.saveUser({
        id,
        wechatOpenId: id === "customer" ? "openid-customer" : null,
        status: "ACTIVE",
        createdAt: now,
      });
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
  });

  afterEach(async () => app.close());

  const inject = (options: InjectOptions) => app.inject(options);

  async function createOpenCampaign(): Promise<Fixture> {
    const area = await inject({
      method: "POST",
      url: "/api/v1/admin/service-areas",
      headers: admin,
      payload: { regionCode: "110101" },
    });
    expect([200, 201], area.body).toContain(area.statusCode);
    const areaId = area.json().data.id as string;
    const point = await inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: admin,
      payload: {
        serviceAreaId: areaId,
        name: "东门社区自提点",
        address: "东门社区服务站 1 号",
        businessHours: "09:00-20:00",
        pickupInstructions: "请从东门进入并出示核销码",
        latitude: 39.9042,
        longitude: 116.4074,
        contactName: "张店长",
        contactPhone: "13800000000",
        capacityPerDay: 500,
        photoUrl: "https://example.com/community-pickup.jpg",
      },
    });
    expect(point.statusCode, point.body).toBe(201);
    const pointId = point.json().data.id as string;
    const sku = await inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: admin,
      payload: {
        title: "当季番茄组合",
        category: "蔬菜",
        origin: "本地合作农场",
        imageUrl: null,
        skuName: "每份 2 斤",
        retailPriceCents: 1600,
        defaultSellableQuantity: 100,
        status: "ACTIVE",
      },
    });
    expect(sku.statusCode, sku.body).toBe(201);
    const skuId = sku.json().data.id as string;
    const cutoffAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const dispatchAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const estimatedArrivalStartAt = new Date(
      Date.now() + 3 * 60 * 60 * 1000,
    ).toISOString();
    const estimatedArrivalEndAt = new Date(
      Date.now() + 4 * 60 * 60 * 1000,
    ).toISOString();
    const campaign = await inject({
      method: "POST",
      url: "/api/v1/admin/campaigns",
      headers: admin,
      payload: {
        title: "周末社区蔬菜团",
        serviceAreaId: areaId,
        pickupPointId: pointId,
        cutoffAt,
        dispatchAt,
        estimatedArrivalStartAt,
        estimatedArrivalEndAt,
        minTotalQuantity: 1,
        failureAction: "CANCEL_AND_REFUND",
        items: [
          {
            catalogSkuId: skuId,
            retailPriceCents: 1500,
            sellableQuantity: 50,
          },
        ],
      },
    });
    expect(campaign.statusCode, campaign.body).toBe(201);
    const campaignId = campaign.json().data.id as string;
    const deliveryPlanId = campaign.json().data.deliveryPlan.id as string;
    const opened = await inject({
      method: "POST",
      url: `/api/v1/admin/campaigns/${campaignId}/open`,
      headers: admin,
    });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json().data.status).toBe("OPEN");
    expect(
      (
        await inject({ method: "GET", url: "/api/v1/campaigns" })
      ).json().data.map((value: { id: string }) => value.id),
    ).toContain(campaignId);
    expect(
      (
        await inject({ method: "GET", url: `/api/v1/campaigns/${campaignId}` })
      ).json().data.deliveryPlan.pickupPointId,
    ).toBe(pointId);
    return { areaId, pointId, skuId, campaignId, deliveryPlanId };
  }

  async function createAndPayOrder(fixture: Fixture, quantity = 2) {
    const payload = {
      campaignId: fixture.campaignId,
      serviceAreaId: fixture.areaId,
      pickupPointId: fixture.pointId,
      items: [{ skuId: fixture.skuId, quantity }],
    };
    const preview = await inject({
      method: "POST",
      url: "/api/v1/orders/preview",
      headers: customer,
      payload,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().data.totalCents).toBe(1500 * quantity);
    const idempotencyKey = `checkout-${randomUUID()}`;
    const created = await inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { ...customer, "idempotency-key": idempotencyKey },
      payload,
    });
    expect(created.statusCode, created.body).toBe(201);
    const order = created.json().data;
    const replay = await inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { ...customer, "idempotency-key": idempotencyKey },
      payload,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data.id).toBe(order.id);
    const conflict = await inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { ...customer, "idempotency-key": idempotencyKey },
      payload: {
        ...payload,
        items: [{ skuId: fixture.skuId, quantity: quantity === 1 ? 2 : 1 }],
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("IDEMPOTENCY_CONFLICT");
    const initiated = await inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/pay`,
      headers: customer,
    });
    expect(initiated.statusCode, initiated.body).toBe(200);
    expect(initiated.json().data.status).toBe("CREATED");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const paid = await inject({
        method: "POST",
        url: `/api/v1/orders/${order.id}/pay/mock-confirm`,
        headers: customer,
      });
      expect(paid.statusCode, paid.body).toBe(200);
    }
    const publicCampaign = await inject({
      method: "GET",
      url: `/api/v1/campaigns/${fixture.campaignId}`,
    });
    const campaignProgress = publicCampaign.json().data;
    expect(campaignProgress).toMatchObject({
      pickupPoint: {
        id: fixture.pointId,
        businessHours: "09:00-20:00",
        contactPhone: "13800000000",
      },
      items: [
        {
          skuId: fixture.skuId,
          paidQuantity: campaignProgress.paidQuantity,
        },
      ],
    });
    expect(campaignProgress.paidQuantity).toBeGreaterThanOrEqual(quantity);
    expect(campaignProgress.items[0].soldQuantity).toBeGreaterThanOrEqual(
      campaignProgress.paidQuantity,
    );
    expect(
      (
        await inject({
          method: "GET",
          url: `/api/v1/orders/${order.id}`,
          headers: customer,
        })
      ).json().data.status,
    ).toBe("PAID_WAITING_CLOSE");
    return order as { id: string; orderNo: string };
  }

  async function closeCampaign(campaignId: string) {
    const closed = await inject({
      method: "POST",
      url: `/api/v1/admin/campaigns/${campaignId}/close`,
      headers: admin,
      payload: { reason: "运营手动截单" },
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().data.status).toBe("LOCKED");
  }

  async function dispatchCampaign(fixture: Fixture) {
    const booked = await inject({
      method: "POST",
      url: `/api/v1/admin/delivery-plans/${fixture.deliveryPlanId}/book-vehicle`,
      headers: admin,
      payload: {
        logisticsPlatform: "社区合作车队",
        vehicleOrderNo: `CAR-${randomUUID()}`,
        driverName: "张师傅",
        driverPhone: "13800000000",
        vehiclePlate: "京A12345",
        estimatedArrivalAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    expect(booked.statusCode, booked.body).toBe(200);
    const batch = await inject({
      method: "POST",
      url: "/api/v1/admin/dispatch-batches",
      headers: admin,
      payload: { campaignId: fixture.campaignId },
    });
    expect(batch.statusCode, batch.body).toBe(201);
    const batchId = batch.json().data.id as string;
    const dispatched = await inject({
      method: "POST",
      url: `/api/v1/admin/dispatch-batches/${batchId}/dispatch`,
      headers: admin,
    });
    expect(dispatched.statusCode, dispatched.body).toBe(200);
    return batchId;
  }

  async function addPickupManager(id: string, pickupPointId: string) {
    const now = new Date().toISOString();
    await store.saveUser({
      id,
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: now,
    });
    await store.saveInternalStaff({
      userId: id,
      staffNo: `STF-${id}`,
      displayName: `负责人${id}`,
      phone: id === "manager-a" ? "13800000001" : "13800000002",
      role: "PICKUP_MANAGER",
      status: "ACTIVE",
      createdBy: "admin",
      activatedAt: now,
      suspendedAt: null,
      suspensionReason: null,
      createdAt: now,
      updatedAt: now,
    });
    await store.replaceStaffPickupPointAssignments(id, [
      {
        staffUserId: id,
        pickupPointId,
        assignedBy: "admin",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }

  const arrivalPayload = (skuId: string, quantities = { received: 2, short: 0, damaged: 0 }) => ({
    receivedBy: "点位负责人李四",
    confirmationNote: "现场清点完成",
    items: [
      {
        catalogSkuId: skuId,
        receivedQuantity: quantities.received,
        rejectedQuantity: 0,
        shortQuantity: quantities.short,
        damagedQuantity: quantities.damaged,
        reason:
          quantities.short > 0
            ? "SHORT_RECEIPT"
            : quantities.damaged > 0
              ? "TRANSIT_DAMAGE"
              : null,
        evidenceNote:
          quantities.short + quantities.damaged > 0 ? "现场已登记差异" : null,
      },
    ],
  });

  it("limits arrival confirmation to an assigned pickup manager and opens normal arrivals for pickup", async () => {
    const fixture = await createOpenCampaign();
    const order = await createAndPayOrder(fixture);
    await closeCampaign(fixture.campaignId);
    const batchId = await dispatchCampaign(fixture);
    await addPickupManager("manager-a", fixture.pointId);
    const payload = arrivalPayload(fixture.skuId);
    const arrivalUrl = `/api/v1/admin/community/dispatch-batches/${batchId}/arrival`;

    for (const role of ["OPERATOR", "CUSTOMER_SERVICE", "FINANCE", "USER"]) {
      const forbidden = await inject({
        method: "POST",
        url: arrivalUrl,
        headers: { "x-demo-user-id": `${role.toLowerCase()}-actor`, "x-demo-role": role },
        payload,
      });
      expect(forbidden.statusCode, `${role}: ${forbidden.body}`).toBe(403);
    }
    const managerWithEmergencyReason = await inject({
      method: "POST",
      url: arrivalUrl,
      headers: { "x-demo-user-id": "manager-a", "x-demo-role": "PICKUP_MANAGER" },
      payload: { ...payload, emergencyReason: "不应由点位负责人填写" },
    });
    expect(managerWithEmergencyReason.statusCode).toBe(403);

    const arrived = await inject({
      method: "POST",
      url: arrivalUrl,
      headers: { "x-demo-user-id": "manager-a", "x-demo-role": "PICKUP_MANAGER" },
      payload,
    });
    expect(arrived.statusCode, arrived.body).toBe(200);
    expect(arrived.json().data.status).toBe("COMPLETED");
    const replay = await inject({
      method: "POST",
      url: arrivalUrl,
      headers: { "x-demo-user-id": "manager-a", "x-demo-role": "PICKUP_MANAGER" },
      payload,
    });
    expect(replay.json().data.id).toBe(arrived.json().data.id);
    expect(
      (
        await inject({
          method: "GET",
          url: `/api/v1/orders/${order.id}`,
          headers: customer,
        })
      ).json().data.status,
    ).toBe("READY_FOR_PICKUP");
    expect(
      (
        await inject({
          method: "GET",
          url: `/api/v1/pickup-code?orderId=${order.id}`,
          headers: customer,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("rejects cross-point arrival and requires a super-admin emergency reason before confirming a difference", async () => {
    const fixture = await createOpenCampaign();
    const order = await createAndPayOrder(fixture);
    await closeCampaign(fixture.campaignId);
    const batchId = await dispatchCampaign(fixture);
    const otherPointId = `point-other-${randomUUID()}`;
    const now = new Date().toISOString();
    await store.savePickupPoint({
      id: otherPointId,
      serviceAreaId: fixture.areaId,
      name: "西门社区自提点",
      address: "西门社区服务站 2 号",
      businessHours: "09:00-20:00",
      pickupInstructions: "请出示核销码",
      latitude: 39.9,
      longitude: 116.4,
      contactName: "王店长",
      contactPhone: "13800000003",
      status: "ACTIVE",
      capacityPerDay: 100,
      createdAt: now,
    });
    await addPickupManager("manager-b", otherPointId);
    const payload = arrivalPayload(fixture.skuId, { received: 1, short: 0, damaged: 1 });
    const arrivalUrl = `/api/v1/admin/community/dispatch-batches/${batchId}/arrival`;
    const crossPoint = await inject({
      method: "POST",
      url: arrivalUrl,
      headers: { "x-demo-user-id": "manager-b", "x-demo-role": "PICKUP_MANAGER" },
      payload,
    });
    expect(crossPoint.statusCode).toBe(403);
    const missingReason = await inject({
      method: "POST",
      url: arrivalUrl,
      headers: admin,
      payload,
    });
    expect(missingReason.statusCode).toBe(400);
    expect(missingReason.json().message).toContain("紧急代办必须填写");
    const emergency = await inject({
      method: "POST",
      url: arrivalUrl,
      headers: admin,
      payload: { ...payload, emergencyReason: "点位负责人因突发事故无法操作" },
    });
    expect(emergency.statusCode, emergency.body).toBe(200);
    expect(emergency.json().data.status).toBe("EXCEPTION");
    const emergencyAudit = (
      await inject({
        method: "GET",
        url: "/api/v1/admin/audit-logs",
        headers: admin,
      })
    ).json().data.find(
      (entry: { action: string }) =>
        entry.action === "COMMUNITY_DELIVERY_EMERGENCY_CONFIRMED",
    );
    expect(emergencyAudit).toMatchObject({
      actorId: "admin",
      afterData: {
        emergencyProxy: true,
        emergencyReason: "点位负责人因突发事故无法操作",
      },
    });
    expect(emergencyAudit.createdAt).toEqual(expect.any(String));
    const delivery = (
      await inject({
        method: "GET",
        url: "/api/v1/admin/community/deliveries",
        headers: admin,
      })
    ).json().data[0];
    const confirmed = await inject({
      method: "POST",
      url: `/api/v1/admin/community/deliveries/${delivery.communityDeliveryId}/allocation-draft/confirm`,
      headers: { "x-demo-user-id": "operator", "x-demo-role": "OPERATOR" },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(
      (
        await inject({
          method: "GET",
          url: `/api/v1/orders/${order.id}`,
          headers: customer,
        })
      ).json().data.status,
    ).toBe("READY_FOR_PICKUP");
  });

  it("only reads stable packing labels for a locked campaign's paid orders", async () => {
    const fixture = await createOpenCampaign();
    const first = await createAndPayOrder(fixture, 1);
    const second = await createAndPayOrder(fixture, 1);
    const unpaid = await inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { ...customer, "idempotency-key": `unpaid-${randomUUID()}` },
      payload: {
        campaignId: fixture.campaignId,
        serviceAreaId: fixture.areaId,
        pickupPointId: fixture.pointId,
        items: [{ skuId: fixture.skuId, quantity: 1 }],
      },
    });
    expect(unpaid.statusCode, unpaid.body).toBe(201);
    const beforeCutoff = await inject({
      method: "GET",
      url: `/api/v1/admin/campaigns/${fixture.campaignId}/packing-labels`,
      headers: admin,
    });
    expect(beforeCutoff.statusCode).toBe(409);
    await closeCampaign(fixture.campaignId);
    const labels = await inject({
      method: "GET",
      url: `/api/v1/admin/campaigns/${fixture.campaignId}/packing-labels`,
      headers: admin,
    });
    expect(labels.statusCode, labels.body).toBe(200);
    const data = labels.json().data as Array<{
      orderId: string;
      orderNo: string;
      paidAt: string;
      pickupPointId: string;
      pickupPointName: string | null;
      items: Array<{ catalogSkuId: string; quantity: number }>;
    }>;
    expect(data.map((label) => label.orderId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(data).toEqual(
      [...data].sort(
        (left, right) =>
          left.paidAt.localeCompare(right.paidAt) ||
          left.orderNo.localeCompare(right.orderNo),
      ),
    );
    expect(data[0]).toMatchObject({
      pickupPointId: fixture.pointId,
      pickupPointName: "东门社区自提点",
      items: [{ catalogSkuId: fixture.skuId, quantity: 1 }],
    });
    const replay = await inject({
      method: "GET",
      url: `/api/v1/admin/campaigns/${fixture.campaignId}/packing-labels`,
      headers: admin,
    });
    expect(replay.json().data).toEqual(data);
    await dispatchCampaign(fixture);
    const deliveries = await inject({
      method: "GET",
      url: "/api/v1/admin/community/deliveries",
      headers: admin,
    });
    expect(deliveries.statusCode, deliveries.body).toBe(200);
    expect(deliveries.json().data[0].expectedItems).toMatchObject([
      { catalogSkuId: fixture.skuId, expectedQuantity: 2 },
    ]);
    await store.transaction(async (transactionStore) => {
      const pickedOrder = await transactionStore.getOrderForUpdate(first.id);
      expect(pickedOrder).not.toBeNull();
      pickedOrder!.status = "PICKED_UP";
      await transactionStore.saveOrderStatus(pickedOrder!);
    });
    const reprintAfterPickup = await inject({
      method: "GET",
      url: `/api/v1/admin/campaigns/${fixture.campaignId}/packing-labels`,
      headers: admin,
    });
    expect(reprintAfterPickup.statusCode, reprintAfterPickup.body).toBe(200);
    expect(
      (reprintAfterPickup.json().data as Array<{ orderId: string }>).map(
        (label) => label.orderId,
      ),
    ).toContain(first.id);
  });

  it("keeps expired pickup extension, refund, and loss responsibilities closed", async () => {
    const operator = {
      "x-demo-user-id": "operator",
      "x-demo-role": "OPERATOR",
    };
    const finance = {
      "x-demo-user-id": "finance",
      "x-demo-role": "FINANCE",
    };
    const arrive = async (fixture: Fixture, quantity = 1) => {
      const batchId = await dispatchCampaign(fixture);
      const arrival = await inject({
        method: "POST",
        url: `/api/v1/admin/community/dispatch-batches/${batchId}/arrival`,
        headers: admin,
        payload: {
          ...arrivalPayload(fixture.skuId, { received: quantity, short: 0, damaged: 0 }),
          emergencyReason: "测试环境由平台代办正常到货",
        },
      });
      expect(arrival.statusCode, arrival.body).toBe(200);
    };
    const expire = async (orderId: string) => {
      const window = await store.getCommunityPickupWindowForUpdate(orderId);
      expect(window).not.toBeNull();
      window!.status = "EXPIRED_PENDING";
      window!.deadlineAt = new Date(Date.now() - 1_000).toISOString();
      await store.saveCommunityPickupWindow(window!);
    };

    const extensionFixture = await createOpenCampaign();
    const extensionOrder = await createAndPayOrder(extensionFixture, 1);
    await closeCampaign(extensionFixture.campaignId);
    await arrive(extensionFixture);
    await expire(extensionOrder.id);
    const oldDeadline = (await store.getCommunityPickupWindowForUpdate(extensionOrder.id))!
      .deadlineAt;
    const extended = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${extensionOrder.id}/pickup-extension`,
      headers: operator,
      payload: {
        deadlineAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        note: "用户约定次日领取，运营批准一次延期",
      },
    });
    expect(extended.statusCode, extended.body).toBe(200);
    expect(extended.json().data).toMatchObject({ status: "EXTENDED", extensionCount: 1 });
    expect(extended.json().data.deadlineAt).not.toBe(oldDeadline);
    const secondExtension = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${extensionOrder.id}/pickup-extension`,
      headers: operator,
      payload: {
        deadlineAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        note: "第二次延期必须被拒绝",
      },
    });
    expect(secondExtension.statusCode).toBe(409);
    await addPickupManager("manager-a", extensionFixture.pointId);
    const extensionCode = await inject({
      method: "GET",
      url: `/api/v1/pickup-code?orderId=${extensionOrder.id}`,
      headers: customer,
    });
    const extensionPickup = await inject({
      method: "POST",
      url: "/api/v1/pickup/verify",
      headers: { "x-demo-user-id": "manager-a", "x-demo-role": "PICKUP_MANAGER" },
      payload: {
        orderId: extensionOrder.id,
        deliveryPlanId: extensionFixture.deliveryPlanId,
        code: extensionCode.json().data.code,
        pickupRequestId: randomUUID(),
        items: [{ catalogSkuId: extensionFixture.skuId, quantity: 1 }],
      },
    });
    expect(extensionPickup.statusCode, extensionPickup.body).toBe(200);

    const refundFixture = await createOpenCampaign();
    const refundOrder = await createAndPayOrder(refundFixture, 1);
    await closeCampaign(refundFixture.campaignId);
    await arrive(refundFixture);
    await expire(refundOrder.id);
    const financeDisposition = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${refundOrder.id}/pickup-disposition`,
      headers: finance,
      payload: { action: "REFUND", note: "财务不得登记运营处置" },
    });
    expect(financeDisposition.statusCode).toBe(403);
    const refundPending = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${refundOrder.id}/pickup-disposition`,
      headers: operator,
      payload: { action: "REFUND", note: "逾期未领取，运营登记退款" },
    });
    expect(refundPending.statusCode, refundPending.body).toBe(200);
    expect(refundPending.json().data.status).toBe("REFUND_PENDING");
    expect((await store.getPickupCredential(refundOrder.id))?.status).toBe("REVOKED");
    const settled = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${refundOrder.id}/pickup-refund`,
      headers: finance,
    });
    expect(settled.statusCode, settled.body).toBe(200);
    expect(settled.json().data.status).toBe("CLOSED");
    const replaySettlement = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${refundOrder.id}/pickup-refund`,
      headers: finance,
    });
    expect(replaySettlement.statusCode, replaySettlement.body).toBe(200);
    const refunds = await store.listPartialRefundsByOrder(refundOrder.id);
    expect(refunds).toHaveLength(1);
    expect((await store.listLedgerTransactions()).filter(
      (entry) => entry.eventType === "PARTIAL_REFUND_SUCCEEDED",
    )).toHaveLength(1);

    const lossFixture = await createOpenCampaign();
    const lossOrder = await createAndPayOrder(lossFixture, 1);
    await closeCampaign(lossFixture.campaignId);
    await arrive(lossFixture);
    await expire(lossOrder.id);
    const loss = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${lossOrder.id}/pickup-disposition`,
      headers: operator,
      payload: { action: "LOSS", note: "逾期未领取，点位登记报损" },
    });
    expect(loss.statusCode, loss.body).toBe(200);
    expect(loss.json().data.status).toBe("CLOSED");
    expect((await store.getPickupCredential(lossOrder.id))?.status).toBe("REVOKED");
    expect((await store.getOrder(lossOrder.id))?.status).toBe("COMPLETED");
  });

  it("runs paid order through dispatch, arrival, split pickup and quality refund", async () => {
    const fixture = await createOpenCampaign();
    const order = await createAndPayOrder(fixture, 2);
    await closeCampaign(fixture.campaignId);

    const labels = await inject({
      method: "GET",
      url: `/api/v1/admin/campaigns/${fixture.campaignId}/packing-labels`,
      headers: admin,
    });
    expect(labels.json().data).toMatchObject([
      { orderId: order.id, items: [{ catalogSkuId: fixture.skuId, quantity: 2 }] },
    ]);
    const booked = await inject({
      method: "POST",
      url: `/api/v1/admin/delivery-plans/${fixture.deliveryPlanId}/book-vehicle`,
      headers: admin,
      payload: {
        logisticsPlatform: "社区合作车队",
        vehicleOrderNo: "CAR-20260821-01",
        driverName: "张师傅",
        driverPhone: "13800000000",
        vehiclePlate: "京A12345",
        estimatedArrivalAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    expect(booked.statusCode, booked.body).toBe(200);
    const batch = await inject({
      method: "POST",
      url: "/api/v1/admin/dispatch-batches",
      headers: admin,
      payload: { campaignId: fixture.campaignId },
    });
    expect(batch.statusCode, batch.body).toBe(201);
    const batchId = batch.json().data.id as string;
    expect(
      (
        await inject({
          method: "POST",
          url: `/api/v1/admin/dispatch-batches/${batchId}/dispatch`,
          headers: admin,
        })
      ).json().data.status,
    ).toBe("IN_TRANSIT");
    const deliveryList = await inject({
      method: "GET",
      url: "/api/v1/admin/community/deliveries",
      headers: admin,
    });
    expect(deliveryList.json().data[0].expectedItems[0].expectedQuantity).toBe(2);

    const arrivalPayload = {
      receivedBy: "点位负责人张三",
      confirmationNote: "数量和外包装无误",
      emergencyReason: "负责人网络故障，平台紧急代办",
      items: [
        {
          catalogSkuId: fixture.skuId,
          receivedQuantity: 2,
          rejectedQuantity: 0,
          shortQuantity: 0,
          damagedQuantity: 0,
          reason: null,
          evidenceNote: null,
        },
      ],
    };
    const arrival = await inject({
      method: "POST",
      url: `/api/v1/admin/community/dispatch-batches/${batchId}/arrival`,
      headers: admin,
      payload: arrivalPayload,
    });
    expect(arrival.statusCode, arrival.body).toBe(200);
    expect(arrival.json().data.status).toBe("COMPLETED");
    const replayArrival = await inject({
      method: "POST",
      url: `/api/v1/admin/community/dispatch-batches/${batchId}/arrival`,
      headers: admin,
      payload: arrivalPayload,
    });
    expect(replayArrival.json().data.id).toBe(arrival.json().data.id);

    const prematureExtension = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${order.id}/pickup-extension`,
      headers: admin,
      payload: {
        deadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        note: "未逾期时不得提前延期",
      },
    });
    expect(prematureExtension.statusCode).toBe(409);
    const expiredWindow = await store.getCommunityPickupWindowForUpdate(order.id);
    expect(expiredWindow).not.toBeNull();
    expiredWindow!.status = "EXPIRED_PENDING";
    expiredWindow!.deadlineAt = new Date(Date.now() - 1_000).toISOString();
    await store.saveCommunityPickupWindow(expiredWindow!);

    const extension = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${order.id}/pickup-extension`,
      headers: admin,
      payload: {
        deadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        note: "用户出行不便，批准一次延期领取",
      },
    });
    expect(extension.statusCode, extension.body).toBe(200);
    expect(extension.json().data.status).toBe("EXTENDED");
    const duplicateExtension = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${order.id}/pickup-extension`,
      headers: admin,
      payload: {
        deadlineAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
        note: "尝试再次延期应被拒绝",
      },
    });
    expect(duplicateExtension.statusCode).toBe(409);

    const credential = await inject({
      method: "GET",
      url: `/api/v1/pickup-code?orderId=${order.id}`,
      headers: customer,
    });
    expect(credential.statusCode, credential.body).toBe(200);
    const code = credential.json().data.code as string;
    await addPickupManager("manager-a", fixture.pointId);
    const superLookup = await inject({
      method: "GET",
      url: `/api/v1/pickup/orders/lookup?deliveryPlanId=${fixture.deliveryPlanId}&orderNo=${order.orderNo}`,
      headers: admin,
    });
    expect(superLookup.statusCode).toBe(403);
    const lookup = await inject({
      method: "GET",
      url: `/api/v1/pickup/orders/lookup?deliveryPlanId=${fixture.deliveryPlanId}&orderNo=${order.orderNo}`,
      headers: { "x-demo-user-id": "manager-a", "x-demo-role": "PICKUP_MANAGER" },
    });
    expect(lookup.json().data.items[0].remainingPickupQuantity).toBe(2);
    for (let pickup = 0; pickup < 2; pickup += 1) {
      const pickupRequestId = randomUUID();
      const verified = await inject({
        method: "POST",
        url: "/api/v1/pickup/verify",
        headers: { "x-demo-user-id": "manager-a", "x-demo-role": "PICKUP_MANAGER" },
        payload: {
          orderId: order.id,
          deliveryPlanId: fixture.deliveryPlanId,
          code,
          pickupRequestId,
          items: [{ catalogSkuId: fixture.skuId, quantity: 1 }],
        },
      });
      expect(verified.statusCode, verified.body).toBe(200);
      expect(verified.json().data.items[0].pickedUpQuantity).toBe(pickup + 1);
      if (pickup === 0) {
        const replay = await inject({
          method: "POST",
          url: "/api/v1/pickup/verify",
          headers: { "x-demo-user-id": "manager-a", "x-demo-role": "PICKUP_MANAGER" },
          payload: {
            orderId: order.id,
            deliveryPlanId: fixture.deliveryPlanId,
            code,
            pickupRequestId,
            items: [{ catalogSkuId: fixture.skuId, quantity: 1 }],
          },
        });
        expect(replay.json().data.items[0].pickedUpQuantity).toBe(1);
      }
    }

    const pickedUpOrder = await inject({
      method: "GET",
      url: `/api/v1/orders/${order.id}`,
      headers: customer,
    });
    expect(pickedUpOrder.statusCode, pickedUpOrder.body).toBe(200);
    expect(pickedUpOrder.json().data.pickupReceipts).toHaveLength(2);
    for (const receipt of pickedUpOrder.json().data.pickupReceipts) {
      expect(
        Date.parse(receipt.qualityDeadlineAt) - Date.parse(receipt.pickedUpAt),
      ).toBe(24 * 60 * 60 * 1000);
      expect(receipt).toMatchObject({
        qualityWindowOpen: true,
        quantity: 1,
        items: [{ skuId: fixture.skuId, quantity: 1 }],
      });
    }
    expect(pickedUpOrder.json().data.pickupDeadlineAt).toBe(
      extension.json().data.deadlineAt,
    );

    const quality = await inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/quality-cases`,
      headers: customer,
      payload: {
        clientRequestId: `quality-${randomUUID()}`,
        items: [
          {
            catalogSkuId: fixture.skuId,
            quantity: 1,
            reason: "QUALITY_CLAIM",
            description: "领取后发现一份番茄存在明显腐坏",
          },
        ],
      },
    });
    expect(quality.statusCode, quality.body).toBe(201);
    const qualityId = quality.json().data.id as string;
    expect(
      (
        await inject({
          method: "POST",
          url: `/api/v1/admin/quality-cases/${qualityId}/accept`,
          headers: admin,
          payload: { note: "客服已核实用户描述" },
        })
      ).json().data.status,
    ).toBe("ACCEPTED");
    expect(
      (
        await inject({
          method: "POST",
          url: `/api/v1/admin/quality-cases/${qualityId}/decision`,
          headers: admin,
          payload: { approved: true, note: "运营确认按一份原价退款" },
        })
      ).json().data.status,
    ).toBe("REFUNDING");
    const refunded = await inject({
      method: "POST",
      url: `/api/v1/admin/quality-cases/${qualityId}/refund`,
      headers: admin,
    });
    expect(refunded.statusCode, refunded.body).toBe(200);
    expect(refunded.json().data.status).toBe("RESOLVED");
    expect(refunded.json().data.financeRefundStatus).toBe("SUCCEEDED");
    expect((await store.listPartialRefundsByOrder(order.id))[0]).toMatchObject({
      amountCents: 1500,
      status: "SUCCEEDED",
    });
  });

  it("separates pending cancellation from post-cutoff reviewed refund", async () => {
    const pendingFixture = await createOpenCampaign();
    const pendingPayload = {
      campaignId: pendingFixture.campaignId,
      serviceAreaId: pendingFixture.areaId,
      pickupPointId: pendingFixture.pointId,
      items: [{ skuId: pendingFixture.skuId, quantity: 1 }],
    };
    const pending = await inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { ...customer, "idempotency-key": `pending-${randomUUID()}` },
      payload: pendingPayload,
    });
    const pendingId = pending.json().data.id as string;
    const pendingProgress = (
      await inject({
        method: "GET",
        url: `/api/v1/campaigns/${pendingFixture.campaignId}`,
      })
    ).json().data;
    expect(pendingProgress.paidQuantity).toBe(0);
    expect(pendingProgress.items[0].soldQuantity).toBe(1);
    const cancelled = await inject({
      method: "POST",
      url: `/api/v1/orders/${pendingId}/cancel`,
      headers: customer,
      payload: { reason: "下单后发现数量选错" },
    });
    expect(cancelled.json().data.status).toBe("CANCELLED");

    const directPaid = await createAndPayOrder(pendingFixture, 1);
    const directRefund = await inject({
      method: "POST",
      url: `/api/v1/orders/${directPaid.id}/cancel`,
      headers: customer,
      payload: { reason: "截单前取消并原路退款" },
    });
    expect(directRefund.statusCode, directRefund.body).toBe(200);
    expect(directRefund.json().data.status).toBe("DIRECT_REFUNDING");
    expect((await store.getOrder(directPaid.id))?.status).toBe("REFUNDED");
    expect(
      (
        await inject({
          method: "GET",
          url: `/api/v1/campaigns/${pendingFixture.campaignId}`,
        })
      ).json().data.paidQuantity,
    ).toBe(0);

    const fixture = await createOpenCampaign();
    const paid = await createAndPayOrder(fixture, 1);
    const rejectedOrder = await createAndPayOrder(fixture, 1);
    await closeCampaign(fixture.campaignId);
    const requested = await inject({
      method: "POST",
      url: `/api/v1/orders/${paid.id}/cancel`,
      headers: customer,
      payload: { reason: "截单后因临时出差无法领取" },
    });
    expect(requested.statusCode, requested.body).toBe(200);
    expect(requested.json().data.status).toBe("PENDING_REVIEW");
    await inject({
      method: "POST",
      url: `/api/v1/orders/${rejectedOrder.id}/cancel`,
      headers: customer,
      payload: { reason: "希望取消但已进入统一备货" },
    });
    const rejected = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${rejectedOrder.id}/cancellation/review`,
      headers: admin,
      payload: { approved: false, note: "订单已完成装袋，不能取消" },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json().data.status).toBe("REJECTED");
    const reviewed = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${paid.id}/cancellation/review`,
      headers: admin,
      payload: { approved: true, note: "运营确认尚未开始装袋，同意取消" },
    });
    expect(reviewed.json().data.status).toBe("APPROVED_WAITING_FINANCE");
    const refund = await inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${paid.id}/cancellation/refund`,
      headers: admin,
    });
    expect(refund.statusCode, refund.body).toBe(200);
    expect(refund.json().data.status).toBe("REFUNDED");
    expect((await store.getOrder(paid.id))?.status).toBe("REFUNDED");
    const requests = (
      await inject({
        method: "GET",
        url: "/api/v1/admin/community/cancellation-requests",
        headers: admin,
      })
    ).json().data as Array<{ orderId: string; status: string }>;
    expect(requests).toHaveLength(3);
    expect(requests.find((value) => value.orderId === paid.id)?.status).toBe(
      "REFUNDED",
    );
    expect(
      requests.find((value) => value.orderId === rejectedOrder.id)?.status,
    ).toBe("REJECTED");
  });

  it("keeps transport controls available to operator and super-admin, with audited emergency correction", async () => {
    const fixture = await createOpenCampaign();
    const order = await createAndPayOrder(fixture, 1);
    await createAndPayOrder(fixture, 1);
    await closeCampaign(fixture.campaignId);

    const customerServiceBook = await inject({
      method: "POST",
      url: `/api/v1/admin/delivery-plans/${fixture.deliveryPlanId}/book-vehicle`,
      headers: { "x-demo-user-id": "cs", "x-demo-role": "CUSTOMER_SERVICE" },
      payload: {
        logisticsPlatform: "不应可见",
        vehicleOrderNo: "NOPE",
      },
    });
    expect(customerServiceBook.statusCode).toBe(403);

    const booked = await inject({
      method: "POST",
      url: `/api/v1/admin/delivery-plans/${fixture.deliveryPlanId}/book-vehicle`,
      headers: { "x-demo-user-id": "operator", "x-demo-role": "OPERATOR" },
      payload: {
        logisticsPlatform: "社区合作车队",
        vehicleOrderNo: "CAR-OPERATOR-1",
        driverName: "张师傅",
        driverPhone: "13800000000",
        vehiclePlate: "京A12345",
        estimatedArrivalAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    expect(booked.statusCode, booked.body).toBe(200);

    const edited = await inject({
      method: "POST",
      url: `/api/v1/admin/delivery-plans/${fixture.deliveryPlanId}/book-vehicle`,
      headers: admin,
      payload: {
        logisticsPlatform: "社区合作车队",
        vehicleOrderNo: "CAR-SUPER-2",
        driverName: "李师傅",
        driverPhone: "13900000000",
        vehiclePlate: "京A54321",
        estimatedArrivalAt: new Date(Date.now() + 4_000_000).toISOString(),
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().data.vehicleOrderNo).toBe("CAR-SUPER-2");

    const batch = await inject({
      method: "POST",
      url: "/api/v1/admin/dispatch-batches",
      headers: { "x-demo-user-id": "operator", "x-demo-role": "OPERATOR" },
      payload: { campaignId: fixture.campaignId },
    });
    expect(batch.statusCode, batch.body).toBe(201);
    const batchId = batch.json().data.id as string;
    const dispatched = await inject({
      method: "POST",
      url: `/api/v1/admin/dispatch-batches/${batchId}/dispatch`,
      headers: admin,
    });
    expect(dispatched.statusCode, dispatched.body).toBe(200);
    expect(dispatched.json().data.status).toBe("IN_TRANSIT");

    const operatorCorrection = await inject({
      method: "POST",
      url: `/api/v1/admin/delivery-plans/${fixture.deliveryPlanId}/emergency-correction`,
      headers: { "x-demo-user-id": "operator", "x-demo-role": "OPERATOR" },
      payload: {
        logisticsPlatform: "社区合作车队",
        vehicleOrderNo: "CAR-OPERATOR-LATE",
        reason: "越权测试",
      },
    });
    expect(operatorCorrection.statusCode).toBe(403);
    const missingReason = await inject({
      method: "POST",
      url: `/api/v1/admin/delivery-plans/${fixture.deliveryPlanId}/emergency-correction`,
      headers: admin,
      payload: {
        logisticsPlatform: "社区合作车队",
        vehicleOrderNo: "CAR-SUPER-LATE",
      },
    });
    expect(missingReason.statusCode).toBe(400);
    const corrected = await inject({
      method: "POST",
      url: `/api/v1/admin/delivery-plans/${fixture.deliveryPlanId}/emergency-correction`,
      headers: admin,
      payload: {
        logisticsPlatform: "社区合作车队",
        vehicleOrderNo: "CAR-SUPER-LATE",
        driverName: "王师傅",
        driverPhone: "13700000000",
        vehiclePlate: "京A99999",
        estimatedArrivalAt: new Date(Date.now() + 5_000_000).toISOString(),
        reason: "原车辆临时故障，已核验替换车辆",
      },
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json().data.status).toBe("IN_TRANSIT");
    const auditRows = (
      await inject({ method: "GET", url: "/api/v1/admin/audit-logs", headers: admin })
    ).json().data as Array<{ action: string; afterData: unknown }>;
    expect(auditRows.some((row) => row.action === "DELIVERY_VEHICLE_EMERGENCY_CORRECTED")).toBe(true);

    const detail = await inject({
      method: "GET",
      url: `/api/v1/admin/orders?orderNo=${encodeURIComponent(order.orderNo)}`,
      headers: { "x-demo-user-id": "operator", "x-demo-role": "OPERATOR" },
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().data).toHaveLength(1);
    expect(detail.json().data[0]).toMatchObject({
      orderNo: order.orderNo,
      campaignTitle: "周末社区蔬菜团",
      pickupPointName: "东门社区自提点",
      items: [
        {
          productTitle: "当季番茄组合",
          skuName: "每份 2 斤",
          quantity: 1,
        },
      ],
    });
    const originalFacts = store.listOrderDeliveryFacts.bind(store);
    let factsCalls = 0;
    store.listOrderDeliveryFacts = async (orderIds) => {
      factsCalls += 1;
      return originalFacts(orderIds);
    };
    const list = await inject({
      method: "GET",
      url: "/api/v1/admin/orders",
      headers: { "x-demo-user-id": "operator", "x-demo-role": "OPERATOR" },
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().data.length).toBeGreaterThanOrEqual(2);
    expect(factsCalls).toBe(1);
  });

  it("previews cancellation impact, requires a reason, and blocks destructive configuration changes", async () => {
    const fixture = await createOpenCampaign();
    const paid = await createAndPayOrder(fixture, 1);
    const impact = await inject({
      method: "GET",
      url: `/api/v1/admin/campaigns/${fixture.campaignId}/cancel-impact`,
      headers: admin,
    });
    expect(impact.statusCode, impact.body).toBe(200);
    expect(impact.json().data).toMatchObject({
      pendingPaymentOrderCount: 0,
      paidOrderCount: 1,
      estimatedRefundCents: 1500,
    });
    const missingReason = await inject({
      method: "POST",
      url: `/api/v1/admin/campaigns/${fixture.campaignId}/cancel`,
      headers: admin,
      payload: {},
    });
    expect(missingReason.statusCode).toBe(400);
    const areaStop = await inject({
      method: "POST",
      url: `/api/v1/admin/service-areas/${fixture.areaId}/order-status`,
      headers: admin,
      payload: { orderEnabled: false },
    });
    expect(areaStop.statusCode).toBe(409);
    expect(areaStop.json().details).toMatchObject({ campaignCount: 1 });
    const pointStop = await inject({
      method: "PATCH",
      url: `/api/v1/admin/pickup-points/${fixture.pointId}`,
      headers: admin,
      payload: { status: "INACTIVE" },
    });
    expect(pointStop.statusCode).toBe(409);
    const sku = (await store.getCatalogSku(fixture.skuId))!;
    const skuStop = await inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: admin,
      payload: {
        id: sku.id,
        productId: sku.productId,
        title: sku.product.title,
        category: sku.product.category,
        origin: sku.product.origin,
        imageUrl: sku.product.imageUrl,
        skuName: sku.name,
        retailPriceCents: Number(sku.retailPriceCents),
        defaultSellableQuantity: sku.defaultSellableQuantity,
        status: "INACTIVE",
      },
    });
    expect(skuStop.statusCode).toBe(409);

    const cancelled = await inject({
      method: "POST",
      url: `/api/v1/admin/campaigns/${fixture.campaignId}/cancel`,
      headers: admin,
      payload: { reason: "上游车辆临时取消，停止本团履约" },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().data.status).toBe("CANCELLED");
    expect((await store.getOrderRefundByOrder(paid.id))?.orderId).toBe(paid.id);
    expect((await store.getOrder(paid.id))?.status).toBe("REFUNDING");
    const cancelAudit = (
      await inject({ method: "GET", url: "/api/v1/admin/audit-logs", headers: admin })
    ).json().data as Array<{ action: string; afterData: { reason?: string } }>;
    expect(cancelAudit.find((row) => row.action === "CAMPAIGN_CANCEL")?.afterData.reason).toBe(
      "上游车辆临时取消，停止本团履约",
    );
  });
});
