import type { CommerceStore } from '../core/store.js';

type NotificationOrderEnqueueMethod =
  | 'createOrderNotificationIfAbsent'
  | 'getNotificationPreference'
  | 'getOrder';

/** Minimum outbox capabilities accepted inside another domain transaction. */
export type NotificationOrderEnqueueStore = Pick<CommerceStore, NotificationOrderEnqueueMethod>;

export type NotificationCampaignEnqueueStore = NotificationOrderEnqueueStore &
  Pick<CommerceStore, 'listOrdersByCampaign'>;
