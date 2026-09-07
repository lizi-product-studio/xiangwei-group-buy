import type { NotificationType, SubscriptionTemplate } from '../config/deployment';

const MAX_TEMPLATE_IDS_PER_REQUEST = 3;

export function nextSubscriptionRequest(
  templates: SubscriptionTemplate[],
  acceptedTypes: NotificationType[],
): SubscriptionTemplate[] {
  const accepted = new Set(acceptedTypes);
  const pendingIds: string[] = [];
  for (const item of templates) {
    if (accepted.has(item.type) || pendingIds.includes(item.templateId)) continue;
    pendingIds.push(item.templateId);
    if (pendingIds.length === MAX_TEMPLATE_IDS_PER_REQUEST) break;
  }
  return templates.filter((item) => pendingIds.includes(item.templateId));
}

export function mergeAcceptedSubscriptionTypes(
  current: NotificationType[],
  requested: SubscriptionTemplate[],
  result: Record<string, string>,
): NotificationType[] {
  return Array.from(
    new Set([
      ...current.filter((type) => !requested.some((item) => item.type === type)),
      ...requested
        .filter((item) => result[item.templateId] === 'accept')
        .map((item) => item.type),
    ]),
  );
}
