import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('运行数据库迁移前必须配置 DATABASE_URL');

const migrationsDirectory = fileURLToPath(new URL('../../../../infra/mysql/migrations/', import.meta.url));
const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort();
const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
const migrationLockName = 'hometown:schema-migrations';
const migrationLockTimeoutSeconds = 60;

type NamedLockRow = mysql.RowDataPacket & { result: number | null };

function lockResultError(operation: 'GET_LOCK' | 'RELEASE_LOCK', result: number | null | undefined): Error {
  if (operation === 'GET_LOCK' && result === 0) {
    return new Error(`迁移锁等待超时（${migrationLockTimeoutSeconds} 秒）：已有其他部署正在执行数据库迁移`);
  }

  const renderedResult = result === null ? 'NULL' : result === undefined ? 'no result' : String(result);
  return new Error(`MySQL ${operation}(${migrationLockName}) 未成功，返回值：${renderedResult}`);
}

async function acquireMigrationLock(): Promise<void> {
  const [rows] = await connection.execute<NamedLockRow[]>(
    'SELECT GET_LOCK(?, ?) AS result',
    [migrationLockName, migrationLockTimeoutSeconds],
  );
  const result = rows[0]?.result;
  if (result !== 1) throw lockResultError('GET_LOCK', result);
}

async function releaseMigrationLock(): Promise<void> {
  const [rows] = await connection.execute<NamedLockRow[]>(
    'SELECT RELEASE_LOCK(?) AS result',
    [migrationLockName],
  );
  const result = rows[0]?.result;
  if (result !== 1) throw lockResultError('RELEASE_LOCK', result);
}

let migrationLockAcquired = false;
let migrationError: unknown;
let cleanupError: unknown;
try {
  // MySQL named locks are connection-scoped, so hold this connection for every
  // metadata change and migration statement. This must happen before creating
  // schema_migrations, otherwise simultaneous deploys can race on its setup.
  await acquireMigrationLock();
  migrationLockAcquired = true;

  await connection.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    state ENUM('APPLIED','FAILED') NOT NULL DEFAULT 'APPLIED',
    error_message VARCHAR(1000) NULL,
    applied_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB`);
  // Upgrade migration metadata created by earlier versions of this runner.
  const [columns] = await connection.query<mysql.RowDataPacket[]>('SHOW COLUMNS FROM schema_migrations');
  const names = new Set(columns.map((column) => String(column.Field)));
  if (!names.has('state')) await connection.query("ALTER TABLE schema_migrations ADD COLUMN state ENUM('APPLIED','FAILED') NOT NULL DEFAULT 'APPLIED' AFTER checksum");
  if (!names.has('error_message')) await connection.query('ALTER TABLE schema_migrations ADD COLUMN error_message VARCHAR(1000) NULL AFTER state');

  for (const file of files) {
    const sql = await readFile(resolve(migrationsDirectory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      'SELECT checksum,state,error_message FROM schema_migrations WHERE name = ?', [file],
    );
    if (rows[0]) {
      if (rows[0].checksum !== checksum) throw new Error(`已执行的迁移文件被修改：${file}`);
      if (rows[0].state !== 'APPLIED') throw new Error(`迁移此前失败，需人工检查并修复后再运行：${file}（${String(rows[0].error_message ?? 'unknown error')}）`);
      continue;
    }
    try {
      // MySQL DDL performs implicit commits. Do not advertise a rollback that
      // cannot occur: apply one immutable file and persist a failure marker.
      await connection.query(sql);
      await connection.execute(
        "INSERT INTO schema_migrations (name, checksum, state, error_message, applied_at) VALUES (?, ?, 'APPLIED', NULL, UTC_TIMESTAMP(3))",
        [file, checksum],
      );
      process.stdout.write(`applied ${file}\n`);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      await connection.execute(
        "INSERT INTO schema_migrations (name, checksum, state, error_message, applied_at) VALUES (?, ?, 'FAILED', ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE checksum=VALUES(checksum),state='FAILED',error_message=VALUES(error_message),applied_at=VALUES(applied_at)",
        [file, checksum, message],
      ).catch(() => undefined);
      throw error;
    }
  }
} catch (error) {
  migrationError = error;
} finally {
  if (migrationLockAcquired) {
    try {
      await releaseMigrationLock();
    } catch (error) {
      cleanupError = error;
    }
  }

  try {
    await connection.end();
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError && migrationError) {
    const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    process.stderr.write(`迁移清理失败（保留原始迁移错误）：${message}\n`);
  }
}

if (migrationError) throw migrationError;
if (cleanupError) throw cleanupError;
