import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  batchCreatePickupPointsSchema,
  bookVehicleSchema,
  catalogSkuSchema,
  communityCampaignSchema,
  communityQualityAcceptanceSchema,
  communityQualityCaseSchema,
  communityQualityDecisionSchema,
  createInternalStaffSchema,
  createPickupPointSchema,
  createServiceAreaInterestSchema,
  identifierSchema,
  internalStaffDirectoryQuerySchema,
  notificationPreferenceSchema,
  openServiceAreaSchema,
  partialRefundExecutionSchema,
  postponeCampaignSchema,
  regionDirectoryQuerySchema,
  resetInternalStaffCredentialSchema,
  updateInternalStaffSchema,
  updateServiceAreaInterestStatusSchema,
  updateServiceAreaOrderStatusSchema,
} from "@hometown/api-contracts";
import { BusinessError, moneyCents } from "@hometown/domain";
import type { AppConfig } from "./config.js";
import { AdminAuthService } from "./modules/auth/admin-auth.js";
import { readDemoActor, requireActor } from "./modules/auth/auth.js";
import { StaffService } from "./modules/auth/staff-service.js";
import {
  AuthService,
  WechatApiCodeExchange,
  type WechatCodeExchange,
} from "./modules/auth/wechat-auth.js";
import {
  NoopCampaignScheduler,
  RedisCampaignScheduler,
  type CampaignScheduler,
} from "./modules/campaigns/campaign-scheduler.js";
import { CampaignService } from "./modules/campaigns/campaign-service.js";
import { MysqlStore } from "./modules/core/mysql-store.js";
import { MemoryStore, type CommerceStore } from "./modules/core/store.js";
import type {
  Campaign,
  CatalogSku,
  DeliveryPlan,
} from "./modules/core/types.js";
import { LedgerService } from "./modules/finance/ledger-service.js";
import { CommunityFulfillmentService } from "./modules/fulfillment/community-fulfillment-service.js";
import { CommunityOperationsService } from "./modules/fulfillment/community-operations-service.js";
import { CommunityQualityService } from "./modules/fulfillment/community-quality-service.js";
import { DeliveryPlanService } from "./modules/fulfillment/delivery-plan-service.js";
import { FulfillmentService } from "./modules/fulfillment/fulfillment-service.js";
import { NotificationService } from "./modules/notifications/notification-service.js";
import {
  DisabledSubscriptionMessageProvider,
  WechatSubscriptionMessageProvider,
  type SubscriptionMessageProvider,
} from "./modules/notifications/wechat-subscription-provider.js";
import { OrderService } from "./modules/orders/order-service.js";
import {
  MockPaymentProvider,
  WechatPaymentProvider,
  type PaymentProvider,
} from "./modules/payments/payment-provider.js";
import { PaymentService } from "./modules/payments/payment-service.js";
import {
  getRegionDirectoryEntry,
  listRegionDirectory,
} from "./modules/service-areas/region-directory.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerCommunityRoutes } from "./routes/community-routes.js";
import { registerFinanceRoutes } from "./routes/finance-routes.js";
import { registerFulfillmentRoutes } from "./routes/fulfillment-routes.js";
import { registerOrderRoutes } from "./routes/orders-routes.js";
import { registerPublicCatalogRoutes } from "./routes/public-catalog-routes.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody: string;
  }
}
export interface AppDependencies {
  config: AppConfig;
  store?: CommerceStore;
  wechatCodeExchange?: WechatCodeExchange;
  subscriptionMessageProvider?: SubscriptionMessageProvider;
  paymentProvider?: PaymentProvider;
}

