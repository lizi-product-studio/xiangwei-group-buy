import type { FastifyInstance } from 'fastify';
import { requireActor } from '../modules/auth/auth.js';
import { PRODUCT_IMAGE_MAX_BYTES, type ProductImages } from '../modules/media/product-images.js';

export function registerProductImageRoutes(app: FastifyInstance, images: ProductImages): void {
  // Encapsulation keeps binary parsing and its larger body limit off other APIs.
  app.register(async (scope) => {
    scope.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp'], { parseAs: 'buffer', bodyLimit: PRODUCT_IMAGE_MAX_BYTES }, (_request, body, done) => done(null, body));
    scope.post('/api/v1/admin/product-images', {
      bodyLimit: PRODUCT_IMAGE_MAX_BYTES,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      onRequest: async (request) => { requireActor(request, ['OPERATOR', 'SUPER_ADMIN']); },
    }, async (request, reply) => {
      const imageUrl = await images.upload(request.body as Buffer, request.headers['content-type']?.split(';')[0]?.trim() ?? '');
      return reply.status(201).send({ data: { imageUrl } });
    });
    scope.get<{ Params: { filename: string } }>('/api/v1/product-images/:filename', async (request, reply) => {
      const image = await images.read(request.params.filename);
      return reply.type('image/webp').header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public, max-age=31536000, immutable').send(image);
    });
    scope.setErrorHandler((error, _request, reply) => {
      const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
      if (status === 413) return reply.status(413).send({ code: 'VALIDATION_ERROR', message: '图片不能超过 5 MB' });
      if (status === 415) return reply.status(415).send({ code: 'VALIDATION_ERROR', message: '仅支持 JPEG、PNG 或 WebP 图片' });
      throw error;
    });
  });
}
