import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessError } from "@hometown/domain";
import { loadConfig } from "../../config.js";
import { MemoryStore } from "../core/store.js";
import type {
  DeliveryPlan,
  Order,
  OrderNotification,
  User,
} from "../core/types.js";
import { NotificationService } from "./notification-service.js";
import { WechatSubscriptionMessageProvider } from "./wechat-subscription-provider.js";

const now = () => new Date().toISOString();

const plan: DeliveryPlan = {
  id: "plan", campaignId: "campaign", serviceAreaId: "area", pickupPointId: "point",
  status: "ARRIVED", siteName: "点位", address: "地址", arrivalStartAt: null,
  arrivalEndAt: null, contactName: null, contactPhone: null, vehicleOrderNo: null,
  driverName: null, driverPhone: null, vehiclePlate: null, logisticsPlatform: null,
  estimatedArrivalAt: null, remark: null, confirmedAt: null, bookedAt: null,
  dispatchedAt: null, arrivedAt: null, createdAt: now(), updatedAt: now(),
};
const order: Order = {
  id: "order", orderNo: "NOTICE-ORDER", userId: "user", campaignId: "campaign",
  serviceAreaId: "area", pickupPointId: "point", deliveryPlanId: "plan",
  status: "READY_FOR_PICKUP", totalCents: 100, items: [], createdAt: now(),
  expiresAt: now(), paidAt: now(), pickedUpAt: null,
};

const notification = (
  status: OrderNotification["status"] = "PENDING_DELIVERY",
): OrderNotification => ({
  id: "notification", eventKey: "notice:event", userId: "user", orderId: "order",
  type: "ARRIVED", title: "到货", content: "请领取", status, readAt: null,
  manualCompletedAt: null, manualCompletedBy: null, manualCompletionNote: null,
  createdAt: now(), deliveryAttempts: 0,
  nextAttemptAt: status === "PENDING_DELIVERY" ? now() : null,
  deliveryLeaseUntil: null, deliveryClaimToken: null,
  providerSubmissionAttemptId: null, providerSubmissionStartedAt: null,
  providerResultRecordedAt: null, providerReceiptId: null,
  submissionUnknownReason: null, lastDeliveryError: null, deliveredAt: null,
});

async function fixture(withPlan = true) {
  const store = new MemoryStore(false);
  await store.saveUser({ id: "user", wechatOpenId: "openid", status: "ACTIVE", createdAt: now() });
  await store.saveOrder(order);
  if (withPlan) await store.saveDeliveryPlan(plan);
  return store;
}

const wechatConfig = () =>
  loadConfig({
    NODE_ENV: "test",
    WECHAT_APP_ID: "wechat-app-id",
    WECHAT_APP_SECRET: "wechat-secret",
    WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_ID: "arrival-template",
    WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA: '{"thing1":"{{title}}"}',
  });
