import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
let app: FastifyInstance | undefined;
let directory: string;
afterEach(async () => { await app?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
describe('product image HTTP boundary', () => {
  it('authorizes before parsing, limits body bytes and exposes only validated public files', async () => {
    directory = await mkdtemp(join(tmpdir(), 'product-image-api-'));
    app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', PRODUCT_IMAGE_DIR: directory }) });
    const url = '/api/v1/admin/product-images';
    const input = await sharp({ create: { width: 3, height: 3, channels: 3, background: 'red' } }).png().toBuffer();
    for (const role of ['USER', 'PICKUP_MANAGER', 'FINANCE', 'CUSTOMER_SERVICE']) {
      const denied = await app.inject({ method: 'POST', url, headers: { 'x-demo-user-id': role, 'x-demo-role': role, 'content-type': 'image/png' }, payload: Buffer.alloc(6*1024*1024) });
      expect(denied.statusCode).toBe(403);
    }
    const headers = { 'x-demo-user-id': 'operator', 'x-demo-role': 'OPERATOR', 'content-type': 'image/png' };
    expect((await app.inject({ method: 'POST', url, headers, payload: Buffer.alloc(5*1024*1024+1) })).statusCode).toBe(413);
    expect((await app.inject({ method: 'POST', url, headers, payload: Buffer.from('fake-image') })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: { ...headers, 'content-type': 'image/svg+xml' }, payload: '<svg/>' })).statusCode).toBe(415);
    const uploaded = await app.inject({ method: 'POST', url, headers, payload: input });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const imageUrl = uploaded.json().data.imageUrl as string;
    const superUpload = await app.inject({ method: 'POST', url, headers: { ...headers, 'x-demo-role': 'SUPER_ADMIN' }, payload: input });
    expect(superUpload.statusCode).toBe(201);
    const sku = { title: '真实测试商品', category: '蔬菜', origin: '本地', skuName: '一份', retailPriceCents: 1200, status: 'ACTIVE' };
    const jsonHeaders = { ...headers, 'content-type': 'application/json' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/catalog/skus', headers: jsonHeaders, payload: { ...sku, imageUrl: '/api/v1/product-images/00000000-0000-4000-8000-000000000000.webp' } })).statusCode).toBe(404);
    const saved = await app.inject({ method: 'POST', url: '/api/v1/admin/catalog/skus', headers: jsonHeaders, payload: { ...sku, imageUrl } });
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().data.product.imageUrl).toBe(imageUrl);

    const image = await app.inject({ method: 'GET', url: imageUrl });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/webp');
    expect(image.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['cache-control']).toContain('immutable');
    expect((await app.inject({ method: 'GET', url: '/api/v1/product-images/not-a-file.webp' })).statusCode).toBe(404);
  });
});
