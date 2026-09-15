import type { ConsumerSummary, ConsumerDetail } from "./consumers-page.tsx";
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
  createdAt?: string;
  productId: string;
  categoryId?: string | null;
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
export type CampaignInput = {
    title: string;
    serviceAreaId: string;
    pickupPointId: string;
    cutoffAt: string;
    dispatchAt: string;
    estimatedArrivalStartAt: string | null;
    estimatedArrivalEndAt: string | null;
    minTotalQuantity: number;
    failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
    items: Array<{
      catalogSkuId: string;
      retailPriceCents: number;
      sellableQuantity: number;
    }>;
  };
export interface Campaign {
  id: string;
  createdAt?: string;
  title: string;
  serviceAreaId: string;
  cutoffAt: string;
  dispatchAt: string;
  estimatedArrivalStartAt: string | null;
  estimatedArrivalEndAt: string | null;
  minTotalQuantity: number;
  failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
  status: string;
  version: number;
  postponementCount?: number;
  paidQuantity?: number;
  items: Array<{
    skuId: string;
    title: string;
    skuName: string;
    category?: string;
    origin?: string;
    unitPriceCents: number;
    stock: number;
    soldQuantity: number;
    paidQuantity?: number;
  }>;
  deliveryPlan: DeliveryPlan | null;
}
export interface DeliveryPlan {
  id: string;
  createdAt?: string;
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
    arrivalStartAt: string | null;
    arrivalEndAt: string | null;
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
  status: "PASSWORD_SETUP_REQUIRED" | "ACTIVE" | "SUSPENDED";
  pickupPointIds: string[];
  createdAt: string;
}
export interface CommunityDelivery {
  id: string;
  createdAt?: string;
  estimatedArrivalAt?: string | null;
  arrivalConfirmedAt?: string | null;
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
  refundAmountCents: number | null;
  financialFactsError?: string | null;
  items: Array<{
    catalogSkuId: string;
    name: string;
    expectedQuantity: number;
    acceptedQuantity: number;
    rejectedQuantity: number;
    shortQuantity: number;
    damagedQuantity: number;
    affectedQuantity: number;
    unitPriceCents: number | null;
    amountCents: number | null;
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
  manualCompletionChannel: string | null;
  manualCompletionExternalReference: string | null;
  manualCompletionResult: string | null;
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
export class AdminApiError extends Error {
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: unknown;
  readonly statusCode?: number;
  readonly retryAfterSeconds?: number;
  constructor(
    message: string,
    options: {
      code?: string;
      requestId?: string;
      details?: unknown;
      statusCode?: number;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "AdminApiError";
    Object.assign(this, options);
  }
}

export function parseRetryAfterSeconds(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds));
  const date = Date.parse(value);
  if (!Number.isFinite(date) || date <= now) return undefined;
  return Math.max(1, Math.ceil((date - now) / 1_000));
}

export function loginRetryRemainingSeconds(until: number | null, now = Date.now()): number {
  return until ? Math.max(0, Math.ceil((until - now) / 1_000)) : 0;
}

export function loginRetryMessage(seconds: number): string {
  return `登录尝试过于频繁，请在 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒后重试；持续失败请联系超级管理员`;
}

const validationFieldNames: Record<string, string> = {
  category: "分类",
  title: "商品名称",
  origin: "产地",
  skuName: "销售规格（包装单位）",
  retailPriceCents: "售价",
  defaultSellableQuantity: "默认团期可售量",
  regionCode: "服务区域",
  serviceAreaId: "服务区域",
  pickupPointId: "自提点",
  dispatchAt: "计划发车时间",
  cutoffAt: "截单时间",
  estimatedArrivalStartAt: "预计到货开始时间",
  estimatedArrivalEndAt: "预计到货结束时间",
  name: "分类名称",
  sortOrder: "分类排序",
  categoryId: "分类",
};
function translateOperatorValidation(field: string, message: string): string {
  const min = message.match(/at least (\d+) character/i)?.[1];
  if (min) return `${field}至少 ${min} 个字符`;
  const max = message.match(/at most (\d+) character/i)?.[1];
  if (max) return `${field}不能超过 ${max} 个字符`;
  if (/invalid input/i.test(message)) return `${field}格式不正确`;
  return message;
}
function formatOperatorDetails(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  const messages = details
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const value = item as { path?: unknown; message?: unknown };
      if (typeof value.message !== "string" || !value.message) return null;
      const path = Array.isArray(value.path) ? value.path : [];
      const field = typeof path[0] === "string" ? validationFieldNames[path[0]] : undefined;
      const readable = translateOperatorValidation(field ?? "该字段", value.message);
      return field ? `${field}：${readable}` : readable;
    })
    .filter((value): value is string => Boolean(value));
  return messages.length ? [...new Set(messages)].join("；") : null;
}
export function adminErrorText(error: unknown): string {
  const value = error as {
    message?: unknown;
    code?: unknown;
    details?: unknown;
    statusCode?: unknown;
  };
  const message = typeof value?.message === "string" ? value.message : "";
  const statusCode = typeof value?.statusCode === "number" ? value.statusCode : 0;
  const validation = formatOperatorDetails(value?.details);
  if (validation) return validation;
  const businessMessage = [
    "商品仍有进行中团期或未完成订单，不能停用",
    "区域仍有进行中团期或未完成订单，不能暂停下单",
    "自提点仍有进行中团期、配送或授权负责人，不能停用",
    "存在进行中履约或有效点位负责人授权，不能停用自提点",
    "分类仍被商品引用，只能停用，不能删除",
  ].find((candidate) => message.includes(candidate));
  if (businessMessage) return businessMessage;
  if (
    value?.code === "NETWORK_UNAVAILABLE" ||
    /failed to fetch|load failed|networkerror|network request failed|econnrefused|fetch failed/i.test(
      message,
    )
  )
    return "暂时无法连接后台服务，请稍后重试；持续失败请联系超级管理员";
  if (statusCode === 401 && value?.code === "INVALID_CREDENTIALS")
    return "账号或密码不正确";
  if (statusCode === 401 || value?.code === "AUTHENTICATION_REQUIRED")
    return "登录状态已失效，请重新登录后再试";
  if (statusCode === 403 && value?.code === "ACCOUNT_DISABLED")
    return "该账号已停用，请联系超级管理员";
  if (statusCode === 403 && value?.code === "PASSWORD_SETUP_REQUIRED")
    return "该账号需要超级管理员重置临时密码";
  if (statusCode === 429 || value?.code === "LOGIN_RATE_LIMITED")
    return "登录尝试过于频繁，请稍后再试";
  if (statusCode === 403 || value?.code === "FORBIDDEN")
    return "当前账号没有执行此操作的权限";
  if (statusCode === 404) return "未找到要操作的数据，请刷新后重试";
  if (value?.code === "CONCURRENT_MODIFICATION")
    return "数据刚刚被其他操作更新，请刷新列表后再试";
  if (
    [
      "INVALID_STATE_TRANSITION",
      "CAMPAIGN_NOT_DRAFT",
      "CAMPAIGN_CLOSED",
      "CAMPAIGN_VERSION_CONFLICT",
      "DELIVERY_SITE_NOT_CONFIRMED",
    ].includes(String(value?.code)) &&
    message
  )
    return message;
  if (statusCode === 409 || value?.code === "RESOURCE_IN_USE")
    return "当前数据状态已变化或仍被使用，请刷新后重试";
  if (statusCode >= 500) return "后台服务暂时不可用，请稍后重试";
  if (value?.code === "VALIDATION_ERROR") return "请检查标有提示的字段后重试";
  return "操作未完成，请检查填写内容后重试";
}
const TOKEN = "community-admin-token",
  ROLES = "community-admin-roles",
  USER_ID = "community-admin-user-id",
  USERNAME = "community-admin-username";
