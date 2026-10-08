import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { getCurrentInternalWriteActor } from "../auth/internal-write-context.js";
import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { MemoryStore, STORE_READ_METHODS as READ_METHODS, type CommerceStore, type StoreOrderSearchPage, type StoreOrderSearchQuery, type FinanceRefundPageQuery, type FinanceLedgerPageQuery, type ServiceAreaInterestPageQuery } from "./store.js";
import { decodeEntityDocument, toEntityRecord, type EntityCollection, type EntityRow } from "./entity-store-records.js";
import { entityNeeds, type EntityNeed } from "./entity-store-plan.js";
import { BusinessError, type OrderStatus } from "@hometown/domain";
import type { CommunityPickupReceipt, Order, User } from "./types.js";

type StateRow = RowDataPacket & { payload: string | Record<string, unknown> };
type StoreMethod = (...args: unknown[]) => unknown;
export type AggregatePayloadTier = "ok" | "warning" | "critical";
export interface AggregatePayloadStatus { payloadBytes: number | null; tier: AggregatePayloadTier; }
export interface MysqlStoreOptions {
  payloadWarningBytes?: number;
  payloadCriticalBytes?: number;
  onPayloadAlert?: (event: { payloadBytes: number; tier: Exclude<AggregatePayloadTier, "ok"> }) => void;
  /**
   * Freshness window for the display-only cumulative sales total across all
   * campaigns. Stale values are served while one pooled refresh runs; 0 keeps
   * every read exact. Campaign-scoped sales are never cached.
   */
  globalSalesCacheMs?: number;
}
// Record<OrderStatus, true> makes the compiler reject a missing or unknown status.
const ORDER_STATUS_SET: Record<OrderStatus, true> = {
  PENDING_PAYMENT: true, PAID_WAITING_CLOSE: true, LOCKED: true, ALLOCATING: true, IN_TRANSIT: true,
  READY_FOR_PICKUP: true, PICKED_UP: true, COMPLETED: true, CANCELLING: true, REFUNDING: true, REFUNDED: true, CANCELLED: true,
};
export const ORDER_STATUSES: readonly OrderStatus[] = Object.freeze(Object.keys(ORDER_STATUS_SET) as OrderStatus[]);
/** Status IN list equivalent to NOT IN(excluded) over the exhaustive order status set. */
export function orderStatusesExcept(excluded: readonly string[]): string[] {
  const skip = new Set(excluded);
  return ORDER_STATUSES.filter((status) => !skip.has(status));
}
const netSalesSql = (campaignScoped: boolean): string => `SELECT l.lookup_c AS skuId,
          SUM(CASE WHEN o.record_status='REFUNDED' OR r.entity_key IS NOT NULL THEN 0 ELSE GREATEST(0,COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(l.document,'$.quantity')) AS SIGNED),0)-COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(l.document,'$.refundedQuantity')) AS SIGNED),0)) END) AS quantity
         FROM community_entity_records l
         JOIN community_entity_records o ON o.collection='orders' AND o.entity_key=l.lookup_a
         LEFT JOIN community_entity_records r ON r.collection='orderRefunds' AND r.lookup_a=o.entity_key AND r.record_status='SUCCEEDED'
         WHERE l.collection='lines' AND o.paid_at IS NOT NULL AND o.record_status NOT IN ('PENDING_PAYMENT','CANCELLED')${campaignScoped ? " AND o.lookup_b=?" : ""}
         GROUP BY l.lookup_c`;
async function queryNetSales(connection: Pool | PoolConnection, campaignId?: string): Promise<Map<string, number>> {
  const [rows] = await connection.execute<RowDataPacket[]>(netSalesSql(campaignId !== undefined), campaignId === undefined ? [] : [campaignId]);
  return new Map(rows.map((row) => [String(row.skuId), Number(row.quantity)]));
}
export class AggregatePayloadMonitor {
  private payloadBytes: number | null = null;
  private alertedTier: AggregatePayloadTier = "ok";
  public constructor(
    private readonly warningBytes: number,
    private readonly criticalBytes: number,
    private readonly onAlert?: MysqlStoreOptions["onPayloadAlert"],
  ) {
    if (criticalBytes <= warningBytes) throw new Error("aggregate critical payload threshold must exceed warning threshold");
  }
  public observe(bytes: number): void {
    this.payloadBytes = bytes;
    const tier = this.tier();
    if (tier === "ok") { this.alertedTier = "ok"; return; }
    if (tier === this.alertedTier) return;
    this.alertedTier = tier;
    try { this.onAlert?.({ payloadBytes: bytes, tier }); } catch { /* alerting must not affect committed store work */ }
  }
  public status(): AggregatePayloadStatus {
    return { payloadBytes: this.payloadBytes, tier: this.tier() };
  }
  private tier(): AggregatePayloadTier {
    if (this.payloadBytes === null || this.payloadBytes < this.warningBytes) return "ok";
    return this.payloadBytes >= this.criticalBytes ? "critical" : "warning";
  }
}

class AggregateSnapshot extends MemoryStore {
  public constructor(private readonly connection: PoolConnection, raw: string) {
    super(false);
    this.importState(raw);
  }
  public serialize(): string {
    return this.exportState();
  }
  public override async databaseNow(): Promise<string> {
    const [rows] = await this.connection.query<RowDataPacket[]>(
      "SELECT UTC_TIMESTAMP(3) AS now",
    );
    return new Date(rows[0]!.now as Date | string).toISOString();
  }
}

