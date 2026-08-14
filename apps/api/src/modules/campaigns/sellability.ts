import type { DeliveryPlan } from '../core/types.js';

/**
 * A pickup plan becomes sellable once its pickup site is fixed. Vehicle booking
 * must not make an otherwise open campaign vanish from the catalogue or reject
 * a customer checkout. In-transit and arrived plans are deliberately excluded:
 * a campaign should no longer be open at those fulfilment stages.
 */
export function isDeliveryPlanReadyForSale(
  plan: Pick<DeliveryPlan, 'pickupPointId' | 'status'> | null | undefined,
): plan is Pick<DeliveryPlan, 'pickupPointId' | 'status'> & { pickupPointId: string } {
  return plan !== null
    && plan !== undefined
    && plan.pickupPointId !== null
    && (plan.status === 'SITE_CONFIRMED' || plan.status === 'VEHICLE_BOOKED');
}
