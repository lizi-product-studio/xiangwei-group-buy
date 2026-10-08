import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MysqlStore } from "./modules/core/mysql-store.js";
import { NoopCampaignScheduler, RedisCampaignScheduler } from "./modules/campaigns/campaign-scheduler.js";
import { FulfillmentService } from "./modules/fulfillment/fulfillment-service.js";
import { CommunityQualityService } from "./modules/fulfillment/community-quality-service.js";
import { LedgerService } from "./modules/finance/ledger-service.js";
import { PaymentService } from "./modules/payments/payment-service.js";
import type { PaymentProvider, RefundNotification } from "./modules/payments/payment-provider.js";
import type { CommunityQualityCase, FulfillmentAllocation, FulfillmentException, OrderNotification, ServiceAreaInterest } from "./modules/core/types.js";
import { Redis } from "ioredis";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const redisUrl = process.env.INTEGRATION_REDIS_URL;
const integrationRequired = process.env.REQUIRE_INTEGRATION_TESTS === "true";
const notification = (id: string): OrderNotification => {
  const createdAt = new Date().toISOString();
  return {
    id,
    eventKey: `integration:notification:${id}`,
    userId: "integration-user",
    orderId: "integration-order",
    type: "ARRIVED",
    title: "integration",
    content: "integration",
    status: "PENDING_DELIVERY",
    readAt: null,
    manualCompletedAt: null,
    manualCompletedBy: null,
    manualCompletionNote: null,
    createdAt,
    deliveryAttempts: 0,
    // Keep it independently due before the database's current UTC clock so
    // this test exercises lease ownership rather than application clock skew.
    nextAttemptAt: "2000-01-01T00:00:00.000Z",
    deliveryLeaseUntil: null,
    deliveryClaimToken: null,
    providerSubmissionAttemptId: null,
    providerSubmissionStartedAt: null,
    providerResultRecordedAt: null,
    providerReceiptId: null,
    submissionUnknownReason: null,
    lastDeliveryError: null,
    deliveredAt: null,
  };
};

describe("real integration test preconditions", () => {
  it.runIf(integrationRequired)(
    "fails closed when required MySQL or Redis configuration is absent",
    () => {
      expect(
        databaseUrl,
        "REQUIRE_INTEGRATION_TESTS=true requires INTEGRATION_DATABASE_URL",
      ).toBeTruthy();
      expect(
        redisUrl,
        "REQUIRE_INTEGRATION_TESTS=true requires INTEGRATION_REDIS_URL",
      ).toBeTruthy();
    },
  );
});

