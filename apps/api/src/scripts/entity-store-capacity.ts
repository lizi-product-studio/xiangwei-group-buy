/** Synthetic B-tier capacity harness. Run seed and measure in separate processes. */
import { randomUUID, createHash } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { moneyCents } from "@hometown/domain";
import { BUILTIN_ACCESS_ROLES } from "@hometown/api-contracts";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createAdminCredential } from "../modules/auth/admin-auth.js";
import { MysqlStore, orderStatusesExcept } from "../modules/core/mysql-store.js";
import { entityRecordRelations, toEntityRecord, type EntityRecord } from "../modules/core/entity-store-records.js";
import { assertCapacityEnrichmentGraph } from "./entity-store-capacity-record.js";
import { LedgerService, type LedgerPostingStore } from "../modules/finance/ledger-service.js";
import type { FulfillmentException, LedgerTransaction, Order, OrderItem, PartialRefund, ServiceArea } from "../modules/core/types.js";
import { pickupCode, pickupCodeHash } from "../modules/fulfillment/pickup-code.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Capacity harness requires DATABASE_URL");
if (process.env.ENTITY_STORE_TARGET !== "isolated-test" || process.env.ENTITY_STORE_CAPACITY_CONFIRM !== "true")
  throw new Error("Capacity harness requires ENTITY_STORE_TARGET=isolated-test and ENTITY_STORE_CAPACITY_CONFIRM=true");
if (new URL(databaseUrl).hostname === "192.144.136.205") throw new Error("Refusing capacity work against production");
const phase = process.argv[2];
if (phase !== "seed" && phase !== "measure" && phase !== "explain") throw new Error("usage: entity-store-capacity <seed|measure|explain>");
const concurrency = Number(process.env.ENTITY_STORE_CAPACITY_CONCURRENCY ?? 5);
const warmupCount = Number(process.env.ENTITY_STORE_CAPACITY_WARMUP ?? 5);
const sampleCount = Number(process.env.ENTITY_STORE_CAPACITY_SAMPLES ?? 100);
if (concurrency !== 5 || warmupCount !== 5 || sampleCount !== 100)
  throw new Error("Capacity acceptance requires exactly 5 concurrent workers, 5 warmups, and 100 measured samples per path");
const POINTS = 50;
const DAYS = 90;
const ORDERS_PER_POINT_DAY = 30;
const REQUIRED_ORDER_COUNT = POINTS * DAYS * ORDERS_PER_POINT_DAY;
const ORDER_COUNT = Number(process.env.ENTITY_STORE_CAPACITY_ORDERS ?? REQUIRED_ORDER_COUNT);
if (!Number.isSafeInteger(ORDER_COUNT) || ORDER_COUNT < 1 || ORDER_COUNT > REQUIRED_ORDER_COUNT)
  throw new Error("ENTITY_STORE_CAPACITY_ORDERS must be between 1 and 135000");
if ((phase === "measure" || phase === "explain") && ORDER_COUNT !== REQUIRED_ORDER_COUNT)
  throw new Error("Capacity acceptance measure/explain requires ENTITY_STORE_CAPACITY_ORDERS=135000 (or unset)");
const TOTAL_SLOTS = POINTS * DAYS * ORDERS_PER_POINT_DAY;
const AMOUNT_CENTS = 1500;
const PAGE = 500;
const iso = (value: Date): string => value.toISOString();
const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
const tokenDigest = (value: string): string => createHash("sha256").update(value).digest("hex");
const percent = (values: number[], p: number): number => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0;
const pickupSecret = "synthetic-capacity-secret-2026-only";
const capacityPrivacyVersion = process.env.PRIVACY_NOTICE_VERSION ?? "2026-09-07-phone-v1";
const capacityManagerPassword = "SyntheticCapacityPass-2026";
const capacityCustomerToken = (index: number): string => `synthetic-customer-token-${index}-capacity-test`;
const capacityManagerToken = "synthetic-manager-token-capacity-test";
const capacityOperatorToken = "synthetic-operator-token-capacity-test";
const OPEN_DAY = DAYS - 1;
const openCampaignId = (pointIndex: number): string => `capacity-campaign-${pointIndex}-${OPEN_DAY}`;
const ledgerService = new LedgerService();
/** Postings produced by the real LedgerService, collected without a store. */
const collectLedger = async (post: (store: LedgerPostingStore) => Promise<void>): Promise<LedgerTransaction[]> => {
  const postings: LedgerTransaction[] = [];
  await post({
    appendLedgerTransaction: async (value) => { postings.push(value); return true; },
    listLedgerTransactions: async (referenceId) => postings.filter((item) => referenceId === undefined || item.referenceId === referenceId),
  });
  return postings;
};

/**
 * Small, fully reconciled graph of the less common transaction shapes: a
 * two-line order in a merged checkout with a partial refund and fulfilment
 * exception, a fully refunded order, retry/manual notifications and callbacks.
 * Seeded once into a fresh schema, so it is never patched or upgraded in place.
 */
