import { BUILTIN_ACCESS_ROLES, type AccessRole } from "@hometown/api-contracts";
import type {
  AdminCredential,
  AuditLog,
  AuthSession,
  Campaign,
  CampaignGroup,
  CampaignItem,
  CatalogSku,
  CheckoutBatch,
  CommunityAllocationDraft,
  CommunityCancellationRequest,
  CommunityDeliveryConfirmation,
  CommunityPickupReceipt,
  CommunityPickupWindow,
  CommunityQualityCase,
  DeliveryPlan,
  DispatchBatch,
  FulfillmentAllocation,
  FulfillmentException,
  InternalStaff,
  HomepageBanner,
  LedgerTransaction,
  NotificationPreference,
  Order,
  OrderLine,
  OrderNotification,
  OrderRefund,
  PartialRefund,
  Payment,
  PaymentBatch,
  PasswordChangeToken,
  PickupCredential,
  PickupPoint,
  ProductCategory,
  PrivacyConsent,
  Role,
  ServiceArea,
  ServiceAreaInterest,
  StaffPickupPointAssignment,
  User,
} from "./types.js";
import { getCurrentInternalWriteActor } from "../auth/internal-write-context.js";
import { BusinessError, moneyCents } from "@hometown/domain";
import { productCategoryIconKeys } from "@hometown/api-contracts";
import type { ReconciliationBill, ReconciliationReview } from "./historical-reconciliation.js";

export const STORE_READ_METHODS: ReadonlySet<string> = new Set([
  "findUserByWechatOpenId",
  "listConsumerUsers",
  "getUsersByIds",
  "searchConsumerUsers",
  "findConsumerUserByPublicNumber",
  "findOtherConsumerUserByPhone",
  "listConsumerUsersMissingPublicNumbers",
  "hasDuplicateConsumerPublicNumbers",
  "getUser",
  "getActiveAuthSession",
  "getPrivacyConsent",
  "findAdminCredential",
  "findAdminCredentialByUserId",
  "getAccessRole",
  "listAccessRoles",
  "getInternalStaff",
  "listInternalStaff",
  "listStaffPickupPointAssignments",
  "hasActivePickupPointAssignment",
  "listServiceAreas",
  "listPickupPoints",
  "listCatalogSkus",
  "getCatalogSku",
  "listProductCategories",
  "getProductCategory",
  "listHomepageBanners",
  "getHomepageBanner",
  "listCampaigns",
  "listCampaignGroups",
  "getCampaignGroup",
  "listCampaignsByStatus",
  "countCampaignsByServiceAreaStatuses",
  "countActiveCampaignReferencesForCatalogSku",
  "countInProgressDeliveryForPickupPoint",
  "getCampaign",
  "hasCampaignBusinessReferences",
  "getCampaignItem",
  "getIdempotency",
  "listOrdersByCampaign",
  "listOrdersByUser",
  "listOrders",
  "searchOrders",
  "countOrdersByStatus",
  "listPickupCodeCandidates",
  "getNetSalesQuantities",
  "listExpiredPendingOrders",
  "getOrder",
  "getOrderByNo",
  "listOrderLinesByCampaign",
  "listOrderDeliveryFacts",
  "getPaymentByOrder",
  "getCheckoutBatch",
  "getCheckoutBatchByOrder",
  "getPaymentBatchByCheckoutBatch",
  "getCheckoutBatch",
  "getCheckoutBatchByOrder",
  "getPaymentBatchByCheckoutBatch",
  "getOrderRefundByOrder",
  "getOrderRefund",
  "getOrderRefundByProviderNo",
  "listOrderRefunds",
  "listPendingOrderRefunds",
  "listRefundingOrders",
  "getPartialRefund",
  "getPartialRefundByProviderNo",
  "listPartialRefunds",
  "listPartialRefundsByOrder",
  "listPartialRefundsByException",
  "listPendingPartialRefunds",
  "listLedgerTransactions",
  "listFinanceRefundPage",
  "listFinanceLedgerPage",
  "findLatestAudit",
  "listAuditLogs",
  "getDeliveryPlan",
  "getDeliveryPlanByCampaign",
  "listDeliveryPlans",
  "listDeliveryPlansByCampaigns",
  "getDispatchBatch",
  "listDispatchBatches",
  "getPickupCredential",
  "getCommunityPickupWindow",
  "listExpiredAuthenticationData",
  "listCommunityPickupReceipts",
  "listCommunityPickupReceiptsByOrder",
  "listPickupReceiptOrderPage",
  "getCommunityDeliveryConfirmationByBatch",
  "getFulfillmentException",
  "listFulfillmentExceptions",
  "listFulfillmentAllocations",
  "listOperationsQueue",
  "listCommunityPickupWindowsPastDeadline",
  "listCommunityPickupWindowsDueBy",
  "listCommunityPickupWindowsByStatus",
  "listCommunityCancellationRequests",
  "listPendingCommunityCancellationRequests",
  "getCommunityQualityCaseByOrderRequest",
  "listCommunityQualityCases",
  "listCommunityQualityCasesByOrder",
  "getServiceAreaInterest",
  "listServiceAreaInterests",
  "listServiceAreaInterestPage",
  "listServiceAreaInterestsByUser",
  "getOrderNotification",
  "listOrderNotificationsByUser",
  "listManualOrderNotifications",
  "getNotificationPreference",
  "pickupRecordExists",
]);

export interface IdempotencyRecord {
  fingerprint: string;
  orderId: string;
  checkoutBatchId?: string;
}
export interface OrderDeliveryFacts {
  partialRefunds: PartialRefund[];
  qualityCases: CommunityQualityCase[];
  pickupReceipts: CommunityPickupReceipt[];
  cancellations: CommunityCancellationRequest[];
  pickupWindows: CommunityPickupWindow[];
  exceptions: FulfillmentException[];
  allocations: FulfillmentAllocation[];
  deliveryPlans: DeliveryPlan[];
}
export interface NewOrderLine {
  id: string;
  catalogSkuId: string;
  productId: string;
  title: string;
  skuName: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  imageUrl?: string | null;
}

export interface OperationsQueueTypes {
  cancellations: CommunityCancellationRequest;
  quality: CommunityQualityCase;
  windows: CommunityPickupWindow;
  exceptions: FulfillmentException;
  notifications: OrderNotification;
}
export interface OperationsQueueQuery {
  page: number;
  pageSize: number;
  status?: string | undefined;
  allowedStatuses?: readonly string[];
  sourceStage?: "PICKUP_ARRIVAL" | "CUSTOMER_CLAIM" | undefined;
}
export interface StoreOrderSearchQuery {
  userId?: string | undefined;
  beforeCreatedAt?: string | undefined;
  beforeId?: string | undefined;
  status?: string | undefined;
  statuses?: readonly string[] | undefined;
  /** Include associated quality-aftercare orders alongside the selected statuses. */
  includeCommunityQualityCases?: boolean | undefined;
  excludeStatuses?: readonly string[] | undefined;
  campaignId?: string | undefined;
  pickupPointId?: string | undefined;
  serviceAreaId?: string | undefined;
  catalogSkuId?: string | undefined;
  orderNo?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  dateType?: "CREATED_AT" | "PAID_AT" | undefined;
  keyword?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}
