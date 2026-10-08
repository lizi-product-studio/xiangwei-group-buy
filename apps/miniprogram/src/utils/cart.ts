const CART_KEY = 'standardCart';
const CHECKOUT_KEY = 'checkoutDraft';
const BATCH_CHECKOUT_KEY = 'multiCheckoutDraft';

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
  cutoffAt?: string;
  arrivalText?: string;
  items: CartLine[];
  updatedAt: number;
  orderIdempotencyKey?: string;
  selected?: boolean;
}

export interface MultiCheckoutDraft {
  groups: CartSnapshot[];
  idempotencyKey?: string;
  updatedAt: number;
  sourceCartGroups?: Array<Pick<CartSnapshot, 'campaignId' | 'pickupPointId' | 'updatedAt'>>;
}

export function cartGroupKey(cart: Pick<CartSnapshot, 'campaignId' | 'pickupPointId'>): string {
  return `${cart.campaignId}::${cart.pickupPointId}`;
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
    && (cart.orderIdempotencyKey === undefined || typeof cart.orderIdempotencyKey === 'string')
    && (cart.selected === undefined || typeof cart.selected === 'boolean');
}

function cartGroupsFrom(value: unknown): CartSnapshot[] {
  if (isCartSnapshot(value)) return value.items.length ? [{ ...value, selected: value.selected ?? true }] : [];
  if (value && typeof value === 'object' && Array.isArray((value as { groups?: unknown }).groups))
    return ((value as { groups: unknown[] }).groups)
      .filter((item): item is CartSnapshot => isCartSnapshot(item) && item.items.length > 0)
      .map((item) => ({ ...item, selected: item.selected ?? true }));
  if (value !== undefined && value !== null) wx.removeStorageSync(CART_KEY);
  return [];
}

export function readCartGroups(): CartSnapshot[] {
  const groups = cartGroupsFrom(wx.getStorageSync(CART_KEY));
  if (!groups.length) wx.removeStorageSync(CART_KEY);
  return groups;
}

export function readCart(): CartSnapshot | null {
  const groups = readCartGroups();
  if (!groups.length) return null;
  const activePoint = wx.getStorageSync<{ id?: string }>('selectedPickupPoint')?.id;
  return groups.find((group) => group.pickupPointId === activePoint) ?? groups[0] ?? null;
}

function writeCartGroups(groups: CartSnapshot[]): void {
  if (!groups.length) { wx.removeStorageSync(CART_KEY); return; }
  wx.setStorageSync(CART_KEY, {
    version: 2,
    groups: groups.map((group) => {
      const snapshot = { ...group, updatedAt: Date.now() };
      delete snapshot.orderIdempotencyKey;
      return snapshot;
    }),
  });
}

export function saveCart(cart: CartSnapshot): void { writeCartGroups([cart]); }
export function clearCart(): void { wx.removeStorageSync(CART_KEY); }

export function removeCartGroups(keys: string[]): void {
  const remove = new Set(keys);
  writeCartGroups(readCartGroups().filter((group) => !remove.has(cartGroupKey(group))));
}

export function removeCartGroupsIfUnchanged(expected: Array<Pick<CartSnapshot, 'campaignId' | 'pickupPointId' | 'updatedAt'>>): void {
  const byKey = new Map(expected.map((group) => [cartGroupKey(group), group.updatedAt]));
  if (!byKey.size) return;
  writeCartGroups(readCartGroups().filter((group) =>
    byKey.get(cartGroupKey(group)) !== group.updatedAt,
  ));
}

export function captureCartGroupVersions(groups: Array<Pick<CartSnapshot, 'campaignId' | 'pickupPointId'>>): Array<Pick<CartSnapshot, 'campaignId' | 'pickupPointId' | 'updatedAt'>> {
  const keys = new Set(groups.map(cartGroupKey));
  return readCartGroups()
    .filter((group) => keys.has(cartGroupKey(group)))
    .map(({ campaignId, pickupPointId, updatedAt }) => ({ campaignId, pickupPointId, updatedAt }));
}

export function setCartGroupSelected(key: string, selected: boolean): void {
  writeCartGroups(readCartGroups().map((group) => cartGroupKey(group) === key ? { ...group, selected } : group));
}

export function addCartLine(base: Omit<CartSnapshot, 'items' | 'updatedAt'>, line: CartLine): CartSnapshot {
  const groups = readCartGroups();
  const key = cartGroupKey(base as CartSnapshot);
  const index = groups.findIndex((group) => cartGroupKey(group) === key && group.serviceAreaId === base.serviceAreaId);
  const cart: CartSnapshot = index >= 0 ? groups[index]! : { ...base, items: [], selected: true, updatedAt: Date.now() };
  const existing = cart.items.find((item) => item.skuId === line.skuId);
  if (existing) existing.quantity = Math.min(existing.maxQuantity, existing.quantity + line.quantity);
  else cart.items.push({ ...line, quantity: Math.min(line.maxQuantity, line.quantity) });
  cart.selected = true;
  if (index >= 0) groups[index] = cart; else groups.push(cart);
  writeCartGroups(groups);
  return cart;
}

