import { createHash } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { canonicalEntityJson, canonicalEntityRecord, ENTITY_COLLECTIONS, entityRecordRelations, legacyStateRecords, toEntityRecord, type EntityCollection, type EntityRecord } from "../modules/core/entity-store-records.js";
import { assertEntityStoreDatabaseIdentity } from "./entity-store-target.js";

type SourceRow = RowDataPacket & { ordinal: number; raw: unknown };
type Command = "prepare" | "verify" | "activate" | "rollback";
const command = process.argv[2] as Command | undefined;
const databaseUrl = process.env.DATABASE_URL;
if (!command || !["prepare", "verify", "activate", "rollback"].includes(command))
  throw new Error("usage: entity-store-migration <prepare|verify|activate|rollback>");
if (!databaseUrl) throw new Error("Entity Store migration requires DATABASE_URL");
const target = new URL(databaseUrl);
const migrationTarget = process.env.ENTITY_STORE_TARGET;
const productionHost = "192.144.136.205";
const expectedServerUuid = process.env.ENTITY_STORE_EXPECTED_SERVER_UUID?.trim();
const expectedSchema = process.env.ENTITY_STORE_EXPECTED_SCHEMA?.trim();
if (migrationTarget !== "isolated-test" && migrationTarget !== "production")
  throw new Error("Set ENTITY_STORE_TARGET explicitly to isolated-test or production");
if (!expectedServerUuid || !expectedSchema)
  throw new Error("Entity Store migration requires ENTITY_STORE_EXPECTED_SERVER_UUID and ENTITY_STORE_EXPECTED_SCHEMA for the selected target");
if (migrationTarget === "isolated-test" && target.hostname === productionHost)
  throw new Error("isolated-test target cannot point to the production database");
if (migrationTarget === "production" &&
    (process.env.PRODUCTION_MIGRATION_WINDOW_CONFIRMED !== "true" || process.env.ENTITY_STORE_WRITER_FROZEN !== "true"))
  throw new Error("Production operations require PRODUCTION_MIGRATION_WINDOW_CONFIRMED=true and ENTITY_STORE_WRITER_FROZEN=true for the approved window");

