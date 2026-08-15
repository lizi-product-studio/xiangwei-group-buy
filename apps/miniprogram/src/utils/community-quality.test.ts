import { describe, expect, it } from 'vitest';
import { canSubmitCommunityQualityCase, COMMUNITY_QUALITY_TEXT_ONLY_HINT, communityQualityCaseStatusText } from './community-quality';

describe('community quality entry', () => {
  const pickedUp = '2026-08-16T00:00:00.000Z';

  it('only exposes the text-only quality entry for a picked-up community order inside 24 hours', () => {
    expect(canSubmitCommunityQualityCase({ businessModelVersion:'PLATFORM_COMMUNITY', status:'PICKED_UP', pickedUpAt:pickedUp }, Date.parse(pickedUp) + 24 * 60 * 60 * 1000 - 1)).toBe(true);
    expect(canSubmitCommunityQualityCase({ businessModelVersion:'PLATFORM_COMMUNITY', status:'PICKED_UP', pickedUpAt:pickedUp }, Date.parse(pickedUp) + 24 * 60 * 60 * 1000)).toBe(false);
    expect(canSubmitCommunityQualityCase({ businessModelVersion:'PLATFORM_COMMUNITY', status:'READY_FOR_PICKUP', pickedUpAt:null }, Date.parse(pickedUp))).toBe(false);
    expect(canSubmitCommunityQualityCase({ businessModelVersion:'PLATFORM_PROCUREMENT', status:'PICKED_UP', pickedUpAt:pickedUp }, Date.parse(pickedUp))).toBe(false);
    expect(COMMUNITY_QUALITY_TEXT_ONLY_HINT).toContain('文字说明');
  });

  it('renders a user-facing pending status rather than an internal enum', () => {
    expect(communityQualityCaseStatusText('REGISTERED')).toBe('待客服受理');
    expect(communityQualityCaseStatusText('REFUNDING')).toBe('退款处理中');
  });
});
