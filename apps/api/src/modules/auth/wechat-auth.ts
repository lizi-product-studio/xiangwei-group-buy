import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BusinessError } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import { ensureConsumerPublicNumbers } from '../customers/consumer-directory-service.js';
import type { User } from '../core/types.js';
import type { WechatPhoneExchange } from './wechat-phone.js';
import type { Actor } from './auth.js';

export interface WechatCodeExchange {
  exchange(code: string): Promise<{ openId: string }>;
}

export class WechatApiCodeExchange implements WechatCodeExchange {
  public constructor(private readonly appId: string, private readonly appSecret: string) {}

  public async exchange(code: string): Promise<{ openId: string }> {
    const query = new URLSearchParams({ appid: this.appId, secret: this.appSecret, js_code: code, grant_type: 'authorization_code' });
    let response: Response;
    let data: { openid?: string; errcode?: number };
    try {
      response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`, { signal: AbortSignal.timeout(5_000) });
      data = await response.json() as typeof data;
    } catch {
      throw new BusinessError('EXTERNAL_SERVICE_ERROR', '微信登录服务暂时不可用', 502);
    }
    if (!response.ok) throw new BusinessError('EXTERNAL_SERVICE_ERROR', '微信登录服务暂时不可用', 502);
    if (!data || typeof data.openid !== 'string' || !data.openid.trim() || data.errcode) {
      throw new BusinessError('AUTH_REQUIRED', '微信登录凭证无效，请重新登录', 401);
    }
    return { openId: data.openid };
  }
}

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export function hasVerifiedPhone(value: { phoneNumber?: string; phoneVerifiedAt?: string } | null): boolean {
  if (!value || typeof value.phoneNumber !== 'string' || !/^1[3-9]\d{9}$/.test(value.phoneNumber) || typeof value.phoneVerifiedAt !== 'string') return false;
  const verifiedAt = Date.parse(value.phoneVerifiedAt);
  return /^\d{4}-\d{2}-\d{2}T/.test(value.phoneVerifiedAt) && Number.isFinite(verifiedAt) && verifiedAt > 0 && verifiedAt <= Date.now() + 60_000;
}

export class AuthService {
  public constructor(
    private readonly store: CommerceStore,
    private readonly exchange: WechatCodeExchange,
    private readonly sessionTtlSeconds: number,
    private readonly phoneExchange: WechatPhoneExchange,
    private readonly privacyVersion: string,
  ) {}

  public async login(code: string, privacyVersion: string, phoneCode?: string): Promise<{ phoneRequired: true } | { phoneRequired: false; accessToken: string; expiresAt: string; userId: string }> {
    if (privacyVersion !== this.privacyVersion) throw new BusinessError('VALIDATION_ERROR', '请同意最新隐私说明', 400);
    const { openId } = await this.exchange.exchange(code);
    const existing = await this.store.findUserByWechatOpenId(openId);
    if (existing && existing.status !== 'ACTIVE') throw new BusinessError('FORBIDDEN', '账号当前不可用', 403);
    const bound = hasVerifiedPhone(existing);
    if (!bound && !phoneCode) return { phoneRequired: true };
    const verified = bound ? null : await this.phoneExchange.exchange(phoneCode!, openId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1_000).toISOString();
    const user = await this.store.transaction(async (store) => {
      await ensureConsumerPublicNumbers(store);
      let value = await store.findUserByWechatOpenId(openId);
      if (!value) {
        const now = new Date().toISOString();
        const id = randomUUID();
        const newUser = { id, wechatOpenId: openId, status: 'ACTIVE' as const, createdAt: now };
        await store.saveUser(newUser);
        const consumerNumber = await store.allocateConsumerPublicNumber(id);
        await store.saveUser({ ...newUser, consumerNumber });
        value = await store.findUserByWechatOpenId(openId);
      }
      if (!value || value.status !== 'ACTIVE') throw new BusinessError('FORBIDDEN', '账号当前不可用', 403);
      if (!hasVerifiedPhone(value)) {
        if (!hasVerifiedPhone(verified)) throw new BusinessError('AUTH_REQUIRED', '请重新授权手机号', 401);
        value = { ...value, ...verified };
        await store.saveUser(value);
      }
      await store.savePrivacyConsent(value.id, privacyVersion);
      await store.saveAuthSession({ tokenHash: tokenHash(token), userId: value.id, roles: ['USER'], authorizationVersion: 0, expiresAt });
      return value;
    });
    return { phoneRequired: false, accessToken: token, expiresAt, userId: user.id };
  }

  public async authenticate(authorization: string | undefined): Promise<Actor | null> {
    if (!authorization?.startsWith('Bearer ')) return null;
    const token = authorization.slice(7).trim();
    if (token.length < 32 || token.length > 128) return null;
    const session = await this.store.getActiveAuthSession(tokenHash(token));
    if (!session || session.roles.length !== 1 || session.roles[0] !== 'USER') return null;
    const user = await this.store.getUser(session.userId);
    if (!user || user.status !== 'ACTIVE' || !hasVerifiedPhone(user) || !await this.store.getPrivacyConsent(user.id, this.privacyVersion)) return null;
    return { userId: session.userId, roles: session.roles };
  }

  public async logout(authorization: string | undefined): Promise<void> {
    if (!authorization?.startsWith('Bearer ')) return;
    const token = authorization.slice(7).trim();
    if (token) await this.store.deleteAuthSession(tokenHash(token));
  }

  /** Re-authorize the phone bound to an already authenticated consumer.  The
   * one-time WeChat phone code is exchanged before the aggregate write, then
   * the current profile version is checked inside the transaction. */
  public async rebindPhone(userId: string, phoneCode: string, expectedVersion: number, requestId: string): Promise<User> {
    const current = await this.store.getUser(userId);
    if (!current || current.status !== 'ACTIVE' || !current.wechatOpenId)
      throw new BusinessError('AUTH_REQUIRED', '请先完成微信登录', 401);
    if ((current.profileVersion ?? 0) !== expectedVersion)
      throw new BusinessError('CONCURRENT_MODIFICATION', '个人资料已更新，请刷新后重试', 409);
    const verified = await this.phoneExchange.exchange(phoneCode, current.wechatOpenId);
    if (!hasVerifiedPhone(verified)) throw new BusinessError('AUTH_REQUIRED', '手机号授权无效或已过期，请重新授权', 401);
    return this.store.transaction(async (store) => {
      const value = await store.getUser(userId);
      const version = value?.profileVersion ?? 0;
      if (!value || value.status !== 'ACTIVE' || !value.wechatOpenId)
        throw new BusinessError('AUTH_REQUIRED', '请先完成微信登录', 401);
      if (version !== expectedVersion)
        throw new BusinessError('CONCURRENT_MODIFICATION', '个人资料已更新，请刷新后重试', 409);
      const duplicate = (await store.listConsumerUsers()).find(
        (user) => user.id !== userId && user.phoneNumber === verified.phoneNumber,
      );
      if (duplicate)
        throw new BusinessError('RESOURCE_IN_USE', '该手机号已绑定其他账号', 409);
      const after = {
        ...value,
        ...verified,
        profileUpdatedAt: new Date().toISOString(),
        profileVersion: version + 1,
      };
      await store.saveUser(after);
      const mask = (phone: string | undefined) => phone && /^1[3-9]\d{9}$/.test(phone)
        ? `${phone.slice(0, 3)}****${phone.slice(-4)}`
        : null;
      await store.saveAuditLog({
        id: randomUUID(),
        actorId: userId,
        action: 'CONSUMER_PHONE_REBOUND',
        resourceType: 'USER',
        resourceId: userId,
        requestId,
        beforeData: { phoneNumber: mask(value.phoneNumber) },
        afterData: { phoneNumber: mask(after.phoneNumber) },
        createdAt: after.profileUpdatedAt,
      });
      return after;
    });
  }
}
