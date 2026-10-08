import type { EntityCollection } from "./entity-store-records.js";

export type EntityNeed = {
  collection: EntityCollection;
  key?: string | undefined;
  keys?: readonly string[] | undefined;
  index?: "a" | "b" | "c" | "d" | "e" | "f" | undefined;
  indexB?: "a" | "b" | "c" | "d" | "e" | "f" | undefined;
  nullIndex?: "a" | "b" | "c" | "d" | "e" | "f" | undefined;
  value?: string | undefined;
  valueB?: string | undefined;
  values?: readonly string[] | undefined;
  statuses?: readonly string[] | undefined;
  dueBefore?: string | undefined;
  dueAfter?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  orderBy?: "created_desc" | "created_asc" | "due_asc" | undefined;
};
const all = (collection: EntityCollection, limit?: number): EntityNeed => ({ collection, limit });
const key = (collection: EntityCollection, value: unknown): EntityNeed => ({ collection, key: String(value) });
const idx = (collection: EntityCollection, index: EntityNeed["index"], value: unknown): EntityNeed => ({ collection, index, value: String(value) });
const ids = (collection: EntityCollection, index: EntityNeed["index"], values: readonly string[]): EntityNeed => ({ collection, index, values });
const withLines = (needs: EntityNeed[]): EntityNeed[] => {
  const orderIds = needs.filter((need) => need.collection === "orders").flatMap((need) => need.key ? [need.key] : []);
  return orderIds.length ? [...needs, ids("lines", "a", orderIds)] : needs;
};

