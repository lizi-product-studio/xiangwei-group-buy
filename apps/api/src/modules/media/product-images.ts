import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, statfs, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BusinessError } from '@hometown/domain';

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_DETAIL_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const filenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;
const defaultPrefix = '/api/v1/product-images/';
const formats: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
const directoryReservations = new Map<string, number>();
let activeDecoders = 0;
const MAX_ACTIVE_DECODERS = 2;
const invalid = (message = '请上传有效的 JPEG、PNG 或 WebP 单张图片（最多 5 MB、1600 万像素）') => new BusinessError('VALIDATION_ERROR', message, 400);
const missing = () => new BusinessError('RESOURCE_NOT_FOUND', '商品图片不存在', 404);
sharp.cache(false);
sharp.concurrency(1);

export type ProductImageOptions = {
  maxUploadBytes?: number;
  maxStoredBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxInputPixels?: number;
  uploadErrorMessage?: string;
  storageQuotaBytes?: number;
  minimumFreeBytes?: number;
};

export class ProductImages {
  private processing = false;
  private readonly options: Required<ProductImageOptions>;
  public constructor(private readonly directory: string, private readonly prefix = defaultPrefix, options: ProductImageOptions = {}) {
    this.options = {
      maxUploadBytes: options.maxUploadBytes ?? PRODUCT_IMAGE_MAX_BYTES,
      maxStoredBytes: options.maxStoredBytes ?? PRODUCT_IMAGE_MAX_BYTES,
      maxWidth: options.maxWidth ?? 1600,
      maxHeight: options.maxHeight ?? 1600,
      maxInputPixels: options.maxInputPixels ?? 16_000_000,
      uploadErrorMessage: options.uploadErrorMessage ?? '请上传有效的 JPEG、PNG 或 WebP 单张图片（最多 5 MB、1600 万像素）',
      storageQuotaBytes: options.storageQuotaBytes ?? 5 * 1024 * 1024 * 1024,
      minimumFreeBytes: options.minimumFreeBytes ?? 1024 * 1024 * 1024,
    };
  }
  public async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o750 });
    const disk = await statfs(this.directory);
    if (disk.bavail * disk.bsize < this.options.minimumFreeBytes) throw new Error('商品图片存储可用空间不足');
    const probe = resolve(this.directory, `.${randomUUID()}.probe`);
    const file = await open(probe, 'wx', 0o640);
    try { await file.writeFile(''); } finally { await file.close(); await unlink(probe); }
  }
  public async upload(input: Buffer, contentType: string): Promise<string> {
    if (!Buffer.isBuffer(input) || !input.length || input.length > this.options.maxUploadBytes || !formats[contentType]) throw invalid(this.options.uploadErrorMessage);
    if (this.processing) throw new BusinessError('RATE_LIMITED', '图片正在处理中，请稍后重试', 429);
    if (activeDecoders >= MAX_ACTIVE_DECODERS) throw new BusinessError('RATE_LIMITED', '图片处理繁忙，请稍后重试', 429);
    this.processing = true;
    activeDecoders += 1;
    let reserved = false;
    try {
      await this.reserveStorage();
      reserved = true;
      let output: Buffer;
      try {
        const image = sharp(input, { limitInputPixels: this.options.maxInputPixels, failOn: 'warning', sequentialRead: true });
        const metadata = await image.metadata();
        if (metadata.format !== formats[contentType] || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || metadata.width * metadata.height > this.options.maxInputPixels || metadata.height > this.options.maxHeight * 4) throw invalid(this.options.uploadErrorMessage);
        output = await image.rotate().resize({ width: this.options.maxWidth, height: this.options.maxHeight, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      } catch (error) { if (error instanceof BusinessError) throw error; throw invalid(this.options.uploadErrorMessage); }
      if (output.length > this.options.maxStoredBytes) throw invalid(this.options.uploadErrorMessage);
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
      return `${this.prefix}${name}`;
    } finally {
      if (reserved) directoryReservations.set(this.directory, Math.max(0, (directoryReservations.get(this.directory) ?? 0) - this.options.maxStoredBytes));
      activeDecoders = Math.max(0, activeDecoders - 1);
      this.processing = false;
    }
  }
  private async reserveStorage(): Promise<void> {
    const disk = await statfs(this.directory);
    const available = disk.bavail * disk.bsize;
    if (available < this.options.minimumFreeBytes + this.options.maxStoredBytes)
      throw new BusinessError('RESOURCE_IN_USE', '图片存储空间不足，请稍后清理后重试', 507);
    const entries = await readdir(this.directory);
    let used = 0;
    for (const entry of entries) {
      if (!filenamePattern.test(entry)) continue;
      const info = await stat(resolve(this.directory, entry));
      if (info.isFile()) used += info.size;
    }
    const reserved = directoryReservations.get(this.directory) ?? 0;
    if (used + reserved + this.options.maxStoredBytes > this.options.storageQuotaBytes)
      throw new BusinessError('RESOURCE_IN_USE', '图片存储配额已满，请稍后清理后重试', 507);
    directoryReservations.set(this.directory, reserved + this.options.maxStoredBytes);
  }
  public async read(name: string): Promise<Buffer> {
    if (!filenamePattern.test(name)) throw missing();
    try {
      const file = await open(resolve(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > this.options.maxStoredBytes) throw missing();
        return await file.readFile();
      } finally { await file.close(); }
    } catch { throw missing(); }
  }
  public async validateReference(imageUrl: string | null): Promise<void> {
    if (imageUrl?.startsWith(this.prefix)) await this.read(imageUrl.slice(this.prefix.length));
  }
}
