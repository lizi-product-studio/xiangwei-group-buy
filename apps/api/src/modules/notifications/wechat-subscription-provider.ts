import type { AppConfig } from '../../config.js';
import type { DeliveryPlan, OrderNotification, OrderNotificationType, User, Order, CommunityPickupWindow, PickupCredential, PartialRefund } from '../core/types.js';

import { assertSubscriptionData, chinaTime, subscriptionGroup, validateSubscriptionValue } from './subscription-templates.js';
import { matchesPickupCode, pickupCode } from '../fulfillment/pickup-code.js';

export interface SubscriptionInput {
  user: User; notification: OrderNotification; plan: DeliveryPlan;
  order?: Order; window?: CommunityPickupWindow | null;
  credential?: PickupCredential | null; refund?: PartialRefund | null;
}
export interface SubscriptionMessageProvider {
  send(input: SubscriptionInput): Promise<void>;
  prepare?(input: SubscriptionInput): void;
  templateIdFor?(type: OrderNotificationType): string | undefined;
}

type TemplateDefinition = { templateId: string | undefined; dataTemplate: string | undefined };
type WechatReply = { errcode?: number; errmsg?: string };

function isPlainReply(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readReply(response: Response, operation: string): Promise<Record<string, unknown>> {
  if (!response.ok)
    throw new Error(`${operation}网络错误：${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${operation}返回不是有效 JSON`);
  }
  if (!isPlainReply(body))
    throw new Error(`${operation}返回格式无效`);
  return body;
}

function replyErrorCode(body: Record<string, unknown>, operation: string): number | undefined {
  if (!("errcode" in body)) return undefined;
  if (typeof body.errcode !== "number" || !Number.isFinite(body.errcode))
    throw new Error(`${operation}返回 errcode 格式无效`);
  return body.errcode;
}

function replyMessage(body: Record<string, unknown>): string {
  return typeof body.errmsg === "string" ? body.errmsg : "";
}

const eventTemplate = (config: AppConfig, type: OrderNotificationType): TemplateDefinition => {
  const group = subscriptionGroup(type);
  return { templateId: config[`WECHAT_SUBSCRIBE_${group}_TEMPLATE_ID`], dataTemplate: config[`WECHAT_SUBSCRIBE_${group}_TEMPLATE_DATA`] };
};

function templateValues(input: SubscriptionInput, secret: string): Record<string, string> {
  const { notification, plan, order, user, window, credential, refund } = input;
  if (!order || order.id !== notification.orderId || order.userId !== user.id || notification.userId !== user.id || order.deliveryPlanId !== plan.id)
    throw new Error('通知订单或用户归属不匹配');
  if (notification.type === 'SITE_CONFIRMED' && typeof notification.siteConfirmed !== 'boolean') throw new Error('地点通知缺少发生时的确认事实');
  const states: Record<string, string> = { PENDING_PAYMENT: '待支付', PAID_WAITING_CLOSE: '待成团', LOCKED: '待配货', ALLOCATING: '配货中', IN_TRANSIT: '运输中', READY_FOR_PICKUP: '待领取', PICKED_UP: '已领取', COMPLETED: '已完成', REFUNDING: '退款中', REFUNDED: '已退款', CANCELLED: '已取消' };
  const values: Record<string, string> = {
    orderNo: order.orderNo, changedAt: chinaTime(notification.createdAt),
    changeResult: notification.type === 'PICKUP_EXPIRED' ? '已逾期' : notification.type === 'CAMPAIGN_POSTPONED' ? '已顺延' : notification.siteConfirmed ? '已确认' : '调整中',
    orderStatus: states[order.status] ?? '', goodsName: order.items.map((item) => item.name).join('、'),
    siteName: plan.siteName ?? '', hint: notification.title,
  };
  if (notification.type === 'ARRIVED' || notification.type === 'PICKUP_DEADLINE') {
    if (!window || window.orderId !== order.id || window.deliveryPlanId !== plan.id || !['ACTIVE', 'EXTENDED'].includes(window.status) || Date.parse(window.deadlineAt) <= Date.now())
      throw new Error('领取窗口缺失、已失效或不属于通知订单');
    if (notification.type === 'PICKUP_DEADLINE' && (notification.eventKey !== `pickup-deadline:${order.id}:${window.deadlineAt}` || Date.parse(window.deadlineAt) - Date.now() > 24 * 60 * 60_000))
      throw new Error('截止提醒事件已过时，请按当前领取窗口处理');
    values.pickupDeadlineDate = chinaTime(window.deadlineAt);
    values.pickupDeadlineTime = chinaTime(window.deadlineAt);
    if (notification.type === 'ARRIVED') {
      const code = pickupCode(order.id, secret);
      if (order.status !== 'READY_FOR_PICKUP' || !credential || credential.orderId !== order.id || credential.status !== 'ACTIVE' || Date.parse(credential.expiresAt) <= Date.now() || !matchesPickupCode(code, credential.codeHash, secret))
        throw new Error('已有取货凭证不能安全表示为当前数字码，请人工联系并保留原凭证');
      values.pickupCode = code;
    }
  }
  if (notification.type === 'PICKUP_EXPIRED' && (!window || window.orderId !== order.id || window.deliveryPlanId !== plan.id || window.status !== 'EXPIRED_PENDING' || Date.parse(window.deadlineAt) >= Date.now() || notification.eventKey !== `pickup-expired:${order.id}:${window.deadlineAt}`))
    throw new Error('逾期提醒事件已失效，当前订单不再处于该逾期窗口');
  if (notification.type === 'PARTIAL_REFUND') {
    if (!notification.refundId || !refund || refund.id !== notification.refundId || refund.orderId !== order.id || refund.status !== 'SUCCEEDED' || !Number.isSafeInteger(refund.amountCents) || refund.amountCents <= 0)
      throw new Error('通知缺少对应的实际成功退款，需人工核对');
    values.refundAmount = (refund.amountCents / 100).toFixed(2);
    if (!refund.providerRefundId) throw new Error('成功退款缺少微信退款单号，需人工核对');
    values.refundNo = refund.providerRefundId;
  }
  return values;
}

