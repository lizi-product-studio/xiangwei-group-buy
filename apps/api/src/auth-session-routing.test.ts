import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";
import { createAdminCredential } from "./modules/auth/admin-auth.js";

describe("WeChat session routing through the shared authentication hook", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => app?.close());

  it("keeps a consumer logged in across protected reads, rejects admin access, and revokes on logout", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AUTH_PROVIDER: "wechat",
      WECHAT_APP_ID: "test-wechat-app",
      WECHAT_APP_SECRET: "test-wechat-secret",
    });
    const store = new MemoryStore(false);
    const snapshotSpy = vi.spyOn(store, "readSnapshot");
    app = await buildApp({
      config,
      store,
      wechatPhoneExchange: { exchange: async () => ({ phoneNumber: "13800138000", phoneVerifiedAt: new Date().toISOString() }) },
      wechatCodeExchange: { exchange: async () => ({ openId: "session-routing-user" }) },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/login",
      payload: { phoneCode: "phone-code", code: "wechat-code", privacyAccepted: true, privacyVersion: config.PRIVACY_NOTICE_VERSION },
    });
    expect(login.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${login.json().data.accessToken as string}` };
    snapshotSpy.mockClear();
    for (let visit = 0; visit < 3; visit += 1) {
      const orders = await app.inject({ method: "GET", url: "/api/v1/orders", headers });
      expect(orders.statusCode, orders.body).toBe(200);
      expect(orders.json().data).toEqual([]);
      expect(snapshotSpy).toHaveBeenCalledTimes(visit + 1);
    }
    const admin = await app.inject({ method: "GET", url: "/api/v1/admin/staff", headers });
    expect(admin.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/orders", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers, payload: {} })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/v1/orders", headers })).statusCode).toBe(401);
  });
  it("returns only phoneRequired before binding and rejects legacy consumer sessions", async () => {
    const config = loadConfig({ NODE_ENV: "test", AUTH_PROVIDER: "wechat", WECHAT_APP_ID: "test-wechat-app", WECHAT_APP_SECRET: "test-wechat-secret" });
    const store = new MemoryStore(false);
    const phoneExchange = vi.fn(async () => ({ phoneNumber: "13800138000", phoneVerifiedAt: new Date().toISOString() }));
    app = await buildApp({ config, store, wechatCodeExchange: { exchange: async () => ({ openId: "legacy" }) }, wechatPhoneExchange: { exchange: phoneExchange } });
    const payload = { code: "identity-code", privacyAccepted: true, privacyVersion: config.PRIVACY_NOTICE_VERSION };
    const first = await app.inject({ method: "POST", url: "/api/v1/auth/wechat/login", payload: { ...payload, phoneNumber: "13900139000", openid: "forged" } });
    expect(first.json().data).toEqual({ phoneRequired: true });
    expect(await store.findUserByWechatOpenId("legacy")).toBeNull();
    expect(phoneExchange).not.toHaveBeenCalled();
    await store.saveUser({ id: "legacy-user", wechatOpenId: "legacy", status: "ACTIVE", createdAt: new Date().toISOString() });
    const oldToken = "legacy-token".repeat(4);
    await store.saveAuthSession({ tokenHash: createHash("sha256").update(oldToken).digest("hex"), userId: "legacy-user", roles: ["USER"], authorizationVersion: 0, expiresAt: new Date(Date.now()+60_000).toISOString() });
    expect((await app.inject({ method: "GET", url: "/api/v1/orders", headers: { authorization: `Bearer ${oldToken}` } })).statusCode).toBe(401);
    const bound = await app.inject({ method: "POST", url: "/api/v1/auth/wechat/login", payload: { ...payload, phoneCode: "phone-code" } });
    expect(bound.json().data).toMatchObject({ phoneRequired: false, userId: "legacy-user" });
    expect(phoneExchange).toHaveBeenCalledExactlyOnceWith("phone-code", "legacy");
  });

  it("revokes a stale staff session after the authentication snapshot closes", async () => {
    const store = new MemoryStore(false);
    const snapshotSpy = vi.spyOn(store, "readSnapshot");
    const now = new Date().toISOString();
    const token = "stale-staff-session-token-0123456789abcdef";
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await store.saveUser({ id: "stale-staff", wechatOpenId: null, status: "ACTIVE", createdAt: now });
    await store.saveInternalStaff({
      userId: "stale-staff", staffNo: "S-STALE", displayName: "测试员工", phone: "13800138000",
      role: "OPERATOR", status: "ACTIVE", createdBy: null, activatedAt: now,
      suspendedAt: null, suspensionReason: null, authorizationVersion: 2, createdAt: now, updatedAt: now,
    });
    await store.saveAdminCredential(await createAdminCredential("stale-staff", "stale-staff", "test-only-password-123", ["OPERATOR"], false, 2));
    await store.saveAuthSession({ tokenHash, userId: "stale-staff", roles: ["OPERATOR"], authorizationVersion: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
    snapshotSpy.mockClear();

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/staff", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(401);
    expect(snapshotSpy).toHaveBeenCalledOnce();
    expect(await store.getAuthSession(tokenHash)).toBeNull();
  });

});
