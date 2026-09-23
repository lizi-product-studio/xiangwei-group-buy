import { mkdtemp, rm, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductImages, PRODUCT_DETAIL_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MAX_BYTES } from './product-images.js';
const directories: string[] = [];
const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'product-image-test-'));
  directories.push(directory);
  const images = new ProductImages(directory);
  await images.initialize();
  return { directory, images };
};
const png = () => sharp({ create: { width: 2000, height: 500, channels: 3, background: 'red' } }).png().withMetadata().toBuffer();
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe('product image storage', () => {
  it('reencodes, strips metadata and persists across service restart', async () => {
    const { directory, images } = await setup();
    const url = await images.upload(await png(), 'image/png');
    expect(url).toMatch(/^\/api\/v1\/product-images\/[0-9a-f-]{36}\.webp$/);
    const restarted = new ProductImages(directory);
    await restarted.initialize();
    const buffer = await restarted.read(url.split('/').at(-1)!);
    const metadata = await sharp(buffer).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 1600, height: 400 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(await readdir(directory)).toEqual([url.split('/').at(-1)]);
  });
  it('rejects fake content, MIME mismatch, oversized bytes and pixels, then releases processor', async () => {
    const { images } = await setup();
    for (const [input, type] of [[Buffer.from('<svg/>'), 'image/png'], [await png(), 'image/jpeg'], [Buffer.alloc(PRODUCT_IMAGE_MAX_BYTES+1), 'image/png'], [Buffer.alloc(0), 'image/png']] as const) {
      await expect(images.upload(input, type)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    const huge = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: 'white' } }).png().toBuffer();
    await expect(images.upload(huge, 'image/png')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(images.upload(await png(), 'image/png')).resolves.toMatch(/webp$/);
  });
  it('rejects animated WebP even when its declared MIME is allowed', async () => {
    const { images } = await setup();
    const gif = Buffer.from('47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');
    const animated = await sharp(gif, { animated: true }).webp().toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(images.upload(animated, 'image/webp')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('rejects traversal, missing files, symlinks and nonexistent local references', async () => {
    const { images, directory } = await setup();
    for (const name of ['../secret', 'anything.png', '00000000-0000-4000-8000-000000000000.webp']) await expect(images.read(name)).rejects.toMatchObject({ statusCode: 404 });
    const target = join(directory, 'secret');
    await writeFile(target, 'private');
    const link = '11111111-1111-4111-8111-111111111111.webp';
    await symlink(target, join(directory, link));
    await expect(images.read(link)).rejects.toMatchObject({ statusCode: 404 });
    await expect(images.validateReference('/api/v1/product-images/missing.webp')).rejects.toMatchObject({ statusCode: 404 });
    await expect(images.validateReference('https://legacy.example/image.jpg')).resolves.toBeUndefined();
    await expect(images.validateReference(null)).resolves.toBeUndefined();
  });
  it('rejects concurrent decoding without queueing and recovers afterwards', async () => {
    const { images } = await setup();
    const input = await png();
    const first = images.upload(input, 'image/png');
    await expect(images.upload(input, 'image/png')).rejects.toMatchObject({ statusCode: 429 });
    await first;
    await expect(images.upload(input, 'image/png')).resolves.toMatch(/webp$/);
  });
  it('does not return a URL when persistence fails', async () => {
    const { directory } = await setup();
    const file = join(directory, 'not-directory');
    await writeFile(file, 'x');
    const images = new ProductImages(file);
    await expect(images.initialize()).rejects.toThrow();
    await expect(images.upload(await png(), 'image/png')).rejects.toThrow();
  });
  it('rejects uploads over a small storage quota without writing, then allows another instance with quota', async () => {
    const { directory, images } = await setup();
    const limited = new ProductImages(directory, undefined, { storageQuotaBytes: 0 });
    await expect(limited.upload(await png(), 'image/png')).rejects.toMatchObject({ statusCode: 507 });
    expect(await readdir(directory)).toEqual([]);
    await expect(images.upload(await png(), 'image/png')).resolves.toMatch(/webp$/);
    expect(await readdir(directory)).toHaveLength(1);
  });
  it('rejects uploads below the injected free-space reserve and releases the shared decoder gate', async () => {
    const { directory, images } = await setup();
    const lowSpace = new ProductImages(directory, undefined, { minimumFreeBytes: Number.MAX_SAFE_INTEGER });
    await expect(lowSpace.upload(await png(), 'image/png')).rejects.toMatchObject({ statusCode: 507 });
    expect(await readdir(directory)).toEqual([]);
    await expect(images.upload(await png(), 'image/png')).resolves.toMatch(/webp$/);
    expect(await readdir(directory)).toHaveLength(1);
  });
  it('keeps detail long-image content within the width/height guard and uses the 10 MB input limit', async () => {
    const { directory } = await setup();
    const detail = new ProductImages(directory, undefined, {
      maxUploadBytes: PRODUCT_DETAIL_IMAGE_MAX_BYTES,
      maxStoredBytes: PRODUCT_DETAIL_IMAGE_MAX_BYTES,
      maxWidth: 1200,
      maxHeight: 20_000,
      maxInputPixels: 40_000_000,
    });
    await detail.initialize();
    const input = await sharp({ create: { width: 1600, height: 3000, channels: 3, background: 'white' } }).png().toBuffer();
    const url = await detail.upload(input, 'image/png');
    const metadata = await sharp(await detail.read(url.split('/').at(-1)!)).metadata();
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(2250);
    await expect(detail.upload(Buffer.alloc(PRODUCT_DETAIL_IMAGE_MAX_BYTES + 1), 'image/png')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
