import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { runWithInternalWriteActor } from "./modules/auth/internal-write-context.js";
import { createAdminCredential } from "./modules/auth/admin-auth.js";
import { StaffHttpClient } from "./modules/auth/staff-http.test-helper.js";
import { MemoryStore } from "./modules/core/store.js";
import { securityHash } from "./modules/auth/login-protection.js";

const password = "synthetic security password";
describe("browser staff security boundary", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let client: StaffHttpClient;
  beforeEach(async () => {
    store = new MemoryStore(false);
    const now = new Date().toISOString();
    for (const username of ["security.admin", "security.other"]) {
      await store.saveUser({ id: username, wechatOpenId: null, status: "ACTIVE", createdAt: now });
      await store.saveInternalStaff({ userId: username, staffNo: username, displayName: "合成管理员", phone: "13800138000", role: "SUPER_ADMIN", status: "ACTIVE", createdBy: null, activatedAt: now, suspendedAt: null, suspensionReason: null, authorizationVersion: 1, createdAt: now, updatedAt: now });
      await store.saveAdminCredential(await createAdminCredential(username, username, password));
    }
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test", REQUIRE_HTTPS: "true", STAFF_CHALLENGE_BITS: "8", AUTH_PROVIDER: "wechat", WECHAT_APP_ID: "synthetic-app", WECHAT_APP_SECRET: "synthetic-secret" }), store,
      wechatCodeExchange: { exchange: async () => ({ openId: "synthetic-consumer" }) },
      wechatPhoneExchange: { exchange: async () => ({ phoneNumber: "13800138001", phoneVerifiedAt: now }) },
    });
    client = new StaffHttpClient(app, "https://admin.liziqi.icu");
  });
  afterEach(async () => { vi.useRealTimers(); await app?.close(); });
  const login = async () => { const result = await client.login("security.admin", password); expect(result.statusCode, result.body).toBe(200); return result; };
  const access = () => client.send({ method: "GET", url: "/api/v1/admin/me/access" });

  it("issues host-only Secure HttpOnly Strict cookies and never returns an employee bearer", async () => {
    const result = await login();
    expect(result.json().data).not.toHaveProperty("accessToken");
    expect(result.json().data.csrfToken).toHaveLength(43);
    const cookie = result.cookies.find(value => value.name === "__Host-staff-session")!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });
    expect(cookie).not.toHaveProperty("domain");
    expect((await access()).statusCode).toBe(200);
    const bootstrap = await client.send({ method: "GET", url: "/api/v1/auth/admin/session" });
    expect(bootstrap.headers["cache-control"]).toBe("no-store");
    expect(bootstrap.json().data).toMatchObject({ username: "security.admin", userId: "security.admin" });
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: { host: "admin.liziqi.icu", "x-forwarded-proto": "https", authorization: `Bearer ${cookie.value}` } })).statusCode).toBe(401);
  });
  it("rejects missing/wrong CSRF, absent/foreign Origin and sibling-site requests with zero writes", async () => {
    await login();
    for (const overrides of [
      { "x-csrf-token": "" }, { "x-csrf-token": "x".repeat(43) }, { "x-csrf-token": "é".repeat(43) },
      { origin: "" }, { origin: "https://evil.invalid" }, { origin: "https://saas.liziqi.icu" }, { "sec-fetch-site": "same-site" },
    ]) {
      const response = await client.send({ method: "POST", url: "/api/v1/admin/service-areas", headers: overrides, payload: { regionCode: "110101" } });
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().code).toBe("CSRF_INVALID");
    }
    expect(await store.listServiceAreas()).toEqual([]);
    expect((await access()).statusCode).toBe(200);
  });
  it("binds the employee session to its issuing origin even when cookies are manually transplanted", async () => {
    await login();
    const headers = { ...client.headers(), host: "saas.liziqi.icu", origin: "https://saas.liziqi.icu" };
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/me/access", headers })).statusCode).toBe(401);
    expect((await access()).statusCode).toBe(200);
    const sibling = new StaffHttpClient(app, "https://saas.liziqi.icu");
    expect((await sibling.login("security.other", password)).statusCode).toBe(200);
    expect((await sibling.send({ method: "GET", url: "/api/v1/auth/admin/session" })).json().data.userId).toBe("security.other");
  });
  it("rejects oversized login payloads before password work without a cooldown header", async () => {
    const response = await client.send({ method: "POST", url: "/api/v1/auth/admin/login", payload: { username: "security.admin", password: "x".repeat(5000) } });
    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe("VALIDATION_ERROR");
    expect(response.headers).not.toHaveProperty("retry-after");
    expect((await client.login("security.admin", password)).statusCode).toBe(200);
  });
  it("requires a real one-use proof before password verification and rejects forgery/replay", async () => {
    const proof = await client.proof("login", "security.admin");
    const payload = { username: "security.admin", password, ...proof };
    const send = (value: unknown) => client.send({ method: "POST", url: "/api/v1/auth/admin/login", payload: value as Record<string, unknown> });
    expect((await send({ ...payload, challenge: `${proof.challenge}x` })).json().code).toBe("AUTH_CHALLENGE_INVALID");
    expect((await send(payload)).statusCode).toBe(200);
    expect((await send(payload)).json().code).toBe("AUTH_CHALLENGE_INVALID");
    expect((await access()).statusCode).toBe(200);
  });
  it("rejects a solved challenge in another browser, account, purpose or expired context", async () => {
    const proof = await client.proof("login", "security.admin");
    const other = new StaffHttpClient(app, "https://admin.liziqi.icu");
    await other.proof("login", "security.admin");
    const payload = { username: "security.admin", password, ...proof };
    expect((await other.send({ method: "POST", url: "/api/v1/auth/admin/login", payload })).json().code).toBe("AUTH_CHALLENGE_INVALID");
    expect((await client.send({ method: "POST", url: "/api/v1/auth/admin/login", payload: { ...payload, username: "security.other" } })).json().code).toBe("AUTH_CHALLENGE_INVALID");
    expect((await client.send({ method: "POST", url: "/api/v1/auth/admin/complete-password-change", payload: { passwordChangeToken: "x".repeat(43), newPassword: password, ...proof } })).json().code).toBe("AUTH_CHALLENGE_INVALID");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 120001);
    expect((await client.send({ method: "POST", url: "/api/v1/auth/admin/login", payload })).json().code).toBe("AUTH_CHALLENGE_INVALID");
  });
  it("gives the same failed-password response for an existing and nonexistent account", async () => {
    const known = await client.login("security.admin", "incorrect password");
    const unknown = await client.login("security.unknown", "incorrect password");
    for (const response of [known, unknown]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: "INVALID_CREDENTIALS", message: "账号或密码不正确" });
      expect(response.headers).not.toHaveProperty("retry-after");
    }
    expect((await client.login("security.admin", password)).statusCode).toBe(200);
  });
  it("requires reauthentication, preserves the session after a wrong password, rotates on success and expires the grant", async () => {
    await login();
    const target = { method: "POST" as const, url: "/api/v1/admin/access/roles", payload: {} };
    expect((await client.send(target)).json().code).toBe("REAUTH_REQUIRED");
    expect((await client.reauthenticate("wrong password")).json().code).toBe("INVALID_CREDENTIALS");
    expect((await access()).statusCode).toBe(200);
    const previous = client.headers();
    expect((await client.reauthenticate(password)).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: previous })).statusCode).toBe(401);
    expect((await client.send(target)).json().code).toBe("VALIDATION_ERROR");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 120001);
    expect((await client.send(target)).json().code).toBe("REAUTH_REQUIRED");
    expect((await access()).statusCode).toBe(200);
  });
  it.each(["logout", "expiry", "revocation"])("rejects the old cookie after %s", async (mode) => {
    const result = await login(); const previous = client.headers();
    if (mode === "logout") {
      const response = await client.send({ method: "POST", url: "/api/v1/auth/logout" });
      expect(response.statusCode).toBe(204);
      expect(response.cookies.find(value => value.name === "__Host-staff-session")?.maxAge).toBe(0);
    } else if (mode === "expiry") { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(result.json().data.expiresAt) + 1); }
    else {
      const staff = (await store.getInternalStaff("security.admin"))!;
      await store.saveInternalStaff({ ...staff, authorizationVersion: staff.authorizationVersion + 1 });
    }
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: previous })).statusCode).toBe(401);
  });
  it.each(["logout", "grant-expiry"])("rejects queued protected work after %s before entering its write body", async mode => {
    await login(); await client.reauthenticate(password);
    const cookie = client.headers().cookie!.split("; ").find(value => value.startsWith("__Host-staff-session="))!.split("=")[1]!;
    const tokenHash = securityHash(cookie);
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = store.transaction(async scoped => {
      entered(); await gate;
      if (mode === "logout") await scoped.deleteAuthSessionsByUser("security.admin");
      else { const session = (await scoped.getActiveAuthSession(tokenHash))!; await scoped.saveAuthSession({ ...session, reauthenticatedUntil: new Date(Date.now() - 1).toISOString() }); }
    });
    await started;
    let wrote = false;
    const queued = runWithInternalWriteActor({ userId: "security.admin", roles: ["SUPER_ADMIN"], authorizationVersion: 1, webOrigin: "https://admin.liziqi.icu", sessionTokenHash: tokenHash, requireFreshAuthentication: true }, () => store.transaction(async () => { wrote = true; }));
    const rejection = expect(queued).rejects.toMatchObject({ code: mode === "logout" ? "AUTH_REQUIRED" : "REAUTH_REQUIRED" });
    release(); await first; await rejection; expect(wrote).toBe(false);
  });
  it("keeps consumer Bearer sessions separate from cookies and rejects an ambiguous identity", async () => {
    const employee = await login();
    const consumer = await app.inject({ method: "POST", url: "/api/v1/auth/wechat/login", headers: { "x-forwarded-proto": "https" }, payload: { code: "synthetic-code", phoneCode: "synthetic-phone", privacyAccepted: true, privacyVersion: "2026-09-07-phone-v1" } });
    const token = consumer.json().data.accessToken;
    const headers = { "x-forwarded-proto": "https", authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "GET", url: "/api/v1/orders", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/me/access", headers })).statusCode).toBe(401);
    expect((await client.send({ method: "GET", url: "/api/v1/orders" })).statusCode).toBe(403);
    expect((await client.send({ method: "GET", url: "/api/v1/admin/me/access", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
    const stolen = employee.cookies.find(value => value.name === "__Host-staff-session")!.value;
    expect(await store.getActiveAuthSession(securityHash(stolen))).not.toBeNull();
    expect(await store.getActiveAuthSession(securityHash(token))).not.toBeNull();
  });
});
