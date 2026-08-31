import type { MiniProgramDeployment } from './deployment';

/**
 * Copy this file to deployment.local.ts only in the secure upload workspace.
 * Do not commit the copied file: it contains real production routing metadata.
 */
export const deployments: Partial<Record<'trial' | 'release', MiniProgramDeployment>> = {
  trial: {
    apiBaseUrl: 'https://trial-api.example.com',
    authMode: 'wechat',
    subscriptionTemplates: [
      { type: 'SITE_CONFIRMED', templateId: 'approved-trial-site-template-id' },
      { type: 'CAMPAIGN_POSTPONED', templateId: 'approved-trial-site-template-id' },
      { type: 'VEHICLE_DISPATCHED', templateId: 'approved-trial-dispatch-template-id' },
      { type: 'ARRIVED', templateId: 'approved-trial-arrival-template-id' },
      { type: 'PICKUP_DEADLINE', templateId: 'approved-trial-arrival-template-id' },
      { type: 'PICKUP_EXPIRED', templateId: 'approved-trial-arrival-template-id' },
      { type: 'PARTIAL_REFUND', templateId: 'approved-trial-partial-refund-template-id' },
    ],
  },
  release: {
    apiBaseUrl: 'https://api.example.com',
    authMode: 'wechat',
    subscriptionTemplates: [
      { type: 'SITE_CONFIRMED', templateId: 'approved-release-site-template-id' },
      { type: 'CAMPAIGN_POSTPONED', templateId: 'approved-release-site-template-id' },
      { type: 'VEHICLE_DISPATCHED', templateId: 'approved-release-dispatch-template-id' },
      { type: 'ARRIVED', templateId: 'approved-release-arrival-template-id' },
      { type: 'PICKUP_DEADLINE', templateId: 'approved-release-arrival-template-id' },
      { type: 'PICKUP_EXPIRED', templateId: 'approved-release-arrival-template-id' },
      { type: 'PARTIAL_REFUND', templateId: 'approved-release-partial-refund-template-id' },
    ],
  },
};
