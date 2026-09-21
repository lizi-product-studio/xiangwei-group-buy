import { randomUUID } from "node:crypto";
import { BusinessError, transitionOrder } from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";
import type { OrderRefund, PartialRefund, Payment } from "../core/types.js";
import type { LedgerService } from "../finance/ledger-service.js";
import type { NotificationService } from "../notifications/notification-service.js";
import { operationalErrorText } from "../core/operational-error.js";
import type {
  PaymentNotification,
  PaymentProvider,
  RefundNotification,
  RefundRequest,
} from "./payment-provider.js";

/** The smallest transactional capability set permitted to create a full-refund
 * obligation. It is deliberately reusable by campaign and community flows. */
export type RefundObligationStore = Pick<
  CommerceStore,
  | "getOrderForUpdate"
  | "getPaymentByOrderForUpdate"
  | "getOrderRefundByOrder"
  | "saveOrderRefund"
  | "savePaymentIfStatus"
>;

interface PartialRefundAuditContext {
  actorId: string;
  requestId: string;
  confirmationNote: string;
}
const refundLeaseMs = 5 * 60_000;
const paymentLeaseMs = 2 * 60_000;
const refundRetryBaseMs = 30_000;
const refundRecoveryLimit = 5;

export class PaymentService {
  public constructor(
    private readonly store: CommerceStore,
    private readonly provider: PaymentProvider,
    private readonly ledger: LedgerService,
    private readonly notifications?: NotificationService,
  ) {}

