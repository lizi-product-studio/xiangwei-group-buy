import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  cancelOrderSchema,
  identifierSchema,
  multiOrderCheckoutSchema,
  adminOrderSearchQuerySchema,
  orderRequestSchema,
} from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import { requireActor } from "../modules/auth/auth.js";
import type { CommerceStore } from "../modules/core/store.js";
import type { Order } from "../modules/core/types.js";
import type { CommunityOperationsService } from "../modules/fulfillment/community-operations-service.js";
import { buildOrderDeliveryViews } from "../modules/orders/order-read-model.js";
import type { OrderService } from "../modules/orders/order-service.js";
import type { PaymentService } from "../modules/payments/payment-service.js";
import { ensureConsumerPublicNumbers } from "../modules/customers/consumer-directory-service.js";
import { z } from "zod";

const consumerOrderPageQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  cursorAt: z.iso.datetime({ offset: true }).optional(),
  cursorId: identifierSchema.optional(),
  filter: z.enum(["ALL", "PENDING", "ACTIVE", "DONE", "READY", "AFTER"]).default("ALL"),
}).superRefine((value, context) => {
  if (Boolean(value.cursorAt) !== Boolean(value.cursorId))
    context.addIssue({ code: "custom", path: [value.cursorAt ? "cursorId" : "cursorAt"], message: "订单分页游标不完整" });
});

type Audit = (
  request: FastifyRequest,
  actorId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  beforeData: unknown,
  afterData: unknown,
) => Promise<void>;

