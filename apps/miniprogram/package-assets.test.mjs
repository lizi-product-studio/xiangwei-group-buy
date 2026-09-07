import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(appRoot, 'src');
const avatarPackPath = 'assets/mini-program-avatar-helin.png';
const testSuffixes = ['.test.ts', '.spec.ts', '.test.js', '.spec.js'];
const expectedIgnoreRules = [
  { type: 'file', value: avatarPackPath },
  ...testSuffixes.map((value) => ({ type: 'suffix', value })),
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(absolutePath) : [absolutePath];
  });
}

function matchesIgnoreRule(sourceRelativePath, rule) {
  const normalizedPath = sourceRelativePath.toLowerCase();
  const normalizedValue = rule.value.toLowerCase();
  if (rule.type === 'file') return normalizedPath === normalizedValue;
  if (rule.type === 'suffix') return normalizedPath.endsWith(normalizedValue);
  throw new Error(`Unsupported pack ignore rule in test contract: ${rule.type}`);
}

describe('mini-program upload package assets', () => {
  it('excludes only the pending avatar and test sources, keeping the upload source below 1.2 MiB', () => {
    const projectConfig = JSON.parse(readFileSync(join(appRoot, 'project.config.json'), 'utf8'));
    const files = sourceFiles(sourceRoot);
    const relativeFiles = files.map((file) => relative(sourceRoot, file));
    const isIgnored = (file) => expectedIgnoreRules.some((rule) => matchesIgnoreRule(file, rule));
    const discoveredTests = relativeFiles.filter((file) => /\.(?:test|spec)\.(?:ts|js)$/i.test(file));
    const runtimeFiles = relativeFiles.filter(
      (file) => file !== avatarPackPath && !/\.(?:test|spec)\.(?:ts|js)$/i.test(file),
    );

    expect(projectConfig.miniprogramRoot).toBe('src/');
    expect(projectConfig.packOptions.ignore).toEqual(expectedIgnoreRules);
    expect(discoveredTests.length).toBeGreaterThan(0);
    expect(discoveredTests.every(isIgnored)).toBe(true);
    expect(runtimeFiles.some(isIgnored)).toBe(false);
    expect(['utils/example.test.js', 'utils/example.spec.js'].every(isIgnored)).toBe(true);

    const uploadSourceBytes = files.reduce((total, file) => {
      const sourceRelativePath = relative(sourceRoot, file);
      return isIgnored(sourceRelativePath) ? total : total + statSync(file).size;
    }, 0);
    expect(uploadSourceBytes).toBeLessThanOrEqual(Math.floor(1.2 * 1024 * 1024));
  });

  it('uses optimized home artwork while preserving transparent category icons', () => {
    const homeMarkup = readFileSync(join(sourceRoot, 'pages/home/index.wxml'), 'utf8');
    const largeArtwork = ['hero-sorghum-field.jpg'];
    const categoryIcons = [
      'category-icon-leaf.png',
      'category-icon-grain.png',
      'category-icon-beans.png',
      'category-icon-ready-food.png',
      'category-icon-seasoning.png',
    ];

    for (const filename of largeArtwork) {
      expect(homeMarkup).toContain(`/assets/${filename}`);
      expect(statSync(join(sourceRoot, 'assets', filename)).size).toBeLessThan(150 * 1024);
    }
    // The approved redesign removes the decorative gate from the homepage.
    expect(homeMarkup).not.toContain('/assets/header-gate-ink.');
    expect(homeMarkup).not.toContain('/assets/hero-sorghum-field.png');

    for (const filename of categoryIcons) {
      expect(statSync(join(sourceRoot, 'assets', filename)).size).toBeLessThan(20 * 1024);
    }
  });
});
