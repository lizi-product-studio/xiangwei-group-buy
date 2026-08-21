import { createHash, randomUUID } from "node:crypto";
import { BusinessError } from "@hometown/domain";
import type {
  CommunityQualityCase,
  CommunityQualityReason,
  FulfillmentAllocation,
  FulfillmentException,
} from "../core/types.js";
import type { CommunityQualityStore } from "./community-operations-store.js";
export type CommunityQualityCaseInput = {
  clientRequestId: string;
  items: Array<{
    catalogSkuId: string;
    quantity: number;
    reason: CommunityQualityReason;
    description: string;
  }>;
};
const qualityWindowMs = 24 * 60 * 60 * 1000;
/**
 * A post-pickup quality report is a customer-service fact, not a fulfilment
 * reversal. In particular, it must never reduce fulfilled or picked-up counts.
 */
export class CommunityQualityService {
  public constructor(private readonly store: CommunityQualityStore) {}
  private payloadHash(input: CommunityQualityCaseInput): string {
    const items = [...input.items]
      .sort((left, right) =>
        left.catalogSkuId.localeCompare(right.catalogSkuId),
      )
      .map((item) => ({
        catalogSkuId: item.catalogSkuId,
        quantity: item.quantity,
        reason: item.reason,
        description: item.description,
      }));
    return createHash("sha256").update(JSON.stringify({ items })).digest("hex");
  }
  public async submit(
    orderId: string,
    userId: string,
    input: CommunityQualityCaseInput,
    requestId: string,
  ): Promise<CommunityQualityCase> {
    return this.store.transaction(async (store) => {
      const now = await store.databaseNow();
      const order = await store.getOrderForUpdate(orderId);
      if (!order || order.userId !== userId)
        throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
      if (
        !["READY_FOR_PICKUP", "PICKED_UP", "COMPLETED"].includes(order.status)
      )
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "只有已领取订单可以提交品质售后",
          409,
        );
      const eligibleReceipts = (
        await store.listCommunityPickupReceiptsByOrder(order.id)
      ).filter(
        (receipt) =>
          Date.parse(now) < Date.parse(receipt.createdAt) + qualityWindowMs,
      );
      if (!eligibleReceipts.length)
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "品质售后仅支持提货后 24 小时内提交",
          409,
        );
      const payloadHash = this.payloadHash(input);
      const duplicate =
        await store.getCommunityQualityCaseByOrderRequestForUpdate(
          order.id,
          input.clientRequestId,
        );
      if (duplicate) {
        if (duplicate.payloadHash !== payloadHash)
          throw new BusinessError(
            "IDEMPOTENCY_CONFLICT",
            "相同品质售后请求号的内容不能变更",
            409,
          );
        return duplicate;
      }
      const existing = await store.listCommunityQualityCasesByOrderForUpdate(
        order.id,
      );
      const disputedByReceiptAndSku = new Map<string, number>();
      for (const qualityCase of existing)
        for (const item of qualityCase.items)
          disputedByReceiptAndSku.set(
            `${item.pickupReceiptId}:${item.catalogSkuId}`,
            (disputedByReceiptAndSku.get(
              `${item.pickupReceiptId}:${item.catalogSkuId}`,
            ) ?? 0) + item.disputedQuantity,
          );
      const items = [] as CommunityQualityCase["items"];
      const salesLines = [] as Array<{
        before: unknown;
        after: unknown;
      }>;
      for (const requested of input.items) {
        const line = order.items.find(
          (item) => item.orderLineId && item.skuId === requested.catalogSkuId,
        );
        if (!line?.orderLineId)
          throw new BusinessError(
            "VALIDATION_ERROR",
            "品质售后商品必须属于订单",
            400,
            { catalogSkuId: requested.catalogSkuId },
          );
        let remaining = requested.quantity;
        for (const receipt of eligibleReceipts) {
          const pickedUp = receipt.items
            .filter((item) => item.catalogSkuId === requested.catalogSkuId)
            .reduce((sum, item) => sum + item.quantity, 0);
          const key = `${receipt.id}:${requested.catalogSkuId}`;
          const available = pickedUp - (disputedByReceiptAndSku.get(key) ?? 0);
          const disputedQuantity = Math.min(available, remaining);
          if (disputedQuantity <= 0) continue;
          items.push({
            id: randomUUID(),
            communityQualityCaseId: "",
            pickupReceiptId: receipt.id,
            orderLineId: line.orderLineId,
            catalogSkuId: line.skuId,
            pickedUpQuantitySnapshot: line.pickedUpQuantity,
            disputedQuantity,
            reason: requested.reason,
            description: requested.description,
          });
          disputedByReceiptAndSku.set(
            key,
            (disputedByReceiptAndSku.get(key) ?? 0) + disputedQuantity,
          );
          remaining -= disputedQuantity;
          if (remaining === 0) break;
        }
        if (remaining > 0)
          throw new BusinessError(
            "VALIDATION_ERROR",
            "申报数量不能超过 24 小时内领取且尚未申报的数量",
            400,
            {
              catalogSkuId: requested.catalogSkuId,
              requestedQuantity: requested.quantity,
              unavailableQuantity: remaining,
            },
          );
        const snapshot = {
          id: line.orderLineId,
          fulfilledQuantity: line.fulfilledQuantity,
          pickedUpQuantity: line.pickedUpQuantity,
          exceptionQuantity: line.exceptionQuantity,
          refundedQuantity: line.refundedQuantity,
          refundedAmountCents: line.refundedAmountCents,
        };
        salesLines.push({ before: snapshot, after: structuredClone(snapshot) });
      }
      const qualityCase: CommunityQualityCase = {
        id: randomUUID(),
        orderId: order.id,
        userId,
        clientRequestId: input.clientRequestId,
        payloadHash,
        status: "REGISTERED",
        registeredAt: now,
        acceptedBy: null,
        acceptedAt: null,
        decisionBy: null,
        decidedAt: null,
        decisionNote: null,
        refundApprovedBy: null,
        refundApprovedAt: null,
        financeExecutedBy: null,
        financeExecutedAt: null,
        refundExceptionId: null,
        items,
      };
      qualityCase.items.forEach((item) => {
        item.communityQualityCaseId = qualityCase.id;
      });
      if (!(await store.saveCommunityQualityCase(qualityCase))) {
        const raced =
          await store.getCommunityQualityCaseByOrderRequestForUpdate(
            order.id,
            input.clientRequestId,
          );
        if (raced && raced.payloadHash === payloadHash) return raced;
        if (raced)
          throw new BusinessError(
            "IDEMPOTENCY_CONFLICT",
            "相同品质售后请求号的内容不能变更",
            409,
          );
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "品质售后提交发生并发冲突，请重试",
          409,
        );
      }
      await store.saveAuditLog({
        id: randomUUID(),
        actorId: userId,
        action: "COMMUNITY_QUALITY_CASE_REGISTERED",
        resourceType: "COMMUNITY_QUALITY_CASE",
        resourceId: qualityCase.id,
        requestId,
        beforeData: null,
        afterData: { qualityCase, salesLines },
        createdAt: now,
      });
      return qualityCase;
    });
  }
  public async accept(
    caseId: string,
    actorId: string,
    note: string,
    requestId: string,
  ): Promise<CommunityQualityCase> {
    return this.store.transaction(async (store) => {
      const value = await store.getCommunityQualityCaseForUpdate(caseId);
      if (!value)
        throw new BusinessError(
          "RESOURCE_NOT_FOUND",
          "社区品质售后不存在",
          404,
        );
      if (
        value.status === "ACCEPTED" ||
        value.status === "REFUNDING" ||
        value.status === "RESOLVED"
      )
        return value;
      if (value.status !== "REGISTERED")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "当前品质售后不能受理",
          409,
        );
      const now = await store.databaseNow();
      value.status = "ACCEPTED";
      value.acceptedBy = actorId;
      value.acceptedAt = now;
      value.decisionNote = note;
      await store.saveCommunityQualityCase(value);
      await store.saveAuditLog({
        id: randomUUID(),
        actorId,
        action: "COMMUNITY_QUALITY_CASE_ACCEPTED",
        resourceType: "COMMUNITY_QUALITY_CASE",
        resourceId: value.id,
        requestId,
        beforeData: null,
        afterData: value,
        createdAt: now,
      });
      return value;
    });
  }
  public async decide(
    caseId: string,
    actorId: string,
    approved: boolean,
    note: string,
    requestId: string,
  ): Promise<CommunityQualityCase> {
    return this.store.transaction(async (store) => {
      const value = await store.getCommunityQualityCaseForUpdate(caseId);
      if (!value)
        throw new BusinessError(
          "RESOURCE_NOT_FOUND",
          "社区品质售后不存在",
          404,
        );
      if (
        value.status === "REJECTED" ||
        value.status === "REFUNDING" ||
        value.status === "RESOLVED"
      )
        return value;
      if (value.status !== "ACCEPTED")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "只有已受理品质售后可以由运营决定",
          409,
        );
      const now = await store.databaseNow();
      value.decisionBy = actorId;
      value.decidedAt = now;
      value.decisionNote = note;
      if (!approved) {
        value.status = "REJECTED";
        await store.saveCommunityQualityCase(value);
        await store.saveAuditLog({
          id: randomUUID(),
          actorId,
          action: "COMMUNITY_QUALITY_CASE_REJECTED",
          resourceType: "COMMUNITY_QUALITY_CASE",
          resourceId: value.id,
          requestId,
          beforeData: null,
          afterData: value,
          createdAt: now,
        });
        return value;
      }
      const order = await store.getOrderForUpdate(value.orderId);
      if (!order)
        throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
      const exception: FulfillmentException = {
        id: randomUUID(),
        campaignId: order.campaignId,
        orderId: order.id,
        clientRequestId: `quality:${value.id}`,
        deliveryPlanId: order.deliveryPlanId,
        sourceStage: "CUSTOMER_CLAIM",
        status: "REFUND_CONFIRMED",
        responsibility: "PLATFORM",
        registeredBy: value.userId,
        confirmedBy: actorId,
        resolutionNote: note,
        registeredAt: now,
        confirmedAt: now,
        items: [],
      };
      const allocations: FulfillmentAllocation[] = [];
      for (const item of value.items) {
        const line = order.items.find(
          (candidate) => candidate.orderLineId === item.orderLineId,
        );
        if (!line?.orderLineId || item.disputedQuantity > line.pickedUpQuantity)
          throw new BusinessError(
            "INVENTORY_INCONSISTENT",
            "品质售后销售快照不一致",
            409,
          );
        const exceptionItem = {
          id: randomUUID(),
          exceptionId: exception.id,
          catalogSkuId: item.catalogSkuId,
          expectedQuantity: item.disputedQuantity,
          acceptedQuantity: 0,
          rejectedQuantity: 0,
          shortQuantity:
            item.reason === "PICKUP_SHORTAGE" ? item.disputedQuantity : 0,
          damagedQuantity:
            item.reason === "PICKUP_SHORTAGE" ? 0 : item.disputedQuantity,
          reason: item.reason,
          description: item.description,
          evidenceUrl: null,
        };
        exception.items.push(exceptionItem);
        allocations.push({
          id: randomUUID(),
          exceptionId: exception.id,
          exceptionItemId: exceptionItem.id,
          orderLineId: item.orderLineId,
          orderId: order.id,
          catalogSkuId: item.catalogSkuId,
          fulfilledQuantity: 0,
          exceptionQuantity: item.disputedQuantity,
          refundedQuantity: 0,
          createdAt: now,
          refundedAt: null,
        });
      }
      await store.saveFulfillmentException(exception);
      await store.saveFulfillmentAllocations(allocations);
      value.status = "REFUNDING";
      value.refundExceptionId = exception.id;
      value.refundApprovedBy = actorId;
      value.refundApprovedAt = now;
      await store.saveCommunityQualityCase(value);
      await store.saveAuditLog({
        id: randomUUID(),
        actorId,
        action: "COMMUNITY_QUALITY_CASE_REFUND_APPROVED",
        resourceType: "COMMUNITY_QUALITY_CASE",
        resourceId: value.id,
        requestId,
        beforeData: null,
        afterData: { value, exception, allocations },
        createdAt: now,
      });
      return value;
    });
  }
  public async markFinanceExecuted(
    caseId: string,
    actorId: string,
    requestId: string,
  ): Promise<CommunityQualityCase> {
    return this.store.transaction(async (store) => {
      const value = await store.getCommunityQualityCaseForUpdate(caseId);
      if (!value || !value.refundExceptionId)
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "品质售后尚未获准退款",
          409,
        );
      if (value.status === "RESOLVED") return value;
      const refunds = await store.listPartialRefundsByException(
        value.refundExceptionId,
      );
      if (
        !refunds.length ||
        refunds.some((refund) => refund.status !== "SUCCEEDED")
      )
        return value;
      value.financeExecutedBy = actorId;
      value.financeExecutedAt = await store.databaseNow();
      value.status = "RESOLVED";
      await store.saveCommunityQualityCase(value);
      await store.saveAuditLog({
        id: randomUUID(),
        actorId,
        action: "COMMUNITY_QUALITY_CASE_FINANCE_EXECUTED",
        resourceType: "COMMUNITY_QUALITY_CASE",
        resourceId: value.id,
        requestId,
        beforeData: null,
        afterData: value,
        createdAt: value.financeExecutedAt,
      });
      return value;
    });
  }
}
