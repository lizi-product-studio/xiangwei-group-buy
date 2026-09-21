import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classifyChanges, changesSince, planChanges, gatePasses } from './ci-scope.mjs';

for (const [label, paths, expected] of [
  ['documentation', ['AGENTS.md', 'docs/task.md'], { checks: false, browser: false, images: [] }],
  ['admin UI', ['apps/admin-web/src/App.tsx'], { api: false, admin: true, mini: false, browser: true, images: ['admin'] }],
  ['API', ['apps/api/src/app.ts'], { api: true, admin: false, browser: true, images: ['api'] }],
  ['mini-program', ['apps/miniprogram/src/pages/home/index.wxml'], { mini: true, browser: false, images: [] }],
  ['browser tests only', ['apps/admin-web/e2e/governance-ui.spec.ts'], { checks: false, browser: true, images: [] }],
  ['unit tests only', ['apps/api/src/orders.test.ts'], { api: true, browser: true, images: [] }],
  ['API spec may compile into runtime', ['apps/api/src/orders.spec.ts'], { api: true, images: ['api'] }],
  ['mixed UI and tests', ['apps/admin-web/src/App.tsx', 'apps/api/src/orders.test.ts'], { api: true, admin: true, images: ['admin'] }],
  ['shared contract', ['packages/api-contracts/src/index.ts'], { full: true, mini: true, images: ['admin', 'api'] }],
  ['workspace manifest', ['apps/miniprogram/package.json'], { full: true, images: ['admin', 'api'] }],
  ['migration', ['infra/mysql/migrations/0003.sql'], { full: true, api: true }],
  ['unknown script in docs', ['docs/verify.mjs'], { full: true }],
  ['workflow change', ['.github/workflows/quality.yml'], { full: true }],
  ['scope implementation', ['scripts/ci-scope.mjs'], { full: true }],
  ['unknown file', ['new-runtime.config'], { full: true }],
]) test(label, () => {
  const actual = classifyChanges(paths);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, key);
});

test('manual validation and unavailable baseline are full', () => {
  assert.equal(planChanges(undefined).full, true);
  assert.equal(planChanges('bad').full, true);
  assert.equal(planChanges(undefined, 'HEAD', undefined, true).full, true);
});

test('gate rejects failures, cancellation, missing results and unexpected skips', () => {
  const scope = classifyChanges(['apps/admin-web/src/App.tsx']);
  const results = { scope: 'success', checks: 'success', browser: 'success', images: 'success' };
  assert.equal(gatePasses(scope, results), true);
  for (const job of Object.keys(results)) for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.equal(gatePasses(scope, { ...results, [job]: result }), false);
  }
  const docs = classifyChanges(['AGENTS.md']);
  assert.equal(gatePasses(docs, { scope: 'success', checks: 'skipped', browser: 'skipped', images: 'skipped' }), true);
  assert.equal(gatePasses(docs, { scope: 'failure', checks: 'skipped', browser: 'skipped', images: 'skipped' }), false);
});

test('successful baseline retains failed intermediate code; deletes and renames retain old scope', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ci-scope-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    git('init'); git('config', 'user.name', 'Scope Test'); git('config', 'user.email', 'scope@example.invalid');
    writeFileSync(join(cwd, 'README.md'), 'baseline'); git('add', '.'); git('commit', '-m', 'passed');
    const passed = git('rev-parse', 'HEAD');
    mkdirSync(join(cwd, 'apps/api/src'), { recursive: true });
    writeFileSync(join(cwd, 'apps/api/src/app.ts'), 'unverified code'); git('add', '.'); git('commit', '-m', 'failed');
    writeFileSync(join(cwd, 'README.md'), 'docs follow-up'); git('add', '.'); git('commit', '-m', 'docs');
    assert.equal(planChanges(passed, 'HEAD', cwd).api, true);
    const beforeRename = git('rev-parse', 'HEAD');
    mkdirSync(join(cwd, 'docs')); renameSync(join(cwd, 'apps/api/src/app.ts'), join(cwd, 'docs/archive.md'));
    git('add', '-A'); git('commit', '-m', 'rename');
    assert.deepEqual(changesSince(beforeRename, 'HEAD', cwd).sort(), ['apps/api/src/app.ts', 'docs/archive.md']);
    assert.deepEqual(planChanges(beforeRename, 'HEAD', cwd).images, ['api']);
    assert.equal(planChanges('a'.repeat(40), 'HEAD', cwd).full, true);
    assert.equal(planChanges(git('rev-parse', 'HEAD'), passed, cwd).full, true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
