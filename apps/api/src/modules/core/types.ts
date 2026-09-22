import type { CampaignStatus, MoneyCents, OrderStatus } from "@hometown/domain";

export interface CampaignItem {
  catalogSkuId: string;
  productId: string;
  title: string;
  category: string;
  skuName: string;
  origin: string;
  imageUrl: string | null;
  retailPriceCents: MoneyCents;
  sellableQuantity: number;
  reservedQuantity: number;
}

export interface Campaign {
  id: string;
  title: string;
  serviceAreaId: string;
  cutoffAt: string;
  dispatchAt: string;
  estimatedArrivalStartAt: string | null;
  estimatedArrivalEndAt: string | null;
  minTotalQuantity: number;
  failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
  /** Number of completed re-openings after a failed close. */
  postponementCount?: number;
  items: CampaignItem[];
  status: CampaignStatus;
  version: number;
  createdAt: string;
}

export interface OrderItem {
  orderLineId: string | null;
  skuId: string;
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: MoneyCents;
  amountCents: MoneyCents;
  fulfilledQuantity: number;
  pickedUpQuantity: number;
  exceptionQuantity: number;
  refundedQuantity: number;
  refundedAmountCents: MoneyCents;
}

export interface Order {
  id: string;
  orderNo: string;
  userId: string;
  campaignId: string;
  serviceAreaId: string;
  pickupPointId: string;
  deliveryPlanId: string;
  status: OrderStatus;
  totalCents: MoneyCents;
  items: OrderItem[];
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  pickedUpAt: string | null;
}

export interface CatalogSku {
  id: string;
  productId: string;
  categoryId?: string | null;
  name: string;
  retailPriceCents: MoneyCents;
  defaultSellableQuantity: number;
  status: "ACTIVE" | "INACTIVE";
  product: {
    id: string;
    title: string;
    category: string;
    origin: string;
    imageUrl: string | null;
    storageType: "NORMAL_TEMPERATURE";
    status: "DRAFT" | "ACTIVE" | "OFF_SHELF";
  };
  createdAt: string;
  updatedAt: string;
}

