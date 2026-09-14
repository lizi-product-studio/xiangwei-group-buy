import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

// Deliberately fixed paths: never scan source, dependencies, dist or evidence.
const targets = [
  'apps/admin-web/coverage',
  'apps/api/coverage',
  'apps/miniprogram/coverage',
  'packages/api-contracts/coverage',
  'packages/domain/coverage',
  'apps/admin-web/test-results',
  'test-results',
  'playwright-report',
  'apps/admin-web/tsconfig.tsbuildinfo',
];
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const inside = (base, path) => path === base || path.startsWith(base + sep);

function checkPath(path) {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
  }
  if (git('ls-files', '-z', '--', path)) throw new Error(`Tracked path refused: ${path}`);
  // check-ignore exits nonzero when this path is not ignored: fail closed.
  git('check-ignore', '-q', '--', path);
}

function inventory() {
  const files = [];
  const directories = [];
  function visit(path) {
    checkPath(path);
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      directories.push(path);
      for (const name of readdirSync(absolute).sort()) visit(`${path}/${name}`);
    } else if (stat.isFile()) {
      files.push({ path, bytes: stat.size, sha256: sha256(absolute) });
    } else {
      throw new Error(`Non-regular file refused: ${path}`);
    }
  }
  for (const target of targets) {
    // lstat also notices dangling links that existsSync alone would miss.
    try { lstatSync(join(root, target)); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    visit(target);
  }
  return { files, directories };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: pnpm clean:artifacts [--dry-run]\n' +
      '       pnpm clean:artifacts --apply --archive-dir /absolute/new-directory\n' +
      'Stop test/build processes first. Apply archives every file before removing it.\n' +
      'The archive parent must already exist outside this repository.\n');
    return;
  }
  const apply = args[0] === '--apply';
  if (!(args.length === 0 || (args.length === 1 && args[0] === '--dry-run') ||
      (apply && args.length === 3 && args[1] === '--archive-dir' && isAbsolute(args[2])))) {
    throw new Error('Invalid arguments. Use --help; cleanup defaults to dry-run.');
  }
  if (realpathSync(git('rev-parse', '--show-toplevel').trim()) !== root) {
    throw new Error('Script must be located at the repository scripts/ directory.');
  }
  const before = inventory();
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    files: before.files,
    directories: before.directories,
    totalBytes: before.files.reduce((sum, file) => sum + file.bytes, 0),
  };
  if (!apply || (before.files.length === 0 && before.directories.length === 0)) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  const requested = resolve(args[2]);
  const archive = join(realpathSync(dirname(requested)), relative(dirname(requested), requested));
  if (inside(root, archive) || existsSync(archive)) {
    throw new Error('Archive must be a new directory outside the repository.');
  }
  mkdirSync(archive, { mode: 0o700 });
  const manifest = {
    ...report, repository: root, head: git('rev-parse', 'HEAD').trim(),
    createdAt: new Date().toISOString(), status: 'ARCHIVING', removed: [],
  };
  const save = () => writeFileSync(join(archive, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  save();
  for (const file of before.files) {
    const destination = join(archive, 'files', file.path);
    mkdirSync(dirname(destination), { recursive: true });
    checkPath(file.path);
    copyFileSync(join(root, file.path), destination);
    if (sha256(destination) !== file.sha256) throw new Error(`Archive verification failed: ${file.path}`);
  }
  // Detect files added or changed while archiving before the first removal.
  if (JSON.stringify(inventory()) !== JSON.stringify(before)) {
    throw new Error(`Artifacts changed while archiving; nothing removed. Archive: ${archive}`);
  }
  manifest.status = 'ARCHIVED';
  save();
  for (const file of before.files) {
    checkPath(file.path);
    if (sha256(join(root, file.path)) !== file.sha256) {
      throw new Error(`Artifact changed; stopping cleanup. Restore earlier files from ${archive}`);
    }
    unlinkSync(join(root, file.path));
    manifest.removed.push(file.path);
    save();
  }
  for (const path of [...before.directories].reverse()) {
    checkPath(path);
    // Never recursively remove: newly added files must stop cleanup.
    rmdirSync(join(root, path));
  }
  manifest.status = 'COMPLETE';
  save();
  process.stdout.write(JSON.stringify({ ...report, archive, status: manifest.status }, null, 2) + '\n');
}

try { main(); } catch (error) {
  process.stderr.write(`Artifact cleanup stopped: ${error.message}\n`);
  process.exitCode = 1;
}
