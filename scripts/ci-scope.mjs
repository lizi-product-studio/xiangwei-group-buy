/* global process */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Deliberately narrow allowlists. Unknown paths and missing baselines run everything.
export function classifyChanges(paths, forceFull = false) {
  const scope = { full: forceFull, api: false, admin: false, mini: false, shared: false, browser: false, images: [] };
  const images = new Set();
  for (const path of paths) {
    if (path === 'AGENTS.md' || path === 'README.md' || /^docs\/.*\.md$/.test(path)) continue;
    if (path.startsWith('apps/admin-web/e2e/') || path === 'playwright.config.ts' || path === 'apps/admin-web/tsconfig.e2e.json') {
      scope.browser = true;
      continue;
    }
    // Manifests affect workspace installation and the API image copies all of them.
    if (/(^|\/)package\.json$/.test(path)) { scope.full = true; continue; }
    const app = path.match(/^apps\/(api|admin-web|miniprogram)\//)?.[1];
    if (app) {
      const key = { api: 'api', 'admin-web': 'admin', miniprogram: 'mini' }[app];
      scope[key] = true;
      if (app !== 'miniprogram') {
        scope.browser = true;
        // API's tsconfig excludes only *.test.ts; other names may ship in dist.
        const testOnly = app === 'api' ? /\.test\.ts$/.test(path) : /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
        if (!testOnly) images.add(app === 'api' ? 'api' : 'admin');
      }
      continue;
    }
    scope.full = true;
  }
  if (scope.full) {
    for (const key of ['api', 'admin', 'mini', 'shared', 'browser']) scope[key] = true;
    images.add('api'); images.add('admin');
  }
  scope.images = [...images].sort();
  scope.checks = scope.api || scope.admin || scope.mini || scope.shared;
  return scope;
}

export function changesSince(base, head = 'HEAD', cwd = process.cwd()) {
  if (!/^[0-9a-f]{40}$/.test(base ?? '')) throw new Error('A full verified baseline SHA is required');
  execFileSync('git', ['merge-base', '--is-ancestor', base, head], { cwd, stdio: 'pipe' });
  // No rename detection: both old and new paths must contribute to the scope.
  return execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
}

export function planChanges(base, head = 'HEAD', cwd = process.cwd(), forceFull = false) {
  if (forceFull) return { ...classifyChanges([], true), reason: 'Explicit full validation' };
  try {
    const paths = changesSince(base, head, cwd);
    return { ...classifyChanges(paths), base, paths, reason: 'Changes since successful ancestor' };
  } catch {
    return { ...classifyChanges([], true), reason: 'No usable successful ancestor; full validation required' };
  }
}

export function gatePasses(scope, results) {
  return results.scope === 'success' &&
    results.checks === (scope.checks ? 'success' : 'skipped') &&
    results.browser === (scope.browser ? 'success' : 'skipped') &&
    results.images === (scope.images.length ? 'success' : 'skipped');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = planChanges(process.env.CI_BASE, 'HEAD', process.cwd(), process.env.CI_FULL === 'true');
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    for (const key of ['full', 'api', 'admin', 'mini', 'shared', 'browser', 'checks', 'images']) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${JSON.stringify(plan[key])}\n`);
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Validation scope\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`);
}
