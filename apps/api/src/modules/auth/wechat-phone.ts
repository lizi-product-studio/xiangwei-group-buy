import { BusinessError } from '@hometown/domain';

export interface VerifiedWechatPhone {
  phoneNumber: string;
  phoneVerifiedAt: string;
}
export interface WechatPhoneExchange {
  exchange(code: string, openId: string): Promise<VerifiedWechatPhone>;
}
const unavailable = () => new BusinessError('EXTERNAL_SERVICE_ERROR', '手机号服务暂时不可用，请联系平台或稍后重试', 502);
const invalid = () => new BusinessError('AUTH_REQUIRED', '手机号授权无效或已过期，请重新授权', 401);

export class WechatApiPhoneExchange implements WechatPhoneExchange {
  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;
  public constructor(private readonly appId: string, private readonly appSecret: string) {}

  private async post(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw unavailable();
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw unavailable();
      return data as Record<string, unknown>;
    } catch { throw unavailable(); }
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = (async () => {
      const data = await this.post('https://api.weixin.qq.com/cgi-bin/stable_token', {
        grant_type: 'client_credential', appid: this.appId, secret: this.appSecret, force_refresh: false,
      });
      if ((data.errcode !== undefined && data.errcode !== 0) || typeof data.access_token !== 'string' || !data.access_token.trim() ||
        typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw unavailable();
      this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1_000 };
      return data.access_token;
    })();
    try { return await this.pendingToken; } finally { this.pendingToken = null; }
  }
  public async exchange(code: string, openId: string): Promise<VerifiedWechatPhone> {
    const token = await this.accessToken();
    const data = await this.post(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`, { code, openid: openId });
    if (data.errcode !== 0) {
      if (data.errcode === 40001 || data.errcode === 42001) this.token = null;
      if (data.errcode === 40029 || data.errcode === 40013 || data.errcode === 40163) throw invalid();
      throw unavailable();
    }
    const info = data.phone_info as Record<string, unknown> | undefined;
    const watermark = info?.watermark as Record<string, unknown> | undefined;
    const timestamp = watermark?.timestamp;
    if (!info || typeof info.purePhoneNumber !== 'string' || !/^1[3-9]\d{9}$/.test(info.purePhoneNumber) ||
      info.countryCode !== '86' || info.phoneNumber !== info.purePhoneNumber || watermark?.appid !== this.appId ||
      typeof timestamp !== 'number' || !Number.isInteger(timestamp) || timestamp * 1_000 < Date.now() - 300_000 || timestamp * 1_000 > Date.now() + 60_000) throw invalid();
    return { phoneNumber: info.purePhoneNumber, phoneVerifiedAt: new Date(timestamp * 1_000).toISOString() };
  }
}
