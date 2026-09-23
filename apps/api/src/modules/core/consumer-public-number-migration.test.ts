import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(process.cwd(), "../../infra/mysql/migrations/0004_consumer_public_numbers.sql"),
  "utf8",
);
const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const integrationRequired = process.env.REQUIRE_INTEGRATION_TESTS === "true";

describe("consumer public number migration invariants", () => {
  it("locks and updates only the aggregate payload while retaining stable sequence state", () => {
    expect(migrationSql).toContain("FOR UPDATE");
    expect(migrationSql).toContain("ROW_NUMBER() OVER (ORDER BY created_at, user_id COLLATE utf8mb4_0900_as_cs)");
    expect(migrationSql).toContain("__codex_system__:consumer-public-number-sequence-v1");
    expect(migrationSql).toContain("'$.consumerNumber'");
    expect(migrationSql).toContain("JSON_ARRAYAGG(JSON_ARRAY(entries.entry_key, entries.entry_json))");
    expect(migrationSql).toContain("JSON_EXTRACT(");
    expect(migrationSql).toContain("FOR ORDINALITY");
    expect(migrationSql).not.toMatch(/(?:user_json|entry_json|entry_key)\s+(?:VARCHAR|CHAR)[^,]*PATH\s+'\$\[[01]\]'/i);
    expect(migrationSql).toContain("schema_version = 4");
    expect(migrationSql).not.toMatch(/DELETE\s+FROM\s+community_product_state|DROP\s+TABLE\s+community_product_state/i);
    expect(migrationSql).toContain("DROP TEMPORARY TABLE consumer_public_number_assignments");
    expect(migrationSql).toContain("COLLATE utf8mb4_0900_as_cs");
    expect(migrationSql).toContain("staff.staff_user_id COLLATE utf8mb4_0900_as_cs = users.user_id COLLATE utf8mb4_0900_as_cs");
    expect(migrationSql).toContain("assignments.user_id COLLATE utf8mb4_0900_as_cs = users.user_id COLLATE utf8mb4_0900_as_cs");
    expect(migrationSql).toContain("entries.entry_key COLLATE utf8mb4_0900_as_cs = @consumer_public_number_sequence_key COLLATE utf8mb4_0900_as_cs");
    expect(migrationSql).toContain("entries.entry_key COLLATE utf8mb4_0900_as_cs <> @consumer_public_number_sequence_key COLLATE utf8mb4_0900_as_cs");
  });
});

it.runIf(integrationRequired)("requires an isolated migration test database in integration CI", () => {
  expect(databaseUrl).toBeTruthy();
});

