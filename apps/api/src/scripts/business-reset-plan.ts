import { createHash } from "node:crypto";
import { ENTITY_COLLECTIONS, canonicalEntityJson } from "../modules/core/entity-store-records.js";

export type SqlRow = Record<string, string | null>;
export const RESET_TABLES = [
  "community_entity_records", "community_entity_relations", "community_entity_sequences",
  "community_entity_store_state", "community_entity_migration_journal", "community_legacy_snapshots",
  "community_entity_reverse_exports", "community_product_state", "schema_migrations",
] as const;
export type TableName = typeof RESET_TABLES[number];
export type DatabaseRows = Record<TableName, SqlRow[]>;
export const digest = (value: unknown): string => createHash("sha256").update(canonicalEntityJson(value)).digest("hex");
export const documentOf = (row: SqlRow): Record<string, unknown> => JSON.parse(row.document ?? "{}");
export class ResetGuardError extends Error { override name = "ResetGuardError"; }
const requireCondition: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new ResetGuardError(message);
};

/** Pure, fail-closed policy. All values/credentials are retained byte for byte. */
export function planBusinessReset(before: DatabaseRows, keeperId: string): { after: DatabaseRows; counts: Record<string, { before: number; after: number }>; retainedHash: string } {
  requireCondition(keeperId && Object.keys(before).sort().join() === [...RESET_TABLES].sort().join(), "Unexpected database table set");
  const records = before.community_entity_records;
  const known = new Set<string>(ENTITY_COLLECTIONS);
  requireCondition(records.every(row => known.has(row.collection ?? "")), "Unknown entity collection; review policy before reset");
  const one = (collection: string, key: string) => {
    const selected = records.filter(row => row.collection === collection && row.entity_key === key);
    requireCondition(selected.length === 1, `Retained ${collection} identity missing or duplicated`);
    return documentOf(selected[0]!);
  };
  const supers = records.filter(row => row.collection === "staff" && documentOf(row).role === "SUPER_ADMIN");
  requireCondition(supers.length === 1 && supers[0]!.entity_key === keeperId, "Exactly one matching existing SUPER_ADMIN is required");
  const user = one("users", keeperId);
  const staff = one("staff", keeperId);
  const rolesRow = records.find(row => row.collection === "roles" && row.entity_key === keeperId);
  requireCondition(rolesRow, "SUPER_ADMIN roles mapping is missing");
  const roles: unknown = JSON.parse(rolesRow.document!);
  const credentials = records.filter(row => row.collection === "credentials" && documentOf(row).userId === keeperId);
  requireCondition(credentials.length === 1, "Exactly one retained credential is required");
  const credential = documentOf(credentials[0]!);
  requireCondition(user.id === keeperId && user.status === "ACTIVE" && staff.userId === keeperId && staff.status === "ACTIVE", "Retained account is not active and internally consistent");
  requireCondition(Array.isArray(roles) && roles.length === 1 && roles[0] === "SUPER_ADMIN", "Retained role mapping mismatch");
  requireCondition(Array.isArray(credential.roles) && credential.roles.length === 1 && credential.roles[0] === "SUPER_ADMIN" && credential.legacyDisabled !== true && credential.mustChangePassword === false && typeof credential.passwordHash === "string" && Boolean(credential.passwordHash) && typeof credential.passwordSalt === "string" && Boolean(credential.passwordSalt), "Retained credential is not login-ready");
  requireCondition(typeof staff.authorizationVersion === "number" && staff.authorizationVersion === credential.authorizationVersion, "Retained authorization versions differ");
  requireCondition(credential.username === credentials[0]!.entity_key, "Retained credential key mismatch");
  // Do not erase unresolved provider obligations. The operator must reconcile them separately.
  const settled: Record<string, readonly string[]> = {
    orders: ["CANCELLED", "REFUNDED", "COMPLETED", "PICKED_UP"],
    payments: ["SUCCEEDED", "REFUNDED", "FAILED"], paymentBatches: ["SUCCEEDED", "REFUNDED", "FAILED"],
    orderRefunds: ["SUCCEEDED"], partialRefunds: ["SUCCEEDED"],
  };
  for (const row of records) {
    const doc = documentOf(row);
    const states = settled[row.collection!];
    requireCondition(!states || states.includes(String(doc.status)), `Unresolved ${row.collection} obligations; reset refused`);
    if (["payments", "paymentBatches", "orderRefunds", "partialRefunds", "notifications"].includes(row.collection!)) {
      requireCondition(!doc.initiationClaimToken && !doc.submissionClaimToken && !doc.deliveryClaimToken, `Active ${row.collection} claim; reset refused`);
    }
    if (row.collection === "notifications") requireCondition(doc.status !== "SUBMISSION_UNKNOWN" && !doc.deliveryLeaseUntil, "Unresolved notification submission; reset refused");
  }
  const sequence = before.community_entity_sequences.find(row => row.sequence_name === "consumer-public-number");
  const nextNumber = Number(sequence?.next_value);
  const maxNumber = records.filter(row => row.collection === "users").reduce((max, row) => Math.max(max, Number(documentOf(row).consumerNumber) || 0), 0);
  requireCondition(Number.isSafeInteger(nextNumber) && nextNumber > maxNumber && nextNumber < Number.MAX_SAFE_INTEGER, "Consumer sequence high-water mark is missing or inconsistent");
  const state = before.community_entity_store_state;
  requireCondition(state.length === 1 && state[0]!.id === "1" && state[0]!.mode === "ENTITY", "Reset only supports the verified active ENTITY store");
  requireCondition(before.community_product_state.length === 1 && before.community_product_state[0]!.id === "1", "Legacy aggregate singleton mismatch");
  requireCondition(before.schema_migrations.length === 5 && before.schema_migrations.every(row => row.state === "APPLIED"), "Expected five applied migrations");
  const kept = records.filter(row => ["accessRoles", "deletedAccessRoleIds"].includes(row.collection!) ||
    (["users", "staff", "roles"].includes(row.collection!) && row.entity_key === keeperId) || credentials.includes(row));
  // Nothing else survives in the online aggregate; snapshots are removed below.
  const aggregate: Record<string, unknown[]> = Object.fromEntries(ENTITY_COLLECTIONS.map(name => [name, []]));
  for (const row of kept) aggregate[row.collection!]!.push(row.collection === "deletedAccessRoleIds" ? row.entity_key : [row.entity_key, JSON.parse(row.document!)]);
  const payload = canonicalEntityJson(aggregate);
  const after = structuredClone(before);
  after.community_entity_records = kept;
  after.community_entity_relations = [];
  after.community_entity_migration_journal = [];
  after.community_legacy_snapshots = [];
  after.community_entity_reverse_exports = [];
  after.community_product_state = [{ ...before.community_product_state[0]!, payload }];
  after.community_entity_store_state = [{ ...state[0]!, source_sha256: createHash("sha256").update(payload).digest("hex"), entity_write_count: String(BigInt(state[0]!.entity_write_count!) + 1n) }];
  // Sequences and schema migrations intentionally remain exactly unchanged.
  const counts: Record<string, { before: number; after: number }> = {};
  for (const table of RESET_TABLES) counts[table] = { before: before[table].length, after: after[table].length };
  for (const collection of ENTITY_COLLECTIONS) counts[`entity:${collection}`] = { before: records.filter(row => row.collection === collection).length, after: kept.filter(row => row.collection === collection).length };
  return { after, counts, retainedHash: digest(kept) };
}
