import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  cancelOrderSchema,
  identifierSchema,
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
  const views = (values: Order[]) => buildOrderDeliveryViews(store, values);
  const adminViews = async (values: Order[]) => {
    const [rows, campaigns, points, users] = await Promise.all([
      views(values),
      store.listCampaigns(),
      store.listPickupPoints(),
      ensureConsumerPublicNumbers(store),
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

  app.get("/api/v1/orders", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    return { data: await views(await store.listOrdersByUser(actor.userId)) };
  });

  app.get("/api/v1/orders/:id", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const order = await orders.getForUser(id, actor.userId);
    return { data: (await views([order]))[0]! };
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

  const searchAdminOrders = async (query: ReturnType<typeof adminOrderSearchQuerySchema.parse>) => {
    const [allOrders, users] = await Promise.all([
      store.listOrders(Number.MAX_SAFE_INTEGER),
      ensureConsumerPublicNumbers(store),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const keyword = query.keyword.toLocaleLowerCase("zh-CN");
    return allOrders
      .filter((order) => {
        if (query.status && order.status !== query.status) return false;
        if (query.campaignId && order.campaignId !== query.campaignId) return false;
        if (query.pickupPointId && order.pickupPointId !== query.pickupPointId) return false;
        if (query.from || query.to) {
          const date = query.dateType === "PAID_AT" ? order.paidAt : order.createdAt;
          if (!date) return false;
          const timestamp = Date.parse(date);
          const start = query.from ? Date.parse(`${query.from}T00:00:00+08:00`) : Number.NEGATIVE_INFINITY;
          const end = query.to ? Date.parse(`${query.to}T23:59:59.999+08:00`) : Number.POSITIVE_INFINITY;
          if (timestamp < start || timestamp > end) return false;
        }
        if (keyword) {
          const user = userById.get(order.userId);
          const candidates = [
            order.orderNo,
            String(user?.consumerNumber ?? ""),
            user?.phoneNumber ?? "",
            user?.displayName ?? "",
          ];
          if (!candidates.some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword)))
            return false;
        }
        return true;
      })
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      );
  };

  app.get("/api/v1/admin/orders/search", async (request) => {
    requireActor(request, ["OPERATOR", "FINANCE", "CUSTOMER_SERVICE", "SUPER_ADMIN"]);
    const query = adminOrderSearchQuerySchema.parse(request.query);
    const matching = await searchAdminOrders(query);
    const start = (query.page - 1) * query.pageSize;
    return {
      data: {
        items: await adminViews(matching.slice(start, start + query.pageSize)),
        total: matching.length,
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
    if (matching.length > maxExportRows)
      throw new BusinessError(
        "CAPACITY_EXCEEDED",
        `筛选结果超过单次导出上限 ${maxExportRows} 笔，请缩小筛选范围后重试`,
        413,
      );
    const rows = await adminViews(matching);
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
