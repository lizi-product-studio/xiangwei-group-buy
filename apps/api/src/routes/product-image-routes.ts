import { BusinessError } from '@hometown/domain';
import type { FastifyInstance } from 'fastify';
import { requireActor } from '../modules/auth/auth.js';
import type { CommerceStore } from '../modules/core/store.js';
import { PRODUCT_DETAIL_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MAX_BYTES, type ProductImages } from '../modules/media/product-images.js';

class ImageProcessingGate {
  private active = 0;
  public constructor(private readonly limit = 4) {}
  public acquire(): (() => void) | null {
    if (this.active >= this.limit) return null;
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}

export function registerProductImageRoutes(app: FastifyInstance, dependencies: { productImages: ProductImages; detailImages: ProductImages; profileImages: ProductImages; store: CommerceStore }): void {
  const { productImages, detailImages, profileImages, store } = dependencies;
  const gate = new ImageProcessingGate();
  const releases = new WeakMap<object, () => void>();
  // Encapsulation keeps binary parsing and its larger body limit off other APIs.
  app.register(async (scope) => {
    scope.addHook('onRequest', async (request) => {
      if (request.method !== 'POST') return;
      const release = gate.acquire();
      if (!release) throw new BusinessError('RATE_LIMITED', '图片处理繁忙，请稍后重试', 429);
      releases.set(request, release);
      request.raw.once('aborted', release);
    });
    scope.addHook('onResponse', async (request) => releases.get(request)?.());
    scope.addHook('onError', async (request) => releases.get(request)?.());
    scope.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp'], { parseAs: 'buffer', bodyLimit: PRODUCT_DETAIL_IMAGE_MAX_BYTES }, (_request, body, done) => done(null, body));
    scope.post('/api/v1/admin/product-images', {
      bodyLimit: PRODUCT_IMAGE_MAX_BYTES,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      onRequest: async (request) => { requireActor(request, ['OPERATOR', 'SUPER_ADMIN']); },
    }, async (request, reply) => {
      const imageUrl = await productImages.upload(request.body as Buffer, request.headers['content-type']?.split(';')[0]?.trim() ?? '');
      return reply.status(201).send({ data: { imageUrl } });
    });
    scope.post('/api/v1/admin/product-detail-images', {
      bodyLimit: PRODUCT_DETAIL_IMAGE_MAX_BYTES,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      onRequest: async (request) => { requireActor(request, ['OPERATOR', 'SUPER_ADMIN']); },
    }, async (request, reply) => {
      const imageUrl = await detailImages.upload(request.body as Buffer, request.headers['content-type']?.split(';')[0]?.trim() ?? '');
      return reply.status(201).send({ data: { imageUrl } });
    });
    scope.post('/api/v1/me/profile-image', {
      bodyLimit: PRODUCT_IMAGE_MAX_BYTES,
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      onRequest: async (request) => { requireActor(request, ['USER']); },
    }, async (request, reply) => {
      const imageUrl = await profileImages.upload(request.body as Buffer, request.headers['content-type']?.split(';')[0]?.trim() ?? '');
      return reply.status(201).send({ data: { imageUrl } });
    });
    scope.get<{ Params: { filename: string } }>('/api/v1/profile-images/:filename', async (request, reply) => {
      const actor = requireActor(request, ['USER']);
      const user = await store.getUser(actor.userId);
      const expected = `/api/v1/profile-images/${request.params.filename}`;
      if (!user || user.status !== 'ACTIVE' || user.avatarUrl !== expected)
        throw new BusinessError('RESOURCE_NOT_FOUND', '头像不存在', 404);
      const image = await profileImages.read(request.params.filename);
      return reply
        .type('image/webp')
        .header('Cross-Origin-Resource-Policy', 'same-origin')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store')
        .send(image);
    });
    scope.get<{ Params: { filename: string } }>('/api/v1/product-images/:filename', async (request, reply) => {
      const image = await detailImages.read(request.params.filename);
      return reply
        .type('image/webp')
        // The WeChat renderer fetches remote images from its own webview
        // origin. Helmet's default same-origin policy makes a successful
        // image response unusable there.
        .header('Cross-Origin-Resource-Policy', 'cross-origin')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(image);
    });
    scope.setErrorHandler((error, request, reply) => {
      const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
      if (status === 413) return reply.status(413).send({ code: 'VALIDATION_ERROR', message: request.url.startsWith('/api/v1/admin/product-detail-images') ? '详情图片不能超过 10 MB' : '图片不能超过 5 MB' });
      if (status === 415) return reply.status(415).send({ code: 'VALIDATION_ERROR', message: '仅支持 JPEG、PNG 或 WebP 图片' });
      throw error;
    });
  });
}
