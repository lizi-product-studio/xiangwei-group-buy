import { PRIVACY_NOTICE_VERSION } from '../config/legal';

const app = getApp<IAppOption>();

interface Envelope<T> { data: T }
interface ErrorEnvelope { message?: string }
interface LoginResult { accessToken: string; expiresAt: string; userId: string }
interface PaymentResult { provider:'mock'|'wechat-platform';status:string;clientPayload:Record<string,string> }
type AuthRequirement = 'required' | 'none';
type ClientRequestOptions = WechatMiniprogram.RequestOption & { auth?: AuthRequirement };

let loginPromise: Promise<string> | null = null;
const DEMO_CUSTOMER_SESSION_KEY = 'hometown-demo-customer-session';
const PRIVACY_CONSENT_VERSION_KEY = 'hometown-privacy-notice-version';
const hasDemoCustomerSession = (): boolean => wx.getStorageSync<boolean>(DEMO_CUSTOMER_SESSION_KEY) === true;

function wxLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({ success: (result) => result.code ? resolve(result.code) : reject(new Error('微信登录失败')), fail: reject });
  });
}

function loginRequest(code: string, privacyVersion: string): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    wx.request<Envelope<LoginResult>>({
      url: `${app.globalData.apiBaseUrl}/api/v1/auth/wechat/login`,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: { code, privacyAccepted: true, privacyVersion },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data.data);
        reject(new Error((response.data as unknown as ErrorEnvelope).message ?? '微信登录失败'));
      },
      fail: (error) => reject(new Error(error.errMsg || '网络连接失败')),
    });
  });
}

async function ensureAccessToken(force = false, explicitPrivacyVersion?: string): Promise<string> {
  const privacyVersion = explicitPrivacyVersion ?? wx.getStorageSync<string>(PRIVACY_CONSENT_VERSION_KEY);
  if (privacyVersion !== PRIVACY_NOTICE_VERSION) throw new Error('请先阅读并同意最新隐私说明');
  if (!force) {
    const cached = app.globalData.accessToken ?? wx.getStorageSync<string>('accessToken');
    if (cached && wx.getStorageSync<string>(PRIVACY_CONSENT_VERSION_KEY) === privacyVersion) { app.globalData.accessToken = cached; return cached; }
  }
  if (!loginPromise) {
    loginPromise = wxLogin()
      .then((code) => loginRequest(code, privacyVersion))
      .then((result) => {
        app.globalData.accessToken = result.accessToken;
        wx.setStorageSync('accessToken', result.accessToken);
        wx.setStorageSync(PRIVACY_CONSENT_VERSION_KEY, privacyVersion);
        return result.accessToken;
      })
      .finally(() => { loginPromise = null; });
  }
  return loginPromise;
}

async function request<T>(options: ClientRequestOptions, retryAuth = true): Promise<T> {
  const header: Record<string, string> = { 'content-type': 'application/json', ...(options.header as Record<string,string> | undefined) };
  if (options.auth !== 'none') {
    if (app.globalData.authMode === 'wechat') header.authorization = `Bearer ${await ensureAccessToken()}`;
    else {
      if (!hasDemoCustomerSession()) throw new Error('请先登录后再查看或提交订单');
      header['x-demo-user-id'] = 'demo-user'; header['x-demo-role'] = 'USER';
    }
  }

  return new Promise<T>((resolve, reject) => {
    wx.request<Envelope<T>>({
      ...options,
      header,
      url: `${app.globalData.apiBaseUrl}${options.url}`,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data.data);
        if (response.statusCode === 401 && retryAuth && app.globalData.authMode === 'wechat') {
          app.globalData.accessToken = null;
          wx.removeStorageSync('accessToken');
          void ensureAccessToken(true).then(() => request<T>(options, false)).then(resolve, reject);
          return;
        }
        reject(new Error((response.data as unknown as ErrorEnvelope).message ?? `服务请求失败（${response.statusCode}）`));
      },
      fail: (error) => reject(new Error(error.errMsg || '网络连接失败')),
    });
  });
}

