import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MysqlStore } from "./modules/core/mysql-store.js";
import { RedisCampaignScheduler } from "./modules/campaigns/campaign-scheduler.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const redisUrl = process.env.INTEGRATION_REDIS_URL;
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
