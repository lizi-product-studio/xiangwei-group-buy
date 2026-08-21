export type NotificationType = 'SITE_CONFIRMED' | 'VEHICLE_DISPATCHED' | 'ARRIVED' | 'PARTIAL_REFUND' | 'PICKUP_DEADLINE' | 'PICKUP_EXPIRED';
export interface SubscriptionTemplate { type: NotificationType; templateId: string }
export interface MiniProgramDeployment { apiBaseUrl: string; authMode: 'demo' | 'wechat'; subscriptionTemplates: SubscriptionTemplate[] }

type DeploymentKey = 'develop' | 'trial' | 'release';
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

const develop: MiniProgramDeployment = { apiBaseUrl: 'http://127.0.0.1:3100', authMode: 'demo', subscriptionTemplates: [] };

export function resolveDeployment(environment: string): MiniProgramDeployment {
  const key: DeploymentKey = environment === 'release' ? 'release' : environment === 'trial' ? 'trial' : 'develop';
  const deployment = key === 'develop' ? develop : releaseDeployments[key];
  const host = deployment?.apiBaseUrl.match(/^https:\/\/([^/:?#]+)/i)?.[1]?.toLowerCase() ?? '';
  const isPlaceholderHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.example.com') || host.endsWith('.example.org') || host.endsWith('.example.net') || host === 'example.invalid' || host.endsWith('.example.invalid') || host.endsWith('.invalid');
  const hasPlaceholderTemplate = deployment?.subscriptionTemplates.some((item) => !item.templateId.trim() || /(?:example|approved-(?:trial|release)-)/i.test(item.templateId)) ?? true;
  if (!deployment || (key !== 'develop' && (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/|$)/i.test(deployment.apiBaseUrl) || isPlaceholderHost || deployment.subscriptionTemplates.length !== 4 || hasPlaceholderTemplate))) {
    throw new Error('上传体验版或正式版前，请通过 CI 或预上传脚本生成 deployment.local.ts，并填入已备案 HTTPS 域名及四类已审核订阅模板 ID。');
  }
  return deployment;
}
