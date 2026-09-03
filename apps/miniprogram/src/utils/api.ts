import { PRIVACY_NOTICE_VERSION } from "../config/legal";
import { isLocalDemoDeployment } from "../config/deployment";
import { clearAuthIntent, clearCancelReturnSuppression } from "./auth-intent";

const app = getApp<IAppOption>();

interface Envelope<T> {
  data: T;
}
interface ErrorEnvelope {
  message?: string;
}
interface LoginResult {
  accessToken: string;
  expiresAt: string;
  userId: string;
}
interface PaymentResult {
  provider: "mock" | "wechat";
  status: string;
  clientPayload: Record<string, string>;
}
type AuthRequirement = "required" | "none";
type ClientRequestOptions = WechatMiniprogram.RequestOption & {
  auth?: AuthRequirement;
};

let loginPromise: Promise<string> | null = null;
let sessionEpoch = 0;
const DEMO_CUSTOMER_SESSION_KEY = "hometown-demo-customer-session";
const PRIVACY_CONSENT_VERSION_KEY = "hometown-privacy-notice-version";
const hasDemoCustomerSession = (): boolean =>
  wx.getStorageSync<boolean>(DEMO_CUSTOMER_SESSION_KEY) === true;
const isDemoLoginAvailable = (): boolean =>
  isLocalDemoDeployment(app.globalData);

/**
 * A 401 is a navigation event, not a reason to silently repeat a request.
 * In particular, create-order, payment and after-sale writes must never be
 * replayed after the session expires. The page that owns the action routes the
 * customer through the login intent flow instead.
 */
export class AuthExpiredError extends Error {
  readonly code = "AUTH_EXPIRED";

  constructor(
    readonly requestEpoch = sessionEpoch,
    readonly sessionWasCleared = false,
  ) {
    super("登录已失效，请重新登录");
    this.name = "AuthExpiredError";
  }
}

const TECHNICAL_ERROR_PATTERN =
  /(request:fail|errMsg|statuscode|status\s*code|fetch failed|econn|etimedout|socket|http:\/\/|https:\/\/|\b[45]\d{2}\b|(?:\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS)\s+)?\/api\/[^\s]+|(?:\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS)\s+)?\/v\d+\/[^\s]+)/i;
const INTERNAL_CODE_PATTERN = /^(?:[A-Z][A-Z0-9_-]{1,31}|P\d{1,3})$/;

/**
 * Convert SDK/network/server failures into safe consumer-facing copy.  API
 * route paths, HTTP status codes and WeChat's raw request:fail text are
 * implementation details and must never reach a customer page.
 */
export function customerErrorMessage(
  error: unknown,
  fallback = "暂时无法完成请求，请稍后重试",
): string {
  if (error instanceof AuthExpiredError) return error.message;
  const message = error instanceof Error ? error.message.trim() : "";
  if (
    !message ||
    TECHNICAL_ERROR_PATTERN.test(message) ||
    INTERNAL_CODE_PATTERN.test(message)
  ) {
    return isLocalDemoDeployment(app.globalData)
      ? "本地服务未启动，请在项目根目录运行 pnpm dev 后重试"
      : fallback;
  }
  return message;
}

function wxLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) =>
        result.code ? resolve(result.code) : reject(new Error("微信登录失败")),
      fail: (error) => reject(new Error(customerErrorMessage(error, "微信登录失败"))),
    });
  });
}

function loginRequest(
  code: string,
  privacyVersion: string,
): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    wx.request<Envelope<LoginResult>>({
      url: `${app.globalData.apiBaseUrl}/api/v1/auth/wechat/login`,
      method: "POST",
      header: { "content-type": "application/json" },
      data: { code, privacyAccepted: true, privacyVersion },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300)
          return resolve(response.data.data);
        reject(
          new Error(
            customerErrorMessage(
              new Error((response.data as unknown as ErrorEnvelope).message ?? "微信登录失败"),
              "微信登录失败",
            ),
          ),
        );
      },
      fail: (error) => reject(new Error(customerErrorMessage(error, "网络连接失败"))),
    });
  });
}

