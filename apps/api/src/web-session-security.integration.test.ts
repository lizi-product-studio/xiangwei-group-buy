import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MysqlStore } from "./modules/core/mysql-store.js";
import { NoopCampaignScheduler } from "./modules/campaigns/campaign-scheduler.js";
import { createAdminCredential } from "./modules/auth/admin-auth.js";
import { StaffHttpClient, solveProof } from "./modules/auth/staff-http.test-helper.js";
import { LoginProtection, type ChallengeContext } from "./modules/auth/login-protection.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const redisUrl = process.env.INTEGRATION_REDIS_URL;
describe.skipIf(!databaseUrl || !redisUrl)("real MySQL/Redis staff security", () => {
  it("shares one-use proof consumption and total password-work admission between API instances", async () => {
    const left = new LoginProtection(8, redisUrl); const right = new LoginProtection(8, redisUrl);
    await left.initialize(); await right.initialize();
    try {
      const context: ChallengeContext = { origin: "https://admin.liziqi.icu", browser: randomUUID(), subject: "synthetic", purpose: "login" };
      const proof = left.issue(context); const nonce = solveProof(proof.challenge, proof.bits);
      const results = await Promise.allSettled([left.run(context, proof.challenge, nonce, "one", async () => "ok"), right.run(context, proof.challenge, nonce, "two", async () => "ok")]);
      expect(results.filter(value => value.status === "fulfilled")).toHaveLength(1);
      expect(results.find(value => value.status === "rejected")).toMatchObject({ reason: { code: "AUTH_CHALLENGE_INVALID" } });
      let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
      const started: Promise<unknown>[] = []; let active = 0;
      for (let index = 0; index < 4; index++) {
        const instance = index % 2 ? left : right; const issued = instance.issue(context);
        started.push(instance.run(context, issued.challenge, solveProof(issued.challenge, 8), `synthetic-${index}`, async () => { active++; return gate; }));
      }
      await expect.poll(() => active).toBe(4);
      const extra = right.issue(context);
      try { await expect(right.run(context, extra.challenge, solveProof(extra.challenge, 8), "synthetic-extra", async () => "forbidden")).rejects.toMatchObject({ code: "AUTH_BUSY" }); }
      finally { release(); await Promise.all(started); }
      const fresh = left.issue(context);
      await expect(left.run(context, fresh.challenge, solveProof(fresh.challenge, 8), "synthetic-extra", async () => "immediate")).resolves.toBe("immediate");
    } finally { left.close(); right.close(); }
  });

  it("persists cookie bindings, rotates step-up sessions, and revokes writes across independent pools", async () => {
    const store = MysqlStore.create(databaseUrl!);
    const otherStore = MysqlStore.create(databaseUrl!);
    const suffix = randomUUID().replaceAll("-", ""); const username = `sec.${suffix}`;
    const now = new Date().toISOString(); const password = "synthetic integration password";
    await store.transaction(async scoped => {
      await scoped.saveUser({ id: username, wechatOpenId: null, status: "ACTIVE", createdAt: now });
      await scoped.saveInternalStaff({ userId: username, staffNo: username, displayName: "合成安全验收", phone: "13800138000", role: "SUPER_ADMIN", status: "ACTIVE", createdBy: null, activatedAt: now, suspendedAt: null, suspensionReason: null, authorizationVersion: 1, createdAt: now, updatedAt: now });
      await scoped.saveAdminCredential(await createAdminCredential(username, username, password));
    });
    const config = loadConfig({ NODE_ENV: "test", DATA_STORE: "mysql", DATABASE_URL: databaseUrl, QUEUE_DRIVER: "redis", REDIS_URL: redisUrl, REQUIRE_HTTPS: "true", SINGLE_WRITER_CONFIRMED: "true", STAFF_CHALLENGE_BITS: "8" });
    const left = await buildApp({ config, store, scheduler: new NoopCampaignScheduler() });
    const right = await buildApp({ config, store: otherStore, scheduler: new NoopCampaignScheduler() });
    try {
      const client = new StaffHttpClient(left, "https://admin.liziqi.icu");
      expect((await client.login(username, password)).statusCode).toBe(200);
      const old = client.headers();
      expect((await right.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: old })).statusCode).toBe(200);
      expect((await client.reauthenticate(password)).statusCode).toBe(200);
      const fresh = client.headers();
      expect((await right.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: old })).statusCode).toBe(401);
      expect((await right.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: fresh })).statusCode).toBe(200);
      const changed = await client.send({ method: "POST", url: "/api/v1/admin/me/change-password", payload: { currentPassword: password, newPassword: `${password} changed`, ...await client.proof("password") } });
      expect(changed.statusCode, changed.body).toBe(200);
      expect((await right.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: fresh })).statusCode).toBe(401);
      const current = client.headers();
      expect((await right.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: current })).statusCode).toBe(200);
      await otherStore.deleteAuthSessionsByUser(username);
      expect((await client.send({ method: "POST", url: "/api/v1/admin/service-areas", payload: { regionCode: "110101" } })).statusCode).toBe(401);
    } finally { await left.close(); await right.close(); }
  }, 30000);
});
