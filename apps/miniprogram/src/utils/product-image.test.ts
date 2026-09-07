import { describe, expect, it } from 'vitest';
import { resolveProductImageUrl } from './product-image';
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
