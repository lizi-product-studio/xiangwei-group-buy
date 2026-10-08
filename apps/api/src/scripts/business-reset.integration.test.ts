import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { Redis } from "ioredis";
import { ENTITY_COLLECTIONS, canonicalEntityJson, toEntityRecord } from "../modules/core/entity-store-records.js";
import { createAdminCredential, AdminAuthService } from "../modules/auth/admin-auth.js";
import { MysqlStore } from "../modules/core/mysql-store.js";
import { buildApp, hasReadyAdminBootstrap } from "../app.js";
import { loadConfig } from "../config.js";
import { captureDatabase, replaceDatabaseRows, type ResetSnapshot } from "./business-reset.js";
import { assertPristineRehearsalDatabase } from "./business-reset-rehearsal.js";
import { digest, planBusinessReset, type SqlRow } from "./business-reset-plan.js";

const execute = promisify(execFile);
const enabled = process.env.RESET_REHEARSAL === "true";
if (process.env.REQUIRE_RESET_REHEARSAL === "true" && !enabled) throw new Error("Required reset rehearsal was not enabled");
const keeper = "00000000-0000-4000-8000-000000000001";
const password = "Synthetic reset rehearsal password 2026";
const oldToken = "old-synthetic-session-token-with-valid-length-20260929";

