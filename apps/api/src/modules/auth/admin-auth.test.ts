import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AdminAuthService, createAdminCredential, validateBootstrapAdminDisplayName } from "./admin-auth.js";
import { StaffService } from "./staff-service.js";
import { MemoryStore, type CommerceStore } from "../core/store.js";
import { buildApp, hasReadyAdminBootstrap } from "../../app.js";
import { loadConfig } from "../../config.js";

async function saveActiveStaff(
  store: MemoryStore,
  userId: string,
  role: "SUPER_ADMIN" | "FINANCE" = "SUPER_ADMIN",
  authorizationVersion = 1,
): Promise<void> {
  const now = new Date().toISOString();
  await store.saveInternalStaff({
    userId,
    staffNo: `STF-${userId}`,
    displayName: userId,
    phone: "13800138000",
    role,
    status: "ACTIVE",
    createdBy: null,
    activatedAt: now,
    suspendedAt: null,
    suspensionReason: null,
    authorizationVersion,
    createdAt: now,
    updatedAt: now,
  });
}

async function createPasswordSetupChallenge(
  store: MemoryStore,
  userId: string,
  username: string,
): Promise<{
  auth: AdminAuthService;
  token: string;
  tokenHash: string;
}> {
  const now = new Date().toISOString();
  await store.saveUser({
    id: userId,
    wechatOpenId: null,
    status: "ACTIVE",
    createdAt: now,
  });
  await store.replaceUserRoles(userId, ["OPERATOR"]);
  await saveActiveStaff(store, userId);
  await store.saveInternalStaff({
    ...(await store.getInternalStaff(userId))!,
    role: "OPERATOR",
    status: "PASSWORD_SETUP_REQUIRED",
    activatedAt: null,
  });
  await store.saveAdminCredential(
    await createAdminCredential(
      username,
      userId,
      "temporary setup password",
      ["OPERATOR"],
      true,
      1,
    ),
  );
  const auth = new AdminAuthService(store, 3600);
  const challenge = await auth.login(username, "temporary setup password");
  if (challenge.nextAction !== "CHANGE_PASSWORD")
    throw new Error("missing password setup challenge");
  return {
    auth,
    token: challenge.passwordChangeToken,
    tokenHash: createHash("sha256")
      .update(challenge.passwordChangeToken)
      .digest("hex"),
  };
}

class TransactionBarrierStore extends MemoryStore {
  private armed = false;
  private barrier: Promise<void> = Promise.resolve();
  private releaseBarrier: (() => void) | null = null;
  private startedBarrier: (() => void) | null = null;
  public armTransactionBarrier(): { started: Promise<void>; release: () => void } {
    this.armed = true;
    const started = new Promise<void>((resolve) => {
      this.startedBarrier = resolve;
    });
    this.barrier = new Promise<void>((resolve) => {
      this.releaseBarrier = resolve;
    });
    return {
      started,
      release: () => this.releaseBarrier?.(),
    };
  }
  public override async transaction<T>(
    work: (store: CommerceStore) => Promise<T>,
  ): Promise<T> {
    if (this.armed) {
      this.armed = false;
      this.startedBarrier?.();
      await this.barrier;
    }
    return super.transaction(work);
  }
}

describe("bootstrap administrator display-name validation", () => {
  it("accepts an ordinary display name and rejects unusable bootstrap input", () => {
    expect(validateBootstrapAdminDisplayName(" 系统管理员 ")).toBe("系统管理员");
    for (const invalid of ["???", "？？？", "系统\u0000管理员", "Ã¥Â¼Â Ã¤Â¸Â‰", "\uFFFD管理员"])
      expect(() => validateBootstrapAdminDisplayName(invalid)).toThrow();
  });
});

