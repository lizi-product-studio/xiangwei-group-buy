import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { applyMigration } from "./migration-runner.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("运行数据库迁移前必须配置 DATABASE_URL");
const directory = fileURLToPath(
  new URL("../../../../infra/mysql/migrations/", import.meta.url),
);
const files = (await readdir(directory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const connection = await mysql.createConnection({
  uri: databaseUrl,
  multipleStatements: true,
});
const lockName = "community-group-buy:schema-migrations";
let locked = false;
try {
  const [lockRows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT GET_LOCK(?,60) AS acquired",
    [lockName],
  );
  if (Number(lockRows[0]?.acquired) !== 1)
    throw new Error("数据库迁移锁等待超时");
  locked = true;
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
    name VARCHAR(255) PRIMARY KEY,checksum CHAR(64) NOT NULL,
    state ENUM('APPLIED','FAILED') NOT NULL,error_message VARCHAR(1000) NULL,
    applied_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB`);
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT checksum,state,error_message FROM schema_migrations WHERE name=?",
      [file],
    );
    if (rows[0]) {
      if (rows[0].checksum !== checksum)
        throw new Error(`已执行的迁移文件被修改：${file}`);
      if (rows[0].state !== "APPLIED")
        throw new Error(
          `迁移此前失败：${file}（${String(rows[0].error_message ?? "unknown")}）`,
        );
      continue;
    }
    await applyMigration(connection, file, checksum, sql);
    process.stdout.write(`applied ${file}\n`);
  }
} finally {
  if (locked)
    await connection
      .query("SELECT RELEASE_LOCK(?)", [lockName])
      .catch(() => undefined);
  await connection.end();
}