function renderData(template: string, values: Record<string, string>): Record<string, { value: string }> {
  const parsed = JSON.parse(template) as Record<string, string>;
  return Object.fromEntries(Object.entries(parsed).map(([key, text]) => {
    const value = text.replace(/{{(\w+)}}/g, (_, token: string) => {
      if (!(token in values)) throw new Error(`通知变量 ${token} 缺失`);
      return values[token]!;
    });
    return [key, { value: validateSubscriptionValue(key, value) }];
  }));
}

/** Intentionally fails closed: the caller immediately creates a manual-contact task. */
export class DisabledSubscriptionMessageProvider implements SubscriptionMessageProvider {
  public async send(): Promise<void> { throw new Error('微信订阅消息尚未配置'); }
}

export class WechatSubscriptionMessageProvider implements SubscriptionMessageProvider {
  private accessToken: { value: string; expiresAt: number } | null = null;

  public constructor(private readonly config: AppConfig) {}

  public templateIdFor(type: OrderNotificationType): string | undefined {
    return eventTemplate(this.config, type).templateId;
  }
  public prepare(input: SubscriptionInput): void { this.payload(input); }
  private payload(input: SubscriptionInput) {
    if (!input.user.wechatOpenId) throw new Error('用户没有可用的微信身份');
    const template = eventTemplate(this.config, input.notification.type);
    if (!template.templateId || !template.dataTemplate) throw new Error('当前提醒类型尚未配置微信模板');
    assertSubscriptionData(subscriptionGroup(input.notification.type), template.dataTemplate);
    return { template, data: renderData(template.dataTemplate, templateValues(input, this.config.PICKUP_CODE_SECRET)) };
  }
  public async send(input: SubscriptionInput): Promise<void> {
    const { template, data } = this.payload(input);
    const response = await this.call(template.templateId!, {
      touser: input.user.wechatOpenId,
      template_id: template.templateId,
      page: `pages/order-detail/index?id=${encodeURIComponent(input.notification.orderId)}`,
      miniprogram_state: this.config.WECHAT_SUBSCRIBE_MINIPROGRAM_STATE,
      lang: 'zh_CN',
      data: data,
    });
    if (response.errcode !== 0)
      throw new Error(
        `微信订阅消息发送失败：${response.errcode} ${response.errmsg ?? ""}`.trim(),
      );
  }

  private async call(templateId: string, payload: Record<string, unknown>, retried = false): Promise<WechatReply> {
    const token = await this.getAccessToken();
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8_000),
    });
    const raw = await readReply(response, "微信订阅消息");
    const errcode = replyErrorCode(raw, "微信订阅消息");
    if (errcode === undefined)
      throw new Error("微信订阅消息返回缺少 errcode");
    const message = replyMessage(raw);
    const body: WechatReply = message
      ? { errcode, errmsg: message }
      : { errcode };
    if (!retried && (errcode === 40001 || errcode === 42001)) {
      this.accessToken = null;
      return this.call(templateId, payload, true);
    }
    void templateId;
    return body;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    if (!this.config.WECHAT_APP_ID || !this.config.WECHAT_APP_SECRET) throw new Error('微信应用凭据尚未配置');
    const params = new URLSearchParams({ grant_type: 'client_credential', appid: this.config.WECHAT_APP_ID, secret: this.config.WECHAT_APP_SECRET });
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${params.toString()}`, { signal: AbortSignal.timeout(8_000) });
    const raw = await readReply(response, "微信访问令牌");
    const errcode = replyErrorCode(raw, "微信访问令牌");
    const accessToken = raw.access_token;
    const expiresIn = raw.expires_in;
    if (
      errcode !== undefined && errcode !== 0 ||
      typeof accessToken !== "string" || !accessToken.trim() ||
      expiresIn !== undefined &&
        (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0)
    )
      throw new Error(
        `微信访问令牌获取失败：${errcode ?? "invalid_response"} ${replyMessage(raw)}`.trim(),
      );
    this.accessToken = { value: accessToken, expiresAt: Date.now() + Math.max(60, (expiresIn ?? 7_200) - 120) * 1_000 };
    return this.accessToken.value;
  }
}
