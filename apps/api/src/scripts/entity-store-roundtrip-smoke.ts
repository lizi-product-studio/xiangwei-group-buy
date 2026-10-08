import { randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { MysqlStore } from "../modules/core/mysql-store.js";
import { MemoryStore } from "../modules/core/store.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Round-trip smoke test requires DATABASE_URL");
if (process.env.ENTITY_STORE_TARGET !== "isolated-test")
  throw new Error("Round-trip smoke test only runs with ENTITY_STORE_TARGET=isolated-test");
if (process.env.ENTITY_STORE_SYNTHETIC_CONFIRM !== "true")
  throw new Error("Set ENTITY_STORE_SYNTHETIC_CONFIRM=true only for a dedicated synthetic database");
const dbHost = new URL(databaseUrl).hostname;
if (dbHost === "192.144.136.205") throw new Error("Refusing to run the synthetic round-trip test against production");

const migrationScript = fileURLToPath(new URL("./entity-store-migration.ts", import.meta.url));
const schemaMigrationScript = fileURLToPath(new URL("./migrate.ts", import.meta.url));
function completedPhaseWrapper(script: string, args: string[], label: string): string {
  return [
    `process.argv = [process.execPath, ${JSON.stringify(script)}, ...${JSON.stringify(args)}];`,
    `await import(${JSON.stringify(pathToFileURL(script).href)});`,
    `if (process.exitCode) process.exit(process.exitCode);`,
    `process.stdout.write(${JSON.stringify(`SMOKE_PHASE_COMPLETE:${label}`)} + "\\n");`,
    "setInterval(() => {}, 1000);",
  ].join("\n");
}
async function interruptAfterCompletedPhase(script: string, args: string[], label: string, env: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", completedPhaseWrapper(script, args, label)], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let output = "";
  let markerSeen = false;
  let killedAfterCompletion = false;
  const append = (chunk: string) => { output = `${output}${chunk}`.slice(-256_000); };
  child.stdout.on("data", (chunk: string) => {
    append(chunk);
    if (!markerSeen && output.includes(`SMOKE_PHASE_COMPLETE:${label}`)) {
      markerSeen = true;
      setTimeout(() => { killedAfterCompletion = child.kill("SIGKILL"); }, 100);
    }
  });
  child.stderr.on("data", append);
  const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timeout));
  if (!markerSeen || !killedAfterCompletion || exit.signal !== "SIGKILL")
    throw new Error(`Could not SIGKILL after the ${label} completion marker: ${output.slice(-2000)}`);
  return output;
}
const migrationEnvironment = (command: "prepare" | "verify" | "activate" | "rollback") => ({
  ...process.env,
  ENTITY_STORE_TARGET: "isolated-test",
  ...(command === "activate" ? { SINGLE_WRITER_CONFIRMED: "true" } : {}),
  ...(command === "rollback" ? { ENTITY_STORE_WRITER_FROZEN: "true" } : {}),
});
const runMigration = (command: "prepare" | "verify" | "activate" | "rollback"): void => {
  execFileSync(process.execPath, ["--import", "tsx", migrationScript, command], {
    env: migrationEnvironment(command),
    stdio: "inherit",
  });
};
const runSchemaMigrations = (): void => {
  execFileSync(process.execPath, ["--import", "tsx", schemaMigrationScript], { env: process.env, stdio: "inherit" });
};
function runMigrationExpectingFailure(command: "prepare" | "verify"): string {
  const result = spawnSync(process.execPath, ["--import", "tsx", migrationScript, command], {
    env: migrationEnvironment(command), encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) throw new Error(`Synthetic ${command} unexpectedly accepted misattributed entity data`);
  return output;
}
async function interruptPrepareAfterFirstUserPage(): Promise<void> {
  const child = spawn(process.execPath, ["--import", "tsx", migrationScript, "prepare"], {
    env: migrationEnvironment("prepare"), stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let output = "";
  let killedAtCheckpoint = false;
  child.stdout.on("data", (chunk: string) => {
    output += chunk;
    if (!killedAtCheckpoint && output.includes("users: 200 rows")) {
      killedAtCheckpoint = true;
      child.kill("SIGKILL");
    }
  });
  child.stderr.on("data", (chunk: string) => { output += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timeout));
  if (!killedAtCheckpoint || exit.signal !== "SIGKILL")
    throw new Error(`Could not interrupt migration after the first committed users page: ${output.slice(-1500)}`);
  const [journals] = await connection.execute<RowDataPacket[]>(
    "SELECT state,last_source_ordinal,processed_count FROM community_entity_migration_journal WHERE collection='users'",
  );
  const checkpoint = Number(journals[0]?.last_source_ordinal ?? 0);
  if (journals[0]?.state !== "RUNNING" || checkpoint < 200 || checkpoint >= 5001 || Number(journals[0]?.processed_count) !== checkpoint)
    throw new Error(`Interrupted migration did not retain its committed users checkpoint: ${JSON.stringify(journals[0] ?? null)}`);
}

const connection = await mysql.createConnection({ uri: databaseUrl, jsonStrings: true, timezone: "Z" });
let store: MysqlStore | null = null;
async function captureMigrationState(): Promise<string> {
  const [state] = await connection.execute<RowDataPacket[]>("SELECT mode,source_schema_version,source_sha256,first_entity_write_at,entity_write_count FROM community_entity_store_state WHERE id=1");
  const [sequences] = await connection.query<RowDataPacket[]>("SELECT sequence_name,next_value,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updated_at FROM community_entity_sequences ORDER BY sequence_name");
  const [journals] = await connection.query<RowDataPacket[]>("SELECT collection,state,last_source_ordinal,processed_count,verified_count,source_sha256 FROM community_entity_migration_journal ORDER BY collection");
  const [records] = await connection.query<RowDataPacket[]>("SELECT collection,COUNT(*) AS total FROM community_entity_records GROUP BY collection ORDER BY collection");
  const [relations] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_relations");
  const [snapshot] = await connection.query<RowDataPacket[]>("SELECT payload_sha256 FROM community_legacy_snapshots WHERE id=1");
  const [source] = await connection.query<RowDataPacket[]>("SELECT SHA2(CAST(payload AS CHAR CHARACTER SET utf8mb4),256) AS digest FROM community_product_state WHERE id=1");
  return JSON.stringify({ state, sequences, journals, records, relationCount: relations[0]?.total, snapshotHash: snapshot[0]?.payload_sha256, sourceHash: source[0]?.digest });
}
try {
  const [modeRows] = await connection.query<RowDataPacket[]>("SELECT mode,entity_write_count FROM community_entity_store_state WHERE id=1");
  const [snapshotRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_legacy_snapshots");
  const [journalRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_migration_journal");
  const [entityRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM community_entity_records");
  if (modeRows[0]?.mode !== "LEGACY" || Number(modeRows[0]?.entity_write_count) !== 0 ||
      Number(snapshotRows[0]?.total ?? 0) !== 0 || Number(journalRows[0]?.total ?? 0) !== 0 || Number(entityRows[0]?.total ?? 0) !== 0)
    throw new Error("Synthetic round-trip requires a fresh LEGACY schema with no prior Entity Store snapshot, journal, or rows");
  const expectedServerUuid = process.env.ENTITY_STORE_EXPECTED_SERVER_UUID?.trim();
  const expectedSchema = process.env.ENTITY_STORE_EXPECTED_SCHEMA?.trim();
  if (!expectedServerUuid || !expectedSchema) throw new Error("DDL recovery smoke requires the expected isolated server UUID and schema");
  const [identityRows] = await connection.query<RowDataPacket[]>("SELECT @@server_uuid AS serverUuid,DATABASE() AS schemaName");
  if (String(identityRows[0]?.serverUuid ?? "").trim().toLowerCase() !== expectedServerUuid.toLowerCase() ||
      String(identityRows[0]?.schemaName ?? "").trim() !== expectedSchema)
    throw new Error("Refusing schema migration recovery against a database outside the explicitly selected isolated identity");
  await interruptAfterCompletedPhase(schemaMigrationScript, [], "ddl", process.env);
  runSchemaMigrations();
  const [ddlRows] = await connection.execute<RowDataPacket[]>("SELECT state FROM schema_migrations WHERE name='0005_entity_store.sql'");
  const [ddlTables] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('community_entity_records','community_entity_relations','community_entity_sequences','community_entity_store_state','community_entity_migration_journal','community_legacy_snapshots','community_entity_reverse_exports')");
  if (ddlRows[0]?.state !== "APPLIED" || Number(ddlTables[0]?.total) !== 7)
    throw new Error("Entity Store DDL did not remain applied after the interrupted schema migration process was restarted");
  const now = new Date().toISOString();
  const seed = new MemoryStore(false) as unknown as { importState(raw: string): void; exportState(): string };
  const fixture: Record<string, unknown> = Object.fromEntries([
    "users", "privacy", "sessions", "passwordChangeTokens", "credentials", "roles", "accessRoles",
    "deletedAccessRoleIds", "staff", "staffPoints", "areas", "points", "catalog", "categories",
    "homepageBanners", "campaigns", "idempotency", "orders", "checkoutBatches", "lines", "payments",
    "paymentBatches", "callbacks", "orderRefunds", "partialRefunds", "ledger", "audits", "plans", "batches",
    "pickupCredentials", "pickupRecords", "pickupReceipts", "deliveries", "exceptions", "allocations", "drafts",
    "windows", "cancellations", "quality", "interests", "notifications", "preferences",
  ].map((collection) => [collection, []]));
  const areaId = "synthetic-rehearsal-area";
  const pointId = "synthetic-rehearsal-point";
  const skuId = "synthetic-rehearsal-sku";
  const campaignId = "synthetic-rehearsal-campaign";
  const userId = "synthetic-rehearsal-user";
  const orderId = "synthetic-rehearsal-order";
  const checkoutId = "synthetic-rehearsal-checkout";
  const paymentId = "synthetic-rehearsal-payment";
  const refundId = "synthetic-rehearsal-refund";
  const orderNo = "SYNTHETIC-ENTITY-1500";
  const amountCents = 1500;
  fixture.users = [
    [userId, { id: userId, wechatOpenId: "synthetic-openid", status: "ACTIVE", createdAt: now }],
    ...Array.from({ length: 5000 }, (_, index) => {
      const id = `synthetic-recovery-user-${String(index).padStart(4, "0")}`;
      return [id, { id, wechatOpenId: `synthetic-recovery-openid-${index}`, status: "ACTIVE", createdAt: now }] as const;
    }),
  ];
  fixture.areas = [[areaId, { id: areaId, regionCode: "110101", name: "Synthetic rehearsal area", status: "ENABLED", orderEnabled: true, createdAt: now }]];
  fixture.points = [[pointId, { id: pointId, serviceAreaId: areaId, name: "Synthetic rehearsal point", address: "synthetic", businessHours: "09:00-20:00", pickupInstructions: "synthetic", latitude: 39.9, longitude: 116.4, contactName: "Synthetic", contactPhone: "13800000000", status: "ACTIVE", capacityPerDay: 10, createdAt: now }]];
  fixture.catalog = [[skuId, { id: skuId, productId: "synthetic-product", categoryId: null, name: "Synthetic rehearsal SKU", retailPriceCents: amountCents, defaultSellableQuantity: 10, status: "ACTIVE", product: { id: "synthetic-product", title: "Synthetic item", category: "vegetables", origin: "synthetic", imageUrl: null, storageType: "NORMAL_TEMPERATURE", status: "ACTIVE" }, createdAt: now, updatedAt: now }]];
  fixture.campaigns = [[campaignId, { id: campaignId, title: "Synthetic rehearsal campaign", serviceAreaId: areaId, cutoffAt: now, dispatchAt: now, estimatedArrivalStartAt: now, estimatedArrivalEndAt: now, minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND", items: [{ catalogSkuId: skuId, productId: "synthetic-product", title: "Synthetic item", category: "vegetables", skuName: "one unit", origin: "synthetic", imageUrl: null, retailPriceCents: amountCents, sellableQuantity: 1, reservedQuantity: 0 }], status: "CLOSED", version: 1, createdAt: now }]];
  const otherOrderId = "synthetic-rehearsal-other-order";
  fixture.orders = [
    [orderId, { id: orderId, orderNo, userId, campaignId, serviceAreaId: areaId, pickupPointId: pointId, deliveryPlanId: "synthetic-rehearsal-plan", status: "REFUNDED", totalCents: amountCents, items: [], createdAt: now, expiresAt: now, paidAt: now, pickedUpAt: null }],
    [otherOrderId, { id: otherOrderId, orderNo: "SYNTHETIC-ENTITY-EMPTY", userId, campaignId, serviceAreaId: areaId, pickupPointId: pointId, deliveryPlanId: "synthetic-rehearsal-plan", status: "CANCELLED", totalCents: 0, items: [], createdAt: now, expiresAt: now, paidAt: null, pickedUpAt: null }],
  ];
  fixture.checkoutBatches = [[checkoutId, { id: checkoutId, outTradeNo: "SYNTHETIC-CHECKOUT", userId, orderIds: [orderId], totalCents: amountCents, status: "PAID", expiresAt: now, createdAt: now }]];
  fixture.lines = [[orderId, [{ id: "synthetic-rehearsal-line", catalogSkuId: skuId, productId: "synthetic-product", skuName: "one unit", quantity: 1, unitPriceCents: amountCents, amountCents, fulfilledQuantity: 0, pickedUpQuantity: 0, exceptionQuantity: 0, refundedQuantity: 1, refundedAmountCents: amountCents }]]];
  fixture.payments = [[paymentId, { id: paymentId, orderId, provider: "mock", providerPaymentId: "synthetic-provider-payment", status: "REFUNDED", amountCents, clientPayload: null, providerContext: null, initiationLeaseUntil: null, initiationClaimToken: null, createdAt: now, succeededAt: now, checkoutBatchId: checkoutId }]];
  fixture.orderRefunds = [[refundId, { id: refundId, orderId, paymentId, providerRefundNo: "SYNTHETIC-REFUND", providerRefundId: "synthetic-provider-refund", status: "SUCCEEDED", amountCents, createdAt: now, submissionLeaseUntil: null, submissionClaimToken: null }]];
  fixture.ledger = [
    ["synthetic-ledger-payment", { id: "synthetic-ledger-payment", referenceType: "ORDER", referenceId: orderId, eventType: "PAYMENT_SUCCEEDED", lines: [{ accountCode: "ORDER_RECEIVABLE", ownerId: orderId, direction: "DEBIT", amountCents }, { accountCode: "CUSTOMER_FUNDS", ownerId: userId, direction: "CREDIT", amountCents }], createdAt: now }],
    ["synthetic-ledger-refund", { id: "synthetic-ledger-refund", referenceType: "ORDER", referenceId: orderId, eventType: "REFUND_SUCCEEDED", lines: [{ accountCode: "CUSTOMER_FUNDS", ownerId: userId, direction: "DEBIT", amountCents }, { accountCode: "ORDER_RECEIVABLE", ownerId: orderId, direction: "CREDIT", amountCents }], createdAt: now }],
  ];
  fixture.audits = [{ id: "synthetic-rehearsal-audit", actorId: userId, action: "SYNTHETIC_ORDER_REVIEWED", resourceType: "ORDER", resourceId: orderId, requestId: "synthetic-audit-request", beforeData: null, afterData: { synthetic: true }, createdAt: now }];
  seed.importState(JSON.stringify(fixture));
  await connection.execute("UPDATE community_product_state SET payload=CAST(? AS JSON),updated_at=UTC_TIMESTAMP(3) WHERE id=1", [seed.exportState()]);
  const [sourceRows] = await connection.query<RowDataPacket[]>("SELECT SHA2(CAST(payload AS CHAR CHARACTER SET utf8mb4),256) AS digest FROM community_product_state WHERE id=1");
  if (!sourceRows[0]?.digest) throw new Error("Synthetic legacy aggregate row is missing");

  await interruptPrepareAfterFirstUserPage();
  runMigration("prepare");
  runMigration("verify");
  await interruptAfterCompletedPhase(migrationScript, ["prepare"], "prepare", migrationEnvironment("prepare"));
  runMigration("prepare");
  runMigration("verify");
  const [legacyPayloadRows] = await connection.query<RowDataPacket[]>("SELECT CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload FROM community_product_state WHERE id=1");
  const originalLegacyPayload = String(legacyPayloadRows[0]?.payload ?? "");
  if (!originalLegacyPayload) throw new Error("Synthetic legacy payload is missing before source-change refusal test");
  const changedLegacyState = JSON.parse(originalLegacyPayload) as Record<string, unknown>;
  const changedUsers = changedLegacyState.users as Array<[string, Record<string, unknown>]>;
  changedUsers[0]![1].displayName = "changed-after-snapshot";
  await connection.execute("UPDATE community_product_state SET payload=CAST(? AS JSON) WHERE id=1", [JSON.stringify(changedLegacyState)]);
  try {
    const rejected = runMigrationExpectingFailure("prepare");
    if (!rejected.includes("Immutable legacy snapshot exists with a different hash"))
      throw new Error(`Migration did not refuse changed source with the immutable-snapshot reason: ${rejected.slice(-1500)}`);
  } finally {
    await connection.execute("UPDATE community_product_state SET payload=CAST(? AS JSON) WHERE id=1", [originalLegacyPayload]);
  }
  runMigration("verify");
  // A completed prepare must also be safe to repeat against the same snapshot.
  runMigration("prepare");
  runMigration("verify");
  const [paymentRows] = await connection.execute<RowDataPacket[]>(
    "SELECT lookup_a AS orderId,document FROM community_entity_records WHERE collection='payments' AND entity_key=?",
    [paymentId],
  );
  if (!paymentRows[0]) throw new Error("Migrated synthetic payment is missing before the ownership negative test");
  const originalPayment = (typeof paymentRows[0].document === "string"
    ? JSON.parse(paymentRows[0].document) as Record<string, unknown>
    : paymentRows[0].document) as Record<string, unknown>;
  if (Number(originalPayment.amountCents) !== amountCents || String(paymentRows[0].orderId) !== orderId)
    throw new Error("Synthetic payment fixture does not begin with the expected owner and amount");
  const misattributedPayment = { ...originalPayment, orderId: otherOrderId };
  await connection.execute(
    "UPDATE community_entity_records SET lookup_a=?,document=CAST(? AS JSON) WHERE collection='payments' AND entity_key=?",
    [otherOrderId, JSON.stringify(misattributedPayment), paymentId],
  );
  try {
    const rejected = runMigrationExpectingFailure("verify");
    if (!rejected.includes(`canonical record mismatch for payments:${paymentId}`))
      throw new Error(`Migration verifier rejected misattribution for an unexpected reason: ${rejected.slice(-1500)}`);
  } finally {
    await connection.execute(
      "UPDATE community_entity_records SET lookup_a=?,document=CAST(? AS JSON) WHERE collection='payments' AND entity_key=?",
      [orderId, JSON.stringify(originalPayment), paymentId],
    );
  }
  const [paymentTotals] = await connection.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(document,'$.amountCents')) AS DECIMAL(30,0))),0) AS total FROM community_entity_records WHERE collection='payments'",
  );
  if (BigInt(String(paymentTotals[0]?.total ?? 0)) !== BigInt(amountCents))
    throw new Error("Ownership negative test unexpectedly changed the aggregate payment amount");
  runMigration("verify");
  const [financialRows] = await connection.query<RowDataPacket[]>(
    "SELECT collection,source_amount_cents,source_debit_cents,source_credit_cents FROM community_entity_migration_journal WHERE collection IN ('orders','lines','payments','orderRefunds','ledger') ORDER BY collection",
  );
  const financials = new Map(financialRows.map((row) => [String(row.collection), row]));
  for (const collection of ["orders", "lines", "payments", "orderRefunds"])
    if (String(financials.get(collection)?.source_amount_cents) !== String(amountCents))
      throw new Error(`Synthetic ${collection} amount was not migrated as ${amountCents} cents`);
  if (String(financials.get("ledger")?.source_debit_cents) !== "3000" || String(financials.get("ledger")?.source_credit_cents) !== "3000")
    throw new Error("Synthetic ledger debit/credit totals did not migrate as 3000/3000 cents");
  const [snapshot] = await connection.query<RowDataPacket[]>("SELECT payload_sha256 FROM community_legacy_snapshots WHERE id=1");
  const originalSnapshotHash = String(snapshot[0]?.payload_sha256 ?? "");
  if (originalSnapshotHash !== String(sourceRows[0].digest)) throw new Error("Prepared immutable snapshot hash does not match the original synthetic legacy payload");
  await interruptAfterCompletedPhase(migrationScript, ["activate"], "activate", migrationEnvironment("activate"));
  const [activatedRows] = await connection.query<RowDataPacket[]>("SELECT mode FROM community_entity_store_state WHERE id=1");
  if (activatedRows[0]?.mode !== "ENTITY") throw new Error("Interrupted activation did not leave the committed Entity Store mode visible after restart");

  const stateBeforeEntityPrepare = await captureMigrationState();
  const entityPrepareRejection = runMigrationExpectingFailure("prepare");
  if (!entityPrepareRejection.includes("Entity Store prepare requires LEGACY or PREPARED mode; current mode is ENTITY"))
    throw new Error(`Entity-mode prepare was rejected for an unexpected reason: ${entityPrepareRejection.slice(-1500)}`);
  if (await captureMigrationState() !== stateBeforeEntityPrepare)
    throw new Error("Rejected Entity-mode prepare changed migration state, sequences, row counts, relations or source hash");

  const syntheticId = `entity-store-smoke-${randomUUID()}`;
  store = MysqlStore.create(databaseUrl);
  if (await store.getPersistenceMode() !== "ENTITY") throw new Error("Entity Store did not activate before the synthetic business write");
  await store.transaction(async (tx) => {
    const order = await tx.getOrder(orderId);
    const payment = await tx.getPaymentByOrder(orderId);
    const refund = await tx.getOrderRefundByOrder(orderId);
    const ledger = await tx.listLedgerTransactions(orderId);
    const checkout = await tx.getCheckoutBatchByOrder(orderId);
    const campaignReferences = await tx.countActiveCampaignReferencesForCatalogSku(skuId, ["CLOSED"]);
    if (!order || order.items.length !== 1 || order.items[0]?.amountCents !== amountCents ||
        payment?.amountCents !== amountCents || refund?.amountCents !== amountCents || ledger.length !== 2 ||
        checkout?.id !== checkoutId || campaignReferences !== 1)
      throw new Error("Entity-mode transaction could not follow the synthetic order, line, payment, refund, ledger, checkout relation, and campaign/SKU relation");
    await tx.saveServiceArea({
      id: syntheticId,
      regionCode: `SMOKE-${randomUUID().slice(0, 8)}`,
      name: "Entity Store reverse-export smoke record",
      status: "ENABLED",
      orderEnabled: true,
      createdAt: new Date().toISOString(),
    });
  });
  await store.close();
  store = null;
  const [writeRows] = await connection.query<RowDataPacket[]>("SELECT first_entity_write_at,entity_write_count FROM community_entity_store_state WHERE id=1");
  if (!writeRows[0]?.first_entity_write_at || Number(writeRows[0]?.entity_write_count) < 1)
    throw new Error("Synthetic business write did not set the Entity Store write marker");
  await interruptAfterCompletedPhase(migrationScript, ["rollback"], "rollback", migrationEnvironment("rollback"));
  const [rolledBackRows] = await connection.query<RowDataPacket[]>("SELECT mode FROM community_entity_store_state WHERE id=1");
  if (rolledBackRows[0]?.mode !== "LEGACY") throw new Error("Interrupted rollback did not leave the committed Legacy mode visible after restart");

  store = MysqlStore.create(databaseUrl);
  if (await store.getPersistenceMode() !== "LEGACY") throw new Error("Reopened store did not return to LEGACY mode");
  const reopenedAreas = await store.listServiceAreas();
  const reopened = reopenedAreas.find((area) => area.id === syntheticId);
  if (!reopened || reopened.name !== "Entity Store reverse-export smoke record")
    throw new Error("Synthetic business write was not readable after reopening the reverse-exported legacy state");
  const reopenedOrder = await store.getOrder(orderId);
  const reopenedPayment = await store.getPaymentByOrder(orderId);
  const reopenedRefund = await store.getOrderRefundByOrder(orderId);
  const reopenedLedger = await store.listLedgerTransactions(orderId);
  const reopenedCheckout = await store.getCheckoutBatchByOrder(orderId);
  if (!reopenedOrder || reopenedOrder.items.length !== 1 || reopenedOrder.items[0]?.amountCents !== amountCents ||
      reopenedPayment?.amountCents !== amountCents || reopenedRefund?.amountCents !== amountCents || reopenedLedger.length !== 2 || reopenedCheckout?.id !== checkoutId)
    throw new Error("Reopened legacy state did not retain its order, line, payment, refund, ledger, and checkout business references");
  await store.close();
  store = null;

  const [finalSnapshot] = await connection.query<RowDataPacket[]>("SELECT payload_sha256 FROM community_legacy_snapshots WHERE id=1");
  const [reverseRows] = await connection.query<RowDataPacket[]>("SELECT source_entity_write_count,payload_sha256,SHA2(CAST(payload AS CHAR CHARACTER SET utf8mb4),256) AS actual_sha256 FROM community_entity_reverse_exports WHERE id=1");
  const [stateRows] = await connection.query<RowDataPacket[]>("SELECT mode,source_sha256 FROM community_entity_store_state WHERE id=1");
  const [legacyRows] = await connection.query<RowDataPacket[]>("SELECT SHA2(CAST(payload AS CHAR CHARACTER SET utf8mb4),256) AS digest FROM community_product_state WHERE id=1");
  if (String(finalSnapshot[0]?.payload_sha256) !== originalSnapshotHash)
    throw new Error("Reverse export modified the immutable original legacy snapshot");
  if (!reverseRows[0] || String(reverseRows[0].payload_sha256) !== String(reverseRows[0].actual_sha256))
    throw new Error("Reverse export payload hash does not match its stored payload");
  if (stateRows[0]?.mode !== "LEGACY" || String(stateRows[0]?.source_sha256) !== String(legacyRows[0]?.digest))
    throw new Error("Legacy state mode/hash does not match the reopened payload");
  process.stdout.write(JSON.stringify({
    result: "passed",
    interruptionCheckpointResumed: true,
    ddlCompletionInterruptionRecognized: true,
    prepareCompletionInterruptionResumed: true,
    activationCommitInterruptionRecognized: true,
    rollbackCommitInterruptionRecognized: true,
    interruptionCoverage: {
      ddl: "schema migration CLI completed, process was SIGKILLed, then CLI restart confirmed 0005 APPLIED and required Entity Store tables present",
      prepare: "first committed users page was SIGKILLed and resumed; full prepare was also SIGKILLed after completion, then prepare and verify succeeded again",
      snapshotAndPreparedMarker: "same prepare transaction; covered by transaction semantics and successful restart, not separately SIGKILLed between SQL statements",
      importPageAndJournal: "each imported page and journal checkpoint share one transaction; first committed users page has a real SIGKILL/resume test, not one test per collection",
      collectionCompletionAndSequence: "repeat prepare and verify cover completed journals; sequence uses GREATEST upsert; no per-collection kill sweep",
      verify: "read-only; no durable phase transition to interrupt",
      activate: "process was SIGKILLed after activation completion marker; restart observed ENTITY mode and continued business reads/writes",
      rollback: "process was SIGKILLed after rollback completion marker; restart observed LEGACY mode and read reverse-exported data",
    },
    repeatedPrepareVerified: true,
    changedSourcePrepareRejected: true,
    entityModePrepareRejectedWithoutChanges: true,
    sameAmountWrongOrderAssociationRejected: true,
    orderAmountCents: amountCents,
    paymentRefundAmountCents: amountCents,
    ledgerDebitCreditCents: [3000, 3000],
    syntheticWriteCount: Number(reverseRows[0].source_entity_write_count),
    legacySnapshotPreserved: true,
    reverseExportHashVerified: true,
    reopenedServiceArea: syntheticId,
  }) + "\n");
} finally {
  if (store) await store.close().catch(() => undefined);
  await connection.end();
}
