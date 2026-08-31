import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AdminAuthService, createAdminCredential } from "./admin-auth.js";
import { StaffService } from "./staff-service.js";
import { MemoryStore } from "../core/store.js";
import { buildApp } from "../../app.js";
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

describe("AdminAuthService", () => {
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
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    const session = await service.login(
      "OPS.ADMIN",
      "correct horse battery staple",
    );
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
      code: "FORBIDDEN",
    });
    await expect(auth.authenticate(`Bearer ${token}`)).resolves.toBeNull();
    await expect(
      staff.create(
        {
          displayName: "不得创建",
          username: "blocked.staff",
          phone: "13800138009",
          role: "FINANCE",
          status: "PENDING_ACTIVATION",
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
          status: "PENDING_ACTIVATION",
          pickupPointIds: [],
        },
        { userId: "governed-admin", roles: ["SUPER_ADMIN"], authorizationVersion: 1 },
        "create-finance-target",
      );
      await staff.activate(
        "to.finance",
        created.initialCredential,
        "target staff password",
        "activate-finance-target",
      );
      const oldTarget = await auth.login("to.finance", "target staff password");
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
});
