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
        capacityPerDay: 500,
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
    const premature = await inject({
      method: "POST",
      url: `/api/v1/admin/campaigns/${campaignId}/close`,
      headers: admin,
    });
    expect(premature.statusCode).toBe(409);
    const campaign = await store.getCampaign(campaignId);
    expect(campaign).not.toBeNull();
    campaign!.cutoffAt = new Date(Date.now() - 1000).toISOString();
    expect(await store.updateCampaign(campaign!, campaign!.version)).toBe(true);
    const closed = await inject({
      method: "POST",
      url: `/api/v1/admin/campaigns/${campaignId}/close`,
      headers: admin,
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().data.status).toBe("LOCKED");
  }

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
    const lookup = await inject({
      method: "GET",
      url: `/api/v1/pickup/orders/lookup?deliveryPlanId=${fixture.deliveryPlanId}&orderNo=${order.orderNo}`,
      headers: admin,
    });
    expect(lookup.json().data.items[0].remainingPickupQuantity).toBe(2);
    for (let pickup = 0; pickup < 2; pickup += 1) {
      const pickupRequestId = randomUUID();
      const verified = await inject({
        method: "POST",
        url: "/api/v1/pickup/verify",
        headers: admin,
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
          headers: admin,
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
    expect(refund.json().data.status).toBe("REFUNDING");
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
      "REFUNDING",
    );
    expect(
      requests.find((value) => value.orderId === rejectedOrder.id)?.status,
    ).toBe("REJECTED");
  });
});
