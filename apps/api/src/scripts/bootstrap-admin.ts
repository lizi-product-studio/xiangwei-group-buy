import { randomUUID } from "node:crypto";
import { createAdminCredential, validateBootstrapAdminDisplayName } from "../modules/auth/admin-auth.js";
import { MysqlStore } from "../modules/core/mysql-store.js";

const databaseUrl = process.env.DATABASE_URL;
const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME;
const phone = process.env.BOOTSTRAP_ADMIN_PHONE;
const rotateConfirmation = process.env.BOOTSTRAP_ADMIN_ROTATE_CONFIRM;
if (!databaseUrl || !username || !password || !displayName || !phone)
  throw new Error(
    "请配置 DATABASE_URL、BOOTSTRAP_ADMIN_USERNAME、BOOTSTRAP_ADMIN_PASSWORD、BOOTSTRAP_ADMIN_DISPLAY_NAME 和 BOOTSTRAP_ADMIN_PHONE",
  );
if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error("BOOTSTRAP_ADMIN_PHONE 必须是有效中国大陆手机号");
const validDisplayName = validateBootstrapAdminDisplayName(displayName);

const store = MysqlStore.create(databaseUrl);
try {
  await store.transaction(async (transaction) => {
    const existing = await transaction.findAdminCredential(username);
    if (existing && rotateConfirmation !== "ROTATE")
      throw new Error("既有 bootstrap 超管轮密必须显式设置 BOOTSTRAP_ADMIN_ROTATE_CONFIRM=ROTATE");
    const userId = existing?.userId ?? randomUUID();
    const now = new Date().toISOString();
    if (!existing)
      await transaction.saveUser({
        id: userId,
        wechatOpenId: null,
        status: "ACTIVE",
        createdAt: now,
      });
    const currentStaff = await transaction.getInternalStaff(userId);
    const authorizationVersion =
      Math.max(
        currentStaff?.authorizationVersion ?? 0,
        existing?.authorizationVersion ?? 0,
      ) + 1;
    await transaction.saveInternalStaff({
      userId,
      staffNo: currentStaff?.staffNo ?? `BOOTSTRAP-${userId.slice(0, 12)}`,
      displayName: validDisplayName,
      phone,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      createdBy: null,
      activatedAt: currentStaff?.activatedAt ?? now,
      suspendedAt: null,
      suspensionReason: null,
      authorizationVersion,
      createdAt: currentStaff?.createdAt ?? now,
      updatedAt: now,
    });
    await transaction.replaceUserRoles(userId, ["SUPER_ADMIN"]);
    await transaction.saveAdminCredential(
      await createAdminCredential(
        username,
        userId,
        password,
        ["SUPER_ADMIN"],
        false,
        authorizationVersion,
      ),
    );
    await transaction.deleteAuthSessionsByUser(userId);
    await transaction.saveAuditLog({
      id: randomUUID(),
      actorId: userId,
      action: existing ? "BOOTSTRAP_ADMIN_ROTATED" : "BOOTSTRAP_ADMIN_CREATED",
      resourceType: "INTERNAL_STAFF",
      resourceId: userId,
      requestId: `bootstrap:${username.toLowerCase()}`,
      beforeData: currentStaff,
      afterData: { role: "SUPER_ADMIN", authorizationVersion, rotated: Boolean(existing) },
      createdAt: now,
    });
  });
  process.stdout.write(`受管超管 ${username.toLowerCase()} 已创建或轮密，旧会话已失效。\n`);
} finally {
  await store.close();
}
