import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const fiveTemplates = [
  { type: 'SITE_CONFIRMED', templateId: 'site' }, { type: 'CAMPAIGN_POSTPONED', templateId: 'site' }, { type: 'PICKUP_EXPIRED', templateId: 'site' },
  { type: 'VEHICLE_DISPATCHED', templateId: 'dispatch' }, { type: 'ARRIVED', templateId: 'arrival' }, { type: 'PICKUP_DEADLINE', templateId: 'deadline' }, { type: 'PARTIAL_REFUND', templateId: 'refund' },
];

// Execute the compiled optional-module boundary with a controlled generated file.
// This covers the WeChat CommonJS loader without reading private upload metadata.
function loadGeneratedDeployment(generated) {
  const source = readFileSync(new URL('./src/config/deployment.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(output, { exports, require: () => generated });
  return exports;
}

describe('generated environment configuration', () => {
  it('selects explicit local and remote overrides independently of release metadata', () => {
    expect(loadGeneratedDeployment({ development: { mode: 'local' } }).resolveDeployment('develop')).toMatchObject({
      apiBaseUrl: 'http://127.0.0.1:3100', authMode: 'demo', demoLoginEnabled: true,
    });
    expect(loadGeneratedDeployment({ development: { mode: 'remote' } }).resolveDeployment('develop')).toMatchObject({
      apiBaseUrl: 'https://liziqi.icu', authMode: 'wechat', demoLoginEnabled: false,
    });
    expect(() => loadGeneratedDeployment({ development: { mode: 'invalid' } }).resolveDeployment('develop')).toThrow(/配置无效/);
  });

  it.each(['trial', 'release'])('keeps %s on WeChat auth and rejects unsafe or incomplete configuration', (environment) => {
    const valid = { apiBaseUrl: 'https://liziqi.icu', authMode: 'wechat', subscriptionTemplates: fiveTemplates, demoLoginEnabled: true };
    const resolve = (deployment) => loadGeneratedDeployment({ deployments: { [environment]: deployment } }).resolveDeployment(environment);
    expect(resolve(valid)).toMatchObject({ apiBaseUrl: 'https://liziqi.icu', authMode: 'wechat', demoLoginEnabled: false });
    for (const invalid of [
      undefined,
      { ...valid, authMode: 'demo' },
      { ...valid, apiBaseUrl: 'http://remote.example.test' },
      { ...valid, apiBaseUrl: 'https://api.example.com' },
      { ...valid, subscriptionTemplates: fiveTemplates.slice(1) },
      { ...valid, subscriptionTemplates: fiveTemplates.map((item) => ({ ...item, templateId: 'approved-trial-placeholder' })) },
    ]) expect(() => resolve(invalid)).toThrow(/deployment\.local/);
  });
});
