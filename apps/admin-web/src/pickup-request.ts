export type PickupRequestLine = { platformSkuId: string; quantity: number };

export type PickupRequestInput = {
  orderId: string;
  deliveryPlanId: string;
  items: PickupRequestLine[];
};

export type PendingPickupRequest = PickupRequestInput & {
  pickupRequestId: string;
  state: 'PENDING' | 'CONFIRMED';
};

export type PickupRequestStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'hometown-community-pickup-v2';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_CODES = new Set([
  'ACTIVATION_REQUIRED', 'FORBIDDEN', 'VALIDATION_ERROR', 'RESOURCE_NOT_FOUND', 'IDEMPOTENCY_CONFLICT',
  'INVALID_STATE_TRANSITION', 'PICKUP_CODE_UNAVAILABLE', 'PICKUP_CODE_EXPIRED', 'PICKUP_CODE_INVALID', 'UPGRADE_REQUIRED',
]);

export function normalizePickupRequestItems(items: PickupRequestLine[]): PickupRequestLine[] {
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) continue;
    quantities.set(item.platformSkuId, (quantities.get(item.platformSkuId) ?? 0) + item.quantity);
  }
  return [...quantities.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([platformSkuId, quantity]) => ({ platformSkuId, quantity }));
}

export function mapPickupRequestItemsToOrder<T extends { skuId: string; remainingPickupQuantity: number }>(
  orderItems: T[],
  selectedItems: PickupRequestLine[],
): PickupRequestLine[] {
  const selected = new Map(normalizePickupRequestItems(selectedItems).map((item) => [item.platformSkuId, item.quantity]));
  return orderItems.map((item) => ({ platformSkuId: item.skuId, quantity: selected.get(item.skuId) ?? 0 }));
}

function operationKey(input: Pick<PickupRequestInput, 'orderId' | 'deliveryPlanId'>): string {
  return `${PREFIX}:operation:${input.orderId}:${input.deliveryPlanId}`;
}

function sameItems(left: PickupRequestLine[], right: PickupRequestLine[]): boolean {
  return JSON.stringify(normalizePickupRequestItems(left)) === JSON.stringify(normalizePickupRequestItems(right));
}

function isPendingPickupRequest(value: unknown): value is PendingPickupRequest {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PendingPickupRequest>;
  return typeof record.orderId === 'string' && typeof record.deliveryPlanId === 'string'
    && typeof record.pickupRequestId === 'string' && UUID_PATTERN.test(record.pickupRequestId)
    && (record.state === 'PENDING' || record.state === 'CONFIRMED')
    && Array.isArray(record.items) && record.items.every((item) => item && typeof item.platformSkuId === 'string' && Number.isSafeInteger(item.quantity) && item.quantity > 0);
}

export function getPendingPickupRequest(storage: PickupRequestStorage, input: Pick<PickupRequestInput, 'orderId' | 'deliveryPlanId'>): PendingPickupRequest | null {
  const raw = storage.getItem(operationKey(input));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPendingPickupRequest(parsed)) throw new Error('invalid');
    return { ...parsed, pickupRequestId: parsed.pickupRequestId.toLowerCase(), items: normalizePickupRequestItems(parsed.items) };
  } catch {
    storage.removeItem(operationKey(input));
    return null;
  }
}

export function beginPickupRequest(storage: PickupRequestStorage, input: PickupRequestInput, createId: () => string = () => crypto.randomUUID()): PendingPickupRequest {
  const normalized: PickupRequestInput = { ...input, items: normalizePickupRequestItems(input.items) };
  const existing = getPendingPickupRequest(storage, normalized);
  if (existing) {
    if (existing.state === 'CONFIRMED') throw new Error('领取已确认，页面刷新失败，请重新查询订单后再继续操作');
    if (!sameItems(existing.items, normalized.items)) throw new Error('存在结果未确认的领取，请先按原数量重试或刷新订单后再修改数量');
    return existing;
  }
  const pickupRequestId = createId().toLowerCase();
  if (!UUID_PATTERN.test(pickupRequestId)) throw new Error('生成的领取请求 ID 不符合 UUID 格式');
  const created: PendingPickupRequest = { ...normalized, pickupRequestId, state: 'PENDING' };
  storage.setItem(operationKey(created), JSON.stringify(created));
  return created;
}

export function markPickupRequestConfirmed(storage: PickupRequestStorage, request: PendingPickupRequest): PendingPickupRequest {
  const confirmed = { ...request, state: 'CONFIRMED' as const };
  storage.setItem(operationKey(confirmed), JSON.stringify(confirmed));
  return confirmed;
}

export function clearPickupRequest(storage: PickupRequestStorage, input: Pick<PickupRequestInput, 'orderId' | 'deliveryPlanId'>): void {
  storage.removeItem(operationKey(input));
}

export function isTerminalPickupError(error: { statusCode?: number; code?: string }): boolean {
  return !!error.statusCode && error.statusCode >= 400 && error.statusCode < 500
    && ![408, 425, 429].includes(error.statusCode) && !!error.code && TERMINAL_CODES.has(error.code);
}
