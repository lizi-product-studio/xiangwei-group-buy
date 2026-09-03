import { describe, expect, it } from "vitest";
import { AdminAuthService, createAdminCredential } from "./admin-auth.js";
import { StaffService } from "./staff-service.js";
import { MemoryStore } from "../core/store.js";

const password = "correct horse battery staple";
const bootstrapActor = {
  userId: "bootstrap-admin",
  roles: ["SUPER_ADMIN"] as const,
  authorizationVersion: 1,
};

async function createBootstrap(store: MemoryStore): Promise<void> {
  const now = new Date().toISOString();
  await store.saveUser({
    id: bootstrapActor.userId,
    wechatOpenId: null,
    status: "ACTIVE",
    createdAt: now,
  });
  await store.replaceUserRoles(bootstrapActor.userId, ["SUPER_ADMIN"]);
  await store.saveInternalStaff({
    userId: bootstrapActor.userId,
    staffNo: "BOOTSTRAP-ADMIN",
    displayName: "受管超管",
    phone: "13800138000",
    role: "SUPER_ADMIN",
    status: "ACTIVE",
    createdBy: null,
    activatedAt: now,
    suspendedAt: null,
    suspensionReason: null,
    authorizationVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  await store.saveAdminCredential(
    await createAdminCredential(
      "bootstrap.admin",
      bootstrapActor.userId,
      password,
      ["SUPER_ADMIN"],
      false,
      1,
    ),
  );
}

async function completeTemporaryPassword(
  auth: AdminAuthService,
  username: string,
  temporaryPassword: string,
  newPassword: string,
  requestId: string,
) {
  const challenge = await auth.login(username, temporaryPassword);
  expect(challenge.nextAction).toBe("CHANGE_PASSWORD");
  if (challenge.nextAction !== "CHANGE_PASSWORD")
    throw new Error("missing password change challenge");
  const result = await auth.changePasswordWithToken(
    challenge.passwordChangeToken,
    newPassword,
    requestId,
  );
  expect(result.nextAction).toBe("LOGIN");
  if (result.nextAction !== "LOGIN") throw new Error("password change failed");
  return result;
}

describe("StaffService lifecycle and authorization revision", () => {
  it("requires a reason for sensitive changes and revokes the former session", async () => {
    const store = new MemoryStore();
    await createBootstrap(store);
    const staff = new StaffService(store);
    const auth = new AdminAuthService(store, 3600);
    const created = await staff.create(
      {
        displayName: "客服小李",
        username: "service.li",
        phone: "13800138001",
        role: "CUSTOMER_SERVICE",
        status: "ACTIVE",
        pickupPointIds: [],
      },
      bootstrapActor,
      "create-staff",
    );

    const session = await completeTemporaryPassword(
      auth,
      "service.li",
      created.temporaryPassword,
      password,
      "complete-password-staff",
    );

    await expect(
      staff.update(
        created.staff.userId,
        { role: "FINANCE" },
        bootstrapActor,
        "missing-reason",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await staff.update(
      created.staff.userId,
      { role: "FINANCE", reason: "调配财务岗位" },
      bootstrapActor,
      "change-role",
    );
    await expect(
      auth.authenticate(`Bearer ${session.accessToken}`),
    ).resolves.toBeNull();
    const renewed = await auth.login("service.li", password);
    expect(renewed).toMatchObject({
      roles: ["FINANCE"],
    });
    await expect(
      auth.authenticate(`Bearer ${renewed.accessToken}`),
    ).resolves.toEqual({
      userId: created.staff.userId,
      roles: ["FINANCE"],
      authorizationVersion: 3,
    });
    await expect(store.getInternalStaff(created.staff.userId)).resolves.toMatchObject({
      role: "FINANCE",
      authorizationVersion: 3,
    });
    await expect(
      store.findAdminCredentialByUserId(created.staff.userId),
    ).resolves.toMatchObject({
      roles: ["FINANCE"],
      authorizationVersion: 3,
    });
  });

  it("preserves the authorization revision and session for profile-only or redundant edits", async () => {
    const store = new MemoryStore();
    await createBootstrap(store);
    const staff = new StaffService(store);
    const auth = new AdminAuthService(store, 3600);
    const created = await staff.create(
      {
        displayName: "客服小陈",
        username: "service.chen",
        phone: "13800138004",
        role: "CUSTOMER_SERVICE",
        status: "ACTIVE",
        pickupPointIds: [],
      },
      bootstrapActor,
      "create-profile-staff",
    );
    await completeTemporaryPassword(
      auth,
      "service.chen",
      created.temporaryPassword,
      password,
      "complete-password-profile-staff",
    );
    const session = await auth.login("service.chen", password);
    const active = await staff.get(created.staff.userId);

    await staff.update(
      created.staff.userId,
      { displayName: "客服小陈（白班）", role: "CUSTOMER_SERVICE", pickupPointIds: [] },
      bootstrapActor,
      "display-name-only",
    );
    await staff.update(
      created.staff.userId,
      { phone: "13800138005", role: "CUSTOMER_SERVICE", pickupPointIds: [] },
      bootstrapActor,
      "phone-only",
    );
    await staff.update(
      created.staff.userId,
      { role: "CUSTOMER_SERVICE", pickupPointIds: [] },
      bootstrapActor,
      "redundant-permissions",
    );

    await expect(
      auth.authenticate(`Bearer ${session.accessToken}`),
    ).resolves.toEqual({
      userId: created.staff.userId,
      roles: ["CUSTOMER_SERVICE"],
      authorizationVersion: active.authorizationVersion,
    });
    await expect(store.getInternalStaff(created.staff.userId)).resolves.toMatchObject({
      authorizationVersion: active.authorizationVersion,
      displayName: "客服小陈（白班）",
      phone: "13800138005",
    });
    await expect(
      store.findAdminCredentialByUserId(created.staff.userId),
    ).resolves.toMatchObject({ authorizationVersion: active.authorizationVersion });
  });

  it("keeps credential and staff versions aligned across suspension and restoration", async () => {
    const store = new MemoryStore();
    await createBootstrap(store);
    const staff = new StaffService(store);
    const auth = new AdminAuthService(store, 3600);
    const created = await staff.create(
      {
        displayName: "运营小何",
        username: "operator.he",
        phone: "13800138006",
        role: "OPERATOR",
        status: "ACTIVE",
        pickupPointIds: [],
      },
      bootstrapActor,
      "create-operator",
    );
    const oldSession = await completeTemporaryPassword(
      auth,
      "operator.he",
      created.temporaryPassword,
      password,
      "complete-password-operator",
    );
    await staff.update(
      created.staff.userId,
      { status: "SUSPENDED", reason: "调岗交接" },
      bootstrapActor,
      "suspend-operator",
    );
    await expect(
      auth.authenticate(`Bearer ${oldSession.accessToken}`),
    ).resolves.toBeNull();
    await staff.update(
      created.staff.userId,
      { status: "ACTIVE", reason: "调岗完成" },
      bootstrapActor,
      "restore-operator",
    );
    const renewed = await auth.login("operator.he", password);
    const after = await store.getInternalStaff(created.staff.userId);
    await expect(
      store.findAdminCredentialByUserId(created.staff.userId),
    ).resolves.toMatchObject({ authorizationVersion: after!.authorizationVersion });
    await expect(
      auth.authenticate(`Bearer ${renewed.accessToken}`),
    ).resolves.toMatchObject({
      roles: ["OPERATOR"],
      authorizationVersion: after!.authorizationVersion,
    });
  });

  it("rejects a write whose administrator was revoked after request authentication", async () => {
    const store = new MemoryStore();
    await createBootstrap(store);
    const staff = new StaffService(store);
    const created = await staff.create(
      {
        displayName: "运营小周",
        username: "operator.zhou",
        phone: "13800138002",
        role: "OPERATOR",
        status: "ACTIVE",
        pickupPointIds: [],
      },
      bootstrapActor,
      "create-target",
    );
    const credential = await store.findAdminCredentialByUserId(
      bootstrapActor.userId,
    );
    await store.saveAdminCredential({
      ...credential!,
      roles: ["OPERATOR"],
      authorizationVersion: 2,
    });
    await store.replaceUserRoles(bootstrapActor.userId, ["OPERATOR"]);

    await expect(
      staff.update(
        created.staff.userId,
        { displayName: "不应写入" },
        bootstrapActor,
        "stale-admin",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(staff.get(created.staff.userId)).resolves.toMatchObject({
      displayName: "运营小周",
    });
  });

  it("invalidates sessions on credential reset and rejects a reused temporary password", async () => {
    const store = new MemoryStore();
    await createBootstrap(store);
    const staff = new StaffService(store);
    const auth = new AdminAuthService(store, 3600);
    const created = await staff.create(
      {
        displayName: "财务小王",
        username: "finance.wang",
        phone: "13800138003",
        role: "FINANCE",
        status: "ACTIVE",
        pickupPointIds: [],
      },
      bootstrapActor,
      "create-finance",
    );
    await completeTemporaryPassword(
      auth,
      "finance.wang",
      created.temporaryPassword,
      password,
      "complete-password-finance",
    );
    const session = await auth.login("finance.wang", password);
    const reset = await staff.resetCredential(
      created.staff.userId,
      "员工遗失凭据",
      bootstrapActor,
      "reset-finance",
    );
    await expect(auth.authenticate(`Bearer ${session.accessToken}`)).resolves.toBeNull();
    await expect(
      auth.login("finance.wang", reset.temporaryPassword),
    ).resolves.toMatchObject({ nextAction: "CHANGE_PASSWORD" });
    await completeTemporaryPassword(
      auth,
      "finance.wang",
      reset.temporaryPassword,
      "another correct password",
      "complete-password-after-reset",
    );
  });

  it("rejects self-suspension and self temporary-password issuance without writing state or audits", async () => {
    const store = new MemoryStore();
    await createBootstrap(store);
    const staff = new StaffService(store);
    const auth = new AdminAuthService(store, 3600);
    const session = await auth.login("bootstrap.admin", password);
    expect(session.nextAction).toBe("LOGIN");
    if (session.nextAction !== "LOGIN") throw new Error("bootstrap login failed");
    const before = await staff.get(bootstrapActor.userId);

    await expect(
      staff.update(
        bootstrapActor.userId,
        { status: "SUSPENDED", reason: "不应允许" },
        bootstrapActor,
        "self-suspend",
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(
      staff.resetCredential(
        bootstrapActor.userId,
        "不应允许",
        bootstrapActor,
        "self-temporary-password",
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    await expect(staff.get(bootstrapActor.userId)).resolves.toMatchObject({
      status: "ACTIVE",
      authorizationVersion: before.authorizationVersion,
    });
    await expect(auth.authenticate(`Bearer ${session.accessToken}`)).resolves.toEqual(bootstrapActor);
    await expect(store.listAuditLogs(20)).resolves.toEqual([]);
  });

  it("copies the pickup manager contact onto authorized points", async () => {
    const store = new MemoryStore();
    await createBootstrap(store);
    const now = new Date().toISOString();
    await store.savePickupPoint({
      id: "point-east",
      serviceAreaId: "area-1",
      name: "东门点",
      address: "东门服务站 1 号",
      businessHours: "09:00-20:00",
      pickupInstructions: "出示领取码",
      latitude: 39.9042,
      longitude: 116.4074,
      contactName: "",
      contactPhone: "",
      status: "ACTIVE",
      capacityPerDay: null,
      createdAt: now,
    });
    const staff = new StaffService(store);
    await staff.create(
      {
        displayName: "核销小周",
        username: "pickup.zhou",
        phone: "13800138008",
        role: "PICKUP_MANAGER",
        status: "ACTIVE",
        pickupPointIds: ["point-east"],
      },
      bootstrapActor,
      "create-manager",
    );
    expect(await store.listPickupPoints()).toMatchObject([
      {
        id: "point-east",
        contactName: "核销小周",
        contactPhone: "13800138008",
      },
    ]);
    const manager = (await store.listInternalStaff()).find(
      (item) => item.displayName === "核销小周",
    );
    expect(manager).toBeTruthy();
    await staff.update(
      manager!.userId,
      { displayName: "核销小周改", phone: "13900139008" },
      bootstrapActor,
      "update-manager-contact",
    );
    expect(await store.listPickupPoints()).toMatchObject([
      {
        id: "point-east",
        contactName: "核销小周改",
        contactPhone: "13900139008",
      },
    ]);
  });
});