  public async initiate(
    orderId: string,
    userId: string,
  ): Promise<{
    provider: Payment["provider"];
    clientPayload: Record<string, string>;
    status: Payment["status"];
  }> {
    const claimToken = randomUUID();
    const now = Date.now();
    const claim = await this.store.transaction(async (store) => {
      const order = await store.getOrderForUpdate(orderId);
      if (!order || order.userId !== userId)
        throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
      if (order.status !== "PENDING_PAYMENT")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "订单当前不可发起支付",
          409,
        );
      if (Date.parse(order.expiresAt) <= now)
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "订单已过支付期限",
          409,
        );
      const existing = await store.getPaymentByOrderForUpdate(order.id);
      if (existing?.clientPayload) return { payment: existing, claimed: false };
      const payment: Payment = existing ?? {
        id: randomUUID(),
        orderId: order.id,
        provider: this.provider.name,
        providerPaymentId: null,
        status: "CREATED",
        amountCents: order.totalCents,
        clientPayload: null,
        providerContext: null,
        initiationLeaseUntil: null,
        initiationClaimToken: null,
        createdAt: new Date().toISOString(),
        succeededAt: null,
      };
      if (existing && existing.status !== "CREATED")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "支付单当前不可重新发起",
          409,
        );
      if (
        existing?.initiationLeaseUntil &&
        Date.parse(existing.initiationLeaseUntil) > now
      )
        return { payment: existing, claimed: false };
      payment.initiationLeaseUntil = new Date(
        now + paymentLeaseMs,
      ).toISOString();
      payment.initiationClaimToken = claimToken;
      await store.savePayment(payment);
      return { payment, claimed: true };
    });
    if (!claim.claimed) {
      if (claim.payment.clientPayload) return this.result(claim.payment);
      throw new BusinessError(
        "CONCURRENT_MODIFICATION",
        "支付正在创建，请稍后重试",
        409,
      );
    }
    const [order, user] = await Promise.all([
      this.store.getOrder(orderId),
      this.store.getUser(userId),
    ]);
    if (!order)
      throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
    const initiated = await this.provider.initiate(
      order,
      user?.wechatOpenId ?? null,
    );
    const saved = {
      ...claim.payment,
      providerPaymentId: initiated.providerPaymentId,
      clientPayload: initiated.clientPayload,
      providerContext: initiated.providerContext,
      initiationLeaseUntil: null,
      initiationClaimToken: null,
    };
    if (!(await this.store.savePaymentIfInitiationClaimed(saved, claimToken)))
      throw new BusinessError(
        "CONCURRENT_MODIFICATION",
        "支付创建结果已被其他请求接管",
        409,
      );
    return this.result(saved);
  }

  public async confirmMock(orderId: string, userId: string): Promise<void> {
    if (this.provider.name !== "mock")
      throw new BusinessError("FORBIDDEN", "当前环境未启用模拟支付", 403);
    await this.store.transaction(async (store) => {
      const order = await store.getOrderForUpdate(orderId);
      if (!order || order.userId !== userId)
        throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
      let payment = await store.getPaymentByOrderForUpdate(orderId);
      if (!payment) {
        payment = {
          id: randomUUID(),
          orderId,
          provider: "mock",
          providerPaymentId: null,
          status: "CREATED",
          amountCents: order.totalCents,
          clientPayload: { mock: "true" },
          providerContext: { outTradeNo: order.orderNo },
          initiationLeaseUntil: null,
          initiationClaimToken: null,
          createdAt: new Date().toISOString(),
          succeededAt: null,
        };
        await store.savePayment(payment);
      }
      await this.completePayment(
        store,
        order,
        payment,
        `MOCK-${order.orderNo}`,
      );
    });
  }

  public async handleNotification(
    notification: PaymentNotification,
  ): Promise<void> {
    await this.store.transaction(async (store) => {
      if (
        !(await store.claimPaymentCallback(
          notification.eventId,
          notification.bodyHash,
        ))
      )
        return;
      if (notification.type !== "TRANSACTION.SUCCESS") return;
      const order = await store.getOrderByNoForUpdate(notification.orderNo);
      if (!order)
        throw new BusinessError(
          "RESOURCE_NOT_FOUND",
          "支付回调订单不存在",
          404,
        );
      const payment = await store.getPaymentByOrderForUpdate(order.id);
      if (!payment)
        throw new BusinessError("RESOURCE_NOT_FOUND", "支付单不存在", 404);
      if (Number(payment.amountCents) !== notification.amountCents)
        throw new BusinessError(
          "FINANCIAL_INCONSISTENT",
          "支付回调金额不一致",
          409,
        );
      await this.completePayment(
        store,
        order,
        payment,
        notification.providerPaymentId,
      );
    });
  }

  public async refundOrder(orderId: string): Promise<void> {
    const refund = await this.store.transaction((store) =>
      this.ensureOrderRefundIntent(store, orderId),
    );
    if (
      refund &&
      ["CREATED", "RETRYABLE_FAILURE", "FAILED"].includes(refund.status)
    )
      await this.submitOrderRefund(refund);
    if (refund) await this.finalizeOrderRefund(refund.orderId);
  }

  /**
   * The durable obligation is written in the same transaction that places an
   * order in REFUNDING. Network submission is deliberately outside it.
   */
  public async ensureOrderRefundIntent(
    store: RefundObligationStore,
    orderId: string,
  ): Promise<OrderRefund | null> {
    {
      const order = await store.getOrderForUpdate(orderId);
      if (!order)
        throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
      if (order.status === "REFUNDED") return null;
      if (order.status !== "REFUNDING")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "订单当前不可退款",
          409,
        );
      const payment = await store.getPaymentByOrderForUpdate(orderId);
      if (!payment || !["SUCCEEDED", "REFUNDING"].includes(payment.status))
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "订单没有可退款的成功支付",
          409,
        );
      if (payment.status === "SUCCEEDED") {
        payment.status = "REFUNDING";
        if (!(await store.savePaymentIfStatus(payment, ["SUCCEEDED"])))
          return store.getOrderRefundByOrder(orderId);
      }
      const existing = await store.getOrderRefundByOrder(orderId);
      if (existing) return existing;
      const created: OrderRefund = {
        id: randomUUID(),
        orderId,
        paymentId: payment.id,
        providerRefundNo: `RF${order.orderNo}`.slice(0, 64),
        providerRefundId: null,
        status: "CREATED",
        amountCents: order.totalCents,
        createdAt: new Date().toISOString(),
        submissionLeaseUntil: null,
        submissionClaimToken: null,
        submissionAttempts: 0,
        queryAttempts: 0,
        nextAttemptAt: new Date().toISOString(),
        lastError: null,
        manualHoldReason: null,
        recoveryVersion: 0,
        recoveryAttempts: 0,
      };
      await store.saveOrderRefund(created);
      return created;
    }
  }
  public async requestFullRefund(orderId: string): Promise<void> {
    const refund = await this.store.transaction(async (store) => {
      const order = await store.getOrderForUpdate(orderId);
      if (!order)
        throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
      if (order.status !== "REFUNDING") {
        order.status = transitionOrder(order.status, "REFUNDING");
        await store.saveOrderStatus(order);
      }
      return this.ensureOrderRefundIntent(store, orderId);
    });
    if (refund && ["CREATED", "RETRYABLE_FAILURE", "FAILED"].includes(refund.status))
      await this.submitOrderRefund(refund);
    if (refund) await this.finalizeOrderRefund(orderId);
  }

  public async executePartialRefund(
    exceptionId: string,
    audit?: PartialRefundAuditContext,
  ): Promise<void> {
    const refunds = await this.store.transaction(async (store) => {
      const exception =
        await store.getFulfillmentExceptionForUpdate(exceptionId);
      if (
        !exception ||
        !["REFUND_CONFIRMED", "REFUND_PROCESSING", "RESOLVED"].includes(
          exception.status,
        )
      )
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "异常尚未由运营确认退款",
          409,
        );
      const allocations = (
        await store.listFulfillmentAllocations(exception.id)
      ).filter((value) => value.exceptionQuantity > value.refundedQuantity);
      if (!allocations.length) {
        if (exception.status === "REFUND_CONFIRMED") throw new BusinessError("FINANCIAL_INCONSISTENT", "退款分配事实缺失，暂不可执行退款", 409);
        return [];
      }
      const created: PartialRefund[] = [];
      const byOrder = new Map<string, typeof allocations>();
      for (const allocation of allocations) {
        const values = byOrder.get(allocation.orderId) ?? [];
        values.push(allocation);
        byOrder.set(allocation.orderId, values);
      }
      for (const [orderId, values] of byOrder) {
        const [order, payment] = await Promise.all([
          store.getOrderForUpdate(orderId),
          store.getPaymentByOrderForUpdate(orderId),
        ]);
        if (!order || !payment || payment.status !== "SUCCEEDED")
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "异常订单没有可退款的成功支付",
            409,
          );
        const amount = values.reduce((sum, value) => {
          const line = order.items.find(
            (item) => item.orderLineId === value.orderLineId,
          );
          return (
            sum +
            (line
              ? Number(line.unitPriceCents) *
                (value.exceptionQuantity - value.refundedQuantity)
              : NaN)
          );
        }, 0);
        if (!Number.isSafeInteger(amount) || amount <= 0)
          throw new BusinessError(
            "FINANCIAL_INCONSISTENT",
            "退款金额无法从订单快照计算",
            500,
          );
        const existing = (
          await store.listPartialRefundsByException(exception.id)
        ).find((value) => value.orderId === orderId);
        if (existing) {
          if (Number(existing.amountCents) !== amount)
            throw new BusinessError(
              "FINANCIAL_INCONSISTENT",
              "同一异常退款金额发生变化",
              500,
            );
          created.push(existing);
          continue;
        }
        const already = (await store.listPartialRefundsByOrder(orderId))
          .filter((value) => value.status !== "FAILED")
          .reduce((sum, value) => sum + Number(value.amountCents), 0);
        if (already + amount > Number(payment.amountCents))
          throw new BusinessError(
            "REFUND_AMOUNT_EXCEEDED",
            "累计退款不能超过实付金额",
            409,
          );
        const value: PartialRefund = {
          id: randomUUID(),
          exceptionId: exception.id,
          orderId,
          paymentId: payment.id,
          providerRefundNo:
            `PR${exception.id.replaceAll("-", "").slice(0, 20)}${order.orderNo}`.slice(
              0,
              64,
            ),
          providerRefundId: null,
          status: "CREATED",
          amountCents: amount as PartialRefund["amountCents"],
          createdAt: new Date().toISOString(),
          submissionLeaseUntil: null,
          submissionClaimToken: null,
          submissionAttempts: 0,
          queryAttempts: 0,
          nextAttemptAt: new Date().toISOString(),
          lastError: null,
          manualHoldReason: null,
          recoveryVersion: 0,
          recoveryAttempts: 0,
        };
        await store.savePartialRefund(value);
        created.push(value);
      }
      exception.status = "REFUND_PROCESSING";
      await store.saveFulfillmentException(exception);
      if (audit && created.some((value) => value.status === "CREATED"))
        await store.saveAuditLog({
          id: randomUUID(),
          actorId: audit.actorId,
          action: "PARTIAL_REFUND_EXECUTED",
          resourceType: "FULFILLMENT_EXCEPTION",
          resourceId: exception.id,
          requestId: audit.requestId,
          beforeData: null,
          afterData: {
            refunds: created,
            confirmationNote: audit.confirmationNote,
          },
          createdAt: new Date().toISOString(),
        });
      return created;
    });
    for (const refund of refunds) {
      if (["CREATED", "RETRYABLE_FAILURE", "FAILED"].includes(refund.status))
        await this.submitPartialRefund(refund);
      await this.finalizePartialRefund(refund.id);
    }
  }

  public async handleRefundNotification(
    notification: RefundNotification,
  ): Promise<void> {
    let orderRefundId: string | null = null;
    let partialRefundId: string | null = null;
    await this.store.transaction(async (store) => {
      if (
        !(await store.claimPaymentCallback(
          notification.eventId,
          notification.bodyHash,
        ))
      )
        return;
      const full = await store.getOrderRefundByProviderNo(
        notification.providerRefundNo,
      );
      if (full) {
        if (
          await store.saveOrderRefundIfStatus(
            {
              ...full,
              providerRefundId: notification.providerRefundId,
              status: notification.status,
              submissionLeaseUntil: null,
              submissionClaimToken: null,
            },
            [
              "CREATED",
              "SUBMISSION_UNKNOWN",
              "PROCESSING",
              "RETRYABLE_FAILURE",
              "MANUAL_HOLD",
              "FAILED",
            ],
          )
        )
          orderRefundId = full.orderId;
        return;
      }
      const partial = await store.getPartialRefundByProviderNo(
        notification.providerRefundNo,
      );
      if (
        partial &&
        (await store.savePartialRefundIfStatus(
          {
            ...partial,
            providerRefundId: notification.providerRefundId,
            status: notification.status,
            submissionLeaseUntil: null,
            submissionClaimToken: null,
          },
          [
            "CREATED",
            "SUBMISSION_UNKNOWN",
            "PROCESSING",
            "RETRYABLE_FAILURE",
            "MANUAL_HOLD",
            "FAILED",
          ],
        ))
      )
        partialRefundId = partial.id;
    });
    if (orderRefundId) await this.finalizeOrderRefund(orderRefundId);
    if (partialRefundId) await this.finalizePartialRefund(partialRefundId);
  }
  public async reconcileRefunds(
    limit = 100,
  ): Promise<{ recovered: number; failed: number }> {
    let recovered = 0;
    let failed = 0;
    // Compensate historical/crash-created REFUNDING orders before processing
    // submission work. The stable order refund number makes this idempotent.
    for (const order of await this.store.listRefundingOrders(limit)) {
      try {
        const intent = await this.store.transaction((store) =>
          this.ensureOrderRefundIntent(store, order.id),
        );
        if (intent?.status === "CREATED") await this.submitOrderRefund(intent);
        recovered++;
      } catch {
        // The refund record already contains the recovery error and retry
        // schedule; continue so one provider fault cannot block startup.
        failed++;
      }
    }
    for (const refund of await this.store.listPendingOrderRefunds(limit)) {
      try {
        await this.reconcileOrderRefund(refund);
        await this.finalizeOrderRefund(refund.orderId);
        recovered++;
      } catch {
        failed++;
      }
    }
    for (const refund of await this.store.listPendingPartialRefunds(limit)) {
      try {
        await this.reconcilePartialRefund(refund);
        await this.finalizePartialRefund(refund.id);
        recovered++;
      } catch {
        failed++;
      }
    }
    return { recovered, failed };
  }

  private async completePayment(
    store: CommerceStore,
    order: Awaited<ReturnType<CommerceStore["getOrderForUpdate"]>> & {},
    payment: Payment,
    providerPaymentId: string,
  ): Promise<void> {
    if (["SUCCEEDED", "REFUNDING", "REFUNDED"].includes(payment.status)) {
      if (payment.providerPaymentId !== providerPaymentId)
        throw new BusinessError("FINANCIAL_INCONSISTENT", "支付机构交易号不一致", 409);
      return;
    }
    // Cancellation has already released inventory. A verified late success is
    // money owed back, never a reason to reopen fulfillment or reserve stock.
    if (order.status === "CANCELLED") {
      const paidAt = new Date().toISOString();
      payment.status = "SUCCEEDED";
      payment.providerPaymentId = providerPaymentId;
      payment.succeededAt = paidAt;
      payment.initiationLeaseUntil = null;
      payment.initiationClaimToken = null;
      if (!(await store.savePaymentIfStatus(payment, ["CREATED", "FAILED"])))
        throw new BusinessError("CONCURRENT_MODIFICATION", "支付单状态已变化", 409);
      order.status = transitionOrder(order.status, "REFUNDING");
      order.paidAt = paidAt;
      await store.saveOrderStatus(order);
      await this.ledger.recordPayment(store, order);
      await this.ensureOrderRefundIntent(store, order.id);
      return;
    }
    if (order.status !== "PENDING_PAYMENT")
      throw new BusinessError(
        "INVALID_STATE_TRANSITION",
        "订单当前不能确认支付",
        409,
      );
    const paidAt = new Date().toISOString();
    if (!(await store.markPendingOrderPaid(order.id, paidAt)))
      throw new BusinessError(
        "CONCURRENT_MODIFICATION",
        "订单支付与取消或截单发生竞争",
        409,
      );
    payment.status = "SUCCEEDED";
    payment.providerPaymentId = providerPaymentId;
    payment.succeededAt = paidAt;
    payment.initiationLeaseUntil = null;
    payment.initiationClaimToken = null;
    if (!(await store.savePaymentIfStatus(payment, ["CREATED"])))
      throw new BusinessError(
        "CONCURRENT_MODIFICATION",
        "支付单状态已变化",
        409,
      );
    order.status = "PAID_WAITING_CLOSE";
    order.paidAt = paidAt;
    await this.ledger.recordPayment(store, order);
  }
  private result(payment: Payment) {
    return {
      provider: payment.provider,
      clientPayload: payment.clientPayload ?? {},
      status: payment.status,
    };
  }
  private async refundRequest(
    refund: OrderRefund | PartialRefund,
  ): Promise<RefundRequest> {
    const [order, payment] = await Promise.all([
      this.store.getOrder(refund.orderId),
      this.store.getPaymentByOrder(refund.orderId),
    ]);
    if (!order || !payment)
      throw new BusinessError(
        "RESOURCE_NOT_FOUND",
        "退款关联订单或支付单不存在",
        404,
      );
    return {
      providerRefundNo: refund.providerRefundNo,
      outTradeNo: order.orderNo,
      amountCents: Number(refund.amountCents),
      totalCents: Number(payment.amountCents),
    };
  }
  private async submitOrderRefund(refund: OrderRefund): Promise<void> {
    if (!this.isDue(refund)) return;
    if (this.isExhausted(refund.recoveryAttempts ?? 0)) {
      await this.store.saveOrderRefundIfUnclaimed(
        this.toManualHold(refund),
        new Date().toISOString(),
      );
      return;
    }
    const token = randomUUID();
    const now = Date.now();
    if (
      !(await this.store.claimOrderRefundSubmission(
        refund.id,
        new Date(now + refundLeaseMs).toISOString(),
        new Date(now).toISOString(),
        token,
      ))
    )
      return;
    let result;
    try {
      result = await this.provider.refund(await this.refundRequest(refund));
    } catch (error) {
      // Submission is ambiguous: provider may have accepted the stable
      // out-refund number and lost the response. Query it before any retry.
      await this.store.saveOrderRefundIfClaimed(
        this.afterSubmissionError(refund, error),
        token,
      );
      throw error;
    }
    await this.store.saveOrderRefundIfClaimed(
      this.afterSubmissionResult(refund, result),
      token,
    );
  }
  private async submitPartialRefund(refund: PartialRefund): Promise<void> {
    if (!this.isDue(refund)) return;
    if (this.isExhausted(refund.recoveryAttempts ?? 0)) {
      await this.store.savePartialRefundIfUnclaimed(
        this.toManualHold(refund),
        new Date().toISOString(),
      );
      return;
    }
    const token = randomUUID();
    const now = Date.now();
    if (
      !(await this.store.claimPartialRefundSubmission(
        refund.id,
        new Date(now + refundLeaseMs).toISOString(),
        new Date(now).toISOString(),
        token,
      ))
    )
      return;
    let result;
    try {
      result = await this.provider.refund(await this.refundRequest(refund));
    } catch (error) {
      await this.store.savePartialRefundIfClaimed(
        this.afterSubmissionError(refund, error),
        token,
      );
      throw error;
    }
    await this.store.savePartialRefundIfClaimed(
      this.afterSubmissionResult(refund, result),
      token,
    );
  }
  private async reconcileOrderRefund(refund: OrderRefund): Promise<void> {
    if (this.isExhausted(refund.recoveryAttempts ?? 0)) {
      await this.store.saveOrderRefundIfUnclaimed(
        this.toManualHold(refund),
        new Date().toISOString(),
      );
      return;
    }
    if (
      ["CREATED", "RETRYABLE_FAILURE", "FAILED"].includes(refund.status)
    ) {
      await this.submitOrderRefund(refund);
      return;
    }
    await this.queryOrderRefund(refund);
  }
  private async reconcilePartialRefund(refund: PartialRefund): Promise<void> {
    if (this.isExhausted(refund.recoveryAttempts ?? 0)) {
      await this.store.savePartialRefundIfUnclaimed(
        this.toManualHold(refund),
        new Date().toISOString(),
      );
      return;
    }
    if (
      ["CREATED", "RETRYABLE_FAILURE", "FAILED"].includes(refund.status)
    ) {
      await this.submitPartialRefund(refund);
      return;
    }
    await this.queryPartialRefund(refund);
  }
  private isDue(refund: OrderRefund | PartialRefund): boolean {
    return !refund.nextAttemptAt || Date.parse(refund.nextAttemptAt) <= Date.now();
  }
  private nextAttempt(attempt: number): string {
    return new Date(
      Date.now() + refundRetryBaseMs * 2 ** Math.min(attempt, 4),
    ).toISOString();
  }
  private providerStatus(status: "PROCESSING" | "SUCCEEDED" | "FAILED") {
    return status === "FAILED" ? "RETRYABLE_FAILURE" : status;
  }
  private nextRecoveryCount(refund: OrderRefund | PartialRefund): number {
    return (
      refund.recoveryAttempts ??
      (refund.submissionAttempts ?? 0) + (refund.queryAttempts ?? 0)
    ) + 1;
  }
  private isExhausted(recoveryAttempts: number): boolean {
    return recoveryAttempts >= refundRecoveryLimit;
  }
  private toManualHold<T extends OrderRefund | PartialRefund>(refund: T): T {
    return {
      ...refund,
      status: "MANUAL_HOLD",
      submissionLeaseUntil: null,
      submissionClaimToken: null,
      nextAttemptAt: null,
      manualHoldReason: "退款自动恢复次数已达上限，等待人工处理",
    } as T;
  }
  private errorText(error: unknown): string {
    return operationalErrorText(error);
  }
  private afterSubmissionError<T extends OrderRefund | PartialRefund>(
    refund: T,
    error: unknown,
  ): T {
    const attempts = (refund.submissionAttempts ?? 0) + 1;
    const recoveryAttempts = this.nextRecoveryCount(refund);
    return {
      ...refund,
      status: this.isExhausted(recoveryAttempts)
        ? "MANUAL_HOLD"
        : "SUBMISSION_UNKNOWN",
      submissionLeaseUntil: null,
      submissionClaimToken: null,
      submissionAttempts: attempts,
      recoveryAttempts,
      nextAttemptAt: this.nextAttempt(attempts),
      lastError: this.errorText(error),
      manualHoldReason:
        this.isExhausted(recoveryAttempts)
          ? "退款自动恢复次数已达上限，等待人工处理"
          : null,
    } as T;
  }
  private afterSubmissionResult<T extends OrderRefund | PartialRefund>(
    refund: T,
    result: { providerRefundId: string | null; status: "PROCESSING" | "SUCCEEDED" | "FAILED" },
  ): T {
    const submissionAttempts = (refund.submissionAttempts ?? 0) + 1;
    const recoveryAttempts = this.nextRecoveryCount(refund);
    const exhausted = result.status !== "SUCCEEDED" && this.isExhausted(recoveryAttempts);
    return {
      ...refund,
      providerRefundId: result.providerRefundId,
      status: exhausted
        ? "MANUAL_HOLD"
        : this.providerStatus(result.status),
      submissionLeaseUntil: null,
      submissionClaimToken: null,
      submissionAttempts,
      recoveryAttempts,
      nextAttemptAt:
        result.status === "FAILED" && !exhausted
          ? this.nextAttempt(recoveryAttempts)
          : null,
      lastError: result.status === "FAILED" ? "provider returned FAILED" : null,
      manualHoldReason: exhausted
        ? "退款自动恢复次数已达上限，等待人工处理"
        : null,
    } as T;
  }
  private async queryOrderRefund(refund: OrderRefund): Promise<void> {
    if (!this.isDue(refund)) return;
    try {
      const result = await this.provider.queryRefund({ providerRefundNo: refund.providerRefundNo });
      const queries = (refund.queryAttempts ?? 0) + 1;
      const recoveryAttempts = this.nextRecoveryCount(refund);
      const exhausted = this.isExhausted(recoveryAttempts);
      const next: Pick<
        OrderRefund,
        "status" | "providerRefundId" | "lastError" | "nextAttemptAt" | "manualHoldReason"
      > = "kind" in result
        ? { status: exhausted ? "MANUAL_HOLD" : "RETRYABLE_FAILURE", providerRefundId: null, lastError: "provider refund not found", nextAttemptAt: exhausted ? null : this.nextAttempt(recoveryAttempts), manualHoldReason: exhausted ? "退款自动恢复次数已达上限，等待人工处理" : null }
        : { status: result.status === "SUCCEEDED" ? "SUCCEEDED" : exhausted ? "MANUAL_HOLD" : this.providerStatus(result.status), providerRefundId: result.providerRefundId, lastError: result.status === "FAILED" ? "provider returned FAILED" : null, nextAttemptAt: result.status === "SUCCEEDED" || exhausted ? null : this.nextAttempt(recoveryAttempts), manualHoldReason: exhausted ? "退款自动恢复次数已达上限，等待人工处理" : null };
      await this.store.saveOrderRefundIfUnclaimed({ ...refund, ...next, queryAttempts: queries, recoveryAttempts, submissionLeaseUntil: null, submissionClaimToken: null }, new Date().toISOString());
    } catch (error) {
      await this.recordOrderQueryError(refund, error);
    }
  }
  private async queryPartialRefund(refund: PartialRefund): Promise<void> {
    if (!this.isDue(refund)) return;
    try {
      const result = await this.provider.queryRefund({ providerRefundNo: refund.providerRefundNo });
      const queries = (refund.queryAttempts ?? 0) + 1;
      const recoveryAttempts = this.nextRecoveryCount(refund);
      const exhausted = this.isExhausted(recoveryAttempts);
      const next: Pick<
        PartialRefund,
        "status" | "providerRefundId" | "lastError" | "nextAttemptAt" | "manualHoldReason"
      > = "kind" in result
        ? { status: exhausted ? "MANUAL_HOLD" : "RETRYABLE_FAILURE", providerRefundId: null, lastError: "provider refund not found", nextAttemptAt: exhausted ? null : this.nextAttempt(recoveryAttempts), manualHoldReason: exhausted ? "退款自动恢复次数已达上限，等待人工处理" : null }
        : { status: result.status === "SUCCEEDED" ? "SUCCEEDED" : exhausted ? "MANUAL_HOLD" : this.providerStatus(result.status), providerRefundId: result.providerRefundId, lastError: result.status === "FAILED" ? "provider returned FAILED" : null, nextAttemptAt: result.status === "SUCCEEDED" || exhausted ? null : this.nextAttempt(recoveryAttempts), manualHoldReason: exhausted ? "退款自动恢复次数已达上限，等待人工处理" : null };
      await this.store.savePartialRefundIfUnclaimed({ ...refund, ...next, queryAttempts: queries, recoveryAttempts, submissionLeaseUntil: null, submissionClaimToken: null }, new Date().toISOString());
    } catch (error) {
      await this.recordPartialQueryError(refund, error);
    }
  }
  private async recordOrderQueryError(refund: OrderRefund, error: unknown) {
    const queries = (refund.queryAttempts ?? 0) + 1;
    const recoveryAttempts = this.nextRecoveryCount(refund);
    const exhausted = this.isExhausted(recoveryAttempts);
    await this.store.saveOrderRefundIfUnclaimed({ ...refund, status: exhausted ? "MANUAL_HOLD" : "SUBMISSION_UNKNOWN", queryAttempts: queries, recoveryAttempts, nextAttemptAt: exhausted ? null : this.nextAttempt(recoveryAttempts), lastError: this.errorText(error), manualHoldReason: exhausted ? "退款自动恢复次数已达上限，等待人工处理" : null }, new Date().toISOString());
  }
  private async recordPartialQueryError(refund: PartialRefund, error: unknown) {
    const queries = (refund.queryAttempts ?? 0) + 1;
    const recoveryAttempts = this.nextRecoveryCount(refund);
    const exhausted = this.isExhausted(recoveryAttempts);
    await this.store.savePartialRefundIfUnclaimed({ ...refund, status: exhausted ? "MANUAL_HOLD" : "SUBMISSION_UNKNOWN", queryAttempts: queries, recoveryAttempts, nextAttemptAt: exhausted ? null : this.nextAttempt(recoveryAttempts), lastError: this.errorText(error), manualHoldReason: exhausted ? "退款自动恢复次数已达上限，等待人工处理" : null }, new Date().toISOString());
  }
  private async finalizeOrderRefund(orderId: string): Promise<void> {
    await this.store.transaction(async (store) => {
      const refund = await store.getOrderRefundByOrder(orderId);
      if (!refund || refund.status !== "SUCCEEDED") return;
      const [order, payment] = await Promise.all([
        store.getOrderForUpdate(orderId),
        store.getPaymentByOrderForUpdate(orderId),
      ]);
      if (!order || !payment) return;
      if (order.status === "REFUNDING") {
        order.status = transitionOrder(order.status, "REFUNDED");
        await store.saveOrderStatus(order);
        await this.ledger.recordRefund(store, order);
      }
      if (payment.status === "REFUNDING") {
        payment.status = "REFUNDED";
        await store.savePaymentIfStatus(payment, ["REFUNDING"]);
      }
    });
  }
  private async finalizePartialRefund(refundId: string): Promise<void> {
    await this.store.transaction(async (store) => {
      const refund = await store.getPartialRefund(refundId);
      if (!refund || refund.status !== "SUCCEEDED") return;
      const exception = await store.getFulfillmentExceptionForUpdate(
        refund.exceptionId,
      );
      if (!exception) return;
      if (
        !(await store.markFulfillmentAllocationsRefunded(
          exception.id,
          refund,
          new Date().toISOString(),
        ))
      )
        return;
      await this.ledger.recordPartialRefund(store, exception, refund);
      const order = await store.getOrderForUpdate(refund.orderId);
      const plan = order
        ? await store.getDeliveryPlan(order.deliveryPlanId)
        : null;
      if (order && plan && this.notifications)
        await this.notifications.enqueueOrder(
          store,
          "PARTIAL_REFUND",
          order.id,
          plan,
          `partial-refund:${refund.id}`,
          refund.id,
        );
      if (
        !(await store.listFulfillmentAllocations(exception.id)).some(
          (value) => value.exceptionQuantity > value.refundedQuantity,
        )
      ) {
        exception.status = "RESOLVED";
        await store.saveFulfillmentException(exception);
      }
      const payment = order
        ? await store.getPaymentByOrderForUpdate(order.id)
        : null;
      const refunded = order
        ? (await store.listPartialRefundsByOrder(order.id))
            .filter((value) => value.status === "SUCCEEDED")
            .reduce((sum, value) => sum + Number(value.amountCents), 0)
        : 0;
      if (
        order &&
        payment &&
        refunded === Number(payment.amountCents) &&
        order.status !== "REFUNDED"
      ) {
        if (order.status !== "REFUNDING") {
          order.status = transitionOrder(order.status, "REFUNDING");
          await store.saveOrderStatus(order);
        }
        order.status = transitionOrder(order.status, "REFUNDED");
        await store.saveOrderStatus(order);
        if (payment.status === "SUCCEEDED") {
          payment.status = "REFUNDING";
          await store.savePaymentIfStatus(payment, ["SUCCEEDED"]);
          payment.status = "REFUNDED";
          await store.savePaymentIfStatus(payment, ["REFUNDING"]);
        }
      }
    });
  }
}
