import { randomUUID } from "node:crypto";
import { BusinessError } from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";
import type {
  DeliveryPlan,
  OrderNotification,
  OrderNotificationType,
} from "../core/types.js";
import type { SubscriptionMessageProvider } from "./wechat-subscription-provider.js";
import { operationalErrorText } from "../core/operational-error.js";
import type {
  NotificationCampaignEnqueueStore,
  NotificationOrderEnqueueStore,
} from "./notification-store.js";
import type { NotificationPreference } from "../core/types.js";

const paidOrderStatuses = new Set([
  "PAID_WAITING_CLOSE",
  "LOCKED",
  "ALLOCATING",
  "IN_TRANSIT",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "COMPLETED",
]);
const deliveryBatchLimit = 100;
const deliveryConcurrency = 5;
const deliveryTimeBudgetMs = 20_000;
// Claim one concurrency-sized wave at a time, never a full batch waiting on
// serial providers. The persisted claim and submission fences remain decisive.
const deliveryLeaseMilliseconds = 5 * 60_000;

function copy(
  type: OrderNotificationType,
  plan: DeliveryPlan,
): { title: string; content: string } {
  if (type === "SITE_CONFIRMED" && (!plan.siteName || !plan.address)) {
    return {
      title: "领取地点正在调整",
      content:
        "原领取安排正在调整中；新地点确认后会第一时间通知，请暂勿前往原地点。",
    };
  }
  if (type === "SITE_CONFIRMED")
    return {
      title: "本团领取地点已确认",
      content: `${plan.siteName ?? "集中领取点"}：${plan.address ?? "请在订单中查看详细安排"}。`,
    };
  if (type === "VEHICLE_DISPATCHED")
    return {
      title: "本团货物已发车",
      content: `货物正运往${plan.siteName ?? "本团集中领取点"}，到货后会生成取货码。`,
    };
  if (type === "PARTIAL_REFUND")
    return {
      title: "部分商品异常退款已处理",
      content:
        "部分商品因缺货或履约异常已按订单快照价原路退款；其余可领取商品不受影响，请在订单详情查看数量和进度。",
    };
  if (type === "PICKUP_DEADLINE")
    return {
      title: "领取期限即将截止",
      content:
        "您的社区团订单即将超过领取期限；如确有困难，请联系领取点运营人员申请一次延期。",
    };
  if (type === "PICKUP_EXPIRED")
    return {
      title: "订单领取期限已到",
      content:
        "该订单已进入逾期待处理，取货码已失效；运营人员将联系您确认延期、退款或报损处理结果。",
    };
  if (type === "CAMPAIGN_POSTPONED")
    return {
      title: "团期时间已顺延",
      content:
        "本团截单或发车安排已调整，请在订单中查看最新履约安排；到货后会通知您。",
    };
  return {
    title: "货物已到，请领取",
    content: `${plan.siteName ?? "本团集中领取点"}已到货，请打开订单查看六码取货码和领取安排。`,
  };
}

/** Durable notification outbox. Request paths enqueue only; a worker drains delivery later. */
export class NotificationService {
  public constructor(
    private readonly store: CommerceStore,
    private readonly provider: SubscriptionMessageProvider,
  ) {}

  private samePreferenceSnapshot(
    current: NotificationPreference | null,
    snapshot: NotificationPreference | null,
  ): boolean {
    if (!current || !snapshot || current.updatedAt !== snapshot.updatedAt) return false;
    if (current.types.length !== snapshot.types.length || current.types.some((type, index) => type !== snapshot.types[index])) return false;
    const currentTemplates = Object.entries(current.templateIds ?? {}).sort(([left], [right]) => left.localeCompare(right));
    const snapshotTemplates = Object.entries(snapshot.templateIds ?? {}).sort(([left], [right]) => left.localeCompare(right));
    return currentTemplates.length === snapshotTemplates.length && currentTemplates.every(([key, value], index) => snapshotTemplates[index]?.[0] === key && snapshotTemplates[index]?.[1] === value);
  }

  private async markSentAndConsumeSuccessfulTemplate(
    notificationId: string,
    attemptId: string,
    userId: string,
    templateId: string | undefined,
    snapshot: NotificationPreference | null,
  ): Promise<void> {
    await this.store.transaction(async (store) => {
      const marked = await store.markOrderNotificationSentIfSubmission(notificationId, attemptId, null);
      if (!marked || !templateId || !snapshot || !this.provider.templateIdFor) return;
      const currentPreference = await store.getNotificationPreference(userId);
      if (!currentPreference || !this.samePreferenceSnapshot(currentPreference, snapshot)) return;
      const remainingTypes = currentPreference.types.filter((type) => this.provider.templateIdFor!(type) !== templateId);
      const remainingTemplateIds = Object.fromEntries(Object.entries(currentPreference.templateIds ?? {}).filter(([, value]) => value !== templateId));
      await store.saveNotificationPreference({
        userId,
        types: remainingTypes,
        templateIds: remainingTemplateIds,
        updatedAt: await store.databaseNow(),
      });
    });
  }

