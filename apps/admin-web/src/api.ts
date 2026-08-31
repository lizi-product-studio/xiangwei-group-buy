export type StaffRole =
  | "SUPER_ADMIN"
  | "OPERATOR"
  | "CUSTOMER_SERVICE"
  | "FINANCE"
  | "PICKUP_MANAGER";
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
  capacityPerDay: number | null;
  createdAt: string;
}
export interface GeoPlace {
  title: string;
  address: string;
  latitude: number;
  longitude: number;
  provinceName?: string;
  cityName?: string;
  districtName?: string;
  adcode?: string;
}
export interface RegionDirectoryEntry {
  regionCode: string;
  name: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  path: string;
}
export interface CatalogSku {
  id: string;
  productId: string;
  name: string;
  retailPriceCents: number;
  defaultSellableQuantity: number;
  status: "ACTIVE" | "INACTIVE";
  product: {
    title: string;
    category: string;
    origin: string;
    imageUrl: string | null;
    status: string;
  };
}
export interface Campaign {
  id: string;
  title: string;
  serviceAreaId: string;
  cutoffAt: string;
  dispatchAt: string;
  estimatedArrivalStartAt: string;
  estimatedArrivalEndAt: string;
  minTotalQuantity: number;
  failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
  status: string;
  version: number;
  items: Array<{
    skuId: string;
    title: string;
    skuName: string;
    unitPriceCents: number;
    stock: number;
    soldQuantity: number;
  }>;
  deliveryPlan: DeliveryPlan | null;
}
export interface DeliveryPlan {
  id: string;
  campaignId: string;
  serviceAreaId: string;
  pickupPointId: string;
  status: "SITE_CONFIRMED" | "VEHICLE_BOOKED" | "IN_TRANSIT" | "ARRIVED";
  siteName: string;
  address: string;
  vehicleOrderNo: string | null;
  logisticsPlatform: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  estimatedArrivalAt: string | null;
  dispatchedAt: string | null;
  arrivedAt: string | null;
}
export interface Order {
  id: string;
  orderNo: string;
  campaignId: string;
  pickupPointId: string;
  deliveryPlanId: string;
  status: string;
  totalCents: number;
  paidAt: string | null;
  expiresAt?: string;
  createdAt?: string;
  pickedUpAt?: string | null;
  campaignTitle?: string | null;
  pickupPointName?: string | null;
  deliveryPlan?: {
    id: string;
    campaignId: string;
    pickupPointId: string;
    status: string;
    siteName: string;
    address: string;
    arrivalStartAt: string;
    arrivalEndAt: string;
    estimatedArrivalAt: string | null;
  } | null;
  qualityDeadlineAt?: string | null;
  pickupDeadlineAt?: string | null;
  pickupWindowOpen?: boolean;
  pickupWindow?: PickupWindow | null;
  cancellation?: {
    status: string;
    reason: string;
    reviewNote: string | null;
    requestedAt: string;
    refundId: string | null;
  } | null;
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
  communityQualityCases?: QualityCase[];
  pickupReceipts?: Array<{
    id: string;
    pickedUpAt: string;
    qualityDeadlineAt: string;
    qualityWindowOpen: boolean;
    quantity: number;
    items: Array<{ skuId: string; quantity: number }>;
  }>;
  items: Array<{
    skuId?: string;
    productId?: string;
    productTitle?: string | null;
    skuName?: string;
    name: string;
    quantity: number;
    unitPriceCents?: number;
    amountCents?: number;
    fulfilledQuantity: number;
    pickedUpQuantity: number;
    exceptionQuantity: number;
    refundedQuantity: number;
  }>;
}
export interface InternalStaff {
  userId: string;
  staffNo: string;
  displayName: string;
  phone: string;
  role: StaffRole;
  status: "PENDING_ACTIVATION" | "ACTIVE" | "SUSPENDED";
  pickupPointIds: string[];
  createdAt: string;
}
export interface CommunityDelivery {
  id: string;
  campaignId: string;
  campaignTitle: string;
  pickupPointId: string;
  status: DeliveryPlan["status"];
  siteName: string;
  address: string;
  dispatchBatchId: string | null;
  arrivalConfirmed: boolean;
  communityDeliveryId: string | null;
  allocationDraftStatus: "PENDING_OPERATOR_CONFIRMATION" | "CONFIRMED" | null;
  expectedItems: Array<{
    catalogSkuId: string;
    title: string;
    skuName: string;
    expectedQuantity: number;
  }>;
}
export type CommunityArrivalItem = {
  catalogSkuId: string;
  receivedQuantity: number;
  rejectedQuantity: number;
  shortQuantity: number;
  damagedQuantity: number;
  reason:
    | "SHORT_RECEIPT"
    | "PICKUP_POINT_REJECTED"
    | "TRANSIT_DAMAGE"
    | null;
  evidenceNote: string | null;
};
export type CommunityArrivalRequest = {
  receivedBy: string;
  confirmationNote: string | null;
  items: CommunityArrivalItem[];
  /** Present only for a SUPER_ADMIN emergency proxy confirmation. */
  emergencyReason?: string;
};
export interface DispatchBatch {
  id: string;
  campaignId: string;
  serviceAreaId: string;
  status: "DRAFT" | "IN_TRANSIT" | "ARRIVED" | "CLOSED";
  createdAt: string;
}
export interface QualityCase {
  id: string;
  orderId: string;
  orderNo: string | null;
  status: string;
  /** Provider-facing partial-refund fact, if finance has started execution. */
  financeRefundStatus: string | null;
  registeredAt: string;
  acceptanceNote: string | null;
  decisionNote: string | null;
  items: Array<{
    catalogSkuId: string;
    name: string;
    quantity: number;
    reason: string;
    description: string;
  }>;
}
export interface CancellationRequest {
  id: string;
  orderId: string;
  orderNo: string | null;
  reason: string;
  status: string;
  requestedAt: string;
  reviewNote: string | null;
}
export interface PickupWindow {
  orderId: string;
  deliveryPlanId: string;
  arrivedAt: string;
  deadlineAt: string;
  status: string;
  extensionCount: number;
  dispositionNote: string | null;
  orderNo: string | null;
  orderStatus: string | null;
  pickupPointId: string | null;
  pickupPointName: string | null;
  nextResponsibility: "OPERATOR" | "FINANCE" | null;
}
export interface FulfillmentException {
  id: string;
  campaignId: string;
  orderId: string | null;
  sourceStage: string;
  status: string;
  responsibility: string;
  registeredAt: string;
  resolutionNote: string | null;
  orderNo: string | null;
  pickupPointId: string | null;
  pickupPointName: string | null;
  refundAmountCents: number;
  items: Array<{
    catalogSkuId: string;
    name: string;
    expectedQuantity: number;
    acceptedQuantity: number;
    rejectedQuantity: number;
    shortQuantity: number;
    damagedQuantity: number;
    affectedQuantity: number;
    unitPriceCents: number;
    amountCents: number;
    reason: string;
    description: string;
  }>;
}
export interface PackingLabel {
  orderId: string;
  orderNo: string;
  pickupPointId: string;
  pickupPointName: string | null;
  paidAt: string;
  items: Array<{
    catalogSkuId: string;
    name: string;
    quantity: number;
  }>;
}
export interface Refund {
  id: string;
  orderId: string;
  providerRefundNo: string;
  status: string;
  amountCents: number;
  createdAt: string;
}
export interface LedgerTransaction {
  id: string;
  referenceId: string;
  eventType: string;
  createdAt: string;
  debitCents: number;
  creditCents: number;
  isBalanced: boolean;
  lines: Array<{
    accountCode: string;
    direction: "DEBIT" | "CREDIT";
    amountCents: number;
  }>;
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
export interface Notification {
  id: string;
  orderId: string;
  orderNo: string | null;
  userDisplay: string;
  type: string;
  title: string;
  status: string;
  createdAt: string;
  deliveryAttempts: number;
  lastDeliveryError: string | null;
  lastActivityAt: string;
  manualCompletedAt: string | null;
  manualCompletedBy: string | null;
  manualCompletionNote: string | null;
  providerSubmissionStartedAt: string | null;
  providerResultRecordedAt: string | null;
  submissionUnknownReason: string | null;
}
export interface ServiceAreaInterest {
  id: string;
  regionText: string;
  contactName: string;
  maskedContactPhone: string;
  privacyConsentedAt: string;
  status: "NEW" | "CONTACTED" | "CLOSED";
  createdAt: string;
  statusNote: string | null;
  statusChangedAt: string | null;
}
export interface PickupLookup {
  id: string;
  orderNo: string;
  deliveryPlanId: string;
  status: string;
  items: Array<{
    skuId: string;
    name: string;
    quantity: number;
    readyQuantity: number;
    alreadyPickedQuantity: number;
    remainingPickupQuantity: number;
    exceptionQuantity: number;
  }>;
}

interface Envelope<T> {
  data: T;
}
interface ErrorEnvelope {
  code?: string;
  message?: string;
  requestId?: string;
  details?: unknown;
}
const TOKEN = "community-admin-token",
  ROLES = "community-admin-roles";
export const requiresLogin =
  import.meta.env.PROD || import.meta.env.VITE_AUTH_MODE === "bearer";
export const auth = {
  token: () => localStorage.getItem(TOKEN),
  roles: (): string[] => {
    try {
      const v = JSON.parse(localStorage.getItem(ROLES) ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  },
  save: (token: string, roles: string[]) => {
    localStorage.setItem(TOKEN, token);
    localStorage.setItem(ROLES, JSON.stringify(roles));
  },
  clear: () => {
    localStorage.removeItem(TOKEN);
    localStorage.removeItem(ROLES);
  },
};
function headers(json = true): Record<string, string> {
  const value: Record<string, string> = {};
  if (json) value["content-type"] = "application/json";
  if (requiresLogin) {
    const token = auth.token();
    if (token) value.authorization = `Bearer ${token}`;
  } else {
    value["x-demo-user-id"] = "demo-super-admin";
    value["x-demo-role"] = "SUPER_ADMIN";
  }
  return value;
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...headers(init.body !== undefined), ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    if (response.status === 401) {
      auth.clear();
      window.dispatchEvent(new Event("admin-auth-expired"));
    }
    const error = new Error(body.message ?? `请求失败（${response.status}）`);
    Object.assign(error, {
      code: body.code,
      requestId: body.requestId,
      details: body.details,
      statusCode: response.status,
    });
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as Envelope<T>).data;
}
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export const api = {
  login: async (username: string, password: string) => {
    const v = await post<{ accessToken: string; roles: string[] }>(
      "/api/v1/auth/admin/login",
      { username, password },
    );
    auth.save(v.accessToken, v.roles);
    return v;
  },
  activateStaff: async (
    username: string,
    initialCredential: string,
    newPassword: string,
  ) => {
    const v = await post<{ accessToken: string; roles: string[] }>(
      "/api/v1/auth/admin/activate",
      { username, initialCredential, newPassword },
    );
    auth.save(v.accessToken, v.roles);
    return v;
  },
  logout: () => post<void>("/api/v1/auth/logout"),
  areas: () => request<ServiceArea[]>("/api/v1/admin/service-areas"),
  regions: (query = "") =>
    request<RegionDirectoryEntry[]>(
      `/api/v1/admin/region-directory?query=${encodeURIComponent(query)}`,
    ),
  searchPlaces: (query: string) =>
    request<GeoPlace[]>(
      `/api/v1/admin/geo/search?query=${encodeURIComponent(query)}`,
    ),
  reversePlace: (latitude: number, longitude: number) =>
    request<GeoPlace | null>(
      `/api/v1/admin/geo/reverse?latitude=${encodeURIComponent(String(latitude))}&longitude=${encodeURIComponent(String(longitude))}`,
    ),
  openArea: (regionCode: string) =>
    post<ServiceArea>("/api/v1/admin/service-areas", { regionCode }),
  setArea: (id: string, orderEnabled: boolean) =>
    post<ServiceArea>(`/api/v1/admin/service-areas/${id}/order-status`, {
      orderEnabled,
    }),
  points: () => request<PickupPoint[]>("/api/v1/admin/pickup-points"),
  createPoint: (body: {
    serviceAreaId: string;
    name: string;
    address: string;
    businessHours: string;
    pickupInstructions: string;
    latitude: number;
    longitude: number;
    contactName?: string;
    contactPhone?: string;
    capacityPerDay: number | null;
  }) => post<PickupPoint>("/api/v1/admin/pickup-points", body),
  updatePoint: (
    id: string,
    body: {
      name: string;
      address: string;
      businessHours: string;
      pickupInstructions: string;
      latitude: number;
      longitude: number;
      contactName?: string;
      contactPhone?: string;
      capacityPerDay: number | null;
      status?: "ACTIVE" | "INACTIVE";
    },
  ) => patch<PickupPoint>(`/api/v1/admin/pickup-points/${id}`, body),
  skus: () => request<CatalogSku[]>("/api/v1/admin/catalog/skus"),
  saveSku: (body: {
    id?: string;
    productId?: string;
    title: string;
    category: string;
    origin: string;
    imageUrl: string | null;
    skuName: string;
    retailPriceCents: number;
    defaultSellableQuantity: number;
    status: "ACTIVE" | "INACTIVE";
  }) => post<CatalogSku>("/api/v1/admin/catalog/skus", body),
  campaigns: () => request<Campaign[]>("/api/v1/admin/campaigns"),
  createCampaign: (body: {
    title: string;
    serviceAreaId: string;
    pickupPointId: string;
    cutoffAt: string;
    dispatchAt: string;
    estimatedArrivalStartAt: string;
    estimatedArrivalEndAt: string;
    minTotalQuantity: number;
    failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
    items: Array<{
      catalogSkuId: string;
      retailPriceCents: number;
      sellableQuantity: number;
    }>;
  }) => post<Campaign>("/api/v1/admin/campaigns", body),
  campaignAction: (
    id: string,
    action: "open" | "close" | "cancel",
    body?: { reason?: string },
  ) => post<Campaign>(`/api/v1/admin/campaigns/${id}/${action}`, body),
  campaignCancelImpact: (id: string) =>
    request<{
      pendingPaymentOrderCount: number;
      paidOrderCount: number;
      estimatedRefundCents: number;
    }>(`/api/v1/admin/campaigns/${id}/cancel-impact`),
  postponeCampaign: (
    id: string,
    body: {
      cutoffAt: string;
      dispatchAt: string;
      estimatedArrivalStartAt: string;
      estimatedArrivalEndAt: string;
    },
  ) => post<Campaign>(`/api/v1/admin/campaigns/${id}/postpone`, body),
  packingLabels: (id: string) =>
    request<PackingLabel[]>(`/api/v1/admin/campaigns/${id}/packing-labels`),
  orders: (orderNo = "") =>
    request<Order[]>(
      `/api/v1/admin/orders${orderNo ? `?orderNo=${encodeURIComponent(orderNo)}` : ""}`,
    ),
  plans: () => request<DeliveryPlan[]>("/api/v1/admin/delivery-plans"),
  bookVehicle: (
    id: string,
    body: {
      logisticsPlatform: string;
      vehicleOrderNo: string;
      driverName: string | null;
      driverPhone: string | null;
      vehiclePlate: string | null;
      estimatedArrivalAt: string | null;
    },
  ) =>
    post<DeliveryPlan>(`/api/v1/admin/delivery-plans/${id}/book-vehicle`, body),
  correctVehicle: (
    id: string,
    body: {
      logisticsPlatform: string;
      vehicleOrderNo: string;
      driverName: string | null;
      driverPhone: string | null;
      vehiclePlate: string | null;
      estimatedArrivalAt: string | null;
      reason: string;
    },
  ) =>
    post<DeliveryPlan>(
      `/api/v1/admin/delivery-plans/${id}/emergency-correction`,
      body,
    ),
  batches: () => request<DispatchBatch[]>("/api/v1/admin/dispatch-batches"),
  createBatch: (campaignId: string) =>
    post<DispatchBatch>("/api/v1/admin/dispatch-batches", { campaignId }),
  dispatch: (id: string) =>
    post<DispatchBatch>(`/api/v1/admin/dispatch-batches/${id}/dispatch`),
  deliveries: () =>
    request<CommunityDelivery[]>("/api/v1/admin/community/deliveries"),
  confirmArrival: (id: string, body: CommunityArrivalRequest) =>
    post(`/api/v1/admin/community/dispatch-batches/${id}/arrival`, body),
  confirmAllocation: (id: string) =>
    post(`/api/v1/admin/community/deliveries/${id}/allocation-draft/confirm`),
  pickupPlans: () => request<DeliveryPlan[]>("/api/v1/pickup/delivery-plans"),
  lookupPickup: (deliveryPlanId: string, orderNo: string) =>
    request<PickupLookup>(
      `/api/v1/pickup/orders/lookup?deliveryPlanId=${encodeURIComponent(deliveryPlanId)}&orderNo=${encodeURIComponent(orderNo)}`,
    ),
  verifyPickup: (body: {
    orderId: string;
    deliveryPlanId: string;
    code: string;
    pickupRequestId: string;
    items: Array<{ catalogSkuId: string; quantity: number }>;
  }) => post("/api/v1/pickup/verify", body),
  staff: () => request<InternalStaff[]>("/api/v1/admin/staff"),
  createStaff: (body: {
    displayName: string;
    username: string;
    phone: string;
    role: StaffRole;
    pickupPointIds: string[];
  }) =>
    post<{ staff: InternalStaff; initialCredential: string }>(
      "/api/v1/admin/staff",
      body,
    ),
  updateStaff: (
    id: string,
    body: Partial<
      Pick<
        InternalStaff,
        "displayName" | "phone" | "role" | "status" | "pickupPointIds"
      >
    > & { reason?: string },
  ) =>
    request<InternalStaff>(`/api/v1/admin/staff/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  resetStaffCredential: (id: string, reason: string) =>
    post<{ staff: InternalStaff; initialCredential: string }>(
      `/api/v1/admin/staff/${id}/reset-credential`,
      { reason },
    ),
  quality: () => request<QualityCase[]>("/api/v1/admin/quality-cases"),
  acceptQuality: (id: string, note: string) =>
    post(`/api/v1/admin/quality-cases/${id}/accept`, { note }),
  decideQuality: (id: string, approved: boolean, note: string) =>
    post(`/api/v1/admin/quality-cases/${id}/decision`, { approved, note }),
  refundQuality: (id: string) =>
    post<QualityCase>(`/api/v1/admin/quality-cases/${id}/refund`),
  cancellations: () =>
    request<CancellationRequest[]>(
      "/api/v1/admin/community/cancellation-requests",
    ),
  reviewCancellation: (orderId: string, approved: boolean, note: string) =>
    post(`/api/v1/admin/community/orders/${orderId}/cancellation/review`, {
      approved,
      note,
    }),
  refundCancellation: (orderId: string) =>
    post<CancellationRequest>(
      `/api/v1/admin/community/orders/${orderId}/cancellation/refund`,
    ),
  pickupWindows: () =>
    request<PickupWindow[]>("/api/v1/admin/community/pickup-windows"),
  extendPickup: (orderId: string, body: { deadlineAt: string; note: string }) =>
    post<PickupWindow>(
      `/api/v1/admin/community/orders/${orderId}/pickup-extension`,
      body,
    ),
  disposePickup: (
    orderId: string,
    body: { action: "REFUND" | "LOSS"; note: string },
  ) =>
    post<PickupWindow>(
      `/api/v1/admin/community/orders/${orderId}/pickup-disposition`,
      body,
    ),
  executePickupRefund: (orderId: string) =>
    post<PickupWindow>(
      `/api/v1/admin/community/orders/${orderId}/pickup-refund`,
    ),
  exceptions: () =>
    request<FulfillmentException[]>("/api/v1/admin/fulfillment-exceptions"),
  refundException: (id: string, note: string) =>
    post(`/api/v1/admin/fulfillment-exceptions/${id}/refund`, {
      confirmationNote: note,
    }),
  finance: () =>
    request<{ full: Refund[]; partial: Refund[] }>(
      "/api/v1/admin/finance/refunds",
    ),
  ledger: () => request<LedgerTransaction[]>("/api/v1/admin/finance/ledger"),
  manualNotifications: () =>
    request<Notification[]>("/api/v1/admin/notifications/manual"),
  retryNotification: (id: string) =>
    post<Notification>(`/api/v1/admin/notifications/${id}/retry`),
  completeNotification: (id: string, note: string) =>
    post<Notification>(`/api/v1/admin/notifications/${id}/manual-complete`, {
      note,
    }),
  serviceAreaInterests: () =>
    request<ServiceAreaInterest[]>("/api/v1/admin/service-area-interests"),
  updateServiceAreaInterest: (
    id: string,
    body: { status: "CONTACTED" | "CLOSED"; note: string },
  ) =>
    post<ServiceAreaInterest>(`/api/v1/admin/service-area-interests/${id}/status`, body),
  audits: () => request<AuditLog[]>("/api/v1/admin/audit-logs"),
};