describe.skipIf(!databaseUrl || !redisUrl)(
  "real MySQL and Redis integration",
  () => {
    let first: MysqlStore;
    let second: MysqlStore;
    let scheduler: RedisCampaignScheduler;
    let secondScheduler: RedisCampaignScheduler;
    const apiApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
    beforeAll(() => {
      first = MysqlStore.create(databaseUrl!);
      second = MysqlStore.create(databaseUrl!);
      scheduler = new RedisCampaignScheduler(redisUrl!, async () => undefined);
      secondScheduler = new RedisCampaignScheduler(redisUrl!, async () => undefined);
    });
    afterAll(async () => {
      await Promise.all([first.close(), second.close(), scheduler.close(), secondScheduler.close()]);
    });
    afterEach(async () => {
      await Promise.all(apiApps.splice(0).map((app) => app.close()));
    });
    it("persists a community aggregate across independent MySQL pools", async () => {
      const id = `integration-${Date.now()}`;
      await first.saveUser({
        id,
        wechatOpenId: null,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
      });
      expect(await second.getUser(id)).toMatchObject({ id, status: "ACTIVE" });
    });
    it("persists exact notification refund linkage and account-template preferences across pools", async () => {
      const id = `subscription-${Date.now()}`;
      const row = { ...notification(id), refundId: 'successful-refund-a', siteConfirmed: true, status: 'MANUAL_REQUIRED' as const, nextAttemptAt: null };
      await first.createOrderNotificationIfAbsent(row);
      await first.saveNotificationPreference({ userId: id, types: ['PARTIAL_REFUND'], templateIds: { PARTIAL_REFUND: 'account-refund-template' }, updatedAt: new Date().toISOString() });
      expect(await second.getOrderNotification(id)).toMatchObject({ refundId: 'successful-refund-a', siteConfirmed: true, status: 'MANUAL_REQUIRED' });
      expect(await second.getNotificationPreference(id)).toMatchObject({ templateIds: { PARTIAL_REFUND: 'account-refund-template' } });
    });
    it("serializes concurrent aggregate writes across pools without losing either update", async () => {
      const suffix = Date.now();
      const firstId = `integration-concurrent-a-${suffix}`;
      const secondId = `integration-concurrent-b-${suffix}`;
      await Promise.all([
        first.saveUser({
          id: firstId,
          wechatOpenId: null,
          status: "ACTIVE",
          createdAt: new Date().toISOString(),
        }),
        second.saveUser({
          id: secondId,
          wechatOpenId: null,
          status: "ACTIVE",
          createdAt: new Date().toISOString(),
        }),
      ]);
      await expect(first.getUser(firstId)).resolves.toMatchObject({ id: firstId });
      await expect(first.getUser(secondId)).resolves.toMatchObject({ id: secondId });
    });
    it("serializes same-order pickup verification across MySQL pools for same and different request ids", async () => {
      const suffix = `${Date.now()}-${randomUUID()}`;
      const now = new Date().toISOString();
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const secret = `pickup-integration-${suffix}`;
      const areaId = `area-${suffix}`;
      const pointId = `point-${suffix}`;
      const campaignId = `campaign-${suffix}`;
      const planId = `plan-${suffix}`;
      const orderId = `order-${suffix}`;
      const lineId = `line-${suffix}`;
      const skuId = `sku-${suffix}`;
      const managerId = `manager-${suffix}`;
      const pickupCode = String(Number.parseInt(createHmac("sha256", secret).update(`pickup:${orderId}`).digest("hex").slice(0, 12), 16) % 1_000_000).padStart(6, "0");
      await first.saveCampaign({
        id: campaignId,
        title: "integration pickup concurrency",
        serviceAreaId: areaId,
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
      await first.saveServiceArea({ id: areaId, regionCode: "110101", name: "integration", status: "ENABLED", orderEnabled: true, createdAt: now });
      await first.savePickupPoint({ id: pointId, serviceAreaId: areaId, name: "integration", address: "integration", businessHours: "09:00-20:00", pickupInstructions: "integration", latitude: 39.9, longitude: 116.4, contactName: "integration", contactPhone: "13800000000", status: "ACTIVE", capacityPerDay: null, createdAt: now });
      await first.saveDeliveryPlan({ id: planId, campaignId, serviceAreaId: areaId, pickupPointId: pointId, status: "ARRIVED", siteName: "integration", address: "integration", arrivalStartAt: now, arrivalEndAt: now, contactName: null, contactPhone: null, vehicleOrderNo: null, driverName: null, driverPhone: null, vehiclePlate: null, logisticsPlatform: null, estimatedArrivalAt: null, remark: null, confirmedAt: now, bookedAt: now, dispatchedAt: now, arrivedAt: now, createdAt: now, updatedAt: now });
      await first.saveUser({ id: managerId, wechatOpenId: null, status: "ACTIVE", createdAt: now });
      await first.saveInternalStaff({ userId: managerId, staffNo: `STF-${suffix}`, displayName: "integration", phone: "13800000000", role: "PICKUP_MANAGER", status: "ACTIVE", createdBy: null, activatedAt: now, suspendedAt: null, suspensionReason: null, createdAt: now, updatedAt: now });
      await first.replaceStaffPickupPointAssignments(managerId, [{ staffUserId: managerId, pickupPointId: pointId, assignedBy: managerId, createdAt: now, updatedAt: now }]);
      await first.saveOrder({ id: orderId, orderNo: `ORDER-${suffix}`, userId: `customer-${suffix}`, campaignId, serviceAreaId: areaId, pickupPointId: pointId, deliveryPlanId: planId, status: "READY_FOR_PICKUP", totalCents: moneyCents(3000), items: [{ orderLineId: lineId, skuId: skuId, productId: `product-${suffix}`, name: "integration", quantity: 3, unitPriceCents: moneyCents(1000), amountCents: moneyCents(3000), fulfilledQuantity: 3, pickedUpQuantity: 0, exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: moneyCents(0) }], createdAt: now, expiresAt: future, paidAt: now, pickedUpAt: null });
      await first.savePayment({ id: `payment-${suffix}`, orderId, provider: "mock", providerPaymentId: `wx-payment-${suffix}`, status: "SUCCEEDED", amountCents: moneyCents(3000), clientPayload: {}, providerContext: {}, initiationLeaseUntil: null, initiationClaimToken: null, createdAt: now, succeededAt: now });
      await first.saveOrderLines(orderId, [{ id: lineId, catalogSkuId: skuId, productId: `product-${suffix}`, title: "integration", skuName: "one", quantity: 3, unitPriceCents: moneyCents(1000), amountCents: moneyCents(3000) }]);
      const line = (await first.listOrderLinesByOrderForUpdate(orderId))[0]!;
      line.fulfilledQuantity = 3;
      await first.updateOrderLine(line);
      await first.savePickupCredential({ orderId, codeHash: createHmac("sha256", secret).update(pickupCode).digest("hex"), status: "ACTIVE", expiresAt: future });
      await first.saveCommunityPickupWindow({ orderId, deliveryPlanId: planId, arrivedAt: now, deadlineAt: future, status: "ACTIVE", extensionCount: 0, extendedBy: null, extendedAt: null, dispositionBy: null, dispositionAt: null, dispositionNote: null, refundExceptionId: null, lossExceptionId: null });

      const ledger = new LedgerService();
      await ledger.recordPayment(first, (await first.getOrder(orderId))!);
      const firstService = new FulfillmentService(first, secret, ledger);
      const secondService = new FulfillmentService(second, secret, ledger);
      const command = (pickupRequestId: string) => ({ orderId, deliveryPlanId: planId, code: pickupCode, verifierId: managerId, requestedItems: [{ catalogSkuId: skuId, quantity: 1 }], pickupRequestId });
      const sameRequest = await Promise.allSettled([firstService.verify(command("same-request")), secondService.verify(command("same-request"))]);
      expect(sameRequest.filter((value) => value.status === "fulfilled")).toHaveLength(2);
      const differentRequests = await Promise.allSettled([firstService.verify(command("different-request-a")), secondService.verify(command("different-request-b"))]);
      expect(differentRequests.filter((value) => value.status === "fulfilled")).toHaveLength(2);
      expect((await second.listOrderLinesByOrderForUpdate(orderId))[0]?.pickedUpQuantity).toBe(3);
      expect((await second.getOrder(orderId))?.status).toBe("COMPLETED");
      expect(await second.listCommunityPickupReceiptsByOrder(orderId)).toHaveLength(3);
      const pickupEntries = (await second.listLedgerTransactions(orderId)).filter((value) => value.eventType === "PICKUP_CONFIRMED");
      expect(pickupEntries).toHaveLength(3);
      expect(pickupEntries.map((value) => Number(value.lines.find((line) => line.direction === "CREDIT")?.amountCents)).sort()).toEqual([1000, 1000, 1000]);
      await firstService.verify(command("same-request"));
      await secondService.verify(command("different-request-a"));
      expect(await second.listCommunityPickupReceiptsByOrder(orderId)).toHaveLength(3);
      expect((await second.listLedgerTransactions(orderId)).filter((value) => value.eventType === "PICKUP_CONFIRMED")).toHaveLength(3);

      const paymentProvider: PaymentProvider = {
        name: "mock",
        initiate: async () => ({ providerPaymentId: null, clientPayload: {}, providerContext: {} }),
        parseNotification: () => { throw new Error("unused"); },
        refund: async ({ providerRefundNo }) => ({ providerRefundId: `wx-${providerRefundNo}`, status: "SUCCEEDED" }),
        queryRefund: async () => ({ providerRefundId: null, status: "SUCCEEDED" }),
        parseRefundNotification: () => { throw new Error("unused"); },
      };
      const quality = new CommunityQualityService(first);
      const qualityAppStore = MysqlStore.create(databaseUrl!);
      const qualityApp = await buildApp({
        config: loadConfig({ NODE_ENV: "test", SINGLE_WRITER_CONFIRMED: "true" }),
        store: qualityAppStore,
        scheduler: new NoopCampaignScheduler(),
        paymentProvider,
      });
      apiApps.push(qualityApp);
      const qualityRefundCases: CommunityQualityCase[] = [];
      for (const label of ["a", "b"]) {
        const submitted = await quality.submit(orderId, `customer-${suffix}`, { clientRequestId: `quality-${label}-${suffix}`, items: [{ catalogSkuId: skuId, quantity: 1, reason: "QUALITY_CLAIM", description: `integration quality item ${label}` }] }, `quality-submit-${label}-${suffix}`);
        await quality.accept(submitted.id, managerId, "integration accepted", `quality-accept-${label}-${suffix}`);
        const approved = await quality.decide(submitted.id, managerId, true, "integration approved", `quality-decision-${label}-${suffix}`);
        const executed = await qualityApp.inject({
          method: "POST",
          url: `/api/v1/admin/quality-cases/${approved.id}/refund`,
          headers: { "x-demo-user-id": managerId, "x-demo-role": "SUPER_ADMIN" },
        });
        expect(executed.statusCode, executed.body).toBe(200);
        qualityRefundCases.push(executed.json().data as CommunityQualityCase);
      }
      expect(qualityRefundCases.map((value) => value.status)).toEqual(["RESOLVED", "RESOLVED"]);
      const qualityRefunds = await first.listPartialRefundsByOrder(orderId);
      expect(qualityRefunds).toHaveLength(2);
      expect(qualityRefunds.map((value) => Number(value.amountCents))).toEqual([1000, 1000]);
      for (const refund of qualityRefunds) {
        const postings = await second.listLedgerTransactions(refund.id);
        expect(postings).toHaveLength(1);
        expect(postings[0]?.lines).toEqual(expect.arrayContaining([
          expect.objectContaining({ accountCode: "SALES_REVENUE", direction: "DEBIT", amountCents: moneyCents(1000) }),
          expect.objectContaining({ accountCode: "PAYMENT_CLEARING", direction: "CREDIT", amountCents: moneyCents(1000) }),
        ]));
      }

      const residualOrderId = `residual-order-${suffix}`;
      const residualLineId = `residual-line-${suffix}`;
      const originalOrder = (await first.getOrder(orderId))!;
      await first.saveOrder({ ...originalOrder, id: residualOrderId, orderNo: `RES-${suffix}`, userId: `residual-customer-${suffix}`, status: "READY_FOR_PICKUP", totalCents: moneyCents(2000), pickedUpAt: null, items: [{ ...originalOrder.items[0]!, orderLineId: residualLineId, quantity: 2, amountCents: moneyCents(2000), fulfilledQuantity: 2, pickedUpQuantity: 0, exceptionQuantity: 2, refundedQuantity: 0, refundedAmountCents: moneyCents(0) }] });
      await first.saveOrderLines(residualOrderId, [{ id: residualLineId, catalogSkuId: skuId, productId: `product-${suffix}`, title: "integration residual", skuName: "one", quantity: 2, unitPriceCents: moneyCents(1000), amountCents: moneyCents(2000), fulfilledQuantity: 2 }]);
      await first.savePayment({ id: `residual-payment-${suffix}`, orderId: residualOrderId, provider: "mock", providerPaymentId: `wx-residual-payment-${suffix}`, status: "SUCCEEDED", amountCents: moneyCents(2000), clientPayload: {}, providerContext: {}, initiationLeaseUntil: null, initiationClaimToken: null, createdAt: now, succeededAt: now });
      await ledger.recordPayment(first, (await first.getOrder(residualOrderId))!);
      const residualExceptionId = `residual-${suffix}`;
      const residualExceptionItemId = `residual-exception-item-${suffix}`;
      const residualException: FulfillmentException = { id: residualExceptionId, campaignId, orderId: residualOrderId, clientRequestId: "residual", deliveryPlanId: planId, sourceStage: "CUSTOMER_CLAIM", refundAccountingStage: "PRE_REVENUE", status: "REFUND_CONFIRMED", responsibility: "PICKUP_POINT", registeredBy: managerId, confirmedBy: managerId, resolutionNote: "integration unpicked residual", registeredAt: now, confirmedAt: now, items: [{ id: residualExceptionItemId, exceptionId: residualExceptionId, catalogSkuId: skuId, expectedQuantity: 2, acceptedQuantity: 0, rejectedQuantity: 0, shortQuantity: 2, damagedQuantity: 0, reason: "PICKUP_SHORTAGE", description: "integration unpicked residual", evidenceUrl: null }] };
      const residualAllocation: FulfillmentAllocation = { id: `residual-allocation-${suffix}`, exceptionId: residualExceptionId, exceptionItemId: residualExceptionItemId, orderLineId: residualLineId, orderId: residualOrderId, catalogSkuId: skuId, fulfilledQuantity: 0, exceptionQuantity: 2, refundedQuantity: 0, createdAt: now, refundedAt: null };
      await first.saveFulfillmentException(residualException);
      await first.saveFulfillmentAllocations([residualAllocation]);
      const residualPayments = new PaymentService(first, paymentProvider, ledger);
      await residualPayments.executePartialRefund(residualExceptionId, { actorId: managerId, requestId: `residual-refund-${suffix}`, confirmationNote: "integration unpicked residual refund" });
      const residualRefund = (await first.listPartialRefundsByException(residualExceptionId))[0]!;
      expect((await second.listLedgerTransactions(residualRefund.id))[0]?.lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountCode: "CUSTOMER_CONTRACT_LIABILITY", direction: "DEBIT", amountCents: moneyCents(2000) }),
        expect.objectContaining({ accountCode: "PAYMENT_CLEARING", direction: "CREDIT", amountCents: moneyCents(2000) }),
      ]));
    });
    it("keeps a campaign open for an unsettled quality refund and balances mixed same-order refunds", async () => {
      const suffix = `${Date.now()}-${randomUUID()}`;
      const now = new Date().toISOString();
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const campaignId = `closure-campaign-${suffix}`;
      const areaId = `closure-area-${suffix}`;
      const pointId = `closure-point-${suffix}`;
      const planId = `closure-plan-${suffix}`;
      const skuId = `closure-sku-${suffix}`;
      const managerId = `closure-manager-${suffix}`;
      const secret = `closure-pickup-${suffix}`;
      const ledger = new LedgerService();
      const campaign = { id: campaignId, title: "integration refund closure", serviceAreaId: areaId, cutoffAt: now, dispatchAt: now, estimatedArrivalStartAt: now, estimatedArrivalEndAt: now, minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND" as const, items: [], status: "FULFILLING" as const, version: 1, createdAt: now };
      await first.saveCampaign(campaign);
      await first.saveServiceArea({ id: areaId, regionCode: "110101", name: "integration", status: "ENABLED", orderEnabled: true, createdAt: now });
      await first.savePickupPoint({ id: pointId, serviceAreaId: areaId, name: "integration", address: "integration", businessHours: "09:00-20:00", pickupInstructions: "integration", latitude: 39.9, longitude: 116.4, contactName: "integration", contactPhone: "13800000000", status: "ACTIVE", capacityPerDay: null, createdAt: now });
      await first.saveDeliveryPlan({ id: planId, campaignId, serviceAreaId: areaId, pickupPointId: pointId, status: "ARRIVED", siteName: "integration", address: "integration", arrivalStartAt: now, arrivalEndAt: now, contactName: null, contactPhone: null, vehicleOrderNo: null, driverName: null, driverPhone: null, vehiclePlate: null, logisticsPlatform: null, estimatedArrivalAt: null, remark: null, confirmedAt: now, bookedAt: now, dispatchedAt: now, arrivedAt: now, createdAt: now, updatedAt: now });
      await first.saveUser({ id: managerId, wechatOpenId: null, status: "ACTIVE", createdAt: now });
      await first.saveInternalStaff({ userId: managerId, staffNo: `STF-${suffix}`, displayName: "integration", phone: "13800000000", role: "PICKUP_MANAGER", status: "ACTIVE", createdBy: null, activatedAt: now, suspendedAt: null, suspensionReason: null, createdAt: now, updatedAt: now });
      await first.replaceStaffPickupPointAssignments(managerId, [{ staffUserId: managerId, pickupPointId: pointId, assignedBy: managerId, createdAt: now, updatedAt: now }]);

      const seedOrder = async (prefix: string) => {
        const orderId = `${prefix}-order-${suffix}`;
        const lineId = `${prefix}-line-${suffix}`;
        const customerId = `${prefix}-customer-${suffix}`;
        const pickupCode = String(Number.parseInt(createHmac("sha256", secret).update(`pickup:${orderId}`).digest("hex").slice(0, 12), 16) % 1_000_000).padStart(6, "0");
        const order = { id: orderId, orderNo: `${prefix}-${suffix}`, userId: customerId, campaignId, serviceAreaId: areaId, pickupPointId: pointId, deliveryPlanId: planId, status: "READY_FOR_PICKUP" as const, totalCents: moneyCents(2000), items: [{ orderLineId: lineId, skuId, productId: `product-${suffix}`, name: "integration two units", quantity: 2, unitPriceCents: moneyCents(1000), amountCents: moneyCents(2000), fulfilledQuantity: 2, pickedUpQuantity: 0, exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: moneyCents(0) }], createdAt: now, expiresAt: future, paidAt: now, pickedUpAt: null };
        await first.saveOrder(order);
        await first.saveOrderLines(orderId, [{ id: lineId, catalogSkuId: skuId, productId: `product-${suffix}`, title: "integration two units", skuName: "one", quantity: 2, unitPriceCents: moneyCents(1000), amountCents: moneyCents(2000) }]);
        const orderLine = (await first.listOrderLinesByOrderForUpdate(orderId))[0]!;
        orderLine.fulfilledQuantity = 2;
        await first.updateOrderLine(orderLine);
        await first.savePayment({ id: `${prefix}-payment-${suffix}`, orderId, provider: "mock", providerPaymentId: `wx-${prefix}-payment-${suffix}`, status: "SUCCEEDED", amountCents: moneyCents(2000), clientPayload: {}, providerContext: {}, initiationLeaseUntil: null, initiationClaimToken: null, createdAt: now, succeededAt: now });
        await first.savePickupCredential({ orderId, codeHash: createHmac("sha256", secret).update(pickupCode).digest("hex"), status: "ACTIVE", expiresAt: future });
        await first.saveCommunityPickupWindow({ orderId, deliveryPlanId: planId, arrivedAt: now, deadlineAt: future, status: "ACTIVE", extensionCount: 0, extendedBy: null, extendedAt: null, dispositionBy: null, dispositionAt: null, dispositionNote: null, refundExceptionId: null, lossExceptionId: null });
        await ledger.recordPayment(first, order);
        return { orderId, lineId, customerId, pickupCode };
      };
      const waitingOrder = await seedOrder("waiting");
      const mixedOrder = await seedOrder("mixed");
      const fulfillment = new FulfillmentService(first, secret, ledger);
      const quality = new CommunityQualityService(first);
      const submittedRefundNos: string[] = [];
      let callbackNotification: RefundNotification | null = null;
      const pendingProvider: PaymentProvider = {
        name: "mock",
        initiate: async () => ({ providerPaymentId: null, clientPayload: {}, providerContext: {} }),
        parseNotification: () => { throw new Error("unused"); },
        refund: async ({ providerRefundNo }) => {
          submittedRefundNos.push(providerRefundNo);
          return { providerRefundId: `wx-${providerRefundNo}`, status: "PROCESSING" };
        },
        queryRefund: async () => ({ providerRefundId: null, status: "SUCCEEDED" }),
        parseRefundNotification: () => {
          if (!callbackNotification) throw new Error("refund callback not configured");
          return callbackNotification;
        },
      };
      const payments = new PaymentService(first, pendingProvider, ledger);
      const apiAppStore = MysqlStore.create(databaseUrl!);
      const apiApp = await buildApp({
        config: loadConfig({ NODE_ENV: "test", SINGLE_WRITER_CONFIRMED: "true" }),
        store: apiAppStore,
        scheduler: new NoopCampaignScheduler(),
        paymentProvider: pendingProvider,
      });
      apiApps.push(apiApp);
      const financeHeaders = { "x-demo-user-id": managerId, "x-demo-role": "SUPER_ADMIN" };
      const executeQualityRefund = async (qualityCaseId: string) => {
        const response = await apiApp.inject({
          method: "POST",
          url: `/api/v1/admin/quality-cases/${qualityCaseId}/refund`,
          headers: financeHeaders,
        });
        expect(response.statusCode, response.body).toBe(200);
        return { data: response.json().data, requestId: String(response.headers["x-request-id"]) };
      };
      const pickOne = (order: typeof waitingOrder, requestId: string) => fulfillment.verify({ orderId: order.orderId, deliveryPlanId: planId, code: order.pickupCode, verifierId: managerId, requestedItems: [{ catalogSkuId: skuId, quantity: 1 }], pickupRequestId: requestId });
      const approveOneQualityRefund = async (order: typeof waitingOrder, label: string) => {
        const submitted = await quality.submit(order.orderId, order.customerId, { clientRequestId: `quality-${label}-${suffix}`, items: [{ catalogSkuId: skuId, quantity: 1, reason: "QUALITY_CLAIM", description: `integration quality ${label}` }] }, `quality-submit-${label}-${suffix}`);
        await quality.accept(submitted.id, managerId, "integration accepted", `quality-accept-${label}-${suffix}`);
        return quality.decide(submitted.id, managerId, true, "integration approved", `quality-decision-${label}-${suffix}`);
      };
      const settleRefund = async (refundId: string, label: string) => {
        const refund = await first.getPartialRefund(refundId);
        expect(refund?.status).toBe("PROCESSING");
        callbackNotification = { eventId: `refund-success-${label}-${suffix}`, type: "REFUND.SUCCESS", providerRefundNo: refund!.providerRefundNo, providerRefundId: `wx-${refund!.providerRefundNo}`, status: "SUCCEEDED", bodyHash: `refund-hash-${label}-${suffix}` };
        const callback = await apiApp.inject({ method: "POST", url: "/api/v1/payments/wechat/refund-notify", payload: { event: "integration provider success" } });
        expect(callback.statusCode, callback.body).toBe(200);
        const replay = await apiApp.inject({ method: "POST", url: "/api/v1/payments/wechat/refund-notify", payload: { event: "integration provider success" } });
        expect(replay.statusCode, replay.body).toBe(200);
        expect((await second.listLedgerTransactions(refundId))).toHaveLength(1);
      };

      expect((await first.listOrderLinesByOrderForUpdate(waitingOrder.orderId))[0]).toMatchObject({ quantity: 2, fulfilledQuantity: 2, pickedUpQuantity: 0, exceptionQuantity: 0, refundedQuantity: 0 });
      await pickOne(waitingOrder, `waiting-first-${suffix}`);
      expect((await first.listOrderLinesByOrderForUpdate(waitingOrder.orderId))[0]).toMatchObject({ quantity: 2, fulfilledQuantity: 2, pickedUpQuantity: 1, exceptionQuantity: 0, refundedQuantity: 0 });
      const waitingCase = await approveOneQualityRefund(waitingOrder, "pending");
      const firstWaitingExecution = await executeQualityRefund(waitingCase.id);
      expect(firstWaitingExecution.data).toMatchObject({ status: "REFUNDING", financeRefundStatus: "PROCESSING", financeRefundStatuses: ["PROCESSING"] });
      expect((await first.listFulfillmentAllocations(waitingCase.refundExceptionId!))[0]).toMatchObject({ exceptionQuantity: 1, refundedQuantity: 0 });
      expect(submittedRefundNos).toHaveLength(1);
      expect((await first.listOrderLinesByOrderForUpdate(waitingOrder.orderId))[0]).toMatchObject({ quantity: 2, fulfilledQuantity: 2, pickedUpQuantity: 1, exceptionQuantity: 0, refundedQuantity: 0 });
      await pickOne(waitingOrder, `waiting-last-${suffix}`);
      expect((await first.listOrderLinesByOrderForUpdate(waitingOrder.orderId))[0]).toMatchObject({ quantity: 2, fulfilledQuantity: 2, pickedUpQuantity: 2, exceptionQuantity: 0, refundedQuantity: 0 });
      expect((await first.getOrder(waitingOrder.orderId))?.status).toBe("COMPLETED");
      expect((await first.getCampaign(campaignId))?.status).toBe("FULFILLING");
      const postCompletionCase = await quality.submit(waitingOrder.orderId, waitingOrder.customerId, { clientRequestId: `quality-after-completion-${suffix}`, items: [{ catalogSkuId: skuId, quantity: 1, reason: "QUALITY_CLAIM", description: "claim after completed pickup" }] }, `quality-submit-after-completion-${suffix}`);
      expect(postCompletionCase.status).toBe("REGISTERED");
      await quality.accept(postCompletionCase.id, managerId, "integration accepted", `quality-accept-after-completion-${suffix}`);
      expect((await quality.decide(postCompletionCase.id, managerId, false, "integration reviewed", `quality-reject-after-completion-${suffix}`)).status).toBe("REJECTED");
      const waitingRefund = (await first.listPartialRefundsByException(waitingCase.refundExceptionId!))[0]!;
      await settleRefund(waitingRefund.id, "waiting");
      expect((await first.listFulfillmentAllocations(waitingCase.refundExceptionId!))[0]).toMatchObject({ exceptionQuantity: 1, refundedQuantity: 1 });
      expect((await first.listOrderLinesByOrderForUpdate(waitingOrder.orderId))[0]).toMatchObject({ quantity: 2, fulfilledQuantity: 2, pickedUpQuantity: 2, exceptionQuantity: 0, refundedQuantity: 1 });
      expect((await first.getCommunityQualityCaseForUpdate(waitingCase.id))?.status).toBe("REFUNDING");
      const waitingConfirmation = await executeQualityRefund(waitingCase.id);
      expect(waitingConfirmation.data.status).toBe("RESOLVED");
      expect(submittedRefundNos.filter(value => value === waitingRefund.providerRefundNo)).toHaveLength(1);
      expect(await first.findLatestAudit("FULFILLMENT_EXCEPTION", waitingCase.refundExceptionId!, "PARTIAL_REFUND_EXECUTED")).toMatchObject({ actorId: managerId, requestId: firstWaitingExecution.requestId });
      expect(await first.findLatestAudit("COMMUNITY_QUALITY_CASE", waitingCase.id, "COMMUNITY_QUALITY_CASE_FINANCE_EXECUTED")).toMatchObject({ actorId: managerId, requestId: waitingConfirmation.requestId });
      expect((await first.getCampaign(campaignId))?.status).toBe("FULFILLING");

      await pickOne(mixedOrder, `mixed-first-${suffix}`);
      await fulfillment.verify({ orderId: mixedOrder.orderId, deliveryPlanId: planId, code: mixedOrder.pickupCode, verifierId: managerId, requestedItems: [{ catalogSkuId: skuId, quantity: 1 }], pickupRequestId: `mixed-first-${suffix}` });
      const mixedCase = await approveOneQualityRefund(mixedOrder, "mixed");
      expect((await executeQualityRefund(mixedCase.id)).data.status).toBe("REFUNDING");
      const qualityRefund = (await first.listPartialRefundsByException(mixedCase.refundExceptionId!))[0]!;
      await settleRefund(qualityRefund.id, "mixed-quality");
      expect((await executeQualityRefund(mixedCase.id)).data.status).toBe("RESOLVED");
      expect(submittedRefundNos.filter(value => value === qualityRefund.providerRefundNo)).toHaveLength(1);

      const residualExceptionId = `mixed-residual-${suffix}`;
      const residualExceptionItemId = `mixed-residual-item-${suffix}`;
      await first.saveFulfillmentException({ id: residualExceptionId, campaignId, orderId: mixedOrder.orderId, clientRequestId: `mixed-residual-${suffix}`, deliveryPlanId: planId, sourceStage: "PICKUP_ARRIVAL", refundAccountingStage: "PRE_REVENUE", status: "REFUND_CONFIRMED", responsibility: "PICKUP_POINT", registeredBy: managerId, confirmedBy: managerId, resolutionNote: "integration remaining unpicked unit", registeredAt: now, confirmedAt: now, items: [{ id: residualExceptionItemId, exceptionId: residualExceptionId, catalogSkuId: skuId, expectedQuantity: 1, acceptedQuantity: 0, rejectedQuantity: 0, shortQuantity: 1, damagedQuantity: 0, reason: "PICKUP_SHORTAGE", description: "integration remaining unpicked unit", evidenceUrl: null }] });
      await first.saveFulfillmentAllocations([{ id: `mixed-residual-allocation-${suffix}`, exceptionId: residualExceptionId, exceptionItemId: residualExceptionItemId, orderLineId: mixedOrder.lineId, orderId: mixedOrder.orderId, catalogSkuId: skuId, fulfilledQuantity: 0, exceptionQuantity: 1, refundedQuantity: 0, createdAt: now, refundedAt: null }]);
      await payments.executePartialRefund(residualExceptionId, { actorId: managerId, requestId: `mixed-residual-refund-${suffix}`, confirmationNote: "integration unpicked residual refund" });
      const residualRefund = (await first.listPartialRefundsByException(residualExceptionId))[0]!;
      await settleRefund(residualRefund.id, "mixed-residual");
      const mixedRefunds = await first.listPartialRefundsByOrder(mixedOrder.orderId);
      expect(mixedRefunds.map((value) => Number(value.amountCents)).sort()).toEqual([1000, 1000]);
      expect((await second.getOrder(mixedOrder.orderId))?.status).toBe("REFUNDED");
      const pickupEntries = (await second.listLedgerTransactions(mixedOrder.orderId)).filter((value) => value.eventType === "PICKUP_CONFIRMED");
      expect(pickupEntries).toHaveLength(1);
      const journal = [
        ...(await second.listLedgerTransactions(mixedOrder.orderId)),
        ...(await Promise.all(mixedRefunds.map((refund) => second.listLedgerTransactions(refund.id)))).flat(),
      ];
      const net = (accountCode: string) => journal.flatMap((entry) => entry.lines).filter((line) => line.accountCode === accountCode).reduce((sum, line) => sum + (line.direction === "CREDIT" ? 1 : -1) * Number(line.amountCents), 0);
      expect(net("SALES_REVENUE")).toBe(0);
      expect(net("CUSTOMER_CONTRACT_LIABILITY")).toBe(0);
      expect(net("PAYMENT_CLEARING")).toBe(0);
      expect((await second.getCampaign(campaignId))?.status).toBe("COMPLETED");
    }, 30_000);
    it("paginates past 500 consented service-area interests in MySQL and filters privacy before limiting", async () => {
      const suffix = `${Date.now()}-${randomUUID()}`;
      const before = await first.listServiceAreaInterestPage({ page: 1, pageSize: 1, status: "NEW" });
      const newest = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;
      await first.transaction(async (store) => {
        for (let index = 0; index < 501; index += 1) {
          const createdAt = new Date(newest - index).toISOString();
          const value: ServiceAreaInterest = { id: `integration-interest-${suffix}-${index}`, userId: `integration-user-${suffix}`, regionText: "integration", contactName: "integration", contactPhone: "13800000000", privacyVersion: "integration-v1", privacyConsentedAt: createdAt, status: "NEW", statusNote: null, statusChangedBy: null, statusChangedAt: null, createdAt };
          await store.saveServiceAreaInterest(value);
        }
        await store.saveServiceAreaInterest({ id: `integration-interest-no-consent-${suffix}`, userId: `integration-user-${suffix}`, regionText: "integration", contactName: "integration", contactPhone: "13800000000", privacyVersion: null, privacyConsentedAt: null, status: "NEW", statusNote: null, statusChangedBy: null, statusChangedAt: null, createdAt: new Date(newest + 86_400_000).toISOString() });
      });
      const last = await second.listServiceAreaInterestPage({ page: 26, pageSize: 20, status: "NEW" });
      expect(last.total).toBe(before.total + 501);
      expect(last.items).toHaveLength(1);
      expect(last.items[0]?.id).toBe(`integration-interest-${suffix}-500`);
    });
    it("uses MySQL UTC_TIMESTAMP(3) to reject an expired claim across pools", async () => {
      const id = `integration-notification-${Date.now()}`;
      const row = notification(id);
      // Claim ordering is by the earliest due time, so unrelated pending rows
      // left by concurrent integration files cannot occupy this test's limit.
      row.nextAttemptAt = "1900-01-01T00:00:00.000Z";
      const claim = await first.transaction(async (store) => {
        await store.createOrderNotificationIfAbsent(row);
        return (await store.claimPendingOrderNotifications(
          1,
          1,
          `claim-${id}`,
        )).find((value) => value.id === id);
      });
      expect(claim).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        await expect(second.beginOrderNotificationSubmission({
          id,
          claimToken: `claim-${id}`,
          attemptId: `attempt-${id}`,
        })).resolves.toBeNull();
      } finally {
        // The workflow runs this suite once in `check` and again for coverage
        // against the same database. Finish our expired outbox row so the
        // second run cannot claim test data left by the first run.
        const cleanupToken = `cleanup-${id}`;
        const cleanupAttempt = `cleanup-attempt-${id}`;
        const cleanupClaim = (await first.claimPendingOrderNotifications(
          1,
          60_000,
          cleanupToken,
        )).find((value) => value.id === id);
        if (cleanupClaim) {
          await first.beginOrderNotificationSubmission({
            id,
            claimToken: cleanupToken,
            attemptId: cleanupAttempt,
          });
          await first.markOrderNotificationSentIfSubmission(
            id,
            cleanupAttempt,
            null,
          );
        }
      }
    });
    it("connects to the real Redis queue and schedules a close job", async () => {
      await expect(scheduler.health()).resolves.toBe("ok");
      await expect(
        scheduler.scheduleClose(
          `integration-${Date.now()}`,
          new Date(Date.now() + 60_000).toISOString(),
          1,
        ),
      ).resolves.toBeUndefined();
    });
    it("allows only one API replica to own a reconciliation cycle", async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const owner = scheduler.runReconciliation(() => held);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(secondScheduler.runReconciliation(async () => undefined)).resolves.toBe(false);
      release();
      await expect(owner).resolves.toBe(true);
      await expect(secondScheduler.runReconciliation(async () => undefined)).resolves.toBe(true);
    });
    it("detects a lost reconciliation lease before later workflow steps", async () => {
      const control = new Redis(redisUrl!, { maxRetriesPerRequest: null });
      try {
        await expect(scheduler.runReconciliation(async (assertOwned) => {
          await assertOwned();
          await control.del("hometown:reconciliation:lease");
          await assertOwned();
        })).rejects.toThrow(/ownership was lost/);
      } finally {
        await control.quit();
      }
    });
  },
);