export function registerOrderRoutes(
  app: FastifyInstance,
  dependencies: {
    store: CommerceStore;
    orders: OrderService;
    payments: PaymentService;
    communityOperations: CommunityOperationsService;
    audit: Audit;
    rejectCommunityExternalEvidence(
      request: FastifyRequest,
      actorId: string,
      resourceType: string,
      resourceId: string,
      body: unknown,
    ): Promise<void>;
  },
): void {
  const {
    store,
    orders,
    payments,
    communityOperations,
    audit,
    rejectCommunityExternalEvidence,
  } = dependencies;
  const views = async (values: Order[]) => {
    const rows = await buildOrderDeliveryViews(store, values);
    return Promise.all(rows.map(async (row) => {
      const batch = await store.getCheckoutBatchByOrder(row.id);
      return batch ? {
        ...row,
        checkoutBatch: { id: batch.id, totalCents: batch.totalCents, orderCount: batch.orderIds.length, status: batch.status, expiresAt: batch.expiresAt },
      } : row;
    }));
  };
  const adminViews = async (values: Order[]) => {
    await ensureConsumerPublicNumbers(store);
    const [rows, campaigns, points, users] = await Promise.all([
      views(values),
      store.listCampaigns(),
      store.listPickupPoints(),
      store.getUsersByIds([...new Set(values.map((value) => value.userId))]),
    ]);
    const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
    const pointById = new Map(points.map((point) => [point.id, point]));
    const userById = new Map(users.map((user) => [user.id, user]));
    return rows.map((row) => {
      const campaign = campaignById.get(row.campaignId);
      const point = pointById.get(row.pickupPointId);
      const user = userById.get(row.userId);
      return {
        ...row,
        consumerNumber: user?.consumerNumber ?? null,
        maskedPhone: user?.phoneNumber ? `${user.phoneNumber.slice(0, 3)}****${user.phoneNumber.slice(-4)}` : null,
        customerName: user?.displayName ?? null,
        campaignTitle: campaign?.title ?? null,
        pickupPointName: point?.name ?? row.deliveryPlan?.siteName ?? null,
        items: row.items.map((item) => {
          const snapshot = campaign?.items.find(
            (campaignItem) => campaignItem.catalogSkuId === item.skuId,
          );
          return {
            ...item,
            productTitle: snapshot?.title ?? null,
            skuName: snapshot?.skuName ?? item.name,
          };
        }),
      };
    });
  };

  app.post("/api/v1/orders/preview", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    return {
      data: await orders.preview(
        actor.userId,
        orderRequestSchema.parse(request.body),
      ),
    };
  });

  app.post("/api/v1/orders", async (request, reply) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128) {
      throw new BusinessError(
        "VALIDATION_ERROR",
        "Idempotency-Key 长度必须为 8 到 128 个字符",
      );
    }
    const order = await orders.create(
      actor.userId,
      orderRequestSchema.parse(request.body),
      key,
    );
    return reply.status(201).send({ data: order });
  });

  app.post("/api/v1/order-checkouts", async (request, reply) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128)
      throw new BusinessError("VALIDATION_ERROR", "Idempotency-Key 长度必须为 8 到 128 个字符");
    const input = multiOrderCheckoutSchema.parse(request.body);
    const checkout = await orders.createBatch(actor.userId, input, key);
    return reply.status(201).send({ data: checkout });
  });

  app.get("/api/v1/order-checkouts/:id", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    return store.readSnapshot(async (snapshot) => {
      const checkoutBatch = await snapshot.getCheckoutBatch(id);
      // Do not reveal whether another customer's batch exists.
      if (!checkoutBatch || checkoutBatch.userId !== actor.userId)
        throw new BusinessError("RESOURCE_NOT_FOUND", "结算批次不存在", 404);

      const childOrders = await Promise.all(
        checkoutBatch.orderIds.map((orderId) => snapshot.getOrder(orderId)),
      );
      if (childOrders.some((order) => !order || order.userId !== actor.userId))
        throw new BusinessError("FINANCIAL_INCONSISTENT", "结算批次子订单映射异常", 500);

      const serverTime = await snapshot.databaseNow();
      const orderViews = await buildOrderDeliveryViews(snapshot, childOrders as Order[], serverTime);
      const expired = checkoutBatch.status === "PENDING_PAYMENT"
        && Date.parse(serverTime) >= Date.parse(checkoutBatch.expiresAt);
      return {
        data: {
          checkoutBatch: {
            id: checkoutBatch.id,
            status: checkoutBatch.status,
            totalCents: checkoutBatch.totalCents,
            expiresAt: checkoutBatch.expiresAt,
            expired,
            serverTime,
          },
          orders: orderViews.map((order) => ({
            id: order.id,
            status: order.status,
            totalCents: order.totalCents,
            expiresAt: order.expiresAt,
            paidAt: order.paidAt,
            pickupPointId: order.deliveryPlan?.pickupPointId ?? null,
            pickupPointName: order.deliveryPlan?.siteName ?? "自提点信息暂不可用",
            pickupPointAddress: order.deliveryPlan?.address ?? "",
          })),
        },
      };
    });
  });

  app.get("/api/v1/orders", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const rawQuery = request.query as Record<string, unknown>;
    if (rawQuery.pageSize !== undefined || rawQuery.cursorAt !== undefined || rawQuery.cursorId !== undefined || rawQuery.filter !== undefined) {
      const query = consumerOrderPageQuerySchema.parse(rawQuery);
      const statusesByFilter: Record<typeof query.filter, readonly string[] | undefined> = {
        ALL: undefined,
        PENDING: ["PENDING_PAYMENT"],
        ACTIVE: ["PAID_WAITING_CLOSE", "LOCKED", "ALLOCATING", "IN_TRANSIT"],
        DONE: ["PICKED_UP", "COMPLETED"],
        READY: ["READY_FOR_PICKUP"],
        AFTER: ["REFUNDING", "REFUNDED", "CANCELLED"],
      };
      const page = await store.searchOrders({
        userId: actor.userId,
        page: 1,
        pageSize: query.pageSize,
        ...(statusesByFilter[query.filter] ? { statuses: statusesByFilter[query.filter] } : {}),
        ...(query.filter === "AFTER" ? { includeCommunityQualityCases: true } : {}),
        ...(query.cursorAt ? { beforeCreatedAt: query.cursorAt, beforeId: query.cursorId } : {}),
      });
      return { data: { items: await views(page.items), hasMore: page.hasMore ?? false, nextCursor: page.nextCursor } };
    }
    return { data: await views(await store.listOrdersByUser(actor.userId)) };
  });

  app.get("/api/v1/orders/:id", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    return store.readSnapshot(async (snapshot) => {
      const order = await orders.getForUser(id, actor.userId, snapshot);
      const serverTime = await snapshot.databaseNow();
      return { data: { ...(await buildOrderDeliveryViews(snapshot, [order], serverTime))[0]!, serverTime } };
    });
  });

  app.post("/api/v1/orders/:id/cancel", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const before = await orders.getForUser(id, actor.userId);
    await rejectCommunityExternalEvidence(
      request,
      actor.userId,
      "ORDER",
      id,
      request.body,
    );
    const input = cancelOrderSchema.parse(request.body ?? {});
    if (before.status === "PENDING_PAYMENT") {
      const paid = await payments.reconcileBeforeCancellation(id, actor.userId);
      if (paid) {
        const current = await orders.getForUser(id, actor.userId);
        return { data: (await views([current]))[0]! };
      }
      const after = await orders.cancelPending(id, actor.userId);
      if (before.status !== after.status)
        await audit(
          request,
          actor.userId,
          "ORDER_CANCELLED_BY_USER",
          "ORDER",
          id,
          before,
          after,
        );
      return { data: (await views([after]))[0]! };
    }
    return {
      data: await communityOperations.requestCancellation(
        id,
        actor.userId,
        input.reason ?? "用户申请取消",
        request.id,
      ),
    };
  });

  app.get("/api/v1/admin/orders", async (request) => {
    requireActor(request, [
      "OPERATOR",
      "FINANCE",
      "CUSTOMER_SERVICE",
      "SUPER_ADMIN",
    ]);
    const query = request.query as { orderNo?: string };
    const matched = query.orderNo
      ? await store.getOrderByNo(query.orderNo.trim())
      : null;
    const orders = query.orderNo
      ? matched
        ? [matched]
        : []
      : await store.listOrders(100);
    return { data: await adminViews(orders) };
  });

  app.get("/api/v1/admin/orders/:id", async (request) => {
    requireActor(request, ["OPERATOR", "FINANCE", "CUSTOMER_SERVICE", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const order = await store.getOrder(id);
    if (!order) throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
    return { data: (await adminViews([order]))[0]! };
  });

  const searchAdminOrders = async (query: ReturnType<typeof adminOrderSearchQuerySchema.parse>) => {
    return store.searchOrders({
      status: query.status,
      campaignId: query.campaignId,
      pickupPointId: query.pickupPointId,
      keyword: query.keyword,
      dateType: query.dateType,
      from: query.from ? new Date(`${query.from}T00:00:00+08:00`).toISOString() : undefined,
      to: query.to ? new Date(`${query.to}T23:59:59.999+08:00`).toISOString() : undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
  };

  app.get("/api/v1/admin/orders/search", async (request) => {
    requireActor(request, ["OPERATOR", "FINANCE", "CUSTOMER_SERVICE", "SUPER_ADMIN"]);
    const query = adminOrderSearchQuerySchema.parse(request.query);
    const matching = await searchAdminOrders(query);
    return {
      data: {
        items: await adminViews(matching.items),
        total: matching.total,
        page: query.page,
        pageSize: query.pageSize,
      },
    };
  });

  app.get("/api/v1/admin/orders/export", async (request, reply) => {
    requireActor(request, ["OPERATOR", "FINANCE", "CUSTOMER_SERVICE", "SUPER_ADMIN"]);
    const query = adminOrderSearchQuerySchema.parse(request.query);
    const matching = await searchAdminOrders(query);
    const maxExportRows = 10_000;
    if (matching.total > maxExportRows)
      throw new BusinessError(
        "CAPACITY_EXCEEDED",
        `筛选结果超过单次导出上限 ${maxExportRows} 笔，请缩小筛选范围后重试`,
        413,
      );
    const orders = [...matching.items];
    const pages = Math.ceil(matching.total / matching.pageSize);
    for (let page = 2; page <= pages; page += 1) {
      orders.push(...(await store.searchOrders({
        status: query.status,
        campaignId: query.campaignId,
        pickupPointId: query.pickupPointId,
        keyword: query.keyword,
        dateType: query.dateType,
        from: query.from ? new Date(`${query.from}T00:00:00+08:00`).toISOString() : undefined,
        to: query.to ? new Date(`${query.to}T23:59:59.999+08:00`).toISOString() : undefined,
        page,
        pageSize: matching.pageSize,
      })).items);
    }
    const rows = await adminViews(orders);
    const csvCell = (value: unknown) => {
      const text = String(value ?? "");
      const safe = /^[\t\r\n ]*[=+@-]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const content = [
      ["订单号", "用户ID", "手机号", "团期", "自提点", "金额（元）", "状态", "下单时间", "支付时间"],
      ...rows.map((order) => [
        order.orderNo,
        order.consumerNumber ?? "",
        order.maskedPhone ?? "",
        order.campaignTitle ?? order.campaignId,
        order.pickupPointName ?? order.pickupPointId,
        (order.totalCents / 100).toFixed(2),
        order.status,
        order.createdAt,
        order.paidAt ?? "",
      ]),
    ].map((line) => line.map(csvCell).join(",")).join("\r\n");
    return reply
      .type("text/csv; charset=utf-8")
      .header("x-exported-row-count", String(rows.length))
      .header("content-disposition", "attachment; filename*=UTF-8''xiangweiji-orders.csv")
      .send(`\uFEFF${content}`);
  });

  void payments;
}
