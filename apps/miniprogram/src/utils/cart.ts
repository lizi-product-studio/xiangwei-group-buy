const CART_KEY = 'standardCart';
const CHECKOUT_KEY = 'checkoutDraft';

export interface CartLine {
  skuId: string;
  title: string;
  skuName: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  maxQuantity: number;
}

export interface CartSnapshot {
  source?: 'cart' | 'buyNow';
  campaignId: string;
  campaignTitle: string;
  serviceAreaId: string;
  serviceAreaName: string;
  pickupPointId: string;
  pickupPointName: string;
  pickupPointAddress: string;
  items: CartLine[];
  updatedAt: number;
  /** Reused after a lost create-order response; never stored in the cart itself. */
  orderIdempotencyKey?: string;
}

export function isCartSnapshot(value: unknown): value is CartSnapshot {
  if (!value || typeof value !== 'object') return false;
  const cart = value as Partial<CartSnapshot>;
  return typeof cart.campaignId === 'string'
    && typeof cart.campaignTitle === 'string'
    && typeof cart.serviceAreaId === 'string'
    && typeof cart.serviceAreaName === 'string'
    && typeof cart.pickupPointId === 'string'
    && typeof cart.pickupPointName === 'string'
    && typeof cart.pickupPointAddress === 'string'
    && Array.isArray(cart.items)
    && (cart.orderIdempotencyKey === undefined || typeof cart.orderIdempotencyKey === 'string');
}

export function readCart(): CartSnapshot | null {
  const value: unknown = wx.getStorageSync(CART_KEY);
  if (isCartSnapshot(value) && value.items.length) return value;
  // Carts created before pickup-point binding cannot be safely checked out.
  wx.removeStorageSync(CART_KEY);
  return null;
}

export function saveCart(cart: CartSnapshot): void {
  const snapshot = { ...cart, updatedAt: Date.now() };
  delete snapshot.orderIdempotencyKey;
  wx.setStorageSync(CART_KEY, snapshot);
}

export function clearCart(): void { wx.removeStorageSync(CART_KEY); }

export function addCartLine(base: Omit<CartSnapshot, 'items' | 'updatedAt'>, line: CartLine): CartSnapshot {
  const current = readCart();
  const compatible = current && current.campaignId === base.campaignId && current.serviceAreaId === base.serviceAreaId && current.pickupPointId===base.pickupPointId;
  const cart: CartSnapshot = compatible ? current : { ...base, items: [], updatedAt: Date.now() };
  const existing = cart.items.find((item) => item.skuId === line.skuId);
  if (existing) existing.quantity = Math.min(existing.maxQuantity, existing.quantity + line.quantity);
  else cart.items.push({ ...line, quantity: Math.min(line.maxQuantity, line.quantity) });
  saveCart(cart);
  return cart;
}

export function updateCartQuantity(skuId: string, quantity: number): CartSnapshot | null {
  const cart = readCart(); if (!cart) return null;
  const line = cart.items.find((item) => item.skuId === skuId); if (!line) return cart;
  line.quantity = Math.max(1, Math.min(line.maxQuantity, quantity)); saveCart(cart); return cart;
}

export function removeCartLine(skuId: string): CartSnapshot | null {
  const cart = readCart(); if (!cart) return null;
  cart.items = cart.items.filter((item) => item.skuId !== skuId);
  if (!cart.items.length) { clearCart(); return null; }
  saveCart(cart); return cart;
}

export function cartCount(cart: CartSnapshot | null = readCart()): number {
  return cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
}

export function saveCheckoutDraft(draft: CartSnapshot): void { wx.setStorageSync(CHECKOUT_KEY, { ...draft, updatedAt: Date.now() }); }
export function readCheckoutDraft(): CartSnapshot | null {
  const value: unknown = wx.getStorageSync(CHECKOUT_KEY);
  if (isCartSnapshot(value)) return value;
  // Do not let a legacy or partially written draft submit an order without its pickup point.
  wx.removeStorageSync(CHECKOUT_KEY);
  return null;
}
export function clearCheckoutDraft(): void { wx.removeStorageSync(CHECKOUT_KEY); }

export function ensureCheckoutIdempotencyKey(draft: CartSnapshot): CartSnapshot {
  if (draft.orderIdempotencyKey) return draft;
  const keyedDraft: CartSnapshot = {
    ...draft,
    orderIdempotencyKey: `mini-order-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`,
  };
  saveCheckoutDraft(keyedDraft);
  return keyedDraft;
}