export const api = {
  listCampaigns: () => request<CampaignDto[]>({ url: '/api/v1/campaigns', method: 'GET', auth: 'none' }),
  listServiceAreas: () => request<ServiceAreaDto[]>({ url: '/api/v1/service-areas', method: 'GET', auth: 'none' }),
  listPickupPoints: (serviceAreaId:string) => request<PickupPointDto[]>({ url: `/api/v1/pickup-points?serviceAreaId=${encodeURIComponent(serviceAreaId)}`, method:'GET',auth:'none' }),
  getDeliveryPlan: (campaignId: string) => request<DeliveryPlanDto | null>({ url: `/api/v1/delivery-plans/${encodeURIComponent(campaignId)}`, method: 'GET', auth: 'none' }),
  getCampaign: (id: string) => request<CampaignDto>({ url: `/api/v1/campaigns/${id}`, method: 'GET', auth: 'none' }),
  listOrders: () => request<OrderDto[]>({ url: '/api/v1/orders', method: 'GET' }),
  getOrder: (id: string) => request<OrderDto>({ url: `/api/v1/orders/${id}`, method: 'GET' }),
  cancelOrder: (id: string) => request<OrderDto>({ url: `/api/v1/orders/${encodeURIComponent(id)}/cancel`, method: 'POST' }),
  getPickupCode: (orderId: string) => request<{code:string;expiresAt:string}>({ url:`/api/v1/pickup-code?orderId=${orderId}`, method:'GET' }),
  initiatePayment:(orderId:string)=>request<PaymentResult>({url:`/api/v1/orders/${orderId}/pay`,method:'POST'}),
  createOrder: (payload: { campaignId: string; serviceAreaId: string; pickupPointId:string; items: Array<{skuId:string;quantity:number}> }, key: string) =>
    request<OrderDto>({
      url: '/api/v1/orders',
      method: 'POST',
      header: { 'Idempotency-Key': key },
      data: payload,
    }),
  mockPay: (orderId: string) => request<OrderDto>({ url: `/api/v1/orders/${orderId}/mock-pay`, method: 'POST' }),
  createServiceAreaInterest: (payload: { regionText: string; contactName: string; contactPhone: string; privacyAccepted: true; privacyVersion: string }) =>
    request<{ id: string; status: string }>({ url: '/api/v1/service-area-interests', method: 'POST', data: payload }),
  createAfterSale: (orderId: string, payload: { reason: string; description: string }) =>
    request<{ id: string; status: string }>({ url: `/api/v1/orders/${encodeURIComponent(orderId)}/after-sales`, method: 'POST', data: payload }),
  createFulfillmentClaim: (orderId: string, payload: { clientRequestId:string; items: Array<{ platformSkuId:string; quantity:number; reason:'PICKUP_SHORTAGE'|'PICKUP_DAMAGE'|'QUALITY_CLAIM'; description:string; evidenceUrl:null }> }) =>
    request<{ id:string; status:string }>({ url: `/api/v1/orders/${encodeURIComponent(orderId)}/fulfillment-claims`, method: 'POST', data: payload }),
  createCommunityQualityCase: (orderId: string, payload: { clientRequestId:string; items: Array<{ platformSkuId:string; quantity:number; reason:'PICKUP_SHORTAGE'|'PICKUP_DAMAGE'|'QUALITY_CLAIM'; description:string }> }) =>
    request<{ id:string; status:string }>({ url: `/api/v1/orders/${encodeURIComponent(orderId)}/community-quality-cases`, method: 'POST', data: payload }),
  listAfterSales: () => request<Array<{ id: string; orderId: string; reason: string; description: string; status: string; resolutionType: 'FULL_REFUND'|'REJECTED'|null; refundAmountCents: number|null; resolutionNote: string|null; resolvedAt: string|null; createdAt: string }>>({ url: '/api/v1/after-sales', method: 'GET' }),
  listNotifications: () => request<Array<{ id: string; orderId: string; type: string; title: string; content: string; status: string; readAt: string | null; createdAt: string }>>({ url: '/api/v1/notifications', method: 'GET' }),
  markNotificationRead: (id: string) => request<unknown>({ url: `/api/v1/notifications/${encodeURIComponent(id)}/read`, method: 'POST' }),
  saveNotificationPreferences: (types: Array<'SITE_CONFIRMED' | 'VEHICLE_DISPATCHED' | 'ARRIVED' | 'PARTIAL_REFUND' | 'PICKUP_DEADLINE' | 'PICKUP_EXPIRED'>) => request<unknown>({ url: '/api/v1/notification-preferences', method: 'POST', data: { types } }),
};

export const customerAuth = {
  isWechatMode: () => app.globalData.authMode === 'wechat',
  isLoggedIn: () => app.globalData.authMode === 'wechat'
    ? Boolean(app.globalData.accessToken ?? wx.getStorageSync<string>('accessToken')) && wx.getStorageSync<string>(PRIVACY_CONSENT_VERSION_KEY) === PRIVACY_NOTICE_VERSION
    : hasDemoCustomerSession(),
  async login(privacyVersion: string): Promise<void> {
    if (privacyVersion !== PRIVACY_NOTICE_VERSION) throw new Error('请先阅读并同意最新隐私说明');
    if (app.globalData.authMode === 'wechat') await ensureAccessToken(false, privacyVersion);
    else {
      wx.setStorageSync(DEMO_CUSTOMER_SESSION_KEY, true);
      wx.setStorageSync(PRIVACY_CONSENT_VERSION_KEY, privacyVersion);
    }
  },
  async logout(): Promise<void> {
    if (app.globalData.authMode === 'demo') { wx.removeStorageSync(DEMO_CUSTOMER_SESSION_KEY); return; }
    const token = app.globalData.accessToken ?? wx.getStorageSync<string>('accessToken');
    if (token) await new Promise<void>((resolve) => { wx.request({ url: `${app.globalData.apiBaseUrl}/api/v1/auth/logout`, method: 'POST', header: { authorization: `Bearer ${token}` }, complete: () => resolve() }); });
    app.globalData.accessToken = null;
    wx.removeStorageSync('accessToken');
  },
};
