import { describe, expect, it } from "vitest";
import { MemoryStore } from "../core/store.js";
import type { DeliveryPlan, Order, OrderNotification, OrderNotificationType, User } from "../core/types.js";
import { NotificationService } from "./notification-service.js";
import type { SubscriptionInput, SubscriptionMessageProvider } from "./wechat-subscription-provider.js";

const timestamp = "2026-09-23T00:00:00.000Z";
const user: User = { id: "user", wechatOpenId: "openid", status: "ACTIVE", createdAt: timestamp };
const order: Order = {
  id: "order", orderNo: "ORDER", userId: user.id, campaignId: "campaign", serviceAreaId: "area",
  pickupPointId: "point", deliveryPlanId: "plan", status: "READY_FOR_PICKUP", totalCents: 100,
  items: [], createdAt: timestamp, expiresAt: timestamp, paidAt: timestamp, pickedUpAt: null,
};
const plan: DeliveryPlan = {
  id: "plan", campaignId: "campaign", serviceAreaId: "area", pickupPointId: "point", status: "ARRIVED",
  siteName: "点位", address: "地址", arrivalStartAt: null, arrivalEndAt: null, contactName: null,
  contactPhone: null, vehicleOrderNo: null, driverName: null, driverPhone: null, vehiclePlate: null,
  logisticsPlatform: null, estimatedArrivalAt: null, remark: null, confirmedAt: timestamp,
  bookedAt: null, dispatchedAt: null, arrivedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
};
const notification = (type: OrderNotificationType = "ARRIVED"): OrderNotification => ({
  id: `notification-${type}`, eventKey: `event-${type}`, userId: user.id, orderId: order.id, type,
  title: "提醒", content: "提醒内容", status: "PENDING_DELIVERY", readAt: null,
  manualCompletedAt: null, manualCompletedBy: null, manualCompletedNote: null, manualCompletionChannel: null,
  manualCompletionExternalReference: null, manualCompletionResult: null, createdAt: timestamp,
  deliveryAttempts: 0, nextAttemptAt: timestamp, deliveryLeaseUntil: null, deliveryClaimToken: null,
  providerSubmissionAttemptId: null, providerSubmissionStartedAt: null, providerResultRecordedAt: null,
  providerReceiptId: null, submissionUnknownReason: null, lastDeliveryError: null, deliveredAt: null,
});

class FakeProvider implements SubscriptionMessageProvider {
  public constructor(
    private readonly ids: Partial<Record<OrderNotificationType, string>>,
    private readonly onSend?: (input: SubscriptionInput) => Promise<void>,
  ) {}
  public templateIdFor(type: OrderNotificationType): string | undefined { return this.ids[type]; }
  public async send(input: SubscriptionInput): Promise<void> { await this.onSend?.(input); }
}

async function fixture(provider: SubscriptionMessageProvider) {
  const store = new MemoryStore(false);
  await store.saveUser(user);
  await store.saveOrder(order);
  await store.saveDeliveryPlan(plan);
  const service = new NotificationService(store, provider);
  return { store, service };
}

describe("notification preference consumption", () => {
  it("consumes every event mapped to the successful shared template in one transaction", async () => {
    const { store, service } = await fixture(new FakeProvider({ ARRIVED: "shared", PICKUP_DEADLINE: "shared", SITE_CONFIRMED: "other" }));
    await store.createOrderNotificationIfAbsent(notification());
    await store.saveNotificationPreference({
      userId: user.id,
      types: ["ARRIVED", "PICKUP_DEADLINE", "SITE_CONFIRMED"],
      templateIds: { ARRIVED: "shared", PICKUP_DEADLINE: "shared", SITE_CONFIRMED: "other" },
      updatedAt: timestamp,
    });
    await service.drainPending();
    expect(await store.getNotificationPreference(user.id)).toMatchObject({
      types: ["SITE_CONFIRMED"],
      templateIds: { SITE_CONFIRMED: "other" },
    });
    expect((await store.getOrderNotification("notification-ARRIVED"))?.status).toBe("WECHAT_SENT");
  });

  it.each(["reauthorize", "close"] as const)("does not overwrite a %s preference change made while sending", async (action) => {
    const holder: { store?: MemoryStore } = {};
    const provider = new FakeProvider({ ARRIVED: "shared" }, async () => {
      await holder.store!.saveNotificationPreference(action === "close"
        ? { userId: user.id, types: [], templateIds: {}, updatedAt: `${timestamp}-new` }
        : { userId: user.id, types: ["ARRIVED"], templateIds: { ARRIVED: "shared" }, updatedAt: `${timestamp}-new` });
    });
    const { store } = await fixture(provider);
    holder.store = store;
    await store.createOrderNotificationIfAbsent(notification());
    await store.saveNotificationPreference({ userId: user.id, types: ["ARRIVED"], templateIds: { ARRIVED: "shared" }, updatedAt: timestamp });
    await serviceDrain(store, provider);
    expect(await store.getNotificationPreference(user.id)).toMatchObject(action === "close"
      ? { types: [], templateIds: {} }
      : { types: ["ARRIVED"], templateIds: { ARRIVED: "shared" } });
  });

  it("leaves preference unchanged when provider delivery is unknown", async () => {
    const provider: SubscriptionMessageProvider = {
      templateIdFor: () => "shared",
      send: async () => { throw new Error("provider timeout"); },
    };
    const { store, service } = await fixture(provider);
    await store.createOrderNotificationIfAbsent(notification());
    await store.saveNotificationPreference({ userId: user.id, types: ["ARRIVED"], templateIds: { ARRIVED: "shared" }, updatedAt: timestamp });
    await service.drainPending();
    expect(await store.getNotificationPreference(user.id)).toMatchObject({ types: ["ARRIVED"], templateIds: { ARRIVED: "shared" } });
    expect((await store.getOrderNotification("notification-ARRIVED"))?.status).toBe("SUBMISSION_UNKNOWN");
  });
});

async function serviceDrain(store: MemoryStore, provider: SubscriptionMessageProvider) {
  await new NotificationService(store, provider).drainPending();
}