describe.skipIf(!databaseUrl)("consumer public number migration on real MySQL 8.4", () => {
  let connection: Connection;
  let databaseName: string;

  beforeAll(async () => {
    connection = await mysql.createConnection({ uri: databaseUrl!, multipleStatements: true });
    const [versionRows] = await connection.query<RowDataPacket[]>("SELECT VERSION() AS version");
    expect(String(versionRows[0]?.version)).toMatch(/^8\.4\./);

    databaseName = `codex_ui001_${randomUUID().replaceAll("-", "")}`;
    await connection.query("CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci", [databaseName]);
    await connection.query("USE ??", [databaseName]);
    await connection.query(`
      CREATE TABLE community_product_state (
        id TINYINT UNSIGNED NOT NULL,
        schema_version INT UNSIGNED NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT chk_community_product_state_singleton CHECK (id = 1)
      ) ENGINE=InnoDB
    `);
  });

  afterAll(async () => {
    if (connection) {
      if (databaseName) await connection.query("DROP DATABASE ??", [databaseName]);
      await connection.end();
    }
  });

  const runMigration = async () => {
    // Temporary tables survive transaction rollback; clear this isolated
    // connection before and after every attempt so a failed migration can be
    // rerun without masking its original error with "table already exists".
    await connection.query("DROP TEMPORARY TABLE IF EXISTS consumer_public_number_assignments");
    await connection.beginTransaction();
    try {
      await connection.query(migrationSql);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.query("DROP TEMPORARY TABLE IF EXISTS consumer_public_number_assignments");
    }
  };

  it("preserves every user and idempotency object, allocates beyond the high-water mark, and replays unchanged", async () => {
    const longHistoricalKey = `legacy-order-${"x".repeat(320)}`;
    const original = {
      users: [
        ["consumer-later", {
          id: "consumer-later",
          wechatOpenId: "openid-later",
          displayName: "later name",
          phoneNumber: "13900001234",
          createdAt: "2026-09-02T00:00:00.000Z",
          profile: { source: "legacy", labels: ["vip", "blue"] },
        }],
        ["consumer-existing", {
          id: "consumer-existing",
          wechatOpenId: "openid-existing",
          displayName: "existing name",
          createdAt: "2026-08-01T00:00:00.000Z",
          consumerNumber: 41,
          opaqueLegacyField: { keep: true, values: [1, 2, 3] },
        }],
        ["employee", {
          id: "employee",
          wechatOpenId: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          status: "ACTIVE",
          opaqueEmployeeField: ["do", "not", "change"],
        }],
        ["consumer-earlier", {
          id: "consumer-earlier",
          wechatOpenId: "openid-earlier",
          displayName: "earlier name",
          createdAt: "2026-09-01T00:00:00.000Z",
          preferences: { locale: "zh-CN", nested: { enabled: true } },
        }],
        ["consumer-Case", {
          id: "consumer-Case",
          wechatOpenId: "openid-case-sensitive",
          displayName: "case-sensitive id",
          createdAt: "2026-08-15T00:00:00.000Z",
        }],
      ],
      staff: [
        ["employee", { userId: "employee", staffNo: "S-1", role: "OPERATOR" }],
        ["CONSUMER-case", { userId: "CONSUMER-case", staffNo: "S-2", role: "OPERATOR" }],
      ],
      idempotency: [
        ["legacy-order-create", { fingerprint: "keep-this", orderId: "order-17", response: { ok: true } }],
        ["legacy-refund", { fingerprint: "refund-fingerprint", orderId: "refund-6", attempts: [1, 2] }],
        [longHistoricalKey, { fingerprint: "long-key-record", orderId: "order-long-key", nested: { preserve: true } }],
        ["__CODEX_SYSTEM__:consumer-public-number-sequence-v1", { fingerprint: "case-distinct-historical-key", orderId: "90", preserve: true }],
      ],
      orders: [["order-17", { status: "PAID", amountCents: 1250 }]],
      applicationMetadata: { source: "pre-public-number-release", nested: { preserve: ["all", "fields"] } },
    };
    await connection.execute(
      "INSERT INTO community_product_state(id,schema_version,payload,updated_at) VALUES(1,3,?,UTC_TIMESTAMP(3))",
      [JSON.stringify(original)],
    );

    await runMigration();

    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT schema_version AS schemaVersion, CAST(payload AS CHAR) AS payload FROM community_product_state WHERE id=1",
    );
    expect(rows[0]?.schemaVersion).toBe(4);
    const payload = JSON.parse(String(rows[0]?.payload)) as typeof original & {
      users: Array<[string, Record<string, unknown> & { consumerNumber?: number }]>;
      idempotency: Array<[string, Record<string, unknown>]>;
    };
    const usersById = new Map(payload.users);
    expect(usersById.get("consumer-earlier")).toEqual({
      ...original.users[3]![1],
      consumerNumber: 43,
    });
    expect(usersById.get("consumer-later")).toEqual({
      ...original.users[0]![1],
      consumerNumber: 44,
    });
    expect(usersById.get("consumer-Case")).toEqual({
      ...original.users[4]![1],
      consumerNumber: 42,
    });
    expect(usersById.get("consumer-existing")).toEqual(original.users[1]![1]);
    expect(usersById.get("employee")).toEqual(original.users[2]![1]);
    expect(new Set(payload.users.map(([, value]) => value.consumerNumber).filter(Boolean)).size).toBe(4);
    expect(payload.idempotency).toContainEqual(original.idempotency[0]);
    expect(payload.idempotency).toContainEqual(original.idempotency[1]);
    expect(payload.idempotency).toContainEqual(original.idempotency[2]);
    expect(payload.idempotency).toContainEqual(original.idempotency[3]);
    expect(payload.idempotency).toContainEqual([
      "__codex_system__:consumer-public-number-sequence-v1",
      { fingerprint: "consumer-public-number-sequence-v1", orderId: "45" },
    ]);
    expect(payload.orders).toEqual(original.orders);
    expect(payload.applicationMetadata).toEqual(original.applicationMetadata);

    const payloadAfterFirstRun = String(rows[0]?.payload);
    await runMigration();
    const [replayedRows] = await connection.query<RowDataPacket[]>(
      "SELECT schema_version AS schemaVersion, CAST(payload AS CHAR) AS payload FROM community_product_state WHERE id=1",
    );
    expect(replayedRows[0]?.schemaVersion).toBe(4);
    expect(replayedRows[0]?.payload).toBe(payloadAfterFirstRun);
  });

  it("preserves unrelated fields when user, staff, or idempotency arrays are empty or absent", async () => {
    const cases = [
      { applicationMetadata: { preserve: true }, unrelated: ["legacy", { keep: "all" }] },
      { users: [], staff: [], idempotency: [], applicationMetadata: { preserve: "empty arrays" } },
    ];
    for (const original of cases) {
      await connection.execute(
        "UPDATE community_product_state SET schema_version=3,payload=?,updated_at=UTC_TIMESTAMP(3) WHERE id=1",
        [JSON.stringify(original)],
      );
      await runMigration();
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT schema_version AS schemaVersion, CAST(payload AS CHAR) AS payload FROM community_product_state WHERE id=1",
      );
      const migrated = JSON.parse(String(rows[0]?.payload)) as Record<string, unknown> & {
        users: unknown[];
        idempotency: Array<[string, Record<string, unknown>]>;
      };
      expect(rows[0]?.schemaVersion).toBe(4);
      expect(migrated.users).toEqual([]);
      expect(migrated.applicationMetadata).toEqual(original.applicationMetadata);
      if ("unrelated" in original) expect(migrated.unrelated).toEqual(original.unrelated);
      if ("staff" in original) expect(migrated.staff).toEqual([]);
      expect(migrated.idempotency).toEqual([[
        "__codex_system__:consumer-public-number-sequence-v1",
        { fingerprint: "consumer-public-number-sequence-v1", orderId: "1" },
      ]]);
    }
  });
});
