import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('运行数据库迁移前必须配置 DATABASE_URL');

const migrationsDirectory = fileURLToPath(new URL('../../../../infra/mysql/migrations/', import.meta.url));
const migrationTestStopAfter = process.env.NODE_ENV === 'test' ? process.env.MIGRATION_TEST_STOP_AFTER : undefined;
const staffMigrationRecoveryDisabledForTest = process.env.NODE_ENV === 'test' && process.env.MIGRATION_TEST_DISABLE_0033_RECOVERY === 'true';
const files = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith('.sql') && (!migrationTestStopAfter || file <= migrationTestStopAfter))
  .sort();
const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
const migrationLockName = 'hometown:schema-migrations';
const migrationLockTimeoutSeconds = 60;
const recoverableStaffMigration = '0033_internal_staff_accounts.sql';

type NamedLockRow = mysql.RowDataPacket & { result: number | null };
type ColumnRow = mysql.RowDataPacket & { Field: string; Type: string; Null: 'YES' | 'NO'; Default: string | number | null };
type IndexRow = mysql.RowDataPacket & { Key_name: string; Non_unique: number; Seq_in_index: number; Column_name: string };
type ForeignKeyRow = mysql.RowDataPacket & { CONSTRAINT_NAME: string; COLUMN_NAME: string; ORDINAL_POSITION: number; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string };
type ExpectedColumn = { type: string; nullable: 'YES' | 'NO'; defaultValue: string | null };
type ExpectedIndex = { unique: boolean; columns: string[] };
type ExpectedForeignKey = { columns: string[]; referencedTable: string; referencedColumns: string[] };

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

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES LIKE ?', [tableName]);
  return rows.length > 0;
}

async function tableColumns(tableName: string): Promise<Map<string, ColumnRow>> {
  const [rows] = await connection.query<ColumnRow[]>(`SHOW COLUMNS FROM \`${tableName}\``);
  return new Map(rows.map((row) => [row.Field, row]));
}

async function assertExistingTableShape(
  tableName: string,
  expectedColumns: Record<string, ExpectedColumn>,
  expectedIndexes: Record<string, ExpectedIndex>,
  expectedForeignKeys: Record<string, ExpectedForeignKey>,
): Promise<void> {
  if (!await tableExists(tableName)) return;
  const existingColumns = await tableColumns(tableName);
  const missingColumns = Object.keys(expectedColumns).filter((column) => !existingColumns.has(column));
  if (missingColumns.length > 0) throw new Error(`0033 自动恢复已拒绝：现有表 ${tableName} 缺少预期列 ${missingColumns.join(', ')}`);
  for (const [columnName, expected] of Object.entries(expectedColumns)) {
    const actual = existingColumns.get(columnName)!;
    const actualType = actual.Type.toLowerCase();
    const expectedType = expected.type.toLowerCase();
    const actualDefault = actual.Default === null ? null : String(actual.Default);
    if (actualType !== expectedType || actual.Null !== expected.nullable || actualDefault !== expected.defaultValue) {
      throw new Error(`0033 自动恢复已拒绝：${tableName}.${columnName} 结构不兼容（实际 ${actual.Type} ${actual.Null} DEFAULT ${actualDefault ?? 'NULL'}；预期 ${expected.type} ${expected.nullable} DEFAULT ${expected.defaultValue ?? 'NULL'}）`);
    }
  }
  const [indexRows] = await connection.query<IndexRow[]>(`SHOW INDEX FROM \`${tableName}\``);
  const indexes = new Map<string, IndexRow[]>();
  for (const row of indexRows) indexes.set(row.Key_name, [...(indexes.get(row.Key_name) ?? []), row]);
  const missingIndexes = Object.keys(expectedIndexes).filter((index) => !indexes.has(index));
  if (missingIndexes.length > 0) throw new Error(`0033 自动恢复已拒绝：现有表 ${tableName} 缺少预期索引 ${missingIndexes.join(', ')}`);
  for (const [indexName, expected] of Object.entries(expectedIndexes)) {
    const actual = indexes.get(indexName)!.sort((left, right) => left.Seq_in_index - right.Seq_in_index);
    const actualColumns = actual.map((row) => row.Column_name);
    const actualUnique = actual[0]?.Non_unique === 0;
    if (actualUnique !== expected.unique || actualColumns.join(',') !== expected.columns.join(',')) {
      throw new Error(`0033 自动恢复已拒绝：${tableName}.${indexName} 索引不兼容（实际 ${actualUnique ? 'UNIQUE' : 'NON_UNIQUE'} (${actualColumns.join(',')})；预期 ${expected.unique ? 'UNIQUE' : 'NON_UNIQUE'} (${expected.columns.join(',')})）`);
    }
  }
  const [foreignKeyRows] = await connection.query<ForeignKeyRow[]>(
    `SELECT key_usage.CONSTRAINT_NAME,key_usage.COLUMN_NAME,key_usage.ORDINAL_POSITION,key_usage.REFERENCED_TABLE_NAME,key_usage.REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE AS key_usage
       INNER JOIN information_schema.TABLE_CONSTRAINTS AS constraints
         ON constraints.CONSTRAINT_SCHEMA = key_usage.CONSTRAINT_SCHEMA
        AND constraints.TABLE_NAME = key_usage.TABLE_NAME
        AND constraints.CONSTRAINT_NAME = key_usage.CONSTRAINT_NAME
       WHERE key_usage.TABLE_SCHEMA = DATABASE() AND key_usage.TABLE_NAME = ? AND constraints.CONSTRAINT_TYPE = 'FOREIGN KEY'
       ORDER BY key_usage.CONSTRAINT_NAME,key_usage.ORDINAL_POSITION`,
    [tableName],
  );
  const foreignKeys = new Map<string, ForeignKeyRow[]>();
  for (const row of foreignKeyRows) foreignKeys.set(row.CONSTRAINT_NAME, [...(foreignKeys.get(row.CONSTRAINT_NAME) ?? []), row]);
  const missingForeignKeys = Object.keys(expectedForeignKeys).filter((foreignKey) => !foreignKeys.has(foreignKey));
  if (missingForeignKeys.length > 0) throw new Error(`0033 自动恢复已拒绝：现有表 ${tableName} 缺少预期外键 ${missingForeignKeys.join(', ')}`);
  for (const [foreignKeyName, expected] of Object.entries(expectedForeignKeys)) {
    const actual = foreignKeys.get(foreignKeyName)!;
    const actualColumns = actual.map((row) => row.COLUMN_NAME);
    const actualReferencedColumns = actual.map((row) => row.REFERENCED_COLUMN_NAME);
    const actualReferencedTable = actual[0]?.REFERENCED_TABLE_NAME;
    if (actualColumns.join(',') !== expected.columns.join(',') || actualReferencedTable !== expected.referencedTable || actualReferencedColumns.join(',') !== expected.referencedColumns.join(',')) {
      throw new Error(`0033 自动恢复已拒绝：${tableName}.${foreignKeyName} 外键不兼容`);
    }
  }
}

