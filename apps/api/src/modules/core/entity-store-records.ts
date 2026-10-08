import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";

export const ENTITY_COLLECTIONS = [
  "users", "privacy", "sessions", "passwordChangeTokens", "credentials", "roles",
  "accessRoles", "deletedAccessRoleIds", "staff", "staffPoints", "areas", "points",
  "catalog", "categories", "homepageBanners", "campaigns", "campaignGroups", "idempotency", "orders",
  "checkoutBatches", "lines", "payments", "paymentBatches", "callbacks", "orderRefunds",
  "partialRefunds", "ledger", "audits", "plans", "batches", "pickupCredentials",
  "pickupRecords", "pickupReceipts", "deliveries", "exceptions", "allocations", "drafts",
  "windows", "cancellations", "quality", "interests", "notifications", "preferences",
  "reconciliationBills", "reconciliationReviews",
] as const;

export type EntityCollection = (typeof ENTITY_COLLECTIONS)[number];
export interface EntityRecord {
  collection: EntityCollection;
  entityKey: string;
  lookupA: string | null;
  lookupB: string | null;
  lookupC: string | null;
  lookupD: string | null;
  lookupE: string | null;
  lookupF: string | null;
  status: string | null;
  createdAt: string | null;
  queueAt: string | null;
  paidAt: string | null;
  dueAt: string | null;
  retryAt: string | null;
  leaseUntil: string | null;
  providerStartedAt: string | null;
  uniqueKey: string | null;
  searchText: string | null;
  document: unknown;
}
export interface EntityRow extends RowDataPacket {
  collection: EntityCollection;
  entityKey: string;
  document: string | Record<string, unknown>;
}
const dateOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 23).replace("T", " ");
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const primary = (collection: EntityCollection, key: string, value: unknown): string => {
  // MemoryStore exportEntityRows already supplies the authoritative Map key.
  // Preserve it verbatim: multi-field documents (sessions, credentials,
  // payments, refunds, and preferences among them) must not be re-keyed by
  // whichever field happens to come first in the serialized document.
  if (collection !== "lines") return key;

  // MemoryStore stores all order lines under the parent order key; Entity
  // Store needs one stable key per line while retaining that grouping key.
  const line = object(value);
  return `${key}:${String(line.id ?? key)}`;
};

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJsonValue(item)]));
  }
  return value;
}

export function canonicalEntityJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

export function canonicalEntityRecord(record: EntityRecord): string {
  return canonicalEntityJson([
    record.collection, record.entityKey, record.lookupA, record.lookupB, record.lookupC,
    record.lookupD, record.lookupE, record.lookupF, record.status, record.createdAt,
    record.queueAt, record.paidAt, record.dueAt, record.retryAt, record.leaseUntil,
    record.providerStartedAt, record.uniqueKey, record.searchText, record.document,
  ]);
}

export function entityRecordRelations(record: EntityRecord): Array<[string, string]> {
  const doc = object(record.document);
  if (record.collection === "checkoutBatches")
    return (Array.isArray(doc.orderIds) ? doc.orderIds : []).map((target) => ["order_id", String(target)]);
  if (record.collection === "campaigns")
    return (Array.isArray(doc.items) ? doc.items as Array<Record<string, unknown>> : [])
      .map((item) => item.catalogSkuId)
      .filter((target) => target !== undefined && target !== null)
      .map((target) => ["catalog_sku", String(target)]);
  return [];
}

