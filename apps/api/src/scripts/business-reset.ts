/** Offline operator CLI. Never imported by the server; never calls a payment provider. */
import { open, readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { canonicalEntityJson } from "../modules/core/entity-store-records.js";
import { assertEntityStoreDatabaseIdentity } from "./entity-store-target.js";
import { RESET_TABLES, ResetGuardError, digest, planBusinessReset, type DatabaseRows, type TableName } from "./business-reset-plan.js";

type Column = { name: string; type: string; key: string };
export type ResetSnapshot = { format: 1; identity: { serverUuid: string; schemaName: string }; schema: Record<TableName, Column[]>; rows: DatabaseRows };
const columnNames: Record<TableName, string> = {
  community_entity_records: "collection entity_key lookup_a lookup_b lookup_c lookup_d lookup_e lookup_f record_status created_at queue_at paid_at due_at retry_at lease_until provider_started_at unique_key search_text document",
  community_entity_relations: "source_collection source_key source_key_sha256 relation_name target_key target_key_sha256",
  community_entity_sequences: "sequence_name next_value updated_at",
  community_entity_store_state: "id mode source_schema_version source_sha256 migrated_at first_entity_write_at entity_write_count",
  community_entity_migration_journal: "collection source_sha256 state last_source_ordinal processed_count verified_count source_amount_cents entity_amount_cents source_debit_cents entity_debit_cents source_credit_cents entity_credit_cents reference_mismatches last_error started_at completed_at updated_at",
  community_legacy_snapshots: "id schema_version payload payload_sha256 captured_at",
  community_entity_reverse_exports: "id source_entity_write_count payload payload_sha256 exported_at",
  community_product_state: "id schema_version payload updated_at",
  schema_migrations: "name checksum state error_message applied_at",
};
const fail = (message: string): never => { throw new ResetGuardError(message); };
const quote = (name: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(name)) fail("Unsafe SQL identifier"); return `\`${name}\``; };
const binary = (column: Column) => ["binary", "varbinary", "blob"].includes(column.type);

export async function captureDatabase(connection: Connection, expected: ResetSnapshot["identity"], lock: boolean): Promise<ResetSnapshot> {
  const [identityRows] = await connection.query<RowDataPacket[]>("SELECT @@server_uuid AS serverUuid,DATABASE() AS schemaName,VERSION() AS version");
  const identity = { serverUuid: String(identityRows[0]?.serverUuid ?? ""), schemaName: String(identityRows[0]?.schemaName ?? "") };
  try { assertEntityStoreDatabaseIdentity(identity, expected); } catch { fail("Database identity mismatch"); }
  if (!String(identityRows[0]?.version).startsWith("8.4.")) fail("Only MySQL 8.4 is accepted");
  const [tables] = await connection.query<RowDataPacket[]>("SELECT TABLE_NAME AS name,ENGINE AS engine,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME");
  if (tables.map(row => row.name).sort().join() !== [...RESET_TABLES].sort().join() || tables.some(row => row.engine !== "InnoDB" || row.kind !== "BASE TABLE")) fail("Unknown table/view or nontransactional engine");
  for (const kind of ["TRIGGERS", "EVENTS", "ROUTINES"] as const) {
    const schemaColumn = kind === "TRIGGERS" ? "TRIGGER_SCHEMA" : kind === "EVENTS" ? "EVENT_SCHEMA" : "ROUTINE_SCHEMA";
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM information_schema.${kind} WHERE ${schemaColumn}=DATABASE()`);
    if (Number(rows[0]?.total) !== 0) fail("Unexpected database automation");
  }
  const schema = {} as ResetSnapshot["schema"];
  const rows = {} as DatabaseRows;
  let totalRows = 0;
  let totalBytes = 0;
  for (const table of RESET_TABLES) {
    const [columns] = await connection.execute<RowDataPacket[]>("SELECT COLUMN_NAME AS name,DATA_TYPE AS type,COLUMN_KEY AS `key` FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", [table]);
    schema[table] = columns.map(column => ({ name: String(column.name), type: String(column.type), key: String(column.key) }));
    if (schema[table].map(column => column.name).join(" ") !== columnNames[table]) fail(`Unknown columns in ${table}`);
    const primary = schema[table].filter(column => column.key === "PRI");
    if (!primary.length) fail("Missing primary key");
    const bytesSql = schema[table].map(column => `COALESCE(OCTET_LENGTH(${quote(column.name)}),0)`).join("+");
    const [count] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total,COALESCE(SUM(${bytesSql}),0) AS bytes FROM ${quote(table)}`);
    totalRows += Number(count[0]?.total);
    if (totalRows > 100_000) fail("Reset exceeds reviewed 100000-row bound; use a separately reviewed streaming plan");
    if (totalBytes + Number(count[0]?.bytes) > 64 * 1024 * 1024) fail("Reset snapshot exceeds reviewed 64 MiB bound");
    const projection = schema[table].map(column => `${binary(column) ? `HEX(${quote(column.name)})` : `CAST(${quote(column.name)} AS CHAR)`} AS ${quote(column.name)}`).join(",");
    const [selected] = await connection.query<RowDataPacket[]>(`SELECT ${projection} FROM ${quote(table)} ORDER BY ${primary.map(column => quote(column.name)).join(",")}${lock ? " FOR UPDATE" : ""}`);
    rows[table] = selected.map(row => Object.fromEntries(schema[table].map(column => [column.name, row[column.name] === null ? null : column.type === "json" ? canonicalEntityJson(JSON.parse(String(row[column.name]))) : String(row[column.name])])));
    totalBytes += Buffer.byteLength(JSON.stringify(rows[table]));
    if (totalBytes > 64 * 1024 * 1024) fail("Reset snapshot exceeds reviewed 64 MiB bound");
  }
  return { format: 1, identity, schema, rows };
}