async function validateExistingStaffObjects(): Promise<void> {
  await assertExistingTableShape(
    'internal_staff',
    {
      user_id:{type:'char(36)',nullable:'NO',defaultValue:null},staff_no:{type:'varchar(32)',nullable:'NO',defaultValue:null},display_name:{type:'varchar(80)',nullable:'NO',defaultValue:null},phone:{type:'varchar(32)',nullable:'NO',defaultValue:null},
      role:{type:"enum('SUPER_ADMIN','OPERATOR','CUSTOMER_SERVICE','FINANCE','PICKUP_MANAGER')",nullable:'NO',defaultValue:null},status:{type:"enum('PENDING_ACTIVATION','ACTIVE','SUSPENDED')",nullable:'NO',defaultValue:'PENDING_ACTIVATION'},
      created_by:{type:'char(36)',nullable:'YES',defaultValue:null},activated_at:{type:'datetime(3)',nullable:'YES',defaultValue:null},suspended_at:{type:'datetime(3)',nullable:'YES',defaultValue:null},suspension_reason:{type:'varchar(500)',nullable:'YES',defaultValue:null},created_at:{type:'datetime(3)',nullable:'NO',defaultValue:null},updated_at:{type:'datetime(3)',nullable:'NO',defaultValue:null},
    },
    {
      PRIMARY:{unique:true,columns:['user_id']},uk_internal_staff_no:{unique:true,columns:['staff_no']},uk_internal_staff_phone:{unique:true,columns:['phone']},idx_internal_staff_directory:{unique:false,columns:['status','role','display_name']},
    },
    {fk_internal_staff_user:{columns:['user_id'],referencedTable:'users',referencedColumns:['id']}},
  );
  await assertExistingTableShape(
    'staff_pickup_point_assignments',
    {
      staff_user_id:{type:'char(36)',nullable:'NO',defaultValue:null},pickup_point_id:{type:'char(36)',nullable:'NO',defaultValue:null},assigned_by:{type:'char(36)',nullable:'NO',defaultValue:null},created_at:{type:'datetime(3)',nullable:'NO',defaultValue:null},updated_at:{type:'datetime(3)',nullable:'NO',defaultValue:null},
    },
    {PRIMARY:{unique:true,columns:['staff_user_id','pickup_point_id']},idx_staff_pickup_point_lookup:{unique:false,columns:['pickup_point_id','staff_user_id']}},
    {
      fk_staff_point_staff:{columns:['staff_user_id'],referencedTable:'internal_staff',referencedColumns:['user_id']},
      fk_staff_point_pickup_point:{columns:['pickup_point_id'],referencedTable:'pickup_points',referencedColumns:['id']},
    },
  );
  const credentialColumns = await tableColumns('admin_credentials');
  const credentialColumn = credentialColumns.get('must_change_password');
  if (credentialColumn && (credentialColumn.Type.toLowerCase() !== 'tinyint(1)' || credentialColumn.Null !== 'NO' || String(credentialColumn.Default) !== '0')) {
    throw new Error('0033 自动恢复已拒绝：admin_credentials.must_change_password 与预期 TINYINT(1) NOT NULL DEFAULT 0 不兼容');
  }
}