export function toEntityRecord(collection: EntityCollection, key: string, value: unknown): EntityRecord {
  const doc = object(value);
  let lookupA: unknown = null;
  let lookupB: unknown = null;
  let lookupC: unknown = null;
  let lookupD: unknown = null;
  let lookupE: unknown = null;
  let lookupF: unknown = null;
  let status: unknown = doc.status;
  const createdAt: unknown = doc.createdAt ?? doc.importedAt ?? doc.registeredAt ?? doc.requestedAt ?? doc.confirmedAt;
  let queueAt: unknown = doc.requestedAt ?? doc.registeredAt ?? doc.deadlineAt ?? doc.createdAt;
  const paidAt: unknown = collection === "payments" || collection === "paymentBatches" ? doc.succeededAt : doc.paidAt;
  let dueAt: unknown = doc.expiresAt ?? doc.deadlineAt ?? doc.nextAttemptAt ?? doc.submissionLeaseUntil ?? doc.deliveryLeaseUntil;
  let retryAt: unknown = doc.nextAttemptAt;
  let leaseUntil: unknown = doc.submissionLeaseUntil ?? doc.deliveryLeaseUntil ?? doc.initiationLeaseUntil;
  let providerStartedAt: unknown = doc.providerSubmissionStartedAt;
  let uniqueKey: unknown = null;
  let searchText: unknown = null;
  switch (collection) {
    case "users": lookupA = doc.wechatOpenId; lookupB = doc.consumerNumber; lookupC = doc.phoneNumber; lookupD = doc.displayName; uniqueKey = doc.wechatOpenId; searchText = [doc.consumerNumber, doc.phoneNumber, doc.displayName].filter(Boolean).join(" "); break;
    case "privacy": lookupA = doc.userId; lookupB = doc.documentVersion; break;
    case "sessions": case "passwordChangeTokens": lookupA = doc.userId; break;
    case "credentials": lookupA = doc.userId; lookupB = String(doc.username ?? key).trim().toLowerCase(); break;
    case "roles": case "staff": case "preferences": lookupA = doc.userId; break;
    case "staffPoints": lookupA = doc.staffUserId; lookupB = doc.pickupPointId; break;
    case "points": case "catalog": case "homepageBanners": lookupA = doc.serviceAreaId; lookupB = doc.categoryId; break;
    case "campaigns": lookupA = doc.serviceAreaId; lookupB = doc.status; lookupC = doc.cutoffAt; lookupD = doc.campaignGroupId; break;
    case "campaignGroups": lookupA = doc.groupingMode; status = doc.status ?? null; break;
    case "idempotency": lookupA = key.slice(0, Math.max(0, key.lastIndexOf(":"))); lookupB = key.slice(key.lastIndexOf(":") + 1); break;
    case "orders": lookupA = doc.userId; lookupB = doc.campaignId; lookupC = doc.pickupPointId; lookupD = doc.orderNo; lookupE = doc.serviceAreaId; lookupF = doc.deliveryPlanId; uniqueKey = doc.orderNo; searchText = doc.orderNo; break;
    case "lines": lookupA = doc.orderId; lookupB = doc.campaignId; lookupC = doc.catalogSkuId; break;
    case "checkoutBatches": lookupA = doc.userId; lookupB = doc.outTradeNo; uniqueKey = doc.outTradeNo; break;
    case "payments": lookupA = doc.orderId; lookupB = doc.checkoutBatchId; lookupC = doc.providerPaymentId; break;
    case "paymentBatches": lookupA = doc.checkoutBatchId; lookupB = doc.providerPaymentId; break;
    case "callbacks": lookupA = key; break;
    case "orderRefunds": case "partialRefunds": lookupA = doc.orderId; lookupB = doc.providerRefundNo; lookupC = doc.exceptionId; uniqueKey = collection === "orderRefunds" ? doc.orderId : null; break;
    case "ledger": lookupA = doc.referenceId; lookupB = `${String(doc.referenceType ?? "")}:${String(doc.eventType ?? "")}`; uniqueKey = doc.postingKey
      ? `${String(doc.referenceType ?? "")}:${String(doc.referenceId ?? "")}:${String(doc.eventType ?? "")}:${String(doc.postingKey)}`
      : `${String(doc.referenceType ?? "")}:${String(doc.referenceId ?? "")}:${String(doc.eventType ?? "")}`; break;
    case "audits": lookupA = `${String(doc.resourceType ?? "")}:${String(doc.resourceId ?? "")}`; lookupB = doc.action; lookupC = `${String(doc.resourceType ?? "")}:${String(doc.resourceId ?? "")}:${String(doc.action ?? "")}`; break;
    case "plans": case "batches": case "deliveries": lookupA = doc.campaignId; lookupB = doc.pickupPointId ?? doc.dispatchBatchId; if (collection === "deliveries") uniqueKey = doc.dispatchBatchId; break;
    case "pickupCredentials": lookupA = doc.orderId ?? key; lookupB = doc.codeHash; break;
    case "windows": case "cancellations": lookupA = doc.orderId ?? key.split(":")[0]; lookupB = doc.deliveryPlanId; lookupC = doc.verifierId; break;
    case "pickupReceipts": lookupA = doc.orderId; lookupB = doc.pickupRequestId; lookupC = doc.deliveryPlanId; uniqueKey = `${String(doc.orderId ?? "")}:${String(doc.pickupRequestId ?? "")}`; break;
    case "exceptions": case "quality": lookupA = doc.orderId; lookupB = doc.clientRequestId; lookupC = doc.campaignId; lookupF = collection === "exceptions" ? doc.sourceStage : null; uniqueKey = collection === "quality" && doc.orderId && doc.clientRequestId ? `${String(doc.orderId)}:${String(doc.clientRequestId)}` : null; break;
    case "allocations": lookupA = doc.orderId; lookupB = doc.exceptionId; lookupC = doc.orderLineId; lookupD = doc.clientRequestId; break;
    case "drafts": lookupA = doc.communityDeliveryId; lookupB = doc.campaignId; break;
    case "interests": lookupA = doc.userId; lookupB = doc.serviceAreaId; break;
    case "notifications": lookupA = doc.userId; lookupB = doc.orderId; lookupC = doc.eventKey; lookupF = ["MANUAL_REQUIRED", "SUBMISSION_UNKNOWN"].includes(String(doc.status)) || (doc.status === "PENDING_DELIVERY" && Boolean(doc.lastDeliveryError)) ? "1" : "0"; status = doc.status; queueAt = doc.manualCompletedAt ?? doc.createdAt; dueAt = null; retryAt = doc.nextAttemptAt; leaseUntil = doc.deliveryLeaseUntil; providerStartedAt = doc.providerSubmissionStartedAt; uniqueKey = doc.eventKey; break;
    case "accessRoles": lookupA = doc.status; break;
    case "categories": lookupA = doc.status; break;
    case "reconciliationBills": lookupA = doc.merchantId; lookupB = doc.billDate; uniqueKey = `${String(doc.merchantId ?? "")}:${String(doc.sourceHash ?? "")}`; break;
    case "reconciliationReviews": lookupA = doc.billId; lookupB = doc.requestId; uniqueKey = `${String(doc.billId ?? "")}:${String(doc.requestId ?? "")}`; break;
    case "areas": lookupA = doc.regionCode; break;
    case "deletedAccessRoleIds": lookupA = key; break;
    case "pickupRecords": lookupA = key.split(":")[0]; lookupB = key.split(":")[1]; lookupC = key.split(":")[2]; break;
  }
  const safeIndex = (input: unknown): string | null => {
    if (input === null || input === undefined) return null;
    const result = Array.isArray(input) ? input.join(",") : String(input);
    if (result.length > 1024) throw new Error(`Entity lookup value exceeds 1024 characters: ${collection}`);
    return result;
  };
  const document = collection === "callbacks" ? { bodyHash: value } :
    collection === "pickupRecords" ? { record: value, orderId: key.split(":")[0], deliveryPlanId: key.split(":")[1], verifierId: key.split(":")[2] } : value;
  const entityKey = primary(collection, key, document);
  const businessKey = safeIndex(uniqueKey);
  if (entityKey.length > 512) throw new Error(`Entity primary key exceeds 512 characters: ${collection}`);
  if (businessKey !== null && businessKey.length > 700) throw new Error(`Entity unique key exceeds 700 characters: ${collection}`);
  return {
    collection,
    entityKey,
    lookupA: safeIndex(lookupA), lookupB: safeIndex(lookupB), lookupC: safeIndex(lookupC),
    lookupD: safeIndex(lookupD), lookupE: safeIndex(lookupE), lookupF: safeIndex(lookupF),
    status: safeIndex(status), createdAt: dateOrNull(createdAt), paidAt: dateOrNull(paidAt), dueAt: dateOrNull(dueAt),
    queueAt: dateOrNull(queueAt),
    retryAt: dateOrNull(retryAt), leaseUntil: dateOrNull(leaseUntil), providerStartedAt: dateOrNull(providerStartedAt),
    uniqueKey: businessKey, searchText: safeIndex(searchText)?.toLocaleLowerCase("zh-CN") ?? null,
    document,
  };
}

