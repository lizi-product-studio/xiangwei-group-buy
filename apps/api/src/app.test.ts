import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";
import type { Order, PickupPoint, ServiceArea } from "./modules/core/types.js";
import type { ReverseLocationAdapter } from "./modules/service-areas/pickup-location-validation.js";

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
        confirmDuplicate: true,
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
    const duplicateCampaignSku = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns",
      headers: admin,
      payload: {
        title: "重复商品团期",
        serviceAreaId: areaId,
        pickupPointId: pointId,
        cutoffAt: "2027-08-23T10:00:00+08:00",
        dispatchAt: "2027-08-23T12:00:00+08:00",
        estimatedArrivalStartAt: "2027-08-23T14:00:00+08:00",
        estimatedArrivalEndAt: "2027-08-23T16:00:00+08:00",
        minTotalQuantity: 1,
        failureAction: "CANCEL_AND_REFUND",
        items: [
          { catalogSkuId: sku.json().data.id, retailPriceCents: 1890, sellableQuantity: 10 },
          { catalogSkuId: sku.json().data.id, retailPriceCents: 1890, sellableQuantity: 10 },
        ],
      },
    });
    expect(duplicateCampaignSku.statusCode, duplicateCampaignSku.body).toBe(400);
    expect(duplicateCampaignSku.json()).toMatchObject({ code: "VALIDATION_ERROR" });
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

  it("blocks pickup-point deactivation while an unfinished order remains", async () => {
    const store = new MemoryStore(false);
    const now = new Date().toISOString();
    const area: ServiceArea = {
      id: "area-unfinished-order",
      regionCode: "110101",
      name: "北京市东城区",
      status: "ENABLED",
      orderEnabled: true,
      createdAt: now,
    };
    const point: PickupPoint = {
      id: "point-unfinished-order",
      serviceAreaId: area.id,
      name: "东门自提点",
      address: "东门服务站",
      businessHours: "09:00-20:00",
      pickupInstructions: "出示领取码",
      latitude: 39.9042,
      longitude: 116.4074,
      contactName: "张店长",
      contactPhone: "13800000000",
      status: "ACTIVE",
      capacityPerDay: null,
      createdAt: now,
    };
    const order: Order = {
      id: "order-unfinished-point",
      orderNo: "CG-UNFINISHED-POINT",
      userId: "customer",
      campaignId: "campaign-finished-for-point-guard",
      serviceAreaId: area.id,
      pickupPointId: point.id,
      deliveryPlanId: "delivery-finished-for-point-guard",
      status: "PAID_WAITING_CLOSE",
      totalCents: 1990,
      items: [
        {
          orderLineId: null,
          skuId: "sku-unfinished-point",
          productId: "product-unfinished-point",
          name: "时蔬",
          quantity: 1,
          unitPriceCents: 1990,
          amountCents: 1990,
          fulfilledQuantity: 0,
          pickedUpQuantity: 0,
          exceptionQuantity: 0,
          refundedQuantity: 0,
          refundedAmountCents: 0,
        },
      ],
      createdAt: now,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      paidAt: now,
      pickedUpAt: null,
    };
    await store.saveServiceArea(area);
    await store.savePickupPoint(point);
    await store.saveOrder(order);
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pickup-points/${point.id}`,
      headers: admin,
      payload: { status: "INACTIVE" },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      details: { unfinishedOrderCount: 1 },
    });
    expect((await store.listPickupPoints()).find((value) => value.id === point.id)?.status).toBe(
      "ACTIVE",
    );
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

  it("fails closed without a configured reverse-location adapter and writes nothing", async () => {
    const store = new MemoryStore(false);
    let result:
      | { status: "NOT_CONFIGURED" }
      | { status: "UNAVAILABLE" }
      | { status: "UNMAPPABLE" }
      | {
          status: "MAPPED";
          coordinateSystem: "GCJ-02";
          latitude: number;
          longitude: number;
          providerAdministrativeId: string;
          directoryRegionCode: string;
          displayAddress: string;
        } = { status: "NOT_CONFIGURED" };
    const unavailable: ReverseLocationAdapter = {
      reverse: async (latitude, longitude) =>
        result.status === "MAPPED" ? { ...result, latitude, longitude } : result,
    };
    app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store,
      reverseLocationAdapter: unavailable,
    });
    const area = await app.inject({
      method: "POST",
      url: "/api/v1/admin/service-areas",
      headers: admin,
      payload: { regionCode: "110101" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: admin,
      payload: {
        serviceAreaId: area.json().data.id,
        name: "东门提货点",
        address: "东门服务站 1 号",
        businessHours: "09:00-20:00",
        pickupInstructions: "出示领取码",
        latitude: 39.9042,
        longitude: 116.4074,
        contactName: "",
        contactPhone: "",
        capacityPerDay: null,
      },
    });
    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({
      code: "LOCATION_VERIFICATION_NOT_CONFIGURED",
    });
    result = { status: "UNMAPPABLE" };
    const unmappable = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: admin,
      payload: {
        serviceAreaId: area.json().data.id,
        name: "无法映射的提货点",
        address: "东门服务站 2 号",
        businessHours: "09:00-20:00",
        pickupInstructions: "出示领取码",
        latitude: 39.9043,
        longitude: 116.4075,
        contactName: "",
        contactPhone: "",
        capacityPerDay: null,
      },
    });
    expect(unmappable.statusCode, unmappable.body).toBe(422);
    expect(unmappable.json()).toMatchObject({
      code: "LOCATION_ADMIN_IDENTIFIER_UNMAPPABLE",
    });
    result = {
      status: "MAPPED",
      coordinateSystem: "GCJ-02",
      latitude: 0,
      longitude: 0,
      providerAdministrativeId: "110102",
      directoryRegionCode: "110102",
      displayAddress: "北京市 / 北京市 / 西城区",
    };
    const mismatch = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: admin,
      payload: {
        serviceAreaId: area.json().data.id,
        name: "跨区的提货点",
        address: "西城区服务站",
        businessHours: "09:00-20:00",
        pickupInstructions: "出示领取码",
        latitude: 39.9044,
        longitude: 116.4076,
        contactName: "",
        contactPhone: "",
        capacityPerDay: null,
      },
    });
    expect(mismatch.statusCode, mismatch.body).toBe(409);
    expect(mismatch.json()).toMatchObject({
      code: "PICKUP_LOCATION_ADMIN_PATH_MISMATCH",
    });
    expect(await store.listPickupPoints()).toEqual([]);

    const inactivePointId = "inactive-point";
    await store.savePickupPoint({
      id: inactivePointId,
      serviceAreaId: area.json().data.id,
      name: "待重新启用的点位",
      address: "东门服务站 3 号",
      businessHours: "09:00-20:00",
      pickupInstructions: "出示领取码",
      latitude: 39.9045,
      longitude: 116.4077,
      contactName: "",
      contactPhone: "",
      status: "INACTIVE",
      capacityPerDay: null,
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    result = { status: "NOT_CONFIGURED" };
    const reactivation = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pickup-points/${inactivePointId}`,
      headers: admin,
      payload: { status: "ACTIVE" },
    });
    expect(reactivation.statusCode, reactivation.body).toBe(503);
    expect(
      (await store.listPickupPoints()).find((point) => point.id === inactivePointId),
    ).toMatchObject({ status: "INACTIVE" });
  });

  it("keeps non-location PATCH facts exactly and rejects failed location changes without a write", async () => {
    const store = new MemoryStore(false);
    let mode: "MAPPED" | "UNAVAILABLE" = "MAPPED";
    let calls = 0;
    const reverse: ReverseLocationAdapter = {
      reverse: async (latitude, longitude) => {
        calls += 1;
        return mode === "UNAVAILABLE"
          ? { status: "UNAVAILABLE" }
          : {
              status: "MAPPED",
              coordinateSystem: "GCJ-02",
              latitude,
              longitude,
              providerAdministrativeId: "110101",
              directoryRegionCode: "110101",
              displayAddress: "北京市 / 北京市 / 东城区",
            };
      },
    };
    app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store,
      reverseLocationAdapter: reverse,
    });
    const area = await app.inject({
      method: "POST",
      url: "/api/v1/admin/service-areas",
      headers: admin,
      payload: { regionCode: "110101" },
    });
    const point = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: admin,
      payload: {
        serviceAreaId: area.json().data.id,
        name: "东门提货点",
        address: "东门服务站，1号",
        businessHours: "09:00-20:00",
        pickupInstructions: "出示领取码",
        latitude: 39.9042,
        longitude: 116.4074,
        contactName: "",
        contactPhone: "",
        capacityPerDay: null,
      },
    });
    expect(point.statusCode, point.body).toBe(201);
    const pointId = point.json().data.id as string;
    expect(calls).toBe(1);

    const retained = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pickup-points/${pointId}`,
      headers: admin,
      payload: {
        name: "东门提货点（营业时间更新）",
        address: "东门服务站,1号",
      },
    });
    expect(retained.statusCode, retained.body).toBe(200);
    expect(retained.json().data).toMatchObject({
      address: "东门服务站，1号",
      latitude: 39.9042,
      longitude: 116.4074,
    });
    expect(calls).toBe(1);

    mode = "UNAVAILABLE";
    const rejected = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pickup-points/${pointId}`,
      headers: admin,
      payload: { latitude: 39.904202 },
    });
    expect(rejected.statusCode, rejected.body).toBe(502);
    expect(rejected.json()).toMatchObject({
      code: "LOCATION_VERIFICATION_UNAVAILABLE",
    });
    expect((await store.listPickupPoints())[0]).toMatchObject({
      id: pointId,
      latitude: 39.9042,
    });
  });

  it("requires an explicit duplicate override and excludes the edited point from its own comparison", async () => {
    const store = new MemoryStore(false);
    const reverse: ReverseLocationAdapter = {
      reverse: async (latitude, longitude) => ({
        status: "MAPPED",
        coordinateSystem: "GCJ-02",
        latitude,
        longitude,
        providerAdministrativeId: "110101",
        directoryRegionCode: "110101",
        displayAddress: "北京市 / 北京市 / 东城区",
      }),
    };
    app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store,
      reverseLocationAdapter: reverse,
    });
    const area = await app.inject({
      method: "POST",
      url: "/api/v1/admin/service-areas",
      headers: admin,
      payload: { regionCode: "110101" },
    });
    const payload = {
      serviceAreaId: area.json().data.id,
      name: "东门提货点",
      address: "东门服务站 1 号",
      businessHours: "09:00-20:00",
      pickupInstructions: "出示领取码",
      latitude: 39.9042,
      longitude: 116.4074,
      contactName: "",
      contactPhone: "",
      capacityPerDay: null,
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: admin,
      payload,
    });
    expect(first.statusCode, first.body).toBe(201);
    const selfUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pickup-points/${first.json().data.id}`,
      headers: admin,
      payload: { latitude: 39.904201 },
    });
    expect(selfUpdate.statusCode, selfUpdate.body).toBe(200);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: admin,
      payload: { ...payload, name: "东门提货点二号", address: "东门服务站，1号" },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json()).toMatchObject({
      code: "POSSIBLE_DUPLICATE_PICKUP_LOCATION",
      details: { candidates: [expect.objectContaining({ id: first.json().data.id })] },
    });
    expect(await store.listPickupPoints()).toHaveLength(1);
    expect((await store.listAuditLogs(20)).map((log) => log.action)).toContain(
      "PICKUP_POINT_DUPLICATE_DETECTED",
    );

    const overridden = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: admin,
      payload: { ...payload, name: "东门提货点二号", confirmDuplicate: true },
    });
    expect(overridden.statusCode, overridden.body).toBe(201);
    expect((await store.listAuditLogs(20)).map((log) => log.action)).toContain(
      "PICKUP_POINT_DUPLICATE_OVERRIDDEN",
    );

  });

  it("manages categories and protects referenced categories from deletion", async () => {
    const store = new MemoryStore(false);
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/categories",
      headers: admin,
      payload: { name: "蔬菜", sortOrder: 1 },
    });
    expect(created.statusCode, created.body).toBe(201);
    const categoryId = created.json().data.id as string;
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/catalog/categories", headers: admin })).json().data).toHaveLength(1);
    const renamed = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/categories",
      headers: admin,
      payload: { id: categoryId, name: "叶菜", sortOrder: 2 },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().data).toMatchObject({ id: categoryId, name: "叶菜", sortOrder: 2 });
    const sku = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: admin,
      payload: {
        title: "时蔬",
        category: "蔬菜",
        categoryId,
        origin: "本地农场",
        skuName: "500克/袋",
        retailPriceCents: 1990,
        defaultSellableQuantity: 20,
      },
    });
    expect(sku.statusCode, sku.body).toBe(201);
    expect(sku.json().data).toMatchObject({ categoryId, product: { category: "叶菜" } });
    const disabledSku = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: admin,
      payload: {
        id: sku.json().data.id,
        productId: sku.json().data.productId,
        title: "时蔬",
        category: "叶菜",
        origin: "本地农场",
        skuName: "500克/袋",
        retailPriceCents: 1990,
        defaultSellableQuantity: 20,
        status: "INACTIVE",
      },
    });
    expect(disabledSku.statusCode, disabledSku.body).toBe(200);
    expect(disabledSku.json().data.categoryId).toBe(categoryId);
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/catalog/categories/${categoryId}`,
      headers: admin,
    });
    expect(deleted.statusCode, deleted.body).toBe(409);
    const disabled = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/categories",
      headers: admin,
      payload: { id: categoryId, name: "蔬菜", sortOrder: 1, status: "INACTIVE" },
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
    const rejectedSku = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: admin,
      payload: {
        title: "时蔬二号",
        category: "蔬菜",
        categoryId,
        origin: "本地农场",
        skuName: "500克/袋",
        retailPriceCents: 1990,
        defaultSellableQuantity: 20,
      },
    });
    expect(rejectedSku.statusCode, rejectedSku.body).toBe(409);
  });
});
