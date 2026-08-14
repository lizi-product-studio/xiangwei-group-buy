import type { CampaignStatus, MoneyCents, OrderStatus } from '@hometown/domain';

/**
 * Legacy marketplace rows are immutable compatibility data. Platform procurement
 * is the only model allowed for new mode-B campaigns and orders.
 */
export type BusinessModelVersion = 'LEGACY_MARKETPLACE' | 'PLATFORM_PROCUREMENT' | 'PLATFORM_COMMUNITY';
export type PaymentRoute = 'LEGACY_COMBINE' | 'PLATFORM_DIRECT';

export interface Campaign {
  id: string;
  title: string;
  serviceAreaId: string;
  cutoffAt: string;
  dispatchAt: string;
  minTotalQuantity: number;
  failureAction: 'CANCEL_AND_REFUND' | 'POSTPONE';
  businessModelVersion: BusinessModelVersion;
  warehouseId: string | null;
  skuIds: string[];
  items: CampaignItemSnapshot[];
  platformItems: PlatformCampaignItem[];
  /** Lightweight community-group-buy snapshots never carry supplier or warehouse semantics. */
  communityItems?: CommunityCampaignItem[];
  status: CampaignStatus;
  version: number;
  createdAt: string;
}

/** Immutable catalogue data captured when a campaign is created or its draft is edited. */
export interface CampaignItemSnapshot {
  skuId: string;
  productId: string;
  merchantId: string;
  title: string;
  category: string;
  skuName: string;
  origin: string;
  imageUrl: string | null;
  unitPriceCents: MoneyCents;
  stock: number;
  soldQuantity: number;
  commissionRateBps: number;
}

/** Immutable platform price / purchase price snapshot for a mode-B campaign. */
export interface PlatformCampaignItem {
  platformSkuId: string;
  supplierOfferId: string;
  productId: string;
  title: string;
  category: string;
  skuName: string;
  origin: string;
  imageUrl: string | null;
  retailPriceCents: MoneyCents;
  purchasePriceCents: MoneyCents;
  sellableQuantity: number;
  reservedQuantity: number;
}