async function richSampleRecords(createdAt: string, paidAt: string, dayAhead: string): Promise<EntityRecord[]> {
  const campaignId = "capacity-enrich-campaign";
  const planId = "capacity-enrich-plan";
  const pointId = "capacity-point-00";
  const areaId = "capacity-area-entity";
  const userId = "capacity-user-1";
  const partialOrderId = "capacity-enrich-partial-order";
  const fullOrderId = "capacity-enrich-full-order";
  const skuA = "capacity-sku-entity";
  const skuB = "capacity-enrich-sku";
  const skuC = "capacity-enrich-sku-1000";
  const productCId = "capacity-enrich-product-1000";
  const productB = { id: "capacity-enrich-product", title: "Synthetic pantry item", category: "pantry", origin: "synthetic", imageUrl: null, storageType: "NORMAL_TEMPERATURE", status: "ACTIVE" };
  const productC = { id: productCId, title: "Synthetic 1000-cent produce", category: "vegetables", origin: "synthetic", imageUrl: null, storageType: "NORMAL_TEMPERATURE", status: "ACTIVE" };
  const orderLine = (id: string, orderId: string, orderNo: string, catalogSkuId: string, productId: string, title: string, unitCents: number, refunded: boolean) => ({
    id, orderId, orderNo, campaignId, catalogSkuId, productId, skuName: title,
    quantity: 1, unitPriceCents: moneyCents(unitCents), amountCents: moneyCents(unitCents), paidAt,
    fulfilledQuantity: refunded ? 0 : 1, pickedUpQuantity: 0, exceptionQuantity: refunded ? 1 : 0,
    refundedQuantity: refunded ? 1 : 0, refundedAmountCents: moneyCents(refunded ? unitCents : 0),
  });
  const partialLineA = orderLine("capacity-enrich-partial-line-a", partialOrderId, "CAP-ENRICH-PARTIAL", skuC, productCId, "Synthetic 1000-cent produce", 1000, false);
  const partialLineB = orderLine("capacity-enrich-partial-line-b", partialOrderId, "CAP-ENRICH-PARTIAL", skuB, "capacity-enrich-product", "Synthetic pantry item", 500, true);
  const fullLine = orderLine("capacity-enrich-full-line", fullOrderId, "CAP-ENRICH-FULL", skuC, productCId, "Synthetic 1000-cent produce", 1000, true);
  const itemFor = (line: ReturnType<typeof orderLine>): OrderItem => ({
    orderLineId: line.id, skuId: line.catalogSkuId, productId: line.productId, name: line.skuName,
    quantity: line.quantity, unitPriceCents: line.unitPriceCents, amountCents: line.amountCents,
    fulfilledQuantity: line.fulfilledQuantity, pickedUpQuantity: line.pickedUpQuantity,
    exceptionQuantity: line.exceptionQuantity, refundedQuantity: line.refundedQuantity,
    refundedAmountCents: line.refundedAmountCents,
  });
  const checkoutPartial = "capacity-enrich-checkout-partial";
  const checkoutFull = "capacity-enrich-checkout-full";
  const paymentPartial = "capacity-enrich-payment-partial";
  const paymentFull = "capacity-enrich-payment-full";
  const exceptionId = "capacity-enrich-exception";
  const partialRefundId = "capacity-enrich-partial-refund";
  const partialOrder: Order = {
    id: partialOrderId, orderNo: "CAP-ENRICH-PARTIAL", userId, campaignId, serviceAreaId: areaId, pickupPointId: pointId,
    deliveryPlanId: planId, status: "READY_FOR_PICKUP", totalCents: moneyCents(1500), items: [itemFor(partialLineA), itemFor(partialLineB)],
    createdAt, expiresAt: dayAhead, paidAt, pickedUpAt: null,
  };
  const fullOrder: Order = {
    id: fullOrderId, orderNo: "CAP-ENRICH-FULL", userId, campaignId, serviceAreaId: areaId, pickupPointId: pointId,
    deliveryPlanId: planId, status: "REFUNDED", totalCents: moneyCents(1000), items: [itemFor(fullLine)],
    createdAt, expiresAt: dayAhead, paidAt, pickedUpAt: null,
  };
  const exception = {
    id: exceptionId, campaignId, orderId: partialOrderId, clientRequestId: "CAP-EXCEPTION-REQUEST", deliveryPlanId: planId,
    sourceStage: "CUSTOMER_CLAIM", refundAccountingStage: "PRE_REVENUE", status: "REFUND_CONFIRMED", responsibility: "PLATFORM",
    registeredBy: userId, confirmedBy: "capacity-manager", resolutionNote: "Synthetic capacity-only exception",
    registeredAt: paidAt, confirmedAt: paidAt,
    items: [{ id: "capacity-enrich-exception-item", exceptionId, catalogSkuId: skuB, expectedQuantity: 1, acceptedQuantity: 0,
      rejectedQuantity: 0, shortQuantity: 0, damagedQuantity: 1, reason: "PICKUP_DAMAGE", description: "Synthetic test fixture", evidenceUrl: null }],
  };
  const partialRefund = { id: partialRefundId, exceptionId, orderId: partialOrderId, paymentId: paymentPartial, providerRefundNo: "CAP-REFUND-PARTIAL", providerRefundId: "CAP-PROVIDER-REFUND-PARTIAL", status: "SUCCEEDED", amountCents: moneyCents(500), createdAt: paidAt, submissionLeaseUntil: null, submissionClaimToken: null, submissionAttempts: 1, queryAttempts: 0, nextAttemptAt: null, lastError: null, recoveryVersion: 1, recoveryAttempts: 1 };
  // Ledger postings exactly as LedgerService writes them for these events.
  const ledgerIds = ["capacity-enrich-payment-ledger-partial", "capacity-enrich-refund-ledger-partial", "capacity-enrich-payment-ledger-full", "capacity-enrich-refund-ledger-full"];
  const postings = await collectLedger(async (ledgerStore) => {
    await ledgerService.recordPayment(ledgerStore, partialOrder);
    await ledgerService.recordPartialRefund(ledgerStore, exception as unknown as FulfillmentException, partialRefund as unknown as PartialRefund);
    await ledgerService.recordPayment(ledgerStore, fullOrder);
    await ledgerService.recordRefund(ledgerStore, fullOrder);
  });
  if (postings.length !== ledgerIds.length) throw new Error("LedgerService produced an unexpected number of synthetic postings");
  const records: EntityRecord[] = [
    toEntityRecord("catalog", skuB, {
      id: skuB, productId: "capacity-enrich-product", categoryId: null, name: "Synthetic pantry item",
      retailPriceCents: moneyCents(500), defaultSellableQuantity: 1000, status: "ACTIVE", product: productB,
      createdAt, updatedAt: createdAt,
    }),
    toEntityRecord("catalog", skuC, {
      id: skuC, productId: productCId, categoryId: null, name: "Synthetic 1000-cent produce",
      retailPriceCents: moneyCents(1000), defaultSellableQuantity: 1000, status: "ACTIVE", product: productC,
      createdAt, updatedAt: createdAt,
    }),
    toEntityRecord("campaigns", campaignId, {
      id: campaignId, title: "Synthetic capacity enrichment campaign", serviceAreaId: areaId,
      cutoffAt: createdAt, dispatchAt: paidAt, estimatedArrivalStartAt: paidAt, estimatedArrivalEndAt: dayAhead,
      minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND", status: "CLOSED", version: 1, createdAt,
      items: [
        { catalogSkuId: skuA, productId: "capacity-product", title: "Synthetic produce", category: "vegetables", skuName: "one unit", origin: "synthetic", imageUrl: null, retailPriceCents: moneyCents(AMOUNT_CENTS), sellableQuantity: 1000, reservedQuantity: 0 },
        { catalogSkuId: skuB, productId: "capacity-enrich-product", title: "Synthetic pantry item", category: "pantry", skuName: "one unit", origin: "synthetic", imageUrl: null, retailPriceCents: moneyCents(500), sellableQuantity: 1000, reservedQuantity: 0 },
        { catalogSkuId: skuC, productId: productCId, title: "Synthetic 1000-cent produce", category: "vegetables", skuName: "one unit", origin: "synthetic", imageUrl: null, retailPriceCents: moneyCents(1000), sellableQuantity: 1000, reservedQuantity: 0 },
      ],
    }),
    toEntityRecord("plans", planId, {
      id: planId, campaignId, serviceAreaId: areaId, pickupPointId: pointId, status: "ARRIVED",
      siteName: "Synthetic pickup point 0", address: "isolated synthetic address", arrivalStartAt: paidAt,
      arrivalEndAt: dayAhead, contactName: "Synthetic", contactPhone: "13800000000", vehicleOrderNo: "CAP-ENRICH",
      driverName: "Synthetic", driverPhone: "13800000002", vehiclePlate: "TEST-ONLY", logisticsPlatform: "synthetic",
      estimatedArrivalAt: paidAt, remark: null, confirmedAt: createdAt, bookedAt: createdAt, dispatchedAt: paidAt,
      arrivedAt: paidAt, createdAt, updatedAt: paidAt,
    }),
    toEntityRecord("checkoutBatches", checkoutPartial, { id: checkoutPartial, outTradeNo: "CAP-ENRICH-PARTIAL", userId, orderIds: [partialOrderId], totalCents: moneyCents(1500), status: "PAID", expiresAt: dayAhead, createdAt }),
    toEntityRecord("checkoutBatches", checkoutFull, { id: checkoutFull, outTradeNo: "CAP-ENRICH-FULL", userId, orderIds: [fullOrderId], totalCents: moneyCents(1000), status: "PAID", expiresAt: dayAhead, createdAt }),
    toEntityRecord("orders", partialOrderId, partialOrder),
    toEntityRecord("orders", fullOrderId, fullOrder),
    toEntityRecord("lines", partialOrderId, partialLineA),
    toEntityRecord("lines", partialOrderId, partialLineB),
    toEntityRecord("lines", fullOrderId, fullLine),
    toEntityRecord("payments", paymentPartial, { id: paymentPartial, orderId: partialOrderId, provider: "mock", providerPaymentId: "CAP-PAY-PARTIAL", status: "SUCCEEDED", amountCents: moneyCents(1500), clientPayload: null, providerContext: null, initiationLeaseUntil: null, initiationClaimToken: null, createdAt, succeededAt: paidAt, checkoutBatchId: checkoutPartial }),
    toEntityRecord("payments", paymentFull, { id: paymentFull, orderId: fullOrderId, provider: "mock", providerPaymentId: "CAP-PAY-FULL", status: "REFUNDED", amountCents: moneyCents(1000), clientPayload: null, providerContext: null, initiationLeaseUntil: null, initiationClaimToken: null, createdAt, succeededAt: paidAt, checkoutBatchId: checkoutFull }),
    toEntityRecord("paymentBatches", "capacity-enrich-payment-batch-partial", { id: "capacity-enrich-payment-batch-partial", checkoutBatchId: checkoutPartial, provider: "mock", providerPaymentId: "CAP-BATCH-PARTIAL", status: "SUCCEEDED", amountCents: moneyCents(1500), clientPayload: null, providerContext: null, initiationLeaseUntil: null, initiationClaimToken: null, createdAt, succeededAt: paidAt }),
    toEntityRecord("paymentBatches", "capacity-enrich-payment-batch-full", { id: "capacity-enrich-payment-batch-full", checkoutBatchId: checkoutFull, provider: "mock", providerPaymentId: "CAP-BATCH-FULL", status: "REFUNDED", amountCents: moneyCents(1000), clientPayload: null, providerContext: null, initiationLeaseUntil: null, initiationClaimToken: null, createdAt, succeededAt: paidAt }),
    toEntityRecord("callbacks", "capacity-enrich-callback-partial", "synthetic-partial-callback-body-hash"),
    toEntityRecord("callbacks", "capacity-enrich-callback-full", "synthetic-full-callback-body-hash"),
    toEntityRecord("orderRefunds", "capacity-enrich-full-refund", { id: "capacity-enrich-full-refund", orderId: fullOrderId, paymentId: paymentFull, providerRefundNo: "CAP-REFUND-FULL", providerRefundId: "CAP-PROVIDER-REFUND-FULL", status: "SUCCEEDED", amountCents: moneyCents(1000), createdAt: paidAt, submissionLeaseUntil: null, submissionClaimToken: null, submissionAttempts: 1, queryAttempts: 0, nextAttemptAt: null, lastError: null, recoveryVersion: 1, recoveryAttempts: 1 }),
    toEntityRecord("partialRefunds", partialRefundId, partialRefund),
    toEntityRecord("exceptions", exceptionId, exception),
    toEntityRecord("allocations", "capacity-enrich-allocation", {
      id: "capacity-enrich-allocation", exceptionId, exceptionItemId: "capacity-enrich-exception-item", orderLineId: partialLineB.id,
      orderId: partialOrderId, catalogSkuId: skuB, fulfilledQuantity: 0, exceptionQuantity: 1, refundedQuantity: 1,
      createdAt: paidAt, refundedAt: paidAt,
    }),
    toEntityRecord("notifications", "capacity-enrich-retry-notice", {
      id: "capacity-enrich-retry-notice", eventKey: "capacity-enrich-retry-notice", userId, orderId: partialOrderId,
      type: "PARTIAL_REFUND", title: "Synthetic retry", content: "Synthetic test notification", status: "PENDING_DELIVERY",
      readAt: null, manualCompletedAt: null, manualCompletedBy: null, manualCompletionNote: null,
      manualCompletionChannel: null, manualCompletionExternalReference: null, manualCompletionResult: null,
      createdAt: paidAt, deliveryAttempts: 2, nextAttemptAt: dayAhead, deliveryLeaseUntil: null,
      deliveryClaimToken: null, providerSubmissionAttemptId: null, providerSubmissionStartedAt: null, providerResultRecordedAt: null,
      providerReceiptId: null, submissionUnknownReason: null, lastDeliveryError: "synthetic transient failure", deliveredAt: null,
    }),
    toEntityRecord("notifications", "capacity-enrich-manual-notice", {
      id: "capacity-enrich-manual-notice", eventKey: "capacity-enrich-manual-notice", userId, orderId: fullOrderId,
      type: "PARTIAL_REFUND", title: "Synthetic manual follow-up", content: "Synthetic test notification", status: "MANUAL_REQUIRED",
      readAt: null, manualCompletedAt: null, manualCompletedBy: null, manualCompletionNote: null,
      manualCompletionChannel: null, manualCompletionExternalReference: null, manualCompletionResult: null,
      createdAt: paidAt, deliveryAttempts: 3, nextAttemptAt: null, deliveryLeaseUntil: null, deliveryClaimToken: null,
      providerSubmissionAttemptId: null, providerSubmissionStartedAt: createdAt,
      providerResultRecordedAt: null, providerReceiptId: null, submissionUnknownReason: "synthetic timeout",
      lastDeliveryError: "synthetic ambiguous submission", deliveredAt: null,
    }),
    ...postings.map((posting, index) => toEntityRecord("ledger", ledgerIds[index]!, { ...posting, id: ledgerIds[index]!, createdAt: paidAt })),
  ];
  assertCapacityEnrichmentGraph(records);
  return records;
}

