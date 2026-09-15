import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createDispatchBatchSchema,
  identifierSchema,
  pickupOrderLookupQuerySchema,
  verifyPickupSchema,
} from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import { requireActor } from "../modules/auth/auth.js";
import type { CommerceStore } from "../modules/core/store.js";
import type { DeliveryPlan, Order } from "../modules/core/types.js";
import type { FulfillmentService } from "../modules/fulfillment/fulfillment-service.js";

const pickupRecordQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  orderNo: z.string().trim().max(64).optional(),
});

export function registerFulfillmentRoutes(
  app: FastifyInstance,
  dependencies: {
    store: CommerceStore;
    fulfillment: FulfillmentService;
    assertActivePickupPointAccess(
      actor: { userId: string; roles: readonly string[] },
      pickupPointId: string,
    ): Promise<void>;
  },
): void {
  const { store, fulfillment, assertActivePickupPointAccess } = dependencies;
  app.post("/api/v1/admin/dispatch-batches", async (request, reply) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const input = createDispatchBatchSchema.parse(request.body);
    return reply
      .status(201)
      .send({ data: await fulfillment.createBatch(input.campaignId) });
  });
  app.get("/api/v1/admin/dispatch-batches", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return { data: await store.listDispatchBatches() };
  });
  app.post("/api/v1/admin/dispatch-batches/:id/dispatch", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    return { data: await fulfillment.dispatch(id) };
  });
  app.get("/api/v1/pickup-code", async (request) => {
    const actor = requireActor(request, ["USER", "SUPER_ADMIN"]);
    const query = request.query as { orderId?: string };
    return {
      data: await fulfillment.getCode(
        identifierSchema.parse(query.orderId),
        actor.userId,
      ),
    };
  });
  app.get("/api/v1/pickup/orders/lookup", async (request) => {
    const actor = requireActor(request, ["PICKUP_MANAGER"]);
    const query = pickupOrderLookupQuerySchema.parse(request.query);
    let plan: DeliveryPlan | null;
    let order: Order | null = null;
    if (query.pickupPointId && query.code) {
      const pickupPoint = (await store.listPickupPoints()).find(
        (item) => item.id === query.pickupPointId,
      );
      if (!pickupPoint || pickupPoint.status !== "ACTIVE")
        throw new BusinessError("FORBIDDEN", "当前自提点未启用，不能核销", 403);
      await assertActivePickupPointAccess(actor, query.pickupPointId);
      order = await fulfillment.lookupByPickupCode(
        query.pickupPointId,
        query.code,
        query.orderNo,
      );
      plan = await store.getDeliveryPlan(order.deliveryPlanId);
    } else {
      plan = await store.getDeliveryPlan(query.deliveryPlanId!);
    }
    if (!plan || !plan.pickupPointId || plan.status !== "ARRIVED")
      throw new BusinessError(
        "RESOURCE_NOT_FOUND",
        "配送计划不存在或当前不可核销",
        404,
      );
    const pickupPoint = (await store.listPickupPoints(plan.serviceAreaId)).find(
      (item) => item.id === plan.pickupPointId,
    );
    if (!pickupPoint || pickupPoint.status !== "ACTIVE")
      throw new BusinessError("FORBIDDEN", "当前自提点未启用，不能核销", 403);
    await assertActivePickupPointAccess(actor, plan.pickupPointId);
    order ??= await store.getOrderByNo(query.orderNo!);
    if (
      !order ||
      order.deliveryPlanId !== plan.id ||
      order.pickupPointId !== plan.pickupPointId
    )
      throw new BusinessError(
        "RESOURCE_NOT_FOUND",
        "未找到本领取点的订单",
        404,
      );
    return {
      data: {
        id: order.id,
        orderNo: order.orderNo,
        deliveryPlanId: order.deliveryPlanId,
        status: order.status,
        items: order.items.map((item) => ({
          skuId: item.skuId,
          name: item.name,
          quantity: item.quantity,
          readyQuantity: item.fulfilledQuantity,
          alreadyPickedQuantity: item.pickedUpQuantity,
          remainingPickupQuantity: Math.max(
            0,
            item.fulfilledQuantity - item.pickedUpQuantity,
          ),
          exceptionQuantity: item.exceptionQuantity,
        })),
      },
    };
  });
  app.post("/api/v1/pickup/verify", async (request) => {
    const actor = requireActor(request, ["PICKUP_MANAGER"]);
    const input = verifyPickupSchema.parse(request.body);
    if (!input.pickupRequestId || !input.items?.length)
      throw new BusinessError(
        "VALIDATION_ERROR",
        "核销必须包含领取请求号和本次领取商品",
        400,
      );
    return {
      data: await fulfillment.verify({
        orderId: input.orderId,
        deliveryPlanId: input.deliveryPlanId,
        code: input.code,
        verifierId: actor.userId,
        bypassPointAuthorization: false,
        requestedItems: input.items,
        pickupRequestId: input.pickupRequestId,
      }),
    };
  });
  app.get("/api/v1/pickup/records", async (request) => {
    const actor = requireActor(request, ["PICKUP_MANAGER"]);
    const query = pickupRecordQuerySchema.parse(request.query);
    const [assignments, points, receipts, orders, campaigns, staff] = await Promise.all([
      store.listStaffPickupPointAssignments(actor.userId),
      store.listPickupPoints(),
      store.listCommunityPickupReceipts(),
      store.listOrders(Number.MAX_SAFE_INTEGER),
      store.listCampaigns(),
      store.listInternalStaff(),
    ]);
    const assignedPointIds = new Set(
      assignments.map((assignment) => assignment.pickupPointId),
    );
    const pointById = new Map(
      points
        .filter(
          (point) =>
            point.status === "ACTIVE" && assignedPointIds.has(point.id),
        )
        .map((point) => [point.id, point]),
    );
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const campaignById = new Map(
      campaigns.map((campaign) => [campaign.id, campaign]),
    );
    const staffById = new Map(
      staff.map((member) => [member.userId, member]),
    );
    const rows = [];
    for (const receipt of receipts) {
      const order = orderById.get(receipt.orderId);
      if (!order || !pointById.has(order.pickupPointId)) continue;
      if (query.orderNo && !order.orderNo.includes(query.orderNo)) continue;
      const campaign = campaignById.get(order.campaignId);
      const verifier = staffById.get(receipt.verifierId);
      const point = pointById.get(order.pickupPointId)!;
      rows.push({
        id: receipt.id,
        orderNo: order.orderNo,
        campaignTitle: campaign?.title ?? "团期已归档",
        pickupPointId: point.id,
        pickupPointName: point.name,
        pickedUpAt: receipt.createdAt,
        verifierName: verifier?.displayName ?? "点位工作人员",
        items: receipt.items.map((item) => ({
          skuId: item.catalogSkuId,
          name:
            order.items.find((orderItem) => orderItem.skuId === item.catalogSkuId)
              ?.name ?? "商品已归档",
          quantity: item.quantity,
        })),
      });
    }
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: rows.slice(start, start + query.pageSize),
      pagination: { total, page: query.page, pageSize: query.pageSize },
    };
  });
}
