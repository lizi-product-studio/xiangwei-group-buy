import { describe, expect, it } from 'vitest';
import { resolveDeployment } from './deployment.js';

describe('secure mini-program deployment configuration', () => {
  it('allows local development without release metadata', () => {
    expect(resolveDeployment('develop')).toMatchObject({ apiBaseUrl: 'http://127.0.0.1:3100', authMode: 'demo' });
  });

  it('fails closed for trial and release when generated production configuration is absent', () => {
    expect(() => resolveDeployment('trial')).toThrow(/deployment\.local/);
    expect(() => resolveDeployment('release')).toThrow(/deployment\.local/);
  });
});