export async function buildApp(
  dependencies: AppDependencies,
): Promise<FastifyInstance> {
  const { config } = dependencies;
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers.set-cookie",
            ],
          },
    genReqId: () => randomUUID(),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_048_576,
  });
  const store =
    dependencies.store ??
    (config.DATA_STORE === "mysql"
      ? MysqlStore.create(config.DATABASE_URL!)
      : new MemoryStore(false));
  const holder: { campaigns?: CampaignService } = {};
  let scheduler: CampaignScheduler = new NoopCampaignScheduler();
  if (config.QUEUE_DRIVER === "redis")
    scheduler = new RedisCampaignScheduler(
      config.REDIS_URL!,
      async (id, version) => {
        if (!holder.campaigns) throw new Error("团期服务尚未初始化");
        await holder.campaigns.close(id, true, version);
      },
    );
  const campaigns = new CampaignService(store, scheduler);
  holder.campaigns = campaigns;
  const orders = new OrderService(store, campaigns);
  const ledger = new LedgerService();
  const subscription =
    dependencies.subscriptionMessageProvider ??
    (config.WECHAT_APP_ID && config.WECHAT_APP_SECRET
      ? new WechatSubscriptionMessageProvider(config)
      : new DisabledSubscriptionMessageProvider());
  const notifications = new NotificationService(store, subscription);
  const fulfillment = new FulfillmentService(
    store,
    config.PICKUP_CODE_SECRET,
    ledger,
    notifications,
  );
  const communityFulfillment = new CommunityFulfillmentService(
    store,
    config.PICKUP_CODE_SECRET,
    notifications,
  );
  const communityQuality = new CommunityQualityService(store);
  const deliveryPlans = new DeliveryPlanService(store);
  const provider =
    dependencies.paymentProvider ??
    (config.PAYMENT_PROVIDER === "wechat"
      ? new WechatPaymentProvider({
          appId: config.WECHAT_APP_ID!,
          mchid: config.WECHAT_PAY_MCHID!,
          certificateSerial: config.WECHAT_PAY_CERT_SERIAL!,
          privateKeyPath: config.WECHAT_PAY_PRIVATE_KEY_PATH!,
          publicKeyId: config.WECHAT_PAY_PUBLIC_KEY_ID!,
          publicKeyPath: config.WECHAT_PAY_PUBLIC_KEY_PATH!,
          apiV3Key: config.WECHAT_PAY_API_V3_KEY!,
          notifyUrl: config.WECHAT_PAY_NOTIFY_URL!,
          refundNotifyUrl: config.WECHAT_PAY_REFUND_NOTIFY_URL!,
          merchantName: config.WECHAT_PAY_MERCHANT_NAME!,
        })
      : new MockPaymentProvider());
  const payments = new PaymentService(store, provider, ledger, notifications);
  const communityOperations = new CommunityOperationsService(
    store,
    payments,
    notifications,
  );
  campaigns.setRefundHandler((id) => payments.refundOrder(id));
  const authService =
    config.AUTH_PROVIDER === "wechat"
      ? new AuthService(
          store,
          dependencies.wechatCodeExchange ??
            new WechatApiCodeExchange(
              config.WECHAT_APP_ID!,
              config.WECHAT_APP_SECRET!,
            ),
          config.AUTH_SESSION_TTL_SECONDS,
        )
      : null;
  const adminAuthService = new AdminAuthService(
    store,
    config.AUTH_SESSION_TTL_SECONDS,
  );
  const staffService = new StaffService(store);

  const audit = (
    request: FastifyRequest,
    actorId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    beforeData: unknown,
    afterData: unknown,
  ) =>
    store.saveAuditLog({
      id: randomUUID(),
      actorId,
      action,
      resourceType,
      resourceId,
      requestId: request.id,
      beforeData,
      afterData,
      createdAt: new Date().toISOString(),
    });
  const rejectExternalEvidence = async (
    request: FastifyRequest,
    actorId: string,
    resourceType: string,
    resourceId: string,
    body: unknown,
  ) => {
    const visit = (value: unknown): boolean =>
      !!value &&
      typeof value === "object" &&
      (Array.isArray(value)
        ? value.some(visit)
        : Object.entries(value as Record<string, unknown>).some(
            ([key, nested]) =>
              key.toLowerCase() === "evidenceurl" || visit(nested),
          ));
    if (visit(body)) {
      await audit(
        request,
        actorId,
        "COMMUNITY_EVIDENCE_URL_REJECTED",
        resourceType,
        resourceId,
        null,
        { hasEvidenceUrl: true },
      );
      throw new BusinessError(
        "EVIDENCE_URL_NOT_ALLOWED",
        "社区团购仅支持文字说明，不接受外部证据链接",
        400,
      );
    }
  };
  const assertPointAccess = async (
    actor: { userId: string; roles: readonly string[] },
    pointId: string,
  ) => {
    const point = (await store.listPickupPoints()).find(
      (v) => v.id === pointId,
    );
    const user = await store.getUser(actor.userId);
    if (
      !point ||
      point.status !== "ACTIVE" ||
      !user ||
      user.status !== "ACTIVE"
    )
      throw new BusinessError("FORBIDDEN", "当前负责人或自提点不可用", 403);
    if (
      !actor.roles.includes("SUPER_ADMIN") &&
      !(await store.hasActivePickupPointAssignment(actor.userId, pointId))
    )
      throw new BusinessError("FORBIDDEN", "当前负责人没有该自提点权限", 403);
  };
  const publicPlan = (plan: DeliveryPlan | null) =>
    plan
      ? {
          id: plan.id,
          campaignId: plan.campaignId,
          serviceAreaId: plan.serviceAreaId,
          pickupPointId: plan.pickupPointId,
          status: plan.status,
          siteName: plan.siteName,
          address: plan.address,
          arrivalStartAt: plan.arrivalStartAt,
          arrivalEndAt: plan.arrivalEndAt,
          estimatedArrivalAt: plan.estimatedArrivalAt,
        }
      : null;
  const campaignView = async (campaign: Campaign) => ({
    ...campaign,
    deliveryPlan: publicPlan(
      await store.getDeliveryPlanByCampaign(campaign.id),
    ),
    items: campaign.items.map((item) => ({
      skuId: item.catalogSkuId,
      title: item.title,
      category: item.category,
      skuName: item.skuName,
      origin: item.origin,
      imageUrl: item.imageUrl,
      unitPriceCents: Number(item.retailPriceCents),
      stock: item.sellableQuantity,
      soldQuantity: item.reservedQuantity,
    })),
  });

  app.decorateRequest("rawBody", "");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      const raw = typeof body === "string" ? body : body.toString("utf8");
      request.rawBody = raw;
      try {
        done(null, JSON.parse(raw));
      } catch {
        done(
          new BusinessError("VALIDATION_ERROR", "请求体不是有效的 JSON", 400),
          undefined,
        );
      }
    },
  );
  await app.register(cors, {
    origin: config.NODE_ENV === "production" ? false : true,
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
  });
  app.decorateRequest("actor", null);
  if (config.REQUIRE_HTTPS)
    app.addHook("onRequest", async (request) => {
      const value = request.headers["x-forwarded-proto"];
      const protocol = Array.isArray(value)
        ? value[0]
        : value?.split(",")[0]?.trim();
      if (protocol !== "https")
        throw new BusinessError(
          "HTTPS_REQUIRED",
          "HTTPS connection required",
          426,
        );
    });
  app.addHook("onRequest", async (request) => {
    request.actor =
      (await adminAuthService.authenticate(request.headers.authorization)) ??
      (config.AUTH_PROVIDER === "demo"
        ? readDemoActor(request)
        : await authService!.authenticate(request.headers.authorization));
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof BusinessError)
      return reply
        .status(error.statusCode)
        .send({
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details === undefined ? {} : { details: error.details }),
        });
    if (typeof error === "object" && error !== null && "issues" in error)
      return reply
        .status(400)
        .send({
          code: "VALIDATION_ERROR",
          message: "请求参数不正确",
          requestId: request.id,
          details: error.issues,
        });
    request.log.error({ err: error }, "unhandled request error");
    return reply
      .status(500)
      .send({
        code: "INTERNAL_ERROR",
        message: "服务暂时不可用",
        requestId: request.id,
      });
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => ({
    status: "ok",
    dependencies: {
      dataStore: await store.health(),
      queue: await scheduler.health(),
    },
  }));

  registerAuthRoutes(app, {
    authService,
    adminAuthService,
    staffService,
    privacyNoticeVersion: config.PRIVACY_NOTICE_VERSION,
  });
  registerPublicCatalogRoutes(app, {
    campaigns,
    listServiceAreas: () => store.listServiceAreas(),
    listPickupPoints: (id) => store.listPickupPoints(id),
    getDeliveryPlanByCampaign: (id) => store.getDeliveryPlanByCampaign(id),
    withCampaignItems: campaignView,
    publicDeliveryPlan: publicPlan,
  });
  registerOrderRoutes(app, {
    store,
    orders,
    payments,
    communityOperations,
    audit,
    rejectCommunityExternalEvidence: rejectExternalEvidence,
  });
  registerFulfillmentRoutes(app, {
    store,
    fulfillment,
    assertActivePickupPointAccess: assertPointAccess,
  });
  registerCommunityRoutes(app, {
    store,
    communityFulfillment,
    communityOperations,
    assertActivePickupPointAccess: assertPointAccess,
    rejectCommunityExternalEvidence: rejectExternalEvidence,
  });
  registerFinanceRoutes(app, store);

  app.get("/api/v1/admin/region-directory", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return {
      data: listRegionDirectory(
        regionDirectoryQuerySchema.parse(request.query).query,
      ),
    };
  });
  app.get("/api/v1/admin/service-areas", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return { data: await store.listServiceAreas() };
  });
  app.post("/api/v1/admin/service-areas", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const input = openServiceAreaSchema.parse(request.body);
    const entry = getRegionDirectoryEntry(input.regionCode);
    if (!entry)
      throw new BusinessError(
        "RESOURCE_NOT_FOUND",
        "行政区划目录中未找到该区域",
        404,
      );
    const existing = (await store.listServiceAreas()).find(
      (v) => v.regionCode === entry.regionCode,
    );
    if (existing) {
      if (!existing.orderEnabled)
        await store.updateServiceAreaOrderEnabled(existing.id, true);
      return { data: { ...existing, orderEnabled: true } };
    }
    const value = {
      id: randomUUID(),
      regionCode: entry.regionCode,
      name: entry.name,
      status: "ENABLED" as const,
      orderEnabled: true,
      createdAt: new Date().toISOString(),
    };
    await store.saveServiceArea(value);
    await audit(
      request,
      actor.userId,
      "SERVICE_AREA_CREATED",
      "SERVICE_AREA",
      value.id,
      null,
      value,
    );
    return reply.status(201).send({ data: value });
  });
  app.post("/api/v1/admin/service-areas/:id/order-status", async (request) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const input = updateServiceAreaOrderStatusSchema.parse(request.body);
    const before = (await store.listServiceAreas()).find((v) => v.id === id);
    if (!before)
      throw new BusinessError("RESOURCE_NOT_FOUND", "服务区域不存在", 404);
    await store.updateServiceAreaOrderEnabled(id, input.orderEnabled);
    const after = { ...before, orderEnabled: input.orderEnabled };
    await audit(
      request,
      actor.userId,
      "SERVICE_AREA_STATUS_UPDATED",
      "SERVICE_AREA",
      id,
      before,
      after,
    );
    return { data: after };
  });
  app.get("/api/v1/admin/pickup-points", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return { data: await store.listPickupPoints() };
  });
  const createPoint = async (input: {
    serviceAreaId: string;
    name: string;
    address: string;
    capacityPerDay: number | null;
  }) => {
    if (
      !(await store.listServiceAreas()).some(
        (v) => v.id === input.serviceAreaId,
      )
    )
      throw new BusinessError("RESOURCE_NOT_FOUND", "服务区域不存在", 404);
    const value = {
      id: randomUUID(),
      ...input,
      status: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
    };
    await store.savePickupPoint(value);
    return value;
  };
  app.post("/api/v1/admin/pickup-points", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const value = await createPoint(
      createPickupPointSchema.parse(request.body),
    );
    await audit(
      request,
      actor.userId,
      "PICKUP_POINT_CREATED",
      "PICKUP_POINT",
      value.id,
      null,
      value,
    );
    return reply.status(201).send({ data: value });
  });
  app.post("/api/v1/admin/pickup-points/batch", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const input = batchCreatePickupPointsSchema.parse(request.body);
    const areas = await store.listServiceAreas();
    const created = [];
    for (const point of input.points) {
      const area = areas.find(
        (v) => v.name === point.city || v.regionCode === point.city,
      );
      if (!area)
        throw new BusinessError(
          "RESOURCE_NOT_FOUND",
          `服务区域 ${point.city} 尚未开通`,
          404,
        );
      created.push(
        await createPoint({
          serviceAreaId: area.id,
          name: point.name,
          address: point.address,
          capacityPerDay: point.capacityPerDay,
        }),
      );
    }
    await audit(
      request,
      actor.userId,
      "PICKUP_POINTS_CREATED",
      "PICKUP_POINT",
      "batch",
      null,
      created,
    );
    return reply
      .status(201)
      .send({ data: { created: created.length, points: created } });
  });

  app.get("/api/v1/admin/catalog/skus", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return { data: await store.listCatalogSkus() };
  });
  app.post("/api/v1/admin/catalog/skus", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const input = catalogSkuSchema.parse(request.body);
    const existing = input.id ? await store.getCatalogSku(input.id) : null;
    const now = new Date().toISOString();
    const value: CatalogSku = {
      id: input.id ?? randomUUID(),
      productId: input.productId ?? randomUUID(),
      name: input.skuName,
      retailPriceCents: moneyCents(input.retailPriceCents),
      defaultSellableQuantity: input.defaultSellableQuantity,
      status: input.status,
      product: {
        id: input.productId ?? existing?.productId ?? randomUUID(),
        title: input.title,
        category: input.category,
        origin: input.origin,
        imageUrl: input.imageUrl,
        storageType: "NORMAL_TEMPERATURE",
        status: input.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    value.productId = value.product.id;
    await store.saveCatalogSku(value);
    await audit(
      request,
      actor.userId,
      "CATALOG_SKU_SAVED",
      "CATALOG_SKU",
      value.id,
      existing,
      value,
    );
    return reply.status(existing ? 200 : 201).send({ data: value });
  });
  app.get("/api/v1/admin/campaigns", async (request) => {
    requireActor(request, ["OPERATOR", "FINANCE", "SUPER_ADMIN"]);
    return {
      data: await Promise.all((await campaigns.list()).map(campaignView)),
    };
  });
  app.post("/api/v1/admin/campaigns", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const value = await communityFulfillment.createCampaign(
      communityCampaignSchema.parse(request.body),
      actor.userId,
      request.id,
    );
    return reply.status(201).send({ data: await campaignView(value) });
  });
  for (const [suffix, action] of [
    ["open", "open"],
    ["close", "close"],
    ["cancel", "cancel"],
  ] as const)
    app.post(`/api/v1/admin/campaigns/:id/${suffix}`, async (request) => {
      const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const before = await campaigns.get(id);
      const after = await campaigns[action](id);
      await audit(
        request,
        actor.userId,
        `CAMPAIGN_${suffix.toUpperCase()}`,
        "CAMPAIGN",
        id,
        before,
        after,
      );
      return { data: after };
    });
  app.post("/api/v1/admin/campaigns/:id/postpone", async (request) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const before = await campaigns.get(id);
    const after = await campaigns.postpone(
      id,
      postponeCampaignSchema.parse(request.body),
    );
    await audit(
      request,
      actor.userId,
      "CAMPAIGN_POSTPONED",
      "CAMPAIGN",
      id,
      before,
      after,
    );
    return { data: after };
  });
  app.get("/api/v1/admin/campaigns/:id/packing-labels", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const values = (await store.listOrdersByCampaign(id))
      .filter(
        (v) =>
          v.paidAt &&
          ["LOCKED", "ALLOCATING", "IN_TRANSIT", "READY_FOR_PICKUP"].includes(
            v.status,
          ),
      )
      .sort(
        (a, b) =>
          (a.paidAt ?? "").localeCompare(b.paidAt ?? "") ||
          a.orderNo.localeCompare(b.orderNo),
      );
    return {
      data: values.map((v) => ({
        orderId: v.id,
        orderNo: v.orderNo,
        pickupPointId: v.pickupPointId,
        paidAt: v.paidAt,
        items: v.items.map((item) => ({
          catalogSkuId: item.skuId,
          name: item.name,
          quantity: item.quantity,
        })),
      })),
    };
  });
  app.get("/api/v1/admin/delivery-plans", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return { data: await deliveryPlans.list() };
  });
  app.post("/api/v1/admin/delivery-plans/:id/book-vehicle", async (request) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const before = await store.getDeliveryPlan(id);
    const after = await deliveryPlans.bookVehicle(
      id,
      bookVehicleSchema.parse(request.body),
    );
    await audit(
      request,
      actor.userId,
      "DELIVERY_VEHICLE_BOOKED",
      "DELIVERY_PLAN",
      id,
      before,
      after,
    );
    return { data: after };
  });
  app.get("/api/v1/pickup/delivery-plans", async (request) => {
    const actor = requireActor(request, ["PICKUP_MANAGER", "SUPER_ADMIN"]);
    const values = [];
    for (const plan of await store.listDeliveryPlans())
      if (
        plan.status === "ARRIVED" &&
        (actor.roles.includes("SUPER_ADMIN") ||
          (await store.hasActivePickupPointAssignment(
            actor.userId,
            plan.pickupPointId,
          )))
      )
        values.push(publicPlan(plan));
    return { data: values };
  });

  const staffView = (value: Awaited<ReturnType<typeof staffService.get>>) => ({
    ...value,
    phone: `${value.phone.slice(0, 3)}****${value.phone.slice(-4)}`,
  });
  app.get("/api/v1/admin/staff", async (request) => {
    requireActor(request, ["SUPER_ADMIN"]);
    const { query } = internalStaffDirectoryQuerySchema.parse(request.query);
    return { data: (await staffService.list(query)).map(staffView) };
  });
  app.get("/api/v1/admin/staff/:id", async (request) => {
    requireActor(request, ["SUPER_ADMIN"]);
    return {
      data: staffView(
        await staffService.get(
          identifierSchema.parse((request.params as { id: string }).id),
        ),
      ),
    };
  });
  app.post("/api/v1/admin/staff", async (request, reply) => {
    const actor = requireActor(request, ["SUPER_ADMIN"]);
    const value = await staffService.create(
      createInternalStaffSchema.parse(request.body),
      actor.userId,
      request.id,
    );
    return reply
      .status(201)
      .send({
        data: {
          staff: staffView(value.staff),
          initialCredential: value.initialCredential,
        },
      });
  });
  app.patch("/api/v1/admin/staff/:id", async (request) => {
    const actor = requireActor(request, ["SUPER_ADMIN"]);
    return {
      data: staffView(
        await staffService.update(
          identifierSchema.parse((request.params as { id: string }).id),
          updateInternalStaffSchema.parse(request.body),
          actor.userId,
          request.id,
        ),
      ),
    };
  });
  app.post("/api/v1/admin/staff/:id/reset-credential", async (request) => {
    const actor = requireActor(request, ["SUPER_ADMIN"]);
    const { reason } = resetInternalStaffCredentialSchema.parse(request.body);
    const value = await staffService.resetCredential(
      identifierSchema.parse((request.params as { id: string }).id),
      reason,
      actor.userId,
      request.id,
    );
    return {
      data: {
        staff: staffView(value.staff),
        initialCredential: value.initialCredential,
      },
    };
  });

  app.post("/api/v1/orders/:id/pay", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    return {
      data: await payments.initiate(
        identifierSchema.parse((request.params as { id: string }).id),
        actor.userId,
      ),
    };
  });
  app.post("/api/v1/orders/:id/pay/mock-confirm", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    await payments.confirmMock(
      identifierSchema.parse((request.params as { id: string }).id),
      actor.userId,
    );
    return { data: { status: "SUCCEEDED" } };
  });
  app.post("/api/v1/payments/wechat/notify", async (request, reply) => {
    await payments.handleNotification(
      provider.parseNotification(
        request.rawBody,
        request.headers as Record<string, string | undefined>,
      ),
    );
    return reply.send({ code: "SUCCESS", message: "成功" });
  });
  app.post("/api/v1/payments/wechat/refund-notify", async (request, reply) => {
    await payments.handleRefundNotification(
      provider.parseRefundNotification(
        request.rawBody,
        request.headers as Record<string, string | undefined>,
      ),
    );
    return reply.send({ code: "SUCCESS", message: "成功" });
  });
  app.post("/api/v1/orders/:id/quality-cases", async (request, reply) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    await rejectExternalEvidence(
      request,
      actor.userId,
      "ORDER",
      id,
      request.body,
    );
    return reply
      .status(201)
      .send({
        data: await communityQuality.submit(
          id,
          actor.userId,
          communityQualityCaseSchema.parse(request.body),
          request.id,
        ),
      });
  });
  app.get("/api/v1/admin/quality-cases", async (request) => {
    requireActor(request, [
      "CUSTOMER_SERVICE",
      "OPERATOR",
      "FINANCE",
      "SUPER_ADMIN",
    ]);
    return { data: await store.listCommunityQualityCases(500) };
  });
  app.post("/api/v1/admin/quality-cases/:id/accept", async (request) => {
    const actor = requireActor(request, ["CUSTOMER_SERVICE", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    return {
      data: await communityQuality.accept(
        id,
        actor.userId,
        communityQualityAcceptanceSchema.parse(request.body).note,
        request.id,
      ),
    };
  });
  app.post("/api/v1/admin/quality-cases/:id/decision", async (request) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const input = communityQualityDecisionSchema.parse(request.body);
    return {
      data: await communityQuality.decide(
        id,
        actor.userId,
        input.approved,
        input.note,
        request.id,
      ),
    };
  });
  app.post("/api/v1/admin/quality-cases/:id/refund", async (request) => {
    const actor = requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const value = await store.getCommunityQualityCaseForUpdate(id);
    if (!value?.refundExceptionId)
      throw new BusinessError(
        "INVALID_STATE_TRANSITION",
        "品质售后尚未批准退款",
        409,
      );
    await payments.executePartialRefund(value.refundExceptionId, {
      actorId: actor.userId,
      requestId: request.id,
      confirmationNote: "品质售后退款",
    });
    return {
      data: await communityQuality.markFinanceExecuted(
        id,
        actor.userId,
        request.id,
      ),
    };
  });
  app.get("/api/v1/admin/fulfillment-exceptions", async (request) => {
    requireActor(request, [
      "OPERATOR",
      "FINANCE",
      "CUSTOMER_SERVICE",
      "SUPER_ADMIN",
    ]);
    return { data: await store.listFulfillmentExceptions(500) };
  });
  app.post(
    "/api/v1/admin/fulfillment-exceptions/:id/refund",
    async (request) => {
      const actor = requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const input = partialRefundExecutionSchema.parse(request.body);
      await payments.executePartialRefund(id, {
        actorId: actor.userId,
        requestId: request.id,
        confirmationNote: input.confirmationNote,
      });
      return { data: await store.getFulfillmentException(id) };
    },
  );
  app.post("/api/v1/service-area-interests", async (request, reply) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const input = createServiceAreaInterestSchema.parse(request.body);
    if (input.privacyVersion !== config.PRIVACY_NOTICE_VERSION)
      throw new BusinessError("VALIDATION_ERROR", "隐私说明已更新", 400);
    const value = {
      id: randomUUID(),
      userId: actor.userId,
      regionText: input.regionText,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      privacyVersion: input.privacyVersion,
      privacyConsentedAt: new Date().toISOString(),
      status: "NEW" as const,
      createdAt: new Date().toISOString(),
    };
    await store.saveServiceAreaInterest(value);
    return reply.status(201).send({ data: value });
  });
  app.get("/api/v1/admin/service-area-interests", async (request) => {
    requireActor(request, ["CUSTOMER_SERVICE", "OPERATOR", "SUPER_ADMIN"]);
    return { data: await store.listServiceAreaInterests(500) };
  });
  app.post(
    "/api/v1/admin/service-area-interests/:id/status",
    async (request) => {
      requireActor(request, ["CUSTOMER_SERVICE", "OPERATOR", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const value = await store.getServiceAreaInterest(id);
      if (!value)
        throw new BusinessError("RESOURCE_NOT_FOUND", "区域意向不存在", 404);
      value.status = updateServiceAreaInterestStatusSchema.parse(
        request.body,
      ).status;
      await store.saveServiceAreaInterest(value);
      return { data: value };
    },
  );
  app.get("/api/v1/notifications", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    return { data: await store.listOrderNotificationsByUser(actor.userId) };
  });
  app.post("/api/v1/notifications/:id/read", async (request, reply) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const value = await store.getOrderNotification(id);
    if (!value || value.userId !== actor.userId)
      throw new BusinessError("RESOURCE_NOT_FOUND", "消息不存在", 404);
    await store.markOrderNotificationRead(id, new Date().toISOString());
    return reply.status(204).send();
  });
  app.post("/api/v1/notifications/preferences", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const value = {
      userId: actor.userId,
      types: notificationPreferenceSchema.parse(request.body).types,
      updatedAt: new Date().toISOString(),
    };
    await store.saveNotificationPreference(value);
    return { data: value };
  });
  app.get("/api/v1/admin/notifications/manual", async (request) => {
    requireActor(request, ["CUSTOMER_SERVICE", "OPERATOR", "SUPER_ADMIN"]);
    return { data: await store.listManualOrderNotifications(500) };
  });
  app.post("/api/v1/admin/notifications/:id/retry", async (request) => {
    requireActor(request, ["CUSTOMER_SERVICE", "OPERATOR", "SUPER_ADMIN"]);
    return {
      data: await notifications.retryPending(
        identifierSchema.parse((request.params as { id: string }).id),
      ),
    };
  });
  app.post(
    "/api/v1/admin/notifications/:id/manual-complete",
    async (request, reply) => {
      requireActor(request, ["CUSTOMER_SERVICE", "OPERATOR", "SUPER_ADMIN"]);
      await store.markOrderNotificationManualCompleted(
        identifierSchema.parse((request.params as { id: string }).id),
      );
      return reply.status(204).send();
    },
  );
  app.get("/api/v1/admin/audit-logs", async (request) => {
    requireActor(request, ["SUPER_ADMIN"]);
    return { data: await store.listAuditLogs(500) };
  });

  await scheduler.reconcile(await store.listCampaigns());
  await orders.expirePendingOrders();
  await communityOperations.reconcilePickupDeadlines();
  await payments.reconcileRefunds();
  await communityOperations.reconcileExpiredPickupRefunds();
  await communityOperations.reconcileCancellationRefunds();
  await notifications
    .drainPending()
    .catch((error) =>
      app.log.error({ err: error }, "notification drain failed"),
    );
  const timer = setInterval(() => {
    void store
      .listCampaigns()
      .then((values) => scheduler.reconcile(values))
      .then(() => orders.expirePendingOrders())
      .then(() => communityOperations.reconcilePickupDeadlines())
      .then(() => payments.reconcileRefunds())
      .then(() => communityOperations.reconcileExpiredPickupRefunds())
      .then(() => communityOperations.reconcileCancellationRefunds())
      .then(() => notifications.drainPending())
      .catch((error) =>
        app.log.error({ err: error }, "background reconciliation failed"),
      );
  }, 30_000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await scheduler.close();
    await store.close();
  });
  return app;
}
