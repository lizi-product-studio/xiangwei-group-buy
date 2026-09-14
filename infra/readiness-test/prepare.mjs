import { randomBytes } from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import { mkdir, writeFile, lstat, chown, chmod } from 'node:fs/promises';
const root = '/opt/readiness-test-20260908';
if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Run only as root on the designated Linux test host');
const mysqlUid = Number(process.env.READINESS_MYSQL_UID);
const redisUid = Number(process.env.READINESS_REDIS_UID);
if (![mysqlUid, redisUid].every(value => Number.isSafeInteger(value) && value > 0 && value < 65536)) throw new Error('Supply verified container READINESS_MYSQL_UID and READINESS_REDIS_UID');
await mkdir(root, { recursive: true, mode: 0o700 });
if ((await lstat(root)).isSymbolicLink()) throw new Error('Test root cannot be a symlink');
await mkdir(`${root}/secrets`, { mode: 0o700 });
await mkdir(`${root}/evidence`, { recursive: true, mode: 0o700 });
const password = () => randomBytes(24).toString('hex');
const values = { MYSQL_ROOT_PASSWORD: password(), MIGRATOR_PASSWORD: password(), CAPACITY_PASSWORD: password(), INTEGRATION_PASSWORD: password(), REDIS_PASSWORD: password() };
const capacity = 'readiness_capacity_20260908';
const integration = 'readiness_integration_20260908';
let sql = `CREATE DATABASE ${capacity};\nCREATE DATABASE ${integration};\n`;
for (const db of [capacity, integration]) {
  sql += `CREATE TABLE ${db}.capacity_test_identity(task_id VARCHAR(80) NOT NULL,target VARCHAR(64) NOT NULL,profile VARCHAR(80) NOT NULL,synthetic_only TINYINT NOT NULL);\n`;
  sql += `INSERT INTO ${db}.capacity_test_identity VALUES ('TASK-20260908-ISOLATED-SERVER-TEST','180.76.100.156','server-isolated-20260908',1);\n`;
}
sql += `CREATE USER 'readiness_migrator'@'%' IDENTIFIED BY '${values.MIGRATOR_PASSWORD}';\n`;
for (const db of [capacity, integration]) sql += `GRANT ALL PRIVILEGES ON ${db}.* TO 'readiness_migrator'@'%';\n`;
let grants = '';
for (const [user, db, pass] of [['readiness_runner', capacity, values.CAPACITY_PASSWORD], ['readiness_integration', integration, values.INTEGRATION_PASSWORD]]) {
  sql += `CREATE USER '${user}'@'%' IDENTIFIED BY '${pass}';\nGRANT SELECT ON ${db}.capacity_test_identity TO '${user}'@'%';\n`;
  grants += `GRANT SELECT,INSERT,UPDATE,DELETE ON ${db}.community_product_state TO '${user}'@'%';\nGRANT SELECT ON ${db}.schema_migrations TO '${user}'@'%';\n`;
}
for (const [name, content] of Object.entries({
  '.env': Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n',
  'init.sql': sql,
  'grants.sql': grants,
  'redis.conf': `bind 0.0.0.0\nprotected-mode yes\nrequirepass ${values.REDIS_PASSWORD}\nmaxmemory 48mb\nmaxmemory-policy noeviction\nsave ""\nappendonly no\n`,
})) await writeFile(`${root}/secrets/${name}`, content, { mode: 0o600, flag: 'wx' });
for (const [name, uid] of [['init.sql', mysqlUid], ['redis.conf', redisUid]]) {
  await chown(`${root}/secrets/${name}`, uid, 0);
  await chmod(`${root}/secrets/${name}`, 0o400);
}
console.log('Created fresh isolated test credentials; values intentionally not printed.');
