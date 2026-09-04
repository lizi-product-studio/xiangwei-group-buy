import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(appRoot, 'src');
const avatarSourcePath = 'src/assets/mini-program-avatar-helin.png';
const avatarPackPath = 'assets/mini-program-avatar-helin.png';

function sourceBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return total + sourceBytes(absolutePath);
    if (relative(appRoot, absolutePath) === avatarSourcePath) return total;
    return total + statSync(absolutePath).size;
  }, 0);
}

describe('mini-program upload package assets', () => {
  it('excludes only the unreferenced pending avatar and keeps source below 1.2 MiB', () => {
    const projectConfig = JSON.parse(readFileSync(join(appRoot, 'project.config.json'), 'utf8'));

    expect(projectConfig.miniprogramRoot).toBe('src/');
    expect(projectConfig.packOptions.ignore).toEqual([
      {
        type: 'file',
        value: avatarPackPath,
      },
    ]);
    expect(sourceBytes(sourceRoot)).toBeLessThanOrEqual(Math.floor(1.2 * 1024 * 1024));
  });

  it('uses optimized home artwork while preserving transparent category icons', () => {
    const homeMarkup = readFileSync(join(sourceRoot, 'pages/home/index.wxml'), 'utf8');
    const largeArtwork = ['header-gate-ink.jpg', 'hero-sorghum-field.jpg'];
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
    expect(homeMarkup).not.toContain('/assets/header-gate-ink.png');
    expect(homeMarkup).not.toContain('/assets/hero-sorghum-field.png');

    for (const filename of categoryIcons) {
      expect(statSync(join(sourceRoot, 'assets', filename)).size).toBeLessThan(20 * 1024);
    }
  });
});
