import { pickupCode, pickupCodeHash } from './pickup-code.js';
import { randomUUID } from "node:crypto";
import { BusinessError, moneyCents, transitionOrder } from "@hometown/domain";
import type { CommunityStore } from "./community-store.js";
import type {
  Campaign,
  CampaignItem,
  CommunityAllocationDraft,
  CommunityDeliveryConfirmation,
  FulfillmentAllocation,
  FulfillmentException,
  FulfillmentExceptionType,
  OrderLine,
} from "../core/types.js";
import type { NotificationService } from "../notifications/notification-service.js";

export type CommunityCampaignInput = {
  title: string;
  serviceAreaId: string;
  pickupPointId: string;
  cutoffAt: string;
  dispatchAt: string;
  estimatedArrivalStartAt: string | null;
  estimatedArrivalEndAt: string | null;
  minTotalQuantity: number;
  failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
  items: Array<{
    catalogSkuId: string;
    retailPriceCents: number;
    sellableQuantity: number;
  }>;
};
export type CommunityArrivalInput = {
  receivedBy: string;
  confirmationNote: string | null;
  emergencyReason: string | null;
  items: Array<{
    catalogSkuId: string;
    receivedQuantity: number;
    rejectedQuantity: number;
    shortQuantity: number;
    damagedQuantity: number;
    reason: FulfillmentExceptionType | null;
    evidenceNote: string | null;
  }>;
};

/**
 * The community flow records the dispatch fact, the point's counted
 * arrival and the per-order allocation that makes normal quantities collectible.
 */