const connection = await mysql.createConnection({ uri: databaseUrl, jsonStrings: true, timezone: "Z" });
const documentFromRow = (value: unknown): Record<string, unknown> =>
  (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
if (phase === "seed") {
  try {
    const [stateRows] = await connection.query<RowDataPacket[]>("SELECT mode,entity_write_count FROM community_entity_store_state WHERE id=1");
    const [recordRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_records");
    const [relationRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_relations");
    const [journalRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_migration_journal");
    const [snapshotRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_legacy_snapshots");
    if (stateRows[0]?.mode !== "LEGACY" || Number(stateRows[0]?.entity_write_count) !== 0 ||
        Number(recordRows[0]?.total) || Number(relationRows[0]?.total) || Number(journalRows[0]?.total) || Number(snapshotRows[0]?.total))
      throw new Error("Seed requires a fresh, empty LEGACY synthetic schema; it never clears existing data");

    let inserted = 0;
    const insertBatch = async (records: EntityRecord[]) => {
      for (let offset = 0; offset < records.length; offset += PAGE) {
        const batch = records.slice(offset, offset + PAGE);
        const values = batch.flatMap((record) => [
          record.collection, record.entityKey, record.lookupA, record.lookupB, record.lookupC, record.lookupD,
          record.lookupE, record.lookupF, record.status, record.createdAt, record.queueAt, record.paidAt,
          record.dueAt, record.retryAt, record.leaseUntil, record.providerStartedAt, record.uniqueKey,
          record.searchText, JSON.stringify(record.document),
        ]);
        const valueSql = batch.map(() => `(${Array.from({ length: 19 }, () => "?").join(",")})`).join(",");
        await connection.execute(
          `INSERT INTO community_entity_records(collection,entity_key,lookup_a,lookup_b,lookup_c,lookup_d,lookup_e,lookup_f,record_status,created_at,queue_at,paid_at,due_at,retry_at,lease_until,provider_started_at,unique_key,search_text,document) VALUES ${valueSql}`,
          values,
        );
        inserted += batch.length;
      }
    };
    const now = new Date();
    const start = new Date(now.valueOf() - (DAYS - 1) * 86_400_000);
    const pointIds = Array.from({ length: POINTS }, (_, index) => `capacity-point-${String(index).padStart(2, "0")}`);
    const areaId = "capacity-area-entity";
    const skuId = "capacity-sku-entity";
    await insertBatch([toEntityRecord("areas", areaId, { id: areaId, regionCode: "110101", name: "Synthetic capacity area", status: "ENABLED", orderEnabled: true, createdAt: iso(now) })]);
    await insertBatch(pointIds.map((id, index) => toEntityRecord("points", id, {
      id, serviceAreaId: areaId, name: `Synthetic pickup point ${index}`, address: "isolated synthetic address",
      businessHours: "09:00-20:00", pickupInstructions: "Synthetic test", latitude: 39.9, longitude: 116.4,
      contactName: "Synthetic", contactPhone: "13800000000", status: "ACTIVE", capacityPerDay: 1000, createdAt: iso(now),
    })));
    await insertBatch([toEntityRecord("catalog", skuId, {
      id: skuId, productId: "capacity-product", categoryId: null, name: "Synthetic seasonal produce",
      retailPriceCents: AMOUNT_CENTS, defaultSellableQuantity: ORDER_COUNT + 100, status: "ACTIVE",
      product: { id: "capacity-product", title: "Synthetic produce", category: "vegetables", origin: "synthetic", imageUrl: null, storageType: "NORMAL_TEMPERATURE", status: "ACTIVE" },
      createdAt: iso(now), updatedAt: iso(now),
    })]);

    const campaigns: EntityRecord[] = [];
    const plans: EntityRecord[] = [];
    for (let pointIndex = 0; pointIndex < POINTS; pointIndex++) for (let dayIndex = 0; dayIndex < DAYS; dayIndex++) {
      const campaignId = `capacity-campaign-${pointIndex}-${dayIndex}`;
      const pointId = pointIds[pointIndex]!;
      const date = new Date(start.valueOf() + dayIndex * 86_400_000);
      const next = new Date(date.valueOf() + 86_400_000);
      campaigns.push(toEntityRecord("campaigns", campaignId, {
        id: campaignId, title: `Synthetic campaign ${pointIndex}-${dayIndex}`, serviceAreaId: areaId,
        cutoffAt: dayIndex === OPEN_DAY ? iso(new Date(now.valueOf() + 86_400_000)) : iso(date),
        dispatchAt: iso(next), estimatedArrivalStartAt: iso(next), estimatedArrivalEndAt: iso(new Date(next.valueOf() + 3_600_000)),
        minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND", items: [{ catalogSkuId: skuId, productId: "capacity-product", title: "Synthetic produce", category: "vegetables", skuName: "one unit", origin: "synthetic", imageUrl: null, retailPriceCents: AMOUNT_CENTS, sellableQuantity: 1000, reservedQuantity: 30 }],
        status: dayIndex === OPEN_DAY ? "OPEN" : "CLOSED", version: 1, createdAt: iso(date),
      }));
      plans.push(toEntityRecord("plans", `capacity-plan-${pointIndex}-${dayIndex}`, {
        id: `capacity-plan-${pointIndex}-${dayIndex}`, campaignId, serviceAreaId: areaId, pickupPointId: pointId,
        // Each point's open campaign needs a plan that can still accept sales;
        // ARRIVED remains reserved for the historical pickup-verification rows.
        status: dayIndex === OPEN_DAY ? "VEHICLE_BOOKED" : "ARRIVED",
        siteName: `Synthetic pickup point ${pointIndex}`, address: "isolated synthetic address",
        arrivalStartAt: iso(next), arrivalEndAt: iso(new Date(next.valueOf() + 3_600_000)), createdAt: iso(date), updatedAt: iso(date),
      }));
    }
    await insertBatch(campaigns);
    await insertBatch(plans);
    const relations = campaigns.map((campaign) => ["campaigns", campaign.entityKey, "catalog_sku", skuId] as const);
    for (let offset = 0; offset < relations.length; offset += PAGE) {
      const batch = relations.slice(offset, offset + PAGE);
      const sql = batch.map(() => "(?,?,?,?,?,?)").join(",");
      const values = batch.flatMap(([collection, sourceKey, name, targetKey]) => [collection, sourceKey, digest(sourceKey), name, targetKey, digest(targetKey)]);
      await connection.execute(`INSERT INTO community_entity_relations(source_collection,source_key,source_key_sha256,relation_name,target_key,target_key_sha256) VALUES ${sql}`, values);
    }

    const userCount = Math.min(1500, Math.max(30, Math.ceil(ORDER_COUNT / 90)));
    await insertBatch(Array.from({ length: userCount }, (_, index) => {
      const id = `capacity-user-${index}`;
      return toEntityRecord("users", id, { id, consumerNumber: index + 1, wechatOpenId: `synthetic-openid-${index}`, phoneNumber: `138${String(index).padStart(8, "0")}`, phoneVerifiedAt: iso(now), displayName: `Synthetic user ${index}`, status: "ACTIVE", createdAt: iso(now) });
    }));
    await insertBatch(Array.from({ length: userCount }, (_, index) => {
      const userId = `capacity-user-${index}`;
      const key = `${userId}:${capacityPrivacyVersion}`;
      return toEntityRecord("privacy", key, { userId, documentVersion: capacityPrivacyVersion, consentedAt: iso(now) });
    }));
    const managerId = "capacity-manager";
    const managerCredential = await createAdminCredential("capacity-manager", managerId, capacityManagerPassword, ["PICKUP_MANAGER"], false, 0);
    const pickupManagerRole = BUILTIN_ACCESS_ROLES.find((role) => role.id === "PICKUP_MANAGER");
    if (!pickupManagerRole) throw new Error("Built-in PICKUP_MANAGER access role is unavailable");
    await insertBatch([
      toEntityRecord("users", managerId, { id: managerId, wechatOpenId: null, status: "ACTIVE", createdAt: iso(now) }),
      toEntityRecord("staff", managerId, { userId: managerId, staffNo: "CAPACITY-MANAGER", displayName: "Synthetic pickup manager", phone: "13800000001", role: "PICKUP_MANAGER", accessRoleId: "PICKUP_MANAGER", status: "ACTIVE", createdBy: null, activatedAt: iso(now), suspendedAt: null, suspensionReason: null, authorizationVersion: 0, createdAt: iso(now), updatedAt: iso(now) }),
      toEntityRecord("credentials", managerCredential.username, managerCredential),
      toEntityRecord("accessRoles", pickupManagerRole.id, pickupManagerRole),
      ...pointIds.map((pickupPointId) => toEntityRecord("staffPoints", `${managerId}:${pickupPointId}`, { staffUserId: managerId, pickupPointId, assignedBy: managerId, createdAt: iso(now), updatedAt: iso(now) })),
    ]);
    // Platform operator for the admin dashboard and order-search paths.
    const operatorId = "capacity-operator";
    const operatorCredential = await createAdminCredential("capacity-operator", operatorId, capacityManagerPassword, ["OPERATOR"], false, 0);
    const operatorRole = BUILTIN_ACCESS_ROLES.find((role) => role.id === "OPERATOR");
    if (!operatorRole) throw new Error("Built-in OPERATOR access role is unavailable");
    await insertBatch([
      toEntityRecord("users", operatorId, { id: operatorId, wechatOpenId: null, status: "ACTIVE", createdAt: iso(now) }),
      toEntityRecord("staff", operatorId, { userId: operatorId, staffNo: "CAPACITY-OPERATOR", displayName: "Synthetic operator", phone: "13800000003", role: "OPERATOR", accessRoleId: "OPERATOR", status: "ACTIVE", createdBy: null, activatedAt: iso(now), suspendedAt: null, suspensionReason: null, authorizationVersion: 0, createdAt: iso(now), updatedAt: iso(now) }),
      toEntityRecord("credentials", operatorCredential.username, operatorCredential),
      toEntityRecord("accessRoles", operatorRole.id, operatorRole),
    ]);
    const sessions: EntityRecord[] = Array.from({ length: userCount }, (_, index) => {
      const token = capacityCustomerToken(index);
      const tokenHash = tokenDigest(token);
      return toEntityRecord("sessions", tokenHash, { tokenHash, userId: `capacity-user-${index}`, roles: ["USER"], authorizationVersion: 0, expiresAt: iso(new Date(now.valueOf() + 30 * 86_400_000)) });
    });
    const managerHash = tokenDigest(capacityManagerToken);
    sessions.push(toEntityRecord("sessions", managerHash, { tokenHash: managerHash, userId: managerId, roles: ["PICKUP_MANAGER"], authorizationVersion: 0, expiresAt: iso(new Date(now.valueOf() + 30 * 86_400_000)) }));
    const operatorHash = tokenDigest(capacityOperatorToken);
    sessions.push(toEntityRecord("sessions", operatorHash, { tokenHash: operatorHash, userId: operatorId, roles: ["OPERATOR"], authorizationVersion: 0, expiresAt: iso(new Date(now.valueOf() + 30 * 86_400_000)) }));
    await insertBatch(sessions);

    let orderRecords: EntityRecord[] = [];
    let lineRecords: EntityRecord[] = [];
    let paymentRecords: EntityRecord[] = [];
    let ledgerRecords: EntityRecord[] = [];
    let notificationRecords: EntityRecord[] = [];
    let receiptRecords: EntityRecord[] = [];
    let pickupRecords: EntityRecord[] = [];
    let credentialRecords: EntityRecord[] = [];
    let windowRecords: EntityRecord[] = [];
    let completedCount = 0, readyCount = 0;
    for (let index = 0; index < ORDER_COUNT; index++) {
      const slot = Math.floor(index * TOTAL_SLOTS / ORDER_COUNT);
      const perPointDay = DAYS * ORDERS_PER_POINT_DAY;
      const pointIndex = Math.floor(slot / perPointDay);
      const dayIndex = Math.floor((slot % perPointDay) / ORDERS_PER_POINT_DAY);
      const campaignId = `capacity-campaign-${pointIndex}-${dayIndex}`;
      const planId = `capacity-plan-${pointIndex}-${dayIndex}`;
      const pointId = pointIds[pointIndex]!;
      const created = new Date(start.valueOf() + dayIndex * 86_400_000 + (slot % ORDERS_PER_POINT_DAY) * 60_000);
      const completed = index % 10 !== 0;
      const status = completed ? "COMPLETED" : "READY_FOR_PICKUP";
      const orderId = `capacity-order-${String(index).padStart(7, "0")}`;
      const userId = `capacity-user-${index % userCount}`;
      const orderNo = `CAP-${String(index).padStart(7, "0")}`;
      const lineId = `capacity-line-${String(index).padStart(7, "0")}`;
      const paymentId = `capacity-payment-${String(index).padStart(7, "0")}`;
      const eventKey = `capacity-notice-${String(index).padStart(7, "0")}`;
      const order: Order = {
        id: orderId, orderNo, userId, campaignId, serviceAreaId: areaId, pickupPointId: pointId, deliveryPlanId: planId,
        status, totalCents: moneyCents(AMOUNT_CENTS), items: [], createdAt: iso(created), expiresAt: iso(new Date(created.valueOf() + 3_600_000)),
        paidAt: iso(new Date(created.valueOf() + 60_000)), pickedUpAt: completed ? iso(new Date(created.valueOf() + 7_200_000)) : null,
      };
      const line: Record<string, unknown> = {
        id: lineId, orderId, orderNo, catalogSkuId: skuId, productId: "capacity-product", skuName: "Synthetic produce · one unit",
        quantity: 1, unitPriceCents: moneyCents(AMOUNT_CENTS), amountCents: moneyCents(AMOUNT_CENTS), paidAt: order.paidAt!, fulfilledQuantity: 1,
        pickedUpQuantity: completed ? 1 : 0, exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: moneyCents(0),
      };
      orderRecords.push(toEntityRecord("orders", orderId, order));
      lineRecords.push(toEntityRecord("lines", orderId, line));
      paymentRecords.push(toEntityRecord("payments", paymentId, {
        id: paymentId, orderId, provider: "mock", providerPaymentId: `capacity-provider-${index}`, status: "SUCCEEDED",
        amountCents: moneyCents(AMOUNT_CENTS), clientPayload: null, providerContext: null, initiationLeaseUntil: null,
        initiationClaimToken: null, createdAt: order.createdAt, succeededAt: order.paidAt,
      }));
      // Account codes, directions and amounts come from the real LedgerService.
      const ledgerItem: OrderItem = { orderLineId: lineId, skuId, productId: "capacity-product", name: "Synthetic produce · one unit", quantity: 1,
        unitPriceCents: moneyCents(AMOUNT_CENTS), amountCents: moneyCents(AMOUNT_CENTS), fulfilledQuantity: 1, pickedUpQuantity: completed ? 1 : 0,
        exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: moneyCents(0) };
      const postings = await collectLedger(async (ledgerStore) => {
        await ledgerService.recordPayment(ledgerStore, { ...order, items: [ledgerItem] });
        if (completed) await ledgerService.recordPickup(ledgerStore, { ...order, items: [ledgerItem] });
      });
      for (const posting of postings) {
        const event = posting.eventType === "PAYMENT_SUCCEEDED" ? "payment" : "pickup";
        const id = `capacity-ledger-${event}-${index}`;
        ledgerRecords.push(toEntityRecord("ledger", id, { ...posting, id, createdAt: event === "payment" ? order.paidAt : order.pickedUpAt }));
      }
      notificationRecords.push(toEntityRecord("notifications", eventKey, {
        id: eventKey, userId, orderId, eventKey, status: "SENT", createdAt: order.createdAt, manualCompletedAt: null,
        nextAttemptAt: null, deliveryLeaseUntil: null, providerSubmissionStartedAt: null,
      }));
      if (completed) {
        completedCount++;
        const receiptId = `capacity-receipt-${index}`;
        receiptRecords.push(toEntityRecord("pickupReceipts", receiptId, {
          id: receiptId, orderId, deliveryPlanId: planId, verifierId: "capacity-verifier", requestKey: `capacity-request-${index}`,
          pickupRequestId: `capacity-pickup-${index}`, payloadHash: digest(String(index)).toString("hex"), createdAt: order.pickedUpAt,
          items: [{ id: `capacity-receipt-line-${index}`, communityPickupReceiptId: receiptId, catalogSkuId: skuId, quantity: 1 }],
        }));
        pickupRecords.push(toEntityRecord("pickupRecords", `${orderId}:${planId}:capacity-verifier`, `${orderId}:${planId}:capacity-verifier`));
      } else {
        readyCount++;
        const plainCode = pickupCode(orderId, pickupSecret);
        credentialRecords.push(toEntityRecord("pickupCredentials", orderId, { id: orderId, orderId, codeHash: pickupCodeHash(plainCode, pickupSecret), status: "ACTIVE", expiresAt: iso(new Date(now.valueOf() + 86_400_000)) }));
        windowRecords.push(toEntityRecord("windows", orderId, { id: orderId, orderId, deliveryPlanId: planId, arrivedAt: iso(now), deadlineAt: iso(new Date(now.valueOf() + 86_400_000)), status: "ACTIVE", extensionCount: 0 }));
      }
      if (orderRecords.length >= PAGE) {
        await insertBatch(orderRecords); await insertBatch(lineRecords); await insertBatch(paymentRecords);
        await insertBatch(ledgerRecords); await insertBatch(notificationRecords); await insertBatch(receiptRecords);
        await insertBatch(pickupRecords); await insertBatch(credentialRecords); await insertBatch(windowRecords);
        orderRecords = []; lineRecords = []; paymentRecords = []; ledgerRecords = []; notificationRecords = [];
        receiptRecords = []; pickupRecords = []; credentialRecords = []; windowRecords = [];
        if (index % 10_000 === PAGE - 1) process.stdout.write(`seeded ${index + 1}/${ORDER_COUNT} orders\n`);
      }
    }
    await insertBatch(orderRecords); await insertBatch(lineRecords); await insertBatch(paymentRecords);
    await insertBatch(ledgerRecords); await insertBatch(notificationRecords); await insertBatch(receiptRecords);
    await insertBatch(pickupRecords); await insertBatch(credentialRecords); await insertBatch(windowRecords);
    const richRecords = await richSampleRecords(iso(start), iso(new Date(start.valueOf() + 60_000)), iso(new Date(start.valueOf() + DAYS * 86_400_000)));
    await insertBatch(richRecords);
    const richRelations = richRecords.flatMap((record) => entityRecordRelations(record).map(([name, target]) => [record.collection, record.entityKey, name, target] as const));
    if (richRelations.length) await connection.execute(
      `INSERT INTO community_entity_relations(source_collection,source_key,source_key_sha256,relation_name,target_key,target_key_sha256) VALUES ${richRelations.map(() => "(?,?,?,?,?,?)").join(",")}`,
      richRelations.flatMap(([collection, sourceKey, name, targetKey]) => [collection, sourceKey, digest(sourceKey), name, targetKey, digest(targetKey)]),
    );
    await connection.execute("UPDATE community_entity_store_state SET mode='ENTITY' WHERE id=1 AND mode='LEGACY' AND entity_write_count=0");
    const [totals] = await connection.query<RowDataPacket[]>(
      "SELECT collection,COUNT(*) AS total FROM community_entity_records GROUP BY collection ORDER BY collection",
    );
    const [storage] = await connection.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(data_length),0) AS data_bytes,COALESCE(SUM(index_length),0) AS index_bytes FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('community_entity_records','community_entity_relations')",
    );
    process.stdout.write(JSON.stringify({ phase: "seeded", orders: ORDER_COUNT, targetScale: "50 points x 30 orders/day x 90 days", completedOrders: completedCount, readyForPickupOrders: readyCount, rowsInserted: inserted, collections: totals, estimatedTableDataBytes: Number(storage[0]?.data_bytes ?? 0), estimatedTableIndexBytes: Number(storage[0]?.index_bytes ?? 0), state: "ENTITY" }) + "\n");
  } finally { await connection.end(); }
} else if (phase === "explain") {
  try {
    const [stateRows] = await connection.query<RowDataPacket[]>("SELECT mode FROM community_entity_store_state WHERE id=1");
    const [baseline] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_records WHERE collection='orders' AND entity_key='capacity-order-0000000'");
    const [orderRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_records WHERE collection='orders' AND entity_key LIKE 'capacity-order-%'");
    if (stateRows[0]?.mode !== "ENTITY" || Number(baseline[0]?.total) !== 1 || Number(orderRows[0]?.total) < REQUIRED_ORDER_COUNT)
      throw new Error(`EXPLAIN requires ENTITY mode and at least ${REQUIRED_ORDER_COUNT} identified baseline capacity orders`);
    const probes: Array<[string, string, unknown[]]> = [
      ["order-search", "SELECT o.entity_key,o.document FROM community_entity_records o WHERE o.collection='orders' AND o.record_status=? AND o.lookup_c=? ORDER BY o.created_at DESC,o.entity_key DESC LIMIT 100", ["COMPLETED", "capacity-point-00"]],
      ["dashboard-live-order-count", `SELECT COUNT(*) AS total FROM community_entity_records FORCE INDEX (ix_community_entity_status_created) WHERE collection='orders' AND record_status IN (${orderStatusesExcept(["COMPLETED", "CANCELLED", "REFUNDED"]).map(() => "?").join(",")})`, orderStatusesExcept(["COMPLETED", "CANCELLED", "REFUNDED"])],
      ["historical-completed-count", "SELECT COUNT(*) AS total FROM community_entity_records FORCE INDEX (ix_community_entity_status_created) WHERE collection='orders' AND record_status IN (?)", ["COMPLETED"]],
      ["admin-order-default-page", "SELECT collection,entity_key,document FROM community_entity_records WHERE collection='orders' ORDER BY created_at DESC,entity_key DESC LIMIT 20", []],
      ["public-open-campaigns", "SELECT collection,entity_key,document FROM community_entity_records WHERE collection='campaigns' AND record_status IN ('OPEN') ORDER BY entity_key ASC", []],
      ["pickup-point-order-list", "SELECT r.entity_key,r.document,o.entity_key,o.document FROM community_entity_records r JOIN community_entity_records o ON o.entity_key=r.lookup_a AND o.collection='orders' WHERE r.collection='pickupReceipts' AND o.lookup_c=? ORDER BY r.created_at DESC,r.entity_key DESC LIMIT 100", ["capacity-point-00"]],
      ["pickup-code-candidates", "SELECT o.entity_key FROM community_entity_records o JOIN community_entity_records c ON c.collection='pickupCredentials' AND c.lookup_a=o.entity_key JOIN community_entity_records p ON p.collection='plans' AND p.entity_key=o.lookup_f JOIN community_entity_records w ON w.collection='windows' AND w.entity_key=o.entity_key WHERE o.collection='orders' AND o.lookup_c=? AND o.record_status='READY_FOR_PICKUP' AND c.lookup_b=? AND c.record_status='ACTIVE' AND c.due_at>UTC_TIMESTAMP(3) AND p.lookup_b=? AND p.record_status='ARRIVED' AND w.record_status IN ('ACTIVE','EXTENDED') AND w.due_at>UTC_TIMESTAMP(3) ORDER BY o.entity_key LIMIT 2", ["capacity-point-00", "synthetic-explain-code-hash", "capacity-point-00"]],
      ["expiry-retry-queue", "SELECT entity_key,document FROM community_entity_records WHERE collection='notifications' AND record_status='PENDING_DELIVERY' AND provider_started_at IS NULL AND (retry_at IS NULL OR retry_at<=UTC_TIMESTAMP(3)) AND (lease_until IS NULL OR lease_until<=UTC_TIMESTAMP(3)) ORDER BY COALESCE(retry_at,created_at),created_at,entity_key LIMIT 5", []],
      ["sales-aggregation", "SELECT l.lookup_c AS skuId,SUM(CASE WHEN o.record_status='REFUNDED' OR r.entity_key IS NOT NULL THEN 0 ELSE GREATEST(0,COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(l.document,'$.quantity')) AS SIGNED),0)-COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(l.document,'$.refundedQuantity')) AS SIGNED),0)) END) AS quantity FROM community_entity_records l JOIN community_entity_records o ON o.collection='orders' AND o.entity_key=l.lookup_a LEFT JOIN community_entity_records r ON r.collection='orderRefunds' AND r.lookup_a=o.entity_key AND r.record_status='SUCCEEDED' WHERE l.collection='lines' AND o.paid_at IS NOT NULL AND o.record_status NOT IN ('PENDING_PAYMENT','CANCELLED') AND o.lookup_b=? GROUP BY l.lookup_c", ["capacity-campaign-0-89"]],
    ];
    const output = [];
    for (const [name, sql, values] of probes) {
      const [rows] = await connection.execute<RowDataPacket[]>(`EXPLAIN FORMAT=JSON ${sql}`, values);
      output.push({ name, sql, plan: rows[0]?.EXPLAIN ?? rows[0]?.explain ?? rows[0] });
    }
    process.stdout.write(JSON.stringify({ phase: "explained", database: "identified synthetic capacity schema", probes: output }) + "\n");
  } finally { await connection.end(); }
} else {
  if (!process.env.SINGLE_WRITER_CONFIRMED || process.env.SINGLE_WRITER_CONFIRMED !== "true")
    throw new Error("Measure requires SINGLE_WRITER_CONFIRMED=true on the isolated test schema");
  const [stateRows] = await connection.query<RowDataPacket[]>("SELECT mode FROM community_entity_store_state WHERE id=1");
  const [orderRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_records WHERE collection='orders' AND entity_key LIKE 'capacity-order-%'");
  if (stateRows[0]?.mode !== "ENTITY" || Number(orderRows[0]?.total) < REQUIRED_ORDER_COUNT)
    throw new Error(`Measure expects ENTITY mode and at least ${REQUIRED_ORDER_COUNT} baseline capacity orders`);
  const pointId = "capacity-point-00";
  const area: ServiceArea = { id: "capacity-area-entity", regionCode: "110101", name: "Synthetic capacity area", status: "ENABLED", orderEnabled: true, createdAt: new Date().toISOString() };
  const [readyRows] = await connection.query<RowDataPacket[]>("SELECT entity_key FROM community_entity_records WHERE collection='orders' AND entity_key LIKE 'capacity-order-%' AND lookup_c=? AND record_status='READY_FOR_PICKUP' ORDER BY entity_key LIMIT 105", [pointId]);
  if (readyRows.length !== 105) throw new Error("Capacity measure requires 105 unique ready orders assigned to capacity-point-00");
  const readyOrderIds = readyRows.map((row) => String(row.entity_key));
  const [expectedCountRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_records WHERE collection='orders' AND record_status IN ('COMPLETED')");
  const expectedCompletedOrders = Number(expectedCountRows[0]?.total ?? 0);
  // Independent plain-SQL counts for the admin dashboard assertion.
  const plainCount = async (predicate: string): Promise<number> => {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM community_entity_records WHERE collection='orders' AND ${predicate}`);
    return Number(rows[0]?.total ?? 0);
  };
  const expectedDashboard = {
    pendingOrders: await plainCount("record_status NOT IN ('COMPLETED','CANCELLED','REFUNDED')"),
    stages: [
      await plainCount("record_status='PAID_WAITING_CLOSE'"),
      await plainCount("record_status IN ('LOCKED','ALLOCATING','IN_TRANSIT')"),
      await plainCount("record_status='READY_FOR_PICKUP'"),
      await plainCount("record_status='REFUNDING'"),
    ],
  };
  const [totalOrderRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_records WHERE collection='orders'");
  const expectedTotalOrders = Number(totalOrderRows[0]?.total ?? 0);
  const [expectedSalesRows] = await connection.execute<RowDataPacket[]>(
    "SELECT l.lookup_c AS skuId,l.document AS lineDocument,o.document AS orderDocument,o.record_status AS orderStatus,r.entity_key AS refundId FROM community_entity_records l JOIN community_entity_records o ON o.collection='orders' AND o.entity_key=l.lookup_a LEFT JOIN community_entity_records r ON r.collection='orderRefunds' AND r.lookup_a=o.entity_key AND r.record_status='SUCCEEDED' WHERE l.collection='lines' AND o.paid_at IS NOT NULL AND o.record_status NOT IN ('PENDING_PAYMENT','CANCELLED') AND o.lookup_b=?",
    [`capacity-campaign-0-${DAYS - 1}`],
  );
  const expectedSales = new Map<string, number>();
  for (const row of expectedSalesRows) {
    if (row.orderStatus === "REFUNDED" || row.refundId) continue;
    const line = documentFromRow(row.lineDocument);
    const quantity = Math.max(0, Number(line.quantity ?? 0) - Number(line.refundedQuantity ?? 0));
    const skuId = String(row.skuId);
    expectedSales.set(skuId, (expectedSales.get(skuId) ?? 0) + quantity);
  }
  await connection.end();
  const started = Date.now();
  let peakRss = process.memoryUsage().rss;
  const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 50);
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  const pathReports: Array<Record<string, unknown>> = [];
  let generatedOrders: Order[] = [];
  let lookupCodes: string[] = [];
  let applicationStore: MysqlStore | null = null;
  // gate=false marks a diagnostic probe that no business route executes; it is
  // reported but excluded from the 500 ms acceptance gate.
  const executePath = async <T>(name: string, values: T[], operation: (value: T) => Promise<unknown>, requestCount = 1, gate = true): Promise<unknown[]> => {
    if (values.length !== warmupCount + sampleCount) throw new Error(`${name} must have ${warmupCount} warmups and ${sampleCount} measured samples`);
    const timings = Array(values.length).fill(0) as number[];
    const outputs = Array(values.length).fill(undefined) as unknown[];
    const failures: Array<{ index: number; error: string }> = [];
    const runBatch = async (startIndex: number, count: number): Promise<number> => {
      let nextIndex = startIndex;
      const batchEnd = startIndex + count;
      const worker = async () => {
        while (true) {
          const index = nextIndex++;
          if (index >= batchEnd) return;
          const begin = performance.now();
          try { outputs[index] = await operation(values[index]!); }
          catch (error) { failures.push({ index, error: error instanceof Error ? error.message : String(error) }); }
          timings[index] = performance.now() - begin;
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
        }
      };
      const batchStart = performance.now();
      await Promise.all(Array.from({ length: Math.min(concurrency, count) }, () => worker()));
      return performance.now() - batchStart;
    };
    await runBatch(0, warmupCount);
    const measuredWallMs = Math.max(1, await runBatch(warmupCount, sampleCount));
    const measured = timings.slice(warmupCount);
    const measuredFailures = failures.filter(({ index }) => index >= warmupCount);
    const measuredMs = measured.reduce((sum, value) => sum + value, 0);
    const pathReport = {
      name, gate, concurrency, warmups: warmupCount, warmupOutputs: outputs.slice(0, warmupCount).filter((value) => value !== undefined).length,
      samples: sampleCount, measuredOutputs: outputs.slice(warmupCount).filter((value) => value !== undefined).length,
      totalOutputs: outputs.filter((value) => value !== undefined).length, failures: measuredFailures.length,
      failureRate: measuredFailures.length / sampleCount, elapsedWindowMs: measuredWallMs,
      qps: sampleCount / (measuredWallMs / 1000), rps: sampleCount * requestCount / (measuredWallMs / 1000),
      meanMs: measuredMs / sampleCount, p95Ms: percent(measured, 0.95), p99Ms: percent(measured, 0.99),
      warmupFailures: failures.filter(({ index }) => index < warmupCount).length,
      failureSamples: measuredFailures.slice(0, 5),
    };
    pathReports.push(pathReport);
    process.stdout.write(JSON.stringify({
      phase: "path", name, gate, warmups: warmupCount, samples: sampleCount,
      failures: pathReport.failures, warmupFailures: pathReport.warmupFailures,
      elapsedWindowMs: pathReport.elapsedWindowMs, qps: pathReport.qps, rps: pathReport.rps,
      meanMs: pathReport.meanMs, p95Ms: pathReport.p95Ms, p99Ms: pathReport.p99Ms,
      peakRssBytes: peakRss,
    }) + "\n");
    return outputs;
  };
  const store = MysqlStore.create(databaseUrl);
  try {
    await executePath("pickup-code-candidate", readyOrderIds.map((orderId) => ({ orderId, hash: pickupCodeHash(pickupCode(orderId, pickupSecret), pickupSecret) })), async ({ orderId, hash }) => {
      const candidates = await store.listPickupCodeCandidates(pointId, hash);
      if (candidates.length !== 1 || candidates[0]?.order.id !== orderId) throw new Error("EntityStore pickup code candidate did not resolve the exact requested ready order");
      return candidates[0];
    });
    await executePath("order-search-page", Array.from({ length: 105 }, () => undefined), async () => {
      const page = await store.searchOrders({ status: "COMPLETED", pickupPointId: pointId, page: 1, pageSize: 100 });
      if (page.items.length !== 100 || page.total < 100) throw new Error("Order search did not return 100 matching synthetic records");
      return page;
    });
    // Diagnostic only: counting all historical COMPLETED orders is not executed
    // by any route (the dashboard counts live statuses; see admin-dashboard).
    await executePath("historical-completed-count", Array.from({ length: 105 }, () => undefined), async () => {
      const result = await store.countOrdersByStatus(["COMPLETED"]);
      if (result !== expectedCompletedOrders) throw new Error(`Order status count ${result} did not match independently counted ${expectedCompletedOrders}`);
      return result;
    }, 1, false);
    await executePath("campaign-net-sales", Array.from({ length: 105 }, () => undefined), async () => {
      const sales = await store.getNetSalesQuantities(`capacity-campaign-0-${DAYS - 1}`);
      if (sales.size !== expectedSales.size || [...expectedSales].some(([skuId, quantity]) => sales.get(skuId) !== quantity))
        throw new Error("Campaign net sales did not match quantities independently recomputed from linked order/line/refund documents");
      return Object.fromEntries(sales);
    });
    await executePath("serialized-store-write", Array.from({ length: 105 }, (_, index) => index), async (index) => {
      await store.transaction(async (tx) => tx.saveServiceArea({ ...area, orderEnabled: index % 2 === 0 }));
      return true;
    });
    // Concurrent completion order is intentionally unspecified; restore the
    // synthetic area before the later HTTP order-create path uses it.
    await store.transaction(async (tx) => tx.saveServiceArea({ ...area, orderEnabled: true }));
    await store.close();

    const authStore = MysqlStore.create(databaseUrl);
    applicationStore = authStore;
    app = await buildApp({
      store: authStore,
      config: loadConfig({ NODE_ENV: "test", AUTH_PROVIDER: "wechat", WECHAT_APP_ID: "synthetic-capacity-app", WECHAT_APP_SECRET: "synthetic-unused-secret", PRIVACY_NOTICE_VERSION: capacityPrivacyVersion, DATA_STORE: "mysql", DATABASE_URL: databaseUrl, PAYMENT_PROVIDER: "mock", PICKUP_CODE_SECRET: pickupSecret, SINGLE_WRITER_CONFIRMED: "true", RATE_LIMIT_MAX: "10000", LOG_LEVEL: "silent" }),
      subscriptionMessageProvider: { send: async () => { throw new Error("External notification provider is forbidden by the isolated capacity harness"); } },
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const listenAddress = app.server.address();
    if (!listenAddress || typeof listenAddress === "string") throw new Error("Capacity API did not bind a local HTTP socket");
    const apiBaseUrl = `http://127.0.0.1:${listenAddress.port}`;
    const request = async (method: "GET" | "POST", url: string, token: string | null, payload?: unknown, idempotencyKey?: string) => {
      const response = await fetch(new URL(url, apiBaseUrl), {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      const body = await response.text();
      let bodyJson: unknown;
      try { bodyJson = JSON.parse(body); } catch { bodyJson = null; }
      return { statusCode: response.status, body, json: () => bodyJson as Record<string, unknown> };
    };
    const userTokenForOrder = (index: number) => capacityCustomerToken(index % Math.min(1500, Math.max(30, Math.ceil(ORDER_COUNT / 90))));
    await executePath("authenticated-order-list", Array.from({ length: 105 }, () => undefined), async () => {
      const response = await request("GET", "/api/v1/orders", capacityCustomerToken(1));
      if (response.statusCode !== 200) throw new Error(`Order list returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const body = response.json().data as unknown[];
      if (!Array.isArray(body) || !body.some((item) => (item as { id?: string }).id === "capacity-order-0000001")) throw new Error("Authenticated order list omitted its known synthetic order");
      return body.length;
    });
    await executePath("authenticated-order-status-read", Array.from({ length: 105 }, () => undefined), async () => {
      const response = await request("GET", "/api/v1/orders/capacity-enrich-partial-order", capacityCustomerToken(1));
      if (response.statusCode !== 200) throw new Error(`Order detail returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const order = response.json().data as Order;
      if (order.id !== "capacity-enrich-partial-order" || order.status !== "READY_FOR_PICKUP" || order.items.length !== 2 || order.totalCents !== 1500)
        throw new Error("Order detail failed status, two-line, or total assertion");
      return { id: order.id, status: order.status, itemCount: order.items.length, totalCents: order.totalCents };
    });
    await executePath("authenticated-payment-checkout-status-read", Array.from({ length: 105 }, () => undefined), async () => {
      const response = await request("GET", "/api/v1/order-checkouts/capacity-enrich-checkout-partial", capacityCustomerToken(1));
      if (response.statusCode !== 200) throw new Error(`Checkout status returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const value = response.json().data as { checkoutBatch?: { id: string; status: string; totalCents: number }; orders?: Order[] };
      if (value.checkoutBatch?.status !== "PAID" || value.checkoutBatch.totalCents !== 1500 || value.orders?.[0]?.status !== "READY_FOR_PICKUP")
        throw new Error("Checkout/payment status response did not match the synthetic paid batch");
      return value.checkoutBatch;
    });
    await executePath("consumer-home-campaigns", Array.from({ length: 105 }, () => undefined), async () => {
      const response = await request("GET", "/api/v1/campaigns", null);
      if (response.statusCode !== 200) throw new Error(`Public campaigns returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const data = response.json().data as Array<{ id: string; items: unknown[] }>;
      if (data.length !== POINTS || data.some((campaign) => !campaign.items.length)) throw new Error(`Public campaigns returned ${data.length}, expected ${POINTS} open campaigns with items`);
      return data.length;
    });
    await executePath("consumer-campaign-detail", Array.from({ length: 105 }, (_, index) => openCampaignId(index % POINTS)), async (id) => {
      const response = await request("GET", `/api/v1/campaigns/${encodeURIComponent(id)}`, null);
      if (response.statusCode !== 200) throw new Error(`Campaign detail returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const campaign = response.json().data as { id: string; items: unknown[] };
      if (campaign.id !== id || !campaign.items.length) throw new Error("Campaign detail returned the wrong campaign or no items");
      return campaign.id;
    });
    await executePath("admin-dashboard", Array.from({ length: 105 }, () => undefined), async () => {
      const response = await request("GET", "/api/v1/admin/dashboard", capacityOperatorToken);
      if (response.statusCode !== 200) throw new Error(`Dashboard returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const data = response.json().data as { pendingOrders: number; stages: Array<{ count: number }> };
      if (data.pendingOrders !== expectedDashboard.pendingOrders || data.stages.map((stage) => stage.count).join() !== expectedDashboard.stages.join())
        throw new Error(`Dashboard counts ${JSON.stringify(data)} did not match independent SQL ${JSON.stringify(expectedDashboard)}`);
      return data.pendingOrders;
    });
    await executePath("admin-order-search-default", Array.from({ length: 105 }, () => undefined), async () => {
      const response = await request("GET", "/api/v1/admin/orders/search?page=1&pageSize=20", capacityOperatorToken);
      if (response.statusCode !== 200) throw new Error(`Admin order search returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const data = response.json().data as { items: unknown[]; total: number };
      if (data.items.length !== 20 || data.total !== expectedTotalOrders) throw new Error(`Admin order search returned ${data.items.length}/${data.total}, expected 20/${expectedTotalOrders}`);
      return data.total;
    });
    const campaignId = openCampaignId(0);
    const requestBody = { campaignId, serviceAreaId: "capacity-area-entity", pickupPointId: pointId, items: [{ skuId: "capacity-sku-entity", quantity: 1 }] };
    const createSamples = Array.from({ length: 105 }, (_, index) => ({ index, idempotencyKey: `entity-capacity-${randomUUID()}` }));
    const createdResults = await executePath("order-create", createSamples, async ({ idempotencyKey }) => {
      const response = await request("POST", "/api/v1/orders", capacityCustomerToken(1), requestBody, idempotencyKey);
      if (response.statusCode !== 201) throw new Error(`Order create returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const order = response.json().data as Order;
      if (!order.id || order.totalCents !== AMOUNT_CENTS || order.items.length !== 1 || order.items[0]?.quantity !== 1) throw new Error("Created order failed id, amount, or item assertions");
      return order;
    });
    generatedOrders = createdResults.filter((value): value is Order => Boolean(value && typeof value === "object" && "id" in value)) as Order[];
    const paymentSamples = generatedOrders.slice(0, 105);
    const paymentResults = await executePath("mock-payment-initiation", paymentSamples, async (order) => {
      const response = await request("POST", `/api/v1/orders/${encodeURIComponent(order.id)}/pay`, capacityCustomerToken(1));
      const payment = response.json().data as { status?: string } | undefined;
      if (response.statusCode !== 200 || payment?.status !== "CREATED") throw new Error(`Mock payment returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      return { orderId: order.id, status: payment.status };
    });
    const codeResults = await executePath("pickup-code-issue", readyOrderIds, async (orderId) => {
      const suffix = Number(orderId.slice("capacity-order-".length));
      const response = await request("GET", `/api/v1/pickup-code?orderId=${encodeURIComponent(orderId)}`, userTokenForOrder(suffix));
      const pickupCodeResult = response.json().data as { code?: unknown } | undefined;
      if (response.statusCode !== 200 || typeof pickupCodeResult?.code !== "string") throw new Error(`Pickup code issue returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      return pickupCodeResult.code;
    });
    lookupCodes = codeResults.map((value) => typeof value === "string" ? value : "");
    const managerLookups = await executePath("pickup-manager-order-lookup", readyOrderIds.map((orderId, index) => ({ orderId, code: lookupCodes[index] })), async ({ orderId, code }) => {
      const response = await request("POST", "/api/v1/pickup/orders/lookup", capacityManagerToken, { pickupPointId: pointId, code });
      if (response.statusCode !== 200) throw new Error(`Pickup manager lookup returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const order = response.json().data as { id?: string; status?: string; items?: unknown[] };
      if (order.id !== orderId || order.status !== "READY_FOR_PICKUP" || !order.items?.length) throw new Error("Pickup manager lookup returned the wrong order or incomplete item view");
      return order;
    });
    const verifySamples = readyOrderIds.map((orderId, index) => ({ orderId, code: lookupCodes[index]!, pickupRequestId: randomUUID() }));
    const pickupVerifications = await executePath("pickup-verify", verifySamples, async ({ orderId, code, pickupRequestId }) => {
      const suffix = Number(orderId.slice("capacity-order-".length));
      const sampleSlot = Math.floor(suffix * TOTAL_SLOTS / ORDER_COUNT);
      const planId = `capacity-plan-${Math.floor(sampleSlot / (DAYS * ORDERS_PER_POINT_DAY))}-${Math.floor((sampleSlot % (DAYS * ORDERS_PER_POINT_DAY)) / ORDERS_PER_POINT_DAY)}`;
      const response = await request("POST", "/api/v1/pickup/verify", capacityManagerToken, { orderId, deliveryPlanId: planId, code, pickupRequestId, items: [{ catalogSkuId: "capacity-sku-entity", quantity: 1 }] });
      if (response.statusCode !== 200) throw new Error(`Pickup verify returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const verifiedOrder = response.json().data as Order;
      const verifiedLine = verifiedOrder.items.find((item) => item.skuId === "capacity-sku-entity");
      if (verifiedOrder.id !== orderId || verifiedOrder.status !== "COMPLETED" || verifiedLine?.pickedUpQuantity !== 1 || verifiedLine.fulfilledQuantity !== 1)
        throw new Error("Pickup verify response did not identify the requested order and fully picked line");
      return verifiedOrder;
    });
    const receiptConnection = await mysql.createConnection({ uri: databaseUrl, jsonStrings: true, timezone: "Z" });
    let verifiedReceiptCount = 0;
    try {
      const verifiedIds = verifySamples.slice(warmupCount).map(({ orderId }) => orderId);
      const [receiptRows] = await receiptConnection.execute<RowDataPacket[]>(
        `SELECT lookup_a AS orderId,document FROM community_entity_records WHERE collection='pickupReceipts' AND lookup_a IN (${verifiedIds.map(() => "?").join(",")})`,
        verifiedIds,
      );
      const receiptsByOrder = new Map(receiptRows.map((row) => [String(row.orderId), documentFromRow(row.document)]));
      for (const orderId of verifiedIds) {
        const receipt = receiptsByOrder.get(orderId);
        const receiptItems = Array.isArray(receipt?.items) ? receipt.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
        if (!receipt || receipt.orderId !== orderId || !receiptItems.some((item) => item.catalogSkuId === "capacity-sku-entity" && Number(item.quantity) === 1))
          throw new Error(`Pickup receipt is missing or mismatched for verified order ${orderId}`);
      }
      verifiedReceiptCount = receiptsByOrder.size;
      if (verifiedReceiptCount !== sampleCount) throw new Error(`Expected ${sampleCount} unique pickup receipts; found ${verifiedReceiptCount}`);
    } finally { await receiptConnection.end(); }
    const authorizedPickupPoints = await applicationStore!.listStaffPickupPointAssignments("capacity-manager");
    const authorizedPointIds = [...new Set(authorizedPickupPoints.map(({ pickupPointId }) => pickupPointId))];
    if (!authorizedPointIds.includes(pointId)) throw new Error("Synthetic pickup manager is not assigned to the expected point");
    const expectedReceiptPage = await applicationStore!.listPickupReceiptOrderPage(authorizedPointIds, undefined, 1, 100);
    const deniedReceiptResponse = await request("GET", "/api/v1/pickup/records?page=1&pageSize=100", capacityOperatorToken);
    if (deniedReceiptResponse.statusCode !== 403) throw new Error(`Pickup records accepted a non-manager actor: ${deniedReceiptResponse.statusCode}`);
    await executePath("pickup-point-order-page", Array.from({ length: warmupCount + sampleCount }, () => undefined), async () => {
      const response = await request("GET", "/api/v1/pickup/records?page=1&pageSize=100", capacityManagerToken);
      if (response.statusCode !== 200) throw new Error(`Pickup point order list returned ${response.statusCode}: ${response.body.slice(0, 300)}`);
      const result = response.json() as { data?: Array<{ id: string; orderNo: string; pickupPointId: string }>; pagination?: { total: number; page: number; pageSize: number } };
      const actualRows = result.data ?? [];
      const expectedRows = expectedReceiptPage.items.map(({ receipt, order }) => ({ id: receipt.id, orderNo: order.orderNo, pickupPointId: order.pickupPointId }));
      if (actualRows.length !== 100 || result.pagination?.total !== expectedReceiptPage.total || result.pagination.page !== 1 || result.pagination.pageSize !== 100)
        throw new Error("Pickup point order list returned an unexpected page or total");
      if (actualRows.some((row, index) => row.id !== expectedRows[index]?.id || row.orderNo !== expectedRows[index]?.orderNo ||
          row.pickupPointId !== expectedRows[index]?.pickupPointId || !authorizedPointIds.includes(row.pickupPointId)))
        throw new Error("Pickup point order list returned a wrong receipt/order or a point outside the manager assignment scope");
      return actualRows.length;
    });
    const failedPaths = pathReports.filter((path) => Number(path.failures) > 0 || Number(path.warmupFailures) > 0);
    const within300MiB = peakRss < 300 * 1024 * 1024;
    const within500ms = pathReports.filter((path) => path.gate).every((path) => Number(path.p95Ms) < 500);
    const report = {
      phase: "measured", orders: ORDER_COUNT, concurrency, warmupCount, measuredSamplesPerPath: sampleCount,
      httpTransport: "Fastify listener on 127.0.0.1 with ephemeral port; requests sent with fetch",
      resultAssertions: { candidateOrder: "exact input order id", searchRows: 100, receiptRows: 100, twoLineOrderTotalCents: 1500, checkoutStatus: "PAID", managerLookup: "order id/status/items matched", verifiedOrderAndLine: "id/status/picked quantity matched", verifiedPickupCount: pickupVerifications.filter(Boolean).length, persistedPickupReceiptCount: verifiedReceiptCount, orderCountMatchesIndependentCount: true, campaignSalesMatchIndependentLinkedDocuments: true, dashboardMatchesIndependentCounts: true, publicOpenCampaigns: POINTS, adminOrderTotal: expectedTotalOrders },
      paths: pathReports, failures: failedPaths.length,
      peakRssBytes: peakRss, within300MiB, within500ms,
      elapsedMs: Date.now() - started,
      syntheticCallCounts: {
        total: { createdOrders: generatedOrders.length, issuedPickupCodes: lookupCodes.filter(Boolean).length, managerLookups: managerLookups.filter(Boolean).length, pickupVerifications: pickupVerifications.filter(Boolean).length },
        measured: {
          createdOrders: createdResults.slice(warmupCount).filter(Boolean).length,
          issuedPickupCodes: codeResults.slice(warmupCount).filter(Boolean).length,
          managerLookups: managerLookups.slice(warmupCount).filter(Boolean).length,
          pickupVerifications: pickupVerifications.slice(warmupCount).filter(Boolean).length,
        },
      },
      syntheticWrites: {
        createdOrders: { warmups: createdResults.slice(0, warmupCount).filter(Boolean).length, measured: createdResults.slice(warmupCount).filter(Boolean).length, total: createdResults.filter(Boolean).length },
        paymentInitiations: { warmups: paymentResults.slice(0, warmupCount).filter(Boolean).length, measured: paymentResults.slice(warmupCount).filter(Boolean).length, total: paymentResults.filter(Boolean).length },
        pickupVerifications: { warmups: pickupVerifications.slice(0, warmupCount).filter(Boolean).length, measured: pickupVerifications.slice(warmupCount).filter(Boolean).length, total: pickupVerifications.filter(Boolean).length },
      },
      caveat: "Requests traverse a local HTTP socket and use the real Entity MySQL Store; runner must separately verify container peak RSS/OOM and preserve the benchmark receipt.",
    };
    process.stdout.write(JSON.stringify(report) + "\n");
    const totalOperations = warmupCount + sampleCount;
    const measuredWrites = {
      createdOrders: createdResults.slice(warmupCount).filter(Boolean).length,
      issuedPickupCodes: codeResults.slice(warmupCount).filter(Boolean).length,
      managerLookups: managerLookups.slice(warmupCount).filter(Boolean).length,
      pickupVerifications: pickupVerifications.slice(warmupCount).filter(Boolean).length,
    };
    if (!within300MiB || !within500ms || failedPaths.length || generatedOrders.length !== totalOperations || paymentResults.filter(Boolean).length !== totalOperations ||
        codeResults.filter(Boolean).length !== totalOperations || managerLookups.filter(Boolean).length !== totalOperations || pickupVerifications.filter(Boolean).length !== totalOperations ||
        Object.values(measuredWrites).some((count) => count !== sampleCount))
      process.exitCode = 1;
  } finally {
    clearInterval(sample);
    await app?.close().catch(() => undefined);
    await applicationStore?.close().catch(() => undefined);
    await store.close().catch(() => undefined);
  }
}