/** Exact Store method -> indexed entity reads. No implicit whole-store hydration. */
export function entityNeeds(method: string, args: unknown[]): EntityNeed[] {
  const a = args[0];
  const b = args[1];
  const doc = a && typeof a === "object" ? a as Record<string, unknown> : {};
  let needs: EntityNeed[];
  switch (method) {
    case "listFinanceRefundPage": case "listFinanceLedgerPage": case "listServiceAreaInterestPage": needs = []; break;
    case "findUserByWechatOpenId": needs = [idx("users", "a", a)]; break;
    case "getUser": case "saveUser": needs = [key("users", (doc.id ?? a))]; break;
    case "listConsumerUsers": needs = [all("users"), all("staff")]; break;
    case "getUsersByIds": needs = [Array.isArray(a) ? { collection: "users", keys: a.map(String) } : { collection: "users", keys: [] }]; break;
    case "searchConsumerUsers": case "findConsumerUserByPublicNumber": case "findOtherConsumerUserByPhone":
    case "listConsumerUsersMissingPublicNumbers": case "hasDuplicateConsumerPublicNumbers":
    case "allocateConsumerPublicNumber": needs = []; break;
    case "savePrivacyConsent": case "getPrivacyConsent": needs = [key("privacy", `${String(a)}:${String(b)}`)]; break;
    case "getAuthSession": case "getActiveAuthSession": case "saveAuthSession": case "deleteAuthSession": needs = [key("sessions", doc.tokenHash ?? a)]; break;
    case "deleteAuthSessionsByUser": needs = [idx("sessions", "a", a)]; break;
    case "getPasswordChangeToken": case "savePasswordChangeToken": case "deletePasswordChangeToken": needs = [key("passwordChangeTokens", doc.tokenHash ?? a)]; break;
    case "listExpiredAuthenticationData": needs = [
      { collection: "sessions", dueBefore: String(a), limit: Number(b) },
      { collection: "passwordChangeTokens", dueBefore: String(a), limit: Number(b) },
    ]; break;
    case "deleteExpiredAuthenticationData": needs = [{ collection: "sessions", keys: Array.isArray(args[1]) ? args[1] as string[] : [] }, { collection: "passwordChangeTokens", keys: Array.isArray(args[2]) ? args[2] as string[] : [] }]; break;
    case "findAdminCredential": needs = [idx("credentials", "b", String(a).trim().toLowerCase())]; break;
    case "findAdminCredentialByUserId": needs = [idx("credentials", "a", a)]; break;
    case "saveAdminCredential": needs = [key("credentials", String(doc.username).trim().toLowerCase())]; break;
    case "replaceUserRoles": needs = [key("roles", a), idx("credentials", "a", a)]; break;
    case "getAccessRole": case "saveAccessRole": case "deleteAccessRole": needs = [key("accessRoles", doc.id ?? a), key("deletedAccessRoleIds", doc.id ?? a)]; break;
    case "listAccessRoles": needs = [all("accessRoles"), all("deletedAccessRoleIds")]; break;
    case "getInternalStaff": case "saveInternalStaff": needs = [key("staff", doc.userId ?? a)]; break;
    case "listInternalStaff": needs = [all("staff")]; break;
    case "listStaffPickupPointAssignments": needs = a === undefined ? [all("staffPoints")] : [idx("staffPoints", "a", a)]; break;
    case "replaceStaffPickupPointAssignments": needs = [idx("staffPoints", "a", a)]; break;
    case "hasActivePickupPointAssignment": needs = [key("staff", a), key("users", a), key("staffPoints", `${String(a)}:${String(b)}`)]; break;
    case "listServiceAreas": needs = [all("areas")]; break;
    case "saveServiceArea": case "updateServiceAreaOrderEnabled": needs = [key("areas", doc.id ?? a)]; break;
    case "listPickupPoints": needs = a === undefined ? [all("points")] : [idx("points", "a", a)]; break;
    case "savePickupPoint": needs = [key("points", doc.id)]; break;
    case "deletePickupPoint": needs = [key("points", a), idx("staffPoints", "b", a)]; break;
    case "listCatalogSkus": needs = [all("catalog")]; break;
    case "getCatalogSku": case "saveCatalogSku": needs = [key("catalog", doc.id ?? a)]; break;
    case "listProductCategories": needs = [all("categories")]; break;
    case "getProductCategory": case "saveProductCategory": case "deleteProductCategory": needs = [key("categories", doc.id ?? a), idx("catalog", "b", a)]; break;
    case "listHomepageBanners": needs = [all("homepageBanners")]; break;
    case "getHomepageBanner": case "saveHomepageBanner": case "deleteHomepageBanner": needs = [key("homepageBanners", doc.id ?? a)]; break;
    case "listCampaigns": needs = [all("campaigns")]; break;
    case "listCampaignGroups": needs = [all("campaignGroups")]; break;
    case "getCampaignGroup": case "saveCampaignGroup": case "updateCampaignGroup": needs = [key("campaignGroups", doc.id ?? a)]; break;
    case "listCampaignsByStatus": needs = [{ collection: "campaigns", statuses: Array.isArray(a) ? a.map(String) : [] }]; break;
    case "getCampaign": case "getCampaignForUpdate": case "saveCampaign": case "updateCampaign": case "deleteDraftCampaign": needs = [key("campaigns", doc.id ?? a)]; break;
    case "hasCampaignBusinessReferences": needs = [idx("plans", "a", a), idx("orders", "b", a), idx("batches", "a", a), idx("deliveries", "a", a), idx("exceptions", "c", a), idx("drafts", "b", a)]; break;
    case "replaceCampaignItems": case "getCampaignItem": case "reserveCampaignInventory": case "releaseCampaignInventory": needs = [key("campaigns", a)]; break;
    case "getIdempotency": case "getIdempotencyForUpdate": case "saveIdempotency": needs = [key("idempotency", `${String(a)}:${String(b)}`)]; break;
    case "listOrdersByCampaign": needs = [{ ...idx("orders", "b", a), orderBy: "created_asc" }]; break;
    case "listOrdersByUser": needs = [{ ...idx("orders", "a", a), orderBy: "created_desc" }]; break;
    case "listOrders": needs = [{ ...all("orders", Number(a)), orderBy: "created_desc" }]; break;
    case "listExpiredPendingOrders": needs = [{ collection: "orders", statuses: ["PENDING_PAYMENT"], dueBefore: String(a), limit: Number(b), orderBy: "due_asc" }]; break;
    case "getOrder": case "getOrderForUpdate": case "saveOrder": case "saveOrderStatus": case "transitionOrderStatus": case "cancelPendingOrder": case "markPendingOrderPaid": needs = [key("orders", doc.id ?? a)]; break;
    case "getOrderByNo": case "getOrderByNoForUpdate": needs = [idx("orders", "d", a)]; break;
    case "getCheckoutBatch": case "getCheckoutBatchForUpdate": case "saveCheckoutBatch": needs = [key("checkoutBatches", doc.id ?? a)]; break;
    case "getCheckoutBatchByOrder": needs = [idx("checkoutBatches", "c", a)]; break;
    case "getCheckoutBatchByOutTradeNoForUpdate": needs = [idx("checkoutBatches", "b", a)]; break;
    case "saveOrderLines": case "listOrderLinesByOrderForUpdate": needs = [key("orders", a), idx("lines", "a", a)]; break;
    case "listOrderLinesByCampaign": case "listOrderLinesByCampaignForUpdate": needs = [idx("orders", "b", a), idx("lines", "b", a)]; break;
    case "updateOrderLine": needs = [idx("lines", "a", doc.orderId)]; break;
    case "listOrderDeliveryFacts": {
      const orderIds = Array.isArray(a) ? a.map(String) : [];
      needs = [{ collection: "orders", keys: orderIds }, ids("partialRefunds", "a", orderIds), ids("quality", "a", orderIds), ids("pickupReceipts", "a", orderIds), ids("cancellations", "a", orderIds), ids("windows", "a", orderIds), ids("exceptions", "a", orderIds), ids("allocations", "a", orderIds)];
      break;
    }
    case "getPaymentByOrder": case "getPaymentByOrderForUpdate": needs = [idx("payments", "a", a)]; break;
    case "getPaymentBatchByCheckoutBatch": case "getPaymentBatchForUpdate": needs = [idx("paymentBatches", "a", a)]; break;
    case "savePaymentBatch": case "savePaymentBatchIfInitiationClaimed": needs = [key("paymentBatches", doc.id)]; break;
    case "savePayment": case "savePaymentIfStatus": case "savePaymentIfInitiationClaimed": needs = [key("payments", doc.id)]; break;
    case "claimPaymentCallback": needs = [key("callbacks", a)]; break;
    case "getOrderRefund": case "getOrderRefundByOrder": needs = method === "getOrderRefund" ? [key("orderRefunds", a)] : [idx("orderRefunds", "a", a)]; break;
    case "getOrderRefundByProviderNo": needs = [idx("orderRefunds", "b", a)]; break;
    case "saveOrderRefund": needs = [key("orderRefunds", doc.id), idx("orderRefunds", "a", doc.orderId)]; break;
    case "claimOrderRefundSubmission": case "saveOrderRefundIfClaimed": case "saveOrderRefundIfUnclaimed": case "saveOrderRefundIfStatus": needs = [key("orderRefunds", doc.id ?? a)]; break;
    case "listOrderRefunds": needs = [{ ...all("orderRefunds", Number(a)), orderBy: "created_desc" }]; break;
    case "listPendingOrderRefunds": needs = [{ collection: "orderRefunds", statuses: ["CREATED", "SUBMISSION_UNKNOWN", "PROCESSING", "RETRYABLE_FAILURE", "FAILED"], limit: Number(a), orderBy: "created_desc" }]; break;
    case "listRefundingOrders": needs = [{ collection: "orders", statuses: ["REFUNDING"], limit: Number(a), orderBy: "created_desc" }]; break;
    case "getPartialRefund": needs = [key("partialRefunds", a)]; break;
    case "getPartialRefundByProviderNo": needs = [idx("partialRefunds", "b", a)]; break;
    case "listPartialRefunds": needs = [{ ...all("partialRefunds", Number(a)), orderBy: "created_desc" }]; break;
    case "listPartialRefundsByOrder": needs = [idx("partialRefunds", "a", a)]; break;
    case "listPartialRefundsByException": needs = [idx("partialRefunds", "c", a)]; break;
    case "listPendingPartialRefunds": needs = [{ collection: "partialRefunds", statuses: ["CREATED", "SUBMISSION_UNKNOWN", "PROCESSING", "RETRYABLE_FAILURE", "FAILED"], limit: Number(a), orderBy: "created_desc" }]; break;
    case "savePartialRefund": case "claimPartialRefundSubmission": case "savePartialRefundIfClaimed": case "savePartialRefundIfUnclaimed": case "savePartialRefundIfStatus": needs = [key("partialRefunds", doc.id ?? a)]; break;
    case "appendLedgerTransaction": needs = [idx("ledger", "a", doc.referenceId)]; break;
    case "listLedgerTransactions": needs = a === undefined ? [all("ledger")] : [idx("ledger", "a", a)]; break;
    case "saveAuditLog": needs = [key("audits", JSON.stringify([doc.requestId, doc.action]))]; break;
    case "findLatestAudit": needs = []; break;
    case "listAuditLogs": needs = [{ ...all("audits", Number(a)), orderBy: "created_desc" }]; break;
    case "getDeliveryPlan": case "saveDeliveryPlan": needs = [key("plans", doc.id ?? a)]; break;
    case "getDeliveryPlanByCampaign": needs = [idx("plans", "a", a)]; break;
    case "listDeliveryPlans": needs = [all("plans")]; break;
    case "listDeliveryPlansByCampaigns": needs = [ids("plans", "a", Array.isArray(a) ? a.map(String) : [])]; break;
    case "getDispatchBatch": case "saveDispatchBatch": needs = [key("batches", doc.id ?? a)]; break;
    case "listDispatchBatches": needs = [all("batches")]; break;
    case "getPickupCredential": case "savePickupCredential": needs = [key("pickupCredentials", doc.orderId ?? a)]; break;
    case "savePickupRecord": case "pickupRecordExists": needs = [idx("pickupRecords", "a", a)]; break;
    case "getCommunityPickupReceiptByRequestIdForUpdate": needs = [{ collection: "pickupReceipts", index: "a", value: String(a), indexB: "b", valueB: String(b) }]; break;
    case "listCommunityPickupReceipts": needs = [{ ...all("pickupReceipts"), orderBy: "created_desc" }]; break;
    case "listCommunityPickupReceiptsByOrder": needs = [idx("pickupReceipts", "a", a)]; break;
    case "saveCommunityPickupReceipt": needs = [key("pickupReceipts", doc.id), idx("pickupReceipts", "a", doc.orderId)]; break;
    case "getCommunityDeliveryConfirmationByBatch": needs = [idx("deliveries", "b", a)]; break;
    case "saveCommunityDeliveryConfirmation": needs = [key("deliveries", doc.id), idx("deliveries", "b", doc.dispatchBatchId)]; break;
    case "getFulfillmentException": case "getFulfillmentExceptionForUpdate": case "saveFulfillmentException": needs = [key("exceptions", doc.id ?? a)]; break;
    case "getFulfillmentExceptionByOrderRequestForUpdate": needs = [{ collection: "exceptions", index: "a", value: String(a), indexB: "b", valueB: String(b) }]; break;
    case "listFulfillmentExceptions": needs = [{ ...all("exceptions", Number(a)), orderBy: "created_desc" }]; break;
    case "listFulfillmentAllocations": needs = [idx("allocations", "b", a)]; break;
    case "saveFulfillmentAllocations": needs = Array.isArray(a) ? (a as Array<Record<string, unknown>>).map((value) => key("allocations", value.id)) : []; break;
    case "markFulfillmentAllocationsRefunded": {
      const orderId = String((b as Record<string, unknown> | undefined)?.orderId ?? "");
      needs = [{ collection: "allocations", index: "b", value: String(a), indexB: "a", valueB: orderId }, idx("lines", "a", orderId)];
      break;
    }
    case "getCommunityAllocationDraftByDeliveryForUpdate": needs = [idx("drafts", "a", a)]; break;
    case "saveCommunityAllocationDraft": needs = [key("drafts", doc.id), idx("drafts", "a", doc.communityDeliveryId)]; break;
    case "getCommunityPickupWindow": case "getCommunityPickupWindowForUpdate": case "saveCommunityPickupWindow": needs = [key("windows", doc.orderId ?? a)]; break;
    case "listCommunityPickupWindowsPastDeadline": needs = [{ collection: "windows", statuses: ["ACTIVE", "EXTENDED"], dueBefore: String(a), limit: Number(b) }]; break;
    case "listCommunityPickupWindowsDueBy": needs = [{ collection: "windows", statuses: ["ACTIVE", "EXTENDED"], dueAfter: String(a), dueBefore: String(b), limit: Number(args[2]) }]; break;
    case "listCommunityPickupWindowsByStatus": needs = [{ collection: "windows", statuses: Array.isArray(a) ? a as string[] : [], limit: Number(b) }]; break;
    case "getCommunityCancellationRequestByOrderForUpdate": needs = [idx("cancellations", "a", a)]; break;
    case "listCommunityCancellationRequests": needs = [{ ...all("cancellations", Number(a)), orderBy: "created_desc" }]; break;
    case "listPendingCommunityCancellationRequests": needs = [{ collection: "cancellations", statuses: ["DIRECT_REFUNDING", "REFUNDING"], limit: Number(a), orderBy: "created_desc" }]; break;
    case "saveCommunityCancellationRequest": needs = [key("cancellations", doc.id), idx("cancellations", "a", doc.orderId)]; break;
    case "getCommunityQualityCaseByOrderRequest": case "getCommunityQualityCaseByOrderRequestForUpdate": needs = [{ collection: "quality", index: "a", value: String(a), indexB: "b", valueB: String(b) }]; break;
    case "getCommunityQualityCaseForUpdate": needs = [key("quality", a)]; break;
    case "listCommunityQualityCases": needs = [{ ...all("quality", Number(a)), orderBy: "created_desc" }]; break;
    case "listCommunityQualityCasesByOrder": case "listCommunityQualityCasesByOrderForUpdate": needs = [idx("quality", "a", a)]; break;
    case "saveCommunityQualityCase": needs = [key("quality", doc.id), idx("quality", "a", doc.orderId), idx("quality", "b", doc.clientRequestId)]; break;
    case "saveServiceAreaInterest": case "getServiceAreaInterest": needs = [key("interests", doc.id ?? a)]; break;
    case "listServiceAreaInterests": needs = [{ ...all("interests", Number(a)), orderBy: "created_desc" }]; break;
    case "listServiceAreaInterestsByUser": needs = [idx("interests", "a", a)]; break;
    case "createOrderNotificationIfAbsent": needs = [key("notifications", doc.id), idx("notifications", "c", doc.eventKey)]; break;
    case "saveOrderNotificationIfClaimed": case "getOrderNotification": case "beginOrderNotificationSubmission": case "markOrderNotificationSentIfSubmission": case "recordSubmissionUnknownIfSubmission": case "markOrderNotificationRead": case "requeuePendingOrderNotification": case "markOrderNotificationManualCompleted": needs = [key("notifications", (doc.id ?? a))]; break;
    case "listOrderNotificationsByUser": needs = [{ ...idx("notifications", "a", a), orderBy: "created_desc" }]; break;
    case "listManualOrderNotifications": needs = [{ collection: "notifications", statuses: ["MANUAL_REQUIRED", "SUBMISSION_UNKNOWN", "PENDING_DELIVERY"], limit: Number(a), orderBy: "created_desc" }]; break;
    case "claimPendingOrderNotifications": needs = [{ collection: "notifications", statuses: ["PENDING_DELIVERY"], limit: Math.min(5, Number(a)), orderBy: "due_asc" }]; break;
    case "saveNotificationPreference": case "getNotificationPreference": needs = [key("preferences", doc.userId ?? a)]; break;
    case "searchOrders": case "countOrdersByStatus": case "listPickupCodeCandidates": case "getNetSalesQuantities": case "listPickupReceiptOrderPage": case "countCampaignsByServiceAreaStatuses": case "countActiveCampaignReferencesForCatalogSku": case "countInProgressDeliveryForPickupPoint": needs = []; break;
    case "listOperationsQueue": needs = []; break;
    default: throw new Error(`Entity Store method plan missing: ${method}`);
  }
  return withLines(needs);
}
