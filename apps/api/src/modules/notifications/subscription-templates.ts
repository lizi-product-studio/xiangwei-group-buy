import type { OrderNotificationType } from '../core/types.js';

export const subscriptionGroups = ['SITE', 'DISPATCH', 'ARRIVAL', 'DEADLINE', 'PARTIAL_REFUND'] as const;
export type SubscriptionGroup = typeof subscriptionGroups[number];
export function subscriptionGroup(type: OrderNotificationType): SubscriptionGroup {
  if (type === 'VEHICLE_DISPATCHED') return 'DISPATCH';
  if (type === 'ARRIVED') return 'ARRIVAL';
  if (type === 'PICKUP_DEADLINE') return 'DEADLINE';
  if (type === 'PARTIAL_REFUND') return 'PARTIAL_REFUND';
  return 'SITE';
}

/** Account template keys reviewed in TASK-20260907-HOUSEKEEPING-REPLACE. */
export const subscriptionData = {
  SITE: { character_string11: '{{orderNo}}', time2: '{{changedAt}}', phrase3: '{{changeResult}}', phrase5: '{{orderStatus}}', thing7: '{{hint}}' },
  DISPATCH: { character_string1: '{{orderNo}}', thing2: '{{goodsName}}', thing5: '{{orderStatus}}', thing19: '{{siteName}}', thing17: '{{hint}}' },
  PARTIAL_REFUND: { amount1: '{{refundAmount}}', character_string2: '{{orderNo}}', character_string3: '{{refundNo}}', thing4: '原路退回', thing5: '{{hint}}' },
  ARRIVAL: { character_string1: '{{orderNo}}', thing2: '{{goodsName}}', thing3: '{{siteName}}', date8: '{{pickupDeadlineDate}}', number10: '{{pickupCode}}' },
  DEADLINE: { character_string1: '{{orderNo}}', time3: '{{pickupDeadlineTime}}', thing4: '{{hint}}' },
} satisfies Record<SubscriptionGroup, Record<string, string>>;

/** Fail closed for stale four-template mappings and unknown/misbound fields. */
export function assertSubscriptionData(group: SubscriptionGroup, template: string): void {
  const parsed: unknown = JSON.parse(template);
  const expected = subscriptionData[group];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.keys(parsed).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, value]) => (parsed as Record<string, unknown>)[key] !== value))
    throw new Error(`${group} 订阅模板字段映射与五模板契约不一致`);
}

export function chinaTime(value: string, dateOnly = false): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('通知时间缺失或无效');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (key: string) => parts.find((item) => item.type === key)!.value;
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  return dateOnly ? day : `${day} ${part('hour')}:${part('minute')}:${part('second')}`;
}

/** Conservative limits; actual account category/date/phrase acceptance needs live QA. */
export function validateSubscriptionValue(key: string, value: string): string {
  if (!value || Array.from(value).some((char) => char.charCodeAt(0) < 32)) throw new Error(`通知字段 ${key} 为空或含控制字符`);
  if (key.startsWith('thing')) {
    const chars = Array.from(value.trim());
    if (!chars.length) throw new Error(`通知字段 ${key} 为空`);
    return chars.length > 20 ? chars.slice(0, 19).join('') + '…' : chars.join('');
  }
  const valid = key.startsWith('character_string') ? /^[\x21-\x7e]{1,32}$/.test(value)
    : key.startsWith('number') ? /^\d{1,32}$/.test(value)
    : key.startsWith('phrase') ? /^[\p{Script=Han}]{1,5}$/u.test(value)
    : key.startsWith('amount') ? /^\d{1,10}\.\d{2}$/.test(value)
    : key.startsWith('date') ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    : key.startsWith('time') ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) : false;
  if (!valid) throw new Error(`通知字段 ${key} 类型或长度不合法`);
  return value;
}
