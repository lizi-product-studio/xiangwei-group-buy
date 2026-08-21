import { randomUUID } from "node:crypto";
import { createAdminCredential } from "../modules/auth/admin-auth.js";
import { MysqlStore } from "../modules/core/mysql-store.js";

const databaseUrl = process.env.DATABASE_URL;
const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!databaseUrl || !username || !password)
  throw new Error(
    "请配置 DATABASE_URL、BOOTSTRAP_ADMIN_USERNAME 和 BOOTSTRAP_ADMIN_PASSWORD",
  );

const store = MysqlStore.create(databaseUrl);
try {
  await store.transaction(async (transaction) => {
    const existing = await transaction.findAdminCredential(username);
    const userId = existing?.userId ?? randomUUID();
    if (!existing)
      await transaction.saveUser({
        id: userId,
        wechatOpenId: null,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
      });
    await transaction.saveAdminCredential(
      await createAdminCredential(username, userId, password),
    );
    await transaction.replaceUserRoles(userId, ["SUPER_ADMIN"]);
  });
  process.stdout.write(`管理员 ${username.toLowerCase()} 已创建或更新。\n`);
} finally {
  await store.close();
}