async function ensureStaffObjects(): Promise<void> {
  await validateExistingStaffObjects();
  if (!await tableExists('internal_staff')) {
    await connection.query(`CREATE TABLE internal_staff (
      user_id CHAR(36) PRIMARY KEY,
      staff_no VARCHAR(32) NOT NULL,
      display_name VARCHAR(80) NOT NULL,
      phone VARCHAR(32) NOT NULL,
      role ENUM('SUPER_ADMIN','OPERATOR','CUSTOMER_SERVICE','FINANCE','PICKUP_MANAGER') NOT NULL,
      status ENUM('PENDING_ACTIVATION','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'PENDING_ACTIVATION',
      created_by CHAR(36) NULL,
      activated_at DATETIME(3) NULL,
      suspended_at DATETIME(3) NULL,
      suspension_reason VARCHAR(500) NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      UNIQUE KEY uk_internal_staff_no (staff_no),
      UNIQUE KEY uk_internal_staff_phone (phone),
      INDEX idx_internal_staff_directory (status, role, display_name),
      CONSTRAINT fk_internal_staff_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB`);
  }
  if (!await tableExists('staff_pickup_point_assignments')) {
    await connection.query(`CREATE TABLE staff_pickup_point_assignments (
      staff_user_id CHAR(36) NOT NULL,
      pickup_point_id CHAR(36) NOT NULL,
      assigned_by CHAR(36) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (staff_user_id, pickup_point_id),
      INDEX idx_staff_pickup_point_lookup (pickup_point_id, staff_user_id),
      CONSTRAINT fk_staff_point_staff FOREIGN KEY (staff_user_id) REFERENCES internal_staff(user_id),
      CONSTRAINT fk_staff_point_pickup_point FOREIGN KEY (pickup_point_id) REFERENCES pickup_points(id)
    ) ENGINE=InnoDB`);
  }
  const credentialColumns = await tableColumns('admin_credentials');
  if (!credentialColumns.has('must_change_password')) {
    await connection.query('ALTER TABLE admin_credentials ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash');
  }
  await validateExistingStaffObjects();
}

async function recoverFailedStaffMigration(checksum: string): Promise<void> {
  await ensureStaffObjects();
  const [result] = await connection.execute<mysql.ResultSetHeader>(
    "UPDATE schema_migrations SET state = 'APPLIED', error_message = NULL, applied_at = UTC_TIMESTAMP(3) WHERE name = ? AND checksum = ? AND state = 'FAILED'",
    [recoverableStaffMigration, checksum],
  );
  if (result.affectedRows !== 1) throw new Error('0033 自动恢复未能取得 FAILED 迁移标记，请重新检查迁移元数据');
  process.stdout.write(`recovered ${recoverableStaffMigration}\n`);
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
      if (rows[0].state !== 'APPLIED') {
        if (file === recoverableStaffMigration && !staffMigrationRecoveryDisabledForTest) {
          await recoverFailedStaffMigration(checksum);
          continue;
        }
        throw new Error(`迁移此前失败，需人工检查并修复后再运行：${file}（${String(rows[0].error_message ?? 'unknown error')}）`);
      }
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
      if (file === recoverableStaffMigration && !staffMigrationRecoveryDisabledForTest) {
        try {
          await recoverFailedStaffMigration(checksum);
          continue;
        } catch (recoveryError) {
          throw new Error(`${message}\n0033 自动恢复失败：${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
        }
      }
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
