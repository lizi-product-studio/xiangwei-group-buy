import { describe, expect, it } from 'vitest';
import {
  mergeAcceptedSubscriptionTypes,
  nextSubscriptionRequest,
} from './notification-subscription.js';

const templates = [
  { type: 'SITE_CONFIRMED' as const, templateId: 'site' },
  { type: 'CAMPAIGN_POSTPONED' as const, templateId: 'site' },
  { type: 'VEHICLE_DISPATCHED' as const, templateId: 'dispatch' },
  { type: 'ARRIVED' as const, templateId: 'arrival' },
  { type: 'PICKUP_DEADLINE' as const, templateId: 'arrival' },
  { type: 'PICKUP_EXPIRED' as const, templateId: 'arrival' },
  { type: 'PARTIAL_REFUND' as const, templateId: 'refund' },
];

describe('notification subscription grouping', () => {
  it('requests at most three unique template ids while keeping semantic event mappings', () => {
    const requested = nextSubscriptionRequest(templates, []);
    expect(new Set(requested.map((item) => item.templateId)).size).toBe(3);
    expect(requested.map((item) => item.type)).toContain('CAMPAIGN_POSTPONED');
    expect(requested.map((item) => item.type)).toContain('PICKUP_EXPIRED');
  });

  it('preserves accepted event types and advances to the remaining template', () => {
    const first = nextSubscriptionRequest(templates, []);
    const accepted = mergeAcceptedSubscriptionTypes([], first, {
      site: 'accept',
      dispatch: 'accept',
      arrival: 'accept',
    });
    expect(accepted).toContain('CAMPAIGN_POSTPONED');
    expect(accepted).toContain('PICKUP_DEADLINE');
    expect(nextSubscriptionRequest(templates, accepted)).toEqual([
      { type: 'PARTIAL_REFUND', templateId: 'refund' },
    ]);
  });
});
