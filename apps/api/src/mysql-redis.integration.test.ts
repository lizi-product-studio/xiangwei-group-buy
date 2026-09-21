import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import { MysqlStore } from "./modules/core/mysql-store.js";
import { RedisCampaignScheduler } from "./modules/campaigns/campaign-scheduler.js";
import { FulfillmentService } from "./modules/fulfillment/fulfillment-service.js";
import { LedgerService } from "./modules/finance/ledger-service.js";
import type { OrderNotification } from "./modules/core/types.js";
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
    beforeAll(() => {
      first = MysqlStore.create(databaseUrl!);
      second = MysqlStore.create(databaseUrl!);
      scheduler = new RedisCampaignScheduler(redisUrl!, async () => undefined);
      secondScheduler = new RedisCampaignScheduler(redisUrl!, async () => undefined);
    });
    afterAll(async () => {
      await Promise.all([first.close(), second.close(), scheduler.close(), secondScheduler.close()]);
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
      await first.saveOrderLines(orderId, [{ id: lineId, catalogSkuId: skuId, productId: `product-${suffix}`, title: "integration", skuName: "one", quantity: 3, unitPriceCents: moneyCents(1000), amountCents: moneyCents(3000) }]);
      const line = (await first.listOrderLinesByOrderForUpdate(orderId))[0]!;
      line.fulfilledQuantity = 3;
      await first.updateOrderLine(line);
      await first.savePickupCredential({ orderId, codeHash: createHmac("sha256", secret).update(pickupCode).digest("hex"), status: "ACTIVE", expiresAt: future });
      await first.saveCommunityPickupWindow({ orderId, deliveryPlanId: planId, arrivedAt: now, deadlineAt: future, status: "ACTIVE", extensionCount: 0, extendedBy: null, extendedAt: null, dispositionBy: null, dispositionAt: null, dispositionNote: null, refundExceptionId: null, lossExceptionId: null });

      const firstService = new FulfillmentService(first, secret, new LedgerService());
      const secondService = new FulfillmentService(second, secret, new LedgerService());
      const command = (pickupRequestId: string) => ({ orderId, deliveryPlanId: planId, code: pickupCode, verifierId: managerId, requestedItems: [{ catalogSkuId: skuId, quantity: 1 }], pickupRequestId });
      const sameRequest = await Promise.allSettled([firstService.verify(command("same-request")), secondService.verify(command("same-request"))]);
      expect(sameRequest.filter((value) => value.status === "fulfilled")).toHaveLength(2);
      const differentRequests = await Promise.allSettled([firstService.verify(command("different-request-a")), secondService.verify(command("different-request-b"))]);
      expect(differentRequests.filter((value) => value.status === "fulfilled")).toHaveLength(2);
      expect((await second.listOrderLinesByOrderForUpdate(orderId))[0]?.pickedUpQuantity).toBe(3);
      expect((await second.getOrder(orderId))?.status).toBe("PICKED_UP");
      expect(await second.listCommunityPickupReceiptsByOrder(orderId)).toHaveLength(3);
      expect((await second.listLedgerTransactions(orderId)).filter((value) => value.eventType === "PICKUP_CONFIRMED")).toHaveLength(1);
      await firstService.verify(command("same-request"));
      await secondService.verify(command("different-request-a"));
      expect(await second.listCommunityPickupReceiptsByOrder(orderId)).toHaveLength(3);
      expect((await second.listLedgerTransactions(orderId)).filter((value) => value.eventType === "PICKUP_CONFIRMED")).toHaveLength(1);
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