export interface StoreOrderSearchPage {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
  hasMore?: boolean;
  nextCursor?: { createdAt: string; id: string } | null;
}
export interface ConsumerSearchPage {
  items: User[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PickupReceiptOrderPage {
  items: Array<{ receipt: CommunityPickupReceipt; order: Order }>;
  total: number;
  page: number;
  pageSize: number;
}
export interface PickupCodeCandidate {
  order: Order;
  codeHash: string;
}
export interface OperationsQueuePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ServiceAreaInterestPageQuery { page: number; pageSize: number; status?: ServiceAreaInterest["status"] }
export type ServiceAreaInterestPage = OperationsQueuePage<ServiceAreaInterest>;

export interface FinanceRefundPageQuery { limit: number; status?: string; orderId?: string; reference?: string; cursor?: string }
export interface FinanceRefundPage { items: Array<(OrderRefund | PartialRefund) & { refundType: "FULL" | "PARTIAL" }>; total: number; nextCursor: string | null; pageSize: number }
export interface FinanceLedgerPageQuery { limit: number; referenceId?: string; cursor?: string }
export interface FinanceLedgerPage { items: LedgerTransaction[]; total: number; nextCursor: string | null; pageSize: number }

/** The complete persistence boundary for the single community group-buy product. */
export interface CommerceStore {
  listFinanceRefundPage(query: FinanceRefundPageQuery): Promise<FinanceRefundPage>;
  listFinanceLedgerPage(query: FinanceLedgerPageQuery): Promise<FinanceLedgerPage>;
  getAggregatePayloadStatus?(): { payloadBytes: number | null; tier: "ok" | "warning" | "critical" };
  readSnapshot<T>(work: (store: CommerceStore) => Promise<T>): Promise<T>;
  listOperationsQueue<K extends keyof OperationsQueueTypes>(kind: K, query: OperationsQueueQuery): Promise<OperationsQueuePage<OperationsQueueTypes[K]>>;
  transaction<T>(work: (store: CommerceStore) => Promise<T>): Promise<T>;
  health(): Promise<"ok">;
  databaseNow(): Promise<string>;
  close(): Promise<void>;
  getPersistenceMode?(): Promise<"LEGACY" | "PREPARED" | "ENTITY">;
  findUserByWechatOpenId(openId: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  listConsumerUsers(): Promise<User[]>;
  getUsersByIds(ids: readonly string[]): Promise<User[]>;
  searchConsumerUsers(query: string, page: number, pageSize: number): Promise<ConsumerSearchPage>;
  findConsumerUserByPublicNumber(number: number): Promise<User | null>;
  findOtherConsumerUserByPhone(phone: string, excludeUserId: string): Promise<User | null>;
  listConsumerUsersMissingPublicNumbers(limit: number): Promise<User[]>;
  hasDuplicateConsumerPublicNumbers(): Promise<boolean>;
  allocateConsumerPublicNumber(userId: string): Promise<number>;
  saveUser(value: User): Promise<void>;
  savePrivacyConsent(userId: string, documentVersion: string): Promise<void>;
  getPrivacyConsent(
    userId: string,
    documentVersion: string,
  ): Promise<PrivacyConsent | null>;
  getAuthSession(tokenHash: string): Promise<AuthSession | null>;
  getActiveAuthSession(tokenHash: string): Promise<AuthSession | null>;
  saveAuthSession(value: AuthSession): Promise<void>;
  deleteAuthSession(tokenHash: string): Promise<void>;
  deleteAuthSessionsByUser(userId: string): Promise<void>;
  getPasswordChangeToken(tokenHash: string): Promise<PasswordChangeToken | null>;
  listExpiredAuthenticationData(now: string, limit: number): Promise<{ sessions: string[]; passwordChangeTokens: string[] }>;
  deleteExpiredAuthenticationData(now: string, sessions: string[], passwordChangeTokens: string[]): Promise<number>;
  savePasswordChangeToken(value: PasswordChangeToken): Promise<void>;
  deletePasswordChangeToken(tokenHash: string): Promise<void>;
  findAdminCredential(username: string): Promise<AdminCredential | null>;
  findAdminCredentialByUserId(userId: string): Promise<AdminCredential | null>;
  saveAdminCredential(value: AdminCredential): Promise<void>;
  /**
   * Keep the authorization projection and credential revision in sync.  A
   * revision is supplied only for a real authorization change; ordinary
   * profile edits leave both the revision and extant sessions untouched.
   */
  replaceUserRoles(
    userId: string,
    roles: Role[],
    authorizationVersion?: number,
  ): Promise<void>;
  getAccessRole(id: string): Promise<AccessRole | null>;
  listAccessRoles(): Promise<AccessRole[]>;
  saveAccessRole(value: AccessRole): Promise<void>;
  deleteAccessRole(id: string): Promise<void>;
  getInternalStaff(userId: string): Promise<InternalStaff | null>;
  listInternalStaff(query?: string): Promise<InternalStaff[]>;
  saveInternalStaff(value: InternalStaff): Promise<void>;
  listStaffPickupPointAssignments(
    staffUserId?: string,
  ): Promise<StaffPickupPointAssignment[]>;
  replaceStaffPickupPointAssignments(
    staffUserId: string,
    values: StaffPickupPointAssignment[],
  ): Promise<void>;
  hasActivePickupPointAssignment(
    userId: string,
    pickupPointId: string,
  ): Promise<boolean>;
  listServiceAreas(): Promise<ServiceArea[]>;
  saveServiceArea(value: ServiceArea): Promise<void>;
  updateServiceAreaOrderEnabled(id: string, enabled: boolean): Promise<boolean>;
  listPickupPoints(serviceAreaId?: string): Promise<PickupPoint[]>;
  savePickupPoint(value: PickupPoint): Promise<void>;
  deletePickupPoint(id: string): Promise<boolean>;
  listCatalogSkus(): Promise<CatalogSku[]>;
  getCatalogSku(id: string): Promise<CatalogSku | null>;
  saveCatalogSku(value: CatalogSku): Promise<void>;
  listProductCategories(includeInactive?: boolean): Promise<ProductCategory[]>;
  getProductCategory(id: string): Promise<ProductCategory | null>;
  saveProductCategory(value: ProductCategory): Promise<void>;
  deleteProductCategory(id: string): Promise<boolean>;
  listHomepageBanners(includeInactive?: boolean): Promise<HomepageBanner[]>;
  getHomepageBanner(id: string): Promise<HomepageBanner | null>;
  saveHomepageBanner(value: HomepageBanner): Promise<void>;
  deleteHomepageBanner(id: string, expectedVersion: number): Promise<boolean>;
  listCampaigns(): Promise<Campaign[]>;
  listCampaignGroups(): Promise<CampaignGroup[]>;
  getCampaignGroup(id: string): Promise<CampaignGroup | null>;
  saveCampaignGroup(value: CampaignGroup): Promise<void>;
  updateCampaignGroup(value: CampaignGroup, expectedVersion: number): Promise<boolean>;
  /** Campaigns in the given statuses only; avoids reading campaign history. */
  listCampaignsByStatus(statuses: readonly string[]): Promise<Campaign[]>;
  countCampaignsByServiceAreaStatuses(serviceAreaId: string, statuses: readonly string[]): Promise<number>;
  countActiveCampaignReferencesForCatalogSku(catalogSkuId: string, statuses: readonly string[]): Promise<number>;
  countInProgressDeliveryForPickupPoint(pickupPointId: string, planStatuses: readonly string[], campaignStatuses: readonly string[]): Promise<number>;
  getCampaign(id: string): Promise<Campaign | null>;
  getCampaignForUpdate(id: string): Promise<Campaign | null>;
  saveCampaign(value: Campaign): Promise<void>;
  updateCampaign(value: Campaign, expectedVersion: number): Promise<boolean>;
  deleteDraftCampaign(id: string, expectedVersion: number): Promise<boolean>;
  hasCampaignBusinessReferences(id: string): Promise<boolean>;
  replaceCampaignItems(
    campaignId: string,
    items: CampaignItem[],
  ): Promise<void>;
  getCampaignItem(
    campaignId: string,
    catalogSkuId: string,
  ): Promise<CampaignItem | null>;
  reserveCampaignInventory(
    campaignId: string,
    catalogSkuId: string,
    quantity: number,
  ): Promise<boolean>;
  releaseCampaignInventory(
    campaignId: string,
    catalogSkuId: string,
    quantity: number,
  ): Promise<boolean>;
  getIdempotency(
    actorId: string,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  getIdempotencyForUpdate(
    actorId: string,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  saveIdempotency(
    actorId: string,
    key: string,
    value: IdempotencyRecord,
  ): Promise<void>;
  listOrdersByCampaign(campaignId: string): Promise<Order[]>;
  listOrdersByUser(userId: string): Promise<Order[]>;
  listOrders(limit: number): Promise<Order[]>;
  searchOrders(query: StoreOrderSearchQuery): Promise<StoreOrderSearchPage>;
  countOrdersByStatus(statuses?: readonly string[], excludeStatuses?: readonly string[]): Promise<number>;
  listPickupCodeCandidates(pickupPointId: string, codeHash: string, orderNo?: string): Promise<PickupCodeCandidate[]>;
  getNetSalesQuantities(campaignId?: string): Promise<Map<string, number>>;
  listPickupReceiptOrderPage(pickupPointIds: readonly string[], orderNo: string | undefined, page: number, pageSize: number): Promise<PickupReceiptOrderPage>;
  listExpiredPendingOrders(now: string, limit: number): Promise<Order[]>;
  getOrder(id: string): Promise<Order | null>;
  getOrderForUpdate(id: string): Promise<Order | null>;
  getOrderByNo(orderNo: string): Promise<Order | null>;
  getOrderByNoForUpdate(orderNo: string): Promise<Order | null>;
  getCheckoutBatch(id: string): Promise<CheckoutBatch | null>;
  getCheckoutBatchForUpdate(id: string): Promise<CheckoutBatch | null>;
  getCheckoutBatchByOrder(orderId: string): Promise<CheckoutBatch | null>;
  getCheckoutBatchByOutTradeNoForUpdate(outTradeNo: string): Promise<CheckoutBatch | null>;
  saveCheckoutBatch(value: CheckoutBatch): Promise<void>;
  getCheckoutBatch(id: string): Promise<CheckoutBatch | null>;
  getCheckoutBatchForUpdate(id: string): Promise<CheckoutBatch | null>;
  getCheckoutBatchByOrder(orderId: string): Promise<CheckoutBatch | null>;
  getCheckoutBatchByOutTradeNoForUpdate(outTradeNo: string): Promise<CheckoutBatch | null>;
  saveCheckoutBatch(value: CheckoutBatch): Promise<void>;
  saveOrder(value: Order): Promise<void>;
  saveOrderStatus(value: Order): Promise<void>;
  transitionOrderStatus(
    id: string,
    expected: Order["status"][],
    next: Order["status"],
    paidAt?: string | null,
  ): Promise<boolean>;
  cancelPendingOrder(id: string): Promise<boolean>;
  markPendingOrderPaid(id: string, paidAt: string): Promise<boolean>;
  saveOrderLines(orderId: string, values: NewOrderLine[]): Promise<void>;
  listOrderLinesByCampaign(campaignId: string): Promise<OrderLine[]>;
  listOrderLinesByCampaignForUpdate(campaignId: string): Promise<OrderLine[]>;
  listOrderLinesByOrderForUpdate(orderId: string): Promise<OrderLine[]>;
  updateOrderLine(value: OrderLine): Promise<boolean>;
  listOrderDeliveryFacts(orderIds: string[]): Promise<OrderDeliveryFacts>;
  getPaymentByOrder(orderId: string): Promise<Payment | null>;
  getPaymentByOrderForUpdate(orderId: string): Promise<Payment | null>;
  getPaymentBatchByCheckoutBatch(checkoutBatchId: string): Promise<PaymentBatch | null>;
  getPaymentBatchForUpdate(checkoutBatchId: string): Promise<PaymentBatch | null>;
  savePaymentBatch(value: PaymentBatch): Promise<void>;
  savePaymentBatchIfInitiationClaimed(value: PaymentBatch, token: string): Promise<boolean>;
  getPaymentBatchByCheckoutBatch(checkoutBatchId: string): Promise<PaymentBatch | null>;
  getPaymentBatchForUpdate(checkoutBatchId: string): Promise<PaymentBatch | null>;
  savePaymentBatch(value: PaymentBatch): Promise<void>;
  savePaymentBatchIfInitiationClaimed(value: PaymentBatch, token: string): Promise<boolean>;
  savePayment(value: Payment): Promise<void>;
  savePaymentIfStatus(
    value: Payment,
    expected: Payment["status"][],
  ): Promise<boolean>;
  savePaymentIfInitiationClaimed(
    value: Payment,
    claimToken: string,
  ): Promise<boolean>;
  claimPaymentCallback(eventId: string, bodyHash: string): Promise<boolean>;
  getOrderRefundByOrder(orderId: string): Promise<OrderRefund | null>;
  getOrderRefund(id: string): Promise<OrderRefund | null>;
  getOrderRefundByProviderNo(
    providerRefundNo: string,
  ): Promise<OrderRefund | null>;
  saveOrderRefund(value: OrderRefund): Promise<void>;
  claimOrderRefundSubmission(
    id: string,
    leaseUntil: string,
    now: string,
    claimToken: string,
  ): Promise<boolean>;
  saveOrderRefundIfClaimed(
    value: OrderRefund,
    claimToken: string,
  ): Promise<boolean>;
  saveOrderRefundIfUnclaimed(value: OrderRefund, now: string): Promise<boolean>;
  saveOrderRefundIfStatus(
    value: OrderRefund,
    expected: OrderRefund["status"][],
  ): Promise<boolean>;
  listOrderRefunds(limit: number): Promise<OrderRefund[]>;
  listPendingOrderRefunds(limit: number): Promise<OrderRefund[]>;
  listRefundingOrders(limit: number): Promise<Order[]>;
  getPartialRefund(id: string): Promise<PartialRefund | null>;
  getPartialRefundByProviderNo(
    providerRefundNo: string,
  ): Promise<PartialRefund | null>;
  listPartialRefunds(limit: number): Promise<PartialRefund[]>;
  listPartialRefundsByOrder(orderId: string): Promise<PartialRefund[]>;
  listPartialRefundsByException(exceptionId: string): Promise<PartialRefund[]>;
  listPendingPartialRefunds(limit: number): Promise<PartialRefund[]>;
  savePartialRefund(value: PartialRefund): Promise<void>;
  claimPartialRefundSubmission(
    id: string,
    leaseUntil: string,
    now: string,
    claimToken: string,
  ): Promise<boolean>;
  savePartialRefundIfClaimed(
    value: PartialRefund,
    claimToken: string,
  ): Promise<boolean>;
  savePartialRefundIfUnclaimed(
    value: PartialRefund,
    now: string,
  ): Promise<boolean>;
  savePartialRefundIfStatus(
    value: PartialRefund,
    expected: PartialRefund["status"][],
  ): Promise<boolean>;
  appendLedgerTransaction(value: LedgerTransaction): Promise<boolean>;
  listLedgerTransactions(referenceId?: string): Promise<LedgerTransaction[]>;
  saveAuditLog(value: AuditLog): Promise<void>;
  findLatestAudit(
    resourceType: string,
    resourceId: string,
    action: string,
  ): Promise<AuditLog | null>;
  listAuditLogs(limit: number): Promise<AuditLog[]>;
  getDeliveryPlan(id: string): Promise<DeliveryPlan | null>;
  getDeliveryPlanByCampaign(campaignId: string): Promise<DeliveryPlan | null>;
  listDeliveryPlans(): Promise<DeliveryPlan[]>;
  /** Delivery plans belonging to the given campaigns only. */
  listDeliveryPlansByCampaigns(campaignIds: readonly string[]): Promise<DeliveryPlan[]>;
  saveDeliveryPlan(value: DeliveryPlan): Promise<void>;
  getDispatchBatch(id: string): Promise<DispatchBatch | null>;
  listDispatchBatches(): Promise<DispatchBatch[]>;
  saveDispatchBatch(value: DispatchBatch): Promise<void>;
  getPickupCredential(orderId: string): Promise<PickupCredential | null>;
  savePickupCredential(value: PickupCredential): Promise<void>;
  savePickupRecord(
    orderId: string,
    deliveryPlanId: string,
    verifierId: string,
  ): Promise<void>;
  pickupRecordExists(orderId: string): Promise<boolean>;
  getCommunityPickupReceiptByRequestIdForUpdate(
    orderId: string,
    pickupRequestId: string,
  ): Promise<CommunityPickupReceipt | null>;
  listCommunityPickupReceipts(): Promise<CommunityPickupReceipt[]>;
  listCommunityPickupReceiptsByOrder(
    orderId: string,
  ): Promise<CommunityPickupReceipt[]>;
  saveCommunityPickupReceipt(value: CommunityPickupReceipt): Promise<boolean>;
  getCommunityDeliveryConfirmationByBatch(
    batchId: string,
  ): Promise<CommunityDeliveryConfirmation | null>;
  saveCommunityDeliveryConfirmation(
    value: CommunityDeliveryConfirmation,
  ): Promise<boolean>;
  getFulfillmentException(id: string): Promise<FulfillmentException | null>;
  getFulfillmentExceptionForUpdate(
    id: string,
  ): Promise<FulfillmentException | null>;
  getFulfillmentExceptionByOrderRequestForUpdate(
    orderId: string,
    requestId: string,
  ): Promise<FulfillmentException | null>;
  listFulfillmentExceptions(limit: number): Promise<FulfillmentException[]>;
  saveFulfillmentException(value: FulfillmentException): Promise<void>;
  listFulfillmentAllocations(
    exceptionId: string,
  ): Promise<FulfillmentAllocation[]>;
  saveFulfillmentAllocations(values: FulfillmentAllocation[]): Promise<void>;
  markFulfillmentAllocationsRefunded(
    exceptionId: string,
    refund: PartialRefund,
    at: string,
  ): Promise<boolean>;
  getCommunityAllocationDraftByDeliveryForUpdate(
    deliveryId: string,
  ): Promise<CommunityAllocationDraft | null>;
  saveCommunityAllocationDraft(
    value: CommunityAllocationDraft,
  ): Promise<boolean>;
  getCommunityPickupWindowForUpdate(
    orderId: string,
  ): Promise<CommunityPickupWindow | null>;
  getCommunityPickupWindow(orderId: string): Promise<CommunityPickupWindow | null>;
  saveCommunityPickupWindow(value: CommunityPickupWindow): Promise<void>;
  listCommunityPickupWindowsPastDeadline(
    now: string,
    limit: number,
  ): Promise<CommunityPickupWindow[]>;
  listCommunityPickupWindowsDueBy(
    from: string,
    to: string,
    limit: number,
  ): Promise<CommunityPickupWindow[]>;
  listCommunityPickupWindowsByStatus(
    statuses: CommunityPickupWindow["status"][],
    limit: number,
  ): Promise<CommunityPickupWindow[]>;
  getCommunityCancellationRequestByOrderForUpdate(
    orderId: string,
  ): Promise<CommunityCancellationRequest | null>;
  listCommunityCancellationRequests(
    limit: number,
  ): Promise<CommunityCancellationRequest[]>;
  listPendingCommunityCancellationRequests(
    limit: number,
  ): Promise<CommunityCancellationRequest[]>;
  saveCommunityCancellationRequest(
    value: CommunityCancellationRequest,
  ): Promise<boolean>;
  getCommunityQualityCaseByOrderRequest(
    orderId: string,
    requestId: string,
  ): Promise<CommunityQualityCase | null>;
  getCommunityQualityCaseByOrderRequestForUpdate(
    orderId: string,
    requestId: string,
  ): Promise<CommunityQualityCase | null>;
  getCommunityQualityCaseForUpdate(
    id: string,
  ): Promise<CommunityQualityCase | null>;
  listCommunityQualityCases(limit: number): Promise<CommunityQualityCase[]>;
  listCommunityQualityCasesByOrder(
    orderId: string,
  ): Promise<CommunityQualityCase[]>;
  listCommunityQualityCasesByOrderForUpdate(
    orderId: string,
  ): Promise<CommunityQualityCase[]>;
  saveCommunityQualityCase(value: CommunityQualityCase): Promise<boolean>;
  saveServiceAreaInterest(value: ServiceAreaInterest): Promise<void>;
  getServiceAreaInterest(id: string): Promise<ServiceAreaInterest | null>;
  listServiceAreaInterests(limit: number): Promise<ServiceAreaInterest[]>;
  listServiceAreaInterestPage(query: ServiceAreaInterestPageQuery): Promise<ServiceAreaInterestPage>;
  listServiceAreaInterestsByUser(
    userId: string,
  ): Promise<ServiceAreaInterest[]>;
  createOrderNotificationIfAbsent(value: OrderNotification): Promise<boolean>;
  saveOrderNotificationIfClaimed(
    value: OrderNotification,
    claimToken: string,
  ): Promise<boolean>;
  getOrderNotification(id: string): Promise<OrderNotification | null>;
  listOrderNotificationsByUser(userId: string): Promise<OrderNotification[]>;
  listManualOrderNotifications(limit: number): Promise<OrderNotification[]>;
  claimPendingOrderNotifications(
    limit: number,
    leaseDurationMs: number,
    claimToken: string,
  ): Promise<OrderNotification[]>;
  beginOrderNotificationSubmission(input: {
    id: string;
    claimToken: string;
    attemptId: string;
  }): Promise<OrderNotification | null>;
  markOrderNotificationSentIfSubmission(
    id: string,
    attemptId: string,
    receiptId: string | null,
  ): Promise<OrderNotification | null>;
  recordSubmissionUnknownIfSubmission(
    id: string,
    attemptId: string,
    reason: string,
  ): Promise<OrderNotification | null>;
  markOrderNotificationRead(id: string, readAt: string): Promise<void>;
  requeuePendingOrderNotification(
    id: string,
    now: string,
  ): Promise<OrderNotification | null>;
  markOrderNotificationManualCompleted(
    id: string,
    actorId: string,
    note: string,
    completedAt: string,
    evidence: {
      channel:
        | "WECHAT_CUSTOMER_SERVICE"
        | "EXTERNAL_CRM"
        | "OTHER_APPROVED_CHANNEL";
      externalReference: string;
      result: "REACHED" | "USER_ACKNOWLEDGED" | "RESOLVED";
    },
  ): Promise<OrderNotification | null>;
  saveNotificationPreference(value: NotificationPreference): Promise<void>;
  getNotificationPreference(
    userId: string,
  ): Promise<NotificationPreference | null>;
}

type StoredLine = OrderLine & {
  productId: string;
  title: string;
  skuName: string;
};
interface MemoryState {
  users: Map<string, User>;
  privacy: Map<string, PrivacyConsent>;
  sessions: Map<string, AuthSession>;
  passwordChangeTokens: Map<string, PasswordChangeToken>;
  credentials: Map<string, AdminCredential>;
  roles: Map<string, Role[]>;
  accessRoles: Map<string, AccessRole>;
  deletedAccessRoleIds: Set<string>;
  staff: Map<string, InternalStaff>;
  staffPoints: Map<string, StaffPickupPointAssignment>;
  areas: Map<string, ServiceArea>;
  points: Map<string, PickupPoint>;
  catalog: Map<string, CatalogSku>;
  categories: Map<string, ProductCategory>;
  homepageBanners: Map<string, HomepageBanner>;
  campaigns: Map<string, Campaign>;
  campaignGroups: Map<string, CampaignGroup>;
  idempotency: Map<string, IdempotencyRecord>;
  orders: Map<string, Order>;
  checkoutBatches: Map<string, CheckoutBatch>;
  lines: Map<string, StoredLine[]>;
  payments: Map<string, Payment>;
  paymentBatches: Map<string, PaymentBatch>;
  callbacks: Map<string, string>;
  orderRefunds: Map<string, OrderRefund>;
  partialRefunds: Map<string, PartialRefund>;
  ledger: Map<string, LedgerTransaction>;
  audits: AuditLog[];
  plans: Map<string, DeliveryPlan>;
  batches: Map<string, DispatchBatch>;
  pickupCredentials: Map<string, PickupCredential>;
  pickupRecords: Set<string>;
  pickupReceipts: Map<string, CommunityPickupReceipt>;
  deliveries: Map<string, CommunityDeliveryConfirmation>;
  exceptions: Map<string, FulfillmentException>;
  allocations: Map<string, FulfillmentAllocation>;
  drafts: Map<string, CommunityAllocationDraft>;
  windows: Map<string, CommunityPickupWindow>;
  cancellations: Map<string, CommunityCancellationRequest>;
  quality: Map<string, CommunityQualityCase>;
  interests: Map<string, ServiceAreaInterest>;
  notifications: Map<string, OrderNotification>;
  preferences: Map<string, NotificationPreference>;
  reconciliationBills: Map<string, ReconciliationBill>;
  reconciliationReviews: Map<string, ReconciliationReview>;
}
const emptyState = (): MemoryState => ({
  users: new Map(),
  privacy: new Map(),
  sessions: new Map(),
  passwordChangeTokens: new Map(),
  credentials: new Map(),
  roles: new Map(),
  accessRoles: new Map(),
  deletedAccessRoleIds: new Set(),
  staff: new Map(),
  staffPoints: new Map(),
  areas: new Map(),
  points: new Map(),
  catalog: new Map(),
  categories: new Map(),
  homepageBanners: new Map(),
  campaigns: new Map(),
  campaignGroups: new Map(),
  idempotency: new Map(),
  orders: new Map(),
  checkoutBatches: new Map(),
  lines: new Map(),
  payments: new Map(),
  paymentBatches: new Map(),
  callbacks: new Map(),
  orderRefunds: new Map(),
  partialRefunds: new Map(),
  ledger: new Map(),
  audits: [],
  plans: new Map(),
  batches: new Map(),
  pickupCredentials: new Map(),
  pickupRecords: new Set(),
  pickupReceipts: new Map(),
  deliveries: new Map(),
  exceptions: new Map(),
  allocations: new Map(),
  drafts: new Map(),
  windows: new Map(),
  cancellations: new Map(),
  quality: new Map(),
  interests: new Map(),
  notifications: new Map(),
  preferences: new Map(),
  reconciliationBills: new Map(),
  reconciliationReviews: new Map(),
});
const clone = <T>(value: T): T => structuredClone(value);
const newest = <T extends { createdAt: string }>(values: T[]): T[] =>
  values.sort((a, b) => {
    const timestampOrder = b.createdAt.localeCompare(a.createdAt);
    if (timestampOrder) return timestampOrder;
    const aId = "id" in a && typeof a.id === "string" ? a.id : "";
    const bId = "id" in b && typeof b.id === "string" ? b.id : "";
    return bId.localeCompare(aId);
  });

/** Deterministic, transaction-serialised adapter for tests and local development. */
export class MemoryStore implements CommerceStore {
  protected data = emptyState();
  private auditDedupeKeys = new Set<string>();
  private transactionTail: Promise<void> = Promise.resolve();
  private controlledDatabaseNow: string | null = null;
  public constructor(seed = false) {
    void seed;
  }
  protected exportState(): string {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.data)) {
      output[key] =
        value instanceof Map
          ? [...value.entries()]
          : value instanceof Set
            ? [...value]
            : value;
    }
    return JSON.stringify(output);
  }
  protected importState(raw: string): void {
    const input = JSON.parse(raw) as Record<string, unknown>;
    const next = emptyState();
    for (const key of Object.keys(next) as Array<keyof MemoryState>) {
      const current = next[key];
      const value = input[key];
      if (current instanceof Map)
        (next as unknown as Record<string, unknown>)[key] = new Map(
          Array.isArray(value) ? (value as Array<[string, unknown]>) : [],
        );
      else if (current instanceof Set)
        (next as unknown as Record<string, unknown>)[key] = new Set(
          Array.isArray(value) ? value : [],
        );
      else (next as unknown as Record<string, unknown>)[key] = value ?? current;
    }
    for (const [id, rawPoint] of next.points) {
      const point = rawPoint as PickupPoint;
      const complete =
        Boolean(point.businessHours?.trim()) &&
        Boolean(point.pickupInstructions?.trim()) &&
        Number.isFinite(point.latitude) &&
        point.latitude >= -90 &&
        point.latitude <= 90 &&
        Number.isFinite(point.longitude) &&
        point.longitude >= -180 &&
        point.longitude <= 180;
      next.points.set(id, {
        ...point,
        businessHours: point.businessHours ?? "",
        pickupInstructions: point.pickupInstructions ?? "",
        latitude: Number.isFinite(point.latitude) ? point.latitude : 0,
        longitude: Number.isFinite(point.longitude) ? point.longitude : 0,
        contactName: point.contactName ?? "",
        contactPhone: point.contactPhone ?? "",
        // Earlier aggregate payloads used SUSPENDED for a disabled pickup
        // point. Persist only the approved ACTIVE | INACTIVE lifecycle.
        status:
          complete && point.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
      });
    }
    for (const [id, rawUser] of next.users) {
      const user = rawUser as User;
      next.users.set(id, {
        ...user,
        displayName: user.displayName ?? null,
        avatarUrl: user.avatarUrl ?? null,
        profileUpdatedAt: user.profileUpdatedAt ?? null,
        profileVersion: typeof user.profileVersion === "number" && Number.isInteger(user.profileVersion) && user.profileVersion >= 0
          ? user.profileVersion
          : 0,
      });
    }
    for (const [id, rawCampaign] of next.campaigns) {
      const campaign = rawCampaign as Campaign;
      next.campaigns.set(id, {
        ...campaign,
        estimatedArrivalStartAt: campaign.estimatedArrivalStartAt ?? "",
        estimatedArrivalEndAt: campaign.estimatedArrivalEndAt ?? "",
      });
    }
    for (const [id, rawCategory] of next.categories) {
      const category = rawCategory as ProductCategory;
      const legacyName = `${category.id} ${category.name}`.toLocaleLowerCase();
      const legacyIconKey = category.iconKey ? undefined : (
        /蔬菜|青菜|绿叶|vegetable/.test(legacyName) ? "leaf" :
        /水果|果品|fruit/.test(legacyName) ? "fruit" :
        /熟食|熟制|即食|ready.?food/.test(legacyName) ? "ready-food" :
        /工具|农具|五金|tool/.test(legacyName) ? "tools" :
        "basket"
      );
      const iconKey = productCategoryIconKeys.includes(category.iconKey) ? category.iconKey :
        legacyIconKey ?? "basket";
      next.categories.set(id, { ...category, iconKey });
    }
    // Add P1-C governance facts lazily so existing MySQL aggregate documents
    // remain readable during the rollout instead of producing partial records.
    for (const [id, rawCase] of next.quality) {
      const value = rawCase as CommunityQualityCase;
      next.quality.set(id, {
        ...value,
        acceptanceNote: value.acceptanceNote ?? null,
      });
    }
    for (const [id, rawInterest] of next.interests) {
      const value = rawInterest as ServiceAreaInterest;
      next.interests.set(id, {
        ...value,
        statusNote: value.statusNote ?? null,
        statusChangedBy: value.statusChangedBy ?? null,
        statusChangedAt: value.statusChangedAt ?? null,
      });
    }
    for (const [id, rawNotification] of next.notifications) {
      const value = rawNotification as OrderNotification;
      next.notifications.set(id, {
        ...value,
        manualCompletedBy: value.manualCompletedBy ?? null,
        manualCompletionNote: value.manualCompletionNote ?? null,
        manualCompletionChannel: value.manualCompletionChannel ?? null,
        manualCompletionExternalReference:
          value.manualCompletionExternalReference ?? null,
        manualCompletionResult: value.manualCompletionResult ?? null,
        providerSubmissionAttemptId: value.providerSubmissionAttemptId ?? null,
        providerSubmissionStartedAt: value.providerSubmissionStartedAt ?? null,
        providerResultRecordedAt: value.providerResultRecordedAt ?? null,
        providerReceiptId: value.providerReceiptId ?? null,
        submissionUnknownReason: value.submissionUnknownReason ?? null,
      });
    }
    this.data = next;
    this.auditDedupeKeys = new Set(next.audits.map((value) => JSON.stringify([value.requestId, value.action])));
  }
  /** Internal adapter hook: merge only the entity rows loaded by a persistent store. */
  public importEntityRows(collection: string, entries: Array<[string, unknown]>): void {
    const state = JSON.parse(this.exportState()) as Record<string, unknown>;
    const current = state[collection];
    if (Array.isArray(current) && collection === "audits") {
      const merged = new Map<string, unknown>();
      for (const value of current) {
        const audit = value as AuditLog;
        merged.set(JSON.stringify([audit.requestId, audit.action]), audit);
      }
      for (const [, value] of entries) {
        const audit = value as AuditLog;
        merged.set(JSON.stringify([audit.requestId, audit.action]), value);
      }
      state[collection] = [...merged.values()];
    } else if (collection === "pickupRecords") {
      state[collection] = [...new Set([...(Array.isArray(current) ? current : []), ...entries.map(([, value]) => value)])];
    } else if (collection === "deletedAccessRoleIds") {
      state[collection] = [...new Set([...(Array.isArray(current) ? current as string[] : []), ...entries.map(([key]) => key)])];
    } else {
      const merged = new Map<string, unknown>(Array.isArray(current) ? current as Array<[string, unknown]> : []);
      for (const [key, value] of entries) merged.set(key, value);
      state[collection] = [...merged.entries()];
    }
    this.importState(JSON.stringify(state));
  }
  /** Internal adapter hook: return a stable serialized view of one in-memory collection. */
  public exportEntityRows(collection: string): Array<[string, unknown]> {
    const state = JSON.parse(this.exportState()) as Record<string, unknown>;
    const value = state[collection];
    if (collection === "audits") {
      return (Array.isArray(value) ? value as AuditLog[] : []).map((audit) => [JSON.stringify([audit.requestId, audit.action]), audit]);
    }
    if (collection === "pickupRecords") {
      return (Array.isArray(value) ? value as string[] : []).map((record) => [record, record]);
    }
    if (collection === "deletedAccessRoleIds") {
      return (Array.isArray(value) ? value as string[] : []).map((id) => [id, id]);
    }
    return Array.isArray(value) ? value as Array<[string, unknown]> : [];
  }
  public async readSnapshot<T>(work: (store: CommerceStore) => Promise<T>): Promise<T> {
    const snapshot = new MemoryStore(false);
    snapshot.importState(this.exportState());
    snapshot.controlledDatabaseNow = this.controlledDatabaseNow;
    let active = true;
    const facade: CommerceStore = new Proxy(snapshot, {
      get(target, property) {
        if (!active) throw new Error("Readonly aggregate snapshot is closed");
        if (property === "readSnapshot") return <R>(nested: (store: CommerceStore) => Promise<R>) => nested(facade);
        if (typeof property !== "string" || (!STORE_READ_METHODS.has(property) && property !== "databaseNow" && property !== "health"))
          return () => { throw new Error(`Readonly aggregate snapshot rejects ${String(property)}`); };
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try { return await work(facade); } finally { active = false; }
  }
  public async transaction<T>(
    work: (store: CommerceStore) => Promise<T>,
  ): Promise<T> {
    const before = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    const snapshot = clone(this.data);
    try {
      const actor = getCurrentInternalWriteActor();
      if (actor) {
        const [user, staff, credential] = await Promise.all([
          this.getUser(actor.userId),
          this.getInternalStaff(actor.userId),
          this.findAdminCredentialByUserId(actor.userId),
        ]);
        const role = actor.roles.length === 1 ? actor.roles[0] : null;
        if (
          !user ||
          user.status !== "ACTIVE" ||
          !staff ||
          staff.status !== "ACTIVE" ||
          !credential ||
          credential.legacyDisabled === true ||
          credential.mustChangePassword ||
          !role ||
          role === "USER" ||
          credential.roles.length !== 1 ||
          credential.roles[0] !== role ||
          staff.role !== role ||
          actor.authorizationVersion !== staff.authorizationVersion ||
          actor.authorizationVersion !== credential.authorizationVersion
        )
          throw new BusinessError(
            "FORBIDDEN",
            "员工权限已变化，请重新登录后再试",
            403,
          );
      }
      if (actor?.accessRoleId) {
        const policy = await this.getAccessRole(actor.accessRoleId);
        const currentStaff = await this.getInternalStaff(actor.userId);
        if ((currentStaff?.accessRoleId ?? currentStaff?.role) !== actor.accessRoleId || !policy || policy.status !== "ACTIVE" || policy.version !== actor.accessRoleVersion ||
          (actor.requiredPermissions?.length && !actor.requiredPermissions.some(code => policy.permissions.includes(code))))
          throw new BusinessError("FORBIDDEN", "角色权限已变化，请重新登录后再试", 403);
      }
      return await work(this);
    } catch (error) {
      this.data = snapshot;
      this.auditDedupeKeys = new Set(snapshot.audits.map((value) => JSON.stringify([value.requestId, value.action])));
      throw error;
    } finally {
      release();
    }
  }
  public async health() {
    return "ok" as const;
  }
  public async databaseNow() {
    return this.controlledDatabaseNow ?? new Date().toISOString();
  }
  /** Test-only authority clock. Production adapters retain their own clock source. */
  public setDatabaseNowForTests(value: string | null): void {
    if (value !== null && Number.isNaN(Date.parse(value)))
      throw new Error("database test clock must be an ISO timestamp");
    this.controlledDatabaseNow = value;
  }
  public async close() {}
  public async getPersistenceMode(): Promise<"LEGACY" | "PREPARED" | "ENTITY"> { return "LEGACY"; }
  public async findUserByWechatOpenId(openId: string) {
    return clone(
      [...this.data.users.values()].find((v) => v.wechatOpenId === openId) ??
        null,
    );
  }
  public async listConsumerUsers() {
    return clone([...this.data.users.values()].filter(user => user.wechatOpenId !== null && !this.data.staff.has(user.id)));
  }
  public async getUsersByIds(ids: readonly string[]) {
    return clone([...new Set(ids)].flatMap((id) => {
      const user = this.data.users.get(id);
      return user ? [user] : [];
    }));
  }
  public async searchConsumerUsers(query: string, page: number, pageSize: number): Promise<ConsumerSearchPage> {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    const values = [...this.data.users.values()]
      .filter((user) => user.wechatOpenId !== null && !this.data.staff.has(user.id))
      .filter((user) => !needle || [String(user.consumerNumber ?? ""), user.phoneNumber ?? "", user.displayName ?? ""]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(needle)))
      .sort((left, right) => (left.consumerNumber ?? Number.MAX_SAFE_INTEGER) - (right.consumerNumber ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
    const boundedPage = Math.max(1, Math.trunc(page));
    const boundedPageSize = Math.max(1, Math.min(100, Math.trunc(pageSize)));
    return clone({ items: values.slice((boundedPage - 1) * boundedPageSize, boundedPage * boundedPageSize), total: values.length, page: boundedPage, pageSize: boundedPageSize });
  }
  public async findConsumerUserByPublicNumber(number: number) {
    const values = [...this.data.users.values()].filter((user) => user.wechatOpenId !== null && !this.data.staff.has(user.id) && user.consumerNumber === number);
    if (values.length > 1) throw new BusinessError("INTEGRITY_VIOLATION", "用户ID重复，已停止返回用户列表", 500);
    return clone(values[0] ?? null);
  }
  public async findOtherConsumerUserByPhone(phone: string, excludeUserId: string) {
    const user = [...this.data.users.values()].find((value) => value.id !== excludeUserId && value.wechatOpenId !== null && !this.data.staff.has(value.id) && value.phoneNumber === phone);
    return clone(user ?? null);
  }
  public async listConsumerUsersMissingPublicNumbers(limit: number) {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    return clone([...this.data.users.values()]
      .filter((user) => user.wechatOpenId !== null && !this.data.staff.has(user.id) && user.consumerNumber === undefined)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(0, boundedLimit));
  }
  public async hasDuplicateConsumerPublicNumbers() {
    const seen = new Set<number>();
    for (const user of this.data.users.values()) {
      if (user.wechatOpenId === null || this.data.staff.has(user.id) || user.consumerNumber === undefined) continue;
      if (seen.has(user.consumerNumber)) return true;
      seen.add(user.consumerNumber);
    }
    return false;
  }
  public async allocateConsumerPublicNumber(userId: string): Promise<number> {
    const user = this.data.users.get(userId);
    if (!user || user.wechatOpenId === null || this.data.staff.has(userId))
      throw new BusinessError(
        "INVALID_STATE_TRANSITION",
        "只有消费者账号可以分配用户编号",
        409,
      );
    if (user.consumerNumber !== undefined) {
      if (!Number.isSafeInteger(user.consumerNumber) || user.consumerNumber < 1)
        throw new BusinessError("INTEGRITY_VIOLATION", "用户ID无效", 500);
      return user.consumerNumber;
    }
    const sequenceKey = "__codex_system__:consumer-public-number-sequence-v1";
    const sequence = this.data.idempotency.get(sequenceKey);
    const storedNext = Number(sequence?.orderId);
    const maxAssigned = [...this.data.users.values()]
      .filter((value) => value.wechatOpenId !== null && !this.data.staff.has(value.id))
      .reduce((maximum, value) => Math.max(maximum, value.consumerNumber ?? 0), 0);
    const next = Number.isSafeInteger(storedNext) && storedNext > maxAssigned
      ? storedNext
      : maxAssigned + 1;
    if (!Number.isSafeInteger(next) || next < 1 || next >= Number.MAX_SAFE_INTEGER)
      throw new BusinessError("CAPACITY_EXCEEDED", "用户编号已达到可分配上限", 409);
    this.data.idempotency.set(sequenceKey, {
      fingerprint: "consumer-public-number-sequence-v1",
      orderId: String(next + 1),
    });
    return next;
  }
  public async getUser(id: string) {
    return clone(this.data.users.get(id) ?? null);
  }
  public async saveUser(v: User) {
    this.data.users.set(v.id, clone(v));
  }
  public async savePrivacyConsent(userId: string, documentVersion: string) {
    const key = `${userId}:${documentVersion}`;
    if (!this.data.privacy.has(key))
      this.data.privacy.set(key, {
        userId,
        documentVersion,
        consentedAt: new Date().toISOString(),
      });
  }
  public async getPrivacyConsent(userId: string, version: string) {
    return clone(this.data.privacy.get(`${userId}:${version}`) ?? null);
  }
  /** Pure validity lookup: expired sessions are rejected without mutating payload. */
  public async getActiveAuthSession(hash: string) {
    const value = this.data.sessions.get(hash);
    if (!value || value.expiresAt <= new Date().toISOString()) return null;
    const user = this.data.users.get(value.userId);
    const staff = this.data.staff.get(value.userId);
    return user?.status === "ACTIVE" && staff?.status !== "SUSPENDED"
      ? clone(value)
      : null;
  }
  public async getAuthSession(hash: string) {
    const v = this.data.sessions.get(hash);
    if (!v) return null;
    if (v.expiresAt <= new Date().toISOString()) {
      this.data.sessions.delete(hash);
      return null;
    }
    const user = this.data.users.get(v.userId);
    const staff = this.data.staff.get(v.userId);
    return user?.status === "ACTIVE" && staff?.status !== "SUSPENDED"
      ? clone(v)
      : null;
  }
  public async saveAuthSession(v: AuthSession) {
    this.data.sessions.set(v.tokenHash, clone(v));
  }
  public async deleteAuthSession(hash: string) {
    this.data.sessions.delete(hash);
  }
  public async deleteAuthSessionsByUser(userId: string) {
    for (const [key, v] of this.data.sessions)
      if (v.userId === userId) this.data.sessions.delete(key);
  }
  public async getPasswordChangeToken(hash: string) {
    const value = this.data.passwordChangeTokens.get(hash);
    if (!value) return null;
    if (Date.parse(value.expiresAt) <= Date.parse(await this.databaseNow())) {
      this.data.passwordChangeTokens.delete(hash);
      return null;
    }
    return clone(value);
  }
  public async listExpiredAuthenticationData(now: string, limit: number) {
    const boundedLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const sessions = [...this.data.sessions.values()]
      .filter((value) => value.expiresAt <= now)
      .slice(0, boundedLimit)
      .map((value) => value.tokenHash);
    const remaining = Math.max(0, boundedLimit - sessions.length);
    const passwordChangeTokens = [...this.data.passwordChangeTokens.values()]
      .filter((value) => value.expiresAt <= now)
      .slice(0, remaining)
      .map((value) => value.tokenHash);
    return { sessions, passwordChangeTokens };
  }
  public async deleteExpiredAuthenticationData(now: string, sessions: string[], passwordChangeTokens: string[]) {
    let deleted = 0;
    for (const hash of sessions) {
      const value = this.data.sessions.get(hash);
      if (value && value.expiresAt <= now) { this.data.sessions.delete(hash); deleted += 1; }
    }
    for (const hash of passwordChangeTokens) {
      const value = this.data.passwordChangeTokens.get(hash);
      if (value && value.expiresAt <= now) { this.data.passwordChangeTokens.delete(hash); deleted += 1; }
    }
    return deleted;
  }
  public async savePasswordChangeToken(value: PasswordChangeToken) {
    this.data.passwordChangeTokens.set(value.tokenHash, clone(value));
  }
  public async deletePasswordChangeToken(hash: string) {
    this.data.passwordChangeTokens.delete(hash);
  }
  public async findAdminCredential(username: string) {
    return clone(
      this.data.credentials.get(username.trim().toLowerCase()) ?? null,
    );
  }
  public async findAdminCredentialByUserId(id: string) {
    return clone(
      [...this.data.credentials.values()].find((v) => v.userId === id) ?? null,
    );
  }
  public async saveAdminCredential(v: AdminCredential) {
    this.data.credentials.set(v.username.trim().toLowerCase(), clone(v));
  }
  public async replaceUserRoles(
    userId: string,
    roles: Role[],
    authorizationVersion?: number,
  ) {
    this.data.roles.set(userId, clone(roles));
    const credential = await this.findAdminCredentialByUserId(userId);
    if (credential) {
      credential.roles = clone(roles);
      if (authorizationVersion !== undefined)
        credential.authorizationVersion = authorizationVersion;
      await this.saveAdminCredential(credential);
    }
  }
  public async getAccessRole(id: string): Promise<AccessRole | null> {
    if (this.data.deletedAccessRoleIds.has(id)) return null;
    return clone(this.data.accessRoles.get(id) ?? BUILTIN_ACCESS_ROLES.find(role => role.id === id) ?? null);
  }
  public async listAccessRoles(): Promise<AccessRole[]> {
    const roles = new Map(BUILTIN_ACCESS_ROLES.filter(role => !this.data.deletedAccessRoleIds.has(role.id)).map(role => [role.id, role]));
    for (const [id, role] of this.data.accessRoles) if (!this.data.deletedAccessRoleIds.has(id)) roles.set(id, role);
    return clone([...roles.values()]);
  }
  public async saveAccessRole(value: AccessRole): Promise<void> {
    if (this.data.deletedAccessRoleIds.has(value.id)) throw new BusinessError("RESOURCE_NOT_FOUND", "角色不存在", 404);
    this.data.accessRoles.set(value.id, clone(value));
  }
  public async deleteAccessRole(id: string): Promise<void> {
    this.data.accessRoles.delete(id);
    this.data.deletedAccessRoleIds.add(id);
  }
  public async getInternalStaff(id: string) {
    return clone(this.data.staff.get(id) ?? null);
  }
  public async listInternalStaff(query?: string) {
    const q = query?.trim().toLowerCase();
    return clone(
      [...this.data.staff.values()]
        .filter(
          (v) =>
            !q ||
            `${v.staffNo} ${v.displayName} ${v.phone}`
              .toLowerCase()
              .includes(q),
        )
        .sort((a, b) => a.staffNo.localeCompare(b.staffNo)),
    );
  }
  public async saveInternalStaff(v: InternalStaff) {
    this.data.staff.set(v.userId, clone(v));
  }
  public async listStaffPickupPointAssignments(id?: string) {
    return clone(
      [...this.data.staffPoints.values()].filter(
        (v) => !id || v.staffUserId === id,
      ),
    );
  }
  public async replaceStaffPickupPointAssignments(
    id: string,
    values: StaffPickupPointAssignment[],
  ) {
    for (const [key, v] of this.data.staffPoints)
      if (v.staffUserId === id) this.data.staffPoints.delete(key);
    for (const v of values)
      this.data.staffPoints.set(
        `${v.staffUserId}:${v.pickupPointId}`,
        clone(v),
      );
  }
  public async hasActivePickupPointAssignment(id: string, pointId: string) {
    const staff = this.data.staff.get(id);
    const user = this.data.users.get(id);
    return (
      !!staff &&
      staff.role === "PICKUP_MANAGER" &&
      staff.status === "ACTIVE" &&
      user?.status === "ACTIVE" &&
      this.data.staffPoints.has(`${id}:${pointId}`)
    );
  }
  public async listServiceAreas() {
    return clone([...this.data.areas.values()]);
  }
  public async saveServiceArea(v: ServiceArea) {
    this.data.areas.set(v.id, clone(v));
  }
  public async updateServiceAreaOrderEnabled(id: string, enabled: boolean) {
    const v = this.data.areas.get(id);
    if (!v) return false;
    v.orderEnabled = enabled;
    return true;
  }
  public async listPickupPoints(areaId?: string) {
    return clone(
      [...this.data.points.values()].filter(
        (v) => !areaId || v.serviceAreaId === areaId,
      ),
    );
  }
  public async savePickupPoint(v: PickupPoint) {
    this.data.points.set(v.id, clone(v));
  }
  public async deletePickupPoint(id: string) {
    const point = this.data.points.get(id);
    if (!point) return false;
    if (point.archivedAt) return true;
    this.data.points.set(id, clone({...point, status: "INACTIVE", archivedAt: new Date().toISOString()}));
    for (const [key, value] of this.data.staffPoints)
      if (value.pickupPointId === id) this.data.staffPoints.delete(key);
    return true;
  }
  public async listCatalogSkus() {
    return clone([...this.data.catalog.values()]);
  }
  public async getCatalogSku(id: string) {
    return clone(this.data.catalog.get(id) ?? null);
  }
  public async saveCatalogSku(v: CatalogSku) {
    this.data.catalog.set(v.id, clone(v));
  }
  public async listProductCategories(includeInactive = false) {
    return clone(
      [...this.data.categories.values()]
        .filter((value) => includeInactive || value.status === "ACTIVE")
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    );
  }
  public async getProductCategory(id: string) {
    return clone(this.data.categories.get(id) ?? null);
  }
  public async saveProductCategory(value: ProductCategory) {
    this.data.categories.set(value.id, clone(value));
  }
  public async deleteProductCategory(id: string) {
    if (!this.data.categories.has(id)) return false;
    if ([...this.data.catalog.values()].some((sku) => sku.categoryId === id))
      return false;
    this.data.categories.delete(id);
    return true;
  }
  public async listHomepageBanners(includeInactive = false) {
    return clone(
      [...this.data.homepageBanners.values()]
        .filter((value) => includeInactive || value.status === "ACTIVE")
        .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt)),
    );
  }
  public async getHomepageBanner(id: string) {
    return clone(this.data.homepageBanners.get(id) ?? null);
  }
  public async saveHomepageBanner(value: HomepageBanner) {
    this.data.homepageBanners.set(value.id, clone(value));
  }
  public async deleteHomepageBanner(id: string, expectedVersion: number) {
    const current = this.data.homepageBanners.get(id);
    if (!current || current.version !== expectedVersion) return false;
    this.data.homepageBanners.delete(id);
    return true;
  }
  public async listCampaigns() {
    return clone([...this.data.campaigns.values()]);
  }
  public async listCampaignGroups() {
    return clone([...this.data.campaignGroups.values()]);
  }
  public async getCampaignGroup(id: string) {
    return clone(this.data.campaignGroups.get(id) ?? null);
  }
  public async saveCampaignGroup(value: CampaignGroup) {
    this.data.campaignGroups.set(value.id, clone(value));
  }
  public async updateCampaignGroup(value: CampaignGroup, expectedVersion: number) {
    const current = this.data.campaignGroups.get(value.id);
    if (!current || current.version !== expectedVersion) return false;
    this.data.campaignGroups.set(value.id, clone(value));
    return true;
  }
  public async listCampaignsByStatus(statuses: readonly string[]) {
    return clone([...this.data.campaigns.values()].filter((campaign) => statuses.includes(campaign.status)));
  }
  public async countCampaignsByServiceAreaStatuses(serviceAreaId: string, statuses: readonly string[]): Promise<number> {
    return [...this.data.campaigns.values()].filter((campaign) => campaign.serviceAreaId === serviceAreaId && statuses.includes(campaign.status)).length;
  }
  public async countActiveCampaignReferencesForCatalogSku(catalogSkuId: string, statuses: readonly string[]): Promise<number> {
    return [...this.data.campaigns.values()].filter((campaign) => statuses.includes(campaign.status) && campaign.items.some((item) => item.catalogSkuId === catalogSkuId)).length;
  }
  public async countInProgressDeliveryForPickupPoint(pickupPointId: string, planStatuses: readonly string[], campaignStatuses: readonly string[]): Promise<number> {
    const campaigns = new Map([...this.data.campaigns.values()].map((campaign) => [campaign.id, campaign]));
    return [...this.data.plans.values()].filter((plan) => {
      if (plan.pickupPointId !== pickupPointId) return false;
      const campaign = campaigns.get(plan.campaignId);
      return planStatuses.includes(plan.status) || campaignStatuses.includes(campaign?.status ?? "");
    }).length;
  }
  public async getCampaign(id: string) {
    return clone(this.data.campaigns.get(id) ?? null);
  }
  public async getCampaignForUpdate(id: string) {
    return this.getCampaign(id);
  }
  public async saveCampaign(v: Campaign) {
    this.data.campaigns.set(v.id, clone(v));
  }
  public async updateCampaign(v: Campaign, version: number) {
    const current = this.data.campaigns.get(v.id);
    if (!current || current.version !== version) return false;
    this.data.campaigns.set(v.id, clone(v));
    return true;
  }
  public async hasCampaignBusinessReferences(id: string) {
    const plans = new Set([...this.data.plans.values()].filter(plan => plan.campaignId === id).map(plan => plan.id));
    return [this.data.orders, this.data.batches, this.data.deliveries, this.data.exceptions, this.data.drafts].some(values => [...values.values()].some(value => value.campaignId === id))
      || [...this.data.pickupReceipts.values()].some(value => plans.has(value.deliveryPlanId))
      || [...this.data.windows.values()].some(value => plans.has(value.deliveryPlanId));
  }
  public async deleteDraftCampaign(id: string, expectedVersion: number) {
    const campaign = this.data.campaigns.get(id);
    if (!campaign || campaign.status !== "DRAFT" || campaign.version !== expectedVersion) return false;
    if (await this.hasCampaignBusinessReferences(id)) return false;
    this.data.campaigns.delete(id);
    for (const [planId, plan] of this.data.plans) {
      if (plan.campaignId === id) this.data.plans.delete(planId);
    }
    return true;
  }
  public async replaceCampaignItems(id: string, items: CampaignItem[]) {
    const campaign = this.data.campaigns.get(id);
    if (campaign) {
      campaign.items = clone(items);
      this.data.campaigns.set(id, campaign);
    }
  }
  public async getCampaignItem(id: string, skuId: string) {
    return clone(
      this.data.campaigns
        .get(id)
        ?.items.find((v) => v.catalogSkuId === skuId) ?? null,
    );
  }
  public async reserveCampaignInventory(
    id: string,
    skuId: string,
    quantity: number,
  ) {
    const item = this.data.campaigns
      .get(id)
      ?.items.find((v) => v.catalogSkuId === skuId);
    if (
      !item ||
      quantity < 1 ||
      item.reservedQuantity + quantity > item.sellableQuantity
    )
      return false;
    item.reservedQuantity += quantity;
    return true;
  }
  public async releaseCampaignInventory(
    id: string,
    skuId: string,
    quantity: number,
  ) {
    const item = this.data.campaigns
      .get(id)
      ?.items.find((v) => v.catalogSkuId === skuId);
    if (!item || quantity < 0 || item.reservedQuantity < quantity) return false;
    item.reservedQuantity -= quantity;
    return true;
  }
  public async getIdempotency(actor: string, key: string) {
    return clone(this.data.idempotency.get(`${actor}:${key}`) ?? null);
  }
  public async getIdempotencyForUpdate(actor: string, key: string) {
    return this.getIdempotency(actor, key);
  }
  public async saveIdempotency(
    actor: string,
    key: string,
    v: IdempotencyRecord,
  ) {
    this.data.idempotency.set(`${actor}:${key}`, clone(v));
  }
  private hydrateOrder(id: string): Order | null {
    const base = this.data.orders.get(id);
    if (!base) return null;
    const lines = this.data.lines.get(id);
    if (!lines) return clone(base);
    return clone({
      ...base,
      items: lines.map((line) => ({
        orderLineId: line.id,
        skuId: line.catalogSkuId,
        productId: line.productId,
        name: line.skuName,
        imageUrl: line.imageUrl ?? null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        amountCents: line.amountCents,
        fulfilledQuantity: line.fulfilledQuantity,
        pickedUpQuantity: line.pickedUpQuantity,
        exceptionQuantity: line.exceptionQuantity,
        refundedQuantity: line.refundedQuantity,
        refundedAmountCents: line.refundedAmountCents,
      })),
    } as Order);
  }
  public async listOrdersByCampaign(id: string) {
    return [...this.data.orders.values()]
      .filter((v) => v.campaignId === id)
      .map((v) => this.hydrateOrder(v.id)!);
  }
  public async listOrdersByUser(id: string) {
    return newest(
      [...this.data.orders.values()]
        .filter((v) => v.userId === id)
        .map((v) => this.hydrateOrder(v.id)!),
    );
  }
  public async listOrders(limit: number) {
    return newest(
      [...this.data.orders.values()].map((v) => this.hydrateOrder(v.id)!),
    ).slice(0, limit);
  }
  public async searchOrders(query: StoreOrderSearchQuery): Promise<StoreOrderSearchPage> {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const pageSize = Math.max(1, Math.min(1000, Math.trunc(query.pageSize ?? 100)));
    const keyword = query.keyword?.trim().toLocaleLowerCase("zh-CN") ?? "";
    const users = new Map([...this.data.users.values()].map((value) => [value.id, value]));
    const qualityOrderIds = query.includeCommunityQualityCases
      ? new Set([...this.data.quality.values()].map((value) => value.orderId))
      : null;
    const values = [...this.data.orders.values()]
      .map((value) => this.hydrateOrder(value.id)!)
      .filter((order) => !query.userId || order.userId === query.userId)
      .filter((order) => !query.status || order.status === query.status)
      .filter((order) => !query.statuses || query.statuses.includes(order.status) || Boolean(qualityOrderIds?.has(order.id)))
      .filter((order) => !query.excludeStatuses?.includes(order.status))
      .filter((order) => !query.campaignId || order.campaignId === query.campaignId)
      .filter((order) => !query.pickupPointId || order.pickupPointId === query.pickupPointId)
      .filter((order) => !query.serviceAreaId || order.serviceAreaId === query.serviceAreaId)
      .filter((order) => !query.catalogSkuId || order.items.some((item) => item.skuId === query.catalogSkuId))
      .filter((order) => !query.orderNo || order.orderNo.includes(query.orderNo))
      .filter((order) => !query.beforeCreatedAt || !query.beforeId || order.createdAt < query.beforeCreatedAt || (order.createdAt === query.beforeCreatedAt && order.id < query.beforeId))
      .filter((order) => {
        if (!query.from && !query.to) return true;
        const value = query.dateType === "PAID_AT" ? order.paidAt : order.createdAt;
        if (!value) return false;
        const timestamp = Date.parse(value);
        return (!query.from || timestamp >= Date.parse(query.from)) && (!query.to || timestamp <= Date.parse(query.to));
      })
      .filter((order) => {
        if (!keyword) return true;
        const user = users.get(order.userId);
        return [order.orderNo, String(user?.consumerNumber ?? ""), user?.phoneNumber ?? "", user?.displayName ?? ""]
          .some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword));
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const offset = (page - 1) * pageSize;
    const cursorMode = Boolean(query.beforeCreatedAt && query.beforeId);
    const items = cursorMode ? values.slice(0, pageSize) : values.slice(offset, offset + pageSize);
    const hasMore = cursorMode ? values.length > pageSize : offset + pageSize < values.length;
    const last = items.at(-1);
    return { items, total: values.length, page, pageSize, hasMore, nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null };
  }
  public async countOrdersByStatus(statuses?: readonly string[], excludeStatuses?: readonly string[]): Promise<number> {
    return [...this.data.orders.values()].filter((order) =>
      (!statuses || statuses.includes(order.status)) && (!excludeStatuses || !excludeStatuses.includes(order.status)),
    ).length;
  }
  public async listPickupCodeCandidates(pickupPointId: string, codeHash: string, orderNo?: string): Promise<PickupCodeCandidate[]> {
    const now = await this.databaseNow();
    const matched: PickupCodeCandidate[] = [];
    for (const order of this.data.orders.values()) {
      if (order.pickupPointId !== pickupPointId || order.status !== "READY_FOR_PICKUP" || (orderNo && order.orderNo !== orderNo)) continue;
      const credential = this.data.pickupCredentials.get(order.id);
      const plan = this.data.plans.get(order.deliveryPlanId);
      const window = this.data.windows.get(order.id);
      if (credential?.codeHash !== codeHash || credential.status !== "ACTIVE" || credential.expiresAt <= now ||
          plan?.pickupPointId !== pickupPointId || plan.status !== "ARRIVED" ||
          !window || !["ACTIVE", "EXTENDED"].includes(window.status) || window.deadlineAt <= now) continue;
      matched.push({ order: this.hydrateOrder(order.id)!, codeHash: credential.codeHash });
    }
    return matched;
  }
  public async getNetSalesQuantities(campaignId?: string): Promise<Map<string, number>> {
    const fullyRefunded = new Set([...this.data.orderRefunds.values()].filter((refund) => refund.status === "SUCCEEDED").map((refund) => refund.orderId));
    const totals = new Map<string, number>();
    for (const raw of this.data.orders.values()) {
      if (!raw.paidAt || ["PENDING_PAYMENT", "CANCELLED"].includes(raw.status) || (campaignId && raw.campaignId !== campaignId)) continue;
      const order = this.hydrateOrder(raw.id)!;
      for (const item of order.items) {
        const quantity = raw.status === "REFUNDED" || fullyRefunded.has(raw.id) ? 0 : Math.max(0, item.quantity - item.refundedQuantity);
        if (quantity) totals.set(item.skuId, (totals.get(item.skuId) ?? 0) + quantity);
      }
    }
    return totals;
  }
  public async listExpiredPendingOrders(now: string, limit: number) {
    return (await this.listOrders(Number.MAX_SAFE_INTEGER))
      .filter((v) => v.status === "PENDING_PAYMENT" && v.expiresAt <= now)
      .slice(0, limit);
  }
  public async getOrder(id: string) {
    return this.hydrateOrder(id);
  }
  public async getOrderForUpdate(id: string) {
    return this.getOrder(id);
  }
  public async getOrderByNo(no: string) {
    const v = [...this.data.orders.values()].find((o) => o.orderNo === no);
    return v ? this.hydrateOrder(v.id) : null;
  }
  public async getOrderByNoForUpdate(no: string) {
    return this.getOrderByNo(no);
  }
  public async getCheckoutBatch(id: string) {
    return clone(this.data.checkoutBatches.get(id) ?? null);
  }
  public async getCheckoutBatchForUpdate(id: string) {
    return this.getCheckoutBatch(id);
  }
  public async getCheckoutBatchByOrder(orderId: string) {
    return clone([...this.data.checkoutBatches.values()].find((value) => value.orderIds.includes(orderId)) ?? null);
  }
  public async getCheckoutBatchByOutTradeNoForUpdate(outTradeNo: string) {
    return clone([...this.data.checkoutBatches.values()].find((value) => value.outTradeNo === outTradeNo) ?? null);
  }
  public async saveCheckoutBatch(value: CheckoutBatch) {
    this.data.checkoutBatches.set(value.id, clone(value));
  }
  public async saveOrder(v: Order) {
    this.data.orders.set(v.id, clone(v));
  }
  public async saveOrderStatus(v: Order) {
    const current = this.data.orders.get(v.id);
    if (current)
      this.data.orders.set(
        v.id,
        clone({
          ...current,
          status: v.status,
          paidAt: v.paidAt,
          pickedUpAt: v.pickedUpAt,
        }),
      );
  }
  public async transitionOrderStatus(
    id: string,
    expected: Order["status"][],
    next: Order["status"],
    paidAt?: string | null,
  ) {
    const v = this.data.orders.get(id);
    if (!v || !expected.includes(v.status)) return false;
    v.status = next;
    if (paidAt !== undefined) v.paidAt = paidAt;
    return true;
  }
  public async cancelPendingOrder(id: string) {
    return this.transitionOrderStatus(id, ["PENDING_PAYMENT"], "CANCELLED");
  }
  public async markPendingOrderPaid(id: string, paidAt: string) {
    return this.transitionOrderStatus(
      id,
      ["PENDING_PAYMENT"],
      "PAID_WAITING_CLOSE",
      paidAt,
    );
  }
  public async saveOrderLines(orderId: string, values: NewOrderLine[]) {
    this.data.lines.set(
      orderId,
      values.map(
        (v) =>
          ({
            ...v,
            orderId,
            orderNo: this.data.orders.get(orderId)?.orderNo ?? null,
            paidAt: this.data.orders.get(orderId)?.paidAt ?? null,
            fulfilledQuantity: 0,
            exceptionQuantity: 0,
            refundedQuantity: 0,
            refundedAmountCents: 0,
            pickedUpQuantity: 0,
          }) as StoredLine,
      ),
    );
  }
  private linesForOrder(id: string) {
    const order = this.data.orders.get(id);
    return (this.data.lines.get(id) ?? []).map((v) =>
      clone({
        ...v,
        orderNo: order?.orderNo ?? null,
        paidAt: order?.paidAt ?? null,
      }),
    );
  }
  public async listOrderLinesByCampaign(id: string) {
    const orders = [...this.data.orders.values()]
      .filter((v) => v.campaignId === id && !!v.paidAt)
      .sort(
        (a, b) =>
          (a.paidAt ?? "").localeCompare(b.paidAt ?? "") ||
          a.orderNo.localeCompare(b.orderNo),
      );
    return orders.flatMap((v) => this.linesForOrder(v.id));
  }
  public async listOrderLinesByCampaignForUpdate(id: string) {
    return this.listOrderLinesByCampaign(id);
  }
  public async listOrderLinesByOrderForUpdate(id: string) {
    return this.linesForOrder(id);
  }
  public async updateOrderLine(v: OrderLine) {
    const values = this.data.lines.get(v.orderId);
    const i = values?.findIndex((x) => x.id === v.id) ?? -1;
    if (!values || i < 0) return false;
    values[i] = { ...values[i]!, ...clone(v) };
    return true;
  }
  public async listOrderDeliveryFacts(ids: string[]) {
    const set = new Set(ids);
    const planIds = new Set(
      [...this.data.orders.values()]
        .filter((v) => set.has(v.id))
        .map((v) => v.deliveryPlanId),
    );
    return clone({
      partialRefunds: [...this.data.partialRefunds.values()].filter((v) =>
        set.has(v.orderId),
      ),
      qualityCases: [...this.data.quality.values()].filter((v) =>
        set.has(v.orderId),
      ),
      pickupReceipts: [...this.data.pickupReceipts.values()].filter((v) =>
        set.has(v.orderId),
      ),
      cancellations: [...this.data.cancellations.values()].filter((v) =>
        set.has(v.orderId),
      ),
      pickupWindows: [...this.data.windows.values()].filter((v) =>
        set.has(v.orderId),
      ),
      exceptions: [...this.data.exceptions.values()].filter(
        (v) =>
          v.orderId === null ||
          set.has(v.orderId) ||
          [...this.data.allocations.values()].some(
            (a) => a.exceptionId === v.id && set.has(a.orderId),
          ),
      ),
      allocations: [...this.data.allocations.values()].filter((v) =>
        set.has(v.orderId),
      ),
      deliveryPlans: [...this.data.plans.values()].filter((v) =>
        planIds.has(v.id),
      ),
    });
  }
  public async getPaymentByOrder(id: string) {
    return clone(
      [...this.data.payments.values()].find((v) => v.orderId === id) ?? null,
    );
  }
  public async getPaymentByOrderForUpdate(id: string) {
    return this.getPaymentByOrder(id);
  }
  public async getPaymentBatchByCheckoutBatch(checkoutBatchId: string) {
    return clone([...this.data.paymentBatches.values()].find((value) => value.checkoutBatchId === checkoutBatchId) ?? null);
  }
  public async getPaymentBatchForUpdate(checkoutBatchId: string) {
    return this.getPaymentBatchByCheckoutBatch(checkoutBatchId);
  }
  public async savePaymentBatch(value: PaymentBatch) {
    this.data.paymentBatches.set(value.id, clone(value));
  }
  public async savePaymentBatchIfInitiationClaimed(value: PaymentBatch, token: string) {
    const current = this.data.paymentBatches.get(value.id);
    if (!current || current.initiationClaimToken !== token) return false;
    this.data.paymentBatches.set(value.id, clone(value));
    return true;
  }
  public async savePayment(v: Payment) {
    this.data.payments.set(v.id, clone(v));
  }
  public async savePaymentIfStatus(v: Payment, expected: Payment["status"][]) {
    const current = this.data.payments.get(v.id);
    if (!current || !expected.includes(current.status)) return false;
    this.data.payments.set(v.id, clone(v));
    return true;
  }
  public async savePaymentIfInitiationClaimed(v: Payment, token: string) {
    const current = this.data.payments.get(v.id);
    if (!current || current.initiationClaimToken !== token) return false;
    this.data.payments.set(v.id, clone(v));
    return true;
  }
  public async claimPaymentCallback(eventId: string, bodyHash: string) {
    const existing = this.data.callbacks.get(eventId);
    if (existing) {
      if (existing !== bodyHash)
        throw new Error("callback event payload mismatch");
      return false;
    }
    this.data.callbacks.set(eventId, bodyHash);
    return true;
  }
  public async getOrderRefundByOrder(id: string) {
    return clone(
      [...this.data.orderRefunds.values()].find((v) => v.orderId === id) ??
        null,
    );
  }
  public async getOrderRefund(id: string) { return clone(this.data.orderRefunds.get(id) ?? null); }
  public async getOrderRefundByProviderNo(no: string) {
    return clone(
      [...this.data.orderRefunds.values()].find(
        (v) => v.providerRefundNo === no,
      ) ?? null,
    );
  }
  public async saveOrderRefund(v: OrderRefund) {
    const duplicate = [...this.data.orderRefunds.values()].find(
      (value) => value.orderId === v.orderId && value.id !== v.id,
    );
    if (duplicate)
      throw new BusinessError(
        "FINANCIAL_INCONSISTENT",
        "同一订单只能存在一笔全额退款义务",
        409,
      );
    this.data.orderRefunds.set(v.id, clone(v));
  }
  private claimRefund<T extends OrderRefund | PartialRefund>(
    map: Map<string, T>,
    id: string,
    lease: string,
    now: string,
    token: string,
  ) {
    const v = map.get(id);
    if (!v) return false;
    const active =
      !!v.submissionClaimToken &&
      !!v.submissionLeaseUntil &&
      v.submissionLeaseUntil > now;
    if (
      active ||
      ![
        "CREATED",
        "RETRYABLE_FAILURE",
        "PROCESSING",
        "SUBMISSION_UNKNOWN",
        "FAILED",
        "MANUAL_HOLD",
      ].includes(v.status)
    )
      return false;
    v.status = "PROCESSING";
    v.submissionLeaseUntil = lease;
    v.submissionClaimToken = token;
    v.recoveryVersion = (v.recoveryVersion ?? 0) + 1;
    return true;
  }
  public async claimOrderRefundSubmission(
    id: string,
    lease: string,
    now: string,
    token: string,
  ) {
    return this.claimRefund(this.data.orderRefunds, id, lease, now, token);
  }
  public async saveOrderRefundIfClaimed(v: OrderRefund, token: string) {
    const c = this.data.orderRefunds.get(v.id);
    if (!c || c.status === "SUCCEEDED" || c.submissionClaimToken !== token)
      return false;
    this.data.orderRefunds.set(
      v.id,
      clone({ ...v, recoveryVersion: (c.recoveryVersion ?? 0) + 1 }),
    );
    return true;
  }
  public async saveOrderRefundIfUnclaimed(v: OrderRefund, now: string) {
    const c = this.data.orderRefunds.get(v.id);
    if (
      !c ||
      c.status === "SUCCEEDED" ||
      (c.recoveryVersion ?? 0) !== (v.recoveryVersion ?? 0) ||
      (c.submissionClaimToken &&
        c.submissionLeaseUntil &&
        c.submissionLeaseUntil > now)
    )
      return false;
    this.data.orderRefunds.set(
      v.id,
      clone({ ...v, recoveryVersion: (c.recoveryVersion ?? 0) + 1 }),
    );
    return true;
  }
  public async saveOrderRefundIfStatus(
    v: OrderRefund,
    e: OrderRefund["status"][],
  ) {
    const c = this.data.orderRefunds.get(v.id);
    if (!c || c.status === "SUCCEEDED" || !e.includes(c.status)) return false;
    this.data.orderRefunds.set(
      v.id,
      clone({ ...v, recoveryVersion: (c.recoveryVersion ?? 0) + 1 }),
    );
    return true;
  }
  public async listOrderRefunds(limit: number): Promise<OrderRefund[]> {
    return newest([...this.data.orderRefunds.values()])
      .slice(0, limit)
      .map((v) => clone(v));
  }
  public async listPendingOrderRefunds(limit: number) {
    return (await this.listOrderRefunds(Number.MAX_SAFE_INTEGER))
      .filter((v) =>
        [
          "CREATED",
          "SUBMISSION_UNKNOWN",
          "PROCESSING",
          "RETRYABLE_FAILURE",
          "FAILED",
        ].includes(v.status),
      )
      .slice(0, limit);
  }
  public async listRefundingOrders(limit: number): Promise<Order[]> {
    return (await this.listOrders(Number.MAX_SAFE_INTEGER))
      .filter((value) => value.status === "REFUNDING")
      .slice(0, limit);
  }
  public async getPartialRefund(id: string) {
    return clone(this.data.partialRefunds.get(id) ?? null);
  }
  public async getPartialRefundByProviderNo(no: string) {
    return clone(
      [...this.data.partialRefunds.values()].find(
        (v) => v.providerRefundNo === no,
      ) ?? null,
    );
  }
  public async listPartialRefunds(limit: number): Promise<PartialRefund[]> {
    return newest([...this.data.partialRefunds.values()])
      .slice(0, limit)
      .map((v) => clone(v));
  }
  public async listPartialRefundsByOrder(id: string) {
    return clone(
      [...this.data.partialRefunds.values()].filter((v) => v.orderId === id),
    );
  }
  public async listPartialRefundsByException(id: string) {
    return clone(
      [...this.data.partialRefunds.values()].filter(
        (v) => v.exceptionId === id,
      ),
    );
  }
  public async listPendingPartialRefunds(limit: number) {
    return (await this.listPartialRefunds(Number.MAX_SAFE_INTEGER))
      .filter((v) =>
        [
          "CREATED",
          "SUBMISSION_UNKNOWN",
          "PROCESSING",
          "RETRYABLE_FAILURE",
          "FAILED",
        ].includes(v.status),
      )
      .slice(0, limit);
  }
  public async savePartialRefund(v: PartialRefund) {
    this.data.partialRefunds.set(v.id, clone(v));
  }
  public async claimPartialRefundSubmission(
    id: string,
    lease: string,
    now: string,
    token: string,
  ) {
    return this.claimRefund(this.data.partialRefunds, id, lease, now, token);
  }
  public async savePartialRefundIfClaimed(v: PartialRefund, token: string) {
    const c = this.data.partialRefunds.get(v.id);
    if (!c || c.status === "SUCCEEDED" || c.submissionClaimToken !== token)
      return false;
    this.data.partialRefunds.set(
      v.id,
      clone({ ...v, recoveryVersion: (c.recoveryVersion ?? 0) + 1 }),
    );
    return true;
  }
  public async savePartialRefundIfUnclaimed(v: PartialRefund, now: string) {
    const c = this.data.partialRefunds.get(v.id);
    if (
      !c ||
      c.status === "SUCCEEDED" ||
      (c.recoveryVersion ?? 0) !== (v.recoveryVersion ?? 0) ||
      (c.submissionClaimToken &&
        c.submissionLeaseUntil &&
        c.submissionLeaseUntil > now)
    )
      return false;
    this.data.partialRefunds.set(
      v.id,
      clone({ ...v, recoveryVersion: (c.recoveryVersion ?? 0) + 1 }),
    );
    return true;
  }
  public async savePartialRefundIfStatus(
    v: PartialRefund,
    e: PartialRefund["status"][],
  ) {
    const c = this.data.partialRefunds.get(v.id);
    if (!c || c.status === "SUCCEEDED" || !e.includes(c.status)) return false;
    this.data.partialRefunds.set(
      v.id,
      clone({ ...v, recoveryVersion: (c.recoveryVersion ?? 0) + 1 }),
    );
    return true;
  }
  public async appendLedgerTransaction(v: LedgerTransaction) {
    const duplicate = [...this.data.ledger.values()].some(
      (x) => v.postingKey
        ? x.postingKey === v.postingKey && x.referenceType === v.referenceType && x.referenceId === v.referenceId && x.eventType === v.eventType
        : x.referenceType === v.referenceType &&
          x.referenceId === v.referenceId &&
          x.eventType === v.eventType,
    );
    if (duplicate) return false;
    this.data.ledger.set(v.id, clone(v));
    return true;
  }
  public async listLedgerTransactions(id?: string) {
    return clone(
      [...this.data.ledger.values()].filter((v) => !id || v.referenceId === id),
    );
  }
  public async listFinanceRefundPage(query: FinanceRefundPageQuery): Promise<FinanceRefundPage> {
    const limit = Math.max(1, Math.min(100, Math.trunc(query.limit) || 25));
    const all = [
      ...[...this.data.orderRefunds.values()].map((v) => ({ ...clone(v), refundType: "FULL" as const, collection: "orderRefunds" })),
      ...[...this.data.partialRefunds.values()].map((v) => ({ ...clone(v), refundType: "PARTIAL" as const, collection: "partialRefunds" })),
    ].filter((v) => (!query.status || v.status === query.status) && (!query.orderId || v.orderId === query.orderId) && (!query.reference || v.orderId === query.reference || v.providerRefundNo === query.reference || this.data.orders.get(v.orderId)?.orderNo === query.reference))
      .sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt) || a.collection.localeCompare(b.collection) || b.id.localeCompare(a.id));
    const offset = query.cursor ? Number(Buffer.from(query.cursor, "base64url").toString("utf8")) : 0;
    const page = all.slice(offset, offset + limit + 1);
    const more = page.length > limit;
    return { items: page.slice(0, limit).map((value) => {
      const row = { ...value };
      Reflect.deleteProperty(row, "collection");
      return row;
    }), total: all.length, pageSize: limit, nextCursor: more ? Buffer.from(String(offset + limit)).toString("base64url") : null };
  }
  public async listFinanceLedgerPage(query: FinanceLedgerPageQuery): Promise<FinanceLedgerPage> {
    const limit = Math.max(1, Math.min(100, Math.trunc(query.limit) || 25));
    const all = [...this.data.ledger.values()].filter((v)=>!query.referenceId || v.referenceId===query.referenceId).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id));
    const offset = query.cursor ? Number(Buffer.from(query.cursor, "base64url").toString("utf8")) : 0;
    const page=all.slice(offset,offset+limit+1);
    return {items:clone(page.slice(0,limit)), total:all.length, pageSize:limit, nextCursor:page.length>limit?Buffer.from(String(offset+limit)).toString("base64url"):null};
  }
  public async saveAuditLog(v: AuditLog) {
    const key = JSON.stringify([v.requestId, v.action]);
    if (this.auditDedupeKeys.has(key)) return;
    this.auditDedupeKeys.add(key);
    this.data.audits.push(clone(v));
  }
  public async findLatestAudit(type: string, id: string, action: string) {
    return clone(
      [...this.data.audits]
        .reverse()
        .find(
          (v) =>
            v.resourceType === type &&
            v.resourceId === id &&
            v.action === action,
        ) ?? null,
    );
  }
  public async listAuditLogs(limit: number) {
    return clone(
      [...this.data.audits]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
    );
  }
  public async getDeliveryPlan(id: string) {
    return clone(this.data.plans.get(id) ?? null);
  }
  public async getDeliveryPlanByCampaign(id: string) {
    return clone(
      [...this.data.plans.values()].find((v) => v.campaignId === id) ?? null,
    );
  }
  public async listDeliveryPlans() {
    return clone([...this.data.plans.values()]);
  }
  public async listDeliveryPlansByCampaigns(campaignIds: readonly string[]) {
    const wanted = new Set(campaignIds);
    return clone([...this.data.plans.values()].filter((plan) => wanted.has(plan.campaignId)));
  }
  public async saveDeliveryPlan(v: DeliveryPlan) {
    this.data.plans.set(v.id, clone(v));
  }
  public async getDispatchBatch(id: string) {
    return clone(this.data.batches.get(id) ?? null);
  }
  public async listDispatchBatches() {
    return clone([...this.data.batches.values()]);
  }
  public async saveDispatchBatch(v: DispatchBatch) {
    this.data.batches.set(v.id, clone(v));
  }
  public async getPickupCredential(id: string) {
    return clone(this.data.pickupCredentials.get(id) ?? null);
  }
  public async savePickupCredential(v: PickupCredential) {
    this.data.pickupCredentials.set(v.orderId, clone(v));
  }
  public async savePickupRecord(
    orderId: string,
    deliveryPlanId: string,
    verifierId: string,
  ) {
    this.data.pickupRecords.add(`${orderId}:${deliveryPlanId}:${verifierId}`);
  }
  public async pickupRecordExists(id: string) {
    return [...this.data.pickupRecords].some((v) => v.startsWith(`${id}:`));
  }
  public async getCommunityPickupReceiptByRequestIdForUpdate(
    orderId: string,
    requestId: string,
  ) {
    return clone(
      [...this.data.pickupReceipts.values()].find(
        (v) => v.orderId === orderId && v.pickupRequestId === requestId,
      ) ?? null,
    );
  }
  public async listCommunityPickupReceiptsByOrder(orderId: string) {
    return clone(
      [...this.data.pickupReceipts.values()]
        .filter((value) => value.orderId === orderId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }
  public async listCommunityPickupReceipts() {
    return clone(
      [...this.data.pickupReceipts.values()].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    );
  }
  public async listPickupReceiptOrderPage(pickupPointIds: readonly string[], orderNo: string | undefined, page: number, pageSize: number): Promise<PickupReceiptOrderPage> {
    const pointIds = new Set(pickupPointIds);
    const values = [...this.data.pickupReceipts.values()]
      .flatMap((receipt) => {
        const order = this.hydrateOrder(receipt.orderId);
        return order && pointIds.has(order.pickupPointId) && (!orderNo || order.orderNo.includes(orderNo)) ? [{ receipt: clone(receipt), order }] : [];
      })
      .sort((left, right) => right.receipt.createdAt.localeCompare(left.receipt.createdAt));
    const normalizedPage = Math.max(1, Math.trunc(page));
    const normalizedPageSize = Math.max(1, Math.min(100, Math.trunc(pageSize)));
    const offset = (normalizedPage - 1) * normalizedPageSize;
    return { items: values.slice(offset, offset + normalizedPageSize), total: values.length, page: normalizedPage, pageSize: normalizedPageSize };
  }
  public async saveCommunityPickupReceipt(v: CommunityPickupReceipt) {
    const duplicate = [...this.data.pickupReceipts.values()].some(
      (x) => x.orderId === v.orderId && x.pickupRequestId === v.pickupRequestId,
    );
    if (duplicate) return false;
    this.data.pickupReceipts.set(v.id, clone(v));
    return true;
  }
  public async getCommunityDeliveryConfirmationByBatch(id: string) {
    return clone(
      [...this.data.deliveries.values()].find(
        (v) => v.dispatchBatchId === id,
      ) ?? null,
    );
  }
  public async saveCommunityDeliveryConfirmation(
    v: CommunityDeliveryConfirmation,
  ) {
    if (
      [...this.data.deliveries.values()].some(
        (x) => x.dispatchBatchId === v.dispatchBatchId,
      )
    )
      return false;
    this.data.deliveries.set(v.id, clone(v));
    return true;
  }
  public async getFulfillmentException(id: string) {
    return clone(this.data.exceptions.get(id) ?? null);
  }
  public async getFulfillmentExceptionForUpdate(id: string) {
    return this.getFulfillmentException(id);
  }
  public async getFulfillmentExceptionByOrderRequestForUpdate(
    orderId: string,
    requestId: string,
  ) {
    return clone(
      [...this.data.exceptions.values()].find(
        (v) => v.orderId === orderId && v.clientRequestId === requestId,
      ) ?? null,
    );
  }
  public async listFulfillmentExceptions(
    limit: number,
  ): Promise<FulfillmentException[]> {
    return [...this.data.exceptions.values()]
      .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))
      .slice(0, limit)
      .map((v) => clone(v));
  }
  public async saveFulfillmentException(v: FulfillmentException) {
    this.data.exceptions.set(v.id, clone(v));
  }
  public async listFulfillmentAllocations(id: string) {
    return clone(
      [...this.data.allocations.values()].filter((v) => v.exceptionId === id),
    );
  }
  public async saveFulfillmentAllocations(values: FulfillmentAllocation[]) {
    for (const v of values) this.data.allocations.set(v.id, clone(v));
  }
  public async markFulfillmentAllocationsRefunded(
    exceptionId: string,
    refund: PartialRefund,
    at: string,
  ) {
    const values = [...this.data.allocations.values()].filter(
      (v) =>
        v.exceptionId === exceptionId &&
        v.orderId === refund.orderId &&
        v.refundedQuantity < v.exceptionQuantity,
    );
    if (!values.length) return false;
    for (const v of values) {
      const delta = v.exceptionQuantity - v.refundedQuantity;
      v.refundedQuantity = v.exceptionQuantity;
      v.refundedAt = at;
      const line = this.data.lines
        .get(v.orderId)
        ?.find((x) => x.id === v.orderLineId);
      if (line) {
        line.refundedQuantity += delta;
        line.refundedAmountCents = moneyCents(
          Number(line.refundedAmountCents) +
            Number(line.unitPriceCents) * delta,
        );
      }
    }
    return true;
  }
  public async getCommunityAllocationDraftByDeliveryForUpdate(id: string) {
    return clone(
      [...this.data.drafts.values()].find(
        (v) => v.communityDeliveryId === id,
      ) ?? null,
    );
  }
  public async saveCommunityAllocationDraft(v: CommunityAllocationDraft) {
    const existing = [...this.data.drafts.values()].find(
      (x) => x.communityDeliveryId === v.communityDeliveryId,
    );
    if (existing && existing.id !== v.id) return false;
    this.data.drafts.set(v.id, clone(v));
    return true;
  }
  public async listOperationsQueue<K extends keyof OperationsQueueTypes>(kind: K, query: OperationsQueueQuery): Promise<OperationsQueuePage<OperationsQueueTypes[K]>> {
    const source = this.data[kind] as Map<string, OperationsQueueTypes[K]>;
    const sortKey = (value: OperationsQueueTypes[K]) => {
      if ("requestedAt" in value) return value.requestedAt;
      if ("registeredAt" in value) return value.registeredAt;
      if ("deadlineAt" in value) return value.deadlineAt;
      return value.createdAt;
    };
    const key = (value: OperationsQueueTypes[K]) => "id" in value ? value.id : value.orderId;
    const values = [...source.values()]
      .filter(value => kind !== "notifications" || value.status === "MANUAL_REQUIRED" || value.status === "SUBMISSION_UNKNOWN" || (value.status === "PENDING_DELIVERY" && "lastDeliveryError" in value && Boolean(value.lastDeliveryError)))
      .filter(value => (!query.allowedStatuses || query.allowedStatuses.includes(value.status)) && (!query.status || value.status === query.status))
      .filter(value => kind !== "exceptions" || !query.sourceStage || ("sourceStage" in value && value.sourceStage === query.sourceStage))
      .sort((a, b) => {
        // Overdue pickup/refund work is oldest-deadline first, before pagination.
        const urgent = kind === "windows" && ["EXPIRED_PENDING", "REFUND_PENDING"].includes(query.status ?? "");
        const order = urgent && "deadlineAt" in a && "deadlineAt" in b
          ? a.deadlineAt.localeCompare(b.deadlineAt)
          : sortKey(b).localeCompare(sortKey(a));
        return order || key(a).localeCompare(key(b));
      });
    const offset = (query.page - 1) * query.pageSize;
    return {items: clone(values.slice(offset, offset + query.pageSize)), total: values.length, page: query.page, pageSize: query.pageSize};
  }
  public async getCommunityPickupWindowForUpdate(id: string) {
    return clone(this.data.windows.get(id) ?? null);
  }
  public async getCommunityPickupWindow(id: string) {
    return clone(this.data.windows.get(id) ?? null);
  }
  public async saveCommunityPickupWindow(v: CommunityPickupWindow) {
    this.data.windows.set(v.orderId, clone(v));
  }
  public async listCommunityPickupWindowsPastDeadline(
    now: string,
    limit: number,
  ) {
    return clone(
      [...this.data.windows.values()]
        .filter(
          (v) =>
            ["ACTIVE", "EXTENDED"].includes(v.status) && v.deadlineAt < now,
        )
        .slice(0, limit),
    );
  }
  public async listCommunityPickupWindowsDueBy(
    from: string,
    to: string,
    limit: number,
  ) {
    return clone(
      [...this.data.windows.values()]
        .filter(
          (v) =>
            ["ACTIVE", "EXTENDED"].includes(v.status) &&
            v.deadlineAt >= from &&
            v.deadlineAt <= to,
        )
        .slice(0, limit),
    );
  }
  public async listCommunityPickupWindowsByStatus(
    statuses: CommunityPickupWindow["status"][],
    limit: number,
  ) {
    return clone(
      [...this.data.windows.values()]
        .filter((v) => statuses.includes(v.status))
        .slice(0, limit),
    );
  }
  public async getCommunityCancellationRequestByOrderForUpdate(id: string) {
    return clone(
      [...this.data.cancellations.values()].find((v) => v.orderId === id) ??
        null,
    );
  }
  public async listCommunityCancellationRequests(
    limit: number,
  ): Promise<CommunityCancellationRequest[]> {
    return [...this.data.cancellations.values()]
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .slice(0, limit)
      .map((v) => clone(v));
  }
  public async listPendingCommunityCancellationRequests(limit: number) {
    return (
      await this.listCommunityCancellationRequests(Number.MAX_SAFE_INTEGER)
    )
      .filter((v) => ["DIRECT_REFUNDING", "REFUNDING"].includes(v.status))
      .slice(0, limit);
  }
  public async saveCommunityCancellationRequest(
    v: CommunityCancellationRequest,
  ) {
    const existing = [...this.data.cancellations.values()].find(
      (x) => x.orderId === v.orderId,
    );
    if (existing && existing.id !== v.id) return false;
    this.data.cancellations.set(v.id, clone(v));
    return true;
  }
  public async getCommunityQualityCaseByOrderRequest(
    id: string,
    requestId: string,
  ) {
    return clone(
      [...this.data.quality.values()].find(
        (v) => v.orderId === id && v.clientRequestId === requestId,
      ) ?? null,
    );
  }
  public async getCommunityQualityCaseByOrderRequestForUpdate(
    id: string,
    requestId: string,
  ) {
    return this.getCommunityQualityCaseByOrderRequest(id, requestId);
  }
  public async getCommunityQualityCaseForUpdate(id: string) {
    return clone(this.data.quality.get(id) ?? null);
  }
  public async listCommunityQualityCases(limit: number) {
    return clone(
      [...this.data.quality.values()]
        .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))
        .slice(0, limit),
    );
  }
  public async listCommunityQualityCasesByOrder(id: string) {
    return clone(
      [...this.data.quality.values()].filter((v) => v.orderId === id),
    );
  }
  public async listCommunityQualityCasesByOrderForUpdate(id: string) {
    return this.listCommunityQualityCasesByOrder(id);
  }
  public async saveCommunityQualityCase(v: CommunityQualityCase) {
    const existing = [...this.data.quality.values()].find(
      (x) => x.orderId === v.orderId && x.clientRequestId === v.clientRequestId,
    );
    if (existing && existing.id !== v.id) return false;
    this.data.quality.set(v.id, clone(v));
    return true;
  }
  public async saveServiceAreaInterest(v: ServiceAreaInterest) {
    this.data.interests.set(v.id, clone(v));
  }
  public async getServiceAreaInterest(id: string) {
    return clone(this.data.interests.get(id) ?? null);
  }
  public async listServiceAreaInterests(limit: number) {
    return newest([...this.data.interests.values()])
      .slice(0, limit)
      .map(clone);
  }
  public async listServiceAreaInterestPage(query: ServiceAreaInterestPageQuery): Promise<ServiceAreaInterestPage> {
    const values = newest([...this.data.interests.values()])
      .filter((value) => Boolean(value.privacyVersion) && Boolean(value.privacyConsentedAt))
      .filter((value) => !query.status || value.status === query.status);
    const offset = (query.page - 1) * query.pageSize;
    return { items: values.slice(offset, offset + query.pageSize).map(clone), total: values.length, page: query.page, pageSize: query.pageSize };
  }
  public async listServiceAreaInterestsByUser(id: string) {
    return clone(
      [...this.data.interests.values()].filter((v) => v.userId === id),
    );
  }
  public async createOrderNotificationIfAbsent(v: OrderNotification) {
    if (
      [...this.data.notifications.values()].some(
        (x) => x.eventKey === v.eventKey,
      )
    )
      return false;
    this.data.notifications.set(v.id, clone(v));
    return true;
  }
  public async saveOrderNotificationIfClaimed(
    v: OrderNotification,
    token: string,
  ) {
    const c = this.data.notifications.get(v.id);
    if (!c || c.deliveryClaimToken !== token) return false;
    this.data.notifications.set(v.id, clone(v));
    return true;
  }
  public async getOrderNotification(id: string) {
    return clone(this.data.notifications.get(id) ?? null);
  }
  public async listOrderNotificationsByUser(id: string) {
    return clone(
      [...this.data.notifications.values()]
        .filter((v) => v.userId === id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }
  public async listManualOrderNotifications(limit: number) {
    return clone(
      [...this.data.notifications.values()]
        .filter(
          (v) =>
            v.status === "MANUAL_REQUIRED" ||
            v.status === "SUBMISSION_UNKNOWN" ||
            (v.status === "PENDING_DELIVERY" && Boolean(v.lastDeliveryError)),
        )
        .sort(
          (left, right) =>
            (right.manualCompletedAt ?? right.createdAt).localeCompare(
              left.manualCompletedAt ?? left.createdAt,
            ),
        )
        .slice(0, limit),
    );
  }
  public async claimPendingOrderNotifications(
    limit: number,
    leaseDurationMs: number,
    token: string,
  ) {
    const now = await this.databaseNow();
    const lease = new Date(
      Date.parse(now) + Math.max(1, Math.trunc(leaseDurationMs)),
    ).toISOString();
    const claimLimit = Math.max(0, Math.min(5, Math.trunc(limit)));
    const values: OrderNotification[] = [];
    const compareDue = (left: OrderNotification, right: OrderNotification) =>
      (left.nextAttemptAt ?? left.createdAt).localeCompare(
        right.nextAttemptAt ?? right.createdAt,
      ) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id);
    for (const value of this.data.notifications.values()) {
      if (
        value.status !== "PENDING_DELIVERY" ||
        value.providerSubmissionStartedAt !== null ||
        (value.nextAttemptAt && value.nextAttemptAt > now) ||
        (value.deliveryLeaseUntil && value.deliveryLeaseUntil > now)
      )
        continue;
      const position = values.findIndex(
        (candidate) => compareDue(value, candidate) < 0,
      );
      if (position < 0) {
        if (values.length < claimLimit) values.push(value);
      } else {
        values.splice(position, 0, value);
        if (values.length > claimLimit) values.pop();
      }
    }
    for (const v of values) {
      v.deliveryLeaseUntil = lease;
      v.deliveryClaimToken = token;
    }
    return clone(values);
  }
  public async beginOrderNotificationSubmission(input: {
    id: string;
    claimToken: string;
    attemptId: string;
  }) {
    const now = await this.databaseNow();
    const value = this.data.notifications.get(input.id);
    if (
      !value ||
      value.status !== "PENDING_DELIVERY" ||
      value.deliveryClaimToken !== input.claimToken ||
      !value.deliveryLeaseUntil ||
      value.deliveryLeaseUntil <= now ||
      value.providerSubmissionStartedAt !== null
    )
      return null;
    value.status = "SUBMISSION_UNKNOWN";
    value.providerSubmissionAttemptId = input.attemptId;
    value.providerSubmissionStartedAt = now;
    value.providerResultRecordedAt = null;
    value.providerReceiptId = null;
    value.submissionUnknownReason = null;
    value.deliveryAttempts += 1;
    value.nextAttemptAt = null;
    value.deliveryLeaseUntil = null;
    value.deliveryClaimToken = null;
    value.lastDeliveryError = null;
    return clone(value);
  }
  public async markOrderNotificationSentIfSubmission(
    id: string,
    attemptId: string,
    receiptId: string | null,
  ) {
    const deliveredAt = await this.databaseNow();
    const value = this.data.notifications.get(id);
    if (!value || value.providerSubmissionAttemptId !== attemptId) return null;
    if (value.status === "WECHAT_SENT") return clone(value);
    if (value.status !== "SUBMISSION_UNKNOWN") return null;
    value.status = "WECHAT_SENT";
    value.deliveredAt = deliveredAt;
    value.providerReceiptId = receiptId;
    value.providerResultRecordedAt = deliveredAt;
    value.submissionUnknownReason = null;
    return clone(value);
  }
  public async recordSubmissionUnknownIfSubmission(
    id: string,
    attemptId: string,
    reason: string,
  ) {
    const recordedAt = await this.databaseNow();
    const value = this.data.notifications.get(id);
    if (
      !value ||
      value.status !== "SUBMISSION_UNKNOWN" ||
      value.providerSubmissionAttemptId !== attemptId
    )
      return null;
    value.submissionUnknownReason = reason.slice(0, 500);
    value.lastDeliveryError = value.submissionUnknownReason;
    value.providerResultRecordedAt = recordedAt;
    return clone(value);
  }
  public async markOrderNotificationRead(id: string, readAt: string) {
    const v = this.data.notifications.get(id);
    if (v) v.readAt = readAt;
  }
  public async requeuePendingOrderNotification(id: string, now: string) {
    const v = this.data.notifications.get(id);
    if (!v) return null;
    if (
      v.status === "MANUAL_REQUIRED" &&
      v.providerSubmissionStartedAt === null
    ) {
      v.status = "PENDING_DELIVERY";
      v.nextAttemptAt = now;
      v.deliveryLeaseUntil = null;
      v.deliveryClaimToken = null;
    }
    return clone(v);
  }
  public async markOrderNotificationManualCompleted(
    id: string,
    actorId: string,
    note: string,
    completedAt: string,
    evidence: {
      channel:
        | "WECHAT_CUSTOMER_SERVICE"
        | "EXTERNAL_CRM"
        | "OTHER_APPROVED_CHANNEL";
      externalReference: string;
      result: "REACHED" | "USER_ACKNOWLEDGED" | "RESOLVED";
    },
  ) {
    const v = this.data.notifications.get(id);
    if (!v) return null;
    // The first completed fact is the durable record. Repeated clicks are
    // idempotent rather than overwriting who completed which compliant task.
    if (v.status === "MANUAL_COMPLETED") return clone(v);
    if (
      !["MANUAL_REQUIRED", "PENDING_DELIVERY", "SUBMISSION_UNKNOWN"].includes(
        v.status,
      )
    )
      return null;
    v.status = "MANUAL_COMPLETED";
    v.manualCompletedAt = completedAt;
    v.manualCompletedBy = actorId;
    v.manualCompletionNote = note;
    v.manualCompletionChannel = evidence.channel;
    v.manualCompletionExternalReference = evidence.externalReference;
    v.manualCompletionResult = evidence.result;
    v.deliveryLeaseUntil = null;
    v.deliveryClaimToken = null;
    v.nextAttemptAt = null;
    return clone(v);
  }
  public async saveNotificationPreference(v: NotificationPreference) {
    this.data.preferences.set(v.userId, clone(v));
  }
  public async getNotificationPreference(id: string) {
    return clone(this.data.preferences.get(id) ?? null);
  }
}
