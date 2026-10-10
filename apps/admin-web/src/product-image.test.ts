import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.ts';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
describe('product image upload transport', () => {
  it('sends the original file with its MIME, cookie credentials, CSRF and abort signal', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'bearer');
    vi.resetModules();
    const { api, auth } = await import('./api.ts');
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    auth.save('image-test-csrf', ['SUPER_ADMIN'], 'image-test-user', 'image-test');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { imageUrl: '/api/v1/product-images/a.webp' } })));
    vi.stubGlobal('fetch', fetcher);
    const file = new File(['png'], 'photo.png', { type: 'image/png' });
    const signal = new AbortController().signal;
    await expect(api.uploadProductImage(file, signal)).resolves.toEqual({ imageUrl: '/api/v1/product-images/a.webp' });
    expect(fetcher).toHaveBeenCalledWith('/api/v1/admin/product-images', expect.objectContaining({ method: 'POST', body: file, signal, credentials: 'same-origin', headers: expect.objectContaining({ 'content-type': 'image/png', 'x-csrf-token': 'image-test-csrf' }) }));
  });
  it('rejects invalid MIME, empty and oversized files before requesting', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const file of [new File(['x'], 'x.svg', { type: 'image/svg+xml' }), new File([], 'x.png', { type: 'image/png' }), new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' })])
      await expect(api.uploadProductImage(file)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
