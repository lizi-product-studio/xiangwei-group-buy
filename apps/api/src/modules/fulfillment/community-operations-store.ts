import type { CommerceStore } from "../core/store.js";

type CommunityOperationsMethod =
  | "createOrderNotificationIfAbsent"
  | "getCampaign"
  | "getCampaignForUpdate"
  | "getCheckoutBatchForUpdate"
  | "getCommunityCancellationRequestByOrderForUpdate"
  | "getCommunityPickupWindowForUpdate"
  | "getDeliveryPlan"
  | "getNotificationPreference"
  | "getOrder"
  | "getOrderForUpdate"
  | "getPaymentByOrderForUpdate"
  | "getPickupCredential"
  | "getOrderRefundByOrder"
  | "saveOrderRefund"
  | "savePaymentIfStatus"
  | "listCommunityPickupWindowsByStatus"
  | "listCommunityPickupWindowsDueBy"
  | "listCommunityPickupWindowsPastDeadline"
  | "listDispatchBatches"
  | "listOrderDeliveryFacts"
  | "listOrdersByCampaign"
  | "listPendingCommunityCancellationRequests"
  | "listPartialRefundsByException"
  | "listPartialRefundsByOrder"
  | "listOrderLinesByOrderForUpdate"
  | "releaseCampaignInventory"
  | "saveAuditLog"
  | "saveCommunityCancellationRequest"
  | "saveCampaign"
  | "saveCommunityPickupWindow"
  | "saveFulfillmentAllocations"
  | "saveFulfillmentException"
  | "saveOrderStatus"
  | "savePickupCredential";

type CommunityOperationsCapabilities = Pick<
  CommerceStore,
  CommunityOperationsMethod
>;

/**
 * Storage capabilities required by paid cancellation and pickup expiry flows.
 * Unrelated operational and staff-administration facts are intentionally
 * unavailable to this service boundary.
 */
export interface CommunityOperationsStore
  extends CommunityOperationsCapabilities {
  transaction<T>(
    work: (store: CommunityOperationsStore) => Promise<T>,
  ): Promise<T>;
}

type CommunityQualityMethod =
  | "databaseNow"
  | "getCampaignForUpdate"
  | "getCommunityQualityCaseByOrderRequestForUpdate"
  | "getCommunityQualityCaseForUpdate"
  | "getOrderRefundByOrder"
  | "getOrderForUpdate"
  | "listOrderDeliveryFacts"
  | "listOrdersByCampaign"
  | "listCommunityQualityCasesByOrderForUpdate"
  | "listCommunityPickupReceiptsByOrder"
  | "listPartialRefundsByException"
  | "saveCampaign"
  | "saveAuditLog"
  | "saveCommunityQualityCase"
  | "saveFulfillmentAllocations"
  | "saveFulfillmentException";

type CommunityQualityCapabilities = Pick<CommerceStore, CommunityQualityMethod>;

/** Storage boundary for the post-pickup quality case lifecycle. */
export interface CommunityQualityStore extends CommunityQualityCapabilities {
  transaction<T>(
    work: (store: CommunityQualityStore) => Promise<T>,
  ): Promise<T>;
}