type Scope = {
  connection: PoolConnection;
  snapshot: MemoryStore;
  readonly: boolean;
  active: boolean;
  mode: "LEGACY" | "PREPARED" | "ENTITY";
  loaded: Map<EntityCollection, Map<string, string>>;
};
const mysqlDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid timestamp in Entity Store query`);
  return date.toISOString().slice(0, 23).replace("T", " ");
};
const relationHash = (value: string): Buffer => createHash("sha256").update(value).digest();

/** One aggregate row lock per write; independent immutable read scopes. */
export class MysqlStore extends MemoryStore implements CommerceStore {
  private readonly context = new AsyncLocalStorage<Scope>();
  private readonly facade: MysqlStore;
  private readonly payloadMonitor: AggregatePayloadMonitor;
  private readonly globalSalesCacheMs: number;
  private globalSales: { value: Map<string, number>; at: number } | null = null;
  private globalSalesRefresh: Promise<Map<string, number>> | null = null;
  private constructor(private readonly pool: Pool, options: MysqlStoreOptions = {}) {
    super(false);
    this.globalSalesCacheMs = Math.max(0, options.globalSalesCacheMs ?? 60_000);
    this.payloadMonitor = new AggregatePayloadMonitor(
      options.payloadWarningBytes ?? 2 * 1024 * 1024,
      options.payloadCriticalBytes ?? 4 * 1024 * 1024,
      options.onPayloadAlert,
    );
    this.facade = new Proxy(this, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof property !== "string" || typeof value !== "function")
          return value;
        if (["transaction", "readSnapshot", "health", "databaseNow", "close", "getAggregatePayloadStatus", "getPersistenceMode"].includes(property))
          return (value as StoreMethod).bind(target);
        return (...args: unknown[]) => target.invoke(property, args);
      },
    });
    return this.facade;
  }
  public static create(databaseUrl: string, options: MysqlStoreOptions = {}): MysqlStore {
    return new MysqlStore(
      mysql.createPool({
        uri: databaseUrl,
        connectionLimit: 20,
        timezone: "Z",
        decimalNumbers: false,
        jsonStrings: true,
      }),
      options,
    );
  }
  private async load(connection: PoolConnection, readonly: boolean): Promise<AggregateSnapshot> {
    const [rows] = await connection.query<StateRow[]>(
      "SELECT payload FROM community_product_state WHERE id=1" + (readonly ? "" : " FOR UPDATE"),
    );
    if (!rows[0] && !readonly) {
      await connection.query(
        "INSERT INTO community_product_state(id,schema_version,payload,updated_at) VALUES(1,2,JSON_OBJECT(),UTC_TIMESTAMP(3))",
      );
    }
    const payload = rows[0]?.payload ?? "{}";
    const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.payloadMonitor.observe(Buffer.byteLength(serialized, "utf8"));
    return new AggregateSnapshot(connection, serialized);
  }
  private currentScope(): Scope | undefined {
    const scope = this.context.getStore();
    if (scope && !scope.active) throw new Error("Aggregate scope has already completed");
    return scope;
  }
  private async persistenceMode(connection: Pool | PoolConnection): Promise<Scope["mode"]> {
    try {
      const [rows] = await connection.query<RowDataPacket[]>("SELECT mode FROM community_entity_store_state WHERE id=1");
      const mode = rows[0]?.mode;
      return mode === "ENTITY" || mode === "PREPARED" ? mode : "LEGACY";
    } catch (error) {
      if ((error as { code?: string }).code === "ER_NO_SUCH_TABLE") return "LEGACY";
      throw error;
    }
  }
  public override async getPersistenceMode(): Promise<Scope["mode"]> {
    const scope = this.currentScope();
    return scope?.mode ?? this.persistenceMode(this.pool);
  }
  private async entityRows(scope: Scope, need: EntityNeed): Promise<EntityRow[]> {
    const conditions = ["collection=?"];
    const values: unknown[] = [need.collection];
    if (need.key !== undefined) { conditions.push("entity_key=?"); values.push(need.key); }
    if (need.keys !== undefined) {
      if (need.keys.length === 0) conditions.push("1=0");
      else { conditions.push(`entity_key IN (${need.keys.map(() => "?").join(",")})`); values.push(...need.keys); }
    }
    if (need.index && need.value !== undefined) { conditions.push(`lookup_${need.index}=?`); values.push(need.value); }
    if (need.values !== undefined) {
      if (need.values.length === 0) conditions.push("1=0");
      else if (!need.index) throw new Error(`Entity lookup index missing for ${need.collection}`);
      else { conditions.push(`lookup_${need.index} IN (${need.values.map(() => "?").join(",")})`); values.push(...need.values); }
    }
    if (need.indexB && need.valueB !== undefined) { conditions.push(`lookup_${need.indexB}=?`); values.push(need.valueB); }
    if (need.nullIndex) conditions.push(`lookup_${need.nullIndex} IS NULL`);
    if (need.statuses) {
      if (need.statuses.length === 0) conditions.push("1=0");
      else { conditions.push(`record_status IN (${need.statuses.map(() => "?").join(",")})`); values.push(...need.statuses); }
    }
    if (need.dueBefore !== undefined) { conditions.push("due_at<=?"); values.push(mysqlDate(need.dueBefore)); }
    if (need.dueAfter !== undefined) { conditions.push("due_at>=?"); values.push(mysqlDate(need.dueAfter)); }
    const sort = need.orderBy === "created_desc" ? "created_at DESC, entity_key DESC" : need.orderBy === "created_asc" ? "created_at ASC, entity_key ASC" : need.orderBy === "due_asc" ? "due_at ASC, created_at ASC, entity_key ASC" : "entity_key ASC";
    let limitSql = "";
    if (need.limit !== undefined && Number.isFinite(need.limit)) {
      const limit = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(need.limit)));
      limitSql = " LIMIT " + limit;
    }
    const [rows] = await scope.connection.query<EntityRow[]>(
      `SELECT collection,entity_key AS entityKey,document FROM community_entity_records WHERE ${conditions.join(" AND ")} ORDER BY ${sort}${limitSql}`,
      values,
    );
    return rows;
  }
  private async mergeEntityRows(scope: Scope, collection: EntityCollection, rows: EntityRow[]): Promise<void> {
    const decoded = rows.map((row) => ({ row, document: decodeEntityDocument(collection, row.document) }));
    let entries: Array<[string, unknown]>;
    if (collection === "lines") {
      const grouped = new Map<string, unknown[]>();
      for (const value of decoded) {
        const doc = value.document as Record<string, unknown>;
        const parent = String(doc.orderId ?? "");
        const bucket = grouped.get(parent) ?? [];
        bucket.push(doc);
        grouped.set(parent, bucket);
      }
      entries = [...grouped.entries()];
    } else {
      entries = decoded.map(({ row, document }) => [row.entityKey, document]);
    }
    scope.snapshot.importEntityRows(collection, entries);
    const initial = scope.loaded.get(collection) ?? new Map<string, string>();
    for (const { row } of decoded) {
      if (initial.has(row.entityKey)) continue;
      const persisted = typeof row.document === "string" ? JSON.parse(row.document) as unknown : row.document;
      initial.set(row.entityKey, JSON.stringify(persisted));
    }
    scope.loaded.set(collection, initial);
  }
  private async loadEntityNeed(scope: Scope, need: EntityNeed): Promise<EntityRow[]> {
    const multi = need.keys ?? need.values;
    if (!multi || multi.length <= 500) {
      const rows = await this.entityRows(scope, need);
      await this.mergeEntityRows(scope, need.collection, rows);
      return rows;
    }
    const rows: EntityRow[] = [];
    for (let offset = 0; offset < multi.length; offset += 500) {
      const batch = multi.slice(offset, offset + 500);
      const part = need.keys !== undefined
        ? await this.entityRows(scope, { ...need, keys: batch })
        : await this.entityRows(scope, { ...need, values: batch });
      rows.push(...part);
      await this.mergeEntityRows(scope, need.collection, part);
    }
    return rows;
  }
  private async loadEntityNeeds(scope: Scope, method: string, args: unknown[]): Promise<void> {
    if (method === "getCheckoutBatchByOrder") {
      const [relations] = await scope.connection.execute<RowDataPacket[]>(
        "SELECT source_key AS sourceKey FROM community_entity_relations WHERE relation_name='order_id' AND target_key_sha256=? AND target_key=? LIMIT 1",
        [relationHash(String(args[0])), String(args[0])],
      );
      if (relations[0]) await this.loadEntityNeed(scope, { collection: "checkoutBatches", key: String(relations[0].sourceKey) });
      else await this.loadEntityNeed(scope, { collection: "checkoutBatches", key: "__missing_checkout_batch__" });
      return;
    }
    const needs = entityNeeds(method, args);
    const orderRows: EntityRow[] = [];
    for (const need of needs) {
      const rows = await this.loadEntityNeed(scope, need);
      if (need.collection === "orders") orderRows.push(...rows);
    }
    const orderIds = [...new Set(orderRows.map((row) => row.entityKey))];
    if (orderIds.length) await this.loadEntityNeed(scope, { collection: "lines", index: "a", values: orderIds });

    if (["getAuthSession", "getActiveAuthSession"].includes(method)) {
      const row = (await this.entityRows(scope, { collection: "sessions", key: String(args[0]) }))[0];
      const session = row ? decodeEntityDocument("sessions", row.document) as { userId?: string } : null;
      if (session?.userId) {
        await this.loadEntityNeed(scope, { collection: "users", key: session.userId });
        await this.loadEntityNeed(scope, { collection: "staff", key: session.userId });
      }
    }
    if (method === "getAuthSession" || method === "getActiveAuthSession") {
      // The base-store validity check also consults an employee's access row.
      const sessionRows = await this.entityRows(scope, { collection: "sessions", key: String(args[0]) });
      const session = sessionRows[0] ? decodeEntityDocument("sessions", sessionRows[0]!.document) as { userId?: string } : null;
      if (session?.userId) await this.loadEntityNeed(scope, { collection: "staff", key: session.userId });
    }
    if (method === "getCampaignForUpdate" || method === "getCampaign" || method === "saveCampaign" || method === "deleteDraftCampaign") {
      // Campaign items are stored with their parent document, so this remains a single bounded row read.
    }
    if (method === "hasCampaignBusinessReferences" || method === "deleteDraftCampaign") {
      const campaignId = String(method === "deleteDraftCampaign" ? args[0] : args[0]);
      const plans = await this.loadEntityNeed(scope, { collection: "plans", index: "a", value: campaignId });
      await this.loadEntityNeed(scope, { collection: "orders", index: "b", value: campaignId });
      await this.loadEntityNeed(scope, { collection: "batches", index: "a", value: campaignId });
      await this.loadEntityNeed(scope, { collection: "deliveries", index: "a", value: campaignId });
      await this.loadEntityNeed(scope, { collection: "exceptions", index: "c", value: campaignId });
      await this.loadEntityNeed(scope, { collection: "drafts", index: "b", value: campaignId });
      const planIds = plans.map((row) => row.entityKey);
      if (planIds.length) {
        await this.loadEntityNeed(scope, { collection: "pickupReceipts", index: "c", values: planIds });
        await this.loadEntityNeed(scope, { collection: "windows", index: "b", values: planIds });
      }
    }
    if (method === "listOrderDeliveryFacts") {
      const orderDocs = orderRows.map((row) => decodeEntityDocument("orders", row.document) as { deliveryPlanId?: string; campaignId?: string });
      const planIds = orderDocs.map((order) => order.deliveryPlanId).filter((id): id is string => Boolean(id));
      if (planIds.length) await this.loadEntityNeed(scope, { collection: "plans", keys: planIds });
      const orderIds = Array.isArray(args[0]) ? args[0].map(String) : [];
      if (orderIds.length) await this.loadEntityNeed(scope, { collection: "exceptions", index: "a", values: orderIds });
      await this.loadEntityNeed(scope, { collection: "exceptions", nullIndex: "a" });
      const allocRows = await this.entityRows(scope, { collection: "allocations", index: "a", values: orderIds });
      await this.mergeEntityRows(scope, "allocations", allocRows);
      const exceptionIds = [...new Set(allocRows.map((row) => String((decodeEntityDocument("allocations", row.document) as { exceptionId?: string }).exceptionId ?? "")).filter(Boolean))];
      if (exceptionIds.length) await this.loadEntityNeed(scope, { collection: "exceptions", keys: exceptionIds });
    }
    if (method === "markFulfillmentAllocationsRefunded")
      await this.loadEntityNeed(scope, { collection: "lines", index: "a", value: String((args[1] as { orderId?: string }).orderId ?? "") });
    if (method === "allocateConsumerPublicNumber") {
      // A dedicated sequence table will replace this legacy scan before ENTITY activation.
    }
  }
  private memoryEntityRecords(snapshot: MemoryStore, collection: EntityCollection) {
    const entries = snapshot.exportEntityRows(collection);
    const records = [] as ReturnType<typeof toEntityRecord>[];
    for (const [key, value] of entries) {
      if (collection === "lines") {
        for (const line of Array.isArray(value) ? value as Array<Record<string, unknown>> : [])
          records.push(toEntityRecord(collection, key, line));
      } else records.push(toEntityRecord(collection, key, value));
    }
    return records;
  }
  private async persistRecord(scope: Scope, record: ReturnType<typeof toEntityRecord>): Promise<void> {
    const fields = [record.lookupA, record.lookupB, record.lookupC, record.lookupD, record.lookupE, record.lookupF, record.status, record.createdAt, record.queueAt, record.paidAt, record.dueAt, record.retryAt, record.leaseUntil, record.providerStartedAt, record.uniqueKey, record.searchText, JSON.stringify(record.document)];
    try {
      await scope.connection.execute(
        `INSERT INTO community_entity_records(collection,entity_key,lookup_a,lookup_b,lookup_c,lookup_d,lookup_e,lookup_f,record_status,created_at,queue_at,paid_at,due_at,retry_at,lease_until,provider_started_at,unique_key,search_text,document) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [record.collection, record.entityKey, ...fields],
      );
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ER_DUP_ENTRY") throw error;
      const [primaryRows] = await scope.connection.execute<RowDataPacket[]>(
        "SELECT entity_key FROM community_entity_records WHERE collection=? AND entity_key=? FOR UPDATE",
        [record.collection, record.entityKey],
      );
      if (!primaryRows.length) throw new BusinessError("INTEGRITY_VIOLATION", `Entity unique key conflict in ${record.collection}; existing record was preserved`, 409);
      if (record.uniqueKey !== null) {
        const [uniqueRows] = await scope.connection.execute<RowDataPacket[]>(
          "SELECT entity_key FROM community_entity_records WHERE collection=? AND unique_key=? FOR UPDATE",
          [record.collection, record.uniqueKey],
        );
        if (uniqueRows.some((row) => String(row.entity_key) !== record.entityKey))
          throw new BusinessError("INTEGRITY_VIOLATION", `Entity unique key conflict in ${record.collection}; existing record was preserved`, 409);
      }
      await scope.connection.execute(
        `UPDATE community_entity_records SET lookup_a=?,lookup_b=?,lookup_c=?,lookup_d=?,lookup_e=?,lookup_f=?,record_status=?,created_at=?,queue_at=?,paid_at=?,due_at=?,retry_at=?,lease_until=?,provider_started_at=?,unique_key=?,search_text=?,document=? WHERE collection=? AND entity_key=?`,
        [...fields, record.collection, record.entityKey],
      );
    }
    if (record.collection === "checkoutBatches") {
      const doc = record.document as { orderIds?: string[] };
      await this.deleteEntityRelations(scope, "checkoutBatches", record.entityKey);
      for (const target of doc.orderIds ?? []) await this.insertEntityRelation(scope, "checkoutBatches", record.entityKey, "order_id", target);
    }
    if (record.collection === "campaigns") {
      const doc = record.document as { items?: Array<{ catalogSkuId: string }> };
      await this.deleteEntityRelations(scope, "campaigns", record.entityKey);
      for (const item of doc.items ?? []) await this.insertEntityRelation(scope, "campaigns", record.entityKey, "catalog_sku", item.catalogSkuId);
    }
  }
  private async deleteEntityRelations(scope: Scope, collection: string, sourceKey: string): Promise<void> {
    await scope.connection.execute(
      "DELETE FROM community_entity_relations WHERE source_collection=? AND source_key_sha256=? AND source_key=?",
      [collection, relationHash(sourceKey), sourceKey],
    );
  }
  private async insertEntityRelation(scope: Scope, collection: string, sourceKey: string, relationName: string, targetKey: string): Promise<void> {
    await scope.connection.execute(
      "INSERT IGNORE INTO community_entity_relations(source_collection,source_key,source_key_sha256,relation_name,target_key,target_key_sha256) VALUES(?,?,?,?,?,?)",
      [collection, sourceKey, relationHash(sourceKey), relationName, targetKey, relationHash(targetKey)],
    );
    const [rows] = await scope.connection.execute<RowDataPacket[]>(
      "SELECT source_key,target_key FROM community_entity_relations WHERE source_collection=? AND source_key_sha256=? AND relation_name=? AND target_key_sha256=?",
      [collection, relationHash(sourceKey), relationName, relationHash(targetKey)],
    );
    if (String(rows[0]?.source_key) !== sourceKey || String(rows[0]?.target_key) !== targetKey)
      throw new Error("Entity relation hash collision or missing full-key value; refusing to merge distinct relations");
  }
  private async flushEntityChanges(scope: Scope): Promise<void> {
    let wrote = false;
    for (const [collection, original] of scope.loaded) {
      const current = new Map(this.memoryEntityRecords(scope.snapshot, collection).map((record) => [record.entityKey, record]));
      for (const [entityKey, oldJson] of original) {
        const now = current.get(entityKey);
        if (!now) {
          await scope.connection.execute("DELETE FROM community_entity_records WHERE collection=? AND entity_key=?", [collection, entityKey]);
          if (collection === "checkoutBatches" || collection === "campaigns") await this.deleteEntityRelations(scope, collection, entityKey);
          wrote = true;
        } else if (JSON.stringify(now.document) !== oldJson) {
          await this.persistRecord(scope, now);
          original.set(entityKey, JSON.stringify(now.document));
          wrote = true;
        }
      }
      for (const record of current.values()) {
        if (original.has(record.entityKey)) continue;
        await this.persistRecord(scope, record);
        original.set(record.entityKey, JSON.stringify(record.document));
        wrote = true;
      }
    }
    if (wrote) await scope.connection.execute(
      "UPDATE community_entity_store_state SET first_entity_write_at=COALESCE(first_entity_write_at,UTC_TIMESTAMP(3)),entity_write_count=entity_write_count+1 WHERE id=1",
    );
  }
  private async ordersFromRows(scope: Scope, rows: EntityRow[]): Promise<Order[]> {
    if (!rows.length) return [];
    await this.mergeEntityRows(scope, "orders", rows);
    const ids = rows.map((row) => row.entityKey);
    const lines = await this.entityRows(scope, { collection: "lines", index: "a", values: ids });
    await this.mergeEntityRows(scope, "lines", lines);
    const result: Order[] = [];
    for (const row of rows) {
      const value = await scope.snapshot.getOrder(row.entityKey);
      if (value) result.push(value);
    }
    return result;
  }
  private async invokeEntitySpecial(scope: Scope, method: string, args: unknown[]): Promise<{ handled: boolean; value?: unknown }> {
    if (method === "listServiceAreaInterestPage") {
      const q = args[0] as ServiceAreaInterestPageQuery;
      const page = Math.max(1, Math.min(100_000, Math.trunc(Number(q.page) || 1)));
      const pageSize = Math.max(1, Math.min(100, Math.trunc(Number(q.pageSize) || 20)));
      const where = ["collection='interests'", "JSON_TYPE(JSON_EXTRACT(document,'$.privacyVersion'))='STRING'", "JSON_UNQUOTE(JSON_EXTRACT(document,'$.privacyVersion')) <> ''", "JSON_TYPE(JSON_EXTRACT(document,'$.privacyConsentedAt'))='STRING'", "JSON_UNQUOTE(JSON_EXTRACT(document,'$.privacyConsentedAt')) <> ''"];
      const values: unknown[] = [];
      if (q.status) { where.push("record_status=?"); values.push(q.status); }
      const predicate = where.join(" AND ");
      const [counts] = await scope.connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM community_entity_records WHERE ${predicate}`, values);
      const offset = (page - 1) * pageSize;
      const [rows] = await scope.connection.execute<EntityRow[]>(`SELECT collection,entity_key AS entityKey,document FROM community_entity_records WHERE ${predicate} ORDER BY created_at DESC,entity_key DESC LIMIT ${pageSize} OFFSET ${offset}`, values);
      return { handled: true, value: { items: rows.map(row => decodeEntityDocument("interests", row.document)), total: Number(counts[0]?.total ?? 0), page, pageSize } };
    }
    if (method === "listFinanceRefundPage") {
      const q = args[0] as FinanceRefundPageQuery;
      const limit = Math.max(1, Math.min(100, Math.trunc(Number(q.limit) || 25)));
      const filters = ["collection IN ('orderRefunds','partialRefunds')"];
      const filterValues: unknown[] = [];
      if (q.status) { filters.push("record_status=?"); filterValues.push(q.status); }
      if (q.orderId) { filters.push("lookup_a=?"); filterValues.push(q.orderId); }
      if (q.reference) { filters.push("(lookup_a=? OR lookup_b=? OR EXISTS (SELECT 1 FROM community_entity_records o WHERE o.collection='orders' AND o.entity_key=community_entity_records.lookup_a AND o.lookup_d=?))"); filterValues.push(q.reference, q.reference, q.reference); }
      const filterPredicate = filters.join(" AND ");
      let cursor: [string, string, string] | null = null;
      if (q.cursor) {
        try { cursor = JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8")) as [string, string, string]; }
        catch { throw new BusinessError("VALIDATION_ERROR", "分页游标无效", 400); }
        if (!Array.isArray(cursor) || cursor.length !== 3 || typeof cursor[0] !== "string" || !["orderRefunds", "partialRefunds"].includes(cursor[1]) || typeof cursor[2] !== "string")
          throw new BusinessError("VALIDATION_ERROR", "分页游标无效", 400);
      }
      const [counts] = await scope.connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM community_entity_records WHERE ${filterPredicate}`, filterValues);
      const branches: string[] = [];
      const pageValues: unknown[] = [];
      for (const collection of ["orderRefunds", "partialRefunds"] as const) {
        const branchWhere = ["collection=?", ...filters.slice(1)];
        const branchValues: unknown[] = [collection, ...filterValues];
        if (cursor) {
          if (collection < cursor[1]) { branchWhere.push("created_at < ?"); branchValues.push(cursor[0]); }
          else if (collection > cursor[1]) { branchWhere.push("created_at <= ?"); branchValues.push(cursor[0]); }
          else { branchWhere.push("(created_at < ? OR (created_at = ? AND entity_key < ?))"); branchValues.push(cursor[0], cursor[0], cursor[2]); }
        }
        branches.push(`(SELECT collection,entity_key AS entityKey,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') AS createdAtKey,document FROM community_entity_records WHERE ${branchWhere.join(" AND ")} ORDER BY created_at DESC,entity_key DESC LIMIT ${limit + 1})`);
        pageValues.push(...branchValues);
      }
      const [rows] = await scope.connection.execute<Array<EntityRow & { createdAtKey: string }>>(`SELECT collection,entityKey,createdAtKey,document FROM (${branches.join(" UNION ALL ")}) AS finance_page ORDER BY createdAtKey DESC,collection ASC,entityKey DESC LIMIT ${limit + 1}`, pageValues);
      const visible = rows.slice(0, limit);
      const last = visible.at(-1);
      return { handled: true, value: {
        items: visible.map(row => ({ ...decodeEntityDocument(row.collection as EntityCollection, row.document) as Record<string, unknown>, refundType: row.collection === "orderRefunds" ? "FULL" as const : "PARTIAL" as const })),
        total: Number(counts[0]?.total ?? 0), pageSize: limit,
        nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([last.createdAtKey, last.collection, last.entityKey])).toString("base64url") : null,
      } };
    }
    if (method === "listFinanceLedgerPage") {
      const q = args[0] as FinanceLedgerPageQuery;
      const limit = Math.max(1, Math.min(100, Math.trunc(Number(q.limit) || 25)));
      const filters = ["collection='ledger'"];
      const filterValues: unknown[] = [];
      if (q.referenceId) { filters.push("lookup_a=?"); filterValues.push(q.referenceId); }
      const filterPredicate = filters.join(" AND ");
      const where = [...filters];
      const values: unknown[] = [...filterValues];
      if (q.cursor) {
        let cursor: [string, string];
        try { cursor = JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8")) as [string, string]; }
        catch { throw new BusinessError("VALIDATION_ERROR", "分页游标无效", 400); }
        if (!Array.isArray(cursor) || cursor.length !== 2 || typeof cursor[0] !== "string" || typeof cursor[1] !== "string")
          throw new BusinessError("VALIDATION_ERROR", "分页游标无效", 400);
        where.push("(created_at < ? OR (created_at = ? AND entity_key < ?))");
        values.push(cursor[0], cursor[0], cursor[1]);
      }
      const predicate = where.join(" AND ");
      const [counts] = await scope.connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM community_entity_records WHERE ${filterPredicate}`, filterValues);
      const [rows] = await scope.connection.execute<Array<EntityRow & { createdAtKey: string }>>(`SELECT collection,entity_key AS entityKey,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') AS createdAtKey,document FROM community_entity_records WHERE ${predicate} ORDER BY created_at DESC,entity_key DESC LIMIT ${limit + 1}`, values);
      const visible = rows.slice(0, limit);
      const last = visible.at(-1);
      return { handled: true, value: {
        items: visible.map(row => decodeEntityDocument("ledger", row.document)),
        total: Number(counts[0]?.total ?? 0), pageSize: limit,
        nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([last.createdAtKey, last.entityKey])).toString("base64url") : null,
      } };
    }
    if (method === "searchConsumerUsers") {
      const [rawQuery, rawPage, rawPageSize] = args as [string, number, number];
      const query = String(rawQuery ?? "").trim().toLocaleLowerCase("zh-CN");
      const page = Math.max(1, Math.min(100_000, Math.trunc(Number(rawPage) || 1)));
      const pageSize = Math.max(1, Math.min(100, Math.trunc(Number(rawPageSize) || 20)));
      const where = ["u.collection='users'", "u.lookup_a IS NOT NULL", "NOT EXISTS (SELECT 1 FROM community_entity_records s WHERE s.collection='staff' AND s.entity_key=u.entity_key)"];
      const values: unknown[] = [];
      if (query) {
        where.push("(LOCATE(?,LOWER(COALESCE(u.lookup_b,'')))>0 OR LOCATE(?,LOWER(COALESCE(u.lookup_c,'')))>0 OR LOCATE(?,LOWER(COALESCE(u.lookup_d,'')))>0)");
        values.push(query, query, query);
      }
      const predicate = where.join(" AND ");
      const [countRows] = await scope.connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM community_entity_records u WHERE ${predicate}`, values);
      const offset = (page - 1) * pageSize;
      const [rows] = await scope.connection.execute<EntityRow[]>(`SELECT u.collection,u.entity_key AS entityKey,u.document FROM community_entity_records u WHERE ${predicate} ORDER BY CAST(u.lookup_b AS UNSIGNED),u.entity_key LIMIT ${pageSize} OFFSET ${offset}`, values);
      return { handled: true, value: { items: rows.map((row) => decodeEntityDocument("users", row.document) as User), total: Number(countRows[0]?.total ?? 0), page, pageSize } };
    }
    if (method === "findConsumerUserByPublicNumber") {
      const number = String(args[0]);
      const [rows] = await scope.connection.execute<EntityRow[]>("SELECT u.collection,u.entity_key AS entityKey,u.document FROM community_entity_records u WHERE u.collection='users' AND u.lookup_a IS NOT NULL AND u.lookup_b=? AND NOT EXISTS (SELECT 1 FROM community_entity_records s WHERE s.collection='staff' AND s.entity_key=u.entity_key) ORDER BY u.entity_key LIMIT 2", [number]);
      if (rows.length > 1) throw new BusinessError("INTEGRITY_VIOLATION", "用户ID重复，已停止返回用户列表", 500);
      return { handled: true, value: rows[0] ? decodeEntityDocument("users", rows[0].document) : null };
    }
    if (method === "findOtherConsumerUserByPhone") {
      const [phone, excludeUserId] = args.map(String);
      const [rows] = await scope.connection.execute<EntityRow[]>("SELECT u.collection,u.entity_key AS entityKey,u.document FROM community_entity_records u WHERE u.collection='users' AND u.lookup_a IS NOT NULL AND u.lookup_c=? AND u.entity_key<>? AND NOT EXISTS (SELECT 1 FROM community_entity_records s WHERE s.collection='staff' AND s.entity_key=u.entity_key) ORDER BY u.entity_key LIMIT 1", [phone, excludeUserId]);
      return { handled: true, value: rows[0] ? decodeEntityDocument("users", rows[0].document) : null };
    }
    if (method === "listConsumerUsersMissingPublicNumbers") {
      const limit = Math.max(1, Math.min(500, Math.trunc(Number(args[0]) || 500)));
      const [rows] = await scope.connection.execute<EntityRow[]>(`SELECT u.collection,u.entity_key AS entityKey,u.document FROM community_entity_records u WHERE u.collection='users' AND u.lookup_a IS NOT NULL AND u.lookup_b IS NULL AND NOT EXISTS (SELECT 1 FROM community_entity_records s WHERE s.collection='staff' AND s.entity_key=u.entity_key) ORDER BY u.created_at,u.entity_key LIMIT ${limit}`);
      return { handled: true, value: rows.map((row) => decodeEntityDocument("users", row.document) as User) };
    }
    if (method === "hasDuplicateConsumerPublicNumbers") {
      const [rows] = await scope.connection.execute<RowDataPacket[]>("SELECT u.lookup_b FROM community_entity_records u WHERE u.collection='users' AND u.lookup_a IS NOT NULL AND u.lookup_b IS NOT NULL AND NOT EXISTS (SELECT 1 FROM community_entity_records s WHERE s.collection='staff' AND s.entity_key=u.entity_key) GROUP BY u.lookup_b HAVING COUNT(*)>1 LIMIT 1");
      return { handled: true, value: rows.length > 0 };
    }
    if (method === "listExpiredPendingOrders" || method === "listRefundingOrders") {
      const limit = Math.max(1, Math.min(100_000, Math.trunc(Number(args[method === "listExpiredPendingOrders" ? 1 : 0]) || 1)));
      const [rows] = method === "listExpiredPendingOrders"
        ? await scope.connection.execute<EntityRow[]>(`SELECT collection,entity_key AS entityKey,document FROM community_entity_records WHERE collection='orders' AND record_status='PENDING_PAYMENT' AND due_at<=? ORDER BY created_at DESC,entity_key DESC LIMIT ${limit}`, [mysqlDate(String(args[0]))])
        : await scope.connection.execute<EntityRow[]>(`SELECT collection,entity_key AS entityKey,document FROM community_entity_records WHERE collection='orders' AND record_status='REFUNDING' ORDER BY created_at DESC,entity_key DESC LIMIT ${limit}`);
      return { handled: true, value: await this.ordersFromRows(scope, rows) };
    }
    if (method === "findLatestAudit") {
      const [rows] = await scope.connection.execute<EntityRow[]>(
        "SELECT collection,entity_key AS entityKey,document FROM community_entity_records WHERE collection='audits' AND lookup_a=? AND lookup_b=? ORDER BY created_at DESC,entity_key DESC LIMIT 1",
        [`${String(args[0])}:${String(args[1])}`, String(args[2])],
      );
      return { handled: true, value: rows[0] ? decodeEntityDocument("audits", rows[0].document) : null };
    }
    if (method === "allocateConsumerPublicNumber") {
      const userId = String(args[0]);
      const [users] = await scope.connection.execute<RowDataPacket[]>(
        "SELECT document FROM community_entity_records WHERE collection='users' AND entity_key=? LIMIT 1",
        [userId],
      );
      const userDoc = users[0]?.document;
      const user = (typeof userDoc === "string" ? JSON.parse(userDoc) : userDoc) as { wechatOpenId?: string | null; consumerNumber?: number } | undefined;
      const [staff] = await scope.connection.execute<RowDataPacket[]>(
        "SELECT 1 AS found FROM community_entity_records WHERE collection='staff' AND entity_key=? LIMIT 1",
        [userId],
      );
      if (!user || !user.wechatOpenId || staff.length)
        throw new BusinessError("INVALID_STATE_TRANSITION", "只有消费者账号可以分配用户编号", 409);
      if (user.consumerNumber !== undefined) {
        if (!Number.isSafeInteger(user.consumerNumber) || user.consumerNumber < 1)
          throw new BusinessError("INTEGRITY_VIOLATION", "用户ID无效", 500);
        return { handled: true, value: user.consumerNumber };
      }
      const [sequenceRows] = await scope.connection.execute<RowDataPacket[]>(
        "SELECT next_value AS nextValue FROM community_entity_sequences WHERE sequence_name='consumer-public-number' FOR UPDATE",
      );
      const next = Number(sequenceRows[0]?.nextValue);
      if (!Number.isSafeInteger(next) || next < 1 || next >= Number.MAX_SAFE_INTEGER)
        throw new BusinessError("INTEGRITY_VIOLATION", "消费者编号序列未初始化或已损坏", 500);
      await scope.connection.execute(
        "UPDATE community_entity_sequences SET next_value=next_value+1,updated_at=UTC_TIMESTAMP(3) WHERE sequence_name='consumer-public-number'",
      );
      await scope.connection.execute(
        "UPDATE community_entity_store_state SET first_entity_write_at=COALESCE(first_entity_write_at,UTC_TIMESTAMP(3)),entity_write_count=entity_write_count+1 WHERE id=1",
      );
      return { handled: true, value: next };
    }
    if (method === "listOperationsQueue") {
      const [kind, query] = args as ["cancellations" | "quality" | "windows" | "exceptions" | "notifications", { page: number; pageSize: number; status?: string; allowedStatuses?: readonly string[]; sourceStage?: string }];
      if (!["cancellations", "quality", "windows", "exceptions", "notifications"].includes(kind)) throw new Error(`Unsupported operations queue: ${kind}`);
      const where = ["collection=?"];
      const values: unknown[] = [kind];
      const statuses = query.allowedStatuses ?? (query.status ? [query.status] : undefined);
      if (statuses) {
        where.push(statuses.length ? `record_status IN (${statuses.map(() => "?").join(",")})` : "1=0");
        values.push(...statuses);
      }
      if (query.allowedStatuses && query.status) { where.push("record_status=?"); values.push(query.status); }
      if (kind === "notifications") where.push("lookup_f='1'");
      if (kind === "exceptions" && query.sourceStage) { where.push("lookup_f=?"); values.push(query.sourceStage); }
      const predicate = where.join(" AND ");
      const [counts] = await scope.connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM community_entity_records WHERE ${predicate}`, values);
      const page = Math.max(1, Math.trunc(query.page));
      const pageSize = Math.max(1, Math.min(100, Math.trunc(query.pageSize)));
      const offset = (page - 1) * pageSize;
      const urgentWindows = kind === "windows" && ["EXPIRED_PENDING", "REFUND_PENDING"].includes(query.status ?? "");
      const order = urgentWindows ? "due_at ASC,entity_key ASC" : "queue_at DESC,entity_key ASC";
      const [rows] = await scope.connection.execute<EntityRow[]>(`SELECT collection,entity_key AS entityKey,document FROM community_entity_records WHERE ${predicate} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`, values);
      await this.mergeEntityRows(scope, kind, rows);
      const items = rows.map((row) => decodeEntityDocument(kind, row.document));
      return { handled: true, value: { items, total: Number(counts[0]?.total ?? 0), page, pageSize } };
    }
    if (method === "listManualOrderNotifications") {
      const limit = Math.max(0, Math.min(100_000, Math.trunc(Number(args[0]))));
      const [rows] = await scope.connection.execute<EntityRow[]>(
        `SELECT collection,entity_key AS entityKey,document FROM community_entity_records WHERE collection='notifications' AND lookup_f='1' ORDER BY queue_at DESC,entity_key ASC LIMIT ${limit}`,
      );
      await this.mergeEntityRows(scope, "notifications", rows);
      return { handled: true, value: rows.map((row) => decodeEntityDocument("notifications", row.document)) };
    }
    if (method === "claimPendingOrderNotifications") {
      const limit = Math.max(0, Math.min(5, Math.trunc(Number(args[0]))));
      const leaseDurationMs = Math.max(1, Math.trunc(Number(args[1])));
      const claimToken = String(args[2]);
      const [clockRows] = await scope.connection.execute<RowDataPacket[]>("SELECT UTC_TIMESTAMP(3) AS now");
      const now = new Date(clockRows[0]!.now as Date | string).toISOString();
      const lease = new Date(Date.parse(now) + leaseDurationMs).toISOString();
      const [rows] = await scope.connection.execute<EntityRow[]>(
        `SELECT collection,entity_key AS entityKey,document FROM community_entity_records WHERE collection='notifications' AND record_status='PENDING_DELIVERY' AND provider_started_at IS NULL AND (retry_at IS NULL OR retry_at<=?) AND (lease_until IS NULL OR lease_until<=?) ORDER BY COALESCE(retry_at,created_at),created_at,entity_key LIMIT ${limit}`,
        [mysqlDate(now), mysqlDate(now)],
      );
      await this.mergeEntityRows(scope, "notifications", rows);
      const values = rows.map((row) => {
        const value = decodeEntityDocument("notifications", row.document) as Record<string, unknown>;
        return { ...value, deliveryLeaseUntil: lease, deliveryClaimToken: claimToken };
      });
      for (let index = 0; index < values.length; index++)
        await this.persistRecord(scope, toEntityRecord("notifications", rows[index]!.entityKey, values[index]));
      if (values.length) await scope.connection.execute("UPDATE community_entity_store_state SET first_entity_write_at=COALESCE(first_entity_write_at,UTC_TIMESTAMP(3)),entity_write_count=entity_write_count+1 WHERE id=1");
      return { handled: true, value: values };
    }
    if (method === "searchOrders") {
      const query = args[0] as StoreOrderSearchQuery;
      const page = Math.max(1, Math.trunc(query.page ?? 1));
      const pageSize = Math.max(1, Math.min(10_000, Math.trunc(query.pageSize ?? 100)));
      const where = ["o.collection='orders'"];
      const values: unknown[] = [];
      if (query.userId) { where.push("o.lookup_a=?"); values.push(query.userId); }
      if (query.status) { where.push("o.record_status=?"); values.push(query.status); }
      if (query.statuses) {
        const statusClause = query.statuses.length ? `o.record_status IN (${query.statuses.map(() => "?").join(",")})` : "1=0";
        if (query.includeCommunityQualityCases) {
          where.push(`(${statusClause} OR EXISTS (SELECT 1 FROM community_entity_records q WHERE q.collection='quality' AND q.lookup_a=o.entity_key))`);
        } else {
          where.push(statusClause);
        }
        values.push(...query.statuses);
      }
      if (query.excludeStatuses?.length) {
        const remaining = orderStatusesExcept(query.excludeStatuses);
        where.push(remaining.length ? `o.record_status IN (${remaining.map(() => "?").join(",")})` : "1=0");
        values.push(...remaining);
      }
      if (query.campaignId) { where.push("o.lookup_b=?"); values.push(query.campaignId); }
      if (query.pickupPointId) { where.push("o.lookup_c=?"); values.push(query.pickupPointId); }
      if (query.serviceAreaId) { where.push("o.lookup_e=?"); values.push(query.serviceAreaId); }
      if (query.orderNo) { where.push("LOCATE(BINARY ?,BINARY COALESCE(o.lookup_d,''))>0"); values.push(query.orderNo); }
      if (query.from) { where.push(`${query.dateType === "PAID_AT" ? "o.paid_at" : "o.created_at"}>=?`); values.push(mysqlDate(query.from)); }
      if (query.to) { where.push(`${query.dateType === "PAID_AT" ? "o.paid_at" : "o.created_at"}<=?`); values.push(mysqlDate(query.to)); }
      if (query.catalogSkuId) {
        where.push("EXISTS (SELECT 1 FROM community_entity_records l WHERE l.collection='lines' AND l.lookup_a=o.entity_key AND l.lookup_c=?)");
        values.push(query.catalogSkuId);
      }
      const keyword = query.keyword?.trim().toLocaleLowerCase("zh-CN") ?? "";
      if (keyword) {
        // Match MemoryStore's case-normalized substring contract, including
        // one-character and infix matches. LOCATE treats user %/_ literally.
        where.push("(LOCATE(?,LOWER(COALESCE(o.lookup_d,'')))>0 OR EXISTS (SELECT 1 FROM community_entity_records u WHERE u.collection='users' AND u.entity_key=o.lookup_a AND (LOCATE(?,LOWER(COALESCE(u.lookup_b,'')))>0 OR LOCATE(?,LOWER(COALESCE(u.lookup_c,'')))>0 OR LOCATE(?,LOWER(COALESCE(u.lookup_d,'')))>0)))");
        values.push(keyword, keyword, keyword, keyword);
      }
      const predicate = where.join(" AND ");
      // Status-only filters (including none) must count from the narrow
      // status index, never the clustered rows that carry order documents.
      const statusOnly = !query.includeCommunityQualityCases && !query.userId && !query.campaignId && !query.pickupPointId && !query.serviceAreaId && !query.orderNo && !query.from && !query.to && !query.catalogSkuId && !keyword;
      const [counts] = await scope.connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM community_entity_records o${statusOnly ? " FORCE INDEX (ix_community_entity_status_created)" : ""} WHERE ${predicate}`, values);
      const offset = (page - 1) * pageSize;
      const cursorMode = Boolean(query.beforeCreatedAt && query.beforeId);
      const rowWhere = cursorMode ? `${predicate} AND (o.created_at<? OR (o.created_at=? AND o.entity_key<?))` : predicate;
      const rowValues = cursorMode
        ? [...values, mysqlDate(query.beforeCreatedAt!), mysqlDate(query.beforeCreatedAt!), query.beforeId!]
        : values;
      const [rows] = await scope.connection.execute<EntityRow[]>(
        `SELECT o.collection,o.entity_key AS entityKey,o.document FROM community_entity_records o WHERE ${rowWhere} ORDER BY o.created_at DESC,o.entity_key DESC LIMIT ${cursorMode ? pageSize + 1 : pageSize} OFFSET ${cursorMode ? 0 : offset}`,
        rowValues,
      );
      const loaded = await this.ordersFromRows(scope, rows);
      const hasMore = cursorMode ? loaded.length > pageSize : offset + loaded.length < Number(counts[0]?.total ?? 0);
      const items = loaded.slice(0, pageSize);
      const last = items.at(-1);
      return { handled: true, value: { items, total: Number(counts[0]?.total ?? 0), page, pageSize, hasMore, nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null } satisfies StoreOrderSearchPage };
    }
    if (method === "countOrdersByStatus") {
      const statuses = Array.isArray(args[0]) ? args[0] as string[] : undefined;
      const excluded = Array.isArray(args[1]) ? args[1] as string[] : undefined;
      const where = ["collection='orders'"];
      const values: unknown[] = [];
      if (statuses) {
        where.push(statuses.length ? `record_status IN (${statuses.map(() => "?").join(",")})` : "1=0");
        values.push(...statuses);
      }
      if (excluded?.length) {
        // NOT IN would walk every historical order; the complement IN list is
        // an index range over the (usually small) live statuses only.
        const remaining = orderStatusesExcept(excluded);
        where.push(remaining.length ? `record_status IN (${remaining.map(() => "?").join(",")})` : "1=0");
        values.push(...remaining);
      }
      const [rows] = await scope.connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM community_entity_records FORCE INDEX (ix_community_entity_status_created) WHERE ${where.join(" AND ")}`, values);
      return { handled: true, value: Number(rows[0]?.total ?? 0) };
    }
    if (method === "countCampaignsByServiceAreaStatuses") {
      const [areaId, statuses] = args as [string, readonly string[]];
      if (!statuses.length) return { handled: true, value: 0 };
      const [rows] = await scope.connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM community_entity_records WHERE collection='campaigns' AND lookup_a=? AND record_status IN (${statuses.map(() => "?").join(",")})`,
        [areaId, ...statuses],
      );
      return { handled: true, value: Number(rows[0]?.total ?? 0) };
    }
    if (method === "countActiveCampaignReferencesForCatalogSku") {
      const [skuId, statuses] = args as [string, readonly string[]];
      if (!statuses.length) return { handled: true, value: false };
      const [rows] = await scope.connection.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT c.entity_key) AS total FROM community_entity_relations r JOIN community_entity_records c ON c.collection='campaigns' AND c.entity_key=r.source_key WHERE r.relation_name='catalog_sku' AND r.target_key_sha256=? AND r.target_key=? AND c.record_status IN (${statuses.map(() => "?").join(",")})`,
        [relationHash(skuId), skuId, ...statuses],
      );
      return { handled: true, value: Number(rows[0]?.total ?? 0) };
    }
    if (method === "countInProgressDeliveryForPickupPoint") {
      const [pointId, planStatuses, campaignStatuses] = args as [string, readonly string[], readonly string[]];
      if (!planStatuses.length && !campaignStatuses.length) return { handled: true, value: 0 };
      const predicates: string[] = [];
      const values: unknown[] = [pointId];
      if (planStatuses.length) { predicates.push(`p.record_status IN (${planStatuses.map(() => "?").join(",")})`); values.push(...planStatuses); }
      if (campaignStatuses.length) { predicates.push(`c.record_status IN (${campaignStatuses.map(() => "?").join(",")})`); values.push(...campaignStatuses); }
      const [rows] = await scope.connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM community_entity_records p JOIN community_entity_records c ON c.collection='campaigns' AND c.entity_key=p.lookup_a WHERE p.collection='plans' AND p.lookup_b=? AND (${predicates.join(" OR ")})`,
        values,
      );
      return { handled: true, value: Number(rows[0]?.total ?? 0) };
    }
    if (method === "listPickupCodeCandidates") {
      const [pointId, codeHash, orderNo] = args as [string, string, string | undefined];
      const params: unknown[] = [pointId, codeHash, pointId];
      let orderFilter = "";
      if (orderNo !== undefined) { orderFilter = " AND o.lookup_d=?"; params.push(orderNo); }
      const [rows] = await scope.connection.execute<Array<EntityRow & { credentialDocument: string | Record<string, unknown> }>>(
        `SELECT o.collection,o.entity_key AS entityKey,o.document,c.document AS credentialDocument
         FROM community_entity_records o
         JOIN community_entity_records c ON c.collection='pickupCredentials' AND c.lookup_a=o.entity_key
         JOIN community_entity_records p ON p.collection='plans' AND p.entity_key=o.lookup_f
         JOIN community_entity_records w ON w.collection='windows' AND w.entity_key=o.entity_key
         WHERE o.collection='orders' AND o.lookup_c=? AND o.record_status='READY_FOR_PICKUP'
           AND c.lookup_b=? AND c.record_status='ACTIVE' AND c.due_at>UTC_TIMESTAMP(3)
           AND p.lookup_b=? AND p.record_status='ARRIVED'
           AND w.record_status IN ('ACTIVE','EXTENDED') AND w.due_at>UTC_TIMESTAMP(3)${orderFilter}
         ORDER BY o.entity_key LIMIT 2`, params,
      );
      const value = await this.ordersFromRows(scope, rows);
      const hashByOrder = new Map(rows.map((row) => [row.entityKey, String((typeof row.credentialDocument === "string" ? JSON.parse(row.credentialDocument) : row.credentialDocument as Record<string, unknown>).codeHash)]));
      return { handled: true, value: value.map((order) => ({ order, codeHash: hashByOrder.get(order.id)! })) };
    }
    if (method === "getNetSalesQuantities") {
      const campaignId = args[0] as string | undefined;
      if (campaignId === undefined && this.globalSalesCacheMs > 0)
        return { handled: true, value: new Map(await this.cachedGlobalSales()) };
      return { handled: true, value: await queryNetSales(scope.connection, campaignId) };
    }
    if (method === "listPickupReceiptOrderPage") {
      const [pointIds, orderNo, pageValue, sizeValue] = args as [readonly string[], string | undefined, number, number];
      const page = Math.max(1, Math.trunc(pageValue));
      const pageSize = Math.max(1, Math.min(100, Math.trunc(sizeValue)));
      if (!pointIds.length) return { handled: true, value: { items: [], total: 0, page, pageSize } };
      const where = ["o.collection='orders'", "r.collection='pickupReceipts'", `o.lookup_c IN (${pointIds.map(() => "?").join(",")})`, "r.lookup_a=o.entity_key"];
      const values: unknown[] = [...pointIds];
      if (orderNo) { where.push("o.lookup_d LIKE ?"); values.push(`%${orderNo}%`); }
      const predicate = where.join(" AND ");
      const [counts] = await scope.connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM community_entity_records r JOIN community_entity_records o ON o.entity_key=r.lookup_a AND o.collection='orders' WHERE ${predicate}`, values);
      const offset = (page - 1) * pageSize;
      const [rows] = await scope.connection.execute<RowDataPacket[]>(
        `SELECT r.entity_key AS receiptKey,r.document AS receiptDocument,o.entity_key AS orderKey,o.document AS orderDocument
         FROM community_entity_records r JOIN community_entity_records o ON o.entity_key=r.lookup_a AND o.collection='orders'
         WHERE ${predicate} ORDER BY r.created_at DESC,r.entity_key DESC LIMIT ${pageSize} OFFSET ${offset}`, values,
      );
      const receiptRows: EntityRow[] = rows.map((row) => ({ collection: "pickupReceipts", entityKey: String(row.receiptKey), document: row.receiptDocument } as EntityRow));
      const orderRows: EntityRow[] = rows.map((row) => ({ collection: "orders", entityKey: String(row.orderKey), document: row.orderDocument } as EntityRow));
      await this.mergeEntityRows(scope, "pickupReceipts", receiptRows);
      const orders = await this.ordersFromRows(scope, orderRows);
      const orderById = new Map(orders.map((order) => [order.id, order]));
      const receipts = new Map(scope.snapshot.exportEntityRows("pickupReceipts"));
      const items = receiptRows.flatMap((row) => {
        const receipt = receipts.get(row.entityKey) as CommunityPickupReceipt | undefined;
        const order = receipt ? orderById.get(receipt.orderId) : undefined;
        return receipt && order ? [{ receipt, order }] : [];
      });
      return { handled: true, value: { items, total: Number(counts[0]?.total ?? 0), page, pageSize } };
    }
    return { handled: false };
  }
  /**
   * The all-campaign sales total walks every historical order line, so it is
   * served from a short-lived cache: fresh values directly, stale values while
   * a single pooled refresh runs, and the first value synchronously.
   */
  private async cachedGlobalSales(): Promise<Map<string, number>> {
    const cached = this.globalSales;
    if (cached && Date.now() - cached.at < this.globalSalesCacheMs) return cached.value;
    const refresh = this.refreshGlobalSales();
    if (cached) {
      refresh.catch(() => undefined);
      return cached.value;
    }
    return refresh;
  }
  private refreshGlobalSales(): Promise<Map<string, number>> {
    this.globalSalesRefresh ??= queryNetSales(this.pool)
      .then((value) => {
        this.globalSales = { value, at: Date.now() };
        return value;
      })
      .finally(() => { this.globalSalesRefresh = null; });
    return this.globalSalesRefresh;
  }
  private async invoke(property: string, args: unknown[]): Promise<unknown> {
    const scope = this.currentScope();
    if (scope) {
      if (scope.readonly && !READ_METHODS.has(property))
        throw new Error(`Readonly aggregate snapshot rejects ${property}`);
      if (scope.mode === "ENTITY") {
        const special = await this.invokeEntitySpecial(scope, property, args);
        if (special.handled) return special.value;
        await this.loadEntityNeeds(scope, property, args);
      }
      const method = (MemoryStore.prototype as unknown as Record<string, StoreMethod>)[property];
      if (typeof method !== "function") throw new Error(`Unknown store method: ${property}`);
      const result = await Reflect.apply(method, scope.snapshot, args);
      if (scope.mode === "ENTITY" && !scope.readonly) await this.flushEntityChanges(scope);
      return result;
    }
    const work = () => this.invoke(property, args);
    return READ_METHODS.has(property) ? this.readSnapshot(work) : this.transaction(work);
  }
  public override async readSnapshot<T>(work: (store: CommerceStore) => Promise<T>): Promise<T> {
    if (this.currentScope()) return work(this.facade);
    const connection = await this.pool.getConnection();
    let scope: Scope | undefined;
    try {
      const mode = await this.persistenceMode(connection);
      if (mode === "ENTITY") {
        await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
      }
      scope = { connection, snapshot: mode === "ENTITY" ? new MemoryStore(false) : await this.load(connection, true), readonly: true, active: true, mode, loaded: new Map() };
      return await this.context.run(scope, () => work(this.facade));
    } catch (error) {
      if (scope?.mode === "ENTITY") await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      if (scope) scope.active = false;
      if (scope?.mode === "ENTITY") await connection.commit().catch(() => undefined);
      connection.release();
    }
  }
  public override async transaction<T>(work: (store: CommerceStore) => Promise<T>): Promise<T> {
    const existing = this.currentScope();
    if (existing) {
      if (existing.readonly) throw new Error("Readonly aggregate snapshot rejects transaction");
      return work(this.facade);
    }
    const connection = await this.pool.getConnection();
    let scope: Scope | undefined;
    try {
      await connection.beginTransaction();
      await connection.query("SELECT id FROM community_product_state WHERE id=1 FOR UPDATE");
      const mode = await this.persistenceMode(connection);
      scope = { connection, snapshot: mode === "ENTITY" ? new MemoryStore(false) : await this.load(connection, false), readonly: false, active: true, mode, loaded: new Map() };
      // MemoryStore.transaction retains internal-write actor revision checks.
      if (mode === "ENTITY") {
        const actor = getCurrentInternalWriteActor();
        if (actor) {
          await this.loadEntityNeed(scope, { collection: "users", key: actor.userId });
          await this.loadEntityNeed(scope, { collection: "staff", key: actor.userId });
          await this.loadEntityNeed(scope, { collection: "credentials", index: "a", value: actor.userId });
          if (actor.accessRoleId) await this.loadEntityNeed(scope, { collection: "accessRoles", key: actor.accessRoleId });
        }
      }
      const result = await this.context.run(scope, () => scope!.snapshot.transaction(() => work(this.facade)));
      if (mode === "LEGACY") {
        const serialized = (scope.snapshot as AggregateSnapshot).serialize();
        const payloadBytes = Buffer.byteLength(serialized, "utf8");
        await connection.query(
          "UPDATE community_product_state SET payload=?,updated_at=UTC_TIMESTAMP(3) WHERE id=1",
          [serialized],
        );
        this.payloadMonitor.observe(payloadBytes);
      }
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      if (scope) scope.active = false;
      connection.release();
    }
  }
  public override async health(): Promise<"ok"> {
    await this.pool.query("SELECT 1");
    return "ok";
  }
  public getAggregatePayloadStatus(): AggregatePayloadStatus {
    return this.payloadMonitor.status();
  }
  public override async databaseNow(): Promise<string> {
    const connection = this.currentScope()?.connection ?? this.pool;
    const [rows] = await connection.query<RowDataPacket[]>("SELECT UTC_TIMESTAMP(3) AS now");
    return new Date(rows[0]!.now as Date | string).toISOString();
  }
  public override async close(): Promise<void> {
    await this.globalSalesRefresh?.catch(() => undefined);
    await this.pool.end();
  }
}
