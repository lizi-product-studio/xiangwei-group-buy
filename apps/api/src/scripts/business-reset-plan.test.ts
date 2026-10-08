import { describe, expect, it } from "vitest";
import { ENTITY_COLLECTIONS } from "../modules/core/entity-store-records.js";
import { MemoryStore } from "../modules/core/store.js";
import { MockPaymentProvider } from "../modules/payments/payment-provider.js";
import { PaymentService } from "../modules/payments/payment-service.js";
import { LedgerService } from "../modules/finance/ledger-service.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { RESET_TABLES, digest, planBusinessReset, type DatabaseRows, type SqlRow } from "./business-reset-plan.js";
import { assertPristineRehearsalDatabase, EMPTY_MIGRATED_AGGREGATE } from "./business-reset-rehearsal.js";
import { resetRedisKeyAllowed } from "./business-reset-redis.js";

export function resetFixture(): DatabaseRows {
  const db = Object.fromEntries(RESET_TABLES.map(table => [table, []])) as unknown as DatabaseRows;
  const row = (collection: string, key: string, document: unknown): SqlRow => ({ collection, entity_key: key, document: JSON.stringify(document) });
  db.community_entity_records = [
    row("users", "keeper", { id: "keeper", status: "ACTIVE" }),
    row("staff", "keeper", { userId: "keeper", role: "SUPER_ADMIN", status: "ACTIVE", authorizationVersion: 3 }),
    row("roles", "keeper", ["SUPER_ADMIN"]),
    row("credentials", "admin", { userId: "keeper", username: "admin", roles: ["SUPER_ADMIN"], authorizationVersion: 3, passwordHash: "unchanged", passwordSalt: "unchanged-salt", mustChangePassword: false }),
    row("accessRoles", "custom", { id: "custom", permissions: ["orders.view"] }),
    row("deletedAccessRoleIds", "disabled", "disabled"),
    ...ENTITY_COLLECTIONS.filter(collection => !["users", "staff", "roles", "credentials", "accessRoles", "deletedAccessRoleIds"].includes(collection)).map(collection => row(collection, "business", { id: "business", status: collection === "orders" ? "REFUNDED" : ["payments", "paymentBatches"].includes(collection) ? "REFUNDED" : ["orderRefunds", "partialRefunds"].includes(collection) ? "SUCCEEDED" : "CLOSED" })),
  ];
  db.community_entity_store_state = [{ id: "1", mode: "ENTITY", entity_write_count: "3", source_sha256: "old" }];
  db.community_product_state = [{ id: "1", schema_version: "4", payload: '{"orders":[["old",{}]]}', updated_at: "2026-09-29 00:00:00.000" }];
  db.community_entity_sequences = [{ sequence_name: "consumer-public-number", next_value: "900", updated_at: "2026-09-29 00:00:00.000" }];
  db.schema_migrations = Array.from({ length: 5 }, (_, i) => ({ name: `000${i + 1}`, state: "APPLIED" }));
  for (const table of ["community_entity_relations", "community_entity_migration_journal", "community_legacy_snapshots", "community_entity_reverse_exports"] as const) db[table] = [{ old: "business" }];
  return db;
}

