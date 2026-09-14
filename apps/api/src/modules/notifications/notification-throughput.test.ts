import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../core/store.js";
import type { DeliveryPlan, Order, OrderNotification } from "../core/types.js";
import { NotificationService } from "./notification-service.js";

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


afterEach(() => vi.useRealTimers());
async function pending(count: number) {
  const store = await fixture();
  for (let index = 0; index < count; index++) {
    await store.createOrderNotificationIfAbsent({...notification(), id: `throughput-${index}`, eventKey: `throughput:${index}`});
  }
  return store;
}
describe("bounded notification throughput", () => {
  it("drains 1000 due notifications within the five-minute scheduling budget at 100ms provider latency", async () => {
    vi.useFakeTimers();
    const store = await pending(1000);
    const sent = new Set<string>();
    let active = 0, maximum = 0;
    const service = new NotificationService(store, {send: async ({notification: value}) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(sent.has(value.id)).toBe(false); sent.add(value.id); active--;
    }});
    const started = Date.now();
    for (let round = 0; round < 10; round++) {
      const run = service.drainPending();
      await vi.runAllTimersAsync();
      expect(await run).toBe(100);
      if (round < 9) await vi.advanceTimersByTimeAsync(28_000);
    }
    expect(sent.size).toBe(1000);
    expect(maximum).toBe(5);
    expect(Date.now() - started).toBeLessThanOrEqual(300_000);
    expect(await service.drainPending()).toBe(0);
    expect((await store.listOrderNotificationsByUser("user")).every(value => value.status === "WECHAT_SENT")).toBe(true);
  }, 15_000);
  it("measures 1000 notices using wall-clock 100ms provider latency without fake timers", async () => {
    const store = await pending(1000);
    const sent = new Set<string>();
    let active = 0, maximum = 0;
    const service = new NotificationService(store, {send: async ({notification: value}) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(sent.has(value.id)).toBe(false); sent.add(value.id); active--;
    }});
    const started = performance.now();
    for (let round = 0; round < 10; round++) expect(await service.drainPending()).toBe(100);
    const elapsedMs = performance.now() - started;
    expect(sent.size).toBe(1000);
    expect(maximum).toBe(5);
    expect(elapsedMs).toBeGreaterThanOrEqual(20_000);
    expect(elapsedMs).toBeLessThan(300_000);
    expect(await service.drainPending()).toBe(0);
    console.info(JSON.stringify({measurement: "wall-clock-memory-store-not-production-db", count: sent.size, providerLatencyMs: 100, concurrency: maximum, elapsedMs}));
  }, 60_000);
  it("settles a hung provider as UNKNOWN within one budget without claiming all remaining work", async () => {
    vi.useFakeTimers();
    const store = await pending(100);
    const send = vi.fn(async () => new Promise<void>(() => undefined));
    const service = new NotificationService(store, {send});
    const started = Date.now();
    const run = service.drainPending();
    await vi.runAllTimersAsync();
    expect(await run).toBe(5);
    expect(Date.now() - started).toBe(20_000);
    expect(send).toHaveBeenCalledTimes(5);
    const values = await store.listOrderNotificationsByUser("user");
    expect(values.filter(value => value.status === "SUBMISSION_UNKNOWN")).toHaveLength(5);
    expect(values.filter(value => value.status === "PENDING_DELIVERY" && value.deliveryClaimToken === null)).toHaveLength(95);
    const retry = service.drainPending(1);
    await vi.runAllTimersAsync();
    expect(await retry).toBe(1);
    expect(send).toHaveBeenCalledTimes(6);
  });
  it("concurrent drainers claim disjoint batches and preserve explicit per-call limits", async () => {
    const store = await pending(40);
    const sent: string[] = [];
    const service = new NotificationService(store, {send: async ({notification: value}) => {sent.push(value.id);}});
    expect(await Promise.all([service.drainPending(13), service.drainPending(17)])).toEqual([13, 17]);
    expect(new Set(sent).size).toBe(30);
    expect(await service.drainPending()).toBe(10);
    expect(new Set(sent).size).toBe(40);
  });
});