export interface ProductCategory {
  id: string;
  name: string;
  sortOrder: number;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
}
export interface HomepageBanner {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  targetType: "NONE" | "CAMPAIGN" | "CATEGORY";
  targetValue: string | null;
  scope: "ALL" | "SERVICE_AREA";
  serviceAreaId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  status: "ACTIVE" | "INACTIVE";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceArea {
  id: string;
  regionCode: string;
  name: string;
  status: "ENABLED" | "DISABLED";
  orderEnabled: boolean;
  createdAt: string;
}
export interface PickupPoint {
  id: string;
  serviceAreaId: string;
  name: string;
  address: string;
  businessHours: string;
  pickupInstructions: string;
  latitude: number;
  longitude: number;
  contactName: string;
  contactPhone: string;
  status: "ACTIVE" | "INACTIVE";
  archivedAt?: string | null;
  capacityPerDay: number | null;
  createdAt: string;
}
export interface DispatchBatch {
  id: string;
  campaignId: string;
  serviceAreaId: string;
  status: "DRAFT" | "IN_TRANSIT" | "ARRIVED" | "CLOSED";
  createdAt: string;
  dispatchedAt: string | null;
  arrivedAt: string | null;
}
export type DeliveryPlanStatus =
  | "SITE_CONFIRMED"
  | "VEHICLE_BOOKED"
  | "IN_TRANSIT"
  | "ARRIVED";
export interface DeliveryPlan {
  id: string;
  campaignId: string;
  serviceAreaId: string;
  pickupPointId: string;
  status: DeliveryPlanStatus;
  siteName: string;
  address: string;
  arrivalStartAt: string | null;
  arrivalEndAt: string | null;
  contactName: string | null;
  contactPhone: string | null;
  vehicleOrderNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  logisticsPlatform: string | null;
  estimatedArrivalAt: string | null;
  remark: string | null;
  confirmedAt: string;
  bookedAt: string | null;
  dispatchedAt: string | null;
  arrivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PickupCredential {
  orderId: string;
  codeHash: string;
  status: "ACTIVE" | "USED" | "REVOKED";
  expiresAt: string;
}

export type Role =
  | "USER"
  | "SUPER_ADMIN"
  | "OPERATOR"
  | "CUSTOMER_SERVICE"
  | "FINANCE"
  | "PICKUP_MANAGER";
export type InternalStaffRole = Exclude<Role, "USER">;
export type InternalStaffStatus =
  | "PASSWORD_SETUP_REQUIRED"
  | "ACTIVE"
  | "SUSPENDED";
export interface User {
  id: string;
  wechatOpenId: string | null;
  phoneNumber?: string;
  phoneVerifiedAt?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  profileUpdatedAt?: string | null;
  profileVersion?: number;
  status: "ACTIVE" | "BLOCKED";
  createdAt: string;
}
export interface PrivacyConsent {
  userId: string;
  documentVersion: string;
  consentedAt: string;
}
export interface AuthSession {
  tokenHash: string;
  userId: string;
  roles: Role[];
  /**
   * A session is valid only for the employee authorisation revision with
   * which it was issued.  It closes the gap between authentication at the
   * beginning of a request and a later role/scope revocation.
   */
  authorizationVersion: number;
  expiresAt: string;
}
/** Short-lived, single-use challenge issued after a valid temporary password. */
export interface PasswordChangeToken {
  tokenHash: string;
  userId: string;
  authorizationVersion: number;
  expiresAt: string;
  createdAt: string;
}
export interface InternalStaff {
  userId: string;
  staffNo: string;
  displayName: string;
  phone: string;
  role: InternalStaffRole;
  accessRoleId?: string;
  status: InternalStaffStatus;
  createdBy: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  authorizationVersion: number;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface StaffPickupPointAssignment {
  staffUserId: string;
  pickupPointId: string;
  assignedBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface AdminCredential {
  username: string;
  userId: string;
  passwordSalt: string;
  passwordHash: string;
  mustChangePassword: boolean;
  /** Set only by the one-time legacy activation migration. */
  legacyDisabled?: boolean;
  roles: Role[];
  authorizationVersion: number;
  createdAt: string;
}

export interface Payment {
  id: string;
  orderId: string;
  provider: "mock" | "wechat";
  providerPaymentId: string | null;
  status: "CREATED" | "SUCCEEDED" | "REFUNDING" | "REFUNDED" | "FAILED";
  amountCents: MoneyCents;
  clientPayload: Record<string, string> | null;
  providerContext: Record<string, unknown> | null;
  initiationLeaseUntil: string | null;
  initiationClaimToken: string | null;
  createdAt: string;
  succeededAt: string | null;
}
/**
 * `CREATED`/`FAILED` remain readable for historical snapshots. New writes use
 * the explicit recovery states so a network failure is never mistaken for a
 * provider-confirmed processing result.
 */
export type RefundStatus =
  | "CREATED"
  | "SUBMISSION_UNKNOWN"
  | "PROCESSING"
  | "RETRYABLE_FAILURE"
  | "MANUAL_HOLD"
  | "SUCCEEDED"
  | "FAILED";
export interface RefundRecoveryFields {
  /** Number of calls to the provider refund submission endpoint. */
  submissionAttempts?: number;
  /** Number of provider status queries made after an ambiguous submission. */
  queryAttempts?: number;
  /** Earliest time at which the reconciler may make the next provider call. */
  nextAttemptAt?: string | null;
  /** Observable failure evidence retained across process restarts. */
  lastError?: string | null;
  /** Set only after bounded automatic recovery requires staff intervention. */
  manualHoldReason?: string | null;
  /** Monotonic CAS revision for recovery writes and callback races. */
  recoveryVersion?: number;
  /** Total provider submit/query calls consumed by automatic recovery. */
  recoveryAttempts?: number;
}
export type OrderRefund = RefundRecoveryFields & {
  id: string;
  orderId: string;
  paymentId: string;
  providerRefundNo: string;
  providerRefundId: string | null;
  status: RefundStatus;
  amountCents: MoneyCents;
  createdAt: string;
  submissionLeaseUntil: string | null;
  submissionClaimToken: string | null;
};
export type PartialRefund = RefundRecoveryFields & {
  id: string;
  exceptionId: string;
  orderId: string;
  paymentId: string;
  providerRefundNo: string;
  providerRefundId: string | null;
  status: RefundStatus;
  amountCents: MoneyCents;
  createdAt: string;
  submissionLeaseUntil: string | null;
  submissionClaimToken: string | null;
};

export type FulfillmentExceptionType =
  | "SHORT_RECEIPT"
  | "QUALITY_REJECTED"
  | "PACKAGE_DAMAGED"
  | "TRANSIT_SHORTAGE"
  | "TRANSIT_DAMAGE"
  | "PICKUP_POINT_REJECTED"
  | "PICKUP_SHORTAGE"
  | "PICKUP_DAMAGE"
  | "QUALITY_CLAIM";
export type ExceptionResponsibility =
  | "CARRIER"
  | "PICKUP_POINT"
  | "PLATFORM"
  | "PENDING";
export type FulfillmentExceptionStatus =
  | "REGISTERED"
  | "REFUND_CONFIRMED"
  | "REFUND_PROCESSING"
  | "RESOLVED";
export interface FulfillmentExceptionItem {
  id: string;
  exceptionId: string;
  catalogSkuId: string;
  expectedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  shortQuantity: number;
  damagedQuantity: number;
  reason: FulfillmentExceptionType;
  description: string;
  evidenceUrl: null;
}
export interface FulfillmentException {
  id: string;
  campaignId: string;
  orderId: string | null;
  clientRequestId: string | null;
  deliveryPlanId: string | null;
  sourceStage: "PICKUP_ARRIVAL" | "CUSTOMER_CLAIM";
  /**
   * Accounting fact for refunds created from this exception.
   * PRE_REVENUE reverses customer contract liability; POST_REVENUE reverses
   * revenue that was already recognised by a pickup receipt.
   */
  refundAccountingStage?: "PRE_REVENUE" | "POST_REVENUE";
  status: FulfillmentExceptionStatus;
  responsibility: ExceptionResponsibility;
  registeredBy: string;
  confirmedBy: string | null;
  resolutionNote: string | null;
  registeredAt: string;
  confirmedAt: string | null;
  items: FulfillmentExceptionItem[];
}
export interface FulfillmentAllocation {
  id: string;
  exceptionId: string;
  exceptionItemId: string;
  orderLineId: string;
  orderId: string;
  catalogSkuId: string;
  fulfilledQuantity: number;
  exceptionQuantity: number;
  refundedQuantity: number;
  createdAt: string;
  refundedAt: string | null;
}
export interface OrderLine {
  id: string;
  orderId: string;
  orderNo?: string | null;
  catalogSkuId: string;
  quantity: number;
  unitPriceCents: MoneyCents;
  amountCents: MoneyCents;
  fulfilledQuantity: number;
  exceptionQuantity: number;
  refundedQuantity: number;
  refundedAmountCents: MoneyCents;
  pickedUpQuantity: number;
  paidAt: string | null;
}

export interface CommunityDeliveryItem {
  id: string;
  communityDeliveryId: string;
  catalogSkuId: string;
  expectedQuantity: number;
  receivedQuantity: number;
  rejectedQuantity: number;
  shortQuantity: number;
  damagedQuantity: number;
  reason: FulfillmentExceptionType | null;
  evidenceNote: string | null;
  evidenceUrl: null;
}
export interface CommunityDeliveryConfirmation {
  id: string;
  dispatchBatchId: string;
  campaignId: string;
  deliveryPlanId: string;
  status: "COMPLETED" | "EXCEPTION";
  confirmedBy: string;
  receivedBy: string;
  confirmationNote: string | null;
  confirmedAt: string;
  items: CommunityDeliveryItem[];
}
export interface CommunityPickupReceiptItem {
  id: string;
  communityPickupReceiptId: string;
  catalogSkuId: string;
  quantity: number;
}
export interface CommunityPickupReceipt {
  id: string;
  orderId: string;
  deliveryPlanId: string;
  verifierId: string;
  requestKey: string;
  pickupRequestId: string | null;
  payloadHash: string | null;
  createdAt: string;
  items: CommunityPickupReceiptItem[];
}
export interface CommunityAllocationDraftItem {
  id: string;
  allocationDraftId: string;
  orderLineId: string;
  orderId: string;
  orderNo: string;
  catalogSkuId: string;
  paidAt: string;
  fulfilledQuantity: number;
  exceptionQuantity: number;
}
export interface CommunityAllocationDraft {
  id: string;
  communityDeliveryId: string;
  exceptionId: string;
  campaignId: string;
  deliveryPlanId: string;
  version: number;
  sortRule: "paidAt_ASC_orderNo_ASC";
  status: "PENDING_OPERATOR_CONFIRMATION" | "CONFIRMED";
  createdBy: string;
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  items: CommunityAllocationDraftItem[];
}
export interface CommunityPickupWindow {
  orderId: string;
  deliveryPlanId: string;
  arrivedAt: string;
  deadlineAt: string;
  status:
    | "ACTIVE"
    | "EXPIRED_PENDING"
    | "EXTENDED"
    | "REFUND_PENDING"
    | "LOSS_RECORDED"
    | "CLOSED";
  extensionCount: number;
  extendedBy: string | null;
  extendedAt: string | null;
  dispositionBy: string | null;
  dispositionAt: string | null;
  dispositionNote: string | null;
  refundExceptionId: string | null;
  lossExceptionId: string | null;
}
export interface CommunityCancellationRequest {
  id: string;
  orderId: string;
  userId: string;
  reason: string;
  status:
    | "DIRECT_REFUNDING"
    | "PENDING_REVIEW"
    | "REJECTED"
    | "APPROVED_WAITING_FINANCE"
    | "REFUNDING"
    | "REFUNDED";
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  financeExecutedBy: string | null;
  financeExecutedAt: string | null;
  refundId: string | null;
}
export type CommunityQualityCaseStatus =
  | "REGISTERED"
  | "ACCEPTED"
  | "REJECTED"
  | "REFUNDING"
  | "RESOLVED";
export type CommunityQualityReason =
  | "PICKUP_SHORTAGE"
  | "PICKUP_DAMAGE"
  | "QUALITY_CLAIM";
export interface CommunityQualityCaseItem {
  id: string;
  communityQualityCaseId: string;
  pickupReceiptId: string;
  orderLineId: string;
  catalogSkuId: string;
  pickedUpQuantitySnapshot: number;
  disputedQuantity: number;
  reason: CommunityQualityReason;
  description: string;
}
export interface CommunityQualityCase {
  id: string;
  orderId: string;
  userId: string;
  clientRequestId: string;
  payloadHash: string;
  status: CommunityQualityCaseStatus;
  registeredAt: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  /** Customer-service acceptance rationale; it is distinct from the operator decision. */
  acceptanceNote: string | null;
  decisionBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  refundApprovedBy: string | null;
  refundApprovedAt: string | null;
  financeExecutedBy: string | null;
  financeExecutedAt: string | null;
  refundExceptionId: string | null;
  items: CommunityQualityCaseItem[];
}

export interface LedgerLine {
  accountCode: string;
  ownerId: string | null;
  direction: "DEBIT" | "CREDIT";
  amountCents: MoneyCents;
}
export interface LedgerTransaction {
  id: string;
  referenceType: "ORDER" | "FULFILLMENT_EXCEPTION";
  referenceId: string;
  eventType:
    | "PAYMENT_SUCCEEDED"
    | "REFUND_SUCCEEDED"
    | "PARTIAL_REFUND_SUCCEEDED"
    | "PICKUP_CONFIRMED";
  lines: LedgerLine[];
  createdAt: string;
}
export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string;
  beforeData: unknown;
  afterData: unknown;
  createdAt: string;
}
export interface ServiceAreaInterest {
  id: string;
  userId: string;
  regionText: string;
  contactName: string;
  contactPhone: string;
  privacyVersion: string | null;
  privacyConsentedAt: string | null;
  status: "NEW" | "CONTACTED" | "CLOSED";
  /** Required for each operational transition; never returned with raw contact data. */
  statusNote: string | null;
  statusChangedBy: string | null;
  statusChangedAt: string | null;
  createdAt: string;
}
export type OrderNotificationType =
  | "SITE_CONFIRMED"
  | "VEHICLE_DISPATCHED"
  | "ARRIVED"
  | "PARTIAL_REFUND"
  | "PICKUP_DEADLINE"
  | "PICKUP_EXPIRED"
  | "CAMPAIGN_POSTPONED";
export type OrderNotificationStatus =
  | "PENDING_DELIVERY"
  /** A provider submission may have happened; never resend without a provider idempotency/query contract. */
  | "SUBMISSION_UNKNOWN"
  | "WECHAT_SENT"
  | "IN_APP_AVAILABLE"
  | "MANUAL_REQUIRED"
  | "MANUAL_COMPLETED";
export interface OrderNotification {
  /** Exact successful refund that caused this event; absent historical rows fail closed. */
  refundId?: string | null;
  /** Site fact captured when this event was enqueued, not guessed at send time. */
  siteConfirmed?: boolean;
  id: string;
  eventKey: string;
  userId: string;
  orderId: string;
  type: OrderNotificationType;
  title: string;
  content: string;
  status: OrderNotificationStatus;
  readAt: string | null;
  manualCompletedAt: string | null;
  /** The managed staff member who recorded a compliant out-of-system completion. */
  manualCompletedBy: string | null;
  /** Required operator record; it must never replace the original completion fact. */
  manualCompletionNote: string | null;
  manualCompletionChannel?:
    | "WECHAT_CUSTOMER_SERVICE"
    | "EXTERNAL_CRM"
    | "OTHER_APPROVED_CHANNEL"
    | null;
  manualCompletionExternalReference?: string | null;
  manualCompletionResult?:
    | "REACHED"
    | "USER_ACKNOWLEDGED"
    | "RESOLVED"
    | null;
  createdAt: string;
  deliveryAttempts: number;
  nextAttemptAt: string | null;
  deliveryLeaseUntil: string | null;
  deliveryClaimToken: string | null;
  /** Durable at-most-once fence created before any provider call. */
  providerSubmissionAttemptId: string | null;
  providerSubmissionStartedAt: string | null;
  providerResultRecordedAt: string | null;
  providerReceiptId: string | null;
  submissionUnknownReason: string | null;
  lastDeliveryError: string | null;
  deliveredAt: string | null;
}
export interface NotificationPreference {
  /** Accepted account template IDs; legacy four-template preferences are not transferable. */
  templateIds?: Partial<Record<OrderNotificationType, string>>;
  userId: string;
  types: OrderNotificationType[];
  updatedAt: string;
}