/** Immutable platform catalogue/price snapshot for the lightweight community flow. */
export interface CommunityCampaignItem {
  platformSkuId: string;
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

export interface Sku {
  id: string;
  productId: string;
  merchantId: string;
  name: string;
  unitPriceCents: MoneyCents;
  stock: number;
  soldQuantity: number;
  commissionRateBps: number;
}

export interface MerchantOrder {
  id: string;
  merchantId: string;
  itemAmountCents: MoneyCents;
  commissionCents: MoneyCents;
  merchantReceivableCents: MoneyCents;
}

export interface OrderItem {
  /** Direct platform sales-line ID; null on immutable legacy order_items. */
  salesOrderItemId: string | null;
  skuId: string;
  productId: string;
  /** Present only for legacy compatibility DTOs. */
  merchantId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: MoneyCents;
  amountCents: MoneyCents;
  /** Legacy-only values. Mode B always persists zero / null equivalents. */
  commissionRateBps: number;
  commissionCents: MoneyCents;
  purchaseUnitCents?: MoneyCents;
  fulfilledQuantity:number;
  exceptionQuantity:number;
  refundedQuantity:number;
  refundedAmountCents:MoneyCents;
  /** Only used by PLATFORM_COMMUNITY; existing rows intentionally remain zero. */
  pickedUpQuantity:number;
}

export interface Order {
  id: string;
  orderNo: string;
  userId: string;
  campaignId: string;
  serviceAreaId: string;
  pickupPointId: string;
  deliveryPlanId: string;
  businessModelVersion: BusinessModelVersion;
  paymentRoute: PaymentRoute;
  status: OrderStatus;
  totalCents: MoneyCents;
  commissionCents: MoneyCents;
  items: OrderItem[];
  merchantOrders: MerchantOrder[];
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  pickedUpAt:string|null;
}

export interface Merchant { id:string; name:string; status:'PENDING'|'ACTIVE'|'SUSPENDED'|'REJECTED'; defaultCommissionBps:number; wechatSubMchid:string|null; createdAt:string }
export interface Product { id:string; merchantId:string; title:string; category:string; origin:string; imageUrl:string|null; storageType:'NORMAL_TEMPERATURE'; status:'DRAFT'|'PENDING_REVIEW'|'APPROVED'|'REJECTED'|'OFF_SHELF'; sku:Sku; createdAt:string }
export interface ServiceArea { id:string; regionCode:string; name:string; status:'ENABLED'|'DISABLED'; orderEnabled:boolean; createdAt:string }
export interface PickupPoint { id:string; serviceAreaId:string; name:string; address:string; status:'PENDING'|'ACTIVE'|'SUSPENDED'|'REJECTED'; capacityPerDay:number|null; operationMode:'SELF_OPERATED'|'PARTNER_OPERATED'|'TEMPORARY_SELF_OPERATED'|'LEASED_SITE'; responsibilityOwner:string|null; siteLeadName:string|null; siteLeadPhone:string|null; createdAt:string }
export interface DispatchBatch { id:string; campaignId:string; serviceAreaId:string; status:'DRAFT'|'IN_TRANSIT'|'ARRIVED'|'CLOSED'; createdAt:string; dispatchedAt:string|null; arrivedAt:string|null }
export type DeliveryPlanStatus = 'PENDING_SITE'|'SITE_CONFIRMED'|'VEHICLE_BOOKED'|'IN_TRANSIT'|'ARRIVED';
export interface DeliveryPlan {
  id:string; campaignId:string; serviceAreaId:string; pickupPointId:string|null; status:DeliveryPlanStatus;
  siteName:string|null; address:string|null; arrivalStartAt:string|null; arrivalEndAt:string|null;
  contactName:string|null; contactPhone:string|null; vehicleOrderNo:string|null; driverName:string|null; driverPhone:string|null; vehiclePlate:string|null;
  logisticsPlatform?:string|null; estimatedArrivalAt?:string|null;
  remark:string|null; confirmedAt:string|null; bookedAt:string|null; dispatchedAt:string|null; arrivedAt:string|null; createdAt:string; updatedAt:string;
}
export interface PickupCredential { orderId:string; codeHash:string; status:'ACTIVE'|'USED'; expiresAt:string }

export type Role = 'USER' | 'OPERATOR' | 'REVIEWER' | 'FULFILLMENT' | 'PICKUP_MANAGER' | 'PICKUP_VERIFIER' | 'CUSTOMER_SERVICE' | 'FINANCE' | 'PROCUREMENT' | 'WAREHOUSE_RECEIVER' | 'QUALITY_INSPECTOR' | 'WAREHOUSE_OPERATOR' | 'SUPER_ADMIN';
export interface User { id:string; wechatOpenId:string|null; status:'ACTIVE'|'BLOCKED'; createdAt:string }
/** Immutable evidence of a user's explicit acceptance of one privacy notice version. */
export interface PrivacyConsent { userId:string; documentVersion:string; consentedAt:string }
export interface AuthSession { tokenHash:string; userId:string; roles:Role[]; expiresAt:string }
export interface AdminCredential { username:string; userId:string; passwordSalt:string; passwordHash:string; roles:Role[]; createdAt:string }
/**
 * Append-only grant/revoke event. A verifier can use a pickup point only when
 * its most recent event for that point is GRANTED.
 */
export interface PickupVerifierAssignment { id:string; userId:string; pickupPointId:string; action:'GRANTED'|'REVOKED'; createdAt:string }
export interface Payment {
  id:string; orderId:string; provider:'mock'|'wechat-platform'; paymentRoute:PaymentRoute; providerPaymentId:string|null;
  status:'CREATED'|'SUCCEEDED'|'REFUNDING'|'REFUNDED'|'FAILED'; amountCents:MoneyCents;
  clientPayload:Record<string,string>|null; providerContext:Record<string,unknown>|null;
  /** Durable fence for a provider-side payment-initiation request. */
  initiationLeaseUntil:string|null; initiationClaimToken:string|null;
  createdAt:string; succeededAt:string|null;
}
export interface Refund {
  id:string; orderId:string; paymentId:string; merchantOrderId:string; providerRefundNo:string;
  providerRefundId:string|null; status:'CREATED'|'PROCESSING'|'SUCCEEDED'|'FAILED'; amountCents:MoneyCents;
  createdAt:string; submissionLeaseUntil:string|null; submissionClaimToken:string|null;
}
export interface PlatformRefund {
  id:string; orderId:string; paymentId:string; providerRefundNo:string; providerRefundId:string|null;
  status:'CREATED'|'PROCESSING'|'SUCCEEDED'|'FAILED'; amountCents:MoneyCents; createdAt:string;
  submissionLeaseUntil:string|null; submissionClaimToken:string|null;
}
/** A mode-B refund for an approved fulfilment discrepancy. It is deliberately
 * separate from the single full-order platform_refunds compatibility record. */
export interface PlatformPartialRefund {
  id:string; exceptionId:string; orderId:string; paymentId:string; providerRefundNo:string; providerRefundId:string|null;
  status:'CREATED'|'PROCESSING'|'SUCCEEDED'|'FAILED'; amountCents:MoneyCents; createdAt:string;
  submissionLeaseUntil:string|null; submissionClaimToken:string|null;
}
export interface Warehouse { id:string; name:string; address:string; status:'ACTIVE'|'SUSPENDED'; createdAt:string; updatedAt:string }
export interface Supplier { id:string; legacyMerchantId:string|null; name:string; status:'DRAFT'|'ACTIVE'|'SUSPENDED'; contactName:string|null; contactPhone:string|null; createdAt:string; updatedAt:string }
export interface SupplierQualification { id:string; supplierId:string; qualificationType:string; qualificationNo:string|null; expiresAt:string|null; status:'PENDING'|'APPROVED'|'REJECTED'|'EXPIRED'; evidenceSummary:string|null; createdAt:string; updatedAt:string }
export interface PlatformSku { id:string; productId:string; name:string; retailPriceCents:MoneyCents; defaultSellableQuantity?:number; referencePurchaseCostCents?:MoneyCents|null; supplierNote?:string|null; status:'ACTIVE'|'INACTIVE'; product:{id:string;title:string;category:string;origin:string;imageUrl:string|null;storageType:'NORMAL_TEMPERATURE';status:'DRAFT'|'ACTIVE'|'OFF_SHELF'}; createdAt:string; updatedAt:string }
export interface SupplierSkuOffer { id:string; supplierId:string; platformSkuId:string; purchasePriceCents:MoneyCents|null; minimumPurchaseQuantity:number; leadTimeDays:number; status:'DRAFT'|'ACTIVE'|'SUSPENDED'; createdAt:string; updatedAt:string }
export interface PurchaseOrderItem { id:string; purchaseOrderId:string; platformSkuId:string; supplierOfferId:string; plannedQuantity:number; purchaseUnitCents:MoneyCents; createdAt:string }
/** A supplemental PO retains the original short-receipt evidence instead of
 * overwriting it. The nullable parent link is additive and legacy-safe. */
export interface PurchaseOrder { id:string; purchaseNo:string; campaignId:string; supplierId:string; warehouseId:string; status:'DRAFT'|'ORDERED'|'RECEIVING'|'RECEIVED'|'CANCELLED'; plannedArrivalAt:string|null; items:PurchaseOrderItem[]; createdAt:string; updatedAt:string }
export interface GoodsReceiptItem { id:string; goodsReceiptId:string; purchaseOrderItemId:string; acceptedQuantity:number; rejectedQuantity:number; batchNo:string|null; productionDate:string|null; expiresAt:string|null; qualityResult:'ACCEPTED'|'PARTIALLY_ACCEPTED'|'REJECTED'; inspectionNote:string|null; exceptionReason?:FulfillmentExceptionType|null|undefined; evidenceUrl?:string|null|undefined }
export interface GoodsReceipt { id:string; receiptNo:string; purchaseOrderId:string; warehouseId:string; status:'DRAFT'|'COMPLETED'|'EXCEPTION'; receivedBy:string; inspectedBy:string; receivedAt:string; items:GoodsReceiptItem[]; createdAt:string }
export type InventoryBucket='QUALIFIED'|'RESERVED'|'SORTED'|'OUTBOUND'|'HANDED_OVER'|'REJECTED'|'QUARANTINE';
export interface InventoryLot { id:string; warehouseId:string; platformSkuId:string; supplierId:string; goodsReceiptItemId:string; lotNo:string; productionDate:string|null; expiresAt:string|null; qualifiedQuantity:number; createdAt:string }
export interface InventoryMovement { id:string; inventoryLotId:string; movementType:'RECEIPT'|'SORT_RESERVED'|'SORT_COMPLETED'|'OUTBOUND'|'HANDOVER'|'ADJUSTMENT'|'LOSS'|'QUARANTINE'; fromBucket:InventoryBucket|null; toBucket:InventoryBucket|null; quantity:number; referenceType:string; referenceId:string; actorId:string; note:string|null; createdAt:string }
export interface InventoryBalance { inventoryLotId:string; platformSkuId:string; warehouseId:string; lotNo:string; expiresAt:string|null; qualified:number; reserved:number; sorted:number; outbound:number; handedOver:number; rejected:number; quarantine:number }
export interface SupplierPayable { id:string; supplierId:string; purchaseOrderItemId:string; goodsReceiptItemId:string; qualifiedQuantity:number; purchaseUnitCents:MoneyCents; amountCents:MoneyCents; status:'PENDING'|'PAID'|'VOID'; paymentReference:string|null; paidAt:string|null; createdAt:string; updatedAt:string }
export interface SortingTaskItem { id:string; sortingTaskId:string; inventoryLotId:string; platformSkuId:string; quantity:number; createdAt:string }
export interface SortingTask { id:string; campaignId:string; warehouseId:string; status:'PENDING'|'COMPLETED'|'CANCELLED'; createdBy:string; completedBy:string|null; items:SortingTaskItem[]; createdAt:string; completedAt:string|null }
export interface OutboundOrderItem { id:string; outboundOrderId:string; inventoryLotId:string; platformSkuId:string; quantity:number }
export interface OutboundOrder { id:string; outboundNo:string; campaignId:string; warehouseId:string; deliveryPlanId:string; sortingTaskId:string; status:'CREATED'|'DISPATCHED'|'HANDED_OVER'|'EXCEPTION'|'CANCELLED'; carrierReference:string|null; dispatchedBy:string|null; dispatchedAt:string|null; items:OutboundOrderItem[]; createdAt:string }
export interface PickupHandoverItem { id:string; pickupHandoverId:string; platformSkuId:string; expectedQuantity:number; receivedQuantity:number; rejectedQuantity:number; shortQuantity:number; damagedQuantity:number; reason:FulfillmentExceptionType|null; evidenceNote:string|null }
export interface PickupHandover { id:string; outboundOrderId:string; deliveryPlanId:string; status:'PENDING'|'COMPLETED'|'EXCEPTION'; handedOverBy:string; receivedBy:string|null; exceptionNote:string|null; handedOverAt:string|null; items:PickupHandoverItem[]; createdAt:string }
export type FulfillmentExceptionType='SHORT_RECEIPT'|'QUALITY_REJECTED'|'PACKAGE_DAMAGED'|'WAREHOUSE_SHORTAGE'|'WAREHOUSE_DAMAGE'|'MIS_SORTED'|'TRANSIT_SHORTAGE'|'TRANSIT_DAMAGE'|'WRONG_POINT'|'PICKUP_POINT_REJECTED'|'PICKUP_SHORTAGE'|'PICKUP_DAMAGE'|'QUALITY_CLAIM';
export type ExceptionResponsibility='SUPPLIER'|'WAREHOUSE'|'CARRIER'|'PICKUP_POINT'|'PLATFORM'|'PENDING';
export type FulfillmentExceptionStatus='REGISTERED'|'WAITING_REPLENISHMENT'|'TRANSFER_PENDING'|'REFUND_CONFIRMED'|'REFUND_PROCESSING'|'RESOLVED';
export interface FulfillmentExceptionItem { id:string; exceptionId:string; platformSkuId:string; expectedQuantity:number; acceptedQuantity:number; rejectedQuantity:number; shortQuantity:number; damagedQuantity:number; reason:FulfillmentExceptionType; description:string; evidenceUrl:string|null }
export interface FulfillmentException { id:string; campaignId:string; orderId:string|null; clientRequestId:string|null; outboundOrderId:string|null; deliveryPlanId:string|null; sourceStage:'SUPPLIER_RECEIPT'|'WAREHOUSE'|'TRANSIT'|'PICKUP_HANDOVER'|'CUSTOMER_CLAIM'; status:FulfillmentExceptionStatus; responsibility:ExceptionResponsibility; registeredBy:string; confirmedBy:string|null; resolutionNote:string|null; registeredAt:string; confirmedAt:string|null; items:FulfillmentExceptionItem[] }
/** Deterministic paid-time allocation of a shortage to one platform sales line. */
export interface FulfillmentAllocation { id:string; exceptionId:string; exceptionItemId:string; salesOrderItemId:string; orderId:string; platformSkuId:string; fulfilledQuantity:number; exceptionQuantity:number; refundedQuantity:number; createdAt:string; refundedAt:string|null }
export interface PlatformSalesLine { id:string; orderId:string; platformSkuId:string; quantity:number; unitPriceCents:MoneyCents; purchaseUnitCents:MoneyCents; amountCents:MoneyCents; fulfilledQuantity:number; exceptionQuantity:number; refundedQuantity:number; refundedAmountCents:MoneyCents; pickedUpQuantity:number; paidAt:string|null }
export interface CommunityDeliveryItem { id:string; communityDeliveryId:string; platformSkuId:string; expectedQuantity:number; receivedQuantity:number; rejectedQuantity:number; shortQuantity:number; damagedQuantity:number; reason:FulfillmentExceptionType|null; evidenceNote:string|null; evidenceUrl:string|null }
export interface CommunityDeliveryConfirmation { id:string; dispatchBatchId:string; campaignId:string; deliveryPlanId:string; status:'COMPLETED'|'EXCEPTION'; confirmedBy:string; receivedBy:string; confirmationNote:string|null; confirmedAt:string; items:CommunityDeliveryItem[] }
export interface CommunityPickupReceiptItem { id:string; communityPickupReceiptId:string; platformSkuId:string; quantity:number }
export interface CommunityPickupReceipt { id:string; orderId:string; deliveryPlanId:string; verifierId:string; requestKey:string; createdAt:string; items:CommunityPickupReceiptItem[] }
export interface LedgerLine {accountCode:string;ownerId:string|null;direction:'DEBIT'|'CREDIT';amountCents:MoneyCents}
/**
 * Immutable accounting evidence. Marketplace events remain isolated from the
 * platform-procurement events so an old commission entry cannot be mistaken
 * for supplier cost or a supplier payable.
 */
export interface LedgerTransaction {
  id:string;
  referenceType:'ORDER'|'SUPPLIER_PAYABLE'|'FULFILLMENT_EXCEPTION';
  referenceId:string;
  eventType:'PAYMENT_SUCCEEDED'|'REFUND_SUCCEEDED'|'PARTIAL_REFUND_SUCCEEDED'|'PICKUP_CONFIRMED'|'SUPPLIER_PAYABLE_RECOGNIZED'|'SUPPLIER_PAYABLE_PAID';
  lines:LedgerLine[];
  createdAt:string;
}
export interface Settlement {id:string;orderId:string;paymentId:string;merchantOrderId:string;outOrderNo:string;providerOrderId:string|null;status:'CREATED'|'PROCESSING'|'SUCCEEDED'|'FAILED';commissionCents:MoneyCents;merchantReceivableCents:MoneyCents;createdAt:string}
export interface AuditLog {id:string;actorId:string;action:string;resourceType:string;resourceId:string;requestId:string;beforeData:unknown;afterData:unknown;createdAt:string}
export interface ServiceAreaInterest {
  id:string; userId:string; regionText:string; contactName:string; contactPhone:string;
  /** The notice accepted when this contact detail was submitted; null for historic records. */
  privacyVersion:string|null; privacyConsentedAt:string|null;
  status:'NEW'|'CONTACTED'|'CLOSED'; createdAt:string;
}
export interface AfterSale {
  id:string; userId:string; orderId:string; reason:string; description:string;
  status:'SUBMITTED'|'PROCESSING'|'RESOLVED'|'REJECTED';
  resolutionType:'FULL_REFUND'|'REJECTED'|null; refundAmountCents:MoneyCents|null; refundIds:string[];
  resolvedBy:string|null; resolutionNote:string|null; resolvedAt:string|null;
  createdAt:string; updatedAt:string;
}
export type OrderNotificationType = 'SITE_CONFIRMED' | 'VEHICLE_DISPATCHED' | 'ARRIVED' | 'PARTIAL_REFUND';
export type OrderNotificationStatus = 'PENDING_DELIVERY' | 'WECHAT_SENT' | 'IN_APP_AVAILABLE' | 'MANUAL_REQUIRED' | 'MANUAL_COMPLETED';
export interface OrderNotification {
  id:string; eventKey:string; userId:string; orderId:string; type:OrderNotificationType; title:string; content:string;
  status:OrderNotificationStatus; readAt:string|null; manualCompletedAt:string|null; createdAt:string;
  deliveryAttempts:number; nextAttemptAt:string|null; deliveryLeaseUntil:string|null; deliveryClaimToken:string|null; lastDeliveryError:string|null; deliveredAt:string|null;
}
export interface NotificationPreference { userId:string; types:OrderNotificationType[]; updatedAt:string }