describe("bounded business reset policy", () => {
  it("retains exact super-admin/config rows and sequences, clears every other collection and online historical copy", () => {
    const before = resetFixture(); const frozen = digest(before);
    const plan = planBusinessReset(before, "keeper");
    expect(digest(before)).toBe(frozen);
    expect(plan.after.community_entity_records).toEqual(before.community_entity_records.slice(0, 6));
    expect(plan.after.community_entity_sequences).toEqual(before.community_entity_sequences);
    expect(plan.after.schema_migrations).toEqual(before.schema_migrations);
    for (const table of ["community_entity_relations", "community_entity_migration_journal", "community_legacy_snapshots", "community_entity_reverse_exports"] as const) expect(plan.after[table]).toEqual([]);
    const payload = JSON.parse(plan.after.community_product_state[0]!.payload!);
    for (const collection of ENTITY_COLLECTIONS.filter(name => !["users", "staff", "roles", "credentials", "accessRoles", "deletedAccessRoleIds"].includes(name))) expect(payload[collection]).toEqual([]);
  });
  it.each(["unknown", "second-admin", "credential-mismatch", "missing-roles", "unsettled-refund", "unsettled-order", "legacy-mode", "unknown-table"])("fails closed on %s", problem => {
    const db = resetFixture();
    if (problem === "unknown") db.community_entity_records.push({ collection: "future", entity_key: "x", document: "{}" });
    if (problem === "second-admin") db.community_entity_records.push({ collection: "staff", entity_key: "another", document: '{"role":"SUPER_ADMIN"}' });
    if (problem === "credential-mismatch") db.community_entity_records[3]!.document = db.community_entity_records[3]!.document!.replace('"authorizationVersion":3', '"authorizationVersion":4');
    if (problem === "missing-roles") db.community_entity_records.splice(2, 1);
    if (problem === "unsettled-refund") db.community_entity_records.find(row => row.collection === "orderRefunds")!.document = '{"status":"PROCESSING"}';
    if (problem === "unsettled-order") db.community_entity_records.find(row => row.collection === "orders")!.document = '{"status":"PENDING_PAYMENT"}';
    if (problem === "legacy-mode") db.community_entity_store_state[0]!.mode = "LEGACY";
    if (problem === "unknown-table") Object.assign(db, { future_table: [] });
    expect(() => planBusinessReset(db, "keeper")).toThrow();
  });
  it("only accepts this application's explicit Redis namespaces", () => {
    for (const key of ["bull:campaign-lifecycle:wait", "admin-login:claim:x", "hometown:reconciliation:lease"]) expect(resetRedisKeyAllowed(key)).toBe(true);
    for (const key of ["bull:other:wait", "other-project", "hometown:another"]) expect(resetRedisKeyAllowed(key)).toBe(false);
  });
});
class InspectStore extends MemoryStore { public dump() { return this.exportState(); } }
class NoExternalCalls extends MockPaymentProvider {
  override async refund(): Promise<never> { throw new Error("Unexpected external refund"); }
  override async queryRefund(): Promise<never> { throw new Error("Unexpected external query"); }
}
describe("removed feature and empty-store recovery", () => {
  it("late callbacks do not recreate business or invoke external refunds; unknown refund only deduplicates", async () => {
    const store = new InspectStore(false); const before = JSON.parse(store.dump());
    const payments = new PaymentService(store, new NoExternalCalls(), new LedgerService());
    await expect(payments.handleNotification({ eventId: "old-payment", bodyHash: "hash", type: "TRANSACTION.SUCCESS", orderNo: "old-order", providerPaymentId: "old-provider", amountCents: 123 })).rejects.toMatchObject({ statusCode: 404 });
    expect(JSON.parse(store.dump())).toEqual(before);
    const notification = { eventId: "old-refund", bodyHash: "hash", type: "REFUND.SUCCESS", providerRefundNo: "old-refund-no", providerRefundId: "old-provider", status: "SUCCEEDED" as const };
    await payments.handleRefundNotification(notification); await payments.handleRefundNotification(notification);
    const after = JSON.parse(store.dump()); expect(after.callbacks).toEqual([["old-refund", "hash"]]);
    after.callbacks = []; expect(after).toEqual(before);
    expect(await payments.reconcileRefunds()).toMatchObject({ recovered: 0, failed: 0 });
  });
  it("keeps retired routes absent, existing finance routes present and starts without demo refill", async () => {
    const store = new InspectStore(false);
    const app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
    try {
      const base = "/api/v1/admin/finance/reconciliation/bills";
      for (const [method, url] of [["GET", base], ["POST", base], ["GET", `${base}/old`], ["POST", `${base}/old/reviews`]] as const) expect(app.hasRoute({ method, url })).toBe(false);
      expect(app.hasRoute({ method: "GET", url: "/health/reconciliation" })).toBe(true);
      for (const url of ["/api/v1/admin/finance/ledger", "/api/v1/admin/finance/refunds"]) expect(app.hasRoute({ method: "GET", url })).toBe(true);
      const state = JSON.parse(store.dump());
      for (const key of ["orders", "catalog", "categories", "areas", "points", "campaigns", "ledger", "users", "staff"]) expect(state[key]).toEqual([]);
    } finally { await app.close(); }
  });
  it("normal upgrades preserve historical bill documents without any live bill methods", () => {
    const store = new InspectStore(false);
    const old = { id: "bill-old", entries: [{ amountCents: 123 }] };
    store.importEntityRows("reconciliationBills", [["bill-old", old]]);
    expect(JSON.parse(store.dump()).reconciliationBills).toEqual([["bill-old", old]]);
    expect("createBillIfAbsent" in store).toBe(false);
  });
});


describe("standard migrated empty rehearsal database", () => {
  const empty = (): DatabaseRows => ({
    ...Object.fromEntries(RESET_TABLES.map(table => [table, []])) as unknown as DatabaseRows,
    community_product_state: [{ id: "1", schema_version: "4", payload: JSON.stringify(EMPTY_MIGRATED_AGGREGATE) }],
    community_entity_store_state: [{ id: "1", mode: "LEGACY", entity_write_count: "0", first_entity_write_at: null, source_sha256: null, source_schema_version: null, migrated_at: null }],
    schema_migrations: Array.from({ length: 5 }, () => ({ state: "APPLIED" })),
  });
  it("accepts only empty account arrays and the initial sequence inserted by standard migrations", () => {
    expect(() => assertPristineRehearsalDatabase(empty())).not.toThrow();
  });
  it.each(["account", "business", "unknown", "advanced-sequence", "snapshot", "entity", "relations", "journal", "sequence-table", "written-state"])("refuses existing or unrecognized %s data before fixture writes", kind => {
    const rows = empty();
    const payload = JSON.parse(rows.community_product_state[0]!.payload!);
    if (kind === "account") payload.users = [["existing-user", { id: "existing-user" }]];
    if (kind === "business") payload.orders = [["existing-order", {}]];
    if (kind === "unknown") payload.futureCollection = [];
    if (kind === "advanced-sequence") payload.idempotency[0][1].orderId = "2";
    rows.community_product_state[0]!.payload = JSON.stringify(payload);
    if (kind === "snapshot") rows.community_legacy_snapshots.push({ id: "1" });
    if (kind === "entity") rows.community_entity_records.push({ collection: "users" });
    if (kind === "relations") rows.community_entity_relations.push({ source_key: "old" });
    if (kind === "journal") rows.community_entity_migration_journal.push({ collection: "users" });
    if (kind === "sequence-table") rows.community_entity_sequences.push({ sequence_name: "consumer-public-number", next_value: "2" });
    if (kind === "written-state") rows.community_entity_store_state[0]!.entity_write_count = "1";
    expect(() => assertPristineRehearsalDatabase(rows)).toThrow(/new empty dedicated schema/);
  });
});
