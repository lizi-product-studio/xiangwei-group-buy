import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";

const admin = { "x-demo-user-id": "admin", "x-demo-role": "SUPER_ADMIN" };
describe("single community application surface", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => app?.close());
  it("exposes only community catalog and campaign creation", async () => {
    const store = new MemoryStore(false);
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
    const area = await app.inject({
      method: "POST",
      url: "/api/v1/admin/service-areas",
      headers: admin,
      payload: { regionCode: "110101" },
    });
    expect(area.statusCode).toBe(201);
    const areaId = area.json().data.id as string;
    const point = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: admin,
      payload: {
        serviceAreaId: areaId,
        name: "社区东门自提点",
        address: "东门服务站 1 号",
        businessHours: "09:00-20:00",
        pickupInstructions: "请从东门进入并出示核销码",
        latitude: 39.9042,
        longitude: 116.4074,
        contactName: "张店长",
        contactPhone: "13800000000",
        capacityPerDay: null,
      },
    });
    expect(point.statusCode).toBe(201);
    const pointId = point.json().data.id as string;
    expect(point.json().data).toMatchObject({
      businessHours: "09:00-20:00",
      pickupInstructions: "请从东门进入并出示核销码",
      latitude: 39.9042,
      longitude: 116.4074,
      contactName: "张店长",
      contactPhone: "13800000000",
    });
    const pointWithoutManager = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: admin,
      payload: {
        serviceAreaId: areaId,
        name: "尚未绑定负责人的点",
        address: "东门服务站 2 号",
        businessHours: "09:00-20:00",
        pickupInstructions: "请从东门进入并出示核销码",
        latitude: 39.9042,
        longitude: 116.4074,
        capacityPerDay: null,
      },
    });
    expect(pointWithoutManager.statusCode, pointWithoutManager.body).toBe(201);
    expect(pointWithoutManager.json().data).toMatchObject({
      contactName: "",
      contactPhone: "",
    });
    const updatedPoint = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pickup-points/${pointId}`,
      headers: admin,
      payload: { businessHours: "08:30-21:00" },
    });
    expect(updatedPoint.statusCode, updatedPoint.body).toBe(200);
    expect(updatedPoint.json().data.businessHours).toBe("08:30-21:00");
    const sku = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: admin,
      payload: {
        title: "本地时蔬组合",
        category: "蔬菜",
        origin: "本地农场",
        imageUrl: null,
        skuName: "一份",
        retailPriceCents: 1990,
        defaultSellableQuantity: 100,
        status: "ACTIVE",
      },
    });
    expect(sku.statusCode).toBe(201);
    const missingArrivalWindow = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns",
      headers: admin,
      payload: {
        title: "缺少到货时间的团期",
        serviceAreaId: areaId,
        pickupPointId: pointId,
        cutoffAt: "2027-08-22T10:00:00+08:00",
        dispatchAt: "2027-08-22T12:00:00+08:00",
        minTotalQuantity: 1,
        failureAction: "CANCEL_AND_REFUND",
        items: [
          {
            catalogSkuId: sku.json().data.id,
            retailPriceCents: 1890,
            sellableQuantity: 50,
          },
        ],
      },
    });
    expect(missingArrivalWindow.statusCode).toBe(400);
    const invalidSchedule = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns",
      headers: admin,
      payload: {
        title: "发车早于截单的团期",
        serviceAreaId: areaId,
        pickupPointId: pointId,
        cutoffAt: "2027-08-22T13:00:00+08:00",
        dispatchAt: "2027-08-22T12:00:00+08:00",
        estimatedArrivalStartAt: "2027-08-22T14:00:00+08:00",
        estimatedArrivalEndAt: "2027-08-22T16:00:00+08:00",
        minTotalQuantity: 1,
        failureAction: "CANCEL_AND_REFUND",
        items: [
          {
            catalogSkuId: sku.json().data.id,
            retailPriceCents: 1890,
            sellableQuantity: 50,
          },
        ],
      },
    });
    expect(invalidSchedule.statusCode).toBe(400);
    expect(invalidSchedule.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "请求参数不正确",
      details: [
        {
          path: ["dispatchAt"],
          message: "发车时间必须晚于截团时间",
        },
      ],
    });
    const campaign = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns",
      headers: admin,
      payload: {
        title: "周末社区团",
        serviceAreaId: areaId,
        pickupPointId: pointId,
        cutoffAt: "2027-08-22T10:00:00+08:00",
        dispatchAt: "2027-08-22T12:00:00+08:00",
        estimatedArrivalStartAt: "2027-08-22T14:00:00+08:00",
        estimatedArrivalEndAt: "2027-08-22T16:00:00+08:00",
        minTotalQuantity: 1,
        failureAction: "CANCEL_AND_REFUND",
        items: [
          {
            catalogSkuId: sku.json().data.id,
            retailPriceCents: 1890,
            sellableQuantity: 50,
          },
        ],
      },
    });
    expect(campaign.statusCode, campaign.body).toBe(201);
    expect(campaign.json().data.deliveryPlan.pickupPointId).toBe(pointId);
    expect(campaign.json().data).toMatchObject({
      estimatedArrivalStartAt: "2027-08-22T14:00:00+08:00",
      estimatedArrivalEndAt: "2027-08-22T16:00:00+08:00",
      paidQuantity: 0,
      pickupPoint: {
        id: pointId,
        businessHours: "08:30-21:00",
        contactPhone: "13800000000",
      },
      deliveryPlan: {
        arrivalStartAt: "2027-08-22T14:00:00+08:00",
        arrivalEndAt: "2027-08-22T16:00:00+08:00",
      },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/admin/obsolete-module",
          headers: admin,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/admin/merchants",
          headers: admin,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("keeps a pickup manager inside assigned web workbench routes", async () => {
    const store = new MemoryStore(false);
    const now = new Date().toISOString();
    await store.saveUser({
      id: "manager",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: now,
    });
    await store.saveInternalStaff({
      userId: "manager",
      staffNo: "STF-1",
      displayName: "点位负责人",
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
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
    const headers = {
      "x-demo-user-id": "manager",
      "x-demo-role": "PICKUP_MANAGER",
    };
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/admin/catalog/skus",
          headers,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/pickup/delivery-plans",
          headers,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("keeps the normal rate-limit default and returns a standard 429 when exceeded", async () => {
    // RATE_LIMIT_MAX is only raised by the Playwright server's NODE_ENV=test
    // process. The shared application default remains the production-safe 300.
    expect(loadConfig({ NODE_ENV: "test" }).RATE_LIMIT_MAX).toBe(300);
    const store = new MemoryStore(false);
    app = await buildApp({
      config: loadConfig({ NODE_ENV: "test", RATE_LIMIT_MAX: "10" }),
      store,
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await app.inject({ method: "GET", url: "/health/live" });
      expect(response.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: "GET", url: "/health/live" });
    expect(limited.statusCode, limited.body).toBe(429);
    expect(limited.json()).toMatchObject({
      code: "RATE_LIMITED",
      message: "请求过于频繁，请稍后再试",
    });
  });
});
