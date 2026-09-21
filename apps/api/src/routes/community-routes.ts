import { operationsPageSchema } from "./operations-pagination.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  communityArrivalSchema,
  communityCancellationReviewSchema,
  communityPickupDispositionSchema,
  communityPickupExtensionSchema,
  identifierSchema,
} from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import { requireActor } from "../modules/auth/auth.js";
import { exceptionRefundFacts, orderRefundFacts } from "../modules/finance/refund-readmodel.js";
import type { CommerceStore } from "../modules/core/store.js";
import type { CommunityFulfillmentService } from "../modules/fulfillment/community-fulfillment-service.js";
import type { CommunityOperationsService } from "../modules/fulfillment/community-operations-service.js";

export function registerCommunityRoutes(
  app: FastifyInstance,
  dependencies: {
    store: CommerceStore;
    communityFulfillment: CommunityFulfillmentService;
    communityOperations: CommunityOperationsService;
    assertActivePickupPointAccess(
      actor: { userId: string; roles: readonly string[] },
      pickupPointId: string,
    ): Promise<void>;
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
    communityFulfillment,
    communityOperations,
    assertActivePickupPointAccess,
    rejectCommunityExternalEvidence,
  } = dependencies;
  app.get("/api/v1/admin/community/deliveries", async (request) => {
    const actor = requireActor(request, [
      "OPERATOR",
      "PICKUP_MANAGER",
      "SUPER_ADMIN",
    ]);
    const [plans, batches, campaigns] = await Promise.all([
      store.listDeliveryPlans(),
      store.listDispatchBatches(),
      store.listCampaigns(),
    ]);
    const campaignById = new Map(
      campaigns.map((campaign) => [campaign.id, campaign]),
    );
    const batchByCampaign = new Map(
      batches.map((batch) => [batch.campaignId, batch]),
    );
    const allowed =
      actor.roles.includes("SUPER_ADMIN") || actor.roles.includes("OPERATOR");
    const filtered = [];
    for (const plan of plans) {
      const campaign = campaignById.get(plan.campaignId);
      if (!campaign) continue;
      if (
        !allowed &&
        (!plan.pickupPointId ||
          !(await store.hasActivePickupPointAssignment(
            actor.userId,
            plan.pickupPointId,
          )))
      )
        continue;
      const batch = batchByCampaign.get(campaign.id) ?? null;
      const expectedBySku = new Map<string, number>();
      const eligibleOrderIds = new Set(
        (await store.listOrdersByCampaign(campaign.id))
          .filter(
            (order) =>
              order.paidAt &&
              ["LOCKED", "ALLOCATING", "IN_TRANSIT", "READY_FOR_PICKUP"].includes(
                order.status,
              ),
          )
          .map((order) => order.id),
      );
      for (const line of await store.listOrderLinesByCampaign(campaign.id)) {
        if (!eligibleOrderIds.has(line.orderId)) continue;
        expectedBySku.set(
          line.catalogSkuId,
          (expectedBySku.get(line.catalogSkuId) ?? 0) + line.quantity,
        );
      }
      const confirmation = batch
        ? await store.getCommunityDeliveryConfirmationByBatch(batch.id)
        : null;
      const draft = confirmation
        ? await store.getCommunityAllocationDraftByDeliveryForUpdate(
            confirmation.id,
          )
        : null;
      filtered.push({
        id: plan.id,
        createdAt: plan.createdAt,
        arrivalConfirmedAt: confirmation?.confirmedAt ?? null,
        campaignId: plan.campaignId,
        campaignTitle: campaign.title,
        pickupPointId: plan.pickupPointId,
        status: plan.status,
        siteName: plan.siteName,
        address: plan.address,
        vehicleOrderNo: plan.vehicleOrderNo,
        logisticsPlatform: plan.logisticsPlatform,
        driverName: plan.driverName,
        vehiclePlate: plan.vehiclePlate,
        estimatedArrivalAt: plan.estimatedArrivalAt,
        dispatchedAt: plan.dispatchedAt,
        arrivedAt: plan.arrivedAt,
        dispatchBatchId: batch?.status === "IN_TRANSIT" ? batch.id : null,
        arrivalConfirmed: confirmation !== null,
        arrivalResult: confirmation?.status ?? null,
        communityDeliveryId: confirmation?.id ?? null,
        allocationDraftStatus: draft?.status ?? null,
        expectedItems: campaign.items
          .map((item) => ({
            catalogSkuId: item.catalogSkuId,
            title: item.title,
            skuName: item.skuName,
            expectedQuantity: expectedBySku.get(item.catalogSkuId) ?? 0,
          }))
          .filter((item) => item.expectedQuantity > 0),
      });
    }
    return { data: filtered };
  });
  app.post(
    "/api/v1/admin/community/dispatch-batches/:id/arrival",
    async (request) => {
      const actor = requireActor(request, ["PICKUP_MANAGER", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const batch = await store.getDispatchBatch(id);
      if (!batch)
        throw new BusinessError("RESOURCE_NOT_FOUND", "配送批次不存在", 404);
      const plan = await store.getDeliveryPlanByCampaign(batch.campaignId);
      if (!plan?.pickupPointId)
        throw new BusinessError("FORBIDDEN", "配送批次未绑定固定自提点", 403);
      await assertActivePickupPointAccess(actor, plan.pickupPointId);
      await rejectCommunityExternalEvidence(
        request,
        actor.userId,
        "COMMUNITY_DISPATCH_BATCH",
        id,
        request.body,
      );
      const input = communityArrivalSchema.parse(request.body);
      const emergencyProxy = actor.roles.includes("SUPER_ADMIN");
      if (emergencyProxy && !input.emergencyReason)
        throw new BusinessError(
          "VALIDATION_ERROR",
          "紧急代办必须填写代办原因",
          400,
        );
      if (!emergencyProxy && input.emergencyReason)
        throw new BusinessError(
          "FORBIDDEN",
          "只有平台负责人紧急代办时可以填写代办原因",
          403,
        );
      return {
        data: await communityFulfillment.confirmArrival(
          id,
          actor.userId,
          input,
          request.id,
          emergencyProxy,
        ),
      };
    },
  );
  app.post(
    "/api/v1/admin/community/deliveries/:id/allocation-draft/confirm",
    async (request) => {
      const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      return {
        data: await communityFulfillment.confirmAllocationDraft(
          id,
          actor.userId,
          request.id,
        ),
      };
    },
  );
  app.post(
    "/api/v1/admin/community/orders/:id/cancellation/review",
    async (request) => {
      const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const input = communityCancellationReviewSchema.parse(request.body);
      return {
        data: await communityOperations.reviewCancellation(
          id,
          actor.userId,
          input.approved,
          input.note,
          request.id,
        ),
      };
    },
  );
  app.post(
    "/api/v1/admin/community/orders/:id/cancellation/refund",
    async (request) => {
      const actor = requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      return {
        data: await communityOperations.executeCancellationRefund(
          id,
          actor.userId,
          request.id,
        ),
      };
    },
  );
  app.get("/api/v1/admin/community/cancellation-requests", async (request) => {
    const actor = requireActor(request, [
      "OPERATOR",
      "FINANCE",
      "CUSTOMER_SERVICE",
      "SUPER_ADMIN",
    ]);
    const visibleStatuses = actor.roles.includes("SUPER_ADMIN") || actor.roles.includes("OPERATOR") || actor.roles.includes("CUSTOMER_SERVICE")
      ? undefined : ["APPROVED_WAITING_FINANCE", "REFUNDING", "REFUNDED"];
    const page = await store.listOperationsQueue("cancellations", {
      ...operationsPageSchema.parse(request.query),
      ...(visibleStatuses ? {allowedStatuses: visibleStatuses} : {}),
    });
    const orders = await Promise.all([...new Set(page.items.map(value => value.orderId))].map(id => store.getOrder(id)));
    const orderById = new Map(orders.filter(value => value !== null).map(order => [order.id, order]));
    const refunds = await Promise.all(page.items.map(value => store.getOrderRefundByOrder(value.orderId)));
    return {
      pagination: {total: page.total, page: page.page, pageSize: page.pageSize},
      data: page.items.map((value, index) => {
          const order = orderById.get(value.orderId);
          return {
            id: value.id,
            orderId: value.orderId,
            orderNo: order?.orderNo ?? null,
            status: value.status,
            reason: value.reason,
            requestedAt: value.requestedAt,
            reviewedBy: value.reviewedBy,
            reviewedAt: value.reviewedAt,
            reviewNote: value.reviewNote,
            financeExecutedBy: value.financeExecutedBy,
            financeExecutedAt: value.financeExecutedAt,
            refundId: value.refundId,
            ...orderRefundFacts(order ?? null, refunds[index] ?? null),
            items: (order?.items ?? []).map((item) => ({
              catalogSkuId: item.skuId,
              name: item.name,
              quantity: item.quantity,
            })),
          };
        }),
    };
  });
  app.post(
    "/api/v1/admin/community/orders/:id/pickup-extension",
    async (request) => {
      const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const input = communityPickupExtensionSchema.parse(request.body);
      return {
        data: await communityOperations.extendPickup(
          id,
          actor.userId,
          input.deadlineAt,
          input.note,
          request.id,
        ),
      };
    },
  );
  app.post(
    "/api/v1/admin/community/orders/:id/pickup-disposition",
    async (request) => {
      const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      const input = communityPickupDispositionSchema.parse(request.body);
      return {
        data: await communityOperations.disposeExpiredPickup(
          id,
          actor.userId,
          input.action,
          input.note,
          request.id,
        ),
      };
    },
  );
  app.post(
    "/api/v1/admin/community/orders/:id/pickup-refund",
    async (request) => {
      const actor = requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
      const id = identifierSchema.parse((request.params as { id: string }).id);
      await communityOperations.executeExpiredPickupRefund(
        id,
        actor.userId,
        request.id,
      );
      return {
        data: await store.transaction((transactionStore) =>
          transactionStore.getCommunityPickupWindowForUpdate(id),
        ),
      };
    },
  );
  app.get("/api/v1/admin/community/pickup-windows", async (request) => {
    requireActor(request, ["OPERATOR", "FINANCE", "SUPER_ADMIN"]);
    const page = await store.listOperationsQueue("windows", operationsPageSchema.parse(request.query));
    const [orders, points] = await Promise.all([
      Promise.all(page.items.map(value => store.getOrder(value.orderId))),
      store.listPickupPoints(),
    ]);
    const exceptions = await Promise.all(page.items.map((value) => value.refundExceptionId ? store.getFulfillmentException(value.refundExceptionId) : Promise.resolve(null)));
    const orderById = new Map(orders.filter(value => value !== null).map(order => [order.id, order]));
    const pointById = new Map(points.map((point) => [point.id, point]));
    return {
      pagination: {total: page.total, page: page.page, pageSize: page.pageSize},
      data: await Promise.all(page.items.map(async (window, index) => {
        const order = orderById.get(window.orderId) ?? null;
        const exception = exceptions[index];
        return {
          ...window,
          orderNo: order?.orderNo ?? null,
          orderStatus: order?.status ?? null,
          pickupPointId: order?.pickupPointId ?? null,
          pickupPointName: order
            ? (pointById.get(order.pickupPointId)?.name ?? null)
            : null,
          nextResponsibility:
            window.status === "EXPIRED_PENDING"
              ? "OPERATOR"
              : window.status === "REFUND_PENDING"
                ? "FINANCE"
                : null,
          ...(exception ? await exceptionRefundFacts(store, exception) : {refundAmountCents: null, financialFactsError: "退款事实缺失，请联系管理员核查，暂不可执行退款", refundAmountKind: null, refundStatus: null}),
        };
      })),
    };
  });
}
