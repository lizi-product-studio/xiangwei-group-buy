import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './wechat-auth.js';
import { MemoryStore } from '../core/store.js';

const version = '2026-09-07-phone-v1';
const phone = { phoneNumber: '13800138000', phoneVerifiedAt: new Date().toISOString() };
const setup = () => {
  const store = new MemoryStore(false);
  const exchange = vi.fn(async () => phone);
  const service = new AuthService(store, { exchange: async () => ({ openId: 'openid-privacy-user' }) }, 3_600, { exchange }, version);
  return { store, exchange, service };
};
describe('WeChat phone binding authentication', () => {
  it('does not create a user, consent or session before phone authorization', async () => {
    const { store, service, exchange } = setup();
    expect(await service.login('wechat-code', version)).toEqual({ phoneRequired: true });
    expect(await store.findUserByWechatOpenId('openid-privacy-user')).toBeNull();
    expect(exchange).not.toHaveBeenCalled();
  });
  it('binds once, persists consent and skips phone exchange on subsequent login', async () => {
    const { store, service, exchange } = setup();
    const first = await service.login('wechat-code', version, 'phone-code');
    if (first.phoneRequired) throw new Error('binding failed');
    expect(await service.authenticate(`Bearer ${first.accessToken}`)).toEqual({ userId: first.userId, roles: ['USER'] });
    expect(await store.getUser(first.userId)).toMatchObject(phone);
    const consent = await store.getPrivacyConsent(first.userId, version);
    await service.login('new-wechat-code', version, 'already-consumed-code');
    expect(exchange).toHaveBeenCalledExactlyOnceWith('phone-code', 'openid-privacy-user');
    expect(await store.getPrivacyConsent(first.userId, version)).toEqual(consent);
  });
  it('fails closed when provider rejects phone authorization', async () => {
    const { store, service, exchange } = setup();
    exchange.mockRejectedValueOnce(new Error('provider denied'));
    await expect(service.login('wechat-code', version, 'invalid')).rejects.toThrow();
    expect(await store.findUserByWechatOpenId('openid-privacy-user')).toBeNull();
  });
  it('concurrent first logins preserve one identity and first committed binding', async () => {
    const { store, service, exchange } = setup();
    exchange.mockResolvedValueOnce(phone).mockResolvedValueOnce({ ...phone, phoneNumber: '13900139000' });
    const results = await Promise.all([service.login('code-one', version, 'phone-one'), service.login('code-two', version, 'phone-two')]);
    if (results[0]!.phoneRequired || results[1]!.phoneRequired) throw new Error('binding failed');
    expect(results[0]!.userId).toBe(results[1]!.userId);
    expect(await store.getUser(results[0]!.userId)).toMatchObject(phone);
  });
  it('rechecks blocked state after the external exchange', async () => {
    const { store, service, exchange } = setup();
    await store.saveUser({ id: 'u', wechatOpenId: 'openid-privacy-user', status: 'ACTIVE', createdAt: new Date().toISOString() });
    exchange.mockImplementationOnce(async () => {
      await store.saveUser({ id: 'u', wechatOpenId: 'openid-privacy-user', status: 'BLOCKED', createdAt: new Date().toISOString() });
      return phone;
    });
    await expect(service.login('wechat-code', version, 'phone-code')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.getUser('u')).not.toHaveProperty('phoneNumber');
  });
  it('rejects old unbound sessions and bound sessions without current consent', async () => {
    const { store, service } = setup();
    const token = 'x'.repeat(40);
    await store.saveUser({ id: 'u', wechatOpenId: 'openid-privacy-user', status: 'ACTIVE', createdAt: new Date().toISOString() });
    await store.saveAuthSession({ tokenHash: createHash('sha256').update(token).digest('hex'), userId: 'u', roles: ['USER'], authorizationVersion: 0, expiresAt: new Date(Date.now()+60_000).toISOString() });
    expect(await service.authenticate(`Bearer ${token}`)).toBeNull();
    await store.saveUser({ ...(await store.getUser('u'))!, ...phone });
    await store.savePrivacyConsent('u', 'old-version');
    expect(await service.authenticate(`Bearer ${token}`)).toBeNull();
    await store.savePrivacyConsent('u', version);
    expect(await service.authenticate(`Bearer ${token}`)).toMatchObject({ userId: 'u' });
  });
});

class PersistedTestStore extends MemoryStore {
  public snapshot() { return this.exportState(); }
  public restore(value: string) { this.importState(value); }
}
describe('phone binding JSON compatibility', () => {
  it('loads old unbound users and preserves verified fields across restart', async () => {
    const first = new PersistedTestStore(false);
    await first.saveUser({ id: 'old', wechatOpenId: 'old-openid', status: 'ACTIVE', createdAt: new Date().toISOString() });
    const restarted = new PersistedTestStore(false);
    restarted.restore(first.snapshot());
    expect(await restarted.getUser('old')).not.toHaveProperty('phoneNumber');
    await restarted.saveUser({ ...(await restarted.getUser('old'))!, ...phone });
    await restarted.savePrivacyConsent('old', version);
    const again = new PersistedTestStore(false);
    again.restore(restarted.snapshot());
    expect(await again.getUser('old')).toMatchObject(phone);
    expect(await again.getPrivacyConsent('old', version)).not.toBeNull();
  });
});

describe('stored phone qualification', () => {
  it.each([
    { phoneNumber: 'forged', phoneVerifiedAt: new Date().toISOString() },
    { phoneNumber: '13800138000', phoneVerifiedAt: 'not-a-date' },
    { phoneNumber: '13800138000', phoneVerifiedAt: '9999-01-01T00:00:00.000Z' },
    { phoneNumber: '13800138000', phoneVerifiedAt: '' },
  ])('requires rebinding malformed stored verification %j', async (invalidPhone) => {
    const { store, service } = setup();
    await store.saveUser({ id: 'u', wechatOpenId: 'openid-privacy-user', status: 'ACTIVE', createdAt: new Date().toISOString(), ...invalidPhone });
    await store.savePrivacyConsent('u', version);
    expect(await service.login('new-code', version)).toEqual({ phoneRequired: true });
    const token = 'z'.repeat(40);
    await store.saveAuthSession({ tokenHash: createHash('sha256').update(token).digest('hex'), userId: 'u', roles: ['USER'], authorizationVersion: 0, expiresAt: new Date(Date.now()+60_000).toISOString() });
    expect(await service.authenticate(`Bearer ${token}`)).toBeNull();
  });
  it('retains old valid bindings and rejects a stale privacy version at service boundary', async () => {
    const { store, service, exchange } = setup();
    await store.saveUser({ id: 'u', wechatOpenId: 'openid-privacy-user', status: 'ACTIVE', createdAt: new Date().toISOString(), ...phone, phoneVerifiedAt: '2020-01-01T00:00:00.000Z' });
    expect(await service.login('new-code', version)).toMatchObject({ phoneRequired: false });
    expect(exchange).not.toHaveBeenCalled();
    await expect(service.login('new-code', 'old')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
