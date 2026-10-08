import { createHash, randomUUID } from "node:crypto";
import { BusinessError, transitionOrder } from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";
import type { Order, OrderRefund, PartialRefund, Payment, PaymentBatch, RefundRecoveryFields } from "../core/types.js";
import type { LedgerService } from "../finance/ledger-service.js";
import type { NotificationService } from "../notifications/notification-service.js";
import { completeCampaignIfSettled } from "../fulfillment/campaign-completion.js";
import { operationalErrorText } from "../core/operational-error.js";
import type {
  PaymentNotification,
  PaymentProvider,
  ProviderRefundStatus,
  RefundNotification,
  RefundRequest,
} from "./payment-provider.js";

/** The smallest transactional capability set permitted to create a full-refund
 * obligation. It is deliberately reusable by campaign and community flows. */
export type RefundObligationStore = Pick<
  CommerceStore,
  | "getOrderForUpdate"
  | "getPaymentByOrderForUpdate"
  | "getCheckoutBatchForUpdate"
  | "getOrderRefundByOrder"
  | "listPartialRefundsByOrder"
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
const exhaustedProcessingInstruction = "退款机构仍在处理中（PROCESSING），自动恢复次数已达上限；请继续人工查询，勿重复提交";

export class PaymentService {
  public constructor(
    private readonly store: CommerceStore,
    private readonly provider: PaymentProvider,
    private readonly ledger: LedgerService,
    private readonly notifications?: NotificationService,
  ) {}

  /**
   * Close and reconcile the provider transaction before releasing a pending
   * order's inventory. Returns true when the provider confirms payment and
   * the normal callback path has moved the order forward.
   */
  public async reconcileBeforeCancellation(orderId: string, userId: string): Promise<boolean> {
    const order = await this.store.getOrder(orderId);
    if (!order || order.userId !== userId)
      throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
    if (order.status !== "PENDING_PAYMENT") return order.status !== "CANCELLED";

    const checkout = await this.store.getCheckoutBatchByOrder(orderId);
    const batchPayment = checkout ? await this.store.getPaymentBatchByCheckoutBatch(checkout.id) : null;
    const payment = checkout ? null : await this.store.getPaymentByOrder(orderId);
    if (checkout && checkout.status !== "PENDING_PAYMENT") return checkout.status === "PAID";
    if (!batchPayment && !payment) return false;

    const databaseNow = Date.parse(await this.store.databaseNow());
    const inFlight = batchPayment
      ? Boolean(batchPayment.initiationClaimToken && !batchPayment.clientPayload && batchPayment.initiationLeaseUntil && Date.parse(batchPayment.initiationLeaseUntil) > databaseNow)
      : Boolean(payment?.initiationClaimToken && !payment.clientPayload && payment.initiationLeaseUntil && Date.parse(payment.initiationLeaseUntil) > databaseNow);
    if (inFlight)
      throw new BusinessError("CONCURRENT_MODIFICATION", "支付凭据仍在创建，请稍后刷新订单再取消", 409);

    if (!this.provider.queryPayment || !this.provider.closePayment)
      throw new BusinessError("INVALID_STATE_TRANSITION", "当前支付渠道暂不支持安全关单，请联系平台处理", 503);

    const outTradeNo = checkout?.outTradeNo ?? order.orderNo;
    let providerState = await this.provider.queryPayment({ outTradeNo });
    if (providerState.status === "SUCCEEDED" || providerState.status === "REFUNDING") {
      await this.handleNotification({
        eventId: `cancel-reconcile-${randomUUID()}`,
        type: "TRANSACTION.SUCCESS",
        orderNo: outTradeNo,
        providerPaymentId: providerState.providerPaymentId,
        amountCents: providerState.amountCents,
        bodyHash: createHash("sha256").update(`${outTradeNo}:${providerState.providerPaymentId}:${providerState.amountCents}`).digest("hex"),
      });
      return true;
    }
    if (!["CLOSED", "REVOKED", "NOT_FOUND"].includes(providerState.status)) {
      // A close error is ambiguous: a second provider query is the only safe
      // way to decide whether inventory can be released.
      try { await this.provider.closePayment({ outTradeNo }); } catch { /* reconcile below */ }
      providerState = await this.provider.queryPayment({ outTradeNo });
    }
    if (providerState.status === "SUCCEEDED" || providerState.status === "REFUNDING") {
      await this.handleNotification({
        eventId: `cancel-reconcile-${randomUUID()}`,
        type: "TRANSACTION.SUCCESS",
        orderNo: outTradeNo,
        providerPaymentId: providerState.providerPaymentId,
        amountCents: providerState.amountCents,
        bodyHash: createHash("sha256").update(`${outTradeNo}:${providerState.providerPaymentId}:${providerState.amountCents}`).digest("hex"),
      });
      return true;
    }
    if (!["CLOSED", "REVOKED", "NOT_FOUND"].includes(providerState.status))
      throw new BusinessError("CONCURRENT_MODIFICATION", "支付渠道尚未确认关单，订单库存保持占用，请稍后重试", 409);
    return false;
  }

