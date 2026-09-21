import { exceptionReadModel } from "./modules/fulfillment/exception-readmodel.js";
import { operationsPageSchema } from "./routes/operations-pagination.js";
import { z } from "zod";
import { ProductImages } from './modules/media/product-images.js';
import { registerProductImageRoutes } from './routes/product-image-routes.js';
import { registerMerchandisingRoutes } from "./routes/merchandising-routes.js";
import { registerProfileRoutes } from "./routes/profile-routes.js";
import { WechatApiPhoneExchange, type WechatPhoneExchange } from './modules/auth/wechat-phone.js';
import type { OrderNotificationType } from './modules/core/types.js';
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { Redis } from "ioredis";
import {
  batchCreatePickupPointsSchema,
  bookVehicleSchema,
  campaignCancelSchema,
  campaignCloseSchema,
  catalogSkuSchema,
  productCategorySchema,
  communityCampaignSchema,
  communityQualityAcceptanceSchema,
  communityQualityCaseSchema,
  communityQualityDecisionSchema,
  createInternalStaffSchema,
  createPickupPointSchema,
  createServiceAreaInterestSchema,
  emergencyVehicleCorrectionSchema,
  identifierSchema,
  internalStaffDirectoryQuerySchema,
  notificationManualCompletionSchema,
  notificationPreferenceSchema,
  openServiceAreaSchema,
  partialRefundExecutionSchema,
  postponeCampaignSchema,
  geoReverseQuerySchema,
  geoSearchQuerySchema,
  regionDirectoryQuerySchema,
  resetInternalStaffCredentialSchema,
  updateInternalStaffSchema,
  updatePickupPointSchema,
  updateServiceAreaInterestStatusSchema,
  updateOwnServiceAreaInterestSchema,
  updateServiceAreaOrderStatusSchema,
} from "@hometown/api-contracts";
import { BusinessError, moneyCents } from "@hometown/domain";
import type { AppConfig } from "./config.js";
import { AdminAuthService } from "./modules/auth/admin-auth.js";
import { readDemoActor, requireActor } from "./modules/auth/auth.js";
import {
  createLoginRateLimiter,
  type LoginRateLimiter,
} from "./modules/auth/login-rate-limiter.js";
import { StaffService } from "./modules/auth/staff-service.js";
import { runWithInternalWriteActor } from "./modules/auth/internal-write-context.js";
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
import { operationalErrorDiagnostics, operationalErrorText } from "./modules/core/operational-error.js";
import type {
  Campaign,
  CatalogSku,
  ProductCategory,
  DeliveryPlan,
  PickupPoint,
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
  createAmapReverseLocationAdapter,
  createGeoSearch,
} from "./modules/service-areas/geo-search.js";
import {
  getRegionDirectoryEntry,
  listRegionDirectory,
} from "./modules/service-areas/region-directory.js";
import {
  hasPickupLocationVerificationTrigger,
  normalizePickupAddress,
  type ReverseLocationAdapter,
  validatePickupPointLocation,
} from "./modules/service-areas/pickup-location-validation.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerCommunityRoutes } from "./routes/community-routes.js";
import { registerFinanceRoutes } from "./routes/finance-routes.js";
import { registerFulfillmentRoutes } from "./routes/fulfillment-routes.js";
import { registerOrderRoutes } from "./routes/orders-routes.js";
import { registerPublicCatalogRoutes } from "./routes/public-catalog-routes.js";

const sensitiveAuditKeys = new Set([
  "password",
  "passwordhash",
  "passwordsalt",
  "token",
  "tokenhash",
  "authorization",
  "initialcredential",
  "temporarypassword",
  "credential",
  "wechatopenid",
  "openid",
  "contactphone",
  "phone",
  "clientpayload",
  "providercontext",
  "payload",
]);

function maskPhone(value: string): string {
  return /^1[3-9]\d{9}$/.test(value)
    ? `${value.slice(0, 3)}****${value.slice(-4)}`
    : "[REDACTED]";
}

/** Audit is an operational view, never a raw persistence dump. */
function redactAuditData(value: unknown, key?: string): unknown {
  const normalized = key?.toLowerCase();
  if (
    normalized &&
    (sensitiveAuditKeys.has(normalized) ||
      normalized.includes("password") ||
      normalized.includes("token") ||
      normalized.includes("credential") ||
      normalized.includes("openid") ||
      normalized.endsWith("phone") ||
      normalized.includes("payload"))
  )
    return "[REDACTED]";
  if (typeof value === "string")
    return /^1[3-9]\d{9}$/.test(value) ? maskPhone(value) : value;
  if (Array.isArray(value)) return value.map((entry) => redactAuditData(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entry]) => [
      entryKey,
      redactAuditData(entry, entryKey),
    ]),
  );
}

declare module "fastify" {
  interface FastifyRequest {
    rawBody: string;
  }
}
export interface AppDependencies {
  config: AppConfig;
  store?: CommerceStore;
  scheduler?: CampaignScheduler;
  logger?: FastifyServerOptions["logger"];
  /** Deterministic adapter injection is test-only; production uses Amap only. */
  reverseLocationAdapter?: ReverseLocationAdapter;
  wechatCodeExchange?: WechatCodeExchange;
  wechatPhoneExchange?: WechatPhoneExchange;
  subscriptionMessageProvider?: SubscriptionMessageProvider;
  paymentProvider?: PaymentProvider;
  loginRateLimiter?: LoginRateLimiter;
}

export async function hasReadyAdminBootstrap(store: CommerceStore): Promise<boolean> {
  return (
    await Promise.all(
      (await store.listInternalStaff()).map(async (staff) => {
        if (staff.status !== "ACTIVE" || staff.role !== "SUPER_ADMIN") return false;
        const [user, credential] = await Promise.all([
          store.getUser(staff.userId),
          store.findAdminCredentialByUserId(staff.userId),
        ]);
        return Boolean(
          user?.status === "ACTIVE" &&
            credential &&
            credential.legacyDisabled !== true &&
            !credential.mustChangePassword &&
            credential.roles.length === 1 &&
            credential.roles[0] === "SUPER_ADMIN" &&
            credential.authorizationVersion === staff.authorizationVersion,
        );
      }),
    )
  ).some(Boolean);
}

/**
 * The application test server has no external map capability.  This fixture is
 * deliberately available only to NODE_ENV=test and never selected by a normal
 * development or production process.  Feature tests that exercise failures
 * inject an explicit adapter instead.
 */
function createDeterministicTestReverseLocationAdapter(): ReverseLocationAdapter {
  return {
    async reverse(latitude, longitude) {
      // Browser and API fixtures use several coordinates inside the same
      // test-only East-District service area. This adapter exists solely to
      // keep deterministic tests independent of an external provider; path
      // mismatch cases inject their own adapter explicitly.
      const directoryRegionCode = "110101";
      return {
        status: "MAPPED",
        coordinateSystem: "GCJ-02",
        latitude: Number(latitude.toFixed(6)),
        longitude: Number(longitude.toFixed(6)),
        providerAdministrativeId: directoryRegionCode,
        directoryRegionCode,
        displayAddress: "测试行政目录位置",
      };
    },
  };
}

