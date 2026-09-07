import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";

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
    app = await buildApp({
      config,
      store: new MemoryStore(false),
      wechatCodeExchange: { exchange: async () => ({ openId: "session-routing-user" }) },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/login",
      payload: { code: "wechat-code", privacyAccepted: true, privacyVersion: config.PRIVACY_NOTICE_VERSION },
    });
    expect(login.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${login.json().data.accessToken as string}` };
    for (let visit = 0; visit < 3; visit += 1) {
      const orders = await app.inject({ method: "GET", url: "/api/v1/orders", headers });
      expect(orders.statusCode, orders.body).toBe(200);
      expect(orders.json().data).toEqual([]);
    }
    const admin = await app.inject({ method: "GET", url: "/api/v1/admin/staff", headers });
    expect(admin.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/orders", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers, payload: {} })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/v1/orders", headers })).statusCode).toBe(401);
  });
});
