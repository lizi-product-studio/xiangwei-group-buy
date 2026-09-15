import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";

describe("consumer profile and homepage merchandising APIs", () => {
  let app: FastifyInstance | undefined;
  let directory = "";
  afterEach(async () => {
    await app?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("updates a consumer profile with optimistic version checks", async () => {
    const store = new MemoryStore(false);
    await store.saveUser({ id: "consumer", wechatOpenId: "open-id", status: "ACTIVE", createdAt: new Date().toISOString() });
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
    const headers = { "x-demo-user-id": "consumer", "x-demo-role": "USER" };
    const initial = await app.inject({ method: "GET", url: "/api/v1/me/profile", headers });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().data).toMatchObject({ displayName: "微信用户", profileVersion: 0 });
    const changed = await app.inject({ method: "PATCH", url: "/api/v1/me/profile", headers, payload: { displayName: "栗子", avatarUrl: null, expectedVersion: 0 } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().data).toMatchObject({ displayName: "栗子", profileVersion: 1 });
    const stale = await app.inject({ method: "PATCH", url: "/api/v1/me/profile", headers, payload: { displayName: "旧资料", avatarUrl: null, expectedVersion: 0 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("CONCURRENT_MODIFICATION");
  });

  it("accepts a raw consumer avatar upload and the mini-program POST profile update", async () => {
    directory = await mkdtemp(join(tmpdir(), "profile-image-api-"));
    const store = new MemoryStore(false);
    await store.saveUser({ id: "consumer", wechatOpenId: "open-id", status: "ACTIVE", createdAt: new Date().toISOString() });
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test", PRODUCT_IMAGE_DIR: directory }), store });
    const headers = { "x-demo-user-id": "consumer", "x-demo-role": "USER" };
    const input = await sharp({ create: { width: 4, height: 4, channels: 3, background: "green" } }).png().toBuffer();
    const uploaded = await app.inject({ method: "POST", url: "/api/v1/me/profile-image", headers: { ...headers, "content-type": "image/png" }, payload: input });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const avatarUrl = uploaded.json().data.imageUrl as string;
    const changed = await app.inject({ method: "POST", url: "/api/v1/me/profile", headers, payload: { displayName: "栗子", avatarUrl, expectedVersion: 0 } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().data).toMatchObject({ displayName: "栗子", avatarUrl, profileVersion: 1 });
    expect(avatarUrl).toMatch(/^\/api\/v1\/profile-images\//);
    expect((await app.inject({ method: "GET", url: avatarUrl })).statusCode).toBe(401);
    const protectedImage = await app.inject({ method: "GET", url: avatarUrl, headers });
    expect(protectedImage.statusCode).toBe(200);
    expect(protectedImage.headers["cache-control"]).toBe("private, no-store");
  });

  it("rebinds a consumer phone only through a fresh WeChat phone code", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AUTH_PROVIDER: "wechat",
      WECHAT_APP_ID: "test-wechat-app",
      WECHAT_APP_SECRET: "test-wechat-secret",
    });
    const phoneExchange = vi.fn(async (code: string) => ({
      phoneNumber: code === "new-phone-code" ? "13900139000" : "13800138000",
      phoneVerifiedAt: new Date().toISOString(),
    }));
    const store = new MemoryStore(false);
    app = await buildApp({
      config,
      store,
      wechatCodeExchange: { exchange: async () => ({ openId: "profile-open-id" }) },
      wechatPhoneExchange: { exchange: phoneExchange },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/login",
      payload: {
        code: "login-code",
        phoneCode: "initial-phone-code",
        privacyAccepted: true,
        privacyVersion: config.PRIVACY_NOTICE_VERSION,
      },
    });
    expect(login.statusCode, login.body).toBe(200);
    const headers = { authorization: `Bearer ${login.json().data.accessToken as string}` };
    const changed = await app.inject({
      method: "POST",
      url: "/api/v1/me/phone/rebind",
      headers,
      payload: { phoneCode: "new-phone-code", expectedVersion: 0 },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().data).toMatchObject({ phoneNumber: "139****9000", profileVersion: 1 });
    expect(phoneExchange).toHaveBeenLastCalledWith("new-phone-code", "profile-open-id");
    const audit = (await store.listAuditLogs(20)).find((entry) => entry.action === "CONSUMER_PHONE_REBOUND");
    expect(audit).toMatchObject({
      beforeData: { phoneNumber: "138****8000" },
      afterData: { phoneNumber: "139****9000" },
    });
    expect(JSON.stringify(audit)).not.toContain("13900139000");
    const stale = await app.inject({
      method: "POST",
      url: "/api/v1/me/phone/rebind",
      headers,
      payload: { phoneCode: "another-code", expectedVersion: 0 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("CONCURRENT_MODIFICATION");
  });

  it("filters active homepage banners and supports admin versioned CRUD", async () => {
    directory = await mkdtemp(join(tmpdir(), "homepage-banner-api-"));
    const store = new MemoryStore(false);
    const now = new Date().toISOString();
    await store.saveProductCategory({ id: "vegetables", name: "时蔬", sortOrder: 1, status: "ACTIVE", createdAt: now, updatedAt: now });
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test", PRODUCT_IMAGE_DIR: directory }), store });
    const admin = { "x-demo-user-id": "operator", "x-demo-role": "OPERATOR" };
    const user = { "x-demo-user-id": "consumer", "x-demo-role": "USER" };
    const input = await sharp({ create: { width: 4, height: 4, channels: 3, background: "orange" } }).png().toBuffer();
    const uploaded = await app.inject({ method: "POST", url: "/api/v1/admin/product-images", headers: { ...admin, "content-type": "image/png" }, payload: input });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const imageUrl = uploaded.json().data.imageUrl as string;
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/homepage-banners", headers: admin, payload: { title: "本周好物", subtitle: "新鲜到家", imageUrl, sortOrder: 1, status: "ACTIVE", targetType: "CATEGORY", targetValue: "vegetables", scope: "ALL", serviceAreaId: null, startsAt: null, endsAt: null } });
    expect(created.statusCode, created.body).toBe(201);
    const banner = created.json().data as { id: string; version: number };
    const publicBanners = (await app.inject({ method: "GET", url: "/api/v1/homepage-banners", headers: user })).json().data;
    expect(publicBanners).toHaveLength(1);
    expect(publicBanners[0]).toEqual({
      id: banner.id,
      title: "本周好物",
      subtitle: "新鲜到家",
      imageUrl,
      targetType: "CATEGORY",
      targetValue: "时蔬",
    });
    expect(publicBanners[0]).not.toHaveProperty("version");
    expect(publicBanners[0]).not.toHaveProperty("status");
    const updated = await app.inject({ method: "POST", url: "/api/v1/admin/homepage-banners", headers: admin, payload: { id: banner.id, version: banner.version, title: "本周精选", subtitle: "", imageUrl, sortOrder: 1, status: "INACTIVE", targetType: "CATEGORY", targetValue: "vegetables", scope: "ALL", serviceAreaId: null, startsAt: null, endsAt: null } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/homepage-banners" })).json().data).toHaveLength(0);
    const deleted = await app.inject({ method: "DELETE", url: `/api/v1/admin/homepage-banners/${banner.id}`, headers: admin, payload: { version: 2 } });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json().data.deleted).toBe(true);
  });
});
