import { spawn } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { access, cp } from 'node:fs/promises';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
if (process.env.READINESS_TASK !== 'TASK-20260908-ISOLATED-SERVER-TEST' || process.env.READINESS_TARGET !== '180.76.100.156') throw new Error('Wrong test identity');
try { await access('/workspace/.env'); throw new Error('Repository .env is forbidden'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const phase = process.argv[2];
for (const key of Object.keys(process.env)) {
  if (key.startsWith('WECHAT_')) throw new Error(`Real channel configuration is forbidden: ${key}`);
}
if (process.env.AUTH_PROVIDER !== 'demo' || process.env.PAYMENT_PROVIDER !== 'mock' || process.env.HOST !== '127.0.0.1' ||
    process.env.E2E_API_BASE_URL !== 'http://127.0.0.1:3101' || process.env.E2E_ADMIN_BASE_URL !== 'http://127.0.0.1:5174' ||
    process.env.E2E_API_PORT !== '3101' || process.env.E2E_ADMIN_PORT !== '5174') throw new Error('Unsafe provider or E2E configuration');
const allowed = new Set(['PATH', 'HOME', 'PNPM_HOME', 'PLAYWRIGHT_BROWSERS_PATH', 'CI', 'NODE_ENV', 'NODE_OPTIONS', 'AUTH_PROVIDER', 'PAYMENT_PROVIDER', 'HOST', 'E2E_API_PORT', 'E2E_ADMIN_PORT', 'E2E_API_BASE_URL', 'E2E_ADMIN_BASE_URL', 'READINESS_TASK', 'READINESS_TARGET', 'DATABASE_URL', 'INTEGRATION_DATABASE_URL', 'INTEGRATION_REDIS_URL', 'REQUIRE_INTEGRATION_TESTS', 'CAPACITY_PROFILE', 'CAPACITY_OUTPUT', 'CAPACITY_DURATION_MS']);
const childEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key)));
async function command(args, extra = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { stdio: 'inherit', env: { ...childEnvironment, ...extra } });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Command ${args.join(' ')} failed (${code})`)));
  });
}
async function guardIntegration() {
  const db = new URL(process.env.INTEGRATION_DATABASE_URL);
  const cache = new URL(process.env.INTEGRATION_REDIS_URL);
  if (db.protocol !== 'mysql:' || db.hostname !== 'readiness-mysql' || db.port !== '3306' || db.username !== 'readiness_integration' || !db.password || db.pathname !== '/readiness_integration_20260908' || db.search || db.hash ||
      cache.protocol !== 'redis:' || cache.hostname !== 'readiness-redis' || cache.port !== '6379' || cache.pathname !== '/6' || !cache.password || cache.username || cache.search || cache.hash || process.env.DATABASE_URL !== db.href) throw new Error('Integration endpoints do not match isolated profile');
  const connection = await mysql.createConnection(db.href);
  try {
    const [rows] = await connection.query("SELECT DATABASE() AS db,SUBSTRING_INDEX(CURRENT_USER(),'@',1) AS usr,task_id,target,profile,synthetic_only FROM capacity_test_identity");
    const row = rows[0];
    if (rows.length !== 1 || row.db !== 'readiness_integration_20260908' || row.usr !== 'readiness_integration' || row.task_id !== process.env.READINESS_TASK || row.target !== process.env.READINESS_TARGET || row.profile !== 'server-isolated-20260908' || row.synthetic_only !== 1) throw new Error('Integration identity marker mismatch');
  } finally { await connection.end(); }
  const redis = new Redis(cache.href, { maxRetriesPerRequest: 1 });
  try { if (await redis.ping() !== 'PONG') throw new Error('Redis unavailable'); } finally { redis.disconnect(); }
}
if (phase === 'migrate') {
  const pass = process.env.READINESS_MIGRATOR_PASSWORD;
  if (!/^[a-f0-9]{48}$/.test(pass ?? '')) throw new Error('Missing isolated migrator password');
  for (const db of ['readiness_capacity_20260908', 'readiness_integration_20260908']) {
    const env = { DATABASE_URL: `mysql://readiness_migrator:${pass}@readiness-mysql:3306/${db}` };
    const connection = await mysql.createConnection(env.DATABASE_URL);
    try {
      const [rows] = await connection.query("SELECT DATABASE() AS db,SUBSTRING_INDEX(CURRENT_USER(),'@',1) AS usr,task_id,target,profile,synthetic_only FROM capacity_test_identity");
      const row = rows[0];
      if (rows.length !== 1 || row.db !== db || row.usr !== 'readiness_migrator' || row.task_id !== process.env.READINESS_TASK || row.target !== process.env.READINESS_TARGET || row.profile !== 'server-isolated-20260908' || row.synthetic_only !== 1) throw new Error('Migration identity mismatch');
    } finally { await connection.end(); }
    await command(['db:migrate'], env);
    await command(['db:migrate'], env);
  }
} else if (phase === 'check') {
  await guardIntegration();
  await command(['check']);
} else if (phase === 'capacity') {
  await command(['--filter', '@hometown/api', 'exec', 'node', '--import', 'tsx', 'src/scripts/capacity-readiness.ts']);
} else if (phase === 'e2e') {
  try { await command(['test:e2e']); }
  finally {
    for (const directory of ['playwright-report', 'test-results']) await cp(directory, `/evidence/${directory}`, { recursive: true }).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
} else throw new Error('Expected migrate, check, capacity or e2e');