async function ensureAccessToken(
  force = false,
  explicitPrivacyVersion?: string,
): Promise<string> {
  const requestEpoch = sessionEpoch;
  const privacyVersion =
    explicitPrivacyVersion ??
    wx.getStorageSync<string>(PRIVACY_CONSENT_VERSION_KEY);
  if (privacyVersion !== PRIVACY_NOTICE_VERSION)
    throw new Error("请先阅读并同意最新隐私说明");
  if (!force) {
    const cached =
      app.globalData.accessToken ?? wx.getStorageSync<string>("accessToken");
    if (
      cached &&
      wx.getStorageSync<string>(PRIVACY_CONSENT_VERSION_KEY) === privacyVersion
    ) {
      app.globalData.accessToken = cached;
      return cached;
    }
  }
  if (!loginPromise) {
    loginPromise = wxLogin()
      .then((code) => loginRequest(code, privacyVersion))
      .then((result) => {
        // A logout/401 can happen while wx.login or the exchange request is
        // pending. Do not let that late response repopulate the token store.
        if (sessionEpoch !== requestEpoch)
          throw new Error("登录状态已变化，请重新登录");
        app.globalData.accessToken = result.accessToken;
        wx.setStorageSync("accessToken", result.accessToken);
        wx.setStorageSync(PRIVACY_CONSENT_VERSION_KEY, privacyVersion);
        return result.accessToken;
      })
      .finally(() => {
        loginPromise = null;
      });
  }
  return loginPromise;
}

async function request<T>(
  options: ClientRequestOptions,
): Promise<T> {
  const requestEpoch = sessionEpoch;
  const method = (options.method ?? "GET").toUpperCase();
  // The API's JSON parser expects an object for every JSON POST, including
  // command endpoints whose contract has no request fields. Sending an empty
  // body makes those otherwise valid commands fail before routing.
  const data = method === "POST" && options.data === undefined ? {} : options.data;
  const header: Record<string, string> = {
    "content-type": "application/json",
    ...(options.header as Record<string, string> | undefined),
  };
  if (options.auth !== "none") {
    if (app.globalData.authMode === "wechat")
      header.authorization = `Bearer ${await ensureAccessToken()}`;
    else {
      if (!isDemoLoginAvailable())
        throw new Error("当前环境未启用开发登录");
      if (!hasDemoCustomerSession())
        throw new Error("请先登录后再查看或提交订单");
      header["x-demo-user-id"] = "demo-user";
      header["x-demo-role"] = "USER";
    }
  }

  return new Promise<T>((resolve, reject) => {
    wx.request<Envelope<T>>({
      ...options,
      ...(data === undefined ? {} : { data }),
      header,
      url: `${app.globalData.apiBaseUrl}${options.url}`,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300)
          return resolve(response.data.data);
        if (response.statusCode === 401) {
          const sessionWasCleared = sessionEpoch === requestEpoch;
          if (sessionWasCleared) customerAuth.clearSession();
          reject(new AuthExpiredError(requestEpoch, sessionWasCleared));
          return;
        }
        const serverMessage = (response.data as unknown as ErrorEnvelope)?.message;
        reject(
          new Error(
            response.statusCode >= 500
              ? customerErrorMessage(new Error(`HTTP ${response.statusCode}`))
              : customerErrorMessage(
                  new Error(serverMessage ?? "请求未完成，请稍后重试"),
                  response.statusCode === 409
                    ? "当前操作暂不可用，请刷新后重试"
                    : "请求未完成，请稍后重试",
                ),
          ),
        );
      },
      fail: (error) => reject(new Error(customerErrorMessage(error, "网络连接失败"))),
    });
  });
}

