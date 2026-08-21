import type { CommerceStore } from '../core/store.js';

type CommunityOperationsMethod =
  | 'createOrderNotificationIfAbsent'
  | 'getCampaign'
  | 'getCommunityCancellationRequestByOrderForUpdate'
  | 'getCommunityPickupWindowForUpdate'
  | 'getDeliveryPlan'
  | 'getNotificationPreference'
  | 'getOrder'
  | 'getOrderForUpdate'
  | 'getPaymentByOrderForUpdate'
  | 'getPickupCredential'
  | 'getPlatformRefundByOrder'
  | 'listCommunityPickupWindowsByStatus'
  | 'listCommunityPickupWindowsDueBy'
  | 'listCommunityPickupWindowsPastDeadline'
  | 'listDispatchBatches'
  | 'listPendingCommunityCancellationRequests'
  | 'listPlatformPartialRefundsByException'
  | 'listPlatformPartialRefundsByOrder'
  | 'listPlatformSalesLinesByOrderForUpdate'
  | 'saveAuditLog'
  | 'saveCommunityCancellationRequest'
  | 'saveCommunityPickupWindow'
  | 'saveFulfillmentAllocations'
  | 'saveFulfillmentException'
  | 'saveOrderStatus'
  | 'savePickupCredential';

type CommunityOperationsCapabilities = Pick<CommerceStore, CommunityOperationsMethod>;

/**
 * Storage capabilities required by paid cancellation and pickup expiry flows.
 * Procurement, warehouse, legacy merchant settlement, and staff administration
 * facts are intentionally unavailable to this service boundary.
 */
export interface CommunityOperationsStore extends CommunityOperationsCapabilities {
  transaction<T>(work: (store: CommunityOperationsStore) => Promise<T>): Promise<T>;
}

type CommunityQualityMethod =
  | 'databaseNow'
  | 'getCommunityQualityCaseByOrderRequestForUpdate'
  | 'getCommunityQualityCaseForUpdate'
  | 'getOrderForUpdate'
  | 'listCommunityQualityCasesByOrderForUpdate'
  | 'listPlatformPartialRefundsByException'
  | 'saveAuditLog'
  | 'saveCommunityQualityCase'
  | 'saveFulfillmentAllocations'
  | 'saveFulfillmentException';

type CommunityQualityCapabilities = Pick<CommerceStore, CommunityQualityMethod>;

/** Storage boundary for the post-pickup quality case lifecycle. */
export interface CommunityQualityStore extends CommunityQualityCapabilities {
  transaction<T>(work: (store: CommunityQualityStore) => Promise<T>): Promise<T>;
}
