import type { AppConfig } from '../../config.js';
import type { DeliveryPlan, OrderNotification, OrderNotificationType, User } from '../core/types.js';

export interface SubscriptionMessageProvider {
  send(input: { user: User; notification: OrderNotification; plan: DeliveryPlan }): Promise<void>;
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
  if (type === 'SITE_CONFIRMED') return { templateId: config.WECHAT_SUBSCRIBE_SITE_TEMPLATE_ID, dataTemplate: config.WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA };
  if (type === 'CAMPAIGN_POSTPONED') return { templateId: config.WECHAT_SUBSCRIBE_SITE_TEMPLATE_ID, dataTemplate: config.WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA };
  if (type === 'VEHICLE_DISPATCHED') return { templateId: config.WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_ID, dataTemplate: config.WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_DATA };
  if (type === 'PARTIAL_REFUND') return { templateId: config.WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_ID, dataTemplate: config.WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_DATA };
  // Arrival and pickup-window events share one approved pickup-arrangement
  // template. The semantic event type remains distinct in preferences/audit.
  if (type === 'PICKUP_DEADLINE' || type === 'PICKUP_EXPIRED') return { templateId: config.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_ID, dataTemplate: config.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA };
  return { templateId: config.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_ID, dataTemplate: config.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA };
};

const templateValues = (notification: OrderNotification, plan: DeliveryPlan): Record<string, string> => ({
  title: notification.title,
  content: notification.content,
  siteName: plan.siteName ?? '',
  address: plan.address ?? '',
  arrivalStartAt: plan.arrivalStartAt ?? '',
  arrivalEndAt: plan.arrivalEndAt ?? '',
});

function renderData(template: string, values: Record<string, string>): Record<string, { value: string }> {
  const parsed = JSON.parse(template) as Record<string, string>;
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, {
    value: value.replace(/{{(title|content|siteName|address|arrivalStartAt|arrivalEndAt)}}/g, (_, token: string) => values[token] ?? ''),
  }]));
}

/** Intentionally fails closed: the caller immediately creates a manual-contact task. */
export class DisabledSubscriptionMessageProvider implements SubscriptionMessageProvider {
  public async send(): Promise<void> { throw new Error('微信订阅消息尚未配置'); }
}

export class WechatSubscriptionMessageProvider implements SubscriptionMessageProvider {
  private accessToken: { value: string; expiresAt: number } | null = null;

  public constructor(private readonly config: AppConfig) {}

  public async send(input: { user: User; notification: OrderNotification; plan: DeliveryPlan }): Promise<void> {
    if (!input.user.wechatOpenId) throw new Error('用户没有可用的微信身份');
    const template = eventTemplate(this.config, input.notification.type);
    if (!template.templateId || !template.dataTemplate) throw new Error('当前提醒类型尚未配置微信模板');
    const response = await this.call(template.templateId, {
      touser: input.user.wechatOpenId,
      template_id: template.templateId,
      page: `pages/order-detail/index?id=${encodeURIComponent(input.notification.orderId)}`,
      miniprogram_state: this.config.NODE_ENV === 'production' ? 'formal' : 'trial',
      lang: 'zh_CN',
      data: renderData(template.dataTemplate, templateValues(input.notification, input.plan)),
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