export function updateCartQuantity(skuId: string, quantity: number, groupKey?: string): CartSnapshot | null {
  const groups = readCartGroups();
  const cart = groups.find((value) => (!groupKey || cartGroupKey(value) === groupKey) && value.items.some((item) => item.skuId === skuId));
  if (!cart) return null;
  const line = cart.items.find((item) => item.skuId === skuId);
  if (!line) return null;
  line.quantity = Math.max(1, Math.min(line.maxQuantity, quantity));
  writeCartGroups(groups);
  return cart;
}

export function removeCartLine(skuId: string, groupKey?: string): CartSnapshot | null {
  const groups = readCartGroups();
  const cart = groups.find((value) => (!groupKey || cartGroupKey(value) === groupKey) && value.items.some((item) => item.skuId === skuId));
  if (!cart) return null;
  cart.items = cart.items.filter((item) => item.skuId !== skuId);
  writeCartGroups(groups.filter((group) => group.items.length));
  return cart.items.length ? cart : null;
}

export function cartCount(cart?: CartSnapshot | null): number {
  if (arguments.length > 0) return cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  return readCartGroups().reduce((sum, group) => sum + group.items.reduce((groupSum, item) => groupSum + item.quantity, 0), 0);
}

export function saveCheckoutDraft(draft: CartSnapshot): void { wx.setStorageSync(CHECKOUT_KEY, { ...draft, updatedAt: Date.now() }); }
export function readCheckoutDraft(): CartSnapshot | null {
  const value: unknown = wx.getStorageSync(CHECKOUT_KEY);
  if (isCartSnapshot(value)) return value;
  wx.removeStorageSync(CHECKOUT_KEY);
  return null;
}
export function clearCheckoutDraft(): void { wx.removeStorageSync(CHECKOUT_KEY); }

export function saveMultiCheckoutDraft(
  groups: CartSnapshot[],
  idempotencyKey?: string,
  sourceCartGroups: Array<Pick<CartSnapshot, 'campaignId' | 'pickupPointId' | 'updatedAt'>> = groups.map(({ campaignId, pickupPointId, updatedAt }) => ({ campaignId, pickupPointId, updatedAt })),
): void {
  wx.setStorageSync(BATCH_CHECKOUT_KEY, { groups, sourceCartGroups, updatedAt: Date.now(), ...(idempotencyKey ? { idempotencyKey } : {}) });
}
export function readMultiCheckoutDraft(): MultiCheckoutDraft | null {
  const value: unknown = wx.getStorageSync(BATCH_CHECKOUT_KEY);
  if (!value || typeof value !== 'object' || !Array.isArray((value as { groups?: unknown }).groups)) return null;
  const groups = (value as { groups: unknown[] }).groups.filter((item): item is CartSnapshot => isCartSnapshot(item) && item.items.length > 0);
  if (!groups.length) return null;
  const draft = value as { updatedAt?: number; idempotencyKey?: string; sourceCartGroups?: unknown };
  const sourceCartGroups = Array.isArray(draft.sourceCartGroups)
    ? draft.sourceCartGroups.filter((group): group is Pick<CartSnapshot, 'campaignId' | 'pickupPointId' | 'updatedAt'> =>
      Boolean(group && typeof group === 'object'
        && typeof (group as CartSnapshot).campaignId === 'string'
        && typeof (group as CartSnapshot).pickupPointId === 'string'
        && Number.isFinite((group as CartSnapshot).updatedAt)),
    )
    : undefined;
  return {
    groups,
    updatedAt: Number(draft.updatedAt) || Date.now(),
    ...(draft.idempotencyKey ? { idempotencyKey: draft.idempotencyKey } : {}),
    ...(sourceCartGroups ? { sourceCartGroups } : {}),
  };
}
export function clearMultiCheckoutDraft(): void { wx.removeStorageSync(BATCH_CHECKOUT_KEY); }
export function ensureMultiCheckoutIdempotencyKey(draft: MultiCheckoutDraft): MultiCheckoutDraft {
  if (draft.idempotencyKey) return draft;
  const next = { ...draft, idempotencyKey: `mini-batch-${Date.now()}-${Math.random().toString(36).slice(2, 14)}` };
  wx.setStorageSync(BATCH_CHECKOUT_KEY, next);
  return next;
}

export function ensureCheckoutIdempotencyKey(draft: CartSnapshot): CartSnapshot {
  if (draft.orderIdempotencyKey) return draft;
  const keyedDraft: CartSnapshot = {
    ...draft,
    orderIdempotencyKey: `mini-order-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`,
  };
  saveCheckoutDraft(keyedDraft);
  return keyedDraft;
}
