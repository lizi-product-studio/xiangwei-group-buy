import { createHash } from "node:crypto";
import { StaffHttpClient } from "./modules/auth/staff-http.test-helper.js";
import { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createAdminCredential } from "./modules/auth/admin-auth.js";
import { MemoryStore } from "./modules/core/store.js";

vi.mock("ioredis", () => ({
  Redis: vi.fn(() => { throw new Error("Staff login must not open a Redis client"); }),
}));

describe("shared staff login without failed-password cooldown", () => {
  it.each([
    ["admin.liziqi.icu", "SUPER_ADMIN"],
    ["saas.liziqi.icu", "PICKUP_MANAGER"],
  ] as const)("allows immediate correct-password login after repeated failures at %s", async (host, role) => {
    const store = new MemoryStore(false);
    const now = new Date().toISOString();
    const userId = `retry-${role}`;
    const username = `retry.${role.toLowerCase()}`;
    await store.saveUser({ id: userId, wechatOpenId: null, status: "ACTIVE", createdAt: now });
    await store.replaceUserRoles(userId, [role]);
    await store.saveInternalStaff({
      userId, staffNo: `STF-${role}`, displayName: "登录重试验收", phone: "13800138000",
      role, status: "ACTIVE", createdBy: null, activatedAt: now, suspendedAt: null,
      suspensionReason: null, authorizationVersion: 1, createdAt: now, updatedAt: now,
    });
    await store.saveAdminCredential(await createAdminCredential(username, userId, "correct retry password", [role]));
    const app = await buildApp({
      config: loadConfig({
        NODE_ENV: "test", REQUIRE_HTTPS: "true", STAFF_CHALLENGE_BITS: "8", QUEUE_DRIVER: "memory", RATE_LIMIT_MAX: "10",
        REDIS_URL: "redis://127.0.0.1:16379",
      }),
      store,
    });
    const client = new StaffHttpClient(app, `https://${host}`);
    try {
      // Exceed the former five-account and twenty-IP failure limits, while
      // ordinary endpoints still use the configured ten-request threshold.
      for (let attempt = 0; attempt < 22; attempt += 1) {
        const failed = await client.login(username, "incorrect retry password");
        expect(failed.statusCode, failed.body).toBe(401);
        expect(failed.json()).toMatchObject({ code: "INVALID_CREDENTIALS", message: "账号或密码不正确" });
        expect(failed.headers).not.toHaveProperty("retry-after");
        expect(failed.json()).not.toHaveProperty("data.accessToken");
      }
      const login = await client.login(username, "correct retry password");
      expect(login.statusCode, login.body).toBe(200);
      expect(login.json().data).toMatchObject({ nextAction: "LOGIN", userId, roles: [role] });
      expect(login.json().data).not.toHaveProperty("accessToken");
      const token = login.cookies.find(cookie => cookie.name === "__Host-staff-session")!.value;
      const tokenHash = createHash("sha256").update(token).digest("hex");
      expect(await store.getAuthSession(tokenHash)).toMatchObject({ userId, roles: [role] });
      expect(Redis).not.toHaveBeenCalled();

      const ready = await app.inject({ method: "GET", url: "/health/ready", headers: { "x-forwarded-proto": "https" } });
      expect(ready.statusCode, ready.body).toBe(200);
      expect(ready.json().dependencies.loginProtection).toBe("ok");
      for (let request = 1; request < 10; request += 1) {
        expect((await app.inject({ method: "GET", url: "/health/live", headers: { "x-forwarded-proto": "https" } })).statusCode).toBe(200);
      }
      const limited = await app.inject({ method: "GET", url: "/health/live", headers: { "x-forwarded-proto": "https" } });
      expect(limited.statusCode, limited.body).toBe(429);
      expect(limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    } finally {
      await app.close();
    }
  });
});
