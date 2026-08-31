import { describe, expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import { MemoryStore } from "../core/store.js";
import { LedgerService } from "../finance/ledger-service.js";
import { PaymentService } from "./payment-service.js";
import type { PaymentProvider } from "./payment-provider.js";

const provider: PaymentProvider = {
  name: "mock",
  initiate: async () => ({
    providerPaymentId: null,
    clientPayload: { mock: "true" },
    providerContext: {},
  }),
  parseNotification: () => {
    throw new Error("unused");
  },
  refund: async () => ({
    providerRefundId: "provider-refund",
    status: "PROCESSING",
  }),
  queryRefund: async () => ({
    providerRefundId: "provider-refund",
    status: "SUCCEEDED",
  }),
  parseRefundNotification: () => {
    throw new Error("unused");
  },
};
async function fixture() {
  const store = new MemoryStore(false);
  const now = new Date().toISOString();
  await store.saveUser({
    id: "customer",
    wechatOpenId: "openid",
    status: "ACTIVE",
    createdAt: now,
  });
  await store.saveOrder({
    id: "order",
    orderNo: "ORDER-1",
    userId: "customer",
    campaignId: "campaign",
    serviceAreaId: "area",
    pickupPointId: "point",
    deliveryPlanId: "plan",
    status: "PENDING_PAYMENT",
    totalCents: moneyCents(1200),
    items: [],
    createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    paidAt: null,
    pickedUpAt: null,
  });
  await store.savePayment({
    id: "payment",
    orderId: "order",
    provider: "mock",
    providerPaymentId: null,
    status: "CREATED",
    amountCents: moneyCents(1200),
    clientPayload: { mock: "true" },
    providerContext: {},
    initiationLeaseUntil: null,
    initiationClaimToken: null,
    createdAt: now,
    succeededAt: null,
  });
  return store;
}

describe("payment and refund concurrency", () => {
  it("allows only payment or cancellation to win and deduplicates callbacks", async () => {
    const store = await fixture();
    const service = new PaymentService(store, provider, new LedgerService());
    const notification = {
      eventId: "payment-event",
      type: "TRANSACTION.SUCCESS",
      orderNo: "ORDER-1",
      providerPaymentId: "wechat-payment",
      amountCents: 1200,
      bodyHash: "hash",
    };
    const [paid, cancelled] = await Promise.allSettled([
      service.handleNotification(notification),
      store.cancelPendingOrder("order"),
    ]);
    expect([paid.status, cancelled.status]).toContain("fulfilled");
    const order = await store.getOrder("order");
    expect(["PAID_WAITING_CLOSE", "CANCELLED"]).toContain(order?.status);
    if (order?.status === "PAID_WAITING_CLOSE") {
      await expect(
        service.handleNotification(notification),
      ).resolves.toBeUndefined();
      expect(
        (await store.listLedgerTransactions("order")).filter(
          (v) => v.eventType === "PAYMENT_SUCCEEDED",
        ),
      ).toHaveLength(1);
    }
  });
  it("applies a repeated refund callback once", async () => {
    const store = await fixture();
    const service = new PaymentService(store, provider, new LedgerService());
    await service.handleNotification({
      eventId: "pay",
      type: "TRANSACTION.SUCCESS",
      orderNo: "ORDER-1",
      providerPaymentId: "wechat-payment",
      amountCents: 1200,
      bodyHash: "pay-hash",
    });
    await service.requestFullRefund("order");
    const refund = (await store.listOrderRefunds(10))[0]!;
    const callback = {
      eventId: "refund-event",
      type: "REFUND.SUCCESS",
      providerRefundNo: refund.providerRefundNo,
      providerRefundId: "wechat-refund",
      status: "SUCCEEDED" as const,
      bodyHash: "refund-hash",
    };
    await service.handleRefundNotification(callback);
    await service.handleRefundNotification(callback);
    expect((await store.getOrder("order"))?.status).toBe("REFUNDED");
    expect(
      (await store.listLedgerTransactions("order")).filter(
        (v) => v.eventType === "REFUND_SUCCEEDED",
      ),
    ).toHaveLength(1);
  });
  it("recovers a response-lost refund exactly once by querying the stable provider number", async () => {
    const store = await fixture();
    let submits = 0;
    const ambiguousProvider: PaymentProvider = {
      ...provider,
      refund: async () => { submits += 1; throw new Error("response lost after provider accepted"); },
      queryRefund: async () => ({ providerRefundId: "provider-refund", status: "SUCCEEDED" }),
    };
    const service = new PaymentService(store, ambiguousProvider, new LedgerService());
    await service.handleNotification({ eventId: "pay-recovery", type: "TRANSACTION.SUCCESS", orderNo: "ORDER-1", providerPaymentId: "wechat-payment", amountCents: 1200, bodyHash: "pay-recovery-hash" });
    await expect(service.requestFullRefund("order")).rejects.toThrow("response lost");
    const pending = (await store.listOrderRefunds(10))[0]!;
    expect(pending).toMatchObject({ status: "SUBMISSION_UNKNOWN", submissionAttempts: 1 });
    await store.saveOrderRefund({ ...pending, nextAttemptAt: new Date(0).toISOString() });
    await service.reconcileRefunds();
    expect(submits).toBe(1);
    expect((await store.getOrder("order"))?.status).toBe("REFUNDED");
  });
  it("records not-found and query-timeout recovery facts without changing the stable full refund number", async () => {
    const store = await fixture();
    let submissions = 0;
    let acceptRetry = false;
    const recoveryProvider: PaymentProvider = {
      ...provider,
      refund: async () => {
        submissions += 1;
        if (!acceptRetry) throw new Error("request did not reach provider");
        return { providerRefundId: "provider-refund", status: "SUCCEEDED" };
      },
      queryRefund: async () => ({ kind: "NOT_FOUND" }),
    };
    const service = new PaymentService(store, recoveryProvider, new LedgerService());
    await service.handleNotification({ eventId: "pay-not-found", type: "TRANSACTION.SUCCESS", orderNo: "ORDER-1", providerPaymentId: "wechat-payment", amountCents: 1200, bodyHash: "pay-not-found-hash" });
    await expect(service.requestFullRefund("order")).rejects.toThrow("did not reach");
    const unknown = (await store.listOrderRefunds(10))[0]!;
    await store.saveOrderRefund({ ...unknown, nextAttemptAt: new Date(0).toISOString() });
    await service.reconcileRefunds();
    const retryable = (await store.listOrderRefunds(10))[0]!;
    expect(retryable).toMatchObject({
      status: "RETRYABLE_FAILURE",
      providerRefundNo: unknown.providerRefundNo,
      lastError: "provider refund not found",
    });
    acceptRetry = true;
    await store.saveOrderRefund({ ...retryable, nextAttemptAt: new Date(0).toISOString() });
    await service.reconcileRefunds();
    expect(submissions).toBe(2);
    expect((await store.listOrderRefunds(10))[0]).toMatchObject({
      status: "SUCCEEDED",
      providerRefundNo: unknown.providerRefundNo,
    });
    const afterRetry = (await store.listOrderRefunds(10))[0]!;
    await store.saveOrderRefund({ ...afterRetry, status: "SUBMISSION_UNKNOWN", queryAttempts: 4, recoveryAttempts: 4, nextAttemptAt: new Date(0).toISOString() });
    const timeoutProvider: PaymentProvider = { ...recoveryProvider, queryRefund: async () => { throw new Error("provider timeout"); } };
    await new PaymentService(store, timeoutProvider, new LedgerService()).reconcileRefunds();
    expect((await store.listOrderRefunds(10))[0]).toMatchObject({ status: "MANUAL_HOLD", lastError: "provider timeout" });
  });
  it("uses the same ambiguity recovery contract for partial refunds and accepts a late callback once", async () => {
    const store = await fixture();
    let submissions = 0;
    let acceptRetry = false;
    const ambiguousProvider: PaymentProvider = {
      ...provider,
      refund: async () => {
        submissions += 1;
        if (!acceptRetry) throw new Error("response lost");
        return { providerRefundId: "partial-provider-refund", status: "SUCCEEDED" };
      },
      queryRefund: async () => ({ kind: "NOT_FOUND" }),
    };
    const service = new PaymentService(store, ambiguousProvider, new LedgerService());
    await store.savePartialRefund({
      id: "partial", exceptionId: "exception", orderId: "order", paymentId: "payment",
      providerRefundNo: "PARTIAL-1", providerRefundId: null, status: "CREATED",
      amountCents: moneyCents(100), createdAt: new Date().toISOString(),
      submissionLeaseUntil: null, submissionClaimToken: null,
      submissionAttempts: 0, queryAttempts: 0, nextAttemptAt: new Date(0).toISOString(),
      lastError: null, manualHoldReason: null,
    });
    await expect(service.reconcileRefunds()).resolves.toMatchObject({ failed: 1 });
    const unknown = (await store.listPartialRefunds(10))[0]!;
    expect(unknown).toMatchObject({ status: "SUBMISSION_UNKNOWN", submissionAttempts: 1 });
    await store.savePartialRefund({ ...unknown, nextAttemptAt: new Date(0).toISOString() });
    await service.reconcileRefunds();
    const retryable = (await store.listPartialRefunds(10))[0]!;
    expect(retryable).toMatchObject({ status: "RETRYABLE_FAILURE", providerRefundNo: "PARTIAL-1" });
    acceptRetry = true;
    await store.savePartialRefund({ ...retryable, nextAttemptAt: new Date(0).toISOString() });
    await service.reconcileRefunds();
    expect(submissions).toBe(2);
    expect((await store.listPartialRefunds(10))[0]).toMatchObject({ status: "SUCCEEDED" });
    await store.savePartialRefund({ ...(await store.listPartialRefunds(10))[0]!, status: "MANUAL_HOLD" });
    await service.handleRefundNotification({ eventId: "late-partial", type: "REFUND.SUCCESS", providerRefundNo: "PARTIAL-1", providerRefundId: "partial-provider-refund", status: "SUCCEEDED", bodyHash: "late-partial-hash" });
    expect((await store.listPartialRefunds(10))[0]).toMatchObject({ status: "SUCCEEDED" });
  });
  it("does not let a stale refund query overwrite a successful callback for full or partial refunds", async () => {
    const store = await fixture();
    let resolveFull: ((value: { providerRefundId: string | null; status: "PROCESSING" }) => void) | undefined;
    let resolvePartial: ((value: { providerRefundId: string | null; status: "PROCESSING" }) => void) | undefined;
    let fullStarted!: () => void;
    let partialStarted!: () => void;
    const fullStartedPromise = new Promise<void>((resolve) => { fullStarted = resolve; });
    const partialStartedPromise = new Promise<void>((resolve) => { partialStarted = resolve; });
    const racingProvider: PaymentProvider = {
      ...provider,
      refund: async () => { throw new Error("response lost"); },
      queryRefund: async ({ providerRefundNo }) => {
        if (providerRefundNo === "PARTIAL-RACE") {
          partialStarted();
          return new Promise((resolve) => { resolvePartial = resolve; });
        }
        fullStarted();
        return new Promise((resolve) => { resolveFull = resolve; });
      },
    };
    const service = new PaymentService(store, racingProvider, new LedgerService());
    await service.handleNotification({ eventId: "pay-race", type: "TRANSACTION.SUCCESS", orderNo: "ORDER-1", providerPaymentId: "wechat-payment", amountCents: 1200, bodyHash: "pay-race-hash" });
    await expect(service.requestFullRefund("order")).rejects.toThrow("response lost");
    const full = (await store.listOrderRefunds(10))[0]!;
    await store.saveOrderRefund({ ...full, nextAttemptAt: new Date(0).toISOString() });
    const fullReconcile = service.reconcileRefunds();
    await fullStartedPromise;
    await service.handleRefundNotification({ eventId: "full-race-callback", type: "REFUND.SUCCESS", providerRefundNo: full.providerRefundNo, providerRefundId: "full-provider", status: "SUCCEEDED", bodyHash: "full-race-hash" });
    resolveFull!({ providerRefundId: "full-provider", status: "PROCESSING" });
    await fullReconcile;
    expect((await store.listOrderRefunds(10))[0]).toMatchObject({ status: "SUCCEEDED" });

    await store.savePartialRefund({
      id: "partial-race", exceptionId: "exception-race", orderId: "order", paymentId: "payment",
      providerRefundNo: "PARTIAL-RACE", providerRefundId: null, status: "SUBMISSION_UNKNOWN",
      amountCents: moneyCents(100), createdAt: new Date().toISOString(), submissionLeaseUntil: null,
      submissionClaimToken: null, nextAttemptAt: new Date(0).toISOString(), recoveryVersion: 0,
    });
    const partialReconcile = service.reconcileRefunds();
    await partialStartedPromise;
    await service.handleRefundNotification({ eventId: "partial-race-callback", type: "REFUND.SUCCESS", providerRefundNo: "PARTIAL-RACE", providerRefundId: "partial-provider", status: "SUCCEEDED", bodyHash: "partial-race-hash" });
    resolvePartial!({ providerRefundId: "partial-provider", status: "PROCESSING" });
    await partialReconcile;
    expect((await store.listPartialRefunds(10))[0]).toMatchObject({ status: "SUCCEEDED" });
  });
  it("caps explicit provider failures and continues reconciling later obligations", async () => {
    const store = await fixture();
    let calls = 0;
    const providerWithFailureBudget: PaymentProvider = {
      ...provider,
      refund: async ({ providerRefundNo }) => {
        calls += 1;
        return providerRefundNo === "SECOND-REFUND"
          ? { providerRefundId: "second", status: "SUCCEEDED" }
          : { providerRefundId: null, status: "FAILED" };
      },
    };
    const service = new PaymentService(store, providerWithFailureBudget, new LedgerService());
    await store.saveOrderRefund({
      id: "first", orderId: "order", paymentId: "payment", providerRefundNo: "FIRST-REFUND",
      providerRefundId: null, status: "CREATED", amountCents: moneyCents(1200),
      createdAt: new Date().toISOString(), submissionLeaseUntil: null, submissionClaimToken: null,
      nextAttemptAt: new Date(0).toISOString(), recoveryAttempts: 0,
    });
    await store.saveOrder({ ...(await store.getOrder("order"))!, id: "order-2", orderNo: "ORDER-2" });
    await store.savePayment({ ...(await store.getPaymentByOrder("order"))!, id: "payment-2", orderId: "order-2" });
    await store.saveOrderRefund({
      id: "second", orderId: "order-2", paymentId: "payment-2", providerRefundNo: "SECOND-REFUND",
      providerRefundId: null, status: "CREATED", amountCents: moneyCents(1200),
      createdAt: new Date().toISOString(), submissionLeaseUntil: null, submissionClaimToken: null,
      nextAttemptAt: new Date(0).toISOString(), recoveryAttempts: 0,
    });
    await service.reconcileRefunds();
    expect((await store.getOrderRefundByProviderNo("SECOND-REFUND"))?.status).toBe("SUCCEEDED");
    for (let attempt = 1; attempt < 5; attempt += 1) {
      const first = (await store.getOrderRefundByProviderNo("FIRST-REFUND"))!;
      await store.saveOrderRefund({ ...first, nextAttemptAt: new Date(0).toISOString() });
      await service.reconcileRefunds();
    }
    expect((await store.getOrderRefundByProviderNo("FIRST-REFUND"))).toMatchObject({ status: "MANUAL_HOLD", submissionAttempts: 5, recoveryAttempts: 5 });
    await store.savePartialRefund({
      id: "partial-budget", exceptionId: "exception-budget", orderId: "order", paymentId: "payment",
      providerRefundNo: "PARTIAL-BUDGET", providerRefundId: null, status: "CREATED",
      amountCents: moneyCents(100), createdAt: new Date().toISOString(), submissionLeaseUntil: null,
      submissionClaimToken: null, nextAttemptAt: new Date(0).toISOString(), recoveryAttempts: 0,
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const partial = (await store.getPartialRefund("partial-budget"))!;
      await store.savePartialRefund({ ...partial, nextAttemptAt: new Date(0).toISOString() });
      await service.reconcileRefunds();
    }
    expect((await store.getPartialRefund("partial-budget"))).toMatchObject({ status: "MANUAL_HOLD", submissionAttempts: 5, recoveryAttempts: 5 });
    await service.reconcileRefunds();
    await service.reconcileRefunds();
    expect(calls).toBe(11);
  });
  it("stops at the fifth total provider call when submit or query returns PROCESSING", async () => {
    const store = await fixture();
    let submissions = 0;
    let queries = 0;
    const processingProvider: PaymentProvider = {
      ...provider,
      refund: async () => {
        submissions += 1;
        return { providerRefundId: "processing", status: "PROCESSING" };
      },
      queryRefund: async () => {
        queries += 1;
        return { providerRefundId: "processing", status: "PROCESSING" };
      },
    };
    const service = new PaymentService(store, processingProvider, new LedgerService());
    await store.saveOrderRefund({
      id: "full-boundary", orderId: "order", paymentId: "payment", providerRefundNo: "FULL-BOUNDARY",
      providerRefundId: null, status: "RETRYABLE_FAILURE", amountCents: moneyCents(1200),
      createdAt: new Date().toISOString(), submissionLeaseUntil: null, submissionClaimToken: null,
      submissionAttempts: 2, queryAttempts: 2, recoveryAttempts: 4, nextAttemptAt: new Date(0).toISOString(),
    });
    await service.reconcileRefunds();
    expect((await store.getOrderRefundByProviderNo("FULL-BOUNDARY"))).toMatchObject({ status: "MANUAL_HOLD", recoveryAttempts: 5 });
    await service.reconcileRefunds();
    expect({ submissions, queries }).toEqual({ submissions: 1, queries: 0 });

    await store.saveOrder({ ...(await store.getOrder("order"))!, id: "order-boundary-2", orderNo: "ORDER-BOUNDARY-2" });
    await store.savePayment({ ...(await store.getPaymentByOrder("order"))!, id: "payment-boundary-2", orderId: "order-boundary-2" });
    await store.saveOrderRefund({
      id: "full-query-boundary", orderId: "order-boundary-2", paymentId: "payment-boundary-2",
      providerRefundNo: "FULL-QUERY-BOUNDARY", providerRefundId: null, status: "PROCESSING",
      amountCents: moneyCents(1200), createdAt: new Date().toISOString(), submissionLeaseUntil: null,
      submissionClaimToken: null, submissionAttempts: 2, queryAttempts: 2, recoveryAttempts: 4,
      nextAttemptAt: new Date(0).toISOString(),
    });
    await service.reconcileRefunds();
    expect((await store.getOrderRefundByProviderNo("FULL-QUERY-BOUNDARY"))).toMatchObject({ status: "MANUAL_HOLD", recoveryAttempts: 5 });

    await store.savePartialRefund({
      id: "partial-boundary", exceptionId: "exception-boundary", orderId: "order", paymentId: "payment",
      providerRefundNo: "PARTIAL-BOUNDARY", providerRefundId: null, status: "PROCESSING",
      amountCents: moneyCents(100), createdAt: new Date().toISOString(), submissionLeaseUntil: null,
      submissionClaimToken: null, submissionAttempts: 2, queryAttempts: 2, recoveryAttempts: 4,
      nextAttemptAt: new Date(0).toISOString(),
    });
    await service.reconcileRefunds();
    expect((await store.getPartialRefund("partial-boundary"))).toMatchObject({ status: "MANUAL_HOLD", recoveryAttempts: 5 });
    await service.reconcileRefunds();
    expect({ submissions, queries }).toEqual({ submissions: 1, queries: 2 });
    await store.savePartialRefund({
      id: "partial-submit-boundary", exceptionId: "exception-submit-boundary", orderId: "order", paymentId: "payment",
      providerRefundNo: "PARTIAL-SUBMIT-BOUNDARY", providerRefundId: null, status: "RETRYABLE_FAILURE",
      amountCents: moneyCents(100), createdAt: new Date().toISOString(), submissionLeaseUntil: null,
      submissionClaimToken: null, submissionAttempts: 2, queryAttempts: 2, recoveryAttempts: 4,
      nextAttemptAt: new Date(0).toISOString(),
    });
    await service.reconcileRefunds();
    expect((await store.getPartialRefund("partial-submit-boundary"))).toMatchObject({ status: "MANUAL_HOLD", recoveryAttempts: 5 });
    await service.reconcileRefunds();
    expect({ submissions, queries }).toEqual({ submissions: 2, queries: 2 });
    await service.handleRefundNotification({ eventId: "late-boundary", type: "REFUND.SUCCESS", providerRefundNo: "PARTIAL-BOUNDARY", providerRefundId: "late", status: "SUCCEEDED", bodyHash: "late-boundary-hash" });
    expect((await store.getPartialRefund("partial-boundary"))).toMatchObject({ status: "SUCCEEDED" });
  });
  it("compensates a historical REFUNDING paid order once and does not duplicate an existing obligation", async () => {
    const store = await fixture();
    let submits = 0;
    const countingProvider: PaymentProvider = {
      ...provider,
      refund: async () => {
        submits += 1;
        return { providerRefundId: "provider-refund", status: "PROCESSING" };
      },
    };
    const service = new PaymentService(store, countingProvider, new LedgerService());
    await service.handleNotification({
      eventId: "pay-orphan",
      type: "TRANSACTION.SUCCESS",
      orderNo: "ORDER-1",
      providerPaymentId: "wechat-payment",
      amountCents: 1200,
      bodyHash: "pay-orphan-hash",
    });
    const paid = await store.getOrder("order");
    await store.saveOrderStatus({ ...paid!, status: "REFUNDING" });
    expect(await store.listOrderRefunds(10)).toHaveLength(0);

    await service.reconcileRefunds();
    const compensated = await store.listOrderRefunds(10);
    expect(compensated).toHaveLength(1);
    expect(compensated[0]).toMatchObject({
      orderId: "order",
      providerRefundNo: "RFORDER-1",
    });
    expect(submits).toBe(1);

    await service.reconcileRefunds();
    expect(await store.listOrderRefunds(10)).toHaveLength(1);
    expect(submits).toBe(1);
  });
});
