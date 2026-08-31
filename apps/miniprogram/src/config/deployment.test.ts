import { describe, expect, it } from 'vitest';
import { isLocalDemoDeployment, resolveDeployment } from './deployment.js';

describe('secure mini-program deployment configuration', () => {
  it('allows local development without release metadata', () => {
    expect(resolveDeployment('develop')).toMatchObject({ apiBaseUrl: 'http://127.0.0.1:3100', authMode: 'demo', demoLoginEnabled: true });
    expect(resolveDeployment('local')).toMatchObject({ authMode: 'demo', demoLoginEnabled: true });
  });

  it('fails closed for trial and release when generated production configuration is absent', () => {
    expect(() => resolveDeployment('trial')).toThrow(/deployment\.local/);
    expect(() => resolveDeployment('release')).toThrow(/deployment\.local/);
  });

  it('only enables demo login for an explicitly local HTTP deployment', () => {
    const local = resolveDeployment('develop');
    expect(isLocalDemoDeployment(local)).toBe(true);
    expect(isLocalDemoDeployment({ ...local, apiBaseUrl: 'https://127.0.0.1:3100' })).toBe(false);
    expect(isLocalDemoDeployment({ ...local, authMode: 'wechat' })).toBe(false);
    expect(isLocalDemoDeployment({ ...local, demoLoginEnabled: false })).toBe(false);
  });

  it('does not silently map an unknown account environment to local demo', () => {
    expect(() => resolveDeployment('sandbox')).toThrow(/未知/);
  });
});