describe("AdminAuthService", () => {
  it("requires an ACTIVE user and a non-legacy credential for bootstrap readiness", async () => {
    const store = new MemoryStore(false);
    const now = new Date().toISOString();
    await store.saveUser({ id: "ready-admin", wechatOpenId: null, status: "ACTIVE", createdAt: now });
    await store.replaceUserRoles("ready-admin", ["SUPER_ADMIN"]);
    await saveActiveStaff(store, "ready-admin");
    const credential = await createAdminCredential(
      "ready.admin",
      "ready-admin",
      "ready admin password",
    );
    await store.saveAdminCredential(credential);
    await expect(hasReadyAdminBootstrap(store)).resolves.toBe(true);

    await store.saveUser({ id: "ready-admin", wechatOpenId: null, status: "BLOCKED", createdAt: now });
    await expect(hasReadyAdminBootstrap(store)).resolves.toBe(false);
    await store.saveUser({ id: "ready-admin", wechatOpenId: null, status: "ACTIVE", createdAt: now });
    await store.saveAdminCredential({ ...credential, legacyDisabled: true });
    await expect(hasReadyAdminBootstrap(store)).resolves.toBe(false);
  });

  it("accepts an eight-character administrator password and rejects a shorter one", async () => {
    await expect(
      createAdminCredential("eight.char", "eight-user", "Eight123"),
    ).resolves.toMatchObject({ username: "eight.char" });
    await expect(
      createAdminCredential("seven.char", "seven-user", "Seven12"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates a production-safe session and rejects a wrong password", async () => {
    const store = new MemoryStore(false);
    await store.saveUser({
      id: "admin-user",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    });
    await store.replaceUserRoles("admin-user", ["SUPER_ADMIN"]);
    await saveActiveStaff(store, "admin-user");
    await store.saveAdminCredential(
      await createAdminCredential(
        "ops.admin",
        "admin-user",
        "correct horse battery staple",
      ),
    );
    const service = new AdminAuthService(store, 3600);

    await expect(
      service.login("ops.admin", "wrong password value"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const session = await service.login(
      "OPS.ADMIN",
      "correct horse battery staple",
    );
    expect(session.nextAction).toBe("LOGIN");
    if (session.nextAction !== "LOGIN") throw new Error("unexpected password challenge");
    await expect(
      service.authenticate(`Bearer ${session.accessToken}`),
    ).resolves.toEqual({ userId: "admin-user", roles: ["SUPER_ADMIN"], authorizationVersion: 1 });
    await service.logout(`Bearer ${session.accessToken}`);
    await expect(
      service.authenticate(`Bearer ${session.accessToken}`),
    ).resolves.toBeNull();
  });

  it("uses the bearer session on protected admin routes", async () => {
    const store = new MemoryStore();
    await store.saveUser({
      id: "route-admin",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    });
    await store.replaceUserRoles("route-admin", ["SUPER_ADMIN"]);
    await saveActiveStaff(store, "route-admin");
    await store.saveAdminCredential(
      await createAdminCredential(
        "route.admin",
        "route-admin",
        "another long admin password",
      ),
    );
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store,
    });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/login",
        payload: {
          username: "route.admin",
          password: "another long admin password",
        },
      });
      expect(login.statusCode).toBe(200);
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders",
        headers: {
          authorization: `Bearer ${login.json().data.accessToken as string}`,
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("rejects an already-authenticated sensitive write when authorization changes before its transaction", async () => {
    const store = new TransactionBarrierStore(false);
    const now = new Date().toISOString();
    await store.saveUser({
      id: "racing-admin",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: now,
    });
    await store.replaceUserRoles("racing-admin", ["SUPER_ADMIN"]);
    await saveActiveStaff(store, "racing-admin");
    const credential = await createAdminCredential(
      "racing.admin",
      "racing-admin",
      "racing admin password",
    );
    await store.saveAdminCredential(credential);
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store,
    });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/login",
        payload: { username: "racing.admin", password: "racing admin password" },
      });
      expect(login.statusCode, login.body).toBe(200);
      const token = login.json().data.accessToken as string;
      const barrier = store.armTransactionBarrier();
      const pendingWrite = app.inject({
        method: "POST",
        url: "/api/v1/admin/service-areas",
        headers: { authorization: `Bearer ${token}` },
        payload: { regionCode: "110101" },
      });
      await barrier.started;
      const staff = await store.getInternalStaff("racing-admin");
      expect(staff).not.toBeNull();
      await store.saveInternalStaff({ ...staff!, authorizationVersion: 2, updatedAt: now });
      await store.saveAdminCredential({ ...credential, authorizationVersion: 2 });
      barrier.release();
      const response = await pendingWrite;
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().code).toBe("FORBIDDEN");
      expect(await store.listServiceAreas()).toEqual([]);
      expect(await store.listAuditLogs()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("removes the legacy activation endpoint and keeps password challenge public", async () => {
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store: new MemoryStore(false),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/activate",
        payload: {},
      });
      expect(response.statusCode).toBe(404);
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/complete-password-change",
        payload: { passwordChangeToken: "x".repeat(32), newPassword: "long enough password" },
      });
      expect(challengeResponse.statusCode).toBe(401);
      expect(challengeResponse.json().code).toBe("PASSWORD_CHANGE_TOKEN_INVALID");
    } finally {
      await app.close();
    }
  });

  it("returns LOGIN_RATE_LIMITED with Retry-After after five failed login attempts", async () => {
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store: new MemoryStore(false),
    });
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/auth/admin/login",
          payload: { username: "missing.admin", password: "not a real password" },
        });
        expect(response.statusCode).toBe(401);
      }
      const limited = await app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/login",
        payload: { username: "missing.admin", password: "not a real password" },
      });
      expect(limited.statusCode, limited.body).toBe(429);
      expect(limited.headers["retry-after"]).toBe("900");
      expect(limited.json().code).toBe("LOGIN_RATE_LIMITED");
    } finally {
      await app.close();
    }
  });

  it("rejects an unmanaged legacy bootstrap credential for login, bearer authentication, and staff writes", async () => {
    const store = new MemoryStore(false);
    await store.saveUser({
      id: "legacy-admin",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    });
    await store.replaceUserRoles("legacy-admin", ["SUPER_ADMIN"]);
    await store.saveAdminCredential(
      await createAdminCredential(
        "legacy.admin",
        "legacy-admin",
        "legacy admin password",
      ),
    );
    const token = "x".repeat(32);
    await store.saveAuthSession({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId: "legacy-admin",
      roles: ["SUPER_ADMIN"],
      authorizationVersion: 1,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const auth = new AdminAuthService(store, 3600);
    const staff = new StaffService(store);

    await expect(auth.login("legacy.admin", "legacy admin password")).rejects.toMatchObject({
      code: "ACCOUNT_DISABLED",
    });
    await expect(auth.authenticate(`Bearer ${token}`)).resolves.toBeNull();
    await expect(
      staff.create(
        {
          displayName: "不得创建",
          username: "blocked.staff",
          phone: "13800138009",
          role: "FINANCE",
          status: "ACTIVE",
          pickupPointIds: [],
        },
        { userId: "legacy-admin", roles: ["SUPER_ADMIN"], authorizationVersion: 1 },
        "legacy-write",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts a new token with the changed role on its protected API after invalidating the old one", async () => {
    const store = new MemoryStore();
    const now = new Date().toISOString();
    await store.saveUser({
      id: "governed-admin",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: now,
    });
    await store.replaceUserRoles("governed-admin", ["SUPER_ADMIN"]);
    await saveActiveStaff(store, "governed-admin");
    await store.saveAdminCredential(
      await createAdminCredential(
        "governed.admin",
        "governed-admin",
        "governed admin password",
      ),
    );
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store,
    });
    try {
      const auth = new AdminAuthService(store, 3600);
      const oldLogin = await auth.login("governed.admin", "governed admin password");
      const staff = new StaffService(store);
      const created = await staff.create(
        {
          displayName: "待换岗财务",
          username: "to.finance",
          phone: "13800138008",
          role: "CUSTOMER_SERVICE",
          status: "ACTIVE",
          pickupPointIds: [],
        },
        { userId: "governed-admin", roles: ["SUPER_ADMIN"], authorizationVersion: 1 },
        "create-finance-target",
      );
      const challenge = await auth.login("to.finance", created.temporaryPassword);
      expect(challenge.nextAction).toBe("CHANGE_PASSWORD");
      if (challenge.nextAction !== "CHANGE_PASSWORD") throw new Error("missing password challenge");
      const changed = await auth.changePasswordWithToken(
        challenge.passwordChangeToken,
        "target staff password",
        "complete-password-change",
      );
      expect(changed.nextAction).toBe("LOGIN");
      if (changed.nextAction !== "LOGIN") throw new Error("password change did not issue session");
      const oldTarget = changed;
      await staff.update(
        created.staff.userId,
        { role: "FINANCE", reason: "财务岗位调整" },
        { userId: "governed-admin", roles: ["SUPER_ADMIN"], authorizationVersion: 1 },
        "change-to-finance",
      );
      const oldResponse = await app.inject({
        method: "GET",
        url: "/api/v1/admin/quality-cases",
        headers: { authorization: `Bearer ${oldTarget.accessToken}` },
      });
      expect(oldResponse.statusCode).toBe(401);
      const renewed = await auth.login("to.finance", "target staff password");
      const renewedResponse = await app.inject({
        method: "GET",
        url: "/api/v1/admin/quality-cases",
        headers: { authorization: `Bearer ${renewed.accessToken}` },
      });
      expect(renewedResponse.statusCode).toBe(200);
      await expect(auth.authenticate(`Bearer ${oldLogin.accessToken}`)).resolves.toMatchObject({
        roles: ["SUPER_ADMIN"],
      });
    } finally {
      await app.close();
    }
  });

  it("returns a single-use password challenge with no bearer session and rejects replay", async () => {
    const store = new MemoryStore(false);
    await store.saveUser({
      id: "challenge-user",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    });
    await store.replaceUserRoles("challenge-user", ["OPERATOR"]);
    await saveActiveStaff(store, "challenge-user", "FINANCE");
    await store.saveInternalStaff({
      ...(await store.getInternalStaff("challenge-user"))!,
      role: "OPERATOR",
      status: "PASSWORD_SETUP_REQUIRED",
    });
    await store.saveAdminCredential(
      await createAdminCredential(
        "challenge.user",
        "challenge-user",
        "temporary password",
        ["OPERATOR"],
        true,
        1,
      ),
    );
    const auth = new AdminAuthService(store, 3600);
    const challenge = await auth.login("challenge.user", "temporary password");
    expect(challenge.nextAction).toBe("CHANGE_PASSWORD");
    if (challenge.nextAction !== "CHANGE_PASSWORD") throw new Error("missing challenge");
    expect(await store.getAuthSession(challenge.passwordChangeToken)).toBeNull();
    const changed = await auth.changePasswordWithToken(
      challenge.passwordChangeToken,
      "new challenge password",
      "challenge-request",
    );
    expect(changed.nextAction).toBe("LOGIN");
    await expect(
      auth.changePasswordWithToken(
        challenge.passwordChangeToken,
        "replay password",
        "challenge-replay",
      ),
    ).rejects.toMatchObject({ code: "PASSWORD_CHANGE_TOKEN_INVALID" });
    const normal = await auth.login("challenge.user", "new challenge password");
    expect(normal.nextAction).toBe("LOGIN");
  });

  it.each([false, true])("changes a personal password and rotates its bearer session (transactional credential reads: %s)", async (transactionalReads) => {
    // MysqlStore wraps standalone reads in a transaction, which rechecks the
    // request actor version. MemoryStore alone cannot expose post-change reads
    // accidentally performed with the now-revoked request identity.
    class TransactionalCredentialStore extends MemoryStore {
      public override async findAdminCredential(username: string) {
        return this.transaction(() => super.findAdminCredential(username));
      }
    }
    const store = transactionalReads
      ? new TransactionalCredentialStore(false)
      : new MemoryStore(false);
    await store.saveUser({
      id: "self-change-user",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    });
    await store.replaceUserRoles("self-change-user", ["FINANCE"]);
    await saveActiveStaff(store, "self-change-user", "FINANCE");
    await store.saveAdminCredential(
      await createAdminCredential(
        "self.change",
        "self-change-user",
        "current finance password",
        ["FINANCE"],
        false,
        1,
      ),
    );
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store,
    });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/login",
        payload: { username: "self.change", password: "current finance password" },
      });
      const oldToken = login.json().data.accessToken as string;
      const changed = await app.inject({
        method: "POST",
        url: "/api/v1/admin/me/change-password",
        headers: { authorization: `Bearer ${oldToken}` },
        payload: {
          currentPassword: "current finance password",
          newPassword: "new finance password",
        },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      const newToken = changed.json().data.accessToken as string;
      expect(newToken).not.toBe(oldToken);
      const oldResponse = await app.inject({
        method: "GET",
        url: "/api/v1/admin/quality-cases",
        headers: { authorization: `Bearer ${oldToken}` },
      });
      expect(oldResponse.statusCode).toBe(401);
      const newResponse = await app.inject({
        method: "GET",
        url: "/api/v1/admin/quality-cases",
        headers: { authorization: `Bearer ${newToken}` },
      });
      expect(newResponse.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("consumes a password-change challenge atomically when two requests race", async () => {
    const store = new MemoryStore(false);
    await store.saveUser({ id: "race-user", wechatOpenId: null, status: "ACTIVE", createdAt: new Date().toISOString() });
    await store.replaceUserRoles("race-user", ["OPERATOR"]);
    await saveActiveStaff(store, "race-user", "SUPER_ADMIN");
    await store.saveInternalStaff({ ...(await store.getInternalStaff("race-user"))!, role: "OPERATOR", status: "PASSWORD_SETUP_REQUIRED" });
    await store.saveAdminCredential(await createAdminCredential("race.user", "race-user", "race temporary password", ["OPERATOR"], true, 1));
    const auth = new AdminAuthService(store, 3600);
    const challenge = await auth.login("race.user", "race temporary password");
    if (challenge.nextAction !== "CHANGE_PASSWORD") throw new Error("missing challenge");
    const results = await Promise.allSettled([
      auth.changePasswordWithToken(challenge.passwordChangeToken, "race password one", "race-one"),
      auth.changePasswordWithToken(challenge.passwordChangeToken, "race password two", "race-two"),
    ]);
    expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((value) => value.status === "rejected")).toHaveLength(1);
    await expect(auth.login("race.user", "race password one")).resolves.toMatchObject({ nextAction: "LOGIN" });
    await expect(auth.login("race.user", "race password two")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("binds the challenge to the database clock and expires it after ten minutes", async () => {
    const store = new MemoryStore(false);
    const start = "2026-09-02T00:00:00.000Z";
    store.setDatabaseNowForTests(start);
    await store.saveUser({ id: "expiry-user", wechatOpenId: null, status: "ACTIVE", createdAt: start });
    await store.replaceUserRoles("expiry-user", ["OPERATOR"]);
    await saveActiveStaff(store, "expiry-user", "SUPER_ADMIN");
    await store.saveInternalStaff({ ...(await store.getInternalStaff("expiry-user"))!, role: "OPERATOR", status: "PASSWORD_SETUP_REQUIRED" });
    await store.saveAdminCredential(await createAdminCredential("expiry.user", "expiry-user", "expiry temporary password", ["OPERATOR"], true, 1));
    const auth = new AdminAuthService(store, 3600);
    const challenge = await auth.login("expiry.user", "expiry temporary password");
    if (challenge.nextAction !== "CHANGE_PASSWORD") throw new Error("missing challenge");
    store.setDatabaseNowForTests("2026-09-02T00:10:00.000Z");
    await expect(auth.changePasswordWithToken(challenge.passwordChangeToken, "expired password", "expiry-request")).rejects.toMatchObject({ code: "PASSWORD_CHANGE_TOKEN_INVALID" });
  });

  it("rejects a password setup challenge after the user is blocked without changing credential facts", async () => {
    const store = new MemoryStore(false);
    const { auth, token, tokenHash } = await createPasswordSetupChallenge(
      store,
      "blocked-setup-user",
      "blocked.setup",
    );
    const user = await store.getUser("blocked-setup-user");
    await store.saveUser({ ...user!, status: "BLOCKED" });
    const beforeCredential = await store.findAdminCredentialByUserId(
      "blocked-setup-user",
    );
    const beforeStaff = await store.getInternalStaff("blocked-setup-user");
    const beforeChallenge = await store.getPasswordChangeToken(tokenHash);

    await expect(
      auth.changePasswordWithToken(token, "must not be persisted", "blocked-setup"),
    ).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
    await expect(
      store.findAdminCredentialByUserId("blocked-setup-user"),
    ).resolves.toEqual(beforeCredential);
    await expect(store.getInternalStaff("blocked-setup-user")).resolves.toEqual(
      beforeStaff,
    );
    await expect(store.getPasswordChangeToken(tokenHash)).resolves.toEqual(
      beforeChallenge,
    );
  });

  it("never lets a password setup challenge re-enable a legacy-disabled credential", async () => {
    const store = new MemoryStore(false);
    const { auth, token, tokenHash } = await createPasswordSetupChallenge(
      store,
      "legacy-setup-user",
      "legacy.setup",
    );
    const credential = await store.findAdminCredentialByUserId(
      "legacy-setup-user",
    );
    await store.saveAdminCredential({ ...credential!, legacyDisabled: true });
    const beforeCredential = await store.findAdminCredentialByUserId(
      "legacy-setup-user",
    );
    const beforeStaff = await store.getInternalStaff("legacy-setup-user");
    const beforeChallenge = await store.getPasswordChangeToken(tokenHash);

    await expect(
      auth.changePasswordWithToken(token, "must not revive legacy", "legacy-setup"),
    ).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
    await expect(
      store.findAdminCredentialByUserId("legacy-setup-user"),
    ).resolves.toEqual(beforeCredential);
    await expect(store.getInternalStaff("legacy-setup-user")).resolves.toEqual(
      beforeStaff,
    );
    await expect(store.getPasswordChangeToken(tokenHash)).resolves.toEqual(
      beforeChallenge,
    );
  });

  it("rejects a password setup challenge after role or authorization drift with zero writes", async () => {
    const store = new MemoryStore(false);
    const { auth, token, tokenHash } = await createPasswordSetupChallenge(
      store,
      "drifted-setup-user",
      "drifted.setup",
    );
    const staff = await store.getInternalStaff("drifted-setup-user");
    await store.saveInternalStaff({
      ...staff!,
      role: "FINANCE",
      authorizationVersion: 2,
    });
    const beforeCredential = await store.findAdminCredentialByUserId(
      "drifted-setup-user",
    );
    const beforeStaff = await store.getInternalStaff("drifted-setup-user");
    const beforeChallenge = await store.getPasswordChangeToken(tokenHash);

    await expect(
      auth.changePasswordWithToken(token, "must not cross role drift", "drifted-setup"),
    ).rejects.toMatchObject({ code: "PASSWORD_CHANGE_TOKEN_INVALID" });
    await expect(
      store.findAdminCredentialByUserId("drifted-setup-user"),
    ).resolves.toEqual(beforeCredential);
    await expect(store.getInternalStaff("drifted-setup-user")).resolves.toEqual(
      beforeStaff,
    );
    await expect(store.getPasswordChangeToken(tokenHash)).resolves.toEqual(
      beforeChallenge,
    );
  });

  it("invalidates an existing bearer as soon as its credential is legacy-disabled", async () => {
    const store = new MemoryStore(false);
    const now = new Date().toISOString();
    await store.saveUser({
      id: "legacy-bearer-user",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: now,
    });
    await store.replaceUserRoles("legacy-bearer-user", ["SUPER_ADMIN"]);
    await saveActiveStaff(store, "legacy-bearer-user");
    const credential = await createAdminCredential(
      "legacy.bearer",
      "legacy-bearer-user",
      "legacy bearer password",
    );
    await store.saveAdminCredential(credential);
    const auth = new AdminAuthService(store, 3600);
    const session = await auth.login("legacy.bearer", "legacy bearer password");
    if (session.nextAction !== "LOGIN") throw new Error("missing bearer session");
    const tokenHash = createHash("sha256")
      .update(session.accessToken)
      .digest("hex");
    await store.saveAdminCredential({ ...credential, legacyDisabled: true });

    await expect(
      auth.authenticate(`Bearer ${session.accessToken}`),
    ).resolves.toBeNull();
    await expect(store.getAuthSession(tokenHash)).resolves.toBeNull();
  });

  it("rejects and deletes a bearer whose credential or session contains multiple staff roles", async () => {
    const store = new MemoryStore(false);
    const now = new Date().toISOString();
    await store.saveUser({
      id: "multi-role-user",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: now,
    });
    await store.replaceUserRoles("multi-role-user", ["OPERATOR", "FINANCE"]);
    await saveActiveStaff(store, "multi-role-user");
    await store.saveInternalStaff({
      ...(await store.getInternalStaff("multi-role-user"))!,
      role: "OPERATOR",
    });
    await store.saveAdminCredential(
      await createAdminCredential(
        "multi.role",
        "multi-role-user",
        "multi role password",
        ["OPERATOR", "FINANCE"],
      ),
    );
    const token = "multi-role-bearer-token-value-1234567890";
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await store.saveAuthSession({
      tokenHash,
      userId: "multi-role-user",
      roles: ["OPERATOR", "FINANCE"],
      authorizationVersion: 1,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store,
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/finance/refunds",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode, response.body).toBe(401);
      await expect(store.getAuthSession(tokenHash)).resolves.toBeNull();
    } finally {
      await app.close();
    }
  });

  it("enforces the single-role invariant independently for credential and session projections", async () => {
    for (const scenario of [
      {
        name: "credential",
        credentialRoles: ["OPERATOR", "FINANCE"] as const,
        sessionRoles: ["OPERATOR"] as const,
      },
      {
        name: "session",
        credentialRoles: ["OPERATOR"] as const,
        sessionRoles: ["OPERATOR", "FINANCE"] as const,
      },
    ]) {
      const store = new MemoryStore(false);
      const now = new Date().toISOString();
      const userId = `${scenario.name}-projection-user`;
      await store.saveUser({
        id: userId,
        wechatOpenId: null,
        status: "ACTIVE",
        createdAt: now,
      });
      await store.replaceUserRoles(userId, [...scenario.credentialRoles]);
      await saveActiveStaff(store, userId);
      await store.saveInternalStaff({
        ...(await store.getInternalStaff(userId))!,
        role: "OPERATOR",
      });
      await store.saveAdminCredential(
        await createAdminCredential(
          `${scenario.name}.projection`,
          userId,
          "projection password",
          [...scenario.credentialRoles],
        ),
      );
      const token = `${scenario.name}-projection-bearer-token-value-1234567890`;
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await store.saveAuthSession({
        tokenHash,
        userId,
        roles: [...scenario.sessionRoles],
        authorizationVersion: 1,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const auth = new AdminAuthService(store, 3600);

      await expect(auth.authenticate(`Bearer ${token}`)).resolves.toBeNull();
      await expect(store.getAuthSession(tokenHash)).resolves.toBeNull();
    }
  });
});
