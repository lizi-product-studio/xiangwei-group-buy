/** Deliberately closed profiles: never accept an arbitrary remote target. */
export const serverCapacityIdentity = {
  task: "TASK-20260908-ISOLATED-SERVER-TEST",
  target: "180.76.100.156",
  profile: "server-isolated-20260908",
} as const;

export function assertCapacityTarget(environment: NodeJS.ProcessEnv) {
  const profile = environment.CAPACITY_PROFILE ?? "local-20260908";
  const server = profile === serverCapacityIdentity.profile;
  if (!server && profile !== "local-20260908") throw new Error("Unknown capacity profile");
  const database = environment.INTEGRATION_DATABASE_URL;
  const redis = environment.INTEGRATION_REDIS_URL;
  if (!database || !redis) throw new Error("Dedicated capacity database and Redis URLs are required");
  let db: URL, cache: URL;
  try { db = new URL(database); cache = new URL(redis); }
  catch { throw new Error("Invalid capacity endpoint URL"); }
  if (db.protocol !== "mysql:" || cache.protocol !== "redis:" || db.search || db.hash || cache.search || cache.hash ||
      db.hostname !== (server ? "readiness-mysql" : "127.0.0.1") || db.port !== (server ? "3306" : "13306") ||
      db.pathname !== (server ? "/readiness_capacity_20260908" : "/community_capacity_20260908") ||
      cache.hostname !== (server ? "readiness-redis" : "127.0.0.1") || cache.port !== (server ? "6379" : "16379") || cache.pathname !== "/5" ||
      (server && (db.username !== "readiness_runner" || !db.password || cache.username !== "")) ||
      (!server && !db.username)) {
    throw new Error("Capacity endpoint does not match the dedicated synthetic profile");
  }
  return {profile, server, database, redis};
}

export function assertCapacityIdentity(rows: ReadonlyArray<Record<string, unknown>>) {
  const row = rows[0];
  if (rows.length !== 1 || !row || row.database_name !== "readiness_capacity_20260908" ||
      row.database_user !== "readiness_runner" || row.task_id !== serverCapacityIdentity.task ||
      row.target !== serverCapacityIdentity.target || row.profile !== serverCapacityIdentity.profile || row.synthetic_only !== 1) {
    throw new Error("Capacity database identity marker mismatch; no fixture writes permitted");
  }
}
