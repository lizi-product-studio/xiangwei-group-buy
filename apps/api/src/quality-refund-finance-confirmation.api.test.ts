import { expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";
import type { CommunityQualityCase, PartialRefund } from "./modules/core/types.js";
import { NoopCampaignScheduler } from "./modules/campaigns/campaign-scheduler.js";
import {
  MockPaymentProvider,
  type RefundNotification,
  type RefundRequest,
  type RefundResult,
} from "./modules/payments/payment-provider.js";

class ProcessingRefundProvider extends MockPaymentProvider {
  public readonly submissions: RefundRequest[] = [];
  public callback: RefundNotification | null = null;

  override async refund(input: RefundRequest): Promise<RefundResult> {
    this.submissions.push(input);
    return {
      providerRefundId: `provider-${input.providerRefundNo}`,
      status: "PROCESSING",
    };
  }

  override parseRefundNotification(): RefundNotification {
    if (!this.callback) throw new Error("refund callback was not configured");
    return this.callback;
  }
}

const finance = { "x-demo-user-id": "finance-user", "x-demo-role": "FINANCE" };

it("lets finance confirm a callback-settled quality refund without submitting it again", async () => {
  const store = new MemoryStore(false);
  const provider = new ProcessingRefundProvider();
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: "test" }),
    store,
    scheduler: new NoopCampaignScheduler(),
    paymentProvider: provider,
  });
  try {
    const now = new Date().toISOString();
    await store.saveCampaign({
      id: "campaign-confirm",
      title: "退款结清确认团期",
      serviceAreaId: "area-confirm",
      cutoffAt: now,
      dispatchAt: now,
      estimatedArrivalStartAt: now,
      estimatedArrivalEndAt: now,
      minTotalQuantity: 1,
      failureAction: "CANCEL_AND_REFUND",
      items: [],
      status: "FULFILLING",
      version: 1,
      createdAt: now,
    });
    await store.saveOrder({
      id: "order-confirm",
      orderNo: "ORDER-CONFIRM",
      userId: "customer-confirm",
      campaignId: "campaign-confirm",
      serviceAreaId: "area-confirm",
      pickupPointId: "point-confirm",
      deliveryPlanId: "plan-confirm",
      status: "COMPLETED",
      totalCents: moneyCents(2000),
      items: [{
        orderLineId: "line-confirm",
        skuId: "sku-confirm",
        productId: "product-confirm",
        name: "番茄",
        quantity: 2,
        unitPriceCents: moneyCents(1000),
        amountCents: moneyCents(2000),
        fulfilledQuantity: 2,
        pickedUpQuantity: 2,
        exceptionQuantity: 0,
        refundedQuantity: 0,
        refundedAmountCents: moneyCents(0),
      }],
      createdAt: now,
      expiresAt: now,
      paidAt: now,
      pickedUpAt: now,
    });
    await store.saveOrderLines("order-confirm", [{
      id: "line-confirm",
      catalogSkuId: "sku-confirm",
      productId: "product-confirm",
      title: "番茄",
      skuName: "份",
      quantity: 2,
      unitPriceCents: moneyCents(1000),
      amountCents: moneyCents(2000),
    }]);
    const line = (await store.listOrderLinesByOrderForUpdate("order-confirm"))[0]!;
    line.fulfilledQuantity = 2;
    line.pickedUpQuantity = 2;
    await store.updateOrderLine(line);
    await store.savePayment({
      id: "payment-confirm",
      orderId: "order-confirm",
      provider: "mock",
      providerPaymentId: "paid-confirm",
      status: "SUCCEEDED",
      amountCents: moneyCents(2000),
      clientPayload: {},
      providerContext: {},
      initiationLeaseUntil: null,
      initiationClaimToken: null,
      createdAt: now,
      succeededAt: now,
    });
    await store.saveFulfillmentException({
      id: "exception-confirm",
      campaignId: "campaign-confirm",
      orderId: "order-confirm",
      clientRequestId: "quality-confirm-request",
      deliveryPlanId: "plan-confirm",
      sourceStage: "CUSTOMER_CLAIM",
      refundAccountingStage: "POST_REVENUE",
      status: "REFUND_CONFIRMED",
      responsibility: "PLATFORM",
      registeredBy: "customer-confirm",
      confirmedBy: "operator-confirm",
      resolutionNote: "品质售后批准退款",
      registeredAt: now,
      confirmedAt: now,
      items: [{
        id: "exception-item-confirm",
        exceptionId: "exception-confirm",
        catalogSkuId: "sku-confirm",
        expectedQuantity: 1,
        acceptedQuantity: 0,
        rejectedQuantity: 0,
        shortQuantity: 0,
        damagedQuantity: 1,
        reason: "QUALITY_CLAIM",
        description: "一份商品存在品质问题",
        evidenceUrl: null,
      }],
    });
    await store.saveFulfillmentAllocations([{
      id: "allocation-confirm",
      exceptionId: "exception-confirm",
      exceptionItemId: "exception-item-confirm",
      orderLineId: "line-confirm",
      orderId: "order-confirm",
      catalogSkuId: "sku-confirm",
      fulfilledQuantity: 0,
      exceptionQuantity: 1,
      refundedQuantity: 0,
      createdAt: now,
      refundedAt: null,
    }]);
    const qualityCase: CommunityQualityCase = {
      id: "quality-case-confirm",
      orderId: "order-confirm",
      userId: "customer-confirm",
      clientRequestId: "quality-confirm-request",
      payloadHash: "confirm-payload",
      status: "REFUNDING",
      registeredAt: now,
      acceptedBy: "service-confirm",
      acceptedAt: now,
      acceptanceNote: "已核实",
      decisionBy: "operator-confirm",
      decidedAt: now,
      decisionNote: "批准按一份退款",
      refundApprovedBy: "operator-confirm",
      refundApprovedAt: now,
      financeExecutedBy: null,
      financeExecutedAt: null,
      refundExceptionId: "exception-confirm",
      items: [{
        id: "quality-item-confirm",
        communityQualityCaseId: "quality-case-confirm",
        pickupReceiptId: "receipt-confirm",
        orderLineId: "line-confirm",
        catalogSkuId: "sku-confirm",
        pickedUpQuantitySnapshot: 2,
        disputedQuantity: 1,
        reason: "QUALITY_CLAIM",
        description: "一份商品存在品质问题",
      }],
    };
    await store.saveCommunityQualityCase(qualityCase);

    const firstExecution = await app.inject({
      method: "POST",
      url: "/api/v1/admin/quality-cases/quality-case-confirm/refund",
      headers: finance,
    });
    expect(firstExecution.statusCode, firstExecution.body).toBe(200);
    expect(firstExecution.json().data).toMatchObject({
      status: "REFUNDING",
      financeRefundStatus: "PROCESSING",
      financeRefundStatuses: ["PROCESSING"],
    });
    expect(provider.submissions).toHaveLength(1);
    const [refund] = await store.listPartialRefundsByException("exception-confirm");
    expect(refund).toMatchObject({
      status: "PROCESSING",
      amountCents: 1000,
      providerRefundNo: expect.any(String),
    });

    const callback: RefundNotification = {
      eventId: "provider-event-confirm",
      type: "REFUND.SUCCESS",
      providerRefundNo: refund!.providerRefundNo,
      providerRefundId: "provider-refund-confirm",
      status: "SUCCEEDED",
      bodyHash: "provider-body-confirm",
    };
    provider.callback = callback;
    const settledByProvider = await app.inject({
      method: "POST",
      url: "/api/v1/payments/wechat/refund-notify",
      payload: { event: "provider success" },
    });
    expect(settledByProvider.statusCode, settledByProvider.body).toBe(200);
    expect((await store.getCommunityQualityCaseForUpdate(qualityCase.id))?.status).toBe("REFUNDING");
    expect((await store.getFulfillmentException("exception-confirm"))?.status).toBe("RESOLVED");
    expect((await store.getCampaign("campaign-confirm"))?.status).toBe("FULFILLING");
    expect(await store.listLedgerTransactions(refund!.id)).toHaveLength(1);

    const queue = await app.inject({
      method: "GET",
      url: "/api/v1/admin/quality-cases",
      headers: finance,
    });
    expect(queue.json().data[0]).toMatchObject({
      status: "REFUNDING",
      financeRefundStatus: "SUCCEEDED",
      financeRefundStatuses: ["SUCCEEDED"],
    });

    const financeConfirmation = await app.inject({
      method: "POST",
      url: "/api/v1/admin/quality-cases/quality-case-confirm/refund",
      headers: finance,
    });
    expect(financeConfirmation.statusCode, financeConfirmation.body).toBe(200);
    expect(financeConfirmation.json().data.status).toBe("RESOLVED");
    expect(provider.submissions).toHaveLength(1);
    expect(provider.submissions[0]?.providerRefundNo).toBe(refund!.providerRefundNo);
    expect((await store.listPartialRefundsByException("exception-confirm"))).toHaveLength(1);
    expect((await store.getPartialRefund(refund!.id))?.providerRefundNo).toBe(refund!.providerRefundNo);
    expect(await store.listLedgerTransactions(refund!.id)).toHaveLength(1);
    const finalOrder = await store.getOrder("order-confirm");
    expect(finalOrder?.items[0]).toMatchObject({
      fulfilledQuantity: 2,
      pickedUpQuantity: 2,
      refundedQuantity: 1,
    });
    expect((await store.getCampaign("campaign-confirm"))?.status).toBe("COMPLETED");
    const executionAudit = await store.findLatestAudit(
      "FULFILLMENT_EXCEPTION",
      "exception-confirm",
      "PARTIAL_REFUND_EXECUTED",
    );
    expect(executionAudit).toMatchObject({
      actorId: "finance-user",
      requestId: firstExecution.headers["x-request-id"],
    });
    const confirmationAudit = await store.findLatestAudit(
      "COMMUNITY_QUALITY_CASE",
      qualityCase.id,
      "COMMUNITY_QUALITY_CASE_FINANCE_EXECUTED",
    );
    expect(confirmationAudit).toMatchObject({
      actorId: "finance-user",
      requestId: financeConfirmation.headers["x-request-id"],
    });

    const callbackReplay = await app.inject({
      method: "POST",
      url: "/api/v1/payments/wechat/refund-notify",
      payload: { event: "provider success" },
    });
    expect(callbackReplay.statusCode).toBe(200);
    const confirmationReplay = await app.inject({
      method: "POST",
      url: "/api/v1/admin/quality-cases/quality-case-confirm/refund",
      headers: finance,
    });
    expect(confirmationReplay.statusCode).toBe(200);
    expect(provider.submissions).toHaveLength(1);
    expect((await store.listLedgerTransactions(refund!.id))).toHaveLength(1);
    expect((await store.listAuditLogs(20)).filter((entry) => entry.action === "COMMUNITY_QUALITY_CASE_FINANCE_EXECUTED")).toHaveLength(1);
    expect((await store.listAuditLogs(20)).filter((entry) => entry.action === "PARTIAL_REFUND_EXECUTED")).toHaveLength(1);
  } finally {
    await app.close();
  }
});

