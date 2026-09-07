import { createHmac, timingSafeEqual } from 'node:crypto';

/** Preserve the existing algorithm and secret: active credentials never change. */
export function pickupCode(orderId: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(`pickup:${orderId}`).digest('hex');
  return String(Number.parseInt(hex.slice(0, 12), 16) % 1_000_000).padStart(6, '0');
}
export function pickupCodeHash(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}
export function matchesPickupCode(code: string, hash: string, secret: string): boolean {
  const expected = Buffer.from(pickupCodeHash(code, secret));
  const actual = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
