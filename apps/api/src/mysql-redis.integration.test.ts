import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MysqlStore } from "./modules/core/mysql-store.js";
import { RedisCampaignScheduler } from "./modules/campaigns/campaign-scheduler.js";
import type { OrderNotification } from "./modules/core/types.js";

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
    beforeAll(() => {
      first = MysqlStore.create(databaseUrl!);
      second = MysqlStore.create(databaseUrl!);
      scheduler = new RedisCampaignScheduler(redisUrl!, async () => undefined);
    });
    afterAll(async () => {
      await Promise.all([first.close(), second.close(), scheduler.close()]);
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
    it("uses MySQL UTC_TIMESTAMP(3) to reject an expired claim across pools", async () => {
      const id = `integration-notification-${Date.now()}`;
      await first.createOrderNotificationIfAbsent(notification(id));
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
  },
);
