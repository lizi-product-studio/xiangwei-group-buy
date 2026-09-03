import { describe, expect, it } from "vitest";
import { MemoryStore } from "../core/store.js";
import type { AdminCredential, InternalStaff, User } from "../core/types.js";
import { runWithInternalWriteActor } from "./internal-write-context.js";

const now = "2026-09-03T00:00:00.000Z";
const actor = { userId: "admin-1", roles: ["SUPER_ADMIN"] as const, authorizationVersion: 3 };

async function governedStore(): Promise<MemoryStore> {
  const store = new MemoryStore(false);
  const user: User = { id: actor.userId, wechatOpenId: null, status: "ACTIVE", createdAt: now };
  const staff: InternalStaff = {
    userId: actor.userId,
    staffNo: "STF-1",
    displayName: "系统管理员",
    phone: "13800138000",
    role: "SUPER_ADMIN",
    status: "ACTIVE",
    createdBy: null,
    activatedAt: now,
    suspendedAt: null,
    suspensionReason: null,
    authorizationVersion: 3,
    createdAt: now,
    updatedAt: now,
  };
  const credential: AdminCredential = {
    username: "admin.one",
    userId: actor.userId,
    passwordSalt: "salt",
    passwordHash: "hash",
    mustChangePassword: false,
    legacyDisabled: false,
    roles: ["SUPER_ADMIN"],
    authorizationVersion: 3,
    createdAt: now,
  };
  await store.saveUser(user);
  await store.saveInternalStaff(staff);
  await store.saveAdminCredential(credential);
  return store;
}

describe("internal write transaction fence", () => {
  it("allows a current managed actor", async () => {
    const store = await governedStore();
    let executed = false;
    await runWithInternalWriteActor(actor, () =>
      store.transaction(async () => {
        executed = true;
      }),
    );
    expect(executed).toBe(true);
  });

  it.each([
    ["stale actor version", async (store: MemoryStore) => {
      const staff = await store.getInternalStaff(actor.userId);
      await store.saveInternalStaff({ ...staff!, authorizationVersion: 4 });
    }],
    ["suspended staff", async (store: MemoryStore) => {
      const staff = await store.getInternalStaff(actor.userId);
      await store.saveInternalStaff({ ...staff!, status: "SUSPENDED" });
    }],
    ["blocked user", async (store: MemoryStore) => {
      await store.saveUser({ id: actor.userId, wechatOpenId: null, status: "BLOCKED", createdAt: now });
    }],
    ["legacy credential", async (store: MemoryStore) => {
      const credential = await store.findAdminCredentialByUserId(actor.userId);
      await store.saveAdminCredential({ ...credential!, legacyDisabled: true });
    }],
    ["password change required", async (store: MemoryStore) => {
      const credential = await store.findAdminCredentialByUserId(actor.userId);
      await store.saveAdminCredential({ ...credential!, mustChangePassword: true });
    }],
  ])("rejects %s before running business work", async (_name, mutate) => {
    const store = await governedStore();
    await mutate(store);
    let executed = false;
    await expect(
      runWithInternalWriteActor(actor, () =>
        store.transaction(async () => {
          executed = true;
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(executed).toBe(false);
  });

  it("keeps versionless demo fixtures outside the production bearer fence", async () => {
    const store = new MemoryStore(false);
    let executed = false;
    await runWithInternalWriteActor(
      { userId: "demo-super-admin", roles: ["SUPER_ADMIN"] },
      () => store.transaction(async () => { executed = true; }),
    );
    expect(executed).toBe(true);
  });
});