const ALLOWED_STAFF_ROLES = new Set<StaffRole>([
  "SUPER_ADMIN",
  "OPERATOR",
  "CUSTOMER_SERVICE",
  "FINANCE",
  "PICKUP_MANAGER",
]);
export function isValidStaffRoles(value: unknown): value is StaffRole[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (role) =>
        typeof role === "string" &&
        ALLOWED_STAFF_ROLES.has(role as StaffRole),
    )
  );
}
export const requiresLogin =
  import.meta.env.PROD || import.meta.env.VITE_AUTH_MODE === "bearer";
export function hasValidAdminSession(
  requireBearer: boolean,
  token: string | null,
  roles: readonly string[],
  userId: string | null,
  username: string | null,
): boolean {
  if (!requireBearer) return true;
  return Boolean(token && roles.length > 0 && userId?.trim() && username?.trim());
}
export const auth = {
  token: () => localStorage.getItem(TOKEN),
  userId: () => localStorage.getItem(USER_ID),
  username: () => localStorage.getItem(USERNAME),
  roles: (): string[] => {
    try {
      const v = JSON.parse(localStorage.getItem(ROLES) ?? "[]");
      if (!isValidStaffRoles(v)) {
        if (requiresLogin && auth.token()) auth.clear();
        return [];
      }
      return v;
    } catch {
      if (requiresLogin && auth.token()) auth.clear();
      return [];
    }
  },
  save: (token: string, roles: string[], userId?: string, username?: string) => {
    localStorage.setItem(TOKEN, token);
    localStorage.setItem(ROLES, JSON.stringify(roles));
    if (userId) localStorage.setItem(USER_ID, userId);
    if (username) localStorage.setItem(USERNAME, username);
  },
  clear: () => {
    localStorage.removeItem(TOKEN);
    localStorage.removeItem(ROLES);
    localStorage.removeItem(USER_ID);
    localStorage.removeItem(USERNAME);
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
async function request<T>(path: string, init: RequestInit = {}, includeEnvelope = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { ...headers(init.body !== undefined), ...(init.headers ?? {}) },
    });
  } catch (error) {
    throw new AdminApiError(
      "暂时无法连接后台服务，请稍后重试；持续失败请联系超级管理员",
      { code: "NETWORK_UNAVAILABLE", details: error },
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    const publicAuthEndpoint =
      path === "/api/v1/auth/admin/login" ||
      path === "/api/v1/auth/admin/complete-password-change";
    if (response.status === 401 && !publicAuthEndpoint) {
      auth.clear();
      window.dispatchEvent(new Event("admin-auth-expired"));
    }
    const retryAfterSeconds =
      response.status === 429
        ? parseRetryAfterSeconds(response.headers.get("retry-after"))
        : undefined;
    const error = new AdminApiError(body.message ?? "后台请求未完成", {
      ...(body.code ? { code: body.code } : {}),
      ...(body.requestId ? { requestId: body.requestId } : {}),
      ...(body.details !== undefined ? { details: body.details } : {}),
      statusCode: response.status,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as Envelope<T>;
  return includeEnvelope ? body as T : body.data;
}
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export interface QueuePage<T> { data: T[]; pagination: {total: number; page: number; pageSize: number} }
export interface QueueQuery {page: number; pageSize: number; status?: string}
const queuePage = <T,>(path: string, query: QueueQuery) => request<QueuePage<T>>(`${path}?${new URLSearchParams({page: String(query.page), pageSize: String(query.pageSize), ...(query.status ? {status: query.status} : {})})}`, {}, true);

export const api = {
  qualityPage: (query: QueueQuery) => queuePage<QualityCase>("/api/v1/admin/quality-cases", query),
  cancellationsPage: (query: QueueQuery) => queuePage<CancellationRequest>("/api/v1/admin/community/cancellation-requests", query),
  pickupWindowsPage: (query: QueueQuery) => queuePage<PickupWindow>("/api/v1/admin/community/pickup-windows", query),
  exceptionsPage: (query: QueueQuery) => queuePage<FulfillmentException>("/api/v1/admin/fulfillment-exceptions", query),
  manualNotificationsPage: (query: QueueQuery) => queuePage<Notification>("/api/v1/admin/notifications/manual", query),
  login: async (username: string, password: string) => {
    const v = await post<
      | { nextAction: "LOGIN"; accessToken: string; roles: string[]; userId: string }
      | { nextAction: "CHANGE_PASSWORD"; passwordChangeToken: string; roles: string[]; userId: string }
    >(
      "/api/v1/auth/admin/login",
      { username, password },
    );
    if (v.nextAction === "LOGIN") auth.save(v.accessToken, v.roles, v.userId, username.trim().toLowerCase());
    return v;
  },
  completePasswordChange: async (
    passwordChangeToken: string,
    newPassword: string,
    username?: string,
  ) => {
    const v = await post<{ nextAction: "LOGIN"; accessToken: string; roles: string[]; userId: string }>(
      "/api/v1/auth/admin/complete-password-change",
      { passwordChangeToken, newPassword },
    );
    auth.save(v.accessToken, v.roles, v.userId, username?.trim().toLowerCase());
    return v;
  },
  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    post<{ nextAction: "LOGIN"; accessToken: string; roles: string[]; userId: string }>(
      "/api/v1/admin/me/change-password",
      { currentPassword, newPassword },
    ).then((v) => {
      auth.save(v.accessToken, v.roles, v.userId);
      return v;
    }),
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
  categories: (includeInactive = false) =>
    request<ProductCategory[]>(
      `/api/v1/admin/catalog/categories?includeInactive=${includeInactive ? "true" : "false"}`,
    ),
  saveCategory: (body: {
    id?: string;
    name: string;
    sortOrder?: number;
    status?: "ACTIVE" | "INACTIVE";
  }) => post<ProductCategory>("/api/v1/admin/catalog/categories", body),
  homepageBanners: () =>
    request<HomepageBanner[]>("/api/v1/admin/homepage-banners"),
  createHomepageBanner: (body: {
    title: string;
    subtitle: string;
    imageUrl: string;
    targetType: HomepageBanner["targetType"];
    targetValue: string | null;
    scope: HomepageBanner["scope"];
    serviceAreaId: string | null;
    startsAt: string | null;
    endsAt: string | null;
    sortOrder: number;
    status: HomepageBanner["status"];
  }) => post<HomepageBanner>("/api/v1/admin/homepage-banners", body),
  updateHomepageBanner: (
    id: string,
    body: {
      version: number;
      title: string;
      subtitle: string;
      imageUrl: string;
      targetType: HomepageBanner["targetType"];
      targetValue: string | null;
      scope: HomepageBanner["scope"];
      serviceAreaId: string | null;
      startsAt: string | null;
      endsAt: string | null;
      sortOrder: number;
      status: HomepageBanner["status"];
    },
  ) => post<HomepageBanner>("/api/v1/admin/homepage-banners", { id, ...body }),
  deleteHomepageBanner: (id: string, version: number) =>
    request<{ id: string; deleted: boolean }>(
      `/api/v1/admin/homepage-banners/${id}`,
      { method: "DELETE", body: JSON.stringify({ version }) },
    ),
  deleteCategory: (id: string) =>
    request<{ deleted: boolean }>(`/api/v1/admin/catalog/categories/${id}`, {
      method: "DELETE",
    }),
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
  uploadProductImage: (file: File, signal?: AbortSignal) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return Promise.reject(new AdminApiError("请选择 JPG、PNG 或 WebP 图片"));
    if (file.size === 0 || file.size > 5 * 1024 * 1024)
      return Promise.reject(new AdminApiError("图片不能为空，且不能超过 5 MB"));
    return request<{ imageUrl: string }>("/api/v1/admin/product-images", {
      method: "POST", body: file, headers: { "content-type": file.type }, ...(signal ? { signal } : {}),
    });
  },
  skus: () => request<CatalogSku[]>("/api/v1/admin/catalog/skus"),
  saveSku: (body: {
    id?: string;
    productId?: string;
    categoryId?: string | null;
    title: string;
    category: string;
    origin: string;
    imageUrl: string | null;
    skuName: string;
    retailPriceCents: number;
    defaultSellableQuantity: number;
    status: "ACTIVE" | "INACTIVE";
  }) => post<CatalogSku>("/api/v1/admin/catalog/skus", body),
  consumers: (query: {query:string;page:number;pageSize:number}) => request<{items:ConsumerSummary[];total:number;page:number;pageSize:number}>(`/api/v1/admin/consumers?${new URLSearchParams({query:query.query,page:String(query.page),pageSize:String(query.pageSize)})}`),
  consumerDetail: (id:string) => request<ConsumerDetail>(`/api/v1/admin/consumers/${encodeURIComponent(id)}`),
  campaigns: () => request<Campaign[]>("/api/v1/admin/campaigns"),
  createCampaign: (body: CampaignInput) => post<Campaign>("/api/v1/admin/campaigns", body),
  updateCampaign: (id: string, body: CampaignInput & {version: number}) => patch<Campaign>(`/api/v1/admin/campaigns/${id}`, body),
  deleteCampaign: (id: string, version: number) => request<{id:string;deleted:boolean}>(`/api/v1/admin/campaigns/${id}`, {method:"DELETE",body:JSON.stringify({version})}),
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
      estimatedArrivalStartAt: string | null;
      estimatedArrivalEndAt: string | null;
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
      vehicleOrderNo: string | null;
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
      vehicleOrderNo: string | null;
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
  lookupPickupCode: (pickupPointId: string, code: string, orderNo?: string) =>
    request<PickupLookup>(
      `/api/v1/pickup/orders/lookup?${new URLSearchParams({ pickupPointId, code, ...(orderNo ? { orderNo } : {}) })}`,
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
    post<{ staff: InternalStaff; temporaryPassword: string }>(
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
    post<{ staff: InternalStaff; temporaryPassword: string }>(
      `/api/v1/admin/staff/${id}/reset-password`,
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
  completeNotification: (
    id: string,
    value: {
      note: string;
      channel: "WECHAT_CUSTOMER_SERVICE" | "EXTERNAL_CRM" | "OTHER_APPROVED_CHANNEL";
      externalReference: string;
      result: "REACHED" | "USER_ACKNOWLEDGED" | "RESOLVED";
    },
  ) =>
    post<Notification>(`/api/v1/admin/notifications/${id}/manual-complete`, {
      ...value,
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