export const api = {
  listCampaigns: () =>
    request<CampaignDto[]>({
      url: "/api/v1/campaigns",
      method: "GET",
      auth: "none",
    }),
  listServiceAreas: () =>
    request<ServiceAreaDto[]>({
      url: "/api/v1/service-areas",
      method: "GET",
      auth: "none",
    }),
  listPickupPoints: (serviceAreaId: string) =>
    request<PickupPointDto[]>({
      url: `/api/v1/pickup-points?serviceAreaId=${encodeURIComponent(serviceAreaId)}`,
      method: "GET",
      auth: "none",
    }),
  getDeliveryPlan: (campaignId: string) =>
    request<DeliveryPlanDto | null>({
      url: `/api/v1/delivery-plans/${encodeURIComponent(campaignId)}`,
      method: "GET",
      auth: "none",
    }),
  getCampaign: (id: string) =>
    request<CampaignDto>({
      url: `/api/v1/campaigns/${id}`,
      method: "GET",
      auth: "none",
    }),
  listOrders: () =>
    request<OrderDto[]>({ url: "/api/v1/orders", method: "GET" }),
  getOrder: (id: string) =>
    request<OrderDto>({ url: `/api/v1/orders/${id}`, method: "GET" }),
  cancelOrder: (id: string) =>
    request<OrderDto>({
      url: `/api/v1/orders/${encodeURIComponent(id)}/cancel`,
      method: "POST",
    }),
  getPickupCode: (orderId: string) =>
    request<{ code: string; expiresAt: string }>({
      url: `/api/v1/pickup-code?orderId=${orderId}`,
      method: "GET",
    }),
  initiatePayment: (orderId: string) =>
    request<PaymentResult>({
      url: `/api/v1/orders/${orderId}/pay`,
      method: "POST",
    }),
  createOrder: (
    payload: {
      campaignId: string;
      serviceAreaId: string;
      pickupPointId: string;
      items: Array<{ skuId: string; quantity: number }>;
    },
    key: string,
  ) =>
    request<OrderDto>({
      url: "/api/v1/orders",
      method: "POST",
      header: { "Idempotency-Key": key },
      data: payload,
    }),
  mockPay: (orderId: string) =>
    request<OrderDto>({
      url: `/api/v1/orders/${orderId}/pay/mock-confirm`,
      method: "POST",
    }),
  createServiceAreaInterest: (payload: {
    regionText: string;
    contactName: string;
    contactPhone: string;
    privacyAccepted: true;
    privacyVersion: string;
  }) =>
    request<{ id: string; status: string }>({
      url: "/api/v1/service-area-interests",
      method: "POST",
      data: payload,
    }),
  listOwnServiceAreaInterests: () =>
    request<
      Array<{
        id: string;
        regionText: string;
        contactName: string;
        maskedContactPhone: string;
        status: "NEW" | "CONTACTED" | "CLOSED";
        statusNote: string | null;
        statusChangedAt: string | null;
        createdAt: string;
      }>
    >({ url: "/api/v1/service-area-interests", method: "GET" }),
  updateOwnServiceAreaInterest: (
    id: string,
    payload: {
      regionText: string;
      contactName: string;
      contactPhone: string;
      privacyAccepted: true;
      privacyVersion: string;
    },
  ) =>
    request<{ id: string; status: string }>({
      url: `/api/v1/service-area-interests/${encodeURIComponent(id)}/correct`,
      method: "POST",
      data: payload,
    }),
  withdrawOwnServiceAreaInterest: (id: string) =>
    request<{ id: string; status: "CLOSED" }>({
      url: `/api/v1/service-area-interests/${encodeURIComponent(id)}/withdraw`,
      method: "POST",
    }),
  createCommunityQualityCase: (
    orderId: string,
    payload: {
      clientRequestId: string;
      items: Array<{
        catalogSkuId: string;
        quantity: number;
        reason: "PICKUP_SHORTAGE" | "PICKUP_DAMAGE" | "QUALITY_CLAIM";
        description: string;
      }>;
    },
  ) =>
    request<{ id: string; status: string }>({
      url: `/api/v1/orders/${encodeURIComponent(orderId)}/quality-cases`,
      method: "POST",
      data: payload,
    }),
  listNotifications: () =>
    request<
      Array<{
        id: string;
        orderId: string;
        type: string;
        title: string;
        content: string;
        status: string;
        readAt: string | null;
        createdAt: string;
      }>
    >({ url: "/api/v1/notifications", method: "GET" }),
  markNotificationRead: (id: string) =>
    request<unknown>({
      url: `/api/v1/notifications/${encodeURIComponent(id)}/read`,
      method: "POST",
    }),
  saveNotificationPreferences: (
    types: Array<
      | "SITE_CONFIRMED"
      | "VEHICLE_DISPATCHED"
      | "ARRIVED"
      | "PARTIAL_REFUND"
      | "PICKUP_DEADLINE"
      | "PICKUP_EXPIRED"
      | "CAMPAIGN_POSTPONED"
    >,
  ) =>
    request<unknown>({
      url: "/api/v1/notifications/preferences",
      method: "POST",
      data: { types },
    }),
  getNotificationPreferences: () =>
    request<{
      types: Array<
        | "SITE_CONFIRMED"
        | "VEHICLE_DISPATCHED"
        | "ARRIVED"
        | "PARTIAL_REFUND"
        | "PICKUP_DEADLINE"
        | "PICKUP_EXPIRED"
        | "CAMPAIGN_POSTPONED"
      >;
    }>({
      url: "/api/v1/notifications/preferences",
      method: "GET",
    }),
};