export async function buildApp(
  dependencies: AppDependencies,
): Promise<FastifyInstance> {
  const { config } = dependencies;
  const productImages = new ProductImages(config.PRODUCT_IMAGE_DIR);
  const profileImages = new ProductImages(resolve(config.PRODUCT_IMAGE_DIR, "profiles"), "/api/v1/profile-images/");
  await Promise.all([productImages.initialize(), profileImages.initialize()]);
  const app = Fastify({
    logger:
      dependencies.logger ?? (config.NODE_ENV === "test"
        ? false
        : {
            level: config.LOG_LEVEL,
            serializers: {
              req: (request) => ({
                method: request.method,
                // Never serialize query strings: pickup-code lookups have a
                // legacy GET form and their code must not enter application logs.
                url: (request.url ?? "").split("?", 1)[0] ?? "",
                requestId: request.id,
              }),
            },
            redact: [
              "req.headers.authorization",
              "req.body.code",
              "req.body.phoneCode",
              "req.body.phoneNumber",
              "req.body.openid",
              "req.headers.cookie",
              "res.headers.set-cookie",
            ],
          }),
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
  let scheduler: CampaignScheduler = dependencies.scheduler ?? new NoopCampaignScheduler();
  let reconciliationRunning = false;
  let lastReconciliationAt: string | null = null;
  let lastReconciliationError: string | null = null;
  if (!dependencies.scheduler && config.QUEUE_DRIVER === "redis")
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
  const subscription: SubscriptionMessageProvider =
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
  campaigns.setRefundHandler(async (store, id) => {
    await payments.ensureOrderRefundIntent(store, id);
  });
  campaigns.setPostponeNotificationHandler(async (transactionStore, campaign, plan) => {
    await notifications.enqueueCampaign(
      transactionStore,
      "CAMPAIGN_POSTPONED",
      campaign.id,
      plan,
      `campaign-postponed:${campaign.id}:${campaign.version}`,
    );
  });
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
          dependencies.wechatPhoneExchange ?? new WechatApiPhoneExchange(config.WECHAT_APP_ID!, config.WECHAT_APP_SECRET!),
          config.PRIVACY_NOTICE_VERSION,
        )
      : null;
  const adminAuthService = new AdminAuthService(
    store,
    config.AUTH_SESSION_TTL_SECONDS,
  );
  const loginRateLimitRedis = !dependencies.loginRateLimiter && config.REDIS_URL
    ? new Redis(config.REDIS_URL)
    : null;
  const loginRateLimiter =
    dependencies.loginRateLimiter ??
    createLoginRateLimiter(
      loginRateLimitRedis,
      config.NODE_ENV === "production",
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
  const auditInTransaction = (
    transactionStore: CommerceStore,
    request: FastifyRequest,
    actorId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    beforeData: unknown,
    afterData: unknown,
  ) =>
    transactionStore.saveAuditLog({
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
  campaigns.setPostponeAuditHandler(
    async (transactionStore, context, before, after) => {
      await transactionStore.saveAuditLog({
        id: randomUUID(),
        actorId: context.actorId,
        action: "CAMPAIGN_POSTPONED",
        resourceType: "CAMPAIGN",
        resourceId: after.id,
        requestId: context.requestId,
        beforeData: before,
        afterData: after,
        createdAt: await transactionStore.databaseNow(),
      });
    },
  );
  campaigns.setActionAuditHandler(
    async (transactionStore, context, action, before, after) => {
      await transactionStore.saveAuditLog({
        id: randomUUID(),
        actorId: context.actorId,
        action: `CAMPAIGN_${action}`,
        resourceType: "CAMPAIGN",
        resourceId: after.id,
        requestId: context.requestId,
        beforeData: before,
        afterData: {
          ...after,
          ...(context.reason ? { reason: context.reason } : {}),
        },
        createdAt: await transactionStore.databaseNow(),
      });
    },
  );
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
  const campaignView = async (campaign: Campaign) => {
    const [plan, orders, points] = await Promise.all([
      store.getDeliveryPlanByCampaign(campaign.id),
      store.listOrdersByCampaign(campaign.id),
      store.listPickupPoints(campaign.serviceAreaId),
    ]);
    const paidBySku = new Map<string, number>();
    for (const order of orders) {
      if (
        order.paidAt === null ||
        ![
          "PAID_WAITING_CLOSE",
          "LOCKED",
          "ALLOCATING",
          "IN_TRANSIT",
          "READY_FOR_PICKUP",
          "PICKED_UP",
          "COMPLETED",
        ].includes(order.status)
      )
        continue;
      for (const item of order.items)
        paidBySku.set(
          item.skuId,
          (paidBySku.get(item.skuId) ?? 0) + item.quantity,
        );
    }
    return {
      ...campaign,
      deliveryPlan: publicPlan(plan),
      pickupPoint: plan
        ? (points.find((point) => point.id === plan.pickupPointId) ?? null)
        : null,
      paidQuantity: [...paidBySku.values()].reduce(
        (total, quantity) => total + quantity,
        0,
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
        paidQuantity: paidBySku.get(item.catalogSkuId) ?? 0,
        soldQuantity: item.reservedQuantity,
      })),
    };
  };
  const publicCampaignView = async (campaign: Campaign) => {
    const [view, catalog] = await Promise.all([
      campaignView(campaign),
      store.listCatalogSkus(),
    ]);
    const activeSkuIds = new Set(
      catalog
        .filter((sku) => sku.status === "ACTIVE")
        .map((sku) => sku.id),
    );
    return {
      ...view,
      // Campaign and order snapshots remain immutable. This only removes a
      // deactivated SKU from the consumer directory.
      items: view.items.filter((item) => activeSkuIds.has(item.skuId)),
    };
  };

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
  app.addHook("onSend", async (request, reply) => {
    // The id is generated by Fastify for every request; overwrite any caller
    // supplied header so support references cannot be forged or confused.
    reply.header("x-request-id", request.id);
  });
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
  app.addHook("onRequest", (request, _reply, done) => {
    void adminAuthService
      .authenticate(request.headers.authorization)
      .then(
        async (adminActor) =>
          adminActor ??
          (config.AUTH_PROVIDER === "demo"
            ? readDemoActor(request)
            : await authService!.authenticate(request.headers.authorization)),
      )
      .then(
        (actor) => {
          request.actor = actor;
          runWithInternalWriteActor(actor, done);
        },
        (error: Error) => done(error),
      );
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof BusinessError && error.code === "LOGIN_RATE_LIMITED") {
      const retryAfterSeconds =
        error.details &&
        typeof error.details === "object" &&
        "retryAfterSeconds" in error.details &&
        typeof error.details.retryAfterSeconds === "number"
          ? Math.max(1, Math.ceil(error.details.retryAfterSeconds))
          : 900;
      reply.header("Retry-After", String(retryAfterSeconds));
      return reply.status(429).send({
        code: error.code,
        message: error.message,
        requestId: request.id,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    }
    // @fastify/rate-limit throws a framework error rather than a BusinessError.
    // Preserve its protocol status at the product boundary instead of allowing
    // the generic handler below to turn normal back-pressure into a 500.
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      const isAdminLogin = request.url.startsWith("/api/v1/auth/admin/login");
      reply.header("Retry-After", isAdminLogin ? "900" : "60");
      return reply.status(429).send({
        code: isAdminLogin ? "LOGIN_RATE_LIMITED" : "RATE_LIMITED",
        message: isAdminLogin
          ? "登录尝试过于频繁，请 15 分钟后再试"
          : "请求过于频繁，请稍后再试",
        requestId: request.id,
      });
    }
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
    request.log.error(
      { error: operationalErrorDiagnostics(error), requestId: request.id },
      "unhandled request error",
    );
    return reply
      .status(500)
      .send({
        code: "INTERNAL_ERROR",
        message: "服务暂时不可用",
        requestId: request.id,
      });
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    const reconciliationStale =
      !lastReconciliationAt ||
      Date.now() - Date.parse(lastReconciliationAt) > 150_000;
    const probe = async (check: () => Promise<"ok" | "degraded">): Promise<"ok" | "degraded"> => {
      try {
        return await check();
      } catch (error) {
        app.log.warn({ error: operationalErrorText(error) }, "readiness dependency check failed");
        return "degraded";
      }
    };
    const dependencies: Record<string, "ok" | "degraded"> = {
      dataStore: await probe(() => store.health()),
      queue: await probe(() => scheduler.health()),
      loginProtection: await probe(() => loginRateLimiter.health()),
      reconciliation:
        lastReconciliationError || reconciliationStale ? "degraded" : "ok",
    };
    if (config.NODE_ENV === "production") {
      const managedSuperAdmin = await hasReadyAdminBootstrap(store);
      Object.assign(dependencies, {
        adminBootstrap: managedSuperAdmin ? "ok" : "degraded",
      });
      if (!managedSuperAdmin)
        return reply.status(503).send({
          status: "degraded",
          code: "ADMIN_BOOTSTRAP_REQUIRED",
          message: "尚未配置受管的 ACTIVE 超级管理员",
          dependencies,
        });
    }
    if (
      dependencies.dataStore !== "ok" ||
      dependencies.queue !== "ok" ||
      dependencies.loginProtection !== "ok" ||
      lastReconciliationError ||
      reconciliationStale
    )
      return reply.status(503).send({ status: "degraded", dependencies });
    return { status: "ok", dependencies };
  });

  registerProductImageRoutes(app, { productImages, profileImages, store });
  registerMerchandisingRoutes(app, {
    store,
    images: productImages,
  });
  registerProfileRoutes(app, {
    store,
    images: profileImages,
    authService,
  });
  registerAuthRoutes(app, {
    authService,
    adminAuthService,
    loginRateLimiter,
    privacyNoticeVersion: config.PRIVACY_NOTICE_VERSION,
  });
  registerPublicCatalogRoutes(app, {
    readSnapshot: work => store.readSnapshot(work),
    campaigns,
    listServiceAreas: () => store.listServiceAreas(),
    listPickupPoints: (id) => store.listPickupPoints(id),
    getDeliveryPlanByCampaign: (id) => store.getDeliveryPlanByCampaign(id),
    withCampaignItems: publicCampaignView,
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

  // Browser integration tests may prepare a persisted expiry fact, but the
  // product action itself is always performed through the operator/finance UI.
  // This route is intentionally absent from development and production apps.
  if (config.NODE_ENV === "test")
    app.post(
      "/__test/community/orders/:id/expire-pickup-window",
      async (request) => {
        requireActor(request, ["SUPER_ADMIN"]);
        const orderId = identifierSchema.parse(
          (request.params as { id: string }).id,
        );
        return {
          data: await store.transaction(async (transactionStore) => {
            const window =
              await transactionStore.getCommunityPickupWindowForUpdate(orderId);
            if (!window)
              throw new BusinessError("RESOURCE_NOT_FOUND", "领取窗口不存在", 404);
            if (!["ACTIVE", "EXTENDED"].includes(window.status))
              throw new BusinessError(
                "INVALID_STATE_TRANSITION",
                "当前领取窗口不能设为逾期待处理",
                409,
              );
            window.status = "EXPIRED_PENDING";
            window.deadlineAt = new Date(Date.now() - 1_000).toISOString();
            await transactionStore.saveCommunityPickupWindow(window);
            return window;
          }),
        };
      },
    );

  const geoSearch = createGeoSearch();
  const reverseLocationAdapter =
    dependencies.reverseLocationAdapter ??
    (config.NODE_ENV === "test"
      ? createDeterministicTestReverseLocationAdapter()
      : createAmapReverseLocationAdapter());
  app.get("/api/v1/admin/region-directory", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return {
      data: listRegionDirectory(
        regionDirectoryQuerySchema.parse(request.query).query,
      ),
    };
  });
  app.get("/api/v1/admin/geo/search", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return {
      data: await geoSearch.search(
        geoSearchQuerySchema.parse(request.query).query,
      ),
    };
  });
  app.get("/api/v1/admin/geo/reverse", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const input = geoReverseQuerySchema.parse(request.query);
    return {
      data: await geoSearch.reverse(input.latitude, input.longitude),
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
    const { value, created } = await store.transaction(
      async (transactionStore) => {
        const existing = (await transactionStore.listServiceAreas()).find(
          (v) => v.regionCode === entry.regionCode,
        );
        if (existing) {
          const value = { ...existing, orderEnabled: true };
          if (!existing.orderEnabled) {
            await transactionStore.updateServiceAreaOrderEnabled(existing.id, true);
            await auditInTransaction(
              transactionStore,
              request,
              actor.userId,
              "SERVICE_AREA_STATUS_UPDATED",
              "SERVICE_AREA",
              existing.id,
              existing,
              value,
            );
          }
          return { value, created: false };
        }
        const value = {
          id: randomUUID(),
          regionCode: entry.regionCode,
          name: entry.name,
          status: "ENABLED" as const,
          orderEnabled: true,
          createdAt: new Date().toISOString(),
        };
        await transactionStore.saveServiceArea(value);
        await auditInTransaction(
          transactionStore,
          request,
          actor.userId,
          "SERVICE_AREA_CREATED",
          "SERVICE_AREA",
          value.id,
          null,
          value,
        );
        return { value, created: true };
      },
    );
    return reply.status(created ? 201 : 200).send({ data: value });
  });
  app.post("/api/v1/admin/service-areas/:id/order-status", async (request) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const input = updateServiceAreaOrderStatusSchema.parse(request.body);
    const after = await store.transaction(async (transactionStore) => {
      const before = (await transactionStore.listServiceAreas()).find(
        (v) => v.id === id,
      );
      if (!before)
        throw new BusinessError("RESOURCE_NOT_FOUND", "服务区域不存在", 404);
      const after = { ...before, orderEnabled: input.orderEnabled };
      if (before.orderEnabled && !after.orderEnabled) {
        const [campaigns, orders] = await Promise.all([
          transactionStore.listCampaigns(),
          transactionStore.listOrders(Number.MAX_SAFE_INTEGER),
        ]);
        const activeCampaigns = campaigns.filter(
          (campaign) =>
            campaign.serviceAreaId === id &&
            ["OPEN", "CLOSING", "LOCKED", "FULFILLING", "POSTPONED"].includes(
              campaign.status,
            ),
        );
        const unfinishedOrders = orders.filter(
          (order) =>
            order.serviceAreaId === id &&
            !["CANCELLED", "REFUNDED", "COMPLETED"].includes(order.status),
        );
        if (activeCampaigns.length || unfinishedOrders.length)
          throw new BusinessError(
            "RESOURCE_IN_USE",
            "区域仍有进行中团期或未完成订单，不能暂停下单",
            409,
            {
              campaignCount: activeCampaigns.length,
              unfinishedOrderCount: unfinishedOrders.length,
            },
          );
      }
      if (before.orderEnabled !== after.orderEnabled)
        await transactionStore.updateServiceAreaOrderEnabled(
          id,
          input.orderEnabled,
        );
      await auditInTransaction(
        transactionStore,
        request,
        actor.userId,
        "SERVICE_AREA_STATUS_UPDATED",
        "SERVICE_AREA",
        id,
        before,
        after,
      );
      return after;
    });
    return { data: after };
  });
  app.get("/api/v1/admin/pickup-points", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return { data: await store.listPickupPoints() };
  });
  const buildPickupPoint = async (pointStore: CommerceStore, input: {
    serviceAreaId: string;
    name: string;
    address: string;
    businessHours: string;
    pickupInstructions: string;
    latitude: number;
    longitude: number;
    contactName: string;
    contactPhone: string;
    capacityPerDay: number | null;
  }) => {
    const serviceArea = (await pointStore.listServiceAreas()).find(
      (value) => value.id === input.serviceAreaId,
    );
    if (!serviceArea)
      throw new BusinessError("RESOURCE_NOT_FOUND", "服务区域不存在", 404);
    return {
      id: randomUUID(),
      ...input,
      status: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
    };
  };

  const locationCheck = async (
    pointStore: CommerceStore,
    candidate: PickupPoint,
    excludePickupPointId?: string,
  ) => {
    const serviceArea = (await pointStore.listServiceAreas()).find(
      (value) => value.id === candidate.serviceAreaId,
    );
    if (!serviceArea)
      throw new BusinessError("RESOURCE_NOT_FOUND", "服务区域不存在", 404);
    const existingPoints = await pointStore.listPickupPoints();
    const location = await validatePickupPointLocation({
      adapter: reverseLocationAdapter,
      serviceArea,
      candidate,
      existingPoints,
      ...(excludePickupPointId ? { excludePickupPointId } : {}),
      allowTestDirectoryFixture:
        config.NODE_ENV === "test" && !dependencies.reverseLocationAdapter,
      skipTestDuplicateReview:
        config.NODE_ENV === "test" && !dependencies.reverseLocationAdapter,
    });
    return { ...location, existingPoints };
  };

  // A byte-for-byte create replay is not an operator's request to establish a
  // second site. Treat it as idempotent so a client retry cannot create a
  // duplicate or block unrelated campaign setup. Any meaningful difference
  // still follows the explicit duplicate-review flow below.
  const exactCreateReplay = (
    candidate: PickupPoint,
    existingPoints: PickupPoint[],
  ) =>
    existingPoints.find(
      (point) =>
        point.serviceAreaId === candidate.serviceAreaId &&
        point.name === candidate.name &&
        normalizePickupAddress(point.address) ===
          normalizePickupAddress(candidate.address) &&
        point.latitude === candidate.latitude &&
        point.longitude === candidate.longitude &&
        point.businessHours === candidate.businessHours &&
        point.pickupInstructions === candidate.pickupInstructions &&
        point.contactName === candidate.contactName &&
        point.contactPhone === candidate.contactPhone &&
        point.capacityPerDay === candidate.capacityPerDay &&
        point.status === candidate.status,
    );

  const duplicateError = (candidates: unknown) =>
    new BusinessError(
      "POSSIBLE_DUPLICATE_PICKUP_LOCATION" as never,
      "所选服务区域内存在疑似重复自提点，请确认不是同一领取地点后再保存",
      409,
      { candidates },
    );

  app.post("/api/v1/admin/pickup-points", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const { confirmDuplicate, ...input } = createPickupPointSchema.parse(
      request.body,
    );
    const result = await store.transaction(async (transactionStore) => {
      const created = await buildPickupPoint(transactionStore, input);
      const location = await locationCheck(transactionStore, created);
      const replay = exactCreateReplay(created, location.existingPoints);
      if (replay) return { candidates: [], created: replay };
      if (location.duplicates.length && !confirmDuplicate)
        return { candidates: location.duplicates, created: null };
      await transactionStore.savePickupPoint(created);
      await auditInTransaction(
        transactionStore,
        request,
        actor.userId,
        "PICKUP_POINT_CREATED",
        "PICKUP_POINT",
        created.id,
        null,
        created,
      );
      if (location.duplicates.length)
        await auditInTransaction(
          transactionStore,
          request,
          actor.userId,
          "PICKUP_POINT_DUPLICATE_OVERRIDDEN",
          "PICKUP_POINT",
          created.id,
          { candidates: location.duplicates },
          { confirmDuplicate: true, point: created },
        );
      return { candidates: [], created };
    });
    if (!result.created) {
      await store.transaction((transactionStore) =>
        auditInTransaction(
          transactionStore,
          request,
          actor.userId,
          "PICKUP_POINT_DUPLICATE_DETECTED",
          "PICKUP_POINT",
          "create",
          null,
          { candidates: result.candidates, confirmDuplicate: false },
        ),
      );
      throw duplicateError(result.candidates);
    }
    return reply.status(201).send({ data: result.created });
  });
  app.patch("/api/v1/admin/pickup-points/:id", async (request) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const { confirmDuplicate, ...input } = updatePickupPointSchema.parse(
      request.body,
    );
    const result = await store.transaction(async (transactionStore) => {
      const before = (await transactionStore.listPickupPoints()).find(
        (point) => point.id === id,
      );
      if (!before)
        throw new BusinessError("RESOURCE_NOT_FOUND", "自提点不存在", 404);
      const requested = { ...before, ...input } as PickupPoint;
      const locationChanged = hasPickupLocationVerificationTrigger(
        before,
        requested,
      );
      // Non-trigger PATCH requests cannot smuggle through formatting-equivalent
      // coordinates or an address rewrite without a new verification.
      const after = locationChanged
        ? requested
        : {
            ...requested,
            address: before.address,
            latitude: before.latitude,
            longitude: before.longitude,
          };
      if (after.status === "ACTIVE") createPickupPointSchema.parse(after);
      if (before.status === "ACTIVE" && after.status === "INACTIVE") {
        const [campaigns, plans, staff, assignments, orders] = await Promise.all([
          transactionStore.listCampaigns(),
          transactionStore.listDeliveryPlans(),
          transactionStore.listInternalStaff(),
          transactionStore.listStaffPickupPointAssignments(),
          transactionStore.listOrders(Number.MAX_SAFE_INTEGER),
        ]);
        const campaignById = new Map(
          campaigns.map((campaign) => [campaign.id, campaign]),
        );
        const inProgressPlans = plans.filter((plan) => {
          if (plan.pickupPointId !== id) return false;
          const campaign = campaignById.get(plan.campaignId);
          return (
            ["SITE_CONFIRMED", "VEHICLE_BOOKED", "IN_TRANSIT"].includes(
              plan.status,
            ) ||
            ["OPEN", "LOCKED", "POSTPONED", "FULFILLING"].includes(
              campaign?.status ?? "",
            )
          );
        });
        const activeStaffIds = new Set(
          staff
            .filter(
              (member) =>
                member.role === "PICKUP_MANAGER" && member.status === "ACTIVE",
            )
            .map((member) => member.userId),
        );
        const hasActiveManager = assignments.some(
          (assignment) =>
            assignment.pickupPointId === id &&
            activeStaffIds.has(assignment.staffUserId),
        );
        const unfinishedOrders = orders.filter(
          (order) =>
            order.pickupPointId === id &&
            !["CANCELLED", "REFUNDED", "PICKED_UP", "COMPLETED"].includes(
              order.status,
            ),
        );
        if (inProgressPlans.length || hasActiveManager || unfinishedOrders.length)
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "存在未完成订单、进行中履约或有效点位负责人授权，不能停用自提点",
            409,
            {
              deliveryPlanCount: inProgressPlans.length,
              activeManagerCount: hasActiveManager ? 1 : 0,
              unfinishedOrderCount: unfinishedOrders.length,
            },
          );
      }
      const location = locationChanged
        ? await locationCheck(transactionStore, after, id)
        : null;
      if (location?.duplicates.length && !confirmDuplicate)
        return { before, after: null, candidates: location.duplicates };
      await transactionStore.savePickupPoint(after);
      await auditInTransaction(
        transactionStore,
        request,
        actor.userId,
        "PICKUP_POINT_UPDATED",
        "PICKUP_POINT",
        id,
        before,
        after,
      );
      if (location?.duplicates.length)
        await auditInTransaction(
          transactionStore,
          request,
          actor.userId,
          "PICKUP_POINT_DUPLICATE_OVERRIDDEN",
          "PICKUP_POINT",
          id,
          { candidates: location.duplicates },
          { confirmDuplicate: true, point: after },
        );
      return { before, after, candidates: [] };
    });
    if (!result.after) {
      await store.transaction((transactionStore) =>
        auditInTransaction(
          transactionStore,
          request,
          actor.userId,
          "PICKUP_POINT_DUPLICATE_DETECTED",
          "PICKUP_POINT",
          id,
          result.before,
          { candidates: result.candidates, confirmDuplicate: false },
        ),
      );
      throw duplicateError(result.candidates);
    }
    return { data: result.after };
  });
  app.post("/api/v1/admin/pickup-points/batch", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const input = batchCreatePickupPointsSchema.parse(request.body);
    const created = await store.transaction(async (transactionStore) => {
      const areas = await transactionStore.listServiceAreas();
      const values = [];
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
        const value = await buildPickupPoint(transactionStore, {
          serviceAreaId: area.id,
          name: point.name,
          address: point.address,
          businessHours: point.businessHours,
          pickupInstructions: point.pickupInstructions,
          latitude: point.latitude,
          longitude: point.longitude,
          contactName: point.contactName,
          contactPhone: point.contactPhone,
          capacityPerDay: point.capacityPerDay,
        });
        const location = await locationCheck(transactionStore, value);
        if (location.duplicates.length) throw duplicateError(location.duplicates);
        await transactionStore.savePickupPoint(value);
        values.push(value);
      }
      await auditInTransaction(
        transactionStore,
        request,
        actor.userId,
        "PICKUP_POINTS_CREATED",
        "PICKUP_POINT",
        "batch",
        null,
        values,
      );
      return values;
    });
    return reply
      .status(201)
      .send({ data: { created: created.length, points: created } });
  });

  app.get("/api/v1/admin/catalog/skus", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return { data: await store.listCatalogSkus() };
  });
  app.get("/api/v1/admin/catalog/categories", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const query = request.query as { includeInactive?: string };
    return {
      data: await store.listProductCategories(query.includeInactive === "true"),
    };
  });
  app.post("/api/v1/admin/catalog/categories", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const input = productCategorySchema.parse(request.body);
    const value = await store.transaction(async (transactionStore) => {
      const existing = await transactionStore.listProductCategories(true);
      if (existing.some((item) => item.name === input.name && item.id !== input.id))
        throw new BusinessError("RESOURCE_IN_USE", "分类名称已存在", 409);
      const now = new Date().toISOString();
      const category: ProductCategory = {
        id: input.id ?? randomUUID(),
        name: input.name,
        sortOrder: input.sortOrder,
        status: input.status,
        createdAt: existing.find((item) => item.id === input.id)?.createdAt ?? now,
        updatedAt: now,
      };
      await transactionStore.saveProductCategory(category);
      await auditInTransaction(
        transactionStore,
        request,
        actor.userId,
        "PRODUCT_CATEGORY_SAVED",
        "PRODUCT_CATEGORY",
        category.id,
        existing.find((item) => item.id === category.id) ?? null,
        category,
      );
      return category;
    });
    return reply.status(input.id ? 200 : 201).send({ data: value });
  });
  app.delete("/api/v1/admin/catalog/categories/:id", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const { id } = request.params as { id: string };
    const category = await store.getProductCategory(id);
    if (!category)
      throw new BusinessError("RESOURCE_NOT_FOUND", "分类不存在", 404);
    const deleted = await store.transaction(async (transactionStore) => {
      const ok = await transactionStore.deleteProductCategory(id);
      if (!ok)
        throw new BusinessError(
          "RESOURCE_IN_USE",
          "分类仍被商品引用，只能停用，不能删除",
          409,
        );
      await auditInTransaction(
        transactionStore,
        request,
        actor.userId,
        "PRODUCT_CATEGORY_DELETED",
        "PRODUCT_CATEGORY",
        id,
        category,
        null,
      );
      return ok;
    });
    return reply.send({ data: { deleted } });
  });
  app.post("/api/v1/admin/catalog/skus", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const input = catalogSkuSchema.parse(request.body);
    await productImages.validateReference(input.imageUrl);
    const { existing, value } = await store.transaction(
      async (transactionStore) => {
        const existing = input.id
          ? await transactionStore.getCatalogSku(input.id)
          : null;
        const now = new Date().toISOString();
        const value: CatalogSku = {
          id: input.id ?? randomUUID(),
          productId: input.productId ?? randomUUID(),
          categoryId:
            input.categoryId === undefined
              ? existing?.categoryId ?? null
              : input.categoryId,
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
        if (input.categoryId) {
          const category = await transactionStore.getProductCategory(input.categoryId);
          if (!category || category.status !== "ACTIVE")
            throw new BusinessError(
              "VALIDATION_ERROR",
              "请选择有效的启用分类",
              409,
            );
          value.categoryId = category.id;
          value.product.category = category.name;
        } else if (input.categoryId === undefined && existing?.categoryId) {
          const category = await transactionStore.getProductCategory(existing.categoryId);
          if (category) value.product.category = category.name;
        }
        value.productId = value.product.id;
        if (existing?.status === "ACTIVE" && value.status === "INACTIVE") {
          const [campaigns, orders] = await Promise.all([
            transactionStore.listCampaigns(),
            transactionStore.listOrders(Number.MAX_SAFE_INTEGER),
          ]);
          const activeCampaigns = campaigns.filter(
            (campaign) =>
              ["OPEN", "CLOSING", "LOCKED", "FULFILLING", "POSTPONED"].includes(
                campaign.status,
              ) && campaign.items.some((item) => item.catalogSkuId === value.id),
          );
          const unfinishedOrders = orders.filter(
            (order) =>
              !["CANCELLED", "REFUNDED", "COMPLETED"].includes(order.status) &&
              order.items.some((item) => item.skuId === value.id),
          );
          if (activeCampaigns.length || unfinishedOrders.length)
            throw new BusinessError(
              "RESOURCE_IN_USE",
              "商品仍有进行中团期或未完成订单，不能停用",
              409,
              {
                campaignCount: activeCampaigns.length,
                unfinishedOrderCount: unfinishedOrders.length,
              },
            );
        }
        await transactionStore.saveCatalogSku(value);
        await auditInTransaction(
          transactionStore,
          request,
          actor.userId,
          "CATALOG_SKU_SAVED",
          "CATALOG_SKU",
          value.id,
          existing,
          value,
        );
        return { existing, value };
      },
    );
    return reply.status(existing ? 200 : 201).send({ data: value });
  });
  const consumerSummary = async (user: NonNullable<Awaited<ReturnType<CommerceStore["getUser"]>>>) => ({
    id: user.id,
    maskedPhone: user.phoneNumber ? maskPhone(user.phoneNumber) : null,
    status: user.status,
    createdAt: user.createdAt,
    phoneVerified: Boolean(user.phoneVerifiedAt),
    orderCount: (await store.listOrdersByUser(user.id)).length,
  });
  app.get("/api/v1/admin/consumers", async (request) => {
    requireActor(request, ["SUPER_ADMIN", "CUSTOMER_SERVICE"]);
    const query = z.object({query:z.string().trim().max(80).default(""),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).parse(request.query);
    const needle = query.query.toLowerCase();
    const users = (await store.listConsumerUsers()).filter(user => !needle || user.id.toLowerCase().includes(needle) || (user.phoneNumber ?? "").includes(needle)).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return {data:{items:await Promise.all(users.slice((query.page-1)*query.pageSize,query.page*query.pageSize).map(consumerSummary)),total:users.length,page:query.page,pageSize:query.pageSize}};
  });
  app.get("/api/v1/admin/consumers/:id", async (request) => {
    requireActor(request, ["SUPER_ADMIN", "CUSTOMER_SERVICE"]);
    const id = identifierSchema.parse((request.params as {id:string}).id);
    const user = (await store.listConsumerUsers()).find(value => value.id === id);
    if (!user) throw new BusinessError("RESOURCE_NOT_FOUND", "消费者不存在", 404);
    const orders = (await store.listOrdersByUser(id)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,50).map(order => ({id:order.id,status:order.status,totalAmountCents:order.totalCents,createdAt:order.createdAt}));
    return {data:{...await consumerSummary(user),orders}};
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
  app.patch("/api/v1/admin/campaigns/:id", async (request) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const version = z.object({ version: z.int().min(1) }).parse(request.body).version;
    const value = await communityFulfillment.createCampaign(communityCampaignSchema.parse(request.body), actor.userId, request.id, { id, version });
    return { data: await campaignView(value) };
  });
  app.delete("/api/v1/admin/campaigns/:id", async (request) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const version = z.object({ version: z.int().min(1) }).parse(request.body).version;
    return { data: await communityFulfillment.deleteCampaign(id, version, actor.userId, request.id) };
  });
  for (const [suffix] of [
    ["open", "open"],
    ["close", "close"],
    ["cancel", "cancel"],
  ] as const)
    app.post(`/api/v1/admin/campaigns/:id/${suffix}`, async (request) => {
      const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const reason =
        suffix === "cancel"
          ? campaignCancelSchema.parse(request.body).reason
          : (campaignCloseSchema.parse(request.body ?? {}).reason ?? null);
      const context = {
        actorId: actor.userId,
        requestId: request.id,
        reason,
      };
      const beforeForOpen = suffix === "open" ? await campaigns.get(id) : null;
      const after =
        suffix === "cancel"
          ? await campaigns.cancel(id, context)
          : suffix === "close"
            ? await campaigns.close(id, false, undefined, context)
            : await campaigns.open(id);
      if (suffix === "open") {
        await audit(
          request,
          actor.userId,
          "CAMPAIGN_OPEN",
          "CAMPAIGN",
          id,
          beforeForOpen,
          after,
        );
      }
      return { data: after };
    });
  app.get("/api/v1/admin/campaigns/:id/cancel-impact", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    return { data: await campaigns.cancelImpact(id) };
  });
  app.post("/api/v1/admin/campaigns/:id/postpone", async (request) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const after = await campaigns.postpone(
      id,
      postponeCampaignSchema.parse(request.body),
      { actorId: actor.userId, requestId: request.id },
    );
    return { data: after };
  });
  app.get("/api/v1/admin/campaigns/:id/packing-labels", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const campaign = await campaigns.get(id);
    if (!['LOCKED', 'FULFILLING', 'COMPLETED'].includes(campaign.status))
      throw new BusinessError(
        "INVALID_STATE_TRANSITION",
        "团期截单后才可以生成装袋标签",
        409,
      );
    const plan = await store.getDeliveryPlanByCampaign(campaign.id);
    const pickupPoint = plan
      ? (await store.listPickupPoints(campaign.serviceAreaId)).find(
          (point) => point.id === plan.pickupPointId,
        )
      : null;
    const values = (await store.listOrdersByCampaign(id))
      .filter(
        (v) =>
          v.paidAt &&
          [
            "LOCKED",
            "ALLOCATING",
            "IN_TRANSIT",
            "READY_FOR_PICKUP",
            "PICKED_UP",
            "COMPLETED",
          ].includes(v.status),
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
        pickupPointName: pickupPoint?.name ?? null,
        items: [...v.items]
          .sort(
            (left, right) =>
              left.name.localeCompare(right.name, "zh-CN") ||
              left.skuId.localeCompare(right.skuId),
          )
          .map((item) => ({
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
    const after = await store.transaction(async (transactionStore) => {
      const before = await transactionStore.getDeliveryPlan(id);
      const value = await deliveryPlans.bookVehicle(
        id,
        bookVehicleSchema.parse(request.body),
        transactionStore,
      );
      await auditInTransaction(
        transactionStore,
        request,
        actor.userId,
        "DELIVERY_VEHICLE_BOOKED",
        "DELIVERY_PLAN",
        id,
        before,
        value,
      );
      return value;
    });
    return { data: after };
  });
  app.post(
    "/api/v1/admin/delivery-plans/:id/emergency-correction",
    async (request) => {
      const actor = requireActor(request, ["SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const input = emergencyVehicleCorrectionSchema.parse(request.body);
      const after = await store.transaction(async (transactionStore) => {
        const before = await transactionStore.getDeliveryPlan(id);
        const value = await deliveryPlans.correctVehicleAfterDispatch(
          id,
          input,
          transactionStore,
        );
        await auditInTransaction(
          transactionStore,
          request,
          actor.userId,
          "DELIVERY_VEHICLE_EMERGENCY_CORRECTED",
          "DELIVERY_PLAN",
          id,
          before,
          { ...value, emergencyReason: input.reason },
        );
        return value;
      });
      return { data: after };
    },
  );
  app.get("/api/v1/pickup/delivery-plans", async (request) => {
    const actor = requireActor(request, ["PICKUP_MANAGER"]);
    const values = [];
    for (const plan of await store.listDeliveryPlans())
      if (
        plan.status === "ARRIVED" &&
        (await store.hasActivePickupPointAssignment(
          actor.userId,
          plan.pickupPointId,
        ))
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
      actor,
      request.id,
    );
    return reply
      .status(201)
      .send({
        data: {
          staff: staffView(value.staff),
          temporaryPassword: value.temporaryPassword,
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
          actor,
          request.id,
        ),
      ),
    };
  });
  app.post("/api/v1/admin/staff/:id/reset-password", async (request) => {
    const actor = requireActor(request, ["SUPER_ADMIN"]);
    const { reason } = resetInternalStaffCredentialSchema.parse(request.body);
    const value = await staffService.resetCredential(
      identifierSchema.parse((request.params as { id: string }).id),
      reason,
      actor,
      request.id,
    );
    return {
      data: {
        staff: staffView(value.staff),
        temporaryPassword: value.temporaryPassword,
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
    const actor = requireActor(request, [
      "CUSTOMER_SERVICE",
      "OPERATOR",
      "FINANCE",
      "SUPER_ADMIN",
    ]);
    const visibleStatuses = actor.roles.includes("SUPER_ADMIN")
      ? undefined
      : actor.roles.includes("CUSTOMER_SERVICE")
        ? ["REGISTERED", "ACCEPTED", "REJECTED"]
        : actor.roles.includes("OPERATOR")
          ? ["ACCEPTED", "REFUNDING", "REJECTED", "RESOLVED"]
          : ["REFUNDING", "RESOLVED"];
    const page = await store.listOperationsQueue("quality", {
      ...operationsPageSchema.parse(request.query),
      ...(visibleStatuses ? {allowedStatuses: visibleStatuses} : {}),
    });
    const [orders, refunds] = await Promise.all([
      Promise.all([...new Set(page.items.map(value => value.orderId))].map(id => store.getOrder(id))),
      Promise.all(page.items.filter(value => value.refundExceptionId).map(value => store.listPartialRefundsByException(value.refundExceptionId!))),
    ]);
    const orderById = new Map(orders.filter(value => value !== null).map(order => [order.id, order]));
    const partialRefundByException = new Map(refunds.flat().map(value => [value.exceptionId, value]));
    return {
      pagination: {total: page.total, page: page.page, pageSize: page.pageSize},
      data: page.items.map((value) => {
          const order = orderById.get(value.orderId);
          const orderItemById = new Map(
            order?.items
              .filter((item): item is typeof item & { orderLineId: string } =>
                Boolean(item.orderLineId),
              )
              .map((item) => [item.orderLineId, item]) ?? [],
          );
          return {
            id: value.id,
            orderId: value.orderId,
            orderNo: order?.orderNo ?? null,
            status: value.status,
            registeredAt: value.registeredAt,
            acceptedBy: value.acceptedBy,
            acceptedAt: value.acceptedAt,
            acceptanceNote: value.acceptanceNote,
            decisionBy: value.decisionBy,
            decidedAt: value.decidedAt,
            decisionNote: value.decisionNote,
            refundApprovedBy: value.refundApprovedBy,
            refundApprovedAt: value.refundApprovedAt,
            financeExecutedBy: value.financeExecutedBy,
            financeExecutedAt: value.financeExecutedAt,
            refundExceptionId: value.refundExceptionId,
            financeRefundStatus: value.refundExceptionId
              ? (partialRefundByException.get(value.refundExceptionId)?.status ??
                null)
              : null,
            items: value.items.map((item) => ({
              catalogSkuId: item.catalogSkuId,
              name:
                orderItemById.get(item.orderLineId)?.name ?? item.catalogSkuId,
              quantity: item.disputedQuantity,
              reason: item.reason,
              description: item.description,
            })),
          };
        }),
    };
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
    if (!value?.refundExceptionId || value.status === "REJECTED")
      throw new BusinessError(
        "INVALID_STATE_TRANSITION",
        "品质售后尚未批准退款",
        409,
      );
    if (value.status === "RESOLVED") return { data: value };
    if (value.status !== "REFUNDING")
      throw new BusinessError(
        "INVALID_STATE_TRANSITION",
        "只有运营已批准的品质售后可以由财务执行退款",
        409,
      );
    await payments.executePartialRefund(value.refundExceptionId, {
      actorId: actor.userId,
      requestId: request.id,
      confirmationNote: "品质售后退款",
    });
    const executed = await communityQuality.markFinanceExecuted(
      id,
      actor.userId,
      request.id,
    );
    const financeRefundStatus = (
      await store.listPartialRefundsByException(value.refundExceptionId)
    )[0]?.status ?? null;
    return {
      data: { ...executed, financeRefundStatus },
    };
  });
  app.get("/api/v1/admin/fulfillment-exceptions", async (request) => {
    requireActor(request, [
      "OPERATOR",
      "FINANCE",
      "CUSTOMER_SERVICE",
      "SUPER_ADMIN",
    ]);
    const page = await store.listOperationsQueue("exceptions", operationsPageSchema.parse(request.query));
    return {
      pagination: {total: page.total, page: page.page, pageSize: page.pageSize},
      data: await Promise.all(page.items.map(value => exceptionReadModel(store, value))),
    };
  });
  app.post(
    "/api/v1/admin/fulfillment-exceptions/:id/refund",
    async (request) => {
      const actor = requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const input = partialRefundExecutionSchema.parse(request.body);
      const exception = await store.getFulfillmentException(id);
      if (exception) {
        const facts = await exceptionReadModel(store, exception);
        if (facts.financialFactsError) throw new BusinessError("FINANCIAL_INCONSISTENT", facts.financialFactsError, 409);
      }
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
      statusNote: null,
      statusChangedBy: null,
      statusChangedAt: null,
      createdAt: new Date().toISOString(),
    };
    await store.saveServiceAreaInterest(value);
    return reply.status(201).send({ data: value });
  });
  app.get("/api/v1/service-area-interests", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    return {
      data: (await store.listServiceAreaInterestsByUser(actor.userId)).map(
        (value) => ({
          id: value.id,
          regionText: value.regionText,
          contactName: value.contactName,
          maskedContactPhone: maskPhone(value.contactPhone),
          status: value.status,
          statusNote: value.statusNote,
          statusChangedAt: value.statusChangedAt,
          createdAt: value.createdAt,
        }),
      ),
    };
  });
  app.post(
    "/api/v1/service-area-interests/:id/correct",
    async (request) => {
      const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const input = updateOwnServiceAreaInterestSchema.parse(request.body);
      if (input.privacyVersion !== config.PRIVACY_NOTICE_VERSION)
        throw new BusinessError("VALIDATION_ERROR", "隐私说明已更新", 400);
      return {
        data: await store.transaction(async (transactionStore) => {
          const value = await transactionStore.getServiceAreaInterest(id);
          if (!value || value.userId !== actor.userId)
            throw new BusinessError("RESOURCE_NOT_FOUND", "区域意向不存在", 404);
          if (value.status !== "NEW")
            throw new BusinessError(
              "INVALID_STATE_TRANSITION",
              "只有尚未处理的开通意向可以直接更正；已处理意向请联系客服",
              409,
            );
          const before = structuredClone(value);
          Object.assign(value, {
            regionText: input.regionText,
            contactName: input.contactName,
            contactPhone: input.contactPhone,
            privacyVersion: input.privacyVersion,
            privacyConsentedAt: await transactionStore.databaseNow(),
          });
          await transactionStore.saveServiceAreaInterest(value);
          await transactionStore.saveAuditLog({
            id: randomUUID(),
            actorId: actor.userId,
            action: "SERVICE_AREA_INTEREST_CORRECTED_BY_USER",
            resourceType: "SERVICE_AREA_INTEREST",
            resourceId: id,
            requestId: request.id,
            beforeData: before,
            afterData: value,
            createdAt: value.privacyConsentedAt!,
          });
          return {
            id: value.id,
            regionText: value.regionText,
            contactName: value.contactName,
            maskedContactPhone: maskPhone(value.contactPhone),
            status: value.status,
            createdAt: value.createdAt,
          };
        }),
      };
    },
  );
  app.post(
    "/api/v1/service-area-interests/:id/withdraw",
    async (request) => {
      const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      return {
        data: await store.transaction(async (transactionStore) => {
          const value = await transactionStore.getServiceAreaInterest(id);
          if (!value || value.userId !== actor.userId)
            throw new BusinessError("RESOURCE_NOT_FOUND", "区域意向不存在", 404);
          if (value.status === "CLOSED") return { id, status: "CLOSED" as const };
          const before = structuredClone(value);
          const now = await transactionStore.databaseNow();
          value.status = "CLOSED";
          value.statusNote = "用户主动撤回开通意向";
          value.statusChangedBy = actor.userId;
          value.statusChangedAt = now;
          await transactionStore.saveServiceAreaInterest(value);
          await transactionStore.saveAuditLog({
            id: randomUUID(),
            actorId: actor.userId,
            action: "SERVICE_AREA_INTEREST_WITHDRAWN_BY_USER",
            resourceType: "SERVICE_AREA_INTEREST",
            resourceId: id,
            requestId: request.id,
            beforeData: before,
            afterData: value,
            createdAt: now,
          });
          return { id, status: value.status };
        }),
      };
    },
  );
  app.get("/api/v1/admin/service-area-interests", async (request) => {
    requireActor(request, ["CUSTOMER_SERVICE", "OPERATOR", "SUPER_ADMIN"]);
    return {
      data: (await store.listServiceAreaInterests(500))
        .filter(
          (value) =>
            Boolean(value.privacyVersion) && Boolean(value.privacyConsentedAt),
        )
        .map((value) => ({
          id: value.id,
          contactName: value.contactName,
          maskedContactPhone: maskPhone(value.contactPhone),
          regionText: value.regionText,
          privacyConsentedAt: value.privacyConsentedAt!,
          createdAt: value.createdAt,
          status: value.status,
          statusNote: value.statusNote ?? null,
          statusChangedAt: value.statusChangedAt ?? null,
        })),
    };
  });
  app.post(
    "/api/v1/admin/service-area-interests/:id/status",
    async (request) => {
      const actor = requireActor(request, [
        "CUSTOMER_SERVICE",
        "OPERATOR",
        "SUPER_ADMIN",
      ]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const input = updateServiceAreaInterestStatusSchema.parse(request.body);
      const value = await store.transaction(async (transactionStore) => {
        const current = await transactionStore.getServiceAreaInterest(id);
        if (!current)
          throw new BusinessError("RESOURCE_NOT_FOUND", "区域意向不存在", 404);
        if (!current.privacyVersion || !current.privacyConsentedAt)
          throw new BusinessError(
            "FORBIDDEN",
            "未经隐私同意的区域意向不能进入运营队列",
            403,
          );
        if (current.status === input.status) return current;
        const allowed =
          (current.status === "NEW" && input.status === "CONTACTED") ||
          (current.status === "CONTACTED" && input.status === "CLOSED");
        if (!allowed)
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "区域开通意向只能按 NEW→CONTACTED→CLOSED 顺序处理",
            409,
          );
        const now = await transactionStore.databaseNow();
        const before = structuredClone(current);
        current.status = input.status;
        current.statusNote = input.note;
        current.statusChangedBy = actor.userId;
        current.statusChangedAt = now;
        await transactionStore.saveServiceAreaInterest(current);
        await transactionStore.saveAuditLog({
          id: randomUUID(),
          actorId: actor.userId,
          action: "SERVICE_AREA_INTEREST_STATUS_UPDATED",
          resourceType: "SERVICE_AREA_INTEREST",
          resourceId: current.id,
          requestId: request.id,
          beforeData: before,
          afterData: current,
          createdAt: now,
        });
        return current;
      });
      return {
        data: {
          id: value.id,
          contactName: value.contactName,
          maskedContactPhone: maskPhone(value.contactPhone),
          regionText: value.regionText,
          privacyConsentedAt: value.privacyConsentedAt,
          createdAt: value.createdAt,
          status: value.status,
          statusNote: value.statusNote ?? null,
          statusChangedAt: value.statusChangedAt ?? null,
        },
      };
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
    const requested = notificationPreferenceSchema.parse(request.body);
    const templateIds: Partial<Record<OrderNotificationType, string>> = {};
    const types = requested.types.filter((type) => {
      const expected = subscription.templateIdFor?.(type);
      if (!subscription.templateIdFor) return true;
      if (!expected || requested.templateIds?.[type] !== expected)
        throw new BusinessError('VALIDATION_ERROR', '订阅模板与当前服务不一致，请更新小程序后重新订阅', 409);
      templateIds[type] = expected;
      return true;
    });
    const value = { userId: actor.userId, types, templateIds, updatedAt: new Date().toISOString() };
    await store.saveNotificationPreference(value);
    return { data: value };
  });
  app.get("/api/v1/notifications/preferences", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const value = await store.getNotificationPreference(actor.userId);
    const types = value?.types.filter((type) => !subscription.templateIdFor ||
      !!subscription.templateIdFor(type) && value.templateIds?.[type] === subscription.templateIdFor(type)) ?? [];
    return { data: { userId: actor.userId, types, templateIds: value?.templateIds ?? {}, updatedAt: value?.updatedAt ?? null } };
  });
  app.get("/api/v1/admin/notifications/manual", async (request) => {
    requireActor(request, ["CUSTOMER_SERVICE", "SUPER_ADMIN"]);
    const page = await store.listOperationsQueue("notifications", operationsPageSchema.parse(request.query));
    const orders = await Promise.all([...new Set(page.items.map(value => value.orderId))].map(id => store.getOrder(id)));
    const orderById = new Map(orders.filter(value => value !== null).map(order => [order.id, order]));
    return {
      pagination: {total: page.total, page: page.page, pageSize: page.pageSize},
      data: page.items.map((value) => ({
        id: value.id,
        orderId: value.orderId,
        orderNo: orderById.get(value.orderId)?.orderNo ?? null,
        userDisplay: `用户 ${value.userId.slice(0, 3)}***`,
        type: value.type,
        title: value.title,
        status: value.status,
        createdAt: value.createdAt,
        deliveryAttempts: value.deliveryAttempts,
        lastDeliveryError: value.lastDeliveryError,
        lastActivityAt:
          value.manualCompletedAt ??
          value.deliveredAt ??
          value.providerResultRecordedAt ??
          value.providerSubmissionStartedAt ??
          value.nextAttemptAt ??
          value.createdAt,
        manualCompletedAt: value.manualCompletedAt,
        manualCompletedBy: value.manualCompletedBy ?? null,
        manualCompletionNote: value.manualCompletionNote ?? null,
        manualCompletionChannel: value.manualCompletionChannel ?? null,
        manualCompletionExternalReference:
          value.manualCompletionExternalReference ?? null,
        manualCompletionResult: value.manualCompletionResult ?? null,
        providerSubmissionStartedAt: value.providerSubmissionStartedAt,
        providerResultRecordedAt: value.providerResultRecordedAt,
        submissionUnknownReason: value.submissionUnknownReason,
      })),
    };
  });
  app.post("/api/v1/admin/notifications/:id/retry", async (request) => {
    requireActor(request, ["CUSTOMER_SERVICE", "SUPER_ADMIN"]);
    return {
      data: await notifications.retryPending(
        identifierSchema.parse((request.params as { id: string }).id),
      ),
    };
  });
  app.post(
    "/api/v1/admin/notifications/:id/manual-complete",
    async (request, reply) => {
      const actor = requireActor(request, [
        "CUSTOMER_SERVICE",
        "SUPER_ADMIN",
      ]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const completion = notificationManualCompletionSchema.parse(request.body);
      const value = await store.transaction(async (transactionStore) => {
        const before = await transactionStore.getOrderNotification(id);
        if (!before)
          throw new BusinessError("RESOURCE_NOT_FOUND", "通知不存在", 404);
        const after = await transactionStore.markOrderNotificationManualCompleted(
          id,
          actor.userId,
          completion.note,
          await transactionStore.databaseNow(),
          {
            channel: completion.channel,
            externalReference: completion.externalReference,
            result: completion.result,
          },
        );
        if (!after)
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "当前通知不能标记为人工完成",
            409,
          );
        if (before.status !== "MANUAL_COMPLETED")
          await transactionStore.saveAuditLog({
            id: randomUUID(),
            actorId: actor.userId,
            action: "ORDER_NOTIFICATION_MANUAL_COMPLETED",
            resourceType: "ORDER_NOTIFICATION",
            resourceId: id,
            requestId: request.id,
            beforeData: before,
            afterData: after,
            createdAt: after.manualCompletedAt!,
          });
        return after;
      });
      return reply.send({ data: value });
    },
  );
  app.get("/api/v1/admin/audit-logs", async (request) => {
    requireActor(request, ["SUPER_ADMIN"]);
    return {
      data: (await store.listAuditLogs(500)).map((entry) => ({
        ...entry,
        beforeData: redactAuditData(entry.beforeData),
        afterData: redactAuditData(entry.afterData),
      })),
    };
  });

  const reconcile = async () => {
    if (reconciliationRunning) return;
    reconciliationRunning = true;
    try {
      const acquired = await scheduler.runReconciliation(async (assertOwned) => {
        await assertOwned();
        await scheduler.reconcile(await store.listCampaigns());
        await assertOwned();
        await orders.expirePendingOrders();
        await assertOwned();
        await communityOperations.reconcilePickupDeadlines();
        await assertOwned();
        const refunds = await payments.reconcileRefunds();
        if (refunds.failed > 0)
          app.log.error(refunds, "refund reconciliation completed with recoverable failures");
        await assertOwned();
        await communityOperations.reconcileExpiredPickupRefunds();
        await assertOwned();
        await communityOperations.reconcileCancellationRefunds();
        await assertOwned();
        await notifications.drainPending();
      });
      if (acquired) {
        lastReconciliationAt = new Date().toISOString();
        lastReconciliationError = null;
      }
    } catch (error) {
      lastReconciliationError = operationalErrorText(error);
      app.log.error(
        { error: operationalErrorDiagnostics(error) },
        "background reconciliation failed",
      );
    } finally {
      reconciliationRunning = false;
    }
  };
  app.get("/health/reconciliation", async () => ({
    status:
      lastReconciliationError ||
      !lastReconciliationAt ||
      Date.now() - Date.parse(lastReconciliationAt) > 150_000
        ? "degraded"
        : "ok",
    running: reconciliationRunning,
    lastCompletedAt: lastReconciliationAt,
    hasError: Boolean(lastReconciliationError),
  }));
  await reconcile();
  const timer = setInterval(() => {
    void reconcile();
  }, 30_000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await scheduler.close();
    await loginRateLimiter.close();
    await store.close();
  });
  return app;
}
