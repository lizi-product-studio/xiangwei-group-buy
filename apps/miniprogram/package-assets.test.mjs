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
  it('uses three tabs and keeps the legacy category route registered as a page', () => {
    const appConfig = JSON.parse(readFileSync(join(sourceRoot, 'app.json'), 'utf8'));
    expect(appConfig.tabBar.list.map((item) => item.pagePath)).toEqual([
      'pages/home/index', 'pages/cart/index', 'pages/profile/index',
    ]);
    expect(appConfig.pages).toContain('pages/category/index');
  });
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
      'category-icon-all.png',
      'category-icon-basket.png',
      'category-icon-leaf.png',
      'category-icon-grain.png',
      'category-icon-beans.png',
      'category-icon-ready-food.png',
      'category-icon-seasoning.png',
      'category-icon-fruit.png',
      'category-icon-tools.png',
    ];

    for (const filename of largeArtwork) {
      expect(homeMarkup).toContain(`/assets/${filename}`);
      expect(statSync(join(sourceRoot, 'assets', filename)).size).toBeLessThan(150 * 1024);
    }
    // The approved redesign removes the decorative gate from the homepage.
    expect(homeMarkup).not.toContain('/assets/header-gate-ink.');
    expect(homeMarkup).not.toContain('/assets/hero-sorghum-field.png');

    for (const filename of categoryIcons) {
      const assetPath = join(sourceRoot, 'assets', filename);
      const asset = readFileSync(assetPath);
      expect(statSync(assetPath).size).toBeLessThan(20 * 1024);
      expect(asset.readUInt32BE(16)).toBe(120);
      expect(asset.readUInt32BE(20)).toBe(120);
    }
  });

  it('renders uploaded product images without cropping and does not invent pickup-point photos', () => {
    const homeMarkup = readFileSync(join(sourceRoot, 'pages/home/index.wxml'), 'utf8');
    const productImageStyles = readFileSync(join(sourceRoot, 'components/product-image/index.wxss'), 'utf8');
    const categoryMarkup = readFileSync(join(sourceRoot, 'pages/category/index.wxml'), 'utf8');
    const detailMarkup = readFileSync(join(sourceRoot, 'pages/campaign/detail.wxml'), 'utf8');

    expect(homeMarkup).toContain('wx:else class="product-photo product-photo--single"');
    expect(homeMarkup).toContain('src="{{product.imageUrls[0]}}"');
    expect(homeMarkup).toContain('class="ui-view home"');
    expect(homeMarkup).toContain('auto-aspect="{{true}}" image-mode="aspectFit" style="height:auto"');
    expect(homeMarkup).not.toContain('wx:for="{{item.imageUrls}}"');
    expect(detailMarkup).toContain('wx:for="{{gallery}}"');
    expect(homeMarkup).toContain('image-mode="aspectFit"');
    expect(productImageStyles).toContain('.product-image--auto-aspect { height: auto; }');
    expect(categoryMarkup).toContain('image-mode="aspectFit"');
    expect(detailMarkup).toContain('image-mode="aspectFit"');
    expect(detailMarkup).toContain("pickupPoint.photoUrl || ''");
    expect(detailMarkup).toContain('mode="widthFix"');
    expect(detailMarkup).not.toContain('/assets/pickup-point.jpg');
  });

  it('shows only the cover on the home card and reserves space for long prices', () => {
    const homeMarkup = readFileSync(join(sourceRoot, 'pages/home/index.wxml'), 'utf8');
    const homeStyles = readFileSync(join(sourceRoot, 'pages/home/index.wxss'), 'utf8');

    expect(homeMarkup).toContain('wx:if="{{product.imageUrls.length > 1}}" class="product-photo__count"');
    expect(homeStyles).toContain('.product-photo--single{position:relative;height:auto;aspect-ratio:auto}');
    expect(homeStyles).toContain('.product-card__price-copy{display:flex;flex:1;min-width:0;flex-direction:column;align-items:flex-start}');
    expect(homeStyles).toContain('overflow-wrap:anywhere');
  });
});
