interface IAppOption {
  globalData: {
    apiBaseUrl: string;
    authMode: "demo" | "wechat";
    demoLoginEnabled: boolean;
    accessToken: string | null;
    subscriptionTemplates: Array<{
      type:
        | "SITE_CONFIRMED"
        | "VEHICLE_DISPATCHED"
        | "ARRIVED"
        | "PARTIAL_REFUND"
        | "PICKUP_DEADLINE"
        | "PICKUP_EXPIRED"
        | "CAMPAIGN_POSTPONED";
      templateId: string;
    }>;
  };
}

interface CampaignDto {
  id: string;
  title: string;
  serviceAreaId: string;
  deliveryPlan: DeliveryPlanDto | null;
  pickupPoint?: PickupPointDto | null;
  cutoffAt: string;
  dispatchAt: string;
  /** 运营发布前配置，归属于团期而不是自提点。 */
  estimatedArrivalStartAt?: string | null;
  estimatedArrivalEndAt?: string | null;
  /** 全团已支付订单中的商品件数，由服务端实时汇总。 */
  paidQuantity?: number;
  failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
  minTotalQuantity: number;
  items: Array<{
    skuId: string;
    title: string;
    category: string;
    skuName: string;
    origin: string;
    imageUrl: string | null;
    unitPriceCents: number;
    stock: number;
    soldQuantity: number;
    paidQuantity?: number;
  }>;
  status:
    | "DRAFT"
    | "SCHEDULED"
    | "OPEN"
    | "CLOSING"
    | "LOCKED"
    | "FULFILLING"
    | "COMPLETED"
    | "POSTPONED"
    | "CANCELLED";
}

interface OrderDto {
  id: string;
  orderNo: string;
  campaignId: string;
  serviceAreaId: string;
  pickupPointId: string;
  deliveryPlanId: string;
  deliveryPlan: DeliveryPlanDto | null;
  status: string;
  totalCents: number;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  pickedUpAt: string | null;
  qualityDeadlineAt?: string | null;
  pickupDeadlineAt?: string | null;
  pickupWindowOpen?: boolean;
  pickupReceipts?: Array<{
    id: string;
    pickedUpAt: string;
    qualityDeadlineAt: string;
    qualityWindowOpen?: boolean;
    quantity: number;
  }>;
  items: Array<{
    skuId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
    fulfilledQuantity: number;
    pickedUpQuantity?: number;
    qualityEligibleQuantity?: number;
    remainingPickupQuantity?: number;
    exceptionQuantity: number;
    refundedQuantity: number;
    refundedAmountCents: number;
    refundStatus?:
      | "PENDING"
      | "CREATED"
      | "PROCESSING"
      | "FAILED"
      | "SUCCEEDED"
      | null;
    refundAmountCents?: number;
  }>;
  fulfillmentExceptions?: Array<{
    id: string;
    status: string;
    sourceStage: string;
    responsibility: string;
    resolutionNote: string | null;
    items: Array<{
      catalogSkuId: string;
      fulfilledQuantity: number;
      exceptionQuantity: number;
      refundedQuantity: number;
      reason: string | null;
    }>;
  }>;
  partialRefunds?: Array<{
    id: string;
    exceptionId: string;
    status: string;
    amountCents: number;
  }>;
  communityQualityCases?: Array<{
    id: string;
    status: "REGISTERED" | "ACCEPTED" | "REJECTED" | "REFUNDING" | "RESOLVED";
    registeredAt: string;
    items: Array<{
      id: string;
      catalogSkuId: string;
      pickupReceiptId: string;
      pickedUpQuantitySnapshot: number;
      disputedQuantity: number;
      reason: "PICKUP_SHORTAGE" | "PICKUP_DAMAGE" | "QUALITY_CLAIM";
      description: string;
    }>;
  }>;
  pickupWindow?: {
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
    dispositionNote: string | null;
  } | null;
  cancellation?: {
    status:
      | "DIRECT_REFUNDING"
      | "PENDING_REVIEW"
      | "REJECTED"
      | "APPROVED_WAITING_FINANCE"
      | "REFUNDING"
      | "REFUNDED";
    reason: string;
    reviewNote: string | null;
    requestedAt: string;
    refundId: string | null;
  } | null;
}

interface DeliveryPlanDto {
  id: string;
  campaignId: string;
  serviceAreaId: string;
  pickupPointId: string;
  status: "SITE_CONFIRMED" | "VEHICLE_BOOKED" | "IN_TRANSIT" | "ARRIVED";
  siteName: string;
  address: string;
  arrivalStartAt: string | null;
  arrivalEndAt: string | null;
  estimatedArrivalAt?: string | null;
}

interface ServiceAreaDto {
  id: string;
  regionCode: string;
  name: string;
  status: "ENABLED" | "DISABLED";
  orderEnabled: boolean;
}

interface PickupPointDto {
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
  status: "ACTIVE" | "SUSPENDED";
  capacityPerDay: number | null;
}

interface HomepageBannerDto {
  id: string;
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  targetType?: "NONE" | "CAMPAIGN" | "CATEGORY";
  targetValue?: string | null;
  sortOrder?: number;
}

interface ConsumerProfileDto {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  phoneNumber: string | null;
  phoneVerifiedAt?: string | null;
  profileVersion: number;
  profileUpdatedAt?: string | null;
}