export const customerAuth = {
  getSessionEpoch: (): number => sessionEpoch,
  captureSessionEpoch: (): number => sessionEpoch,
  isWechatMode: () => app.globalData.authMode === "wechat",
  isDemoLoginAvailable,
  isLoggedIn: () =>
    app.globalData.authMode === "wechat"
      ? Boolean(
          app.globalData.accessToken ??
            wx.getStorageSync<string>("accessToken"),
        ) &&
        wx.getStorageSync<string>(PRIVACY_CONSENT_VERSION_KEY) ===
          PRIVACY_NOTICE_VERSION
      : isDemoLoginAvailable() && hasDemoCustomerSession(),
  async login(privacyVersion: string): Promise<void> {
    if (app.globalData.authMode === "wechat")
      return this.loginWechat(privacyVersion);
    return this.loginDemo(privacyVersion);
  },
  async loginWechat(privacyVersion: string): Promise<void> {
    if (privacyVersion !== PRIVACY_NOTICE_VERSION)
      throw new Error("请先阅读并同意最新隐私说明");
    if (app.globalData.authMode !== "wechat")
      throw new Error("当前未配置微信快捷登录，请使用开发体验登录");
    const loginEpoch = sessionEpoch;
    await ensureAccessToken(false, privacyVersion);
    // A successful login establishes the current identity, even if the
    // underlying token happened to be refreshed in place.
    if (sessionEpoch !== loginEpoch) {
      this.clearSession();
      throw new Error("登录状态已变化，请重新登录");
    }
    sessionEpoch += 1;
  },
  async loginDemo(privacyVersion: string): Promise<void> {
    if (privacyVersion !== PRIVACY_NOTICE_VERSION)
      throw new Error("请先阅读并同意最新隐私说明");
    if (!isDemoLoginAvailable())
      throw new Error("开发登录仅可用于本地开发环境");
    const loginEpoch = sessionEpoch;
    wx.setStorageSync(DEMO_CUSTOMER_SESSION_KEY, true);
    wx.setStorageSync(PRIVACY_CONSENT_VERSION_KEY, privacyVersion);
    if (sessionEpoch !== loginEpoch) {
      this.clearSession();
      throw new Error("登录状态已变化，请重新登录");
    }
    sessionEpoch += 1;
  },
  clearSession(): void {
    sessionEpoch += 1;
    app.globalData.accessToken = null;
    wx.removeStorageSync("accessToken");
    wx.removeStorageSync(DEMO_CUSTOMER_SESSION_KEY);
    // A session boundary must not leave a stale protected-entry destination
    // that could be replayed after an explicit logout or a 401 response.
    clearAuthIntent();
    clearCancelReturnSuppression();
  },
  async logout(): Promise<void> {
    // Invalidate the local session before waiting on the remote revoke.  A
    // logout is a hard identity boundary: any in-flight write must stop
    // immediately, even when the network request takes a long time.
    const token =
      app.globalData.accessToken ?? wx.getStorageSync<string>("accessToken");
    const authMode = app.globalData.authMode;
    this.clearSession();
    wx.removeStorageSync(PRIVACY_CONSENT_VERSION_KEY);
    if (authMode === "demo") return;
    if (token)
      await new Promise<void>((resolve) => {
        wx.request({
          url: `${app.globalData.apiBaseUrl}/api/v1/auth/logout`,
          method: "POST",
          header: { authorization: `Bearer ${token}` },
          data: {},
          complete: () => resolve(),
        });
      });
  },
};
