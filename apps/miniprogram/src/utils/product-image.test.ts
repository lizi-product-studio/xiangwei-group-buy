import { describe, expect, it } from 'vitest';
import { resolveProductImageUrl } from './product-image';
import { resetProductImageState } from './product-image-state';
describe('public product image URLs', () => {
  it('resolves API paths against origin without duplicating API prefix', () => {
    expect(resolveProductImageUrl('/api/v1/product-images/a.webp', 'https://liziqi.icu/api/v1')).toBe('https://liziqi.icu/api/v1/product-images/a.webp');
    expect(resolveProductImageUrl('/api/v1/product-images/a.webp', 'http://127.0.0.1:3101')).toBe('http://127.0.0.1:3101/api/v1/product-images/a.webp');
  });
  it('preserves legacy external images and rejects missing or unsafe sources', () => {
    expect(resolveProductImageUrl('https://cdn.example.com/a.jpg', 'https://api.example.com')).toBe('https://cdn.example.com/a.jpg');
    for (const source of [null, undefined, '', ' ', 'javascript:alert(1)', '//other.example/a', '/assets/product-rice-noodle.jpg'])
      expect(resolveProductImageUrl(source, 'https://api.example.com')).toBe('');
  });
});

describe('product image render state', () => {
  it('resets and versions a same-src rebind so a reused wx:for node can load again', () => {
    const first = resetProductImageState('/api/v1/product-images/a.webp', 'https://api.example.com', 0);
    const second = resetProductImageState('/api/v1/product-images/a.webp', 'https://api.example.com', first.sourceVersion);
    expect(first.resolvedSrc).toBe(second.resolvedSrc);
    expect(first.sourceVersion).toBe(1);
    expect(second.sourceVersion).toBe(2);
    expect(second.loaded).toBe(false);
    expect(second.failed).toBe(false);
  });

  it('clears a stale source when a reused node receives a new or invalid binding', () => {
    const state = resetProductImageState('/assets/old.jpg', 'https://api.example.com', 4);
    expect(state).toEqual({ resolvedSrc: '', loaded: false, failed: false, sourceVersion: 5 });
  });
});
