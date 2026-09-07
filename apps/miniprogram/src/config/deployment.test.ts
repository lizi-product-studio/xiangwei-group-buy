import { describe, expect, it } from 'vitest';
import { isDemoDeployment, isLocalDemoDeployment, isMissingOptionalDeploymentModule, resolveDeployment, validSubscriptionMap } from './deployment.js';

const fiveTemplates = [
  { type: 'SITE_CONFIRMED' as const, templateId: 'site' }, { type: 'CAMPAIGN_POSTPONED' as const, templateId: 'site' }, { type: 'PICKUP_EXPIRED' as const, templateId: 'site' },
  { type: 'VEHICLE_DISPATCHED' as const, templateId: 'dispatch' }, { type: 'ARRIVED' as const, templateId: 'arrival' }, { type: 'PICKUP_DEADLINE' as const, templateId: 'deadline' }, { type: 'PARTIAL_REFUND' as const, templateId: 'refund' },
];

describe('secure mini-program deployment configuration', () => {
  it('requires five distinct IDs with exact shared-status grouping', () => {
    expect(validSubscriptionMap(fiveTemplates)).toBe(true);
    expect(validSubscriptionMap(fiveTemplates.map((item) => item.type === 'PICKUP_DEADLINE' ? { ...item, templateId: 'arrival' } : item))).toBe(false);
    expect(validSubscriptionMap(fiveTemplates.map((item) => item.type === 'PICKUP_EXPIRED' ? { ...item, templateId: 'refund' } : item))).toBe(false);
    expect(validSubscriptionMap([...fiveTemplates, fiveTemplates[0]!])).toBe(false);
  });
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
    expect(isMissingOptionalDeploymentModule({ message: "module './deployment.local' is not defined in runtime" })).toBe(true);
    expect(isMissingOptionalDeploymentModule({ errMsg: 'module "./deployment.local" not found' })).toBe(true);
    expect(isMissingOptionalDeploymentModule("module './deployment.local' is not defined in runtime")).toBe(true);
    expect(isMissingOptionalDeploymentModule("Cannot find module './deployment.local.ts'")).toBe(true);
    expect(isMissingOptionalDeploymentModule({ message: "module 'config/deployment.local.js' is not defined, require args is './deployment.local'" })).toBe(true);
    expect(isMissingOptionalDeploymentModule({ code: 'MODULE_NOT_FOUND', message: "Cannot find module './private-secrets'" })).toBe(false);
    expect(isMissingOptionalDeploymentModule({ code: 'MODULE_NOT_FOUND', message: "Cannot find module './private-secrets'", stack: 'required by ./deployment.local' })).toBe(false);
    expect(isMissingOptionalDeploymentModule(new Error('syntax error'))).toBe(false);
  });

  it('does not silently map an unknown account environment to local demo', () => {
    expect(() => resolveDeployment('sandbox')).toThrow(/未知/);
  });
});
