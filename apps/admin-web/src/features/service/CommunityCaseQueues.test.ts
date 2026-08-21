import { describe, expect, it } from 'vitest';
import { qualityReason } from './CommunityCaseQueues.tsx';

describe('community service queue labels', () => {
  it('keeps every quality case reason visible to customer service', () => {
    expect(qualityReason).toEqual({ PICKUP_SHORTAGE: '提货短少', PICKUP_DAMAGE: '提货破损', QUALITY_CLAIM: '品质问题' });
  });
});
