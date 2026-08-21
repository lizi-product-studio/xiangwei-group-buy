import { describe, expect, it } from "vitest";
import { AdminAuthService, createAdminCredential } from "./admin-auth.js";
import { MemoryStore } from "../core/store.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../config.js";

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
    ).resolves.toEqual({ userId: "admin-user", roles: ["SUPER_ADMIN"] });
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
});
