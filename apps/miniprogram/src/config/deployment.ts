export type NotificationType = 'SITE_CONFIRMED' | 'VEHICLE_DISPATCHED' | 'ARRIVED' | 'PARTIAL_REFUND' | 'PICKUP_DEADLINE' | 'PICKUP_EXPIRED' | 'CAMPAIGN_POSTPONED';
export interface SubscriptionTemplate { type: NotificationType; templateId: string }
export interface MiniProgramDeployment {
  apiBaseUrl: string;
  authMode: 'demo' | 'wechat';
  subscriptionTemplates: SubscriptionTemplate[];
  /** Development-only capability; never inferred from a page query or storage value. */
  demoLoginEnabled?: boolean;
}

type DeploymentKey = 'develop' | 'local' | 'trial' | 'release';
type ReleaseDeployments = Partial<Record<'trial' | 'release', MiniProgramDeployment>>;
type DevelopmentMode = 'remote' | 'local';

/**
 * CI or the pre-upload step generates this gitignored module from release secrets.
 * It deliberately does not exist in a fresh checkout, so fake production hosts can
 * never silently be uploaded.
 */
let releaseDeployments: ReleaseDeployments = {};
let developmentMode: DevelopmentMode = 'remote';
let developmentConfigInvalid = false;

export function isMissingOptionalDeploymentModule(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') {
    return false;
  }
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  return /Cannot find module ['"]\.\/deployment\.local['"]/.test(message);
}

if (typeof require === 'function') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- this optional file is generated only in the secure upload workspace.
    const generated = require('./deployment.local') as {
      deployments?: ReleaseDeployments;
      development?: { mode?: DevelopmentMode };
    };
    releaseDeployments = generated.deployments ?? {};
    const configuredDevelopmentMode = generated.development?.mode;
    if (configuredDevelopmentMode === undefined) {
      developmentMode = 'remote';
    } else if (configuredDevelopmentMode === 'local' || configuredDevelopmentMode === 'remote') {
      developmentMode = configuredDevelopmentMode;
    } else {
      developmentConfigInvalid = true;
    }
  } catch (error) {
    if (!isMissingOptionalDeploymentModule(error)) developmentConfigInvalid = true;
  }
}

const remoteDevelop: MiniProgramDeployment = {
  apiBaseUrl: 'http://180.76.100.156',
  authMode: 'demo',
  subscriptionTemplates: [],
  demoLoginEnabled: true,
};
const localDevelop: MiniProgramDeployment = {
  apiBaseUrl: 'http://127.0.0.1:3100',
  authMode: 'demo',
  subscriptionTemplates: [],
  demoLoginEnabled: true,
};
const develop = developmentMode === 'local' ? localDevelop : remoteDevelop;

const LOCAL_HTTP_HOST = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i;
const REMOTE_DEMO_HTTP_HOST = /^http:\/\/180\.76\.100\.156(?:\/|$)/i;

export function isDemoDeployment(
  deployment: Pick<MiniProgramDeployment, 'apiBaseUrl' | 'authMode' | 'demoLoginEnabled'>,
): boolean {
  return (
    deployment.authMode === 'demo' &&
    deployment.demoLoginEnabled === true &&
    (LOCAL_HTTP_HOST.test(deployment.apiBaseUrl) || REMOTE_DEMO_HTTP_HOST.test(deployment.apiBaseUrl))
  );
}

export function isLocalDemoDeployment(
  deployment: Pick<MiniProgramDeployment, 'apiBaseUrl' | 'authMode' | 'demoLoginEnabled'>,
): boolean {
  return isDemoDeployment(deployment) && LOCAL_HTTP_HOST.test(deployment.apiBaseUrl);
}

export function resolveDeployment(environment: string): MiniProgramDeployment {
  if (environment !== 'develop' && environment !== 'local' && environment !== 'trial' && environment !== 'release') {
    throw new Error('未知的小程序运行环境，已拒绝启动');
  }
  const key: DeploymentKey = environment;
  if (developmentConfigInvalid && (key === 'develop' || key === 'local')) {
    throw new Error('开发环境 deployment.local.ts 配置无效，已拒绝启动');
  }
  const deployment = key === 'develop' ? develop : key === 'local' ? localDevelop : releaseDeployments[key];
  const host = deployment?.apiBaseUrl.match(/^https:\/\/([^/:?#]+)/i)?.[1]?.toLowerCase() ?? '';
  const isPlaceholderHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.example.com') || host.endsWith('.example.org') || host.endsWith('.example.net') || host === 'example.invalid' || host.endsWith('.example.invalid') || host.endsWith('.invalid');
  const hasPlaceholderTemplate = deployment?.subscriptionTemplates.some((item) => !item.templateId.trim() || /(?:example|approved-(?:trial|release)-)/i.test(item.templateId)) ?? true;
  const requiredTypes: NotificationType[] = ['SITE_CONFIRMED', 'VEHICLE_DISPATCHED', 'ARRIVED', 'PARTIAL_REFUND', 'PICKUP_DEADLINE', 'PICKUP_EXPIRED', 'CAMPAIGN_POSTPONED'];
  const configuredTypes = new Set(deployment?.subscriptionTemplates.map((item) => item.type) ?? []);
  const uniqueTemplateIds = new Set(deployment?.subscriptionTemplates.map((item) => item.templateId) ?? []);
  const hasCompleteSemanticMap = requiredTypes.every((type) => configuredTypes.has(type));
  if (!deployment || (key !== 'develop' && key !== 'local' && (deployment.authMode !== 'wechat' || !/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/|$)/i.test(deployment.apiBaseUrl) || isPlaceholderHost || !hasCompleteSemanticMap || uniqueTemplateIds.size !== 4 || hasPlaceholderTemplate))) {
    throw new Error('上传体验版或正式版前，请生成 deployment.local.ts，填入备案 HTTPS 域名，并用四类已审核模板完整映射七类订单事件。');
  }
  return {
    ...deployment,
    // The capability is a build/runtime decision made here. A release or
    // trial config can never opt into demo auth even if its object is edited.
    demoLoginEnabled: (key === 'develop' || key === 'local') && isDemoDeployment(deployment),
  };
}