  /** Expiry uses the same close/query gate as a consumer cancellation. Any
   * provider ambiguity leaves both the order and its reserved inventory intact. */
  public async expirePendingOrders(cancel: (orderId: string, userId: string) => Promise<unknown>, limit = 100): Promise<{ expired: number; failed: number }> {
    const now = await this.store.databaseNow();
    let expired = 0;
    let failed = 0;
    for (const order of await this.store.listExpiredPendingOrders(now, limit)) {
      try {
        if (await this.reconcileBeforeCancellation(order.id, order.userId)) continue;
        await cancel(order.id, order.userId);
        expired += 1;
      } catch {
        failed += 1;
      }
    }
    return { expired, failed };
  }

  public async initiate(
    orderId: string,
    userId: string,
  ): Promise<{
    provider: Payment["provider"];
    clientPayload: Record<string, string>;
    status: Payment["status"];
  }> {
    const checkoutBatch = await this.store.getCheckoutBatchByOrder(orderId);
    if (checkoutBatch) return this.initiateBatch(checkoutBatch.id, userId);
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
      if (this.provider.name === "wechat" && Date.parse(order.expiresAt) - now <= 60_000)
        throw new BusinessError("INVALID_STATE_TRANSITION", "剩余支付时间不足，无法安全发起微信支付；请取消当前订单后重新下单", 409);
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
    let initiated: Awaited<ReturnType<PaymentProvider["initiate"]>>;
    try {
      initiated = await this.provider.initiate(order, user?.wechatOpenId ?? null);
    } catch (error) {
      // The provider rejects this local preflight before any network request.
      // Clear only our own claim so the consumer can safely cancel/retry.
      if (this.provider.name === "wechat" && error instanceof BusinessError && error.message === "订单剩余支付时间不足，请重新下单")
        await this.store.savePaymentIfInitiationClaimed({ ...claim.payment, initiationLeaseUntil: null, initiationClaimToken: null }, claimToken);
      throw error;
    }
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

  public async initiateBatch(checkoutBatchId: string, userId: string): Promise<{
    provider: Payment["provider"];
    clientPayload: Record<string, string>;
    status: Payment["status"];
  }> {
    const claimToken = randomUUID();
    const now = Date.now();
    const claim = await this.store.transaction(async (store) => {
      const checkout = await store.getCheckoutBatchForUpdate(checkoutBatchId);
      if (!checkout || checkout.userId !== userId)
        throw new BusinessError("RESOURCE_NOT_FOUND", "结算批次不存在", 404);
      if (checkout.status !== "PENDING_PAYMENT" || Date.parse(checkout.expiresAt) <= now)
        throw new BusinessError("INVALID_STATE_TRANSITION", "结算批次已过期或不可支付", 409);
      const orders = await Promise.all(checkout.orderIds.map((id) => store.getOrderForUpdate(id)));
      if (orders.some((order) => !order || order.userId !== userId || order.status !== "PENDING_PAYMENT" || Date.parse(order.expiresAt) <= now))
        throw new BusinessError("INVALID_STATE_TRANSITION", "结算中的订单已变化或过期", 409);
      const totalCents = orders.reduce((sum, order) => sum + Number(order!.totalCents), 0);
      if (totalCents !== Number(checkout.totalCents))
        throw new BusinessError("FINANCIAL_INCONSISTENT", "结算批次金额与子订单不一致", 409);
      const existing = await store.getPaymentBatchForUpdate(checkout.id);
      if (existing?.clientPayload) return { payment: existing, claimed: false, orders: orders as Order[] };
      if (this.provider.name === "wechat" && Date.parse(checkout.expiresAt) - now <= 60_000)
        throw new BusinessError("INVALID_STATE_TRANSITION", "剩余支付时间不足，无法安全发起微信支付；请取消当前订单后重新下单", 409);
      if (existing && existing.status !== "CREATED")
        throw new BusinessError("INVALID_STATE_TRANSITION", "合并支付单当前不可重新发起", 409);
      if (existing?.initiationLeaseUntil && Date.parse(existing.initiationLeaseUntil) > now)
        return { payment: existing, claimed: false, orders: orders as Order[] };
      const payment: PaymentBatch = existing ?? {
        id: randomUUID(), checkoutBatchId: checkout.id, provider: this.provider.name,
        providerPaymentId: null, status: "CREATED", amountCents: checkout.totalCents,
        clientPayload: null, providerContext: null, initiationLeaseUntil: null,
        initiationClaimToken: null, createdAt: new Date().toISOString(), succeededAt: null,
      };
      payment.initiationLeaseUntil = new Date(now + paymentLeaseMs).toISOString();
      payment.initiationClaimToken = claimToken;
      await store.savePaymentBatch(payment);
      for (const order of orders as Order[]) {
        const current = await store.getPaymentByOrderForUpdate(order.id);
        if (current && current.checkoutBatchId !== checkout.id)
          throw new BusinessError("FINANCIAL_INCONSISTENT", "子订单已关联其他支付批次", 409);
        if (current && current.status !== "CREATED")
          throw new BusinessError("INVALID_STATE_TRANSITION", "子订单支付状态已变化", 409);
        await store.savePayment(current ?? {
          id: randomUUID(), orderId: order.id, checkoutBatchId: checkout.id,
          provider: this.provider.name, providerPaymentId: null, status: "CREATED",
          amountCents: order.totalCents, clientPayload: null, providerContext: null,
          initiationLeaseUntil: null, initiationClaimToken: null,
          createdAt: new Date().toISOString(), succeededAt: null,
        });
      }
      return { payment, claimed: true, orders: orders as Order[] };
    });
    if (!claim.claimed) {
      if (claim.payment.clientPayload) return this.result(claim.payment);
      throw new BusinessError("CONCURRENT_MODIFICATION", "支付正在创建，请稍后重试", 409);
    }
    const [checkout, user] = await Promise.all([
      this.store.getCheckoutBatch(checkoutBatchId), this.store.getUser(userId),
    ]);
    if (!checkout) throw new BusinessError("RESOURCE_NOT_FOUND", "结算批次不存在", 404);
    const first = claim.orders[0];
    if (!first) throw new BusinessError("FINANCIAL_INCONSISTENT", "结算批次没有子订单", 409);
    let initiated: Awaited<ReturnType<PaymentProvider["initiate"]>>;
    try {
      initiated = await this.provider.initiate({ ...first, orderNo: checkout.outTradeNo, totalCents: checkout.totalCents }, user?.wechatOpenId ?? null);
    } catch (error) {
      if (this.provider.name === "wechat" && error instanceof BusinessError && error.message === "订单剩余支付时间不足，请重新下单") {
        await this.store.savePaymentBatchIfInitiationClaimed({ ...claim.payment, initiationLeaseUntil: null, initiationClaimToken: null }, claimToken);
        throw new BusinessError("INVALID_STATE_TRANSITION", "剩余支付时间不足，无法安全发起微信支付；请取消当前订单后重新下单", 409);
      }
      throw error;
    }
    const saved: PaymentBatch = {
      ...claim.payment, providerPaymentId: initiated.providerPaymentId,
      clientPayload: initiated.clientPayload, providerContext: { ...initiated.providerContext, outTradeNo: checkout.outTradeNo },
      initiationLeaseUntil: null, initiationClaimToken: null,
    };
    const persisted = await this.store.transaction(async (store) => {
      if (!(await store.savePaymentBatchIfInitiationClaimed(saved, claimToken))) return "claim-lost" as const;
      for (const order of claim.orders) {
        const payment = await store.getPaymentByOrderForUpdate(order.id);
        if (!payment || payment.checkoutBatchId !== checkout.id || payment.status !== "CREATED")
          throw new BusinessError("CONCURRENT_MODIFICATION", "子订单支付状态已变化", 409);
        payment.providerPaymentId = initiated.providerPaymentId;
        payment.clientPayload = initiated.clientPayload;
        payment.providerContext = saved.providerContext;
        await store.savePayment(payment);
      }
      const latestCheckout = await store.getCheckoutBatchForUpdate(checkoutBatchId);
      return latestCheckout?.status === "PENDING_PAYMENT" ? "ready" as const : "cancelled" as const;
    });
    if (persisted === "claim-lost") throw new BusinessError("CONCURRENT_MODIFICATION", "支付创建结果已被其他请求接管", 409);
    if (persisted === "cancelled") throw new BusinessError("INVALID_STATE_TRANSITION", "结算批次在支付创建期间已取消，未返回支付凭据", 409);
    return this.result(saved);
  }

  public async confirmMockBatch(checkoutBatchId: string, userId: string): Promise<void> {
    if (this.provider.name !== "mock")
      throw new BusinessError("FORBIDDEN", "当前环境未启用模拟支付", 403);
    await this.store.transaction(async (store) => {
      const checkout = await store.getCheckoutBatchForUpdate(checkoutBatchId);
      if (!checkout || checkout.userId !== userId)
        throw new BusinessError("RESOURCE_NOT_FOUND", "结算批次不存在", 404);
      if (checkout.status === "PAID") return;
      if (checkout.status !== "PENDING_PAYMENT" || Date.parse(checkout.expiresAt) <= Date.now())
        throw new BusinessError("INVALID_STATE_TRANSITION", "结算批次已过期或不可支付", 409);
      let paymentBatch = await store.getPaymentBatchForUpdate(checkout.id);
      if (!paymentBatch) {
        paymentBatch = {
          id: randomUUID(), checkoutBatchId: checkout.id, provider: "mock",
          providerPaymentId: null, status: "CREATED", amountCents: checkout.totalCents,
          clientPayload: { mock: "true" }, providerContext: { outTradeNo: checkout.outTradeNo },
          initiationLeaseUntil: null, initiationClaimToken: null,
          createdAt: new Date().toISOString(), succeededAt: null,
        };
        await store.savePaymentBatch(paymentBatch);
      }
      const orders = await Promise.all(checkout.orderIds.map((id) => store.getOrderForUpdate(id)));
      if (orders.some((order) => !order || order.status !== "PENDING_PAYMENT"))
        throw new BusinessError("INVALID_STATE_TRANSITION", "结算子订单状态已变化", 409);
      for (const order of orders as Order[]) {
        let payment = await store.getPaymentByOrderForUpdate(order.id);
        if (!payment) {
          payment = {
            id: randomUUID(), orderId: order.id, checkoutBatchId: checkout.id,
            provider: "mock", providerPaymentId: null, status: "CREATED",
            amountCents: order.totalCents, clientPayload: { mock: "true" },
            providerContext: { outTradeNo: checkout.outTradeNo },
            initiationLeaseUntil: null, initiationClaimToken: null,
            createdAt: new Date().toISOString(), succeededAt: null,
          };
          await store.savePayment(payment);
        }
        await this.completePayment(store, order, payment, `MOCK-${checkout.outTradeNo}`);
      }
      paymentBatch.status = "SUCCEEDED";
      paymentBatch.succeededAt = new Date().toISOString();
      paymentBatch.providerPaymentId = `MOCK-${checkout.outTradeNo}`;
      paymentBatch.initiationLeaseUntil = null;
      paymentBatch.initiationClaimToken = null;
      await store.savePaymentBatch(paymentBatch);
      checkout.status = "PAID";
      await store.saveCheckoutBatch(checkout);
    });
  }

  public async confirmMock(orderId: string, userId: string): Promise<void> {
    if (this.provider.name !== "mock")
      throw new BusinessError("FORBIDDEN", "当前环境未启用模拟支付", 403);
    const checkoutBatch = await this.store.getCheckoutBatchByOrder(orderId);
    if (checkoutBatch) return this.confirmMockBatch(checkoutBatch.id, userId);
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
      const checkoutBatch = await store.getCheckoutBatchByOutTradeNoForUpdate(notification.orderNo);
      if (checkoutBatch) {
        const parentPayment = await store.getPaymentBatchForUpdate(checkoutBatch.id);
        if (!parentPayment)
          throw new BusinessError("RESOURCE_NOT_FOUND", "合并支付单不存在", 404);
        if (Number(parentPayment.amountCents) !== notification.amountCents || Number(checkoutBatch.totalCents) !== notification.amountCents)
          throw new BusinessError("FINANCIAL_INCONSISTENT", "合并支付回调金额不一致", 409);
        if (parentPayment.status !== "CREATED" && parentPayment.providerPaymentId !== notification.providerPaymentId)
          throw new BusinessError("FINANCIAL_INCONSISTENT", "合并支付机构交易号不一致", 409);
        const orders = await Promise.all(checkoutBatch.orderIds.map((id) => store.getOrderForUpdate(id)));
        if (orders.some((order) => !order))
          throw new BusinessError("FINANCIAL_INCONSISTENT", "合并支付子订单缺失", 409);
        const payments = await Promise.all((orders as Order[]).map((order) => store.getPaymentByOrderForUpdate(order.id)));
        if (payments.some((payment) => !payment || payment.checkoutBatchId !== checkoutBatch.id))
          throw new BusinessError("FINANCIAL_INCONSISTENT", "合并支付子订单映射缺失", 409);
        const childTotal = (orders as Order[]).reduce((sum, order) => sum + Number(order.totalCents), 0);
        if (childTotal !== notification.amountCents)
          throw new BusinessError("FINANCIAL_INCONSISTENT", "合并支付子订单金额合计不一致", 409);
        for (let index = 0; index < orders.length; index++)
          await this.completePayment(store, orders[index]!, payments[index]!, notification.providerPaymentId);
        parentPayment.providerPaymentId = notification.providerPaymentId;
        parentPayment.status = "SUCCEEDED";
        parentPayment.succeededAt ??= new Date().toISOString();
        parentPayment.initiationLeaseUntil = null;
        parentPayment.initiationClaimToken = null;
        await store.savePaymentBatch(parentPayment);
        checkoutBatch.status = "PAID";
        await store.saveCheckoutBatch(checkoutBatch);
        return;
      }
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
      if (payment.checkoutBatchId)
        await this.assertCheckoutRefundCapacity(store, payment.checkoutBatchId, Number(created.amountCents));
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
        if (payment.checkoutBatchId)
          await this.assertCheckoutRefundCapacity(store, payment.checkoutBatchId, amount);
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
        const providerStatus = notification.status;
        if (
          await store.saveOrderRefundIfStatus(
            {
              ...full,
              providerRefundId: notification.providerRefundId,
              status: providerStatus === "SUCCEEDED" || providerStatus === "PROCESSING" ? providerStatus : "MANUAL_HOLD",
              manualProviderStatus: providerStatus === "SUCCEEDED" || providerStatus === "PROCESSING" ? null : providerStatus,
              manualHoldReason: providerStatus === "SUCCEEDED" || providerStatus === "PROCESSING" ? null : `退款机构回调状态 ${providerStatus}，需人工处理`,
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
      const providerStatus = notification.status;
      if (
        partial &&
        (await store.savePartialRefundIfStatus(
          {
            ...partial,
            providerRefundId: notification.providerRefundId,
            status: providerStatus === "SUCCEEDED" || providerStatus === "PROCESSING" ? providerStatus : "MANUAL_HOLD",
            manualProviderStatus: providerStatus === "SUCCEEDED" || providerStatus === "PROCESSING" ? null : providerStatus,
            manualHoldReason: providerStatus === "SUCCEEDED" || providerStatus === "PROCESSING" ? null : `退款机构回调状态 ${providerStatus}，需人工处理`,
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

  /** Explicit finance check for an exhausted obligation. It always queries the provider first. */
  public async checkManualRefund(type: "FULL" | "PARTIAL", id: string, actorId: string, requestId: string): Promise<void> {
    const refund = type === "FULL" ? await this.store.getOrderRefund(id) : await this.store.getPartialRefund(id);
    if (!refund || refund.status !== "MANUAL_HOLD") throw new BusinessError("INVALID_STATE_TRANSITION", "退款不处于人工挂起状态", 409);
    const token = randomUUID();
    const now = new Date();
    const claim = type === "FULL" ? this.store.claimOrderRefundSubmission.bind(this.store) : this.store.claimPartialRefundSubmission.bind(this.store);
    if (!(await claim(id, new Date(now.getTime() + refundLeaseMs).toISOString(), now.toISOString(), token)))
      throw new BusinessError("CONCURRENT_MODIFICATION", "退款正在由其他操作核查", 409);
    let result: Awaited<ReturnType<PaymentProvider["queryRefund"]>>;
    try { result = await this.provider.queryRefund({ providerRefundNo: refund.providerRefundNo }); }
    catch (error) {
      const held = { ...refund, status: "MANUAL_HOLD" as const, submissionLeaseUntil: null, submissionClaimToken: null, lastError: this.errorText(error), manualProviderStatus: null };
      await this.store.transaction(async store => {
        if (type === "FULL") await store.saveOrderRefundIfClaimed(held as OrderRefund, token);
        else await store.savePartialRefundIfClaimed(held as PartialRefund, token);
        await this.auditManualRefund(store, type, refund.id, actorId, requestId, "FINANCE_REFUND_MANUAL_CHECK_FAILED", { status: refund.status }, { status: held.status, providerRefundNo: refund.providerRefundNo, error: held.lastError });
      });
      throw error;
    }
    const status = "kind" in result ? "NOT_FOUND" : result.status;
    const recoveryExhausted = this.isExhausted(refund.recoveryAttempts ?? 0);
    const nextStatus = status === "SUCCEEDED"
      ? "SUCCEEDED"
      : status === "PROCESSING" && !recoveryExhausted
        ? "PROCESSING"
        : "MANUAL_HOLD";
    const recoveryInstruction = status === "NOT_FOUND"
      ? "机构确认退款单不存在，可按原退款单号确认后恢复"
      : status === "FAILED"
        ? "机构确认退款失败，系统不提供重提；请按支付机构指引进行人工核查"
        : status === "PROCESSING" && recoveryExhausted
          ? exhaustedProcessingInstruction
          : status === "PROCESSING"
            ? null
        : refund.manualHoldReason;
    const checked = { ...refund, status: nextStatus as typeof refund.status, providerRefundId: "kind" in result ? refund.providerRefundId : result.providerRefundId,
      submissionLeaseUntil: null, submissionClaimToken: null, manualProviderStatus: status as RefundRecoveryFields["manualProviderStatus"],
      nextAttemptAt: status === "PROCESSING" && recoveryExhausted ? null : refund.nextAttemptAt,
      lastError: status === "FAILED" || status === "NOT_FOUND" ? `人工查询确认机构状态 ${status}` : null,
      manualHoldReason: recoveryInstruction };
    const saved = await this.store.transaction(async store => {
      const ok = type === "FULL" ? await store.saveOrderRefundIfClaimed(checked as OrderRefund, token) : await store.savePartialRefundIfClaimed(checked as PartialRefund, token);
      if (ok) await this.auditManualRefund(store, type, refund.id, actorId, requestId, "FINANCE_REFUND_MANUAL_CHECKED", { status: refund.status }, { status: checked.status, providerStatus: status, providerRefundNo: refund.providerRefundNo });
      return ok;
    });
    if (!saved) throw new BusinessError("CONCURRENT_MODIFICATION", "退款状态已被其他操作更新，请刷新", 409);
    if (status === "SUCCEEDED") {
      if (type === "FULL") await this.finalizeOrderRefund(refund.orderId);
      else await this.finalizePartialRefund(refund.id);
    }
  }

  /** Resubmits the same provider refund number only after a staff query confirmed FAILED or NOT_FOUND. */
  public async retryManualRefund(type: "FULL" | "PARTIAL", id: string, actorId: string, requestId: string): Promise<void> {
    const refund = type === "FULL" ? await this.store.getOrderRefund(id) : await this.store.getPartialRefund(id);
    if (!refund || refund.status !== "MANUAL_HOLD" || refund.manualProviderStatus !== "NOT_FOUND")
      throw new BusinessError("INVALID_STATE_TRANSITION", "只有机构明确返回退款单不存在时，才能恢复原退款义务", 409);
    if ((refund.manualRetryAttempts ?? 0) >= 1)
      throw new BusinessError("INVALID_STATE_TRANSITION", "人工恢复次数已达上限，请按退款机构指引继续处理", 409);
    const resumed = { ...refund, status: "RETRYABLE_FAILURE" as const, nextAttemptAt: new Date().toISOString(), manualHoldReason: null, manualProviderStatus: null, manualRetryAttempts: (refund.manualRetryAttempts ?? 0) + 1 };
    const saved = await this.store.transaction(async store => {
      const ok = type === "FULL" ? await store.saveOrderRefundIfStatus(resumed as OrderRefund, ["MANUAL_HOLD"]) : await store.savePartialRefundIfStatus(resumed as PartialRefund, ["MANUAL_HOLD"]);
      if (ok) await this.auditManualRefund(store, type, refund.id, actorId, requestId, "FINANCE_REFUND_MANUAL_RETRY", { status: refund.status, providerStatus: refund.manualProviderStatus }, { status: resumed.status, providerRefundNo: refund.providerRefundNo, verifiedProviderStatus: refund.manualProviderStatus });
      return ok;
    });
    if (!saved) throw new BusinessError("CONCURRENT_MODIFICATION", "退款状态已被其他操作更新，请刷新", 409);
    if (type === "FULL") await this.submitOrderRefund(resumed as OrderRefund, true);
    else await this.submitPartialRefund(resumed as PartialRefund, true);
    if (type === "FULL") await this.finalizeOrderRefund(refund.orderId);
    else await this.finalizePartialRefund(refund.id);
  }

  private async auditManualRefund(store: CommerceStore, type: "FULL" | "PARTIAL", id: string, actorId: string, requestId: string, action: string, beforeData: unknown, afterData: unknown): Promise<void> {
    await store.saveAuditLog({ id: randomUUID(), actorId, action, resourceType: type === "FULL" ? "ORDER_REFUND" : "PARTIAL_REFUND", resourceId: id, requestId, beforeData, afterData, createdAt: new Date().toISOString() });
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
  private result(payment: Pick<Payment, "provider" | "clientPayload" | "status"> | Pick<PaymentBatch, "provider" | "clientPayload" | "status">) {
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
    const checkoutBatch = payment.checkoutBatchId
      ? await this.store.getCheckoutBatch(payment.checkoutBatchId)
      : null;
    if (payment.checkoutBatchId && !checkoutBatch)
      throw new BusinessError("FINANCIAL_INCONSISTENT", "合并支付退款映射缺失", 409);
    return {
      providerRefundNo: refund.providerRefundNo,
      outTradeNo: checkoutBatch?.outTradeNo ?? order.orderNo,
      amountCents: Number(refund.amountCents),
      totalCents: Number(checkoutBatch?.totalCents ?? payment.amountCents),
    };
  }
  private async assertCheckoutRefundCapacity(
    store: Pick<CommerceStore, "getCheckoutBatchForUpdate" | "getOrderRefundByOrder" | "listPartialRefundsByOrder">,
    checkoutBatchId: string,
    additionalCents: number,
  ): Promise<void> {
    const checkout = await store.getCheckoutBatchForUpdate(checkoutBatchId);
    if (!checkout) throw new BusinessError("FINANCIAL_INCONSISTENT", "退款所属结算批次缺失", 409);
    let existingCents = 0;
    for (const orderId of checkout.orderIds) {
      const [full, partial] = await Promise.all([
        store.getOrderRefundByOrder(orderId),
        store.listPartialRefundsByOrder(orderId),
      ]);
      if (full) existingCents += Number(full.amountCents);
      existingCents += partial.reduce((sum, refund) => sum + Number(refund.amountCents), 0);
    }
    if (!Number.isSafeInteger(additionalCents) || additionalCents <= 0 || existingCents + additionalCents > Number(checkout.totalCents))
      throw new BusinessError("REFUND_AMOUNT_EXCEEDED", "合并支付累计退款不能超过实付总额", 409);
  }
  private async submitOrderRefund(refund: OrderRefund, manualRecovery = false): Promise<void> {
    if (!this.isDue(refund)) return;
    if (!manualRecovery && this.isExhausted(refund.recoveryAttempts ?? 0)) {
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
  private async submitPartialRefund(refund: PartialRefund, manualRecovery = false): Promise<void> {
    if (!this.isDue(refund)) return;
    if (!manualRecovery && this.isExhausted(refund.recoveryAttempts ?? 0)) {
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
  private providerStatus(status: ProviderRefundStatus) {
    if (status === "FAILED" || status === "CLOSED" || status === "ABNORMAL") return "MANUAL_HOLD";
    return status;
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
    result: { providerRefundId: string | null; status: ProviderRefundStatus },
  ): T {
    const submissionAttempts = (refund.submissionAttempts ?? 0) + 1;
    const recoveryAttempts = this.nextRecoveryCount(refund);
    const needsReview = ["FAILED", "CLOSED", "ABNORMAL"].includes(result.status);
    const exhausted = result.status !== "SUCCEEDED" && this.isExhausted(recoveryAttempts);
    return {
      ...refund,
      providerRefundId: result.providerRefundId,
      status: needsReview || exhausted
        ? "MANUAL_HOLD"
        : this.providerStatus(result.status),
      submissionLeaseUntil: null,
      submissionClaimToken: null,
      submissionAttempts,
      recoveryAttempts,
      nextAttemptAt: null,
      manualProviderStatus: needsReview || (exhausted && result.status === "PROCESSING") ? result.status : null,
      lastError: needsReview ? `provider returned ${result.status}` : null,
      manualHoldReason: needsReview
        ? `退款机构状态 ${result.status}，需人工处理`
        : exhausted && result.status === "PROCESSING" ? exhaustedProcessingInstruction
        : exhausted ? "退款自动恢复次数已达上限，等待人工处理"
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
        "status" | "providerRefundId" | "lastError" | "nextAttemptAt" | "manualHoldReason" | "manualProviderStatus"
      > = "kind" in result
        ? { status: exhausted ? "MANUAL_HOLD" : "RETRYABLE_FAILURE", providerRefundId: null, lastError: "provider refund not found", nextAttemptAt: exhausted ? null : this.nextAttempt(recoveryAttempts), manualProviderStatus: "NOT_FOUND", manualHoldReason: exhausted ? "退款自动恢复次数已达上限，等待人工处理" : null }
        : { status: result.status === "SUCCEEDED" ? "SUCCEEDED" : result.status === "PROCESSING" && !exhausted ? "PROCESSING" : "MANUAL_HOLD", providerRefundId: result.providerRefundId, lastError: result.status === "FAILED" || result.status === "CLOSED" || result.status === "ABNORMAL" ? `provider returned ${result.status}` : null, nextAttemptAt: result.status === "PROCESSING" && !exhausted ? this.nextAttempt(recoveryAttempts) : null, manualProviderStatus: result.status === "SUCCEEDED" || (result.status === "PROCESSING" && !exhausted) ? null : result.status, manualHoldReason: exhausted ? result.status === "PROCESSING" ? exhaustedProcessingInstruction : "退款自动恢复次数已达上限，等待人工处理" : result.status === "FAILED" || result.status === "CLOSED" || result.status === "ABNORMAL" ? `退款机构状态 ${result.status}，需人工处理` : null };
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
        "status" | "providerRefundId" | "lastError" | "nextAttemptAt" | "manualHoldReason" | "manualProviderStatus"
      > = "kind" in result
        ? { status: exhausted ? "MANUAL_HOLD" : "RETRYABLE_FAILURE", providerRefundId: null, lastError: "provider refund not found", nextAttemptAt: exhausted ? null : this.nextAttempt(recoveryAttempts), manualProviderStatus: "NOT_FOUND", manualHoldReason: exhausted ? "退款自动恢复次数已达上限，等待人工处理" : null }
        : { status: result.status === "SUCCEEDED" ? "SUCCEEDED" : result.status === "PROCESSING" && !exhausted ? "PROCESSING" : "MANUAL_HOLD", providerRefundId: result.providerRefundId, lastError: result.status === "FAILED" || result.status === "CLOSED" || result.status === "ABNORMAL" ? `provider returned ${result.status}` : null, nextAttemptAt: result.status === "PROCESSING" && !exhausted ? this.nextAttempt(recoveryAttempts) : null, manualProviderStatus: result.status === "SUCCEEDED" || (result.status === "PROCESSING" && !exhausted) ? null : result.status, manualHoldReason: exhausted ? result.status === "PROCESSING" ? exhaustedProcessingInstruction : "退款自动恢复次数已达上限，等待人工处理" : result.status === "FAILED" || result.status === "CLOSED" || result.status === "ABNORMAL" ? `退款机构状态 ${result.status}，需人工处理` : null };
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
      await completeCampaignIfSettled(store, order.campaignId);
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
      if (order) await completeCampaignIfSettled(store, order.campaignId);
    });
  }
}