export function legacyStateRecords(raw: string): EntityRecord[] {
  const state = JSON.parse(raw) as Record<string, unknown>;
  const records: EntityRecord[] = [];
  for (const collection of ENTITY_COLLECTIONS) {
    const value = state[collection];
    if (collection === "audits") {
      for (const audit of Array.isArray(value) ? value : []) {
        const doc = object(audit);
        const key = JSON.stringify([doc.requestId, doc.action]);
        records.push(toEntityRecord(collection, key, audit));
      }
    } else if (collection === "pickupRecords" || collection === "deletedAccessRoleIds") {
      for (const entry of Array.isArray(value) ? value : []) records.push(toEntityRecord(collection, String(entry), entry));
    } else if (collection === "lines") {
      for (const [orderId, lines] of Array.isArray(value) ? value as Array<[string, unknown[]]> : [])
        for (const line of lines) records.push(toEntityRecord(collection, orderId, { ...object(line), orderId }));
    } else if (collection === "callbacks") {
      for (const [key, hash] of Array.isArray(value) ? value as Array<[string, unknown]> : []) records.push(toEntityRecord(collection, key, hash));
    } else {
      for (const [key, doc] of Array.isArray(value) ? value as Array<[string, unknown]> : []) records.push(toEntityRecord(collection, key, doc));
    }
  }
  return records;
}

export function decodeEntityDocument(collection: EntityCollection, raw: EntityRow["document"]): unknown {
  const parsed = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
  if (collection === "callbacks") return object(parsed).bodyHash;
  if (collection === "pickupRecords") return object(parsed).record;
  return parsed;
}

export function entitySnapshotHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
