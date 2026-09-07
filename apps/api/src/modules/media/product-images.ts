import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, statfs } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BusinessError } from '@hometown/domain';

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const filenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;
const prefix = '/api/v1/product-images/';
const formats: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
const invalid = () => new BusinessError('VALIDATION_ERROR', '请上传有效的 JPEG、PNG 或 WebP 单张图片（最多 5 MB、1600 万像素）', 400);
const missing = () => new BusinessError('RESOURCE_NOT_FOUND', '商品图片不存在', 404);
sharp.cache(false);
sharp.concurrency(1);

export class ProductImages {
  private processing = false;
  public constructor(private readonly directory: string) {}
  public async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o750 });
    const disk = await statfs(this.directory);
    if (disk.bavail * disk.bsize < 10 * 1024 * 1024) throw new Error('商品图片存储可用空间不足');
    const probe = resolve(this.directory, `.${randomUUID()}.probe`);
    const file = await open(probe, 'wx', 0o640);
    try { await file.writeFile(''); } finally { await file.close(); await unlink(probe); }
  }
  public async upload(input: Buffer, contentType: string): Promise<string> {
    if (!Buffer.isBuffer(input) || !input.length || input.length > PRODUCT_IMAGE_MAX_BYTES || !formats[contentType]) throw invalid();
    if (this.processing) throw new BusinessError('RATE_LIMITED', '图片正在处理中，请稍后重试', 429);
    this.processing = true;
    try {
      let output: Buffer;
      try {
        const image = sharp(input, { limitInputPixels: 16_000_000, failOn: 'warning', sequentialRead: true });
        const metadata = await image.metadata();
        if (metadata.format !== formats[contentType] || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || metadata.width * metadata.height > 16_000_000) throw invalid();
        output = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      } catch { throw invalid(); }
      await mkdir(this.directory, { recursive: true, mode: 0o750 });
      const name = `${randomUUID()}.webp`;
      const temporary = resolve(this.directory, `.${name}.tmp`);
      try {
        const file = await open(temporary, 'wx', 0o640);
        try { await file.writeFile(output); await file.sync(); } finally { await file.close(); }
        await rename(temporary, resolve(this.directory, name));
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return `${prefix}${name}`;
    } finally { this.processing = false; }
  }
  public async read(name: string): Promise<Buffer> {
    if (!filenamePattern.test(name)) throw missing();
    try {
      const file = await open(resolve(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > PRODUCT_IMAGE_MAX_BYTES) throw missing();
        return await file.readFile();
      } finally { await file.close(); }
    } catch { throw missing(); }
  }
  public async validateReference(imageUrl: string | null): Promise<void> {
    if (imageUrl?.startsWith(prefix)) await this.read(imageUrl.slice(prefix.length));
  }
}
