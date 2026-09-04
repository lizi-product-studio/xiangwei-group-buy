import { describe, expect, it } from 'vitest';
import { isDemoDeployment, isLocalDemoDeployment, isMissingOptionalDeploymentModule, resolveDeployment } from './deployment.js';

describe('secure mini-program deployment configuration', () => {
  it('allows local development without release metadata', () => {
    expect(resolveDeployment('develop')).toMatchObject({ apiBaseUrl: 'http://180.76.100.156', authMode: 'demo', demoLoginEnabled: true });
    expect(resolveDeployment('local')).toMatchObject({ authMode: 'demo', demoLoginEnabled: true });
  });

  it('fails closed for trial and release when generated production configuration is absent', () => {
    expect(() => resolveDeployment('trial')).toThrow(/deployment\.local/);
    expect(() => resolveDeployment('release')).toThrow(/deployment\.local/);
  });

  it('only enables demo login for the approved development HTTP targets', () => {
    const remote = resolveDeployment('develop');
    const local = resolveDeployment('local');
    expect(isDemoDeployment(remote)).toBe(true);
    expect(isLocalDemoDeployment(remote)).toBe(false);
    expect(isDemoDeployment(local)).toBe(true);
    expect(isLocalDemoDeployment(local)).toBe(true);
    expect(isLocalDemoDeployment({ ...local, apiBaseUrl: 'https://127.0.0.1:3100' })).toBe(false);
    expect(isLocalDemoDeployment({ ...local, authMode: 'wechat' })).toBe(false);
    expect(isLocalDemoDeployment({ ...local, demoLoginEnabled: false })).toBe(false);
    expect(isDemoDeployment({ ...local, apiBaseUrl: 'http://unapproved.example.test' })).toBe(false);
    expect(isDemoDeployment({ ...remote, apiBaseUrl: 'https://180.76.100.156' })).toBe(false);
    expect(isDemoDeployment({ ...remote, apiBaseUrl: 'http://180.76.100.156:9999' })).toBe(false);
  });

  it('distinguishes a missing optional file from a broken dependency inside it', () => {
    expect(isMissingOptionalDeploymentModule({ code: 'MODULE_NOT_FOUND', message: "Cannot find module './deployment.local'" })).toBe(true);
    expect(isMissingOptionalDeploymentModule({ code: 'MODULE_NOT_FOUND', message: "Cannot find module './private-secrets'" })).toBe(false);
    expect(isMissingOptionalDeploymentModule(new Error('syntax error'))).toBe(false);
  });

  it('does not silently map an unknown account environment to local demo', () => {
    expect(() => resolveDeployment('sandbox')).toThrow(/未知/);
  });
});
