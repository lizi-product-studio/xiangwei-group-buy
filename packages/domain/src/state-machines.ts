import { BusinessError } from './errors.js';

export type CampaignStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'OPEN'
  | 'CLOSING'
  | 'LOCKED'
  | 'FULFILLING'
  | 'COMPLETED'
  | 'POSTPONED'
  | 'CANCELLED';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID_WAITING_CLOSE'
  | 'LOCKED'
  | 'ALLOCATING'
  | 'IN_TRANSIT'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'COMPLETED'
  | 'CANCELLING'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'CANCELLED';

const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  DRAFT: ['SCHEDULED', 'OPEN', 'CANCELLED'],
  SCHEDULED: ['OPEN', 'CANCELLED'],
  OPEN: ['CLOSING', 'POSTPONED', 'CANCELLED'],
  CLOSING: ['LOCKED', 'POSTPONED', 'CANCELLED'],
  LOCKED: ['FULFILLING', 'CANCELLED'],
  FULFILLING: ['COMPLETED'],
  COMPLETED: [],
  POSTPONED: ['OPEN', 'CANCELLED'],
  CANCELLED: [],
};

const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['PAID_WAITING_CLOSE', 'CANCELLING', 'CANCELLED'],
  PAID_WAITING_CLOSE: ['LOCKED', 'CANCELLING', 'REFUNDING'],
  LOCKED: ['ALLOCATING', 'REFUNDING'],
  ALLOCATING: ['IN_TRANSIT', 'REFUNDING'],
  IN_TRANSIT: ['READY_FOR_PICKUP', 'REFUNDING'],
  // A community window can close after a documented residual loss/refund.
  // This is fulfilment completion, never a customer order cancellation.
  READY_FOR_PICKUP: ['PICKED_UP', 'REFUNDING', 'COMPLETED'],
  PICKED_UP: ['COMPLETED', 'REFUNDING'],
  // Fulfillment completion does not remove an approved quality refund right.
  COMPLETED: ['REFUNDING'],
  CANCELLING: ['CANCELLED', 'REFUNDING'],
  REFUNDING: ['REFUNDED'],
  REFUNDED: [],
  CANCELLED: ['REFUNDING'],
};

function transition<T extends string>(
  aggregate: string,
  current: T,
  next: T,
  transitions: Readonly<Record<T, readonly T[]>>,
): T {
  if (!transitions[current].includes(next)) {
    throw new BusinessError(
      'INVALID_STATE_TRANSITION',
      `${aggregate}状态不能从 ${current} 变更为 ${next}`,
      409,
    );
  }
  return next;
}

export const transitionCampaign = (current: CampaignStatus, next: CampaignStatus): CampaignStatus =>
  transition('团期', current, next, CAMPAIGN_TRANSITIONS);

export const transitionOrder = (current: OrderStatus, next: OrderStatus): OrderStatus =>
  transition('订单', current, next, ORDER_TRANSITIONS);
