import { resolveDeployment } from './config/deployment';

const environment = wx.getAccountInfoSync?.().miniProgram.envVersion ?? 'develop';
const deployment = resolveDeployment(environment);

App<IAppOption>({
  globalData: {
    apiBaseUrl: deployment.apiBaseUrl,
    authMode: deployment.authMode,
    accessToken: null,
    subscriptionTemplates: deployment.subscriptionTemplates,
  },
});
