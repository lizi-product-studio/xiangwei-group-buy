export interface MigrationConnection {
  beginTransaction(): Promise<unknown>;
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  execute(sql: string, values?: unknown[]): Promise<unknown>;
}

export async function applyMigration(
  connection: MigrationConnection,
  file: string,
  checksum: string,
  sql: string,
): Promise<void> {
  await connection.beginTransaction();
  try {
    await connection.query(sql);
    await connection.execute(
      "INSERT INTO schema_migrations(name,checksum,state,error_message,applied_at) VALUES(?,?,'APPLIED',NULL,UTC_TIMESTAMP(3))",
      [file, checksum],
    );
    await connection.commit();
  } catch (migrationError) {
    await connection.rollback();
    const message = (
      migrationError instanceof Error ? migrationError.message : String(migrationError)
    ).slice(0, 1000);
    try {
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO schema_migrations(name,checksum,state,error_message,applied_at) VALUES(?,?,'FAILED',?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE checksum=VALUES(checksum),state='FAILED',error_message=VALUES(error_message),applied_at=VALUES(applied_at)",
        [file, checksum, message],
      );
      await connection.commit();
    } catch (recordError) {
      await connection.rollback().catch(() => undefined);
      throw new AggregateError(
        [migrationError, recordError],
        `迁移 ${file} 失败，且 FAILED 状态无法持久化`,
      );
    }
    throw migrationError;
  }
}
