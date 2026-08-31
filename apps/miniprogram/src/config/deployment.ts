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

/**
 * CI or the pre-upload step generates this gitignored module from release secrets.
 * It deliberately does not exist in a fresh checkout, so fake production hosts can
 * never silently be uploaded.
 */
let releaseDeployments: ReleaseDeployments = {};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- this optional file is generated only in the secure upload workspace.
  const generated = require('./deployment.local') as { deployments?: ReleaseDeployments };
  releaseDeployments = generated.deployments ?? {};
} catch {
  // Development does not need a production deployment file.
}

const develop: MiniProgramDeployment = {
  apiBaseUrl: 'http://127.0.0.1:3100',
  authMode: 'demo',
  subscriptionTemplates: [],
  demoLoginEnabled: true,
};

const LOCAL_HTTP_HOST = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i;

export function isLocalDemoDeployment(
  deployment: Pick<MiniProgramDeployment, 'apiBaseUrl' | 'authMode' | 'demoLoginEnabled'>,
): boolean {
  return (
    deployment.authMode === 'demo' &&
    deployment.demoLoginEnabled === true &&
    LOCAL_HTTP_HOST.test(deployment.apiBaseUrl)
  );
}

export function resolveDeployment(environment: string): MiniProgramDeployment {
  if (environment !== 'develop' && environment !== 'local' && environment !== 'trial' && environment !== 'release') {
    throw new Error('未知的小程序运行环境，已拒绝启动');
  }
  const key: DeploymentKey = environment;
  const deployment = key === 'develop' || key === 'local' ? develop : releaseDeployments[key];
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
    demoLoginEnabled: (key === 'develop' || key === 'local') && isLocalDemoDeployment(deployment),
  };
}
