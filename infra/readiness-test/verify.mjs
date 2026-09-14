import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Socket } from 'node:net';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const mode = process.argv[2];
if (!['capacity', 'integration'].includes(mode)) throw new Error('Expected capacity or integration mode');
const database = mode === 'capacity' ? 'readiness_capacity_20260908' : 'readiness_integration_20260908';
const user = mode === 'capacity' ? 'readiness_runner' : 'readiness_integration';
const url = new URL(process.env.INTEGRATION_DATABASE_URL);
if (url.protocol !== 'mysql:' || url.hostname !== 'readiness-mysql' || url.port !== '3306' || url.pathname !== `/${database}` || url.username !== user || !url.password || url.search || url.hash) throw new Error('Unexpected verification database target');
const results = { mode, databaseIdentity: false, markerWriteDenied: false, systemSchemaDenied: false, noDefaultIpv4Route: false, noDefaultIpv6Route: false, externalTcpDenied: false };
const connection = await mysql.createConnection(url.href);
async function denied(sql) {
  try { await connection.query(sql); }
  catch (error) {
    if ([1142, 1143, 1044].includes(error.errno)) return true;
    throw new Error('Privilege probe returned an unexpected error');
  }
  return false;
}
try {
  const [rows] = await connection.query("SELECT DATABASE() AS db,SUBSTRING_INDEX(CURRENT_USER(),'@',1) AS usr,task_id,target,profile,synthetic_only FROM capacity_test_identity");
  const row = rows[0];
  results.databaseIdentity = rows.length === 1 && row.db === database && row.usr === user && row.task_id === 'TASK-20260908-ISOLATED-SERVER-TEST' && row.target === '180.76.100.156' && row.profile === 'server-isolated-20260908' && row.synthetic_only === 1;
  if (!results.databaseIdentity) throw new Error('Identity verification failed before privilege probes');
  results.markerWriteDenied = await denied('UPDATE capacity_test_identity SET target=target WHERE 1=0');
  results.systemSchemaDenied = await denied('SELECT User FROM mysql.user WHERE 1=0');
} finally { await connection.end(); }
const ipv4 = await readFile('/proc/net/route', 'utf8');
results.noDefaultIpv4Route = !ipv4.trim().split('\n').slice(1).some(line => {
  const fields = line.trim().split(/\s+/);
  return fields[1] === '00000000' && fields[7] === '00000000' && (Number.parseInt(fields[3], 16) & 1) !== 0;
});
const ipv6 = await readFile('/proc/net/ipv6_route', 'utf8');
results.noDefaultIpv6Route = !ipv6.trim().split('\n').filter(Boolean).some(line => {
  const fields = line.trim().split(/\s+/);
  const flags = Number.parseInt(fields[8], 16);
  return fields[0] === '0'.repeat(32) && fields[1] === '00' && (flags & 1) !== 0 && (flags & 0x200) === 0;
});
// Public DNS provider address only. No HTTP, TLS handshake or business data,
// and no connection to any production or WeChat endpoint is attempted.
results.externalTcpDenied = await new Promise(resolve => {
  const socket = new Socket();
  let completed = false;
  const finish = value => { if (!completed) { completed = true; socket.destroy(); resolve(value); } };
  socket.setTimeout(3000);
  socket.once('connect', () => finish(false));
  socket.once('timeout', () => finish(true));
  socket.once('error', error => finish(['ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM', 'ETIMEDOUT'].includes(error.code)));
  socket.connect(443, '1.1.1.1');
});
console.log(JSON.stringify(results));
if (Object.entries(results).some(([key, value]) => key !== 'mode' && value !== true)) process.exitCode = 1;