const PAGE_SIZE = 200;
let activeCollection: EntityCollection | null = null;
const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: false, jsonStrings: true, timezone: "Z" });

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}
function rowRecords(collection: EntityCollection, rawInput: unknown): EntityRecord[] {
  const raw = parseJson(rawInput);
  if (collection === "audits") {
    const doc = raw as Record<string, unknown>;
    return [toEntityRecord(collection, JSON.stringify([doc.requestId, doc.action]), doc)];
  }
  if (collection === "pickupRecords" || collection === "deletedAccessRoleIds")
    return [toEntityRecord(collection, String(raw), raw)];
  if (collection === "lines") {
    const [orderId, lines] = raw as [string, Array<Record<string, unknown>>];
    return lines.map((line) => toEntityRecord(collection, orderId, { ...line, orderId }));
  }
  if (collection === "callbacks") {
    const [key, hash] = raw as [string, unknown];
    return [toEntityRecord(collection, key, hash)];
  }
  const [key, value] = raw as [string, unknown];
  return [toEntityRecord(collection, String(key), value)];
}
const amountPaths: Partial<Record<EntityCollection, string>> = {
  orders: "totalCents", lines: "amountCents", payments: "amountCents", paymentBatches: "amountCents",
  orderRefunds: "amountCents", partialRefunds: "amountCents",
};
function amountOf(collection: EntityCollection, record: EntityRecord): bigint | null {
  const doc = record.document as Record<string, unknown>;
  if (collection === "ledger") {
    const lines = Array.isArray(doc.lines) ? doc.lines as Array<Record<string, unknown>> : [];
    return lines.reduce((total, line) => total + BigInt(String(line.amountCents ?? 0)), 0n);
  }
  const path = amountPaths[collection];
  return path ? BigInt(String(doc[path] ?? 0)) : null;
}
function ledgerSides(records: EntityRecord[]): { debit: bigint; credit: bigint } {
  let debit = 0n, credit = 0n;
  for (const record of records) {
    if (record.collection !== "ledger") continue;
    const doc = record.document as Record<string, unknown>;
    for (const line of Array.isArray(doc.lines) ? doc.lines as Array<Record<string, unknown>> : []) {
      const amount = BigInt(String(line.amountCents ?? 0));
      if (line.direction === "DEBIT") debit += amount;
      else if (line.direction === "CREDIT") credit += amount;
    }
  }
  return { debit, credit };
}
function sourcePath(collection: EntityCollection): string {
  if (!/^[a-zA-Z]+$/.test(collection)) throw new Error(`Unsafe collection name: ${collection}`);
  return `$.${collection}[*]`;
}
async function sourceHash(): Promise<string> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT SHA2(CAST(payload AS CHAR CHARACTER SET utf8mb4),256) AS digest FROM community_product_state WHERE id=1",
  );
  if (!rows[0]?.digest) throw new Error("Legacy state row is missing");
  return String(rows[0].digest);
}
async function sourceOrdinalCount(collection: EntityCollection): Promise<number> {
  const path = sourcePath(collection);
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM community_product_state s, JSON_TABLE(s.payload, '${path}' COLUMNS (ordinal FOR ORDINALITY, raw JSON PATH '$')) j WHERE s.id=1`,
  );
  return Number(rows[0]?.total ?? 0);
}
async function sourceEntityCount(collection: EntityCollection): Promise<number> {
  if (collection !== "lines") return sourceOrdinalCount(collection);
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(JSON_LENGTH(JSON_EXTRACT(j.raw,'$[1]'))),0) AS total FROM community_product_state s, JSON_TABLE(s.payload, '$.lines[*]' COLUMNS (ordinal FOR ORDINALITY, raw JSON PATH '$')) j WHERE s.id=1",
  );
  return Number(rows[0]?.total ?? 0);
}
async function orderAmountTotal(source: boolean): Promise<bigint> {
  const sql = source
    ? "SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(j.raw,'$[1].totalCents')) AS DECIMAL(30,0))),0) AS total FROM community_product_state s, JSON_TABLE(s.payload, '$.orders[*]' COLUMNS (ordinal FOR ORDINALITY, raw JSON PATH '$')) j WHERE s.id=1"
    : "SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(document,'$.totalCents')) AS DECIMAL(30,0))),0) AS total FROM community_entity_records WHERE collection='orders'";
  const [rows] = await connection.query<RowDataPacket[]>(sql);
  return BigInt(String(rows[0]?.total ?? 0));
}
async function entityAmountTotal(collection: EntityCollection): Promise<bigint | null> {
  const path = amountPaths[collection];
  if (path) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(document,'$.${path}')) AS DECIMAL(30,0))),0) AS total FROM community_entity_records WHERE collection=?`,
      [collection],
    );
    return BigInt(String(rows[0]?.total ?? 0));
  }
  if (collection === "ledger") {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(l.amount_cents),0) AS total FROM community_entity_records r, JSON_TABLE(r.document,'$.lines[*]' COLUMNS (amount_cents DECIMAL(30,0) PATH '$.amountCents')) l WHERE r.collection='ledger'",
    );
    return BigInt(String(rows[0]?.total ?? 0));
  }
  return null;
}
function sqlDate(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value).slice(0, 23);
}
async function compareRecordsWithEntity(records: EntityRecord[], label: string): Promise<void> {
  const grouped = new Map<EntityCollection, EntityRecord[]>();
  for (const record of records) {
    const values = grouped.get(record.collection) ?? [];
    values.push(record);
    grouped.set(record.collection, values);
  }
  for (const [collection, values] of grouped) {
    for (let offset = 0; offset < values.length; offset += 300) {
      const batch = values.slice(offset, offset + 300);
      const keys = batch.map((record) => record.entityKey);
      if (new Set(keys).size !== keys.length) throw new Error(`${label}: duplicate source key in ${collection}`);
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT collection,entity_key AS entityKey,lookup_a AS lookupA,lookup_b AS lookupB,lookup_c AS lookupC,lookup_d AS lookupD,lookup_e AS lookupE,lookup_f AS lookupF,record_status AS status,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') AS createdAt,DATE_FORMAT(queue_at,'%Y-%m-%d %H:%i:%s.%f') AS queueAt,DATE_FORMAT(paid_at,'%Y-%m-%d %H:%i:%s.%f') AS paidAt,DATE_FORMAT(due_at,'%Y-%m-%d %H:%i:%s.%f') AS dueAt,DATE_FORMAT(retry_at,'%Y-%m-%d %H:%i:%s.%f') AS retryAt,DATE_FORMAT(lease_until,'%Y-%m-%d %H:%i:%s.%f') AS leaseUntil,DATE_FORMAT(provider_started_at,'%Y-%m-%d %H:%i:%s.%f') AS providerStartedAt,unique_key AS uniqueKey,search_text AS searchText,document FROM community_entity_records WHERE collection=? AND entity_key IN (${keys.map(() => "?").join(",")})`,
        [collection, ...keys],
      );
      const actualByKey = new Map(rows.map((row) => [String(row.entityKey), row]));
      for (const source of batch) {
        const row = actualByKey.get(source.entityKey);
        if (!row) throw new Error(`${label}: missing ${collection} source key ${source.entityKey}`);
        const actual: EntityRecord = {
          collection, entityKey: String(row.entityKey),
          lookupA: row.lookupA === null ? null : String(row.lookupA), lookupB: row.lookupB === null ? null : String(row.lookupB),
          lookupC: row.lookupC === null ? null : String(row.lookupC), lookupD: row.lookupD === null ? null : String(row.lookupD),
          lookupE: row.lookupE === null ? null : String(row.lookupE), lookupF: row.lookupF === null ? null : String(row.lookupF),
          status: row.status === null ? null : String(row.status),
          createdAt: sqlDate(row.createdAt), queueAt: sqlDate(row.queueAt), paidAt: sqlDate(row.paidAt), dueAt: sqlDate(row.dueAt),
          retryAt: sqlDate(row.retryAt), leaseUntil: sqlDate(row.leaseUntil), providerStartedAt: sqlDate(row.providerStartedAt),
          uniqueKey: row.uniqueKey === null ? null : String(row.uniqueKey), searchText: row.searchText === null ? null : String(row.searchText),
          document: parseJson(row.document),
        };
        if (canonicalEntityRecord(source) !== canonicalEntityRecord(actual))
          throw new Error(`${label}: canonical record mismatch for ${collection}:${source.entityKey}`);
      }
      if (collection === "campaigns" || collection === "checkoutBatches") {
        const sourceKeys = new Set(keys);
        const hashes = [...new Set(keys.map((value) => createHash("sha256").update(value).digest()))];
        const [relationRows] = await connection.execute<RowDataPacket[]>(
          `SELECT source_key AS sourceKey,relation_name AS relationName,target_key AS targetKey FROM community_entity_relations WHERE source_collection=? AND source_key_sha256 IN (${hashes.map(() => "?").join(",")})`,
          [collection, ...hashes],
        );
        const expected = batch.flatMap((record) => entityRecordRelations(record).map(([relationName, targetKey]) => [record.entityKey, relationName, targetKey]));
        const actual = relationRows.filter((row) => sourceKeys.has(String(row.sourceKey)))
          .map((row) => [String(row.sourceKey), String(row.relationName), String(row.targetKey)]);
        const expectedCanonical = [...new Set(expected.map(canonicalEntityJson))].sort();
        const actualCanonical = actual.map(canonicalEntityJson).sort();
        if (canonicalEntityJson(expectedCanonical) !== canonicalEntityJson(actualCanonical))
          throw new Error(`${label}: source relation mismatch for ${collection} page at ${offset}`);
      }
    }
  }
}
async function verifySourceRecords(collection: EntityCollection): Promise<void> {
  const expected = await sourceOrdinalCount(collection);
  const path = sourcePath(collection);
  let lastOrdinal = 0;
  while (lastOrdinal < expected) {
    const [page] = await connection.execute<SourceRow[]>(
      `SELECT j.ordinal,j.raw FROM community_product_state s, JSON_TABLE(s.payload, '${path}' COLUMNS (ordinal FOR ORDINALITY, raw JSON PATH '$')) j WHERE s.id=1 AND j.ordinal>? ORDER BY j.ordinal LIMIT ${PAGE_SIZE}`,
      [lastOrdinal],
    );
    if (!page.length) throw new Error(`Source verification page stalled at ${collection}:${lastOrdinal}`);
    const records = page.flatMap((row) => rowRecords(collection, row.raw));
    await compareRecordsWithEntity(records, "source verification");
    lastOrdinal = Number(page.at(-1)!.ordinal);
  }
}
async function entityLedgerSides(): Promise<{ debit: bigint; credit: bigint }> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT l.direction,COALESCE(SUM(l.amount_cents),0) AS total FROM community_entity_records r, JSON_TABLE(r.document,'$.lines[*]' COLUMNS (direction VARCHAR(16) PATH '$.direction', amount_cents DECIMAL(30,0) PATH '$.amountCents')) l WHERE r.collection='ledger' GROUP BY l.direction",
  );
  return {
    debit: BigInt(String(rows.find((row) => row.direction === "DEBIT")?.total ?? 0)),
    credit: BigInt(String(rows.find((row) => row.direction === "CREDIT")?.total ?? 0)),
  };
}
async function insertRecords(records: EntityRecord[]): Promise<void> {
  if (!records.length) return;
  const valuesFor = (record: EntityRecord) => [
    record.collection, record.entityKey, record.lookupA, record.lookupB, record.lookupC, record.lookupD,
    record.lookupE, record.lookupF, record.status, record.createdAt, record.queueAt, record.paidAt,
    record.dueAt, record.retryAt, record.leaseUntil, record.providerStartedAt, record.uniqueKey,
    record.searchText, JSON.stringify(record.document),
  ];
  const columns = 19;
  const valuesSql = records.map(() => `(${Array.from({ length: columns }, () => "?").join(",")})`).join(",");
  const values = records.flatMap(valuesFor);
  try {
    await connection.execute(
      `INSERT INTO community_entity_records(collection,entity_key,lookup_a,lookup_b,lookup_c,lookup_d,lookup_e,lookup_f,record_status,created_at,queue_at,paid_at,due_at,retry_at,lease_until,provider_started_at,unique_key,search_text,document) VALUES ${valuesSql}`,
      values,
    );
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ER_DUP_ENTRY") throw error;
    for (const record of records) {
      try {
        await connection.execute(
          "INSERT INTO community_entity_records(collection,entity_key,lookup_a,lookup_b,lookup_c,lookup_d,lookup_e,lookup_f,record_status,created_at,queue_at,paid_at,due_at,retry_at,lease_until,provider_started_at,unique_key,search_text,document) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          valuesFor(record),
        );
      } catch (duplicate) {
        if (!duplicate || typeof duplicate !== "object" || !("code" in duplicate) || duplicate.code !== "ER_DUP_ENTRY") throw duplicate;
        const [sameKey] = await connection.execute<RowDataPacket[]>("SELECT entity_key FROM community_entity_records WHERE collection=? AND entity_key=? FOR UPDATE", [record.collection, record.entityKey]);
        if (!sameKey.length) throw new Error(`Entity business-key conflict in ${record.collection}; existing row was preserved`);
        if (record.uniqueKey !== null) {
          const [businessKey] = await connection.execute<RowDataPacket[]>("SELECT entity_key FROM community_entity_records WHERE collection=? AND unique_key=? FOR UPDATE", [record.collection, record.uniqueKey]);
          if (businessKey.some((row) => String(row.entity_key) !== record.entityKey))
            throw new Error(`Entity business-key conflict in ${record.collection}; existing row was preserved`);
        }
        const fields = valuesFor(record).slice(2);
        await connection.execute("UPDATE community_entity_records SET lookup_a=?,lookup_b=?,lookup_c=?,lookup_d=?,lookup_e=?,lookup_f=?,record_status=?,created_at=?,queue_at=?,paid_at=?,due_at=?,retry_at=?,lease_until=?,provider_started_at=?,unique_key=?,search_text=?,document=? WHERE collection=? AND entity_key=?", [...fields, record.collection, record.entityKey]);
      }
    }
  }
  type Relation = readonly [string, string, string, string];
  const relations = records.flatMap<Relation>((record) => entityRecordRelations(record)
    .map(([name, target]) => [record.collection, record.entityKey, name, target] as Relation));
  if (relations.length) {
    for (let offset = 0; offset < relations.length; offset += 500) {
      const batch = relations.slice(offset, offset + 500);
      const values: unknown[] = batch.flatMap(([sourceCollection, sourceKey, relationName, targetKey]) => [
        sourceCollection, sourceKey, createHash("sha256").update(sourceKey).digest(), relationName, targetKey,
        createHash("sha256").update(targetKey).digest(),
      ]);
      const relationSql = batch.map(() => "(?,?,?,?,?,?)").join(",");
      await connection.execute(
        `INSERT IGNORE INTO community_entity_relations(source_collection,source_key,source_key_sha256,relation_name,target_key,target_key_sha256) VALUES ${relationSql}`,
        values,
      );
      const tupleSql = batch.map(() => "(?,?,?,?)").join(",");
      const tupleValues: unknown[] = batch.flatMap(([sourceCollection, sourceKey, relationName, targetKey]) => [
        sourceCollection, createHash("sha256").update(sourceKey).digest(), relationName, createHash("sha256").update(targetKey).digest(),
      ]);
      const [stored] = await connection.execute<RowDataPacket[]>(
        `SELECT source_collection,source_key,source_key_sha256,relation_name,target_key,target_key_sha256 FROM community_entity_relations WHERE (source_collection,source_key_sha256,relation_name,target_key_sha256) IN (${tupleSql})`,
        tupleValues,
      );
      const fullKeys = new Map<string, readonly [string, string]>(stored.map((row) => [
        `${row.source_collection}:${Buffer.from(row.source_key_sha256 as Buffer).toString("hex")}:${row.relation_name}:${Buffer.from(row.target_key_sha256 as Buffer).toString("hex")}`,
        [String(row.source_key), String(row.target_key)] as const,
      ]));
      for (const [sourceCollection, sourceKey, relationName, targetKey] of batch) {
        const identity = `${sourceCollection}:${createHash("sha256").update(sourceKey).digest("hex")}:${relationName}:${createHash("sha256").update(targetKey).digest("hex")}`;
        const storedKeys = fullKeys.get(identity);
        if (!storedKeys || storedKeys[0] !== sourceKey || storedKeys[1] !== targetKey)
          throw new Error("Entity relation hash collision or missing full-key value; refusing to merge distinct relations");
      }
    }
  }
}
async function prepare(): Promise<void> {
  await connection.beginTransaction();
  let digest: string;
  try {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT schema_version FROM community_product_state WHERE id=1 FOR UPDATE");
    if (!rows[0]) throw new Error("Legacy state row is missing");
    const [stateRows] = await connection.query<RowDataPacket[]>("SELECT mode FROM community_entity_store_state WHERE id=1 FOR UPDATE");
    const currentMode = String(stateRows[0]?.mode ?? "");
    if (currentMode !== "LEGACY" && currentMode !== "PREPARED")
      throw new Error(`Entity Store prepare requires LEGACY or PREPARED mode; current mode is ${currentMode || "missing"}`);
    digest = await sourceHash();
    const schemaVersion = Number(rows[0].schema_version);
    const [existingSnapshots] = await connection.execute<RowDataPacket[]>("SELECT payload_sha256 FROM community_legacy_snapshots WHERE id=1 FOR UPDATE");
    if (existingSnapshots.length && String(existingSnapshots[0]?.payload_sha256) !== digest)
      throw new Error("Immutable legacy snapshot exists with a different hash; stop and investigate");
    if (!existingSnapshots.length)
      await connection.execute(
        "INSERT INTO community_legacy_snapshots(id,schema_version,payload,payload_sha256,captured_at) SELECT 1,s.schema_version,s.payload,?,UTC_TIMESTAMP(3) FROM community_product_state AS s WHERE s.id=1",
        [digest],
      );
    const [snapshot] = await connection.execute<RowDataPacket[]>("SELECT payload_sha256 FROM community_legacy_snapshots WHERE id=1");
    if (String(snapshot[0]?.payload_sha256) !== digest) throw new Error("Immutable legacy snapshot exists with a different hash; stop and investigate");
    await connection.execute(
      "UPDATE community_entity_store_state SET mode='PREPARED',source_schema_version=?,source_sha256=? WHERE id=1 AND mode IN ('LEGACY','PREPARED')",
      [schemaVersion, digest],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
  const digestValue = await sourceHash();
  if (digestValue !== digest!) throw new Error("Legacy payload changed while preparing; rerun after maintenance and snapshot review");
  for (const collection of ENTITY_COLLECTIONS) {
    activeCollection = collection;
    const [journals] = await connection.execute<RowDataPacket[]>("SELECT source_sha256,state,last_source_ordinal,processed_count,source_amount_cents,source_debit_cents,source_credit_cents FROM community_entity_migration_journal WHERE collection=?", [collection]);
    const journal = journals[0];
    if (journal?.state === "COMPLETE" && String(journal.source_sha256) === digestValue) continue;
    if (journal && String(journal.source_sha256) !== digestValue)
      throw new Error(`Source changed since ${collection} migration began; stop and request a controlled reset`);
    const ordinalCount = await sourceOrdinalCount(collection);
    let lastOrdinal = Number(journal?.last_source_ordinal ?? 0);
    let processed = Number(journal?.processed_count ?? 0);
    let sourceAmount = journal?.source_amount_cents === null || journal?.source_amount_cents === undefined
      ? 0n : BigInt(String(journal.source_amount_cents));
    let sourceDebit = BigInt(String(journal?.source_debit_cents ?? 0));
    let sourceCredit = BigInt(String(journal?.source_credit_cents ?? 0));
    if (!journal) await connection.execute(
      "INSERT INTO community_entity_migration_journal(collection,source_sha256,state,processed_count,updated_at) VALUES(?,?,'RUNNING',0,UTC_TIMESTAMP(3))",
      [collection, digestValue],
    );
    while (lastOrdinal < ordinalCount) {
      const path = sourcePath(collection);
      const [page] = await connection.execute<SourceRow[]>(
        `SELECT j.ordinal,j.raw FROM community_product_state s, JSON_TABLE(s.payload, '${path}' COLUMNS (ordinal FOR ORDINALITY, raw JSON PATH '$')) j WHERE s.id=1 AND j.ordinal>? ORDER BY j.ordinal LIMIT ${PAGE_SIZE}`,
        [lastOrdinal],
      );
      if (!page.length) throw new Error(`Migration page stalled at ${collection}:${lastOrdinal}`);
      const records = page.flatMap((row) => rowRecords(collection, row.raw));
      const pageAmount = records.reduce((total, record) => total + (amountOf(collection, record) ?? 0n), 0n);
      const pageSides = collection === "ledger" ? ledgerSides(records) : { debit: 0n, credit: 0n };
      await connection.beginTransaction();
      try {
        await insertRecords(records);
        lastOrdinal = Number(page.at(-1)!.ordinal);
        processed += records.length;
        await connection.execute(
          "UPDATE community_entity_migration_journal SET state='RUNNING',last_source_ordinal=?,processed_count=?,source_amount_cents=?,source_debit_cents=?,source_credit_cents=?,updated_at=UTC_TIMESTAMP(3) WHERE collection=? AND source_sha256=?",
          [lastOrdinal, processed, (sourceAmount + pageAmount).toString(), (sourceDebit + pageSides.debit).toString(), (sourceCredit + pageSides.credit).toString(), collection, digestValue],
        );
        sourceAmount += pageAmount;
        sourceDebit += pageSides.debit;
        sourceCredit += pageSides.credit;
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
      process.stdout.write(`${collection}: ${processed} rows (${lastOrdinal}/${ordinalCount} source entries)\n`);
    }
    const expected = await sourceEntityCount(collection);
    const [counts] = await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_records WHERE collection=?", [collection]);
    const actual = Number(counts[0]?.total ?? 0);
    if (actual !== expected || processed !== expected)
      throw new Error(`${collection} count mismatch: source=${expected}, processed=${processed}, entity=${actual}`);
    await verifySourceRecords(collection);
    const entityAmount = await entityAmountTotal(collection);
    if (entityAmount !== null && sourceAmount !== entityAmount)
      throw new Error(`${collection} amount cents mismatch: source=${sourceAmount}, entity=${entityAmount}`);
    const entitySides = collection === "ledger" ? await entityLedgerSides() : null;
    if (entitySides && (sourceDebit !== entitySides.debit || sourceCredit !== entitySides.credit))
      throw new Error(`Ledger side totals mismatch: source debit/credit=${sourceDebit}/${sourceCredit}, entity=${entitySides.debit}/${entitySides.credit}`);
    await connection.execute(
      "UPDATE community_entity_migration_journal SET state='COMPLETE',verified_count=?,source_amount_cents=?,entity_amount_cents=?,source_debit_cents=?,entity_debit_cents=?,source_credit_cents=?,entity_credit_cents=?,reference_mismatches=0,last_error=NULL,completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE collection=? AND source_sha256=?",
      [actual, entityAmount === null ? null : sourceAmount.toString(), entityAmount?.toString() ?? null,
        collection === "ledger" ? sourceDebit.toString() : null, entitySides?.debit.toString() ?? null,
        collection === "ledger" ? sourceCredit.toString() : null, entitySides?.credit.toString() ?? null,
        collection, digestValue],
    );
    activeCollection = null;
  }
  const maximum = await connection.query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(j.raw,'$[1].consumerNumber')) AS UNSIGNED)),0)+1 AS next_value FROM community_product_state s, JSON_TABLE(s.payload, '$.users[*]' COLUMNS (ordinal FOR ORDINALITY, raw JSON PATH '$')) j WHERE s.id=1",
  );
  const nextValue = Number((maximum[0] as RowDataPacket[])[0]?.next_value ?? 1);
  await connection.execute(
    "INSERT INTO community_entity_sequences(sequence_name,next_value,updated_at) VALUES('consumer-public-number',?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE next_value=GREATEST(next_value,VALUES(next_value)),updated_at=VALUES(updated_at)",
    [nextValue],
  );
  process.stdout.write(`prepared ${ENTITY_COLLECTIONS.length} collections; source sha256 ${digestValue}\n`);
}
async function verify(): Promise<void> {
  const digestValue = await sourceHash();
  const [modeRows] = await connection.query<RowDataPacket[]>("SELECT mode,source_sha256 FROM community_entity_store_state WHERE id=1");
  if (modeRows[0]?.mode !== "PREPARED" || String(modeRows[0]?.source_sha256) !== digestValue)
    throw new Error("Store is not prepared from the current unchanged source snapshot");
  const failed: string[] = [];
  for (const collection of ENTITY_COLLECTIONS) {
    const expected = await sourceEntityCount(collection);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT state,processed_count,verified_count,source_sha256 FROM community_entity_migration_journal WHERE collection=?", [collection]);
    const journal = rows[0];
    const [entityRows] = await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_records WHERE collection=?", [collection]);
    const actual = Number(entityRows[0]?.total ?? 0);
    if (!journal || journal.state !== "COMPLETE" || String(journal.source_sha256) !== digestValue || Number(journal.processed_count) !== expected || Number(journal.verified_count) !== expected || actual !== expected)
      failed.push(`${collection}(source=${expected},journal=${Number(journal?.processed_count ?? 0)},verified=${Number(journal?.verified_count ?? 0)},entity=${actual},state=${String(journal?.state ?? "missing")})`);
    await verifySourceRecords(collection);
  }
  const sourceTotal = await orderAmountTotal(true);
  const entityTotal = await orderAmountTotal(false);
  if (sourceTotal !== entityTotal) failed.push(`order-cents(source=${sourceTotal},entity=${entityTotal})`);
  for (const collection of Object.keys(amountPaths) as EntityCollection[]) {
    const [journalRows] = await connection.execute<RowDataPacket[]>("SELECT source_amount_cents FROM community_entity_migration_journal WHERE collection=?", [collection]);
    const sourceAmount = BigInt(String(journalRows[0]?.source_amount_cents ?? 0));
    const entityAmount = await entityAmountTotal(collection) ?? 0n;
    if (sourceAmount !== entityAmount) failed.push(`${collection}-cents(source=${sourceAmount},entity=${entityAmount})`);
  }
  const [ledgerJournal] = await connection.execute<RowDataPacket[]>(
    "SELECT source_debit_cents,source_credit_cents FROM community_entity_migration_journal WHERE collection='ledger'",
  );
  const entitySides = await entityLedgerSides();
  if (BigInt(String(ledgerJournal[0]?.source_debit_cents ?? 0)) !== entitySides.debit || BigInt(String(ledgerJournal[0]?.source_credit_cents ?? 0)) !== entitySides.credit)
    failed.push(`ledger-sides(source=${String(ledgerJournal[0]?.source_debit_cents ?? 0)}/${String(ledgerJournal[0]?.source_credit_cents ?? 0)},entity=${entitySides.debit}/${entitySides.credit})`);
  const [orphanRows] = await connection.query<RowDataPacket[]>(
    `SELECT
      (SELECT COUNT(*) FROM community_entity_records o LEFT JOIN community_entity_records u ON u.collection='users' AND u.entity_key=o.lookup_a WHERE o.collection='orders' AND u.entity_key IS NULL) AS orphan_users,
      (SELECT COUNT(*) FROM community_entity_records l LEFT JOIN community_entity_records o ON o.collection='orders' AND o.entity_key=l.lookup_a WHERE l.collection='lines' AND o.entity_key IS NULL) AS orphan_lines,
      (SELECT COUNT(*) FROM community_entity_records p LEFT JOIN community_entity_records o ON o.collection='orders' AND o.entity_key=p.lookup_a WHERE p.collection='payments' AND o.entity_key IS NULL) AS orphan_payments,
      (SELECT COUNT(*) FROM community_entity_records r LEFT JOIN community_entity_records o ON o.collection='orders' AND o.entity_key=r.lookup_a WHERE r.collection='orderRefunds' AND o.entity_key IS NULL) AS orphan_order_refunds,
      (SELECT COUNT(*) FROM community_entity_records r LEFT JOIN community_entity_records o ON o.collection='orders' AND o.entity_key=r.lookup_a WHERE r.collection='partialRefunds' AND o.entity_key IS NULL) AS orphan_partial_refunds,
      (SELECT COALESCE(SUM(JSON_LENGTH(JSON_EXTRACT(document,'$.orderIds'))),0) FROM community_entity_records WHERE collection='checkoutBatches') - (SELECT COUNT(*) FROM community_entity_relations WHERE source_collection='checkoutBatches' AND relation_name='order_id') AS missing_checkout_links,
      (SELECT COALESCE(SUM(JSON_LENGTH(JSON_EXTRACT(document,'$.items'))),0) FROM community_entity_records WHERE collection='campaigns') - (SELECT COUNT(*) FROM community_entity_relations WHERE source_collection='campaigns' AND relation_name='catalog_sku') AS missing_campaign_links`,
  );
  const orphanUsers = Number(orphanRows[0]?.orphan_users ?? 0);
  const orphanLines = Number(orphanRows[0]?.orphan_lines ?? 0);
  const orphanPayments = Number(orphanRows[0]?.orphan_payments ?? 0);
  const orphanOrderRefunds = Number(orphanRows[0]?.orphan_order_refunds ?? 0);
  const orphanPartialRefunds = Number(orphanRows[0]?.orphan_partial_refunds ?? 0);
  const missingCheckoutLinks = Number(orphanRows[0]?.missing_checkout_links ?? 0);
  const missingCampaignLinks = Number(orphanRows[0]?.missing_campaign_links ?? 0);
  if (orphanUsers || orphanLines || orphanPayments || orphanOrderRefunds || orphanPartialRefunds || missingCheckoutLinks || missingCampaignLinks)
    failed.push(`orphan-or-relation-check(users=${orphanUsers},lines=${orphanLines},payments=${orphanPayments},orderRefunds=${orphanOrderRefunds},partialRefunds=${orphanPartialRefunds},checkoutLinks=${missingCheckoutLinks},campaignLinks=${missingCampaignLinks})`);
  if (failed.length) throw new Error(`Entity Store verification failed: ${failed.join("; ")}`);
  process.stdout.write(`verified ${ENTITY_COLLECTIONS.length} collections, order cents=${sourceTotal}, orphan users/lines=0, source sha256 ${digestValue}\n`);
}
function emptyLegacyPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const collection of ENTITY_COLLECTIONS) payload[collection] = collection === "audits" ? [] : [];
  return payload;
}
async function exportEntityPayload(): Promise<{ payload: Record<string, unknown>; writeCount: number }> {
  const payload = emptyLegacyPayload();
  const maxPayloadBytes = 32 * 1024 * 1024;
  const emptyPayloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  let serializedBytes = emptyPayloadBytes;
  let serializedLineGroupsBytes = 2;
  let lineGroupCount = 0;
  const assertWithinPayloadLimit = (): void => {
    if (serializedBytes > maxPayloadBytes)
      throw new Error("Reverse export exceeds the supported 32 MiB payload limit; keep Entity Store active and recover forward");
  };
  for (const collection of ENTITY_COLLECTIONS) {
    let after = "";
    const values: unknown[] = [];
    const lineGroups = new Map<string, unknown[]>();
    while (true) {
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT entity_key,document,created_at FROM community_entity_records WHERE collection=? AND entity_key>? ORDER BY entity_key LIMIT ${PAGE_SIZE}`,
        [collection, after],
      );
      if (!rows.length) break;
      for (const row of rows) {
        const key = String(row.entity_key);
        const doc = parseJson(row.document);
        if (collection === "audits") {
          const value = doc;
          serializedBytes += Buffer.byteLength(JSON.stringify(value), "utf8") + (values.length ? 1 : 0);
          values.push(value);
          assertWithinPayloadLimit();
        } else if (collection === "callbacks") {
          const value = [key, (doc as Record<string, unknown>).bodyHash];
          serializedBytes += Buffer.byteLength(JSON.stringify(value), "utf8") + (values.length ? 1 : 0);
          values.push(value);
          assertWithinPayloadLimit();
        } else if (collection === "pickupRecords") {
          const value = (doc as Record<string, unknown>).record;
          serializedBytes += Buffer.byteLength(JSON.stringify(value), "utf8") + (values.length ? 1 : 0);
          values.push(value);
          assertWithinPayloadLimit();
        } else if (collection === "deletedAccessRoleIds") {
          const value = key;
          serializedBytes += Buffer.byteLength(JSON.stringify(value), "utf8") + (values.length ? 1 : 0);
          values.push(value);
          assertWithinPayloadLimit();
        }
        else if (collection === "lines") {
          const line = doc as Record<string, unknown>;
          const orderId = String(line.orderId ?? "");
          let group = lineGroups.get(orderId);
          const isNewGroup = !group;
          if (!group) group = [];
          const previousLineGroupsBytes = serializedLineGroupsBytes;
          const lineBytes = Buffer.byteLength(JSON.stringify(line), "utf8");
          const groupDelta = isNewGroup
            ? Buffer.byteLength(JSON.stringify([orderId, []]), "utf8") + lineBytes
            : lineBytes + 1;
          group.push(line);
          lineGroups.set(orderId, group);
          if (isNewGroup) {
            serializedLineGroupsBytes += groupDelta + (lineGroupCount ? 1 : 0);
            lineGroupCount += 1;
          } else serializedLineGroupsBytes += groupDelta;
          serializedBytes += serializedLineGroupsBytes - previousLineGroupsBytes;
          assertWithinPayloadLimit();
        } else {
          const value = [key, doc];
          serializedBytes += Buffer.byteLength(JSON.stringify(value), "utf8") + (values.length ? 1 : 0);
          values.push(value);
          assertWithinPayloadLimit();
        }
      }
      after = String(rows.at(-1)!.entity_key);
    }
    if (collection === "audits") {
      payload.audits = values;
      (payload.audits as Array<Record<string, unknown>>).sort((left, right) =>
        String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")) ||
        JSON.stringify([left.requestId, left.action]).localeCompare(JSON.stringify([right.requestId, right.action])));
    } else if (collection === "lines") {
      payload.lines = [...lineGroups.entries()].map(([orderId, lines]) => [orderId, lines]);
    } else payload[collection] = values;
  }
  const serialized = JSON.stringify(payload);
  serializedBytes = Buffer.byteLength(serialized, "utf8");
  assertWithinPayloadLimit();
  const [stateRows] = await connection.query<RowDataPacket[]>("SELECT entity_write_count FROM community_entity_store_state WHERE id=1");
  return { payload, writeCount: Number(stateRows[0]?.entity_write_count ?? 0) };
}
async function assertReversePayload(payload: Record<string, unknown>): Promise<void> {
  const records = legacyStateRecords(JSON.stringify(payload));
  await compareRecordsWithEntity(records, "reverse export");
  for (const collection of ENTITY_COLLECTIONS) {
    const expected = await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_records WHERE collection=?", [collection]);
    const actual = records.filter((record) => record.collection === collection).length;
    if (actual !== Number(expected[0][0]?.total ?? 0)) throw new Error(`Reverse export count mismatch for ${collection}: exported=${actual}, entity=${String(expected[0][0]?.total ?? 0)}`);
  }
  const reversedOrders = records.filter((record) => record.collection === "orders").reduce((sum, record) => sum + (amountOf("orders", record) ?? 0n), 0n);
  if (reversedOrders !== await orderAmountTotal(false)) throw new Error(`Reverse export order cents mismatch: exported=${reversedOrders}, entity=${await orderAmountTotal(false)}`);
  for (const collection of Object.keys(amountPaths) as EntityCollection[]) {
    const exported = records.filter((record) => record.collection === collection).reduce((sum, record) => sum + (amountOf(collection, record) ?? 0n), 0n);
    const entity = await entityAmountTotal(collection) ?? 0n;
    if (exported !== entity) throw new Error(`Reverse export ${collection} cents mismatch: exported=${exported}, entity=${entity}`);
  }
  const exportedLedger = ledgerSides(records);
  const entityLedger = await entityLedgerSides();
  if (exportedLedger.debit !== entityLedger.debit || exportedLedger.credit !== entityLedger.credit)
    throw new Error(`Reverse export ledger sides mismatch: exported=${exportedLedger.debit}/${exportedLedger.credit}, entity=${entityLedger.debit}/${entityLedger.credit}`);
  const serialized = JSON.stringify(payload);
  if (!serialized || Buffer.byteLength(serialized, "utf8") > 32 * 1024 * 1024)
    throw new Error("Reverse export exceeds the supported 32 MiB payload limit; keep Entity Store active and recover forward");
}
async function activate(): Promise<void> {
  if (process.env.SINGLE_WRITER_CONFIRMED !== "true") throw new Error("Activation requires explicit SINGLE_WRITER_CONFIRMED=true");
  await verify();
  await connection.beginTransaction();
  try {
    await connection.query("SELECT id FROM community_product_state WHERE id=1 FOR UPDATE");
    const digestValue = await sourceHash();
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT mode,source_sha256,first_entity_write_at,entity_write_count FROM community_entity_store_state WHERE id=1 FOR UPDATE",
    );
    if (rows[0]?.mode !== "PREPARED" || String(rows[0]?.source_sha256) !== digestValue || rows[0]?.first_entity_write_at || Number(rows[0]?.entity_write_count) !== 0)
      throw new Error("Activation preconditions changed; refusing cutover");
    await connection.execute("UPDATE community_entity_store_state SET mode='ENTITY' WHERE id=1");
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
  process.stdout.write("Entity Store mode activated; API remains in maintenance unless its single-writer gate is confirmed\n");
}
async function rollback(): Promise<void> {
  if (process.env.ENTITY_STORE_WRITER_FROZEN !== "true")
    throw new Error("Rollback requires the API writer to be frozen with ENTITY_STORE_WRITER_FROZEN=true");
  await connection.beginTransaction();
  try {
    await connection.query("SELECT id FROM community_product_state WHERE id=1 FOR UPDATE");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT mode,source_schema_version,source_sha256,first_entity_write_at,entity_write_count FROM community_entity_store_state WHERE id=1 FOR UPDATE");
    const state = rows[0];
    if (!state || !["PREPARED", "ENTITY"].includes(String(state.mode))) throw new Error("Store is not in a prepared/entity mode");
    const entityWriteCount = Number(state.entity_write_count);
    if ((state.first_entity_write_at && entityWriteCount === 0) || (!state.first_entity_write_at && entityWriteCount > 0))
      throw new Error("Entity write marker is inconsistent; preserve both stores and investigate");
  if (entityWriteCount > 0) {
      const { payload, writeCount } = await exportEntityPayload();
      if (writeCount !== entityWriteCount) throw new Error(`Entity write count changed during reverse export: state=${entityWriteCount}, export=${writeCount}`);
      await assertReversePayload(payload);
      const serialized = JSON.stringify(payload);
      await connection.query("SET @community_entity_reverse_payload = ?", [serialized]);
      await connection.execute(
        "INSERT INTO community_entity_reverse_exports(id,source_entity_write_count,payload,payload_sha256,exported_at) SELECT 1,?,CAST(@community_entity_reverse_payload AS JSON),SHA2(CAST(CAST(@community_entity_reverse_payload AS JSON) AS CHAR CHARACTER SET utf8mb4),256),UTC_TIMESTAMP(3) ON DUPLICATE KEY UPDATE id=IF(community_entity_reverse_exports.source_entity_write_count=VALUES(source_entity_write_count) AND community_entity_reverse_exports.payload_sha256=VALUES(payload_sha256),community_entity_reverse_exports.id,NULL)",
        [entityWriteCount],
      );
      const [exportRows] = await connection.execute<RowDataPacket[]>("SELECT source_entity_write_count,payload_sha256,SHA2(CAST(payload AS CHAR CHARACTER SET utf8mb4),256) AS actual_sha256 FROM community_entity_reverse_exports WHERE id=1");
      if (Number(exportRows[0]?.source_entity_write_count) !== entityWriteCount || String(exportRows[0]?.payload_sha256) !== String(exportRows[0]?.actual_sha256))
        throw new Error("Reverse export conflicts with an existing export or failed its stored hash check; preserve both stores and investigate");
      const [snapshot] = await connection.execute<RowDataPacket[]>("SELECT payload_sha256 FROM community_legacy_snapshots WHERE id=1");
      if (!snapshot[0] || String(snapshot[0].payload_sha256) !== String(state.source_sha256))
        throw new Error("Immutable original legacy snapshot is missing or its hash does not match the migration source");
      await connection.execute(
        "UPDATE community_product_state SET payload=(SELECT payload FROM community_entity_reverse_exports WHERE id=1),updated_at=UTC_TIMESTAMP(3) WHERE id=1",
      );
      const [updated] = await connection.query<RowDataPacket[]>("SELECT SHA2(CAST(payload AS CHAR CHARACTER SET utf8mb4),256) AS digest FROM community_product_state WHERE id=1");
      await connection.execute("UPDATE community_entity_store_state SET mode='LEGACY',source_sha256=? WHERE id=1", [String(updated[0]?.digest)]);
    } else {
      await connection.execute("UPDATE community_entity_store_state SET mode='LEGACY' WHERE id=1");
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
  process.stdout.write("Legacy mode restored from the verified reverse export; immutable original snapshot and additive entity rows retained\n");
}

try {
  const [identityRows] = await connection.query<RowDataPacket[]>("SELECT @@server_uuid AS serverUuid,DATABASE() AS schemaName");
  assertEntityStoreDatabaseIdentity({
    serverUuid: String(identityRows[0]?.serverUuid ?? ""),
    schemaName: String(identityRows[0]?.schemaName ?? ""),
  }, { serverUuid: expectedServerUuid!, schemaName: expectedSchema! });
  if (command === "prepare") await prepare();
  else if (command === "verify") await verify();
  else if (command === "activate") await activate();
  else await rollback();
} catch (error) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  if (activeCollection) await connection.execute(
    "UPDATE community_entity_migration_journal SET state='FAILED',last_error=?,updated_at=UTC_TIMESTAMP(3) WHERE collection=? AND state<>'COMPLETE'",
    [message, activeCollection],
  ).catch(() => undefined);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