it("keeps a quality case pending while any one of its refund obligations is unsettled", async () => {
  const store = new MemoryStore(false);
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: "test" }),
    store,
    scheduler: new NoopCampaignScheduler(),
  });
  try {
    const now = new Date().toISOString();
    await store.saveOrder({
      id: "multi-order",
      orderNo: "MULTI-ORDER",
      userId: "multi-customer",
      campaignId: "multi-campaign",
      serviceAreaId: "multi-area",
      pickupPointId: "multi-point",
      deliveryPlanId: "multi-plan",
      status: "COMPLETED",
      totalCents: moneyCents(2000),
      items: [],
      createdAt: now,
      expiresAt: now,
      paidAt: now,
      pickedUpAt: now,
    });
    await store.saveFulfillmentException({
      id: "multi-exception",
      campaignId: "multi-campaign",
      orderId: "multi-order",
      clientRequestId: "multi-request",
      deliveryPlanId: "multi-plan",
      sourceStage: "CUSTOMER_CLAIM",
      refundAccountingStage: "POST_REVENUE",
      status: "REFUND_PROCESSING",
      responsibility: "PLATFORM",
      registeredBy: "multi-customer",
      confirmedBy: "multi-operator",
      resolutionNote: "多笔退款义务",
      registeredAt: now,
      confirmedAt: now,
      items: [],
    });
    const qualityCase: CommunityQualityCase = {
      id: "multi-quality-case",
      orderId: "multi-order",
      userId: "multi-customer",
      clientRequestId: "multi-request",
      payloadHash: "multi-payload",
      status: "REFUNDING",
      registeredAt: now,
      acceptedBy: "multi-service",
      acceptedAt: now,
      acceptanceNote: "已受理",
      decisionBy: "multi-operator",
      decidedAt: now,
      decisionNote: "批准退款",
      refundApprovedBy: "multi-operator",
      refundApprovedAt: now,
      financeExecutedBy: null,
      financeExecutedAt: null,
      refundExceptionId: "multi-exception",
      items: [],
    };
    await store.saveCommunityQualityCase(qualityCase);
    const refund = (id: string, orderId: string, status: PartialRefund["status"]): PartialRefund => ({
      id,
      exceptionId: "multi-exception",
      orderId,
      paymentId: `payment-${orderId}`,
      providerRefundNo: `provider-${id}`,
      providerRefundId: status === "SUCCEEDED" ? `provider-id-${id}` : null,
      status,
      amountCents: moneyCents(500),
      createdAt: now,
      submissionLeaseUntil: null,
      submissionClaimToken: null,
    });
    await store.savePartialRefund(refund("settled-refund", "multi-order", "SUCCEEDED"));
    await store.savePartialRefund(refund("pending-refund", "second-order", "PROCESSING"));

    const queue = await app.inject({
      method: "GET",
      url: "/api/v1/admin/quality-cases",
      headers: finance,
    });
    expect(queue.statusCode, queue.body).toBe(200);
    expect(queue.json().data[0]).toMatchObject({
      financeRefundStatus: "PROCESSING",
      financeRefundStatuses: ["SUCCEEDED", "PROCESSING"],
    });

    const confirmation = await app.inject({
      method: "POST",
      url: "/api/v1/admin/quality-cases/multi-quality-case/refund",
      headers: finance,
    });
    expect(confirmation.statusCode, confirmation.body).toBe(200);
    expect(confirmation.json().data).toMatchObject({
      status: "REFUNDING",
      financeRefundStatus: "PROCESSING",
      financeRefundStatuses: ["SUCCEEDED", "PROCESSING"],
    });
    expect((await store.getCommunityQualityCaseForUpdate(qualityCase.id))?.status).toBe("REFUNDING");
    expect(await store.findLatestAudit("COMMUNITY_QUALITY_CASE", qualityCase.id, "COMMUNITY_QUALITY_CASE_FINANCE_EXECUTED")).toBeNull();
  } finally {
    await app.close();
  }
});
