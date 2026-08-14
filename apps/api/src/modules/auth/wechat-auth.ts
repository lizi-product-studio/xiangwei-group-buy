import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BusinessError } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { Actor } from './auth.js';

export interface WechatCodeExchange {
  exchange(code: string): Promise<{ openId: string }>;
}

export class WechatApiCodeExchange implements WechatCodeExchange {
  public constructor(private readonly appId: string, private readonly appSecret: string) {}

  public async exchange(code: string): Promise<{ openId: string }> {
    const query = new URLSearchParams({ appid: this.appId, secret: this.appSecret, js_code: code, grant_type: 'authorization_code' });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new BusinessError('EXTERNAL_SERVICE_ERROR', '微信登录服务暂时不可用', 502);
    const data = await response.json() as { openid?: string; errcode?: number; errmsg?: string };
    if (!data.openid || data.errcode) {
      throw new BusinessError('AUTH_REQUIRED', '微信登录凭证无效，请重新登录', 401, { providerCode: data.errcode });
    }
    return { openId: data.openid };
  }
}

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export class AuthService {
  public constructor(
    private readonly store: CommerceStore,
    private readonly exchange: WechatCodeExchange,
    private readonly sessionTtlSeconds: number,
  ) {}

  public async login(code: string, privacyVersion: string): Promise<{ accessToken: string; expiresAt: string; userId: string }> {
    const { openId } = await this.exchange.exchange(code);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1_000).toISOString();
    const user = await this.store.transaction(async (store) => {
      let value = await store.findUserByWechatOpenId(openId);
      if (!value) {
        const now = new Date().toISOString();
        await store.saveUser({ id: randomUUID(), wechatOpenId: openId, status: 'ACTIVE', createdAt: now });
        value = await store.findUserByWechatOpenId(openId);
      }
      if (!value || value.status !== 'ACTIVE') throw new BusinessError('FORBIDDEN', '账号当前不可用', 403);
      await store.savePrivacyConsent(value.id, privacyVersion);
      await store.saveAuthSession({ tokenHash: tokenHash(token), userId: value.id, roles: ['USER'], expiresAt });
      return value;
    });
    return { accessToken: token, expiresAt, userId: user.id };
  }

  public async authenticate(authorization: string | undefined): Promise<Actor | null> {
    if (!authorization?.startsWith('Bearer ')) return null;
    const token = authorization.slice(7).trim();
    if (token.length < 32 || token.length > 128) return null;
    const session = await this.store.getAuthSession(tokenHash(token));
    return session ? { userId: session.userId, roles: session.roles } : null;
  }

  public async logout(authorization: string | undefined): Promise<void> {
    if (!authorization?.startsWith('Bearer ')) return;
    const token = authorization.slice(7).trim();
    if (token) await this.store.deleteAuthSession(tokenHash(token));
  }
}