  public async notifyCampaign(
    type: OrderNotificationType,
    campaignId: string,
    plan: DeliveryPlan,
    eventKey: string,
  ): Promise<void> {
    await this.enqueueCampaign(this.store, type, campaignId, plan, eventKey);
  }

  /**
   * Enqueue using the caller's transaction.  This is the path used by fulfilment
   * state transitions so an arrival/dispatch cannot commit without its outbox rows.
   */
  public async enqueueCampaign(
    store: NotificationCampaignEnqueueStore,
    type: OrderNotificationType,
    campaignId: string,
    plan: DeliveryPlan,
    eventKey: string,
  ): Promise<void> {
    const orders = await store.listOrdersByCampaign(campaignId);
    for (const order of orders) {
      if (!paidOrderStatuses.has(order.status)) continue;
      if (type === "ARRIVED" && order.status !== "READY_FOR_PICKUP") continue;
      await this.enqueueOrder(
        store,
        type,
        order.id,
        plan,
        `${eventKey}:${order.id}`,
      );
    }
  }

  /** Enqueues an order-specific event without exposing it to other group members. */
  public async enqueueOrder(
    store: NotificationOrderEnqueueStore,
    type: OrderNotificationType,
    orderId: string,
    plan: DeliveryPlan,
    eventKey: string,
    refundId?: string,
  ): Promise<void> {
    const order = await store.getOrder(orderId);
    if (!order || !paidOrderStatuses.has(order.status)) return;
    if (type === "ARRIVED" && order.status !== "READY_FOR_PICKUP") return;
    const preference = await store.getNotificationPreference(order.userId);
    const requiredTemplate = this.provider.templateIdFor?.(type);
    const authorised = (preference?.types.includes(type) ?? false) &&
      (!this.provider.templateIdFor || !!requiredTemplate && preference?.templateIds?.[type] === requiredTemplate);
    const message = copy(type, plan);
    const now = new Date().toISOString();
    await store.createOrderNotificationIfAbsent({
      id: randomUUID(),
      eventKey,
      ...(refundId ? { refundId } : {}),
      ...(type === "SITE_CONFIRMED" ? { siteConfirmed: !!plan.siteName && !!plan.address } : {}),
      userId: order.userId,
      orderId: order.id,
      type,
      title: message.title,
      content: message.content,
      status: authorised ? "PENDING_DELIVERY" : "MANUAL_REQUIRED",
      readAt: null,
      manualCompletedAt: null,
      manualCompletedBy: null,
      manualCompletionNote: null,
      manualCompletionChannel: null,
      manualCompletionExternalReference: null,
      manualCompletionResult: null,
      createdAt: now,
      deliveryAttempts: 0,
      nextAttemptAt: authorised ? now : null,
      deliveryLeaseUntil: null,
      deliveryClaimToken: null,
      providerSubmissionAttemptId: null,
      providerSubmissionStartedAt: null,
      providerResultRecordedAt: null,
      providerReceiptId: null,
      submissionUnknownReason: null,
      lastDeliveryError: null,
      deliveredAt: null,
    });
  }

  /** Claims and sends bounded outbox work; safe to invoke concurrently from multiple API instances. */
  public async drainPending(limit = 100): Promise<number> {
    const requestedLimit = Number.isFinite(limit)
      ? Math.trunc(limit)
      : deliveryBatchLimit;
    const safeLimit = Math.max(1, Math.min(deliveryBatchLimit, requestedLimit));
    const deadline = Date.now() + deliveryTimeBudgetMs;
    let attempted = 0;
    while (attempted < safeLimit && Date.now() < deadline) {
      const claimToken = randomUUID();
      const claimed = await this.store.claimPendingOrderNotifications(
        Math.min(deliveryConcurrency, safeLimit - attempted),
        deliveryLeaseMilliseconds,
        claimToken,
      );
      if (!claimed.length) break;
      attempted += claimed.length;
      // Settle every in-flight attempt before returning, even if one DB write
      // fails; the caller must never release ownership while work continues.
      const outcomes = await Promise.allSettled(claimed.map(notification => this.deliver(notification, claimToken, deadline)));
      const failed = outcomes.find((value): value is PromiseRejectedResult => value.status === "rejected");
      if (failed) throw failed.reason;
    }
    return attempted;
  }

