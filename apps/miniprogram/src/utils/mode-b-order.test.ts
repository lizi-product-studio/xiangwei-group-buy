import { describe, expect, it } from 'vitest';
import { isModeBOrder, refundProgressText } from './mode-b-order.js';

describe('mode-B consumer presentation', () => {
  it('identifies the platform-procurement route and exposes line refund progress', () => {
    expect(isModeBOrder({ businessModelVersion: 'PLATFORM_PROCUREMENT' })).toBe(true);
    expect(isModeBOrder({ businessModelVersion: 'LEGACY_MARKETPLACE' })).toBe(false);
    expect(refundProgressText('PENDING')).toBe('待平台确认退款');
    expect(refundProgressText('PROCESSING')).toBe('退款处理中');
    expect(refundProgressText('FAILED')).toContain('失败');
  });
});
