import { resolveDeployment } from './config/deployment';

type MiniProgramEnvironment = 'develop' | 'trial' | 'release';

export function readMiniProgramEnvironment(accountInfo: unknown): MiniProgramEnvironment {
  const environment =
    accountInfo && typeof accountInfo === 'object'
      ? (accountInfo as { miniProgram?: { envVersion?: unknown } }).miniProgram?.envVersion
      : undefined;
  if (environment !== 'develop' && environment !== 'trial' && environment !== 'release') {
    throw new Error('无法确认小程序运行环境，已拒绝启动');
  }
  return environment;
}

const environment = readMiniProgramEnvironment(wx.getAccountInfoSync?.());
const deployment = resolveDeployment(environment);

App<IAppOption>({
  globalData: {
    apiBaseUrl: deployment.apiBaseUrl,
    authMode: deployment.authMode,
    demoLoginEnabled: deployment.demoLoginEnabled === true,
    accessToken: null,
    latestRequestId: "",
    subscriptionTemplates: deployment.subscriptionTemplates,
  },
});
