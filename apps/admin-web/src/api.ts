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
  status: "ACTIVE" | "SUSPENDED";
  capacityPerDay: number | null;
  createdAt: string;
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
  items: Array<{
    name: string;
    quantity: number;
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
  status: string;
  registeredAt: string;
  items: Array<{
    catalogSkuId: string;
    disputedQuantity: number;
    reason: string;
    description: string;
  }>;
}
export interface CancellationRequest {
  id: string;
  orderId: string;
  reason: string;
  status: string;
  requestedAt: string;
  reviewNote: string | null;
}
export interface PickupWindow {
  orderId: string;
  deadlineAt: string;
  status: string;
  extensionCount: number;
  dispositionNote: string | null;
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
  items: Array<{
    catalogSkuId: string;
    shortQuantity: number;
    damagedQuantity: number;
    reason: string;
    description: string;
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
  createdAt: string;
}
export interface Notification {
  id: string;
  orderId: string;
  title: string;
  content: string;
  status: string;
  createdAt: string;
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

export const api = {
  login: async (username: string, password: string) => {
    const v = await post<{ accessToken: string; roles: string[] }>(
      "/api/v1/auth/admin/login",
      { username, password },
    );
    auth.save(v.accessToken, v.roles);
    return v;
  },
  logout: () => post<void>("/api/v1/auth/logout"),
  areas: () => request<ServiceArea[]>("/api/v1/admin/service-areas"),
  regions: (query = "") =>
    request<Array<{ regionCode: string; path: string }>>(
      `/api/v1/admin/region-directory?query=${encodeURIComponent(query)}`,
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
    capacityPerDay: number | null;
  }) => post<PickupPoint>("/api/v1/admin/pickup-points", body),
  skus: () => request<CatalogSku[]>("/api/v1/admin/catalog/skus"),
  saveSku: (body: {
    id?: string;
    productId?: string;
    title: string;
    category: string;
    origin: string;
    imageUrl: null;
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
    minTotalQuantity: number;
    failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
    items: Array<{
      catalogSkuId: string;
      retailPriceCents: number;
      sellableQuantity: number;
    }>;
  }) => post<Campaign>("/api/v1/admin/campaigns", body),
  campaignAction: (id: string, action: "open" | "close" | "cancel") =>
    post<Campaign>(`/api/v1/admin/campaigns/${id}/${action}`),
  packingLabels: (id: string) =>
    request<unknown[]>(`/api/v1/admin/campaigns/${id}/packing-labels`),
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
  batches: () => request<DispatchBatch[]>("/api/v1/admin/dispatch-batches"),
  createBatch: (campaignId: string) =>
    post<DispatchBatch>("/api/v1/admin/dispatch-batches", { campaignId }),
  dispatch: (id: string) =>
    post<DispatchBatch>(`/api/v1/admin/dispatch-batches/${id}/dispatch`),
  deliveries: () =>
    request<CommunityDelivery[]>("/api/v1/admin/community/deliveries"),
  confirmArrival: (id: string, body: unknown) =>
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
  quality: () => request<QualityCase[]>("/api/v1/admin/quality-cases"),
  acceptQuality: (id: string, note: string) =>
    post(`/api/v1/admin/quality-cases/${id}/accept`, { note }),
  decideQuality: (id: string, approved: boolean, note: string) =>
    post(`/api/v1/admin/quality-cases/${id}/decision`, { approved, note }),
  refundQuality: (id: string) =>
    post(`/api/v1/admin/quality-cases/${id}/refund`),
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
    post(`/api/v1/admin/community/orders/${orderId}/cancellation/refund`),
  pickupWindows: () =>
    request<PickupWindow[]>("/api/v1/admin/community/pickup-windows"),
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
  completeNotification: (id: string) =>
    post<void>(`/api/v1/admin/notifications/${id}/manual-complete`),
  audits: () => request<AuditLog[]>("/api/v1/admin/audit-logs"),
};
