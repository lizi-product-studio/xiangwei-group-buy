import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('mini-program bootstrap environment fail-closed', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  async function bootstrap(accountInfo: unknown, hasAccountInfoApi = true) {
    const registerApp = vi.fn();
    vi.stubGlobal('wx', hasAccountInfoApi
      ? { getAccountInfoSync: vi.fn(() => accountInfo) }
      : {});
    vi.stubGlobal('App', registerApp);
    await import('./app');
    return registerApp;
  }

  it.each([
    ['missing API', undefined, false],
    ['missing account info', undefined, true],
    ['missing mini-program info', {}, true],
    ['missing environment version', { miniProgram: {} }, true],
    ['empty environment version', { miniProgram: { envVersion: '' } }, true],
    ['unknown environment version', { miniProgram: { envVersion: 'sandbox' } }, true],
  ])('rejects %s instead of selecting local demo', async (_label, accountInfo, hasAccountInfoApi) => {
    await expect(bootstrap(accountInfo, hasAccountInfoApi)).rejects.toThrow(/无法确认/);
  });

  it('accepts only an explicit develop environment and registers the configured app', async () => {
    const registerApp = await bootstrap({ miniProgram: { envVersion: 'develop' } });
    expect(registerApp).toHaveBeenCalledWith(expect.objectContaining({
      globalData: expect.objectContaining({
        apiBaseUrl: 'https://liziqi.icu',
        authMode: 'wechat',
        demoLoginEnabled: false,
      }),
    }));
  });
});
