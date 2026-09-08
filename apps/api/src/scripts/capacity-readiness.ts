/** Isolated, synthetic real-MySQL/Redis benchmark. Never point at production. */
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { openSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { moneyCents } from "@hometown/domain";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { MysqlStore } from "../modules/core/mysql-store.js";
import { MemoryStore } from "../modules/core/store.js";

const database = process.env.INTEGRATION_DATABASE_URL!;
const redis = process.env.INTEGRATION_REDIS_URL!;
const db = new URL(database), cache = new URL(redis);
if (db.hostname !== "127.0.0.1" || db.port !== "13306" || db.pathname !== "/community_capacity_20260908" || cache.hostname !== "127.0.0.1" || cache.port !== "16379" || cache.pathname !== "/5")
  throw new Error("Capacity harness requires the dedicated local synthetic database and Redis DB 5");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = (index: number) => `synthetic-capacity-session-${String(index).padStart(16, "0")}`;
const output = process.env.CAPACITY_OUTPUT;
if (!output) throw new Error("CAPACITY_OUTPUT must name a local evidence file");

if (process.env.CAPACITY_SERVER === "1") {
  const store = MysqlStore.create(database);
  const transactions: number[] = [];
  const transaction = store.transaction;
  store.transaction = async work => {
    const start = performance.now();
    try { return await transaction(work); } finally { transactions.push(performance.now() - start); }
  };
  const app = await buildApp({store, config: loadConfig({NODE_ENV: "test", DATA_STORE: "mysql", DATABASE_URL: database, QUEUE_DRIVER: "redis", REDIS_URL: redis,
    AUTH_PROVIDER: "wechat", WECHAT_APP_ID: "synthetic-capacity-app", WECHAT_APP_SECRET: "synthetic-never-used-secret", PAYMENT_PROVIDER: "mock", RATE_LIMIT_MAX: "10000", LOG_LEVEL: "silent"}),
    subscriptionMessageProvider: {send: async () => { throw new Error("External provider forbidden in capacity HTTP benchmark"); }},
  });
  let peakRss = process.memoryUsage().rss;
  const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 100);
  process.on("message", message => {
    if (message === "metrics") { process.send?.({type: "metrics", peakRss, rss: process.memoryUsage().rss, transactions: transactions.splice(0)}); }
  });
  process.on("SIGTERM", () => { clearInterval(timer); void app.close().then(() => process.exit(0)); });
  await app.listen({host: "127.0.0.1", port: 13101});
  process.send?.({type: "ready"});
} else {
  const control = await mysql.createConnection(database);
  class SyntheticStore extends MemoryStore { raw() { return this.exportState(); } }
  const fixture = new SyntheticStore();
  const now = new Date().toISOString(), future = new Date(Date.now() + 86_400_000).toISOString();
  await fixture.saveServiceArea({id: "capacity-area", regionCode: "110101", name: "合成容量区域", status: "ENABLED", orderEnabled: true, createdAt: now});
  await fixture.savePickupPoint({id: "capacity-point", serviceAreaId: "capacity-area", name: "合成容量点位", address: "隔离测试地址", businessHours: "测试", pickupInstructions: "测试", latitude: 39.9, longitude: 116.4, contactName: "合成", contactPhone: "13800000000", status: "ACTIVE", capacityPerDay: null, createdAt: now});
  await fixture.saveCatalogSku({id: "capacity-sku", productId: "capacity-product", name: "一份", retailPriceCents: moneyCents(1200), defaultSellableQuantity: 100000, status: "ACTIVE", createdAt: now, updatedAt: now,
    product: {id: "capacity-product", title: "合成容量商品", category: "蔬菜", origin: "隔离测试", imageUrl: null, storageType: "NORMAL_TEMPERATURE", status: "ACTIVE"}});
  const campaign = {id: "capacity-campaign", title: "合成容量团期", serviceAreaId: "capacity-area", cutoffAt: future, dispatchAt: future, estimatedArrivalStartAt: future, estimatedArrivalEndAt: future,
    minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND" as const, status: "OPEN" as const, version: 1, createdAt: now,
    items: [{catalogSkuId: "capacity-sku", productId: "capacity-product", title: "合成容量商品", category: "蔬菜", skuName: "一份", origin: "隔离测试", imageUrl: null, retailPriceCents: moneyCents(1200), sellableQuantity: 100000, reservedQuantity: 10000}]};
  await fixture.saveCampaign(campaign);
  await fixture.saveDeliveryPlan({id: "capacity-plan", campaignId: campaign.id, serviceAreaId: "capacity-area", pickupPointId: "capacity-point", status: "SITE_CONFIRMED", siteName: "合成容量点位", address: "隔离测试地址",
    arrivalStartAt: future, arrivalEndAt: future, contactName: null, contactPhone: null, vehicleOrderNo: null, driverName: null, driverPhone: null, vehiclePlate: null, logisticsPlatform: null,
    estimatedArrivalAt: null, remark: null, confirmedAt: now, bookedAt: null, dispatchedAt: null, arrivedAt: null, createdAt: now, updatedAt: now});
  for (let i = 0; i < 1000; i++) {
    const id = `capacity-user-${i}`;
    await fixture.saveUser({id, wechatOpenId: `synthetic-openid-${i}`, status: "ACTIVE", createdAt: now, phoneNumber: `138${String(i).padStart(8, "0")}`, phoneVerifiedAt: now});
    await fixture.savePrivacyConsent(id, "2026-09-07-phone-v1");
    await fixture.saveAuthSession({tokenHash: hash(token(i)), userId: id, roles: ["USER"], authorizationVersion: 0, expiresAt: future});
    for (let j = 0; j < 10; j++) {
      const orderId = `capacity-order-${i}-${j}`;
      await fixture.saveOrder({id: orderId, orderNo: `CAP-${i}-${j}`, userId: id, campaignId: campaign.id, serviceAreaId: "capacity-area", pickupPointId: "capacity-point", deliveryPlanId: "capacity-plan",
        status: "COMPLETED", totalCents: moneyCents(1200), createdAt: now, expiresAt: future, paidAt: now, pickedUpAt: now,
        items: [{orderLineId: `line-${i}-${j}`, skuId: "capacity-sku", productId: "capacity-product", name: "历史合成商品 · 一份", quantity: 1, unitPriceCents: moneyCents(1200), amountCents: moneyCents(1200), fulfilledQuantity: 1, pickedUpQuantity: 1, exceptionQuantity: 0, refundedQuantity: 0, refundedAmountCents: moneyCents(0)}]});
    }
  }
  const raw = fixture.raw();
  // This exact database is reserved for repeatable synthetic benchmarks only.
  await control.execute("UPDATE community_product_state SET payload=?,updated_at=UTC_TIMESTAMP(3) WHERE id=1", [raw]);
  const [rows] = await control.query<RowDataPacket[]>("SELECT OCTET_LENGTH(payload) AS bytes FROM community_product_state WHERE id=1");
  if (!rows[0]) throw new Error("Isolated baseline aggregate row is missing");
  const percentile = (values: number[], fraction: number) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length * fraction)-1)] ?? null;
  const child = spawn(process.execPath, ["--max-old-space-size=256", "--import", "tsx", fileURLToPath(import.meta.url)], {env: {...process.env, CAPACITY_SERVER: "1"}, stdio: ["ignore", "ignore", openSync(output + ".server.log", "w", 0o600), "ipc"]});
  const waitMessage = (type: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => { child.off("message", receive); reject(new Error(`Timed out waiting for ${type}`)); }, 90_000);
    function receive(message: unknown) { if (message && typeof message === "object" && "type" in message && message.type === type) { clearTimeout(timer); child.off("message", receive); resolve(message as Record<string, unknown>); } }
    child.on("message", receive);
  });
  const sourceFiles = ["app.ts", "modules/core/store.ts", "modules/core/mysql-store.ts", "modules/auth/admin-auth.ts", "modules/auth/wechat-auth.ts", "modules/notifications/notification-service.ts", "routes/public-catalog-routes.ts", "scripts/capacity-readiness.ts"];
  const sourceSha256 = Object.fromEntries(sourceFiles.map(path => [path, createHash("sha256").update(readFileSync(fileURLToPath(new URL("../"+path, import.meta.url)))).digest("hex")]));
  const results: unknown[] = [];
  try {
    await waitMessage("ready");
    for (const [name, authenticated] of [["public-catalog", false], ["bearer-orders", true]] as const) {
      const smoke = await fetch(`http://127.0.0.1:13101${authenticated ? "/api/v1/orders" : "/api/v1/campaigns"}`, {headers: authenticated ? {authorization: `Bearer ${token(0)}`} : {}});
      if (smoke.status !== 200) throw new Error(`${name} smoke status ${smoke.status}`);
      await smoke.arrayBuffer();
      for (const rps of [10, 100]) {
        const clearMetric = waitMessage("metrics"); child.send("metrics"); await clearMetric;
        const durationMs = Number(process.env.CAPACITY_DURATION_MS ?? 10_000);
        let offered = 0, dropped = 0, failed = 0, peakRss = 0;
        const active = new Set<Promise<void>>(), latencies: number[] = [];
        const start = performance.now();
        while (performance.now() - start < durationMs) {
          const due = start + offered * 1000 / rps;
          await new Promise(resolve => setTimeout(resolve, Math.max(0, due - performance.now())));
          offered++;
          if (active.size >= 20) { dropped++; continue; }
          const sequence = offered;
          const run = (async () => {
            const at = performance.now();
            try {
              const response = await fetch(`http://127.0.0.1:13101${authenticated ? "/api/v1/orders" : "/api/v1/campaigns"}`, {headers: authenticated ? {authorization: `Bearer ${token(sequence % 1000)}`} : {}, signal: AbortSignal.timeout(30_000)});
              if (response.status !== 200) failed++;
              await response.arrayBuffer();
            } catch { failed++; } finally { latencies.push(performance.now() - at); }
          })();
          active.add(run); void run.finally(() => active.delete(run));
          if (offered % 20 === 0 && child.pid) {
            peakRss = Math.max(peakRss, Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], {encoding: "utf8"}).trim()) * 1024);
          }
        }
        await Promise.allSettled(active);
        const metric = waitMessage("metrics"); child.send("metrics"); const stats = await metric;
        const writes = stats.transactions as number[];
        results.push({name, offeredRps: rps, offered, admissionDropped: dropped, completed: latencies.length, failed, durationMs, elapsedMs: performance.now()-start,
          actualCompletedRps: latencies.length / ((performance.now()-start)/1000), p95Ms: percentile(latencies,.95), p99Ms: percentile(latencies,.99), unexpectedFailureRate: failed / Math.max(1,latencies.length),
          writeTransactions: writes.length, writeTransactionP95Ms: percentile(writes,.95), peakRssBytes: Math.max(peakRss, Number(stats.peakRss)), withinProduction384MiB: Math.max(peakRss, Number(stats.peakRss)) <= 384*1024*1024});
        writeFileSync(output, JSON.stringify({task_id: "TASK-20260908-READINESS-REPAIR-B", platform: process.platform, sourceSha256, dataset: {users:1000, orders:10000, payloadBytes: Number(rows[0]!.bytes)}, limitation: "macOS actual MySQL/Redis; 256MiB V8 heap, no cgroup CPU/RSS equivalence; admission cap20 drops recorded; no production traffic", results}, null, 2), {mode:0o600});
      }
    }
  } finally {
    child.kill("SIGTERM");
    await control.end();
  }
  console.log(JSON.stringify({status: "MEASURED_NOT_LAUNCH_APPROVAL", output}));
}