const wechatUser: User = {
  id: "user",
  wechatOpenId: "openid",
  status: "ACTIVE",
  createdAt: now(),
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("notification at-most-once provider fence", () => {
  it("fences an expired worker before it can call the provider after manual retry succeeds", async () => {
    const store = await fixture();
    await store.createOrderNotificationIfAbsent(notification());
    const base = Date.now();
    const at = (offset: number) => new Date(base + offset).toISOString();
    store.setDatabaseNowForTests(at(0));
    const stale = (await store.claimPendingOrderNotifications(
      1, 1_000, "worker-a",
    ))[0]!;
    store.setDatabaseNowForTests(at(2_000));
    const current = (await store.claimPendingOrderNotifications(
      1, 1_000, "worker-b",
    ))[0]!;
    // B fails before provider submission (a local dependency validation), so
    // this is the only branch permitted to become retry-eligible again.
    current.status = "MANUAL_REQUIRED";
    current.nextAttemptAt = null;
    current.deliveryLeaseUntil = null;
    current.deliveryClaimToken = null;
    current.lastDeliveryError = "local dependency validation failed";
    expect(await store.saveOrderNotificationIfClaimed(current, "worker-b")).toBe(true);
    const service = new NotificationService(store, { send: vi.fn().mockResolvedValue(undefined) });
    await service.retryPending("notification");
    store.setDatabaseNowForTests(at(9_000));
    const claimedC = (await store.claimPendingOrderNotifications(
      1, 1_000, "worker-c",
    ))[0]!;
    const begunC = await store.beginOrderNotificationSubmission({
      id: claimedC.id, claimToken: "worker-c", attemptId: "attempt-c",
    });
    expect(begunC).toMatchObject({ status: "SUBMISSION_UNKNOWN", providerSubmissionAttemptId: "attempt-c" });
    const provider = vi.fn().mockResolvedValue(undefined);
    await provider();
    store.setDatabaseNowForTests(at(9_600));
    await store.markOrderNotificationSentIfSubmission(
      "notification", "attempt-c", null,
    );
    // A's old token and old in-memory snapshot cannot begin after C's fence.
    expect(await store.beginOrderNotificationSubmission({
      id: stale.id, claimToken: "worker-a", attemptId: "attempt-a",
    })).toBeNull();
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await store.getOrderNotification("notification"))?.status).toBe("WECHAT_SENT");
  });

  it("allows exactly one concurrent begin and never reclaims an unknown submission", async () => {
    const store = await fixture();
    await store.createOrderNotificationIfAbsent(notification());
    const claimed = (await store.claimPendingOrderNotifications(
      1, 60_000, "shared-claim",
    ))[0]!;
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.transaction((tx) =>
          tx.beginOrderNotificationSubmission({
            id: claimed.id,
            claimToken: "shared-claim",
            attemptId: `interleaving-${index}`,
          }),
        ),
      ),
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect((await store.claimPendingOrderNotifications(
      5, 60_000, "later-worker",
    ))).toEqual([]);
  });

  it("uses the store authority clock for claim and begin, not a worker's fast or slow wall clock", async () => {
    const store = await fixture();
    const oldLease = notification();
    oldLease.nextAttemptAt = "2000-01-01T00:00:00.000Z";
    await store.createOrderNotificationIfAbsent(oldLease);

    // A slow worker initially owns a 2000 lease. The authority clock then
    // advances to 2026; begin must reject even though that worker's local Date
    // could still be 2000-01-01.
    store.setDatabaseNowForTests("2000-01-01T00:00:00.000Z");
    const expiredOwner = (await store.claimPendingOrderNotifications(
      1, 60_000, "slow-owner",
    ))[0]!;
    store.setDatabaseNowForTests("2026-01-01T00:00:00.000Z");
    expect(await store.beginOrderNotificationSubmission({
      id: expiredOwner.id,
      claimToken: "slow-owner",
      attemptId: "slow-attempt",
    })).toBeNull();
    expiredOwner.status = "MANUAL_REQUIRED";
    expiredOwner.deliveryLeaseUntil = null;
    expiredOwner.deliveryClaimToken = null;
    await store.saveOrderNotificationIfClaimed(expiredOwner, "slow-owner");

    // Conversely, a valid authority-time lease is accepted without accepting
    // any caller timestamp that a fast worker could use to reject itself.
    const validLease = notification();
    validLease.id = "valid-notification";
    validLease.eventKey = "notice:valid";
    validLease.nextAttemptAt = "2026-01-01T00:00:00.000Z";
    await store.createOrderNotificationIfAbsent(validLease);
    const currentOwner = (await store.claimPendingOrderNotifications(
      1, 60_000, "current-owner",
    )).find((value) => value.id === validLease.id)!;
    const begun = await store.beginOrderNotificationSubmission({
      id: currentOwner.id,
      claimToken: "current-owner",
      attemptId: "current-attempt",
    });
    expect(begun).toMatchObject({
      status: "SUBMISSION_UNKNOWN",
      providerSubmissionStartedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("keeps provider success, timeout, network, 5xx and malformed outcomes unknown until the matching finalize", async () => {
    for (const failure of [
      new Error("timeout"), new Error("network disconnected"), new Error("provider 5xx"), new Error("malformed provider response"),
    ]) {
      const store = await fixture();
      await store.createOrderNotificationIfAbsent(notification());
      const send = vi.fn().mockRejectedValue(failure);
      const service = new NotificationService(store, { send });
      await service.drainPending();
      const value = await store.getOrderNotification("notification");
      expect(value).toMatchObject({ status: "SUBMISSION_UNKNOWN", submissionUnknownReason: failure.message });
      await service.drainPending();
      expect(send).toHaveBeenCalledTimes(1);
      await expect(service.retryPending("notification")).rejects.toBeInstanceOf(BusinessError);
    }
  });

  it("persists unknown before provider work and permits only local precondition failures to become manual retry", async () => {
    const noPlan = await fixture(false);
    await noPlan.createOrderNotificationIfAbsent(notification());
    const noProvider = vi.fn().mockResolvedValue(undefined);
    await new NotificationService(noPlan, { send: noProvider }).drainPending();
    expect(noProvider).not.toHaveBeenCalled();
    expect((await noPlan.getOrderNotification("notification"))?.status).toBe("MANUAL_REQUIRED");

    const acceptedBeforeCrash = await fixture();
    await acceptedBeforeCrash.createOrderNotificationIfAbsent(notification());
    const acceptedClaim = (await acceptedBeforeCrash.claimPendingOrderNotifications(
      1, 60_000, "worker",
    ))[0]!;
    const accepted = await acceptedBeforeCrash.beginOrderNotificationSubmission({
      id: acceptedClaim.id, claimToken: "worker", attemptId: randomUUID(),
    });
    expect(accepted?.status).toBe("SUBMISSION_UNKNOWN");
    const externalProvider = vi.fn().mockResolvedValue(undefined);
    await externalProvider(); // provider accepted, then process crashes before finalize
    const restartProvider = vi.fn().mockResolvedValue(undefined);
    await new NotificationService(acceptedBeforeCrash, { send: restartProvider }).drainPending();
    expect(externalProvider).toHaveBeenCalledTimes(1);
    expect(restartProvider).not.toHaveBeenCalled();

    const beforeSendCrash = await fixture();
    await beforeSendCrash.createOrderNotificationIfAbsent(notification());
    const claimed = (await beforeSendCrash.claimPendingOrderNotifications(
      1, 60_000, "worker",
    ))[0]!;
    const begun = await beforeSendCrash.beginOrderNotificationSubmission({
      id: claimed.id, claimToken: "worker", attemptId: randomUUID(),
    });
    const provider = vi.fn().mockResolvedValue(undefined);
    await new NotificationService(beforeSendCrash, { send: provider }).drainPending();
    expect(provider).not.toHaveBeenCalled();
    const completed = await beforeSendCrash.markOrderNotificationManualCompleted(
      "notification", "operator", "已线下核验，请勿再次发送", now(),
      {
        channel: "EXTERNAL_CRM",
        externalReference: "crm-notification-001",
        result: "USER_ACKNOWLEDGED",
      },
    );
    expect(completed).toMatchObject({
      status: "MANUAL_COMPLETED",
      providerSubmissionAttemptId: begun?.providerSubmissionAttemptId,
      providerSubmissionStartedAt: begun?.providerSubmissionStartedAt,
    });
    expect(await beforeSendCrash.markOrderNotificationSentIfSubmission(
      "notification", "wrong-old-attempt", null,
    )).toBeNull();
  });

  it("fails closed for malformed WeChat token and send replies", async () => {
    for (const invalidToken of [
      {}, null, [], "token", { access_token: "" },
      { access_token: "token", expires_in: "7200" },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(invalidToken)));
      const provider = new WechatSubscriptionMessageProvider(wechatConfig());
      await expect(provider.send({ user: wechatUser, notification: notification(), plan })).rejects.toThrow("微信访问令牌");
      vi.unstubAllGlobals();
    }

    for (const invalidSend of [
      {}, null, [], "sent", { errcode: "0" },
    ]) {
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce(reply({ access_token: "token", expires_in: 7_200 }))
        .mockResolvedValueOnce(reply(invalidSend)));
      const provider = new WechatSubscriptionMessageProvider(wechatConfig());
      await expect(provider.send({ user: wechatUser, notification: notification(), plan })).rejects.toThrow("微信订阅消息");
      vi.unstubAllGlobals();
    }

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(reply({ access_token: "token", expires_in: 7_200 }))
      .mockResolvedValueOnce(new Response("<html>gateway</html>", { status: 200 })));
    await expect(new WechatSubscriptionMessageProvider(wechatConfig()).send({
      user: wechatUser,
      notification: notification(),
      plan,
    })).rejects.toThrow("微信订阅消息返回不是有效 JSON");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({}, 503)));
    await expect(new WechatSubscriptionMessageProvider(wechatConfig()).send({
      user: wechatUser,
      notification: notification(),
      plan,
    })).rejects.toThrow("微信访问令牌网络错误：503");
  });

  it("keeps a malformed HTTP 200 provider result as a durable unknown submission", async () => {
    const store = await fixture();
    await store.createOrderNotificationIfAbsent(notification());
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(reply({ access_token: "token", expires_in: 7_200 }))
      .mockResolvedValueOnce(reply({})));
    await new NotificationService(
      store,
      new WechatSubscriptionMessageProvider(wechatConfig()),
    ).drainPending();
    expect(await store.getOrderNotification("notification")).toMatchObject({
      status: "SUBMISSION_UNKNOWN",
      submissionUnknownReason: "微信订阅消息返回缺少 errcode",
      deliveredAt: null,
    });
  });
});
