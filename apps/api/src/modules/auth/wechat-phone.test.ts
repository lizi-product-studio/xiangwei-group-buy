import { afterEach, describe, expect, it, vi } from 'vitest';
import { WechatApiPhoneExchange } from './wechat-phone.js';
const payload = () => ({ errcode: 0, phone_info: { phoneNumber: '13800138000', purePhoneNumber: '13800138000', countryCode: '86', watermark: { appid: 'test-app', timestamp: Math.floor(Date.now()/1000) } } });
afterEach(() => vi.unstubAllGlobals());
const mock = (body: unknown) => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-token', expires_in: 7200 }))).mockResolvedValue(new Response(JSON.stringify(body)));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};
describe('verified WeChat phone provider', () => {
  it('sends server identity and uses cached stable token without forcing refresh', async () => {
    const fetcher = mock(payload());
    const provider = new WechatApiPhoneExchange('test-app', 'test-secret');
    // Fresh response objects are required for each fetch body read.
    fetcher.mockReset().mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('stable_token') ? { access_token: 'test-token', expires_in: 7200 } : payload())));
    expect(await provider.exchange('phone-code', 'server-openid')).toMatchObject({ phoneNumber: '13800138000' });
    await provider.exchange('phone-code-two', 'server-openid');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ force_refresh: false, appid: 'test-app' });
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ code: 'phone-code', openid: 'server-openid' });
  });
  it.each(['wrong-app', 'expired', 'future', 'malformed', 'missing', 'provider-error', 'wrong-number', 'wrong-country'])(
    'rejects %s without exposing provider payload', async (kind) => {
      const body = payload();
      if (kind === 'wrong-app') body.phone_info.watermark.appid = 'other-app';
      if (kind === 'expired') body.phone_info.watermark.timestamp -= 301;
      if (kind === 'future') body.phone_info.watermark.timestamp += 120;
      if (kind === 'wrong-number') body.phone_info.purePhoneNumber = 'not-a-phone';
      if (kind === 'wrong-country') body.phone_info.countryCode = '1';
      if (kind === 'provider-error') body.errcode = 40029;
      mock(kind === 'missing' ? { errcode: 0 } : kind === 'malformed' ? [] : body);
      await expect(new WechatApiPhoneExchange('test-app', 'secret').exchange('sensitive-code', 'openid')).rejects.toThrow(/手机号/);
    },
  );
  it('rejects malformed token replies and network failures with sanitized errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"access_token":"secret"}')));
    await expect(new WechatApiPhoneExchange('test-app', 'secret').exchange('code', 'openid')).rejects.toMatchObject({ code: 'EXTERNAL_SERVICE_ERROR' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sensitive-url')));
    await expect(new WechatApiPhoneExchange('test-app', 'secret').exchange('code', 'openid')).rejects.not.toThrow('sensitive-url');
  });
});

describe('WeChat provider failure classification', () => {
  it.each([-1, 45011, 40001, 42001, undefined, '0'])(
    'returns a sanitized service failure for %s', async (errcode) => {
      mock({ errcode, errmsg: 'sensitive provider detail' });
      await expect(new WechatApiPhoneExchange('test-app', 'secret').exchange('code', 'openid')).rejects.toMatchObject({ code: 'EXTERNAL_SERVICE_ERROR', statusCode: 502 });
    },
  );
});
