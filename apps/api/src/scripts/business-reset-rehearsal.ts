import { canonicalEntityJson } from "../modules/core/entity-store-records.js";
import { RESET_TABLES, type DatabaseRows } from "./business-reset-plan.js";

/** Exact empty aggregate produced by baseline migrations 0001 through 0005.
 * 0003 writes empty account collections; 0004 initializes the number sequence.
 * This guard is for destructive synthetic test setup only, never production reset.
 */
export const EMPTY_MIGRATED_AGGREGATE = {
  staff: [], credentials: [], sessions: [], users: [],
  idempotency: [["__codex_system__:consumer-public-number-sequence-v1", {
    fingerprint: "consumer-public-number-sequence-v1", orderId: "1",
  }]],
};
export function assertPristineRehearsalDatabase(rows: DatabaseRows): void {
  const fail = () => { throw new Error("Rehearsal requires a new empty dedicated schema with the exact standard migration seed"); };
  if (Object.keys(rows).sort().join() !== [...RESET_TABLES].sort().join()) fail();
  for (const table of RESET_TABLES.filter(name => !["community_product_state", "community_entity_store_state", "schema_migrations"].includes(name))) {
    if (rows[table].length) fail();
  }
  const state = rows.community_entity_store_state;
  if (state.length !== 1 || state[0]!.id !== "1" || state[0]!.mode !== "LEGACY" || state[0]!.entity_write_count !== "0" || state[0]!.first_entity_write_at !== null || state[0]!.source_sha256 !== null || state[0]!.source_schema_version !== null || state[0]!.migrated_at !== null) fail();
  const aggregate = rows.community_product_state;
  if (aggregate.length !== 1 || aggregate[0]!.id !== "1" || aggregate[0]!.schema_version !== "4") fail();
  if (canonicalEntityJson(JSON.parse(aggregate[0]!.payload!)) !== canonicalEntityJson(EMPTY_MIGRATED_AGGREGATE)) fail();
  if (rows.schema_migrations.length !== 5 || rows.schema_migrations.some(row => row.state !== "APPLIED")) fail();
}
