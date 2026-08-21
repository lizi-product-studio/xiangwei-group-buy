import { randomUUID } from "node:crypto";
import { BusinessError, transitionOrder } from "@hometown/domain";
import type {
  CommunityCancellationRequest,
  FulfillmentAllocation,
  FulfillmentException,
} from "../core/types.js";
import type { PaymentService } from "../payments/payment-service.js";
import type { NotificationService } from "../notifications/notification-service.js";
import type { CommunityOperationsStore } from "./community-operations-store.js";
/** Paid cancellation preserves the cutoff/dispatch
 * decision and keeps finance as the only post-cutoff refund executor. */
export class CommunityOperationsService {
  public constructor(
    private readonly store: CommunityOperationsStore,
    private readonly payments: PaymentService,
    private readonly notifications: NotificationService,
  ) {}
  private now() {
    return new Date().toISOString();
  }
  private async audit(
    store: CommunityOperationsStore,
    actorId: string,
    requestId: string,
    action: string,
    value: CommunityCancellationRequest,
  ) {
    await store.saveAuditLog({
      id: randomUUID(),
      actorId,
      action,
      resourceType: "COMMUNITY_CANCELLATION_REQUEST",
      resourceId: value.id,
      requestId,
      beforeData: null,
      afterData: value,
      createdAt: this.now(),
    });
  }
  public async requestCancellation(
    orderId: string,
    userId: string,
    reason: string,
    requestId: string,
  ): Promise<CommunityCancellationRequest> {
    const { value, execute } = await this.store.transaction(async (store) => {
      const order = await store.getOrderForUpdate(orderId);
      if (!order || order.userId !== userId)
        throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
      const existing =
        await store.getCommunityCancellationRequestByOrderForUpdate(order.id);
      if (existing)
        return {
          value: existing,
          execute: ["DIRECT_REFUNDING", "REFUNDING"].includes(existing.status),
        };
      const campaign = await store.getCampaign(order.campaignId);
      if (!campaign)
        throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
      const batch = (await store.listDispatchBatches()).find(
        (item) => item.campaignId === campaign.id,
      );
      if (
        batch?.status === "IN_TRANSIT" ||
        batch?.status === "ARRIVED" ||
        ["IN_TRANSIT", "READY_FOR_PICKUP", "PICKED_UP", "COMPLETED"].includes(
          order.status,
        )
      )
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "发车后订单应进入履约异常或品质售后处理，不能申请取消",
          409,
        );
      const direct =
        Date.parse(this.now()) < Date.parse(campaign.cutoffAt) &&
        order.status === "PAID_WAITING_CLOSE";
      const value: CommunityCancellationRequest = {
        id: randomUUID(),
        orderId: order.id,
        userId,
        reason,
        status: direct ? "DIRECT_REFUNDING" : "PENDING_REVIEW",
        requestedAt: this.now(),
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        financeExecutedBy: null,
        financeExecutedAt: null,
        refundId: null,
      };
      if (direct) {
        order.status = transitionOrder(order.status, "REFUNDING");
        await store.saveOrderStatus(order);
        for (const item of order.items) {
          if (
            !(await store.releaseCampaignInventory(
              order.campaignId,
              item.skuId,
              item.quantity,
            ))
          )
            throw new BusinessError(
              "INVENTORY_INCONSISTENT",
              "取消订单释放库存失败",
              500,
            );
        }
      }
      if (!(await store.saveCommunityCancellationRequest(value)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "取消申请正在处理中，请重试",
          409,
        );
      await this.audit(
        store,
        userId,
        requestId,
        direct
          ? "COMMUNITY_CANCELLATION_DIRECT_REFUND"
          : "COMMUNITY_CANCELLATION_REQUESTED",
        value,
      );
      return { value, execute: direct };
    });
    if (execute) await this.payments.refundOrder(orderId);
    return value;
  }
  public async reviewCancellation(
    orderId: string,
    actorId: string,
    approved: boolean,
    note: string,
    requestId: string,
  ): Promise<CommunityCancellationRequest> {
    return this.store.transaction(async (store) => {
      const value =
        await store.getCommunityCancellationRequestByOrderForUpdate(orderId);
      if (!value)
        throw new BusinessError("RESOURCE_NOT_FOUND", "取消申请不存在", 404);
      if (value.status !== "PENDING_REVIEW")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "当前取消申请不能审核",
          409,
        );
      value.status = approved ? "APPROVED_WAITING_FINANCE" : "REJECTED";
      value.reviewedBy = actorId;
      value.reviewedAt = this.now();
      value.reviewNote = note;
      await store.saveCommunityCancellationRequest(value);
      await this.audit(
        store,
        actorId,
        requestId,
        approved
          ? "COMMUNITY_CANCELLATION_APPROVED"
          : "COMMUNITY_CANCELLATION_REJECTED",
        value,
      );
      return value;
    });
  }
  public async executeCancellationRefund(
    orderId: string,
    actorId: string,
    requestId: string,
  ): Promise<CommunityCancellationRequest> {
    const value = await this.store.transaction(async (store) => {
      const value =
        await store.getCommunityCancellationRequestByOrderForUpdate(orderId);
      if (!value)
        throw new BusinessError("RESOURCE_NOT_FOUND", "取消申请不存在", 404);
      if (value.status === "REFUNDING" || value.status === "REFUNDED")
        return value;
      if (value.status !== "APPROVED_WAITING_FINANCE")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "只有运营已批准的取消申请可以由财务执行退款",
          409,
        );
      const order = await store.getOrderForUpdate(orderId);
      if (!order)
        throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
      order.status = transitionOrder(order.status, "REFUNDING");
      await store.saveOrderStatus(order);
      value.status = "REFUNDING";
      value.financeExecutedBy = actorId;
      value.financeExecutedAt = this.now();
      await store.saveCommunityCancellationRequest(value);
      await this.audit(
        store,
        actorId,
        requestId,
        "COMMUNITY_CANCELLATION_FINANCE_REFUND_EXECUTED",
        value,
      );
      return value;
    });
    if (["REFUNDING", "DIRECT_REFUNDING"].includes(value.status))
      await this.payments.refundOrder(orderId);
    return value;
  }
  public async reconcileCancellationRefunds(limit = 100): Promise<number> {
    const candidates =
      await this.store.listPendingCommunityCancellationRequests(limit);
    let settled = 0;
    for (const candidate of candidates) {
      const refund = await this.store.getOrderRefundByOrder(candidate.orderId);
      if (refund?.status === "SUCCEEDED") {
        await this.store.transaction(async (store) => {
          const value =
            await store.getCommunityCancellationRequestByOrderForUpdate(
              candidate.orderId,
            );
          if (!value || value.status === "REFUNDED") return;
          value.status = "REFUNDED";
          value.refundId = refund.id;
          await store.saveCommunityCancellationRequest(value);
          await store.saveAuditLog({
            id: randomUUID(),
            actorId: "system",
            action: "COMMUNITY_CANCELLATION_REFUND_SETTLED",
            resourceType: "COMMUNITY_CANCELLATION_REQUEST",
            resourceId: value.id,
            requestId: `refund-settlement:${refund.id}`,
            beforeData: null,
            afterData: value,
            createdAt: this.now(),
          });
        });
        settled++;
      } else {
        try {
          await this.payments.refundOrder(candidate.orderId);
        } catch {
          /* payment reconciler retains the durable retry */
        }
      }
    }
    return settled;
  }
  public async extendPickup(
    orderId: string,
    actorId: string,
    deadlineAt: string,
    note: string,
    requestId: string,
  ) {
    return this.store.transaction(async (store) => {
      const window = await store.getCommunityPickupWindowForUpdate(orderId);
      if (!window)
        throw new BusinessError(
          "RESOURCE_NOT_FOUND",
          "社区领取期限不存在",
          404,
        );
      if (
        window.extensionCount >= 1 ||
        ["REFUND_PENDING", "LOSS_RECORDED", "CLOSED"].includes(window.status)
      )
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "该订单不能再次延期领取",
          409,
        );
      if (Date.parse(deadlineAt) <= Date.parse(this.now()))
        throw new BusinessError(
          "VALIDATION_ERROR",
          "延期截止时间必须晚于当前时间",
          400,
        );
      window.status = "EXTENDED";
      window.extensionCount = 1;
      window.deadlineAt = deadlineAt;
      window.extendedBy = actorId;
      window.extendedAt = this.now();
      window.dispositionNote = note;
      await store.saveCommunityPickupWindow(window);
      const credential = await store.getPickupCredential(orderId);
      if (credential?.status === "ACTIVE") {
        credential.expiresAt = deadlineAt;
        await store.savePickupCredential(credential);
      }
      await store.saveAuditLog({
        id: randomUUID(),
        actorId,
        action: "COMMUNITY_PICKUP_WINDOW_EXTENDED",
        resourceType: "COMMUNITY_PICKUP_WINDOW",
        resourceId: orderId,
        requestId,
        beforeData: null,
        afterData: window,
        createdAt: this.now(),
      });
      return window;
    });
  }
  private async completeResidualFulfilment(
    store: CommunityOperationsStore,
    orderId: string,
  ): Promise<void> {
    const order = await store.getOrderForUpdate(orderId);
    if (order?.status === "READY_FOR_PICKUP") {
      order.status = transitionOrder(order.status, "COMPLETED");
      await store.saveOrderStatus(order);
    }
  }
  public async disposeExpiredPickup(
    orderId: string,
    actorId: string,
    action: "REFUND" | "LOSS",
    note: string,
    requestId: string,
  ) {
    return this.store.transaction(async (store) => {
      const window = await store.getCommunityPickupWindowForUpdate(orderId);
      if (!window)
        throw new BusinessError(
          "RESOURCE_NOT_FOUND",
          "社区领取期限不存在",
          404,
        );
      if (window.status !== "EXPIRED_PENDING")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "只有逾期待处理订单可以执行退款或报损",
          409,
        );
      window.status = action === "REFUND" ? "REFUND_PENDING" : "LOSS_RECORDED";
      window.dispositionBy = actorId;
      window.dispositionAt = this.now();
      window.dispositionNote = note;
      const credential = await store.getPickupCredential(orderId);
      if (credential?.status === "ACTIVE") {
        credential.status = "REVOKED";
        await store.savePickupCredential(credential);
      }
      if (action === "REFUND") {
        const order = await store.getOrderForUpdate(orderId);
        if (!order)
          throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
        const lines = await store.listOrderLinesByOrderForUpdate(orderId);
        const exception: FulfillmentException = {
          id: randomUUID(),
          campaignId: order.campaignId,
          orderId: order.id,
          clientRequestId: `expired-pickup:${order.id}`,
          deliveryPlanId: order.deliveryPlanId,
          sourceStage: "CUSTOMER_CLAIM",
          status: "REFUND_CONFIRMED",
          responsibility: "PICKUP_POINT",
          registeredBy: actorId,
          confirmedBy: actorId,
          resolutionNote: note,
          registeredAt: this.now(),
          confirmedAt: this.now(),
          items: [],
        };
        const allocations: FulfillmentAllocation[] = [];
        for (const line of lines) {
          const quantity = line.fulfilledQuantity - line.pickedUpQuantity;
          if (quantity <= 0) continue;
          const item = {
            id: randomUUID(),
            exceptionId: exception.id,
            catalogSkuId: line.catalogSkuId,
            expectedQuantity: quantity,
            acceptedQuantity: 0,
            rejectedQuantity: 0,
            shortQuantity: quantity,
            damagedQuantity: 0,
            reason: "PICKUP_SHORTAGE" as const,
            description: note,
            evidenceUrl: null,
          };
          exception.items.push(item);
          allocations.push({
            id: randomUUID(),
            exceptionId: exception.id,
            exceptionItemId: item.id,
            orderLineId: line.id,
            orderId: order.id,
            catalogSkuId: line.catalogSkuId,
            fulfilledQuantity: 0,
            exceptionQuantity: quantity,
            refundedQuantity: 0,
            createdAt: this.now(),
            refundedAt: null,
          });
        }
        if (!allocations.length)
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "订单没有可退款的逾期未领取商品",
            409,
          );
        await store.saveFulfillmentException(exception);
        await store.saveFulfillmentAllocations(allocations);
        window.refundExceptionId = exception.id;
      } else {
        const order = await store.getOrderForUpdate(orderId);
        if (!order)
          throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
        const lines = await store.listOrderLinesByOrderForUpdate(orderId);
        const items = lines.flatMap((line) => {
          const quantity = line.fulfilledQuantity - line.pickedUpQuantity;
          return quantity > 0
            ? [
                {
                  id: randomUUID(),
                  exceptionId: "",
                  catalogSkuId: line.catalogSkuId,
                  expectedQuantity: quantity,
                  acceptedQuantity: 0,
                  rejectedQuantity: 0,
                  shortQuantity: quantity,
                  damagedQuantity: 0,
                  reason: "PICKUP_SHORTAGE" as const,
                  description: note,
                  evidenceUrl: null,
                },
              ]
            : [];
        });
        if (!items.length)
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "订单没有可报损的逾期未领取商品",
            409,
          );
        const loss = {
          id: randomUUID(),
          campaignId: order.campaignId,
          orderId: order.id,
          clientRequestId: `expired-pickup-loss:${order.id}`,
          deliveryPlanId: order.deliveryPlanId,
          sourceStage: "CUSTOMER_CLAIM" as const,
          status: "RESOLVED" as const,
          responsibility: "PICKUP_POINT" as const,
          registeredBy: actorId,
          confirmedBy: actorId,
          resolutionNote: note,
          registeredAt: this.now(),
          confirmedAt: this.now(),
          items: items.map((item) => ({ ...item, exceptionId: "" })),
        };
        for (const item of loss.items) item.exceptionId = loss.id;
        await store.saveFulfillmentException(loss);
        window.lossExceptionId = loss.id;
        await this.completeResidualFulfilment(store, order.id);
        window.status = "CLOSED";
      }
      await store.saveCommunityPickupWindow(window);
      await store.saveAuditLog({
        id: randomUUID(),
        actorId,
        action:
          action === "REFUND"
            ? "COMMUNITY_PICKUP_REFUND_REQUESTED"
            : "COMMUNITY_PICKUP_LOSS_RECORDED",
        resourceType: "COMMUNITY_PICKUP_WINDOW",
        resourceId: orderId,
        requestId,
        beforeData: null,
        afterData: {
          window,
          credentialRevoked: credential?.status === "REVOKED",
        },
        createdAt: this.now(),
      });
      return window;
    });
  }
  public async executeExpiredPickupRefund(
    orderId: string,
    actorId: string,
    requestId: string,
  ) {
    const window = await this.store.transaction((store) =>
      store.getCommunityPickupWindowForUpdate(orderId),
    );
    if (
      !window ||
      window.status !== "REFUND_PENDING" ||
      !window.refundExceptionId
    )
      throw new BusinessError(
        "INVALID_STATE_TRANSITION",
        "逾期退款尚未由运营登记",
        409,
      );
    await this.payments.executePartialRefund(window.refundExceptionId, {
      actorId,
      requestId,
      confirmationNote: "社区逾期未领取退款",
    });
    return this.reconcileExpiredPickupRefunds(100);
  }
  public async reconcileExpiredPickupRefunds(limit = 100): Promise<number> {
    const windows = await this.store.listCommunityPickupWindowsByStatus(
      ["REFUND_PENDING"],
      limit,
    );
    let closed = 0;
    for (const window of windows) {
      if (!window.refundExceptionId) continue;
      const refunds = await this.store.listPartialRefundsByException(
        window.refundExceptionId,
      );
      if (
        !refunds.length ||
        refunds.some((refund) => refund.status !== "SUCCEEDED")
      )
        continue;
      await this.store.transaction(async (store) => {
        const current = await store.getCommunityPickupWindowForUpdate(
          window.orderId,
        );
        if (!current || current.status !== "REFUND_PENDING") return;
        current.status = "CLOSED";
        await store.saveCommunityPickupWindow(current);
        const order = await store.getOrderForUpdate(current.orderId);
        const payment = await store.getPaymentByOrderForUpdate(current.orderId);
        const refunded = (
          await store.listPartialRefundsByOrder(current.orderId)
        )
          .filter((refund) => refund.status === "SUCCEEDED")
          .reduce((sum, refund) => sum + Number(refund.amountCents), 0);
        if (
          order?.status === "READY_FOR_PICKUP" &&
          payment &&
          refunded < Number(payment.amountCents)
        )
          await this.completeResidualFulfilment(store, current.orderId);
        await store.saveAuditLog({
          id: randomUUID(),
          actorId: "system",
          action: "COMMUNITY_PICKUP_REFUND_SETTLED",
          resourceType: "COMMUNITY_PICKUP_WINDOW",
          resourceId: current.orderId,
          requestId: `pickup-refund-settlement:${current.refundExceptionId}`,
          beforeData: null,
          afterData: current,
          createdAt: this.now(),
        });
      });
      closed++;
    }
    return closed;
  }
  /**
   * The deadline is a persisted arrival fact.  Reminder and expiry events are
   * inserted into the same durable outbox transaction, keyed by the deadline,
   * so repeated scheduler ticks neither lose nor duplicate customer contact.
   */
  public async reconcilePickupDeadlines(limit = 100): Promise<number> {
    const now = this.now();
    const reminderUntil = new Date(
      Date.parse(now) + 24 * 60 * 60000,
    ).toISOString();
    return this.store.transaction(async (store) => {
      const due = await store.listCommunityPickupWindowsDueBy(
        now,
        reminderUntil,
        limit,
      );
      for (const window of due) {
        const plan = await store.getDeliveryPlan(window.deliveryPlanId);
        if (plan)
          await this.notifications.enqueueOrder(
            store,
            "PICKUP_DEADLINE",
            window.orderId,
            plan,
            `pickup-deadline:${window.orderId}:${window.deadlineAt}`,
          );
      }
      const windows = await store.listCommunityPickupWindowsPastDeadline(
        now,
        limit,
      );
      let expired = 0;
      for (const window of windows) {
        const locked = await store.getCommunityPickupWindowForUpdate(
          window.orderId,
        );
        if (
          !locked ||
          !["ACTIVE", "EXTENDED"].includes(locked.status) ||
          locked.deadlineAt >= now
        )
          continue;
        locked.status = "EXPIRED_PENDING";
        await store.saveCommunityPickupWindow(locked);
        const plan = await store.getDeliveryPlan(locked.deliveryPlanId);
        if (plan)
          await this.notifications.enqueueOrder(
            store,
            "PICKUP_EXPIRED",
            locked.orderId,
            plan,
            `pickup-expired:${locked.orderId}:${locked.deadlineAt}`,
          );
        await store.saveAuditLog({
          id: randomUUID(),
          actorId: "system",
          action: "COMMUNITY_PICKUP_WINDOW_EXPIRED",
          resourceType: "COMMUNITY_PICKUP_WINDOW",
          resourceId: locked.orderId,
          requestId: `pickup-expired:${locked.orderId}:${locked.deadlineAt}`,
          beforeData: window,
          afterData: locked,
          createdAt: this.now(),
        });
        expired++;
      }
      return expired;
    });
  }
}
