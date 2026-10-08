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

function primeLocationPermission(): void {
  wx.getSetting({
    success(settings) {
      const authorization = settings.authSetting['scope.userLocation'];
      if (authorization === true) {
        wx.getLocation({ type: 'gcj02', fail: () => undefined });
        return;
      }
      if (authorization === false || wx.getStorageSync<boolean>('locationPermissionPrompted')) return;
      wx.setStorageSync('locationPermissionPrompted', true);
      wx.authorize({
        scope: 'scope.userLocation',
        success: () => wx.getLocation({ type: 'gcj02', fail: () => undefined }),
        fail: () => undefined,
      });
    },
    fail: () => undefined,
  });
}

App<IAppOption>({
  onLaunch() { primeLocationPermission(); },
  globalData: {
    apiBaseUrl: deployment.apiBaseUrl,
    authMode: deployment.authMode,
    demoLoginEnabled: deployment.demoLoginEnabled === true,
    accessToken: null,
    latestRequestId: "",
    subscriptionTemplates: deployment.subscriptionTemplates,
  },
});
