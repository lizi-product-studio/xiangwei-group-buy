import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";
import type { PaymentProvider } from "./modules/payments/payment-provider.js";
import { CampaignService } from "./modules/campaigns/campaign-service.js";
import { NoopCampaignScheduler } from "./modules/campaigns/campaign-scheduler.js";
import { OrderService } from "./modules/orders/order-service.js";

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

  async function createSecondPickupCampaign(fixture: Fixture): Promise<Fixture> {
    const point = await inject({ method: "POST", url: "/api/v1/admin/pickup-points", headers: admin, payload: {
      serviceAreaId: fixture.areaId, name: "西门社区自提点", address: "西门社区服务站 2 号",
      businessHours: "09:00-20:00", pickupInstructions: "请出示核销码", latitude: 39.9,
      longitude: 116.4, contactName: "王店长", contactPhone: "13800000003", capacityPerDay: 300,
      photoUrl: "https://example.com/west-pickup.jpg",
    } });
    expect(point.statusCode, point.body).toBe(201);
    const pickupPointId = point.json().data.id as string;
    const cutoffAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const dispatchAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const campaign = await inject({ method: "POST", url: "/api/v1/admin/campaigns", headers: admin, payload: {
      title: "周末社区蔬菜团·西门", serviceAreaId: fixture.areaId, pickupPointId,
      cutoffAt, dispatchAt,
      estimatedArrivalStartAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      estimatedArrivalEndAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND",
      items: [{ catalogSkuId: fixture.skuId, retailPriceCents: 1900, sellableQuantity: 20 }],
    } });
    expect(campaign.statusCode, campaign.body).toBe(201);
    const campaignId = campaign.json().data.id as string;
    const opened = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${campaignId}/open`, headers: admin });
    expect(opened.statusCode, opened.body).toBe(200);
    return { ...fixture, campaignId, pointId: pickupPointId, deliveryPlanId: campaign.json().data.deliveryPlan.id as string };
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

  it("paginates a consumer order history with a stable cursor and no overlaps", async () => {
    const fixture = await createOpenCampaign();
    const created = await Promise.all([
      createAndPayOrder(fixture, 1),
      createAndPayOrder(fixture, 1),
      createAndPayOrder(fixture, 1),
    ]);
    const first = await inject({ method: "GET", url: "/api/v1/orders?pageSize=2", headers: customer });
    expect(first.statusCode, first.body).toBe(200);
    const firstPage = first.json().data;
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toMatchObject({ createdAt: expect.any(String), id: expect.any(String) });

    const second = await inject({
      method: "GET",
      url: `/api/v1/orders?pageSize=2&cursorAt=${encodeURIComponent(firstPage.nextCursor.createdAt)}&cursorId=${encodeURIComponent(firstPage.nextCursor.id)}`,
      headers: customer,
    });
    expect(second.statusCode, second.body).toBe(200);
    const secondPage = second.json().data;
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.hasMore).toBe(false);
    const ids = [...firstPage.items, ...secondPage.items].map((order) => order.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(expect.arrayContaining(created.map((order) => order.id)));

    const legacy = await inject({ method: "GET", url: "/api/v1/orders", headers: customer });
    expect(legacy.json().data.map((order: { id: string }) => order.id)).toEqual(ids);
  });

  it("applies consumer status filters before pagination", async () => {
    const now = Date.now();
    const ids: string[] = [];
    for (let index = 0; index < 21; index++) {
      const id = `status-page-${index}`;
      ids.push(id);
      const createdAt = new Date(now - (21 - index) * 60_000).toISOString();
      await store.saveOrder({
        id, orderNo: `STATUS-PAGE-${index}`, userId: "customer", campaignId: `campaign-${index}`,
        serviceAreaId: "area", pickupPointId: "point", deliveryPlanId: "plan",
        status: index === 0 ? "READY_FOR_PICKUP" : "CANCELLED", totalCents: 100,
        items: [], createdAt, expiresAt: createdAt, paidAt: createdAt, pickedUpAt: null,
      });
    }

    const ready = await inject({ method: "GET", url: "/api/v1/orders?pageSize=1&filter=READY", headers: customer });
    expect(ready.statusCode, ready.body).toBe(200);
    expect(ready.json().data.items.map((order: { id: string }) => order.id)).toEqual([ids[0]]);
    expect(ready.json().data.hasMore).toBe(false);

    const after = await inject({ method: "GET", url: "/api/v1/orders?pageSize=2&filter=AFTER", headers: customer });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json().data.items).toHaveLength(2);
    expect(after.json().data.items.every((order: { status: string }) => order.status === "CANCELLED")).toBe(true);
    expect(after.json().data.hasMore).toBe(true);

    const qualityOrders = [
      { id: "status-page-quality-order-open", status: "PICKED_UP" as const, caseStatus: "REGISTERED" as const, userId: "customer" },
      { id: "status-page-quality-order-resolved", status: "COMPLETED" as const, caseStatus: "RESOLVED" as const, userId: "customer" },
      { id: "status-page-quality-order-other-user", status: "COMPLETED" as const, caseStatus: "REGISTERED" as const, userId: "another-customer" },
    ];
    for (const [index, value] of qualityOrders.entries()) {
      const qualityCreatedAt = new Date(now + index + 1).toISOString();
      const userId = value.userId;
      await store.saveOrder({
        id: value.id, orderNo: `STATUS-PAGE-${value.id}`, userId, campaignId: "campaign-quality",
        serviceAreaId: "area", pickupPointId: "point", deliveryPlanId: "plan",
        status: value.status, totalCents: 100, items: [], createdAt: qualityCreatedAt,
        expiresAt: qualityCreatedAt, paidAt: qualityCreatedAt, pickedUpAt: qualityCreatedAt,
      });
      await store.saveCommunityQualityCase({
        id: `case-${value.id}`, orderId: value.id, userId,
        clientRequestId: `request-${value.id}`, payloadHash: `hash-${value.id}`,
        status: value.caseStatus, registeredAt: qualityCreatedAt, acceptedBy: null, acceptedAt: null,
        acceptanceNote: null, decisionBy: null, decidedAt: null, decisionNote: null,
        refundApprovedBy: null, refundApprovedAt: null, financeExecutedBy: null,
        financeExecutedAt: null, refundExceptionId: null, items: [],
      });
    }
    const afterWithQualityCase = await inject({ method: "GET", url: "/api/v1/orders?pageSize=2&filter=AFTER", headers: customer });
    expect(afterWithQualityCase.statusCode, afterWithQualityCase.body).toBe(200);
    const afterPageOne = afterWithQualityCase.json().data;
    expect(afterPageOne.items.map((order: { id: string }) => order.id)).toEqual([
      "status-page-quality-order-resolved", "status-page-quality-order-open",
    ]);
    expect(afterWithQualityCase.json().data.hasMore).toBe(true);
    const afterPageTwo = await inject({
      method: "GET",
      url: `/api/v1/orders?pageSize=2&filter=AFTER&cursorAt=${encodeURIComponent(afterPageOne.nextCursor.createdAt)}&cursorId=${afterPageOne.nextCursor.id}`,
      headers: customer,
    });
    expect(afterPageTwo.statusCode, afterPageTwo.body).toBe(200);
    expect(afterPageTwo.json().data.items.map((order: { id: string }) => order.id)).not.toContain("status-page-quality-order-other-user");
    expect(afterPageTwo.json().data.items.map((order: { id: string }) => order.id)).not.toContain("status-page-quality-order-open");
  });

  it("opens and closes an all-points campaign as one cutoff and counts paid units once", async () => {
    const fixture = await createOpenCampaign();
    const secondPoint = await inject({ method: "POST", url: "/api/v1/admin/pickup-points", headers: admin, payload: {
      serviceAreaId: fixture.areaId, name: "西门合计自提点", address: "西门社区服务站 2 号",
      businessHours: "09:00-20:00", pickupInstructions: "请出示核销码", latitude: 39.9,
      longitude: 116.4, contactName: "王店长", contactPhone: "13800000003", capacityPerDay: 300,
      photoUrl: "https://example.com/west-pickup.jpg",
    } });
    expect(secondPoint.statusCode, secondPoint.body).toBe(201);
    const secondPointId = secondPoint.json().data.id as string;
    const cutoffAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const groupResponse = await inject({ method: "POST", url: "/api/v1/admin/campaign-groups", headers: admin, payload: {
      title: "社区多点合计活动", cutoffAt, groupingMode: "ALL_POINTS", minTotalQuantity: 2,
      failureAction: "CANCEL_AND_REFUND",
      points: [
        { pickupPointId: fixture.pointId, dispatchAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
        { pickupPointId: secondPointId, dispatchAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
      ],
      items: [{ catalogSkuId: fixture.skuId, retailPriceCents: 1500, stockByPoint: [
        { pickupPointId: fixture.pointId, sellableQuantity: 5 },
        { pickupPointId: secondPointId, sellableQuantity: 5 },
      ] }],
    } });
    expect(groupResponse.statusCode, groupResponse.body).toBe(201);
    const group = groupResponse.json().data.group as { id: string };
    const members = groupResponse.json().data.campaigns as Array<{ id: string; status: string }>;
    expect(members).toHaveLength(2);
    expect(members.every((member) => member.status === "DRAFT")).toBe(true);

    const opened = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[0]!.id}/open`, headers: admin });
    expect(opened.statusCode, opened.body).toBe(200);
    expect((await store.listCampaigns()).filter((campaign) => campaign.campaignGroupId === group.id).map((campaign) => campaign.status)).toEqual(["OPEN", "OPEN"]);

    const publicCampaign = await inject({ method: "GET", url: `/api/v1/campaigns/${members[0]!.id}` });
    expect(publicCampaign.json().data).toMatchObject({ groupingMode: "ALL_POINTS", paidQuantity: 0 });
    const paidOrder = await createAndPayOrder({ ...fixture, campaignId: members[0]!.id }, 2);
    const closed = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[1]!.id}/close`, headers: admin, payload: { reason: "联合截单测试" } });
    expect(closed.statusCode, closed.body).toBe(200);
    const after = (await store.listCampaigns()).filter((campaign) => campaign.campaignGroupId === group.id);
    expect(after.map((campaign) => campaign.status)).toEqual(["LOCKED", "LOCKED"]);
    const paidAfterClose = await store.getOrder(paidOrder.id);
    expect(paidAfterClose?.status).toBe("LOCKED");
    expect((await store.getCampaignGroup(group.id))?.status).toBe("LOCKED");
  });

  it("counts refund-in-progress units at cutoff until the provider confirms success", async () => {
    const fixture = await createOpenCampaign();
    const campaign = await store.getCampaign(fixture.campaignId);
    expect(campaign).not.toBeNull();
    expect(await store.updateCampaign({ ...campaign!, minTotalQuantity: 2, version: campaign!.version + 1 }, campaign!.version)).toBe(true);
    const refundingOrder = await createAndPayOrder(fixture, 1);
    const ordinaryOrder = await createAndPayOrder(fixture, 1);
    const payment = await store.getPaymentByOrder(refundingOrder.id);
    expect(payment).not.toBeNull();
    await store.saveOrderStatus({ ...(await store.getOrder(refundingOrder.id))!, status: "REFUNDING" });
    await store.savePayment({ ...payment!, status: "REFUNDING" });
    await store.saveOrderRefund({
      id: `pending-close-refund-${refundingOrder.id}`, orderId: refundingOrder.id, paymentId: payment!.id,
      providerRefundNo: `PENDING-CLOSE-${refundingOrder.id}`, providerRefundId: null,
      status: "PROCESSING", amountCents: payment!.amountCents, createdAt: new Date().toISOString(),
      submissionLeaseUntil: null, submissionClaimToken: null,
    });

    expect([...(await store.getNetSalesQuantities(fixture.campaignId)).values()].reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(2);
    await closeCampaign(fixture.campaignId);
    expect((await store.getCampaign(fixture.campaignId))?.status).toBe("LOCKED");
    expect((await store.getOrder(refundingOrder.id))?.status).toBe("REFUNDING");
    expect((await store.getOrder(ordinaryOrder.id))?.status).toBe("LOCKED");

    await store.saveOrderRefund({ ...(await store.getOrderRefundByProviderNo(`PENDING-CLOSE-${refundingOrder.id}`))!, status: "FAILED" });
    expect([... (await store.getNetSalesQuantities(fixture.campaignId)).values()].reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(2);
    await store.saveOrderRefund({ ...(await store.getOrderRefundByProviderNo(`PENDING-CLOSE-${refundingOrder.id}`))!, status: "SUCCEEDED" });
    expect([... (await store.getNetSalesQuantities(fixture.campaignId)).values()].reduce((sum, value) => sum + value, 0)).toBe(1);
    expect((await store.getCampaign(fixture.campaignId))?.status).toBe("LOCKED");
  });

  it("excludes refunded sales and permits only one shared postponement when every point fails", async () => {
    const fixture = await createOpenCampaign();
    const secondPoint = await inject({ method: "POST", url: "/api/v1/admin/pickup-points", headers: admin, payload: {
      serviceAreaId: fixture.areaId, name: "独立门槛二号点", address: "北侧服务站 3 号",
      businessHours: "09:00-20:00", pickupInstructions: "请出示核销码", latitude: 39.91,
      longitude: 116.41, contactName: "李店长", contactPhone: "13800000004", capacityPerDay: 300,
      photoUrl: "https://example.com/north-pickup.jpg",
    } });
    expect(secondPoint.statusCode, secondPoint.body).toBe(201);
    const secondPointId = secondPoint.json().data.id as string;
    const cutoffAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await inject({ method: "POST", url: "/api/v1/admin/campaign-groups", headers: admin, payload: {
      title: "社区多点独立活动", cutoffAt, groupingMode: "PER_POINT", minTotalQuantity: 2,
      failureAction: "POSTPONE",
      points: [
        { pickupPointId: fixture.pointId, dispatchAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
        { pickupPointId: secondPointId, dispatchAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
      ],
      items: [{ catalogSkuId: fixture.skuId, retailPriceCents: 1500, stockByPoint: [
        { pickupPointId: fixture.pointId, sellableQuantity: 5 },
        { pickupPointId: secondPointId, sellableQuantity: 5 },
      ] }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const groupId = created.json().data.group.id as string;
    const members = created.json().data.campaigns as Array<{ id: string }>;
    const opened = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[0]!.id}/open`, headers: admin });
    expect(opened.statusCode, opened.body).toBe(200);
    const paidOrder = await createAndPayOrder({ ...fixture, campaignId: members[0]!.id }, 2);
    const orderAfterPartialRefund = await store.getOrder(paidOrder.id);
    expect(orderAfterPartialRefund).not.toBeNull();
    await store.saveOrderStatus({ ...orderAfterPartialRefund!, status: "REFUNDED" });
    const succeededPayment = await store.getPaymentByOrder(paidOrder.id);
    expect(succeededPayment).not.toBeNull();
    await store.saveOrderRefund({
      id: `test-success-refund-${paidOrder.id}`, orderId: paidOrder.id, paymentId: succeededPayment!.id,
      providerRefundNo: `TEST-SUCCESS-${paidOrder.id}`, providerRefundId: `provider-success-${paidOrder.id}`,
      status: "SUCCEEDED", amountCents: succeededPayment!.amountCents, createdAt: new Date().toISOString(),
      submissionLeaseUntil: null, submissionClaimToken: null,
    });
    const progressAfterRefund = await inject({ method: "GET", url: `/api/v1/campaigns/${members[0]!.id}` });
    expect(progressAfterRefund.json().data.paidQuantity).toBe(0);

    const firstClose = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[0]!.id}/close`, headers: admin, payload: { reason: "首轮未成团" } });
    expect(firstClose.statusCode, firstClose.body).toBe(200);
    expect((await store.getCampaignGroup(groupId))?.status).toBe("POSTPONED");
    expect((await store.listCampaigns()).filter((campaign) => campaign.campaignGroupId === groupId).map((campaign) => campaign.status)).toEqual(["POSTPONED", "POSTPONED"]);
    expect((await store.getOrder(paidOrder.id))?.status).toBe("REFUNDED");

    const newCutoffAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const rescheduled = await inject({ method: "POST", url: `/api/v1/admin/campaign-groups/${groupId}/postpone`, headers: admin, payload: {
      cutoffAt: newCutoffAt,
      points: [
        { campaignId: members[0]!.id, dispatchAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
        { campaignId: members[1]!.id, dispatchAt: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
      ],
    } });
    expect(rescheduled.statusCode, rescheduled.body).toBe(200);
    expect((await store.getCampaignGroup(groupId))?.postponementCount).toBe(1);
    const secondClose = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[1]!.id}/close`, headers: admin, payload: { reason: "顺延后仍未达标" } });
    expect(secondClose.statusCode, secondClose.body).toBe(200);
    expect((await store.getCampaignGroup(groupId))?.status).toBe("CANCELLED");
    expect((await store.getOrder(paidOrder.id))?.status).toBe("REFUNDED");
  });

  it("keeps a formed independent point locked while only a failed point is postponed and cancelled", async () => {
    const fixture = await createOpenCampaign();
    const secondPoint = await inject({ method: "POST", url: "/api/v1/admin/pickup-points", headers: admin, payload: {
      serviceAreaId: fixture.areaId, name: "独立成团二号点", address: "北侧服务站 4 号",
      businessHours: "09:00-20:00", pickupInstructions: "请出示核销码", latitude: 39.92,
      longitude: 116.42, contactName: "赵店长", contactPhone: "13800000005", capacityPerDay: 300,
      photoUrl: "https://example.com/north-pickup-2.jpg",
    } });
    expect(secondPoint.statusCode, secondPoint.body).toBe(201);
    const secondPointId = secondPoint.json().data.id as string;
    const cutoffAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await inject({ method: "POST", url: "/api/v1/admin/campaign-groups", headers: admin, payload: {
      title: "独立点位分别结算", cutoffAt, groupingMode: "PER_POINT", minTotalQuantity: 2,
      failureAction: "POSTPONE",
      points: [
        { pickupPointId: fixture.pointId, dispatchAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
        { pickupPointId: secondPointId, dispatchAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
      ],
      items: [{ catalogSkuId: fixture.skuId, retailPriceCents: 1500, stockByPoint: [
        { pickupPointId: fixture.pointId, sellableQuantity: 5 },
        { pickupPointId: secondPointId, sellableQuantity: 5 },
      ] }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const groupId = created.json().data.group.id as string;
    const members = created.json().data.campaigns as Array<{ id: string }>;
    expect((await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[0]!.id}/open`, headers: admin })).statusCode).toBe(200);
    const formedOrder = await createAndPayOrder({ ...fixture, campaignId: members[0]!.id }, 2);
    const linkedDetail = await inject({ method: "GET", url: `/api/v1/admin/orders/${formedOrder.id}`, headers: admin });
    expect(linkedDetail.statusCode, linkedDetail.body).toBe(200);
    expect(linkedDetail.json().data.id).toBe(formedOrder.id);

    const closed = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[1]!.id}/close`, headers: admin, payload: { reason: "逐点独立结算" } });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await store.listCampaigns()).filter((campaign) => campaign.campaignGroupId === groupId).map((campaign) => campaign.status)).toEqual(["LOCKED", "POSTPONED"]);
    expect((await store.getOrder(formedOrder.id))?.status).toBe("LOCKED");
    expect((await store.getCampaignGroup(groupId))?.status).toBe("PARTIAL");

    const failedPointCutoffAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const rescheduled = await inject({ method: "POST", url: `/api/v1/admin/campaign-groups/${groupId}/postpone`, headers: admin, payload: {
      cutoffAt: failedPointCutoffAt,
      points: [{ campaignId: members[1]!.id, dispatchAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null }],
    } });
    expect(rescheduled.statusCode, rescheduled.body).toBe(200);
    expect((await store.getCampaign(members[0]!.id))?.status).toBe("LOCKED");
    expect((await store.getCampaign(members[1]!.id))?.status).toBe("OPEN");

    const secondClose = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[1]!.id}/close`, headers: admin, payload: { reason: "失败点位再次未达标" } });
    expect(secondClose.statusCode, secondClose.body).toBe(200);
    expect((await store.getCampaign(members[0]!.id))?.status).toBe("LOCKED");
    expect((await store.getCampaign(members[1]!.id))?.status).toBe("CANCELLED");
    expect((await store.getCampaignGroup(groupId))?.status).toBe("PARTIAL");
    expect((await store.getOrder(formedOrder.id))?.status).toBe("LOCKED");
  });

  it("allows only one concurrent checkout to reserve the last unit in a grouped point", async () => {
    const fixture = await createOpenCampaign();
    const secondPoint = await inject({ method: "POST", url: "/api/v1/admin/pickup-points", headers: admin, payload: {
      serviceAreaId: fixture.areaId, name: "并发库存二号点", address: "北侧服务站 8 号",
      businessHours: "09:00-20:00", pickupInstructions: "请出示核销码", latitude: 39.93,
      longitude: 116.43, contactName: "孙店长", contactPhone: "13800000008", capacityPerDay: 300,
      photoUrl: "https://example.com/concurrent-pickup.jpg",
    } });
    expect(secondPoint.statusCode, secondPoint.body).toBe(201);
    const secondPointId = secondPoint.json().data.id as string;
    const cutoffAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const group = await inject({ method: "POST", url: "/api/v1/admin/campaign-groups", headers: admin, payload: {
      title: "同点最后库存并发", cutoffAt, groupingMode: "ALL_POINTS", minTotalQuantity: 1,
      failureAction: "CANCEL_AND_REFUND",
      points: [
        { pickupPointId: fixture.pointId, dispatchAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
        { pickupPointId: secondPointId, dispatchAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
      ],
      items: [{ catalogSkuId: fixture.skuId, retailPriceCents: 1500, stockByPoint: [
        { pickupPointId: fixture.pointId, sellableQuantity: 1 },
        { pickupPointId: secondPointId, sellableQuantity: 1 },
      ] }],
    } });
    expect(group.statusCode, group.body).toBe(201);
    const members = group.json().data.campaigns as Array<{ id: string }>;
    const opened = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[0]!.id}/open`, headers: admin });
    expect(opened.statusCode, opened.body).toBe(200);
    const createCheckout = (key: string) => inject({ method: "POST", url: "/api/v1/order-checkouts", headers: { ...customer, "idempotency-key": key }, payload: {
      groups: [{ campaignId: members[0]!.id, serviceAreaId: fixture.areaId, pickupPointId: fixture.pointId, items: [{ skuId: fixture.skuId, quantity: 1 }] }],
    } });
    const outcomes = await Promise.all([createCheckout("group-last-stock-001"), createCheckout("group-last-stock-002")]);
    expect(outcomes.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect((await store.getCampaignItem(members[0]!.id, fixture.skuId))?.reservedQuantity).toBe(1);
    expect((await store.listOrdersByCampaign(members[0]!.id)).filter((order) => order.status === "PENDING_PAYMENT")).toHaveLength(1);
  });

  it("creates an idempotent multi-point checkout and pays its independent orders once", async () => {
    const paymentProvider: PaymentProvider = {
      name: "wechat",
      initiate: async (order) => ({ providerPaymentId: "prepay-batch", clientPayload: { package: `prepay_id=${order.orderNo}` }, providerContext: { outTradeNo: order.orderNo } }),
      parseNotification: (rawBody) => {
        const value = JSON.parse(rawBody) as { eventId: string; type: string; orderNo: string; providerPaymentId: string; amountCents: number };
        return { ...value, bodyHash: rawBody };
      },
      refund: async () => ({ providerRefundId: "batch-refund", status: "SUCCEEDED" }),
      queryRefund: async () => ({ providerRefundId: "batch-refund", status: "SUCCEEDED" }),
      parseRefundNotification: () => { throw new Error("unused"); },
    };
    await app.close();
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store, paymentProvider });
    const first = await createOpenCampaign();
    const second = await createSecondPickupCampaign(first);
    const payload = { groups: [
      { campaignId: first.campaignId, serviceAreaId: first.areaId, pickupPointId: first.pointId, items: [{ skuId: first.skuId, quantity: 2 }] },
      { campaignId: second.campaignId, serviceAreaId: second.areaId, pickupPointId: second.pointId, items: [{ skuId: second.skuId, quantity: 3 }] },
    ] };
    const headers = { ...customer, "idempotency-key": "multi-pickup-checkout-001" };
    const created = await inject({ method: "POST", url: "/api/v1/order-checkouts", headers, payload });
    expect(created.statusCode, created.body).toBe(201);
    const value = created.json().data;
    expect(value.orders).toHaveLength(2);
    expect(value.checkoutBatch.totalCents).toBe(8700);
    expect(new Set(value.orders.map((order: { pickupPointId: string }) => order.pickupPointId)).size).toBe(2);
    const pendingStatus = await inject({ method: "GET", url: `/api/v1/order-checkouts/${value.checkoutBatch.id}`, headers: customer });
    expect(pendingStatus.statusCode, pendingStatus.body).toBe(200);
    expect(pendingStatus.json().data.checkoutBatch).toMatchObject({
      id: value.checkoutBatch.id,
      status: "PENDING_PAYMENT",
      totalCents: 8700,
      expired: false,
    });
    expect(pendingStatus.json().data.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: value.orders[0].id, status: "PENDING_PAYMENT", pickupPointId: first.pointId, pickupPointName: "东门社区自提点" }),
      expect.objectContaining({ id: value.orders[1].id, status: "PENDING_PAYMENT", pickupPointId: second.pointId, pickupPointName: "西门社区自提点" }),
    ]));
    expect(pendingStatus.json().data.checkoutBatch).not.toHaveProperty("outTradeNo");
    expect(pendingStatus.json().data.orders[0]).not.toHaveProperty("userId");
    const anonymousStatus = await inject({ method: "GET", url: `/api/v1/order-checkouts/${value.checkoutBatch.id}` });
    expect(anonymousStatus.statusCode).toBe(401);
    await store.saveUser({ id: "other-customer", wechatOpenId: "openid-other", status: "ACTIVE", createdAt: new Date().toISOString() });
    const otherCustomerStatus = await inject({ method: "GET", url: `/api/v1/order-checkouts/${value.checkoutBatch.id}`, headers: { "x-demo-user-id": "other-customer", "x-demo-role": "USER" } });
    expect(otherCustomerStatus.statusCode).toBe(404);
    const missingStatus = await inject({ method: "GET", url: "/api/v1/order-checkouts/00000000-0000-4000-8000-000000000000", headers: customer });
    expect(missingStatus.statusCode).toBe(404);
    const replay = await inject({ method: "POST", url: "/api/v1/order-checkouts", headers, payload });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data.checkoutBatch.id).toBe(value.checkoutBatch.id);
    expect(replay.json().data.orders.map((order: { id: string }) => order.id)).toEqual(value.orders.map((order: { id: string }) => order.id));
    const payment = await inject({ method: "POST", url: `/api/v1/order-checkouts/${value.checkoutBatch.id}/pay`, headers: customer });
    expect(payment.statusCode, payment.body).toBe(200);
    const callback = { eventId: "multi-pickup-payment-event", type: "TRANSACTION.SUCCESS", orderNo: value.checkoutBatch.outTradeNo, providerPaymentId: "wechat-batch-transaction", amountCents: 8700 };
    const wrongAmount = await inject({ method: "POST", url: "/api/v1/payments/wechat/notify", payload: { ...callback, eventId: "multi-pickup-wrong-amount", amountCents: 8701 } });
    expect(wrongAmount.statusCode).toBe(409);
    const confirmed = await inject({ method: "POST", url: "/api/v1/payments/wechat/notify", payload: callback });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const duplicate = await inject({ method: "POST", url: "/api/v1/payments/wechat/notify", payload: callback });
    expect(duplicate.statusCode).toBe(200);
    const orders = await inject({ method: "GET", url: "/api/v1/orders", headers: customer });
    const paid = orders.json().data.filter((order: { id: string }) => value.orders.some((createdOrder: { id: string }) => createdOrder.id === order.id));
    expect(paid).toHaveLength(2);
    expect(paid.every((order: { status: string }) => order.status === "PAID_WAITING_CLOSE")).toBe(true);
    expect(paid.every((order: { checkoutBatch?: { orderCount: number } }) => order.checkoutBatch?.orderCount === 2)).toBe(true);
    const paidStatus = await inject({ method: "GET", url: `/api/v1/order-checkouts/${value.checkoutBatch.id}`, headers: customer });
    expect(paidStatus.statusCode, paidStatus.body).toBe(200);
    expect(paidStatus.json().data.checkoutBatch.status).toBe("PAID");
    expect(paidStatus.json().data.orders.every((order: { status: string }) => order.status === "PAID_WAITING_CLOSE")).toBe(true);
    expect(await store.listLedgerTransactions()).toHaveLength(2);
  });

  it("reports an expired pending checkout from the database clock without mutating it", async () => {
    const fixture = await createOpenCampaign();
    const created = await inject({ method: "POST", url: "/api/v1/order-checkouts", headers: { ...customer, "idempotency-key": "multi-point-status-expired-001" }, payload: { groups: [
      { campaignId: fixture.campaignId, serviceAreaId: fixture.areaId, pickupPointId: fixture.pointId, items: [{ skuId: fixture.skuId, quantity: 1 }] },
    ] } });
    expect(created.statusCode, created.body).toBe(201);
    const batch = created.json().data.checkoutBatch;
    const current = await store.getCheckoutBatch(batch.id);
    expect(current).not.toBeNull();
    await store.saveCheckoutBatch({ ...current!, expiresAt: new Date(Date.now() - 1_000).toISOString() });

    const status = await inject({ method: "GET", url: `/api/v1/order-checkouts/${batch.id}`, headers: customer });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json().data.checkoutBatch).toMatchObject({ status: "PENDING_PAYMENT", expired: true });
    expect(Date.parse(status.json().data.checkoutBatch.serverTime)).toBeGreaterThanOrEqual(Date.parse(status.json().data.checkoutBatch.expiresAt));
    expect((await store.getCheckoutBatch(batch.id))?.status).toBe("PENDING_PAYMENT");
  });

  it("rolls back all reservations when one multi-point group is unavailable", async () => {
    const first = await createOpenCampaign();
    const second = await createSecondPickupCampaign(first);
    const response = await inject({ method: "POST", url: "/api/v1/order-checkouts", headers: { ...customer, "idempotency-key": "multi-pickup-checkout-002" }, payload: { groups: [
      { campaignId: first.campaignId, serviceAreaId: first.areaId, pickupPointId: first.pointId, items: [{ skuId: first.skuId, quantity: 2 }] },
      { campaignId: second.campaignId, serviceAreaId: second.areaId, pickupPointId: second.pointId, items: [{ skuId: second.skuId, quantity: 999 }] },
    ] } });
    expect(response.statusCode).toBe(409);
    expect(await store.listOrdersByUser("customer")).toHaveLength(0);
    expect((await store.getCampaign(first.campaignId))?.items[0]?.reservedQuantity).toBe(0);
  });

  it("cancels the whole unpaid batch when one campaign closes and refunds a racing late success", async () => {
    let releaseInitiation!: () => void;
    let markInitiationStarted!: () => void;
    const initiationStarted = new Promise<void>((resolve) => { markInitiationStarted = resolve; });
    const initiationGate = new Promise<void>((resolve) => { releaseInitiation = resolve; });
    const paymentProvider: PaymentProvider = {
      name: "wechat",
      initiate: async (order) => {
        markInitiationStarted();
        await initiationGate;
        return { providerPaymentId: "prepay-racing", clientPayload: { package: `prepay_id=${order.orderNo}` }, providerContext: { outTradeNo: order.orderNo } };
      },
      parseNotification: (rawBody) => {
        const value = JSON.parse(rawBody) as { eventId: string; type: string; orderNo: string; providerPaymentId: string; amountCents: number };
        return { ...value, bodyHash: rawBody };
      },
      refund: async () => ({ providerRefundId: "late-refund", status: "SUCCEEDED" }),
      queryRefund: async () => ({ providerRefundId: "late-refund", status: "SUCCEEDED" }),
      parseRefundNotification: () => { throw new Error("unused"); },
    };
    await app.close();
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store, paymentProvider });
    const first = await createOpenCampaign();
    const second = await createSecondPickupCampaign(first);
    const created = await inject({ method: "POST", url: "/api/v1/order-checkouts", headers: { ...customer, "idempotency-key": "multi-point-close-race-001" }, payload: { groups: [
      { campaignId: first.campaignId, serviceAreaId: first.areaId, pickupPointId: first.pointId, items: [{ skuId: first.skuId, quantity: 2 }] },
      { campaignId: second.campaignId, serviceAreaId: second.areaId, pickupPointId: second.pointId, items: [{ skuId: second.skuId, quantity: 3 }] },
    ] } });
    expect(created.statusCode, created.body).toBe(201);
    const batch = created.json().data.checkoutBatch;
    const childOrders = created.json().data.orders as Array<{ id: string }>;

    const inFlightPay = inject({ method: "POST", url: `/api/v1/order-checkouts/${batch.id}/pay`, headers: customer });
    await initiationStarted;
    const closed = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${first.campaignId}/close`, headers: admin, payload: { reason: "关闭首个点位团期" } });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await store.getCheckoutBatch(batch.id))?.status).toBe("CANCELLED");
    for (const order of childOrders) expect((await store.getOrder(order.id))?.status).toBe("CANCELLED");
    expect((await store.getCampaignItem(first.campaignId, first.skuId))?.reservedQuantity).toBe(0);
    expect((await store.getCampaignItem(second.campaignId, second.skuId))?.reservedQuantity).toBe(0);
    const retry = await inject({ method: "POST", url: `/api/v1/order-checkouts/${batch.id}/pay`, headers: customer });
    expect(retry.statusCode).toBe(409);

    releaseInitiation();
    const initiationResult = await inFlightPay;
    expect(initiationResult.statusCode).toBe(409);
    const lateSuccess = await inject({ method: "POST", url: "/api/v1/payments/wechat/notify", payload: {
      eventId: "multi-point-close-late-success", type: "TRANSACTION.SUCCESS", orderNo: batch.outTradeNo,
      providerPaymentId: "wx-late-success", amountCents: 8700,
    } });
    expect(lateSuccess.statusCode, lateSuccess.body).toBe(200);
    for (const order of childOrders) {
      expect((await store.getOrder(order.id))?.status).toBe("REFUNDING");
      expect(await store.getOrderRefundByOrder(order.id)).toMatchObject({ amountCents: expect.any(Number), status: "CREATED" });
    }
  });

  it("cancels a grouped checkout at cutoff and records a late successful payment as refund work", async () => {
    let releaseInitiation!: () => void;
    let markInitiationStarted!: () => void;
    const initiationStarted = new Promise<void>((resolve) => { markInitiationStarted = resolve; });
    const initiationGate = new Promise<void>((resolve) => { releaseInitiation = resolve; });
    const paymentProvider: PaymentProvider = {
      name: "wechat",
      initiate: async (order) => {
        markInitiationStarted();
        await initiationGate;
        return { providerPaymentId: "group-prepay-racing", clientPayload: { package: `prepay_id=${order.orderNo}` }, providerContext: { outTradeNo: order.orderNo } };
      },
      parseNotification: (rawBody) => {
        const value = JSON.parse(rawBody) as { eventId: string; type: string; orderNo: string; providerPaymentId: string; amountCents: number };
        return { ...value, bodyHash: rawBody };
      },
      refund: async () => ({ providerRefundId: "group-late-refund", status: "SUCCEEDED" }),
      queryRefund: async () => ({ providerRefundId: "group-late-refund", status: "SUCCEEDED" }),
      parseRefundNotification: () => { throw new Error("unused"); },
    };
    await app.close();
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store, paymentProvider });
    const fixture = await createOpenCampaign();
    const secondPoint = await inject({ method: "POST", url: "/api/v1/admin/pickup-points", headers: admin, payload: {
      serviceAreaId: fixture.areaId, name: "团期关单竞争二号点", address: "北侧服务站 10 号",
      businessHours: "09:00-20:00", pickupInstructions: "请出示核销码", latitude: 39.94,
      longitude: 116.44, contactName: "陈店长", contactPhone: "13800000010", capacityPerDay: 300,
      photoUrl: "https://example.com/group-cutoff-pickup.jpg",
    } });
    expect(secondPoint.statusCode, secondPoint.body).toBe(201);
    const secondPointId = secondPoint.json().data.id as string;
    const cutoffAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const group = await inject({ method: "POST", url: "/api/v1/admin/campaign-groups", headers: admin, payload: {
      title: "团期截单与迟到支付并发", cutoffAt, groupingMode: "ALL_POINTS", minTotalQuantity: 2,
      failureAction: "CANCEL_AND_REFUND",
      points: [
        { pickupPointId: fixture.pointId, dispatchAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
        { pickupPointId: secondPointId, dispatchAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), estimatedArrivalStartAt: null, estimatedArrivalEndAt: null },
      ],
      items: [{ catalogSkuId: fixture.skuId, retailPriceCents: 1500, stockByPoint: [
        { pickupPointId: fixture.pointId, sellableQuantity: 2 },
        { pickupPointId: secondPointId, sellableQuantity: 2 },
      ] }],
    } });
    expect(group.statusCode, group.body).toBe(201);
    const members = group.json().data.campaigns as Array<{ id: string }>;
    expect((await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[0]!.id}/open`, headers: admin })).statusCode).toBe(200);
    const checkout = await inject({ method: "POST", url: "/api/v1/order-checkouts", headers: { ...customer, "idempotency-key": "group-cutoff-late-pay-01" }, payload: {
      groups: [{ campaignId: members[0]!.id, serviceAreaId: fixture.areaId, pickupPointId: fixture.pointId, items: [{ skuId: fixture.skuId, quantity: 1 }] }],
    } });
    expect(checkout.statusCode, checkout.body).toBe(201);
    const batch = checkout.json().data.checkoutBatch;
    const child = checkout.json().data.orders[0] as { id: string };
    const inFlightPay = inject({ method: "POST", url: `/api/v1/order-checkouts/${batch.id}/pay`, headers: customer });
    await initiationStarted;
    const closed = await inject({ method: "POST", url: `/api/v1/admin/campaigns/${members[1]!.id}/close`, headers: admin, payload: { reason: "统一活动截单" } });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await store.getCampaignGroup(group.json().data.group.id))?.status).toBe("CANCELLED");
    expect((await store.getCheckoutBatch(batch.id))?.status).toBe("CANCELLED");
    expect((await store.getOrder(child.id))?.status).toBe("CANCELLED");
    releaseInitiation();
    expect((await inFlightPay).statusCode).toBe(409);
    const lateSuccess = await inject({ method: "POST", url: "/api/v1/payments/wechat/notify", payload: {
      eventId: "group-cutoff-late-success", type: "TRANSACTION.SUCCESS", orderNo: batch.outTradeNo,
      providerPaymentId: "group-wx-late-success", amountCents: 1500,
    } });
    expect(lateSuccess.statusCode, lateSuccess.body).toBe(200);
    expect((await store.getOrder(child.id))?.status).toBe("REFUNDING");
    expect(await store.getOrderRefundByOrder(child.id)).toMatchObject({ amountCents: 1500, status: "CREATED" });
  });

  it("repairs a pending batch with an already-cancelled child when its remaining order expires", async () => {
    const first = await createOpenCampaign();
    const second = await createSecondPickupCampaign(first);
    const created = await inject({ method: "POST", url: "/api/v1/order-checkouts", headers: { ...customer, "idempotency-key": "multi-point-expiry-recovery-001" }, payload: { groups: [
      { campaignId: first.campaignId, serviceAreaId: first.areaId, pickupPointId: first.pointId, items: [{ skuId: first.skuId, quantity: 2 }] },
      { campaignId: second.campaignId, serviceAreaId: second.areaId, pickupPointId: second.pointId, items: [{ skuId: second.skuId, quantity: 3 }] },
    ] } });
    expect(created.statusCode, created.body).toBe(201);
    const batch = created.json().data.checkoutBatch;
    const orders = created.json().data.orders as Array<{ id: string; campaignId: string; items: Array<{ skuId: string; quantity: number }> }>;
    const firstOrder = orders.find((order) => order.campaignId === first.campaignId)!;
    const secondOrder = orders.find((order) => order.campaignId === second.campaignId)!;
    expect(await store.cancelPendingOrder(firstOrder.id)).toBe(true);
    for (const item of firstOrder.items)
      expect(await store.releaseCampaignInventory(first.campaignId, item.skuId, item.quantity)).toBe(true);
    for (const order of orders) {
      const current = await store.getOrder(order.id);
      await store.saveOrder({ ...current!, expiresAt: new Date(Date.now() - 1000).toISOString() });
    }

    const campaigns = new CampaignService(store, new NoopCampaignScheduler());
    const orderService = new OrderService(store, campaigns);
    expect(await orderService.expirePendingOrders()).toBe(1);
    expect((await store.getOrder(firstOrder.id))?.status).toBe("CANCELLED");
    expect((await store.getOrder(secondOrder.id))?.status).toBe("CANCELLED");
    expect((await store.getCheckoutBatch(batch.id))?.status).toBe("CANCELLED");
    const status = await inject({ method: "GET", url: `/api/v1/order-checkouts/${batch.id}`, headers: customer });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json().data.checkoutBatch.status).toBe("CANCELLED");
    expect(status.json().data.orders.every((order: { status: string }) => order.status === "CANCELLED")).toBe(true);
    expect((await store.getCampaignItem(second.campaignId, second.skuId))?.reservedQuantity).toBe(0);
  });

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