export async function replaceDatabaseRows(connection: Connection, snapshot: ResetSnapshot, desired: DatabaseRows): Promise<void> {
  // DELETE/INSERT in one InnoDB transaction. No TRUNCATE, DDL, foreign-key bypass or schema deletion.
  for (const table of RESET_TABLES) {
    if (digest(snapshot.rows[table]) === digest(desired[table])) continue;
    await connection.query(`DELETE FROM ${quote(table)}`);
    const columns = snapshot.schema[table];
    const statement = `INSERT INTO ${quote(table)} (${columns.map(column => quote(column.name)).join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
    for (const row of desired[table]) {
      await connection.execute(statement, columns.map(column => {
        const value = row[column.name];
        if (value === undefined) fail("Missing backup column");
        return value !== null && binary(column) ? Buffer.from(value!, "hex") : value;
      }));
    }
  }
}

export async function privateWrite(path: string, value: unknown): Promise<string> {
  const absolute = resolve(path);
  if (absolute !== path || await realpath(dirname(path)) !== dirname(path)) fail("Use an absolute, nonsymlink private output directory");
  const parent = await stat(dirname(path));
  if ((parent.mode & 0o077) !== 0) fail("Output directory must be private (mode 700)");
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(canonicalEntityJson(value)); await handle.sync(); } finally { await handle.close(); }
  const saved = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (digest(saved) !== digest(value)) fail("Backup read-back failed");
  return digest(saved);
}

export async function runReset(): Promise<void> {
  const env = process.env;
  const action = process.argv[2];
  if (!["inspect", "apply", "restore"].includes(action ?? "")) fail("Choose inspect, apply or restore");
  for (const key of ["DATABASE_URL", "RESET_EXPECTED_HOST", "RESET_EXPECTED_SERVER_UUID", "RESET_EXPECTED_SCHEMA", "RESET_KEEP_ADMIN_ID", "RESET_OUTPUT"]) if (!env[key]) fail(`Missing ${key}`);
  const target = new URL(env.DATABASE_URL!);
  if (target.hostname !== env.RESET_EXPECTED_HOST || decodeURIComponent(target.pathname.slice(1)) !== env.RESET_EXPECTED_SCHEMA) fail("Connection target mismatch");
  if (action !== "inspect" && (env.RESET_WRITERS_STOPPED !== "CONFIRMED" || env.RESET_CONFIRM !== "OPS-20260929-REMOVE-RECON-RESET" || !env.RESET_EXPECTED_BEFORE_SHA256)) fail("Missing stopped-writers attestation, task confirmation or reviewed before hash");
  const connection = await mysql.createConnection({ uri: env.DATABASE_URL!, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  let locked = false;
  try {
    const [locks] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('community-group-buy:schema-migrations',0) AS acquired");
    if (Number(locks[0]?.acquired) !== 1) fail("Migration/reset writer already active");
    locked = true;
    if (action !== "inspect") {
      const [grants] = await connection.query<RowDataPacket[]>("SHOW GRANTS FOR CURRENT_USER");
      if (!grants.some(row => Object.values(row).some(value => /^GRANT (ALL PRIVILEGES|.*\bPROCESS\b.*) ON \*\.\*/.test(String(value))))) fail("Global PROCESS visibility is required to verify all database clients");
      const [clients] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND ID<>CONNECTION_ID()");
      if (Number(clients[0]?.total) !== 0) fail("Other database clients remain connected; stop writers first");
    }
    await connection.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await connection.beginTransaction();
    const identity = { serverUuid: env.RESET_EXPECTED_SERVER_UUID!, schemaName: env.RESET_EXPECTED_SCHEMA! };
    const before = await captureDatabase(connection, identity, action !== "inspect");
    // Validate migration content against this frozen source, not just names or a version count.
    for (const row of before.rows.schema_migrations) {
      if (!/^000[1-5]_[a-z_]+\.sql$/.test(row.name ?? "")) fail("Unexpected migration identity");
      const sql = await readFile(new URL(`../../../../infra/mysql/migrations/${row.name}`, import.meta.url), "utf8");
      const { createHash } = await import("node:crypto");
      if (createHash("sha256").update(sql).digest("hex") !== row.checksum) fail("Migration checksum mismatch");
    }
    const beforeHash = digest(before);
    if (action !== "inspect" && beforeHash !== env.RESET_EXPECTED_BEFORE_SHA256) fail("Data/schema changed since review; refusing reset or restore");
    if (action === "inspect") {
      const plan = planBusinessReset(before.rows, env.RESET_KEEP_ADMIN_ID!);
      const report = { action, identity, beforeHash, schemaHash: digest(before.schema), counts: plan.counts, retainedHash: plan.retainedHash };
      await privateWrite(env.RESET_OUTPUT!, report);
      await connection.rollback();
      process.stdout.write(JSON.stringify(report) + "\n");
      return;
    }
    let desired: DatabaseRows;
    if (action === "restore") {
      if (!env.RESET_BACKUP || !env.RESET_BACKUP_SHA256) fail("Restore requires explicit backup and digest");
      const info = await stat(env.RESET_BACKUP!);
      if ((info.mode & 0o077) !== 0) fail("Backup must be private");
      const backup = JSON.parse(await readFile(env.RESET_BACKUP!, "utf8")) as ResetSnapshot;
      if (digest(backup) !== env.RESET_BACKUP_SHA256 || backup.format !== 1 || digest(backup.identity) !== digest(identity) || digest(backup.schema) !== digest(before.schema)) fail("Backup identity/schema/digest mismatch");
      // Validate the old backup has precisely the expected policy shape before restoring anything.
      planBusinessReset(backup.rows, env.RESET_KEEP_ADMIN_ID!);
      desired = backup.rows;
    } else desired = planBusinessReset(before.rows, env.RESET_KEEP_ADMIN_ID!).after;
    // A private preimage is mandatory for both destructive reset AND rollback.
    const backupHash = await privateWrite(env.RESET_OUTPUT! + ".preimage.json", before);
    await replaceDatabaseRows(connection, before, desired);
    const after = await captureDatabase(connection, identity, true);
    if (digest(after.rows) !== digest(desired)) fail("Post-write records do not match the approved plan");
    const receipt = { action, identity, beforeHash, afterHash: digest(after), backupHash, schemaHash: digest(after.schema), tableCounts: Object.fromEntries(RESET_TABLES.map(table => [table, { before: before.rows[table].length, after: after.rows[table].length }])), status: "prepared-before-commit" };
    await privateWrite(env.RESET_OUTPUT! + ".prepared.json", receipt);
    await connection.commit();
    // If acknowledgement/output fails after COMMIT, never retry blindly: compare the prepared afterHash.
    await privateWrite(env.RESET_OUTPUT!, { ...receipt, status: "committed" });
    process.stdout.write(JSON.stringify({ ...receipt, status: "committed" }) + "\n");
  } finally {
    await connection.rollback().catch(() => undefined);
    if (locked) await connection.query("SELECT RELEASE_LOCK('community-group-buy:schema-migrations')").catch(() => undefined);
    await connection.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runReset().catch((error: unknown) => { if (error instanceof ResetGuardError) process.stderr.write(error.message + "\n"); process.stderr.write("Reset stopped. No secrets logged. Keep traffic/workers stopped; inspect private preimage/prepared receipt and actual database before retrying.\n"); process.exitCode = 1; });
}