describe.runIf(enabled)("isolated real MySQL and Redis reset rehearsal", () => {
  let url: string; let redisUrl: string; let identity: ResetSnapshot["identity"]; let original: ResetSnapshot; let evidence: string;
  let baseline: ResetSnapshot;
  let dbEnv: NodeJS.ProcessEnv;
  const connect = () => mysql.createConnection({ uri: url, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  const snapshot = async () => { const c = await connect(); try { return await captureDatabase(c, identity, false); } finally { await c.end(); } };
  const cli = (action: string, output: string, extra: NodeJS.ProcessEnv = {}) => execute(process.execPath, ["--import", "tsx", "src/scripts/business-reset.ts", action], { env: { ...dbEnv, RESET_OUTPUT: join(evidence, output), ...extra }, maxBuffer: 1024 * 1024 });
  beforeAll(async () => {
    url = process.env.INTEGRATION_DATABASE_URL ?? ""; redisUrl = process.env.INTEGRATION_REDIS_URL ?? "";
    if (!url || !redisUrl || new URL(url).pathname !== "/ops_reset_test") throw new Error("Rehearsal is restricted to ops_reset_test and requires isolated Redis");
    evidence = await mkdtemp(join(tmpdir(), "ops-reset-rehearsal-"));
    const c = await connect();
    try {
      const [rows] = await c.query<RowDataPacket[]>("SELECT @@server_uuid AS serverUuid,DATABASE() AS schemaName");
      identity = { serverUuid: String(rows[0]!.serverUuid), schemaName: String(rows[0]!.schemaName) };
      if (identity.serverUuid === "8a48799d-aa5c-11f1-8297-4a0d012feec7") throw new Error("Production server is forbidden for rehearsal");
      original = await captureDatabase(c, identity, false);
      assertPristineRehearsalDatabase(original.rows);
      const desired = structuredClone(original.rows);
      const now = "2026-09-29T00:00:00.000Z";
      const credential = await createAdminCredential("reset-super", keeper, password, ["SUPER_ADMIN"], false, 1);
      const docs: Array<[typeof ENTITY_COLLECTIONS[number], string, unknown]> = [
        ["users", keeper, { id: keeper, wechatOpenId: null, status: "ACTIVE", createdAt: now }],
        ["roles", keeper, ["SUPER_ADMIN"]], ["credentials", "reset-super", credential],
        ["staff", keeper, { userId: keeper, staffNo: "KEEP", displayName: "Synthetic Admin", phone: "13800000000", role: "SUPER_ADMIN", status: "ACTIVE", createdBy: null, activatedAt: now, suspendedAt: null, suspensionReason: null, authorizationVersion: 1, createdAt: now, updatedAt: now }],
        ["users", "consumer", { id: "consumer", wechatOpenId: "synthetic-openid", consumerNumber: 72, status: "ACTIVE", createdAt: now }],
        ["sessions", createHash("sha256").update(oldToken).digest("hex"), { tokenHash: createHash("sha256").update(oldToken).digest("hex"), userId: keeper, roles: ["SUPER_ADMIN"], authorizationVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z" }],
      ];
      for (const collection of ENTITY_COLLECTIONS.filter(name => !["users", "roles", "staff", "credentials", "sessions"].includes(name))) {
        docs.push([collection, `synthetic-${collection}`, collection === "callbacks" ? "synthetic-body-hash" : collection === "deletedAccessRoleIds" ? "synthetic-deleted-role" : { id: `synthetic-${collection}`, status: collection === "orders" ? "REFUNDED" : ["payments", "paymentBatches"].includes(collection) ? "REFUNDED" : ["orderRefunds", "partialRefunds"].includes(collection) ? "SUCCEEDED" : "CLOSED", userId: "consumer", orderId: "synthetic-orders", createdAt: now }]);
      }
      desired.community_entity_records = docs.map(([collection, key, doc]) => {
        const record = toEntityRecord(collection, key, doc);
        const mapped = Object.fromEntries(Object.entries(record).map(([field, value]) => [field === "status" ? "record_status" : field.replace(/[A-Z]/g, char => "_" + char.toLowerCase()), field === "document" ? canonicalEntityJson(value) : value === null ? null : String(value)]));
        return Object.fromEntries(original.schema.community_entity_records.map(col => [col.name, mapped[col.name] ?? null])) as SqlRow;
      });
      desired.community_entity_relations = [{ source_collection: "checkoutBatches", source_key: "synthetic-checkoutBatches", source_key_sha256: createHash("sha256").update("synthetic-checkoutBatches").digest("hex").toUpperCase(), relation_name: "order_id", target_key: "synthetic-orders", target_key_sha256: createHash("sha256").update("synthetic-orders").digest("hex").toUpperCase() }];
      desired.community_entity_sequences = [{ sequence_name: "consumer-public-number", next_value: "73", updated_at: "2026-09-29 00:00:00.000" }];
      desired.community_entity_store_state = [{ ...original.rows.community_entity_store_state[0]!, mode: "ENTITY", entity_write_count: "3" }];
      const legacy = canonicalEntityJson({ orders: [["historical", { id: "historical" }]] });
      const hash = createHash("sha256").update(legacy).digest("hex");
      desired.community_product_state = [{ ...original.rows.community_product_state[0]!, payload: legacy }];
      desired.community_legacy_snapshots = [{ id: "1", schema_version: "4", payload: legacy, payload_sha256: hash, captured_at: "2026-09-29 00:00:00.000" }];
      desired.community_entity_reverse_exports = [{ id: "1", source_entity_write_count: "3", payload: legacy, payload_sha256: hash, exported_at: "2026-09-29 00:00:00.000" }];
      await c.beginTransaction(); await replaceDatabaseRows(c, original, desired); await c.commit();
    } finally { await c.end(); }
    const beforeResetStore = MysqlStore.create(url);
    try {
      const auth = new AdminAuthService(beforeResetStore, 3600);
      expect(await auth.authenticate(`Bearer ${oldToken}`)).toMatchObject({ userId: keeper, roles: ["SUPER_ADMIN"], authorizationVersion: 1 });
    } finally { await beforeResetStore.close(); }
    baseline = await snapshot();
    dbEnv = { ...process.env, DATABASE_URL: url, RESET_EXPECTED_HOST: new URL(url).hostname, RESET_EXPECTED_SERVER_UUID: identity.serverUuid, RESET_EXPECTED_SCHEMA: identity.schemaName, RESET_KEEP_ADMIN_ID: keeper, RESET_WRITERS_STOPPED: "CONFIRMED", RESET_CONFIRM: "OPS-20260929-REMOVE-RECON-RESET" };
  }, 30_000);
  afterAll(() => { if (evidence) console.log(`RESET_REHEARSAL_EVIDENCE=${evidence}`); });

  it("checks identity, atomic rollback, real CLI reset/restore, replay rejection, login and no refill", async () => {
    await expect(cli("apply", "wrong-identity.json", { RESET_EXPECTED_SERVER_UUID: "incorrect", RESET_EXPECTED_BEFORE_SHA256: digest(baseline) })).rejects.toThrow();
    expect(digest(await snapshot())).toBe(digest(baseline));
    // Mid-write failure simulation exercises actual InnoDB rollback of all nine tables.
    const c = await connect();
    try { await c.beginTransaction(); await replaceDatabaseRows(c, baseline, planBusinessReset(baseline.rows, keeper).after); await c.rollback(); } finally { await c.end(); }
    expect(digest(await snapshot())).toBe(digest(baseline));
    await cli("inspect", "inspect.json");
    const expected = JSON.parse(await readFile(join(evidence, "inspect.json"), "utf8"));
    expect(expected.beforeHash).toBe(digest(baseline));
    await cli("apply", "apply.json", { RESET_EXPECTED_BEFORE_SHA256: expected.beforeHash });
    const receipt = JSON.parse(await readFile(join(evidence, "apply.json"), "utf8"));
    const clean = await snapshot();
    expect(receipt.status).toBe("committed"); expect(digest(clean)).toBe(receipt.afterHash);
    expect(clean.rows).toEqual(planBusinessReset(baseline.rows, keeper).after);
    await expect(cli("apply", "replay.json", { RESET_EXPECTED_BEFORE_SHA256: expected.beforeHash })).rejects.toThrow();
    expect(digest(await snapshot())).toBe(receipt.afterHash);
    await cli("restore", "restore.json", { RESET_EXPECTED_BEFORE_SHA256: receipt.afterHash, RESET_BACKUP: join(evidence, "apply.json.preimage.json"), RESET_BACKUP_SHA256: receipt.backupHash });
    expect(await snapshot()).toEqual(baseline);
    await cli("apply", "reapply.json", { RESET_EXPECTED_BEFORE_SHA256: digest(baseline) });
    const store = MysqlStore.create(url);
    const app = await buildApp({ config: loadConfig({ NODE_ENV: "test", DATA_STORE: "mysql", DATABASE_URL: url, SINGLE_WRITER_CONFIRMED: "true", AUTH_PROVIDER: "demo", PAYMENT_PROVIDER: "mock", QUEUE_DRIVER: "memory" }), store });
    try {
      expect(await hasReadyAdminBootstrap(store)).toBe(true);
      const auth = new AdminAuthService(store, 3600);
      expect(await auth.authenticate(`Bearer ${oldToken}`)).toBeNull();
      expect((await auth.login("reset-super", password)).nextAction).toBe("LOGIN");
      for (const table of ["catalog", "categories", "areas", "points", "campaigns", "orders", "payments", "ledger", "reconciliationBills", "reconciliationReviews"]) {
        const current = await snapshot(); expect(current.rows.community_entity_records.filter(row => row.collection === table)).toHaveLength(0);
      }
      await store.saveUser({ id: "new-consumer", wechatOpenId: "new-synthetic-openid", status: "ACTIVE", createdAt: new Date().toISOString() });
      expect(await store.allocateConsumerPublicNumber("new-consumer")).toBe(73);
    } finally { await app.close(); }
  }, 60_000);

  it("backs up and removes only the dedicated Redis keys after database commit; unknown namespace and replay fail closed", async () => {
    const redis = new Redis(redisUrl, { lazyConnect: true }); await redis.connect();
    try {
      expect(await redis.dbsize()).toBe(0);
      const info = await redis.info("server"); const runId = info.match(/(?:^|\r\n)run_id:([^\r\n]+)/)?.[1];
      const redisEnv = { ...dbEnv, REDIS_URL: redisUrl, RESET_REDIS_EXPECTED_HOST: new URL(redisUrl).hostname, RESET_REDIS_EXPECTED_DB: new URL(redisUrl).pathname.slice(1) || "0", RESET_REDIS_EXPECTED_RUN_ID: runId! };
      const call = (action: string, name: string, extra: NodeJS.ProcessEnv = {}) => execute(process.execPath, ["--import", "tsx", "src/scripts/business-reset-redis.ts", action], { env: { ...redisEnv, RESET_OUTPUT: join(evidence, name), ...extra } });
      await redis.set("unrelated-project", "keep");
      await expect(call("inspect", "redis-unknown.json")).rejects.toThrow(); expect(await redis.get("unrelated-project")).toBe("keep");
      await redis.del("unrelated-project");
      await redis.hset("bull:campaign-lifecycle:synthetic", { id: "old-campaign" });
      await redis.set("admin-login:account:synthetic", "3", "EX", 3600);
      await call("inspect", "redis-inspect.json");
      const report = JSON.parse(await readFile(join(evidence, "redis-inspect.json"), "utf8"));
      const dbReceipt = JSON.parse(await readFile(join(evidence, "reapply.json"), "utf8"));
      const applyEnv = { RESET_REDIS_EXPECTED_BEFORE_SHA256: report.beforeHash, RESET_DB_COMMIT_RECEIPT: join(evidence, "reapply.json"), RESET_DB_COMMIT_RECEIPT_SHA256: digest(dbReceipt) };
      await call("apply", "redis-apply.json", applyEnv); expect(await redis.dbsize()).toBe(0);
      await expect(call("apply", "redis-replay.json", applyEnv)).rejects.toThrow(); expect(await redis.dbsize()).toBe(0);
    } finally { redis.disconnect(); }
  }, 30_000);
});
