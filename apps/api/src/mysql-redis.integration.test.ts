import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MysqlStore } from "./modules/core/mysql-store.js";
import { RedisCampaignScheduler } from "./modules/campaigns/campaign-scheduler.js";
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
    it("uses MySQL UTC_TIMESTAMP(3) to reject an expired claim across pools", async () => {
      const id = `integration-notification-${Date.now()}`;
      const row = notification(id);
      // Claim ordering is by the earliest due time, so unrelated pending rows
      // left by concurrent integration files cannot occupy this test's limit.
      row.nextAttemptAt = "1900-01-01T00:00:00.000Z";
      await first.createOrderNotificationIfAbsent(row);
      const claim = (await first.claimPendingOrderNotifications(
        1,
        1,
        `claim-${id}`,
      )).find((value) => value.id === id);
      expect(claim).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(second.beginOrderNotificationSubmission({
        id,
        claimToken: `claim-${id}`,
        attemptId: `attempt-${id}`,
      })).resolves.toBeNull();
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
