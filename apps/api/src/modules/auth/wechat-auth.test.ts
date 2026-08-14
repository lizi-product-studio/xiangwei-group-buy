import { describe, expect, it } from 'vitest';
import { AuthService } from './wechat-auth.js';
import { MemoryStore } from '../core/store.js';

describe('AuthService privacy consent', () => {
  it('records one immutable server-side timestamp for repeated acceptance of a version', async () => {
    const store = new MemoryStore(false);
    const service = new AuthService(store, { exchange: async () => ({ openId: 'openid-privacy-user' }) }, 3_600);

    const first = await service.login('wechat-code-001', '2026-08-12');
    const consent = await store.getPrivacyConsent(first.userId, '2026-08-12');
    expect(consent?.consentedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await service.login('wechat-code-002', '2026-08-12');
    expect((await store.getPrivacyConsent(first.userId, '2026-08-12'))?.consentedAt).toBe(consent?.consentedAt);
  });
});
