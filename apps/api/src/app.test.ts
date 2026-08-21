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
        capacityPerDay: null,
      },
    });
    expect(point.statusCode).toBe(201);
    const pointId = point.json().data.id as string;
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
});