  private async deliver(
    notification: OrderNotification,
    claimToken: string,
    deadline = Number.POSITIVE_INFINITY,
  ): Promise<void> {
    if (notification.deliveryClaimToken !== claimToken) return;
    // These reads are entirely local prerequisites. A failure here is known to
    // be before submission, so it may safely return to the human retry queue.
    const prerequisites = await this.store.readSnapshot(async (store) => {
      const order = await store.getOrder(notification.orderId);
      const plan = order ? await store.getDeliveryPlan(order.deliveryPlanId) : null;
      const user = await store.getUser(notification.userId);
      if (!order || !plan || !user || order.userId !== user.id) return null;
      const [window, credential, refund, preference] = await Promise.all([
        store.getCommunityPickupWindow(order.id),
        store.getPickupCredential(order.id),
        notification.refundId ? store.getPartialRefund(notification.refundId) : Promise.resolve(null),
        store.getNotificationPreference(user.id),
      ]);
      return { order, plan, user, window, credential, refund, preference };
    });
    if (!prerequisites) {
      notification.status = "MANUAL_REQUIRED";
      notification.nextAttemptAt = null;
      notification.deliveryLeaseUntil = null;
      notification.deliveryClaimToken = null;
      notification.lastDeliveryError =
        "notification delivery dependencies are missing";
      await this.store.saveOrderNotificationIfClaimed(notification, claimToken);
      return;
    }

    const { order, plan, user, preference, window, credential, refund } = prerequisites;
    const input = { user, notification, plan, order, window, credential, refund };
    let templateId: string | undefined;
    let preferenceSnapshot: NotificationPreference | null = null;
    try {
      templateId = this.provider.templateIdFor?.(notification.type);
      preferenceSnapshot = preference ? {
        ...preference,
        types: [...preference.types],
        ...(preference.templateIds ? { templateIds: { ...preference.templateIds } } : {}),
      } : null;
      if (this.provider.templateIdFor && (!templateId || !preference?.types.includes(notification.type) || preference.templateIds?.[notification.type] !== templateId))
        throw new Error('当前模板尚未获得用户授权，请重新订阅');
      this.provider.prepare?.(input);
    } catch (error) {
      notification.status = 'MANUAL_REQUIRED';
      notification.nextAttemptAt = null;
      notification.deliveryLeaseUntil = null;
      notification.deliveryClaimToken = null;
      notification.lastDeliveryError = operationalErrorText(error);
      await this.store.saveOrderNotificationIfClaimed(notification, claimToken);
      return;
    }

    if (Date.now() >= deadline) {
      // Still before submission: release only our claim, safely leaving it due.
      notification.deliveryLeaseUntil = null;
      notification.deliveryClaimToken = null;
      await this.store.saveOrderNotificationIfClaimed(notification, claimToken);
      return;
    }
    const attemptId = randomUUID();
    // This short transaction fences the provider call but never encloses it.
    // Once it succeeds the durable state is SUBMISSION_UNKNOWN: a crashed or
    // partitioned worker may lose a message, but can never send it twice.
    const submission = await this.store.transaction((store) =>
      store.beginOrderNotificationSubmission({
        id: notification.id,
        claimToken,
        attemptId,
      }),
    );
    if (!submission || submission.providerSubmissionAttemptId !== attemptId)
      return;
    try {
      const remaining = Math.max(0, deadline - Date.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (remaining === 0) throw new Error("notification delivery time budget elapsed before provider call");
        const sending = this.provider.send({ ...input, notification: submission });
        if (Number.isFinite(remaining)) {
          await Promise.race([sending, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("notification delivery time budget exceeded; submission result unknown")), remaining);
          })]);
        } else await sending;
      } finally {
        if (timer) clearTimeout(timer);
      }
      await this.markSentAndConsumeSuccessfulTemplate(submission.id, attemptId, user.id, templateId, preferenceSnapshot);
    } catch (error) {
      // Any provider-side ambiguity stays UNKNOWN. Without a stable provider
      // idempotency key plus a reliable query contract, retrying would violate
      // the at-most-once guarantee.
      await this.store.transaction((store) =>
        store.recordSubmissionUnknownIfSubmission(
          submission.id,
          attemptId,
          operationalErrorText(error),
        ),
      );
    }
  }

  /**
   * Requeues only an explicitly escalated notification.  A message which is
   * already deliverable, sent, in-app, or manually completed is a different
   * durable fact and must never be turned back into a provider delivery.
   */
  public async retryPending(id: string): Promise<OrderNotification> {
    return this.store.transaction(async (store) => {
      const before = await store.getOrderNotification(id);
      if (!before)
        throw new BusinessError("RESOURCE_NOT_FOUND", "通知不存在", 404);
      if (
        before.status !== "MANUAL_REQUIRED" ||
        before.providerSubmissionStartedAt !== null
      )
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "只有需要人工处理的通知可以重新进入系统重试",
          409,
        );
      const notification = await store.requeuePendingOrderNotification(
        id,
        await store.databaseNow(),
      );
      // The transaction serialises MemoryStore and holds the MySQL aggregate
      // lock. This fence makes a second concurrent click observe the first
      // transition rather than scheduling a duplicate provider delivery.
      if (!notification || notification.status !== "PENDING_DELIVERY")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "通知状态已变化，请刷新后重试",
          409,
        );
      return notification;
    });
  }
}