export class CommunityFulfillmentService {
  public constructor(
    private readonly store: CommunityStore,
    private readonly pickupCodeSecret: string,
    private readonly notifications?: NotificationService,
  ) {}
  private now() {
    return new Date().toISOString();
  }
  private pickupHash(orderId: string) {
    return pickupCodeHash(pickupCode(orderId, this.pickupCodeSecret), this.pickupCodeSecret);
  }
  /** Calendar-day deadline: 23:59:59 on the third natural day in China. */
  private pickupDeadline(arrivedAt: string) {
    const fields = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(arrivedAt));
    const value = (kind: string) =>
      Number(fields.find((item) => item.type === kind)?.value);
    const deadline = new Date(
      Date.UTC(
        value("year"),
        value("month") - 1,
        value("day") + 3,
        15,
        59,
        59,
        0,
      ),
    );
    return deadline.toISOString();
  }
  private async audit(
    store: CommunityStore,
    actorId: string,
    requestId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    beforeData: unknown,
    afterData: unknown,
  ) {
    await store.saveAuditLog({
      id: randomUUID(),
      actorId,
      action,
      resourceType,
      resourceId,
      requestId,
      beforeData,
      afterData,
      createdAt: this.now(),
    });
  }

  private async editableDraft(store: CommunityStore, id: string, version: number, deleting = false) {
    const campaign = await store.getCampaignForUpdate(id);
    if (!campaign) throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
    if (campaign.status !== "DRAFT") throw new BusinessError("CAMPAIGN_NOT_DRAFT", "仅从未开售的草稿团期可以编辑或删除", 409);
    if (campaign.version !== version) throw new BusinessError("CAMPAIGN_VERSION_CONFLICT", "团期已被修改，请刷新后重新操作", 409);
    const plan = await store.getDeliveryPlanByCampaign(id);
    if (await store.hasCampaignBusinessReferences(id))
      throw new BusinessError("CAMPAIGN_HAS_REFERENCES", "团期已有订单、发车批次或后续履约记录，不能编辑或删除", 409);
    if (plan && (deleting ? (plan.status !== "SITE_CONFIRMED" || plan.vehicleOrderNo || plan.driverName || plan.driverPhone || plan.vehiclePlate || plan.logisticsPlatform || plan.bookedAt || plan.dispatchedAt || plan.arrivedAt) : !["SITE_CONFIRMED", "VEHICLE_BOOKED"].includes(plan.status)))
      throw new BusinessError("CAMPAIGN_HAS_REFERENCES", "团期已登记运输或履约信息，不能编辑或删除", 409);
    return { campaign, plan };
  }

  public async deleteCampaign(id: string, version: number, actorId: string, requestId: string) {
    return this.store.transaction(async (store) => {
      const before = await this.editableDraft(store, id, version, true);
      if (!await store.deleteDraftCampaign(id, version)) throw new BusinessError("CAMPAIGN_VERSION_CONFLICT", "团期已被修改，请刷新后重新操作", 409);
      await this.audit(store, actorId, requestId, "COMMUNITY_CAMPAIGN_DELETED", "CAMPAIGN", id, before, null);
      return { id, deleted: true };
    });
  }

  public async createCampaign(
    input: CommunityCampaignInput,
    actorId: string,
    requestId: string,
    edit?: { id: string; version: number },
  ): Promise<Campaign> {
    return this.store.transaction(async (store) => {
      const before = edit ? await this.editableDraft(store, edit.id, edit.version) : null;
      const area = (await store.listServiceAreas()).find(
        (item) =>
          item.id === input.serviceAreaId &&
          item.status === "ENABLED" &&
          item.orderEnabled,
      );
      const point = (await store.listPickupPoints(input.serviceAreaId)).find(
        (item) => item.id === input.pickupPointId && item.status === "ACTIVE",
      );
      if (!area || !point)
        throw new BusinessError(
          "RESOURCE_NOT_FOUND",
          "服务区域或固定自提点不可用",
          404,
        );
      if (before?.plan?.status === "VEHICLE_BOOKED" && (before.campaign.serviceAreaId !== input.serviceAreaId || before.plan.pickupPointId !== input.pickupPointId))
        throw new BusinessError("CAMPAIGN_HAS_REFERENCES", "已登记运输的草稿不能更换区域或自提点，请保留原配送安排", 409);
      if (before?.plan?.estimatedArrivalAt && Date.parse(before.plan.estimatedArrivalAt) < Date.parse(input.dispatchAt))
        throw new BusinessError("CAMPAIGN_TRANSPORT_CONFLICT", "计划发车时间不能晚于已登记运输的预计到达时间，请先调整运输安排", 409);
      const seen = new Set<string>();
      const items: CampaignItem[] = [];
      for (const requested of input.items) {
        if (seen.has(requested.catalogSkuId))
          throw new BusinessError("VALIDATION_ERROR", "团期商品不能重复", 400);
        seen.add(requested.catalogSkuId);
        const sku = await store.getCatalogSku(requested.catalogSkuId);
        if (!sku || sku.status !== "ACTIVE" || sku.product.status !== "ACTIVE")
          throw new BusinessError(
            "RESOURCE_NOT_FOUND",
            "商品不存在或已停用",
            404,
            { catalogSkuId: requested.catalogSkuId },
          );
        items.push({
          catalogSkuId: sku.id,
          productId: sku.productId,
          title: sku.product.title,
          category: sku.product.category,
          skuName: sku.name,
          origin: sku.product.origin,
          imageUrl: sku.product.imageUrl,
          retailPriceCents: moneyCents(requested.retailPriceCents),
          sellableQuantity: requested.sellableQuantity,
          reservedQuantity: 0,
        });
      }
      const now = this.now();
      const campaign: Campaign = {
        id: before?.campaign.id ?? randomUUID(),
        title: input.title,
        serviceAreaId: input.serviceAreaId,
        cutoffAt: input.cutoffAt,
        dispatchAt: input.dispatchAt,
        estimatedArrivalStartAt: input.estimatedArrivalStartAt,
        estimatedArrivalEndAt: input.estimatedArrivalEndAt,
        minTotalQuantity: input.minTotalQuantity,
        failureAction: input.failureAction,
        items,
        status: "DRAFT",
        version: before ? before.campaign.version + 1 : 1,
        createdAt: before?.campaign.createdAt ?? now,
      };
      if (before) {
        if (!await store.updateCampaign(campaign, before.campaign.version)) throw new BusinessError("CAMPAIGN_VERSION_CONFLICT", "团期已被修改，请刷新后重新操作", 409);
      } else await store.saveCampaign(campaign);
      await store.replaceCampaignItems(campaign.id, items);
      await store.saveDeliveryPlan({
        id: before?.plan?.id ?? randomUUID(),
        campaignId: campaign.id,
        serviceAreaId: campaign.serviceAreaId,
        pickupPointId: point.id,
        status: "SITE_CONFIRMED",
        siteName: point.name,
        address: point.address,
        arrivalStartAt: campaign.estimatedArrivalStartAt,
        arrivalEndAt: campaign.estimatedArrivalEndAt,
        contactName: point.contactName,
        contactPhone: point.contactPhone,
        vehicleOrderNo: null,
        driverName: null,
        driverPhone: null,
        vehiclePlate: null,
        logisticsPlatform: null,
        estimatedArrivalAt: null,
        remark: null,
        confirmedAt: now,
        bookedAt: null,
        dispatchedAt: null,
        arrivedAt: null,
        createdAt: now,
        updatedAt: now,
        ...(before?.plan?.status === "VEHICLE_BOOKED" ? {
          ...before.plan,
          arrivalStartAt: campaign.estimatedArrivalStartAt,
          arrivalEndAt: campaign.estimatedArrivalEndAt,
          updatedAt: now,
        } : {}),
      });
      await this.audit(
        store,
        actorId,
        requestId,
        before ? "COMMUNITY_CAMPAIGN_UPDATED" : "COMMUNITY_CAMPAIGN_CREATED",
        "CAMPAIGN",
        campaign.id,
        before,
        { campaign, items },
      );
      return campaign;
    });
  }

  public async confirmArrival(
    batchId: string,
    actorId: string,
    input: CommunityArrivalInput,
    requestId: string,
    emergencyProxy = false,
  ): Promise<CommunityDeliveryConfirmation> {
    return this.store.transaction(async (store) => {
      const batch = await store.getDispatchBatch(batchId);
      if (!batch)
        throw new BusinessError("RESOURCE_NOT_FOUND", "配送批次不存在", 404);
      const campaign = await store.getCampaignForUpdate(batch.campaignId);
      if (!campaign)
        throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
      const existing = await store.getCommunityDeliveryConfirmationByBatch(
        batch.id,
      );
      if (existing) return existing;
      const plan = await store.getDeliveryPlanByCampaign(batch.campaignId);
      if (
        !plan ||
        plan.status !== "IN_TRANSIT" ||
        batch.status !== "IN_TRANSIT"
      )
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "只有运输中的配送可以由点位确认到货",
          409,
        );
      const fulfillmentOrders = new Set(
        (await store.listOrdersByCampaign(campaign.id))
          .filter((order) => order.deliveryPlanId === plan.id &&
            ["LOCKED", "ALLOCATING", "IN_TRANSIT", "READY_FOR_PICKUP"].includes(order.status))
          .map((order) => order.id),
      );
      const rows = (await store.listOrderLinesByCampaignForUpdate(campaign.id))
        .filter((row) => fulfillmentOrders.has(row.orderId));
      // The sales-line locks serialize two first-arrival requests.  Re-read the
      // idempotency fact after acquiring them, otherwise a contender that read
      // before the first transaction committed could allocate the same paid
      // lines before its INSERT discovers the duplicate confirmation.
      const confirmedAfterLock =
        await store.getCommunityDeliveryConfirmationByBatch(batch.id);
      if (confirmedAfterLock) return confirmedAfterLock;
      const expected = new Map<string, number>();
      for (const row of rows)
        expected.set(
          row.catalogSkuId,
          (expected.get(row.catalogSkuId) ?? 0) + row.quantity,
        );
      const supplied = new Map(
        input.items.map((item) => [item.catalogSkuId, item]),
      );
      if (
        supplied.size !== input.items.length ||
        supplied.size !== expected.size ||
        [...expected.keys()].some((sku) => !supplied.has(sku))
      )
        throw new BusinessError(
          "VALIDATION_ERROR",
          "点位确认必须逐一覆盖本团已付款商品",
          400,
        );
      for (const [sku, quantity] of expected) {
        const item = supplied.get(sku)!;
        const total =
          item.receivedQuantity +
          item.rejectedQuantity +
          item.shortQuantity +
          item.damagedQuantity;
        if (total !== quantity)
          throw new BusinessError(
            "VALIDATION_ERROR",
            "实到、拒收、短少与破损数量之和必须等于应到数量",
            400,
            { catalogSkuId: sku, expectedQuantity: quantity },
          );
        const abnormal =
          item.rejectedQuantity + item.shortQuantity + item.damagedQuantity;
        if (abnormal > 0 && (!item.reason || !item.evidenceNote))
          throw new BusinessError(
            "VALIDATION_ERROR",
            "差异商品必须填写原因和证据说明",
            400,
            { catalogSkuId: sku },
          );
      }
      const now = this.now();
      const hasException = input.items.some(
        (item) =>
          item.rejectedQuantity + item.shortQuantity + item.damagedQuantity > 0,
      );
      const confirmation: CommunityDeliveryConfirmation = {
        id: randomUUID(),
        dispatchBatchId: batch.id,
        campaignId: campaign.id,
        deliveryPlanId: plan.id,
        status: hasException ? "EXCEPTION" : "COMPLETED",
        confirmedBy: actorId,
        receivedBy: input.receivedBy,
        confirmationNote: input.confirmationNote,
        confirmedAt: now,
        items: input.items.map((item) => ({
          id: randomUUID(),
          communityDeliveryId: "",
          catalogSkuId: item.catalogSkuId,
          expectedQuantity: expected.get(item.catalogSkuId)!,
          receivedQuantity: item.receivedQuantity,
          rejectedQuantity: item.rejectedQuantity,
          shortQuantity: item.shortQuantity,
          damagedQuantity: item.damagedQuantity,
          reason: item.reason,
          evidenceNote: item.evidenceNote,
          evidenceUrl: null,
        })),
      };
      confirmation.items.forEach(
        (item) => (item.communityDeliveryId = confirmation.id),
      );
      const exceptionItems = confirmation.items.filter(
        (item) =>
          item.rejectedQuantity + item.shortQuantity + item.damagedQuantity > 0,
      );
      const exception: FulfillmentException | null = !exceptionItems.length
        ? null
        : {
            id: randomUUID(),
            campaignId: campaign.id,
            orderId: null,
            clientRequestId: null,
            deliveryPlanId: plan.id,
            sourceStage: "PICKUP_ARRIVAL",
            refundAccountingStage: "PRE_REVENUE",
            status: "REGISTERED",
            responsibility: "PENDING",
            registeredBy: actorId,
            confirmedBy: null,
            resolutionNote: null,
            registeredAt: now,
            confirmedAt: null,
            items: exceptionItems.map((item) => ({
              id: randomUUID(),
              exceptionId: "",
              catalogSkuId: item.catalogSkuId,
              expectedQuantity: item.expectedQuantity,
              acceptedQuantity: item.receivedQuantity,
              rejectedQuantity: item.rejectedQuantity,
              shortQuantity: item.shortQuantity,
              damagedQuantity: item.damagedQuantity,
              reason: item.reason!,
              description: item.evidenceNote!,
              evidenceUrl: null,
            })),
          };
      if (exception)
        exception.items.forEach((item) => (item.exceptionId = exception.id));
      const exceptionItemBySku = new Map(
        exception?.items.map((item) => [item.catalogSkuId, item]) ?? [],
      );
      const allocations: FulfillmentAllocation[] = [];
      const remainingBySku = new Map(
        confirmation.items.map((item) => [
          item.catalogSkuId,
          item.receivedQuantity,
        ]),
      );
      const proposedRows: OrderLine[] = [];
      for (const row of rows) {
        const available = remainingBySku.get(row.catalogSkuId) ?? 0;
        const fulfilled = Math.min(row.quantity, available);
        remainingBySku.set(row.catalogSkuId, available - fulfilled);
        const exceptional = row.quantity - fulfilled;
        proposedRows.push({
          ...row,
          fulfilledQuantity: fulfilled,
          pickedUpQuantity: 0,
          exceptionQuantity: exceptional,
        });
        if (exceptional) {
          const exceptionItem = exceptionItemBySku.get(row.catalogSkuId);
          if (!exceptionItem)
            throw new BusinessError(
              "INVENTORY_INCONSISTENT",
              "差异分配缺少商品事实",
              500,
            );
          allocations.push({
            id: randomUUID(),
            exceptionId: exception!.id,
            exceptionItemId: exceptionItem.id,
            orderLineId: row.id,
            orderId: row.orderId,
            catalogSkuId: row.catalogSkuId,
            fulfilledQuantity: 0,
            exceptionQuantity: exceptional,
            refundedQuantity: 0,
            createdAt: now,
            refundedAt: null,
          });
        }
      }
      // Persist the confirmation before the allocation draft: MySQL enforces
      // this parent-child relation in the same transaction.
      if (!(await store.saveCommunityDeliveryConfirmation(confirmation))) {
        const raced = await store.getCommunityDeliveryConfirmationByBatch(
          batch.id,
        );
        if (raced) return raced;
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "到货确认已被并发处理，请刷新后重试",
          409,
        );
      }
      if (exception) {
        await store.saveFulfillmentException(exception);
        const draft = {
          id: randomUUID(),
          communityDeliveryId: confirmation.id,
          exceptionId: exception.id,
          campaignId: campaign.id,
          deliveryPlanId: plan.id,
          version: 1,
          sortRule: "paidAt_ASC_orderNo_ASC" as const,
          status: "PENDING_OPERATOR_CONFIRMATION" as const,
          createdBy: actorId,
          createdAt: now,
          confirmedBy: null,
          confirmedAt: null,
          items: proposedRows.map((row) => ({
            id: randomUUID(),
            allocationDraftId: "",
            orderLineId: row.id,
            orderId: row.orderId,
            orderNo: row.orderNo ?? row.orderId,
            catalogSkuId: row.catalogSkuId,
            paidAt: row.paidAt ?? now,
            fulfilledQuantity: row.fulfilledQuantity,
            exceptionQuantity: row.exceptionQuantity,
          })),
        };
        draft.items.forEach((item) => (item.allocationDraftId = draft.id));
        if (!(await store.saveCommunityAllocationDraft(draft)))
          throw new BusinessError(
            "CONCURRENT_MODIFICATION",
            "差异分配草案已被创建，请刷新后重试",
            409,
          );
      } else {
        for (const row of proposedRows)
          if (!(await store.updateOrderLine(row)))
            throw new BusinessError(
              "CONCURRENT_MODIFICATION",
              "销售明细已被并发更新，请刷新后重试",
              409,
            );
        const deadline = this.pickupDeadline(now);
        for (const orderId of [...new Set(rows.map((row) => row.orderId))]) {
          const order = await store.getOrderForUpdate(orderId);
          if (!order || order.status !== "IN_TRANSIT") continue;
          order.status = transitionOrder(order.status, "READY_FOR_PICKUP");
          await store.saveOrderStatus(order);
          await store.savePickupCredential({
            orderId: order.id,
            codeHash: this.pickupHash(order.id),
            status: "ACTIVE",
            expiresAt: deadline,
          });
          await store.saveCommunityPickupWindow({
            orderId: order.id,
            deliveryPlanId: plan.id,
            arrivedAt: now,
            deadlineAt: deadline,
            status: "ACTIVE",
            extensionCount: 0,
            extendedBy: null,
            extendedAt: null,
            dispositionBy: null,
            dispositionAt: null,
            dispositionNote: null,
            refundExceptionId: null,
            lossExceptionId: null,
          });
        }
      }
      batch.status = "ARRIVED";
      batch.arrivedAt = now;
      await store.saveDispatchBatch(batch);
      plan.status = "ARRIVED";
      plan.arrivedAt = now;
      plan.updatedAt = now;
      await store.saveDeliveryPlan(plan);
      if (!exception && this.notifications)
        await this.notifications.enqueueCampaign(
          store,
          "ARRIVED",
          campaign.id,
          plan,
          `arrival:${confirmation.id}`,
        );
      await this.audit(
        store,
        actorId,
        requestId,
        emergencyProxy
          ? "COMMUNITY_DELIVERY_EMERGENCY_CONFIRMED"
          : "COMMUNITY_DELIVERY_CONFIRMED",
        "COMMUNITY_DELIVERY",
        confirmation.id,
        null,
        {
          confirmation,
          exception,
          allocationStatus: exception
            ? "PENDING_OPERATOR_CONFIRMATION"
            : "NOT_REQUIRED",
          emergencyProxy,
          emergencyReason: emergencyProxy ? input.emergencyReason : null,
        },
      );
      return confirmation;
    });
  }

  public async confirmAllocationDraft(
    communityDeliveryId: string,
    actorId: string,
    requestId: string,
  ): Promise<CommunityAllocationDraft> {
    return this.store.transaction(async (store) => {
      const draft =
        await store.getCommunityAllocationDraftByDeliveryForUpdate(
          communityDeliveryId,
        );
      if (!draft)
        throw new BusinessError(
          "RESOURCE_NOT_FOUND",
          "差异分配草案不存在",
          404,
        );
      if (draft.status === "CONFIRMED") return draft;
      const rows = await store.listOrderLinesByCampaignForUpdate(
        draft.campaignId,
      );
      for (const orderId of new Set(draft.items.map((item) => item.orderId))) {
        const order = await store.getOrderForUpdate(orderId);
        if (!order || order.deliveryPlanId !== draft.deliveryPlanId ||
          !["LOCKED", "ALLOCATING", "IN_TRANSIT", "READY_FOR_PICKUP"].includes(order.status))
          throw new BusinessError("CONCURRENT_MODIFICATION", "订单履约状态已变化，不能确认过期草案", 409);
      }
      const byId = new Map(rows.map((row) => [row.id, row]));
      const allocations: FulfillmentAllocation[] = [];
      const exception = await store.getFulfillmentExceptionForUpdate(
        draft.exceptionId,
      );
      if (!exception)
        throw new BusinessError("RESOURCE_NOT_FOUND", "到货差异不存在", 404);
      const exceptionItems = new Map(
        exception.items.map((item) => [item.catalogSkuId, item]),
      );
      for (const proposed of draft.items) {
        const row = byId.get(proposed.orderLineId);
        if (!row || row.fulfilledQuantity || row.exceptionQuantity)
          throw new BusinessError(
            "CONCURRENT_MODIFICATION",
            "销售明细已变化，不能确认过期草案",
            409,
          );
        const next = {
          ...row,
          fulfilledQuantity: proposed.fulfilledQuantity,
          exceptionQuantity: proposed.exceptionQuantity,
          pickedUpQuantity: 0,
        };
        if (!(await store.updateOrderLine(next)))
          throw new BusinessError(
            "CONCURRENT_MODIFICATION",
            "销售明细已被并发更新，请刷新后重试",
            409,
          );
        if (proposed.exceptionQuantity) {
          const item = exceptionItems.get(proposed.catalogSkuId);
          if (!item)
            throw new BusinessError(
              "INVENTORY_INCONSISTENT",
              "差异商品不存在",
              500,
            );
          allocations.push({
            id: randomUUID(),
            exceptionId: exception.id,
            exceptionItemId: item.id,
            orderLineId: row.id,
            orderId: row.orderId,
            catalogSkuId: row.catalogSkuId,
            fulfilledQuantity: 0,
            exceptionQuantity: proposed.exceptionQuantity,
            refundedQuantity: 0,
            createdAt: this.now(),
            refundedAt: null,
          });
        }
      }
      await store.saveFulfillmentAllocations(allocations);
      const deadline = this.pickupDeadline(draft.createdAt);
      for (const orderId of [
        ...new Set(draft.items.map((item) => item.orderId)),
      ]) {
        const order = await store.getOrderForUpdate(orderId);
        const own = draft.items.filter((item) => item.orderId === orderId);
        if (
          !order ||
          order.status !== "IN_TRANSIT" ||
          !own.some((item) => item.fulfilledQuantity)
        )
          continue;
        order.status = transitionOrder(order.status, "READY_FOR_PICKUP");
        await store.saveOrderStatus(order);
        await store.savePickupCredential({
          orderId,
          codeHash: this.pickupHash(orderId),
          status: "ACTIVE",
          expiresAt: deadline,
        });
        await store.saveCommunityPickupWindow({
          orderId,
          deliveryPlanId: draft.deliveryPlanId,
          arrivedAt: draft.createdAt,
          deadlineAt: deadline,
          status: "ACTIVE",
          extensionCount: 0,
          extendedBy: null,
          extendedAt: null,
          dispositionBy: null,
          dispositionAt: null,
          dispositionNote: null,
          refundExceptionId: null,
          lossExceptionId: null,
        });
      }
      exception.status = "REFUND_CONFIRMED";
      exception.responsibility = "PLATFORM";
      exception.confirmedBy = actorId;
      exception.confirmedAt = this.now();
      exception.resolutionNote = "运营已确认按支付时间、订单号生成的差异分配";
      await store.saveFulfillmentException(exception);
      draft.status = "CONFIRMED";
      draft.confirmedBy = actorId;
      draft.confirmedAt = this.now();
      await store.saveCommunityAllocationDraft(draft);
      const plan = await store.getDeliveryPlanByCampaign(draft.campaignId);
      if (plan && this.notifications)
        await this.notifications.enqueueCampaign(
          store,
          "ARRIVED",
          draft.campaignId,
          plan,
          `arrival:${draft.communityDeliveryId}`,
        );
      await this.audit(
        store,
        actorId,
        requestId,
        "COMMUNITY_ALLOCATION_DRAFT_CONFIRMED",
        "COMMUNITY_ALLOCATION_DRAFT",
        draft.id,
        null,
        draft,
      );
      return draft;
    });
  }
}
