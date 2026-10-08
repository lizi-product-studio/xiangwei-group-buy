import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Redis } from "ioredis";
import { digest } from "./business-reset-plan.js";
import { privateWrite } from "./business-reset.js";

export const resetRedisKeyAllowed = (key: string): boolean => key.startsWith("bull:campaign-lifecycle:") || key.startsWith("admin-login:") || key === "hometown:reconciliation:lease";
const field = (info: string, key: string) => info.split(/\r?\n/).find(line => line.startsWith(key + ":"))?.slice(key.length + 1);
export async function runRedisReset(): Promise<void> {
  const env = process.env;
  const action = process.argv[2];
  if (action !== "inspect" && action !== "apply") throw new Error("Choose inspect or apply");
  for (const key of ["REDIS_URL", "RESET_REDIS_EXPECTED_HOST", "RESET_REDIS_EXPECTED_DB", "RESET_REDIS_EXPECTED_RUN_ID", "RESET_OUTPUT"]) if (!env[key]) throw new Error(`Missing ${key}`);
  const url = new URL(env.REDIS_URL!);
  const db = url.pathname.slice(1) || "0";
  if (url.hostname !== env.RESET_REDIS_EXPECTED_HOST || db !== env.RESET_REDIS_EXPECTED_DB) throw new Error("Redis host/db mismatch");
  if (action === "apply" && (env.RESET_WRITERS_STOPPED !== "CONFIRMED" || env.RESET_CONFIRM !== "OPS-20260929-REMOVE-RECON-RESET" || !env.RESET_REDIS_EXPECTED_BEFORE_SHA256 || !env.RESET_DB_COMMIT_RECEIPT || !env.RESET_DB_COMMIT_RECEIPT_SHA256)) throw new Error("Missing stopped-writer attestation or committed database receipt");
  const redis = new Redis(env.REDIS_URL!, { maxRetriesPerRequest: 0, enableOfflineQueue: false, lazyConnect: true });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    const info = await redis.info("server");
    if (field(info, "run_id") !== env.RESET_REDIS_EXPECTED_RUN_ID || !field(info, "redis_version")?.startsWith("7.4.")) throw new Error("Redis runtime identity mismatch");
    if (await redis.dbsize() > 10_000) throw new Error("Redis key bound exceeded");
    const keys: string[] = [];
    let cursor = "0";
    do {
      const result = await redis.scan(cursor, "COUNT", 200);
      cursor = result[0];
      keys.push(...result[1]);
      if (keys.length > 20_000) throw new Error("Redis scan bound exceeded");
    } while (cursor !== "0");
    const unique = [...new Set(keys)].sort();
    if (unique.some(key => !resetRedisKeyAllowed(key))) throw new Error("Unknown Redis namespace; review before deletion");
    if (await redis.llen("bull:campaign-lifecycle:active") !== 0) throw new Error("Active queue work remains");
    const entries = [] as Array<{ key: string; dump: string; expiresAt: number | null }>;
    let snapshotBytes = 0;
    for (const key of unique) {
      const dump = await redis.dumpBuffer(key);
      if (!dump) throw new Error("Redis changed during snapshot");
      const ttl = await redis.pttl(key);
      if (ttl < -1) throw new Error("Redis expired during snapshot");
      snapshotBytes += dump.length + Buffer.byteLength(key);
      if (snapshotBytes > 64 * 1024 * 1024) throw new Error("Redis snapshot byte bound exceeded");
      entries.push({ key, dump: dump.toString("base64"), expiresAt: ttl === -1 ? null : Date.now() + ttl });
    }
    const identity = { runId: env.RESET_REDIS_EXPECTED_RUN_ID, db, host: url.hostname };
    const beforeHash = digest({ identity, entries: entries.map(({ key, dump }) => ({ key, dump })) });
    if (action === "inspect") {
      const report = { action, identity, beforeHash, keyCount: entries.length };
      await privateWrite(env.RESET_OUTPUT!, report);
      process.stdout.write(JSON.stringify(report) + "\n");
      return;
    }
    if (beforeHash !== env.RESET_REDIS_EXPECTED_BEFORE_SHA256) throw new Error("Redis changed since inspection");
    const dbReceipt = JSON.parse(await readFile(env.RESET_DB_COMMIT_RECEIPT!, "utf8")) as Record<string, unknown>;
    if (digest(dbReceipt) !== env.RESET_DB_COMMIT_RECEIPT_SHA256 || dbReceipt.status !== "committed" || dbReceipt.action !== "apply") throw new Error("Database commit receipt mismatch");
    const [seconds, microseconds] = await redis.time();
    const serverNow = Number(seconds) * 1000 + Number(microseconds) / 1000;
    const backupHash = await privateWrite(env.RESET_OUTPUT! + ".preimage.json", { identity, entries, serverNow, databaseReceiptHash: digest(dbReceipt) });
    const args = entries.flatMap(entry => [entry.key, Buffer.from(entry.dump, "base64")]);
    await privateWrite(env.RESET_OUTPUT! + ".prepared.json", { action, identity, beforeHash, backupHash, expectedRemainingKeys: 0, status: "prepared-before-delete" });
    const removed = await redis.eval(`
      if redis.call('DBSIZE') > 10000 then return redis.error_reply('key bound') end
      local all = redis.call('KEYS','*')
      if #all ~= #ARGV / 2 then return redis.error_reply('key set changed') end
      for i=1,#ARGV,2 do
        if redis.call('DUMP',ARGV[i]) ~= ARGV[i+1] then return redis.error_reply('value changed') end
      end
      for i=1,#ARGV,2 do redis.call('DEL',ARGV[i]) end
      return #all
    `, 0, ...args);
    await privateWrite(env.RESET_OUTPUT!, { action, status: "committed", identity, beforeHash, backupHash, removed, remainingKeys: await redis.dbsize() });
    process.stdout.write(JSON.stringify({ action, status: "committed", removed, remainingKeys: await redis.dbsize() }) + "\n");
  } finally { redis.disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runRedisReset().catch(() => { process.stderr.write("Redis reset stopped. Keep workers and traffic stopped; compare private evidence before retrying.\n"); process.exitCode = 1; });
}
