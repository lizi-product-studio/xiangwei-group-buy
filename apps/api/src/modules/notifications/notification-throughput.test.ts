import { performance as wallClock } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, type CommerceStore } from "../core/store.js";
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

// This adapter measures scheduler/provider timing without copying 1000 unrelated outbox
// rows per read/fence. Mutations still use the real MemoryStore claim/submission methods.
// The unchanged wall-clock and delivery-semantics tests retain full MemoryStore costs.
class NotificationSchedulingStore extends MemoryStore {
  private queue: Promise<void> = Promise.resolve();
  private readSmallSnapshot<T>(work: (store: CommerceStore) => Promise<T>): Promise<T> {
    return super.readSnapshot(work);
  }
  override async readSnapshot<T>(work: (store: CommerceStore) => Promise<T>): Promise<T> {
    const snapshot = new NotificationSchedulingStore(false);
    snapshot.data = structuredClone({ ...this.data, notifications: new Map() });
    return snapshot.readSmallSnapshot(work);
  }
  override async transaction<T>(work: (store: CommerceStore) => Promise<T>): Promise<T> {
    const before = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await before;
    const touched = new Map<string, OrderNotification | undefined>();
    const writes = new Set(["beginOrderNotificationSubmission", "markOrderNotificationSentIfSubmission", "recordSubmissionUnknownIfSubmission"]);
    const tx = new Proxy(this, {
      get: (target, property) => {
        if (typeof property !== "string" || !writes.has(property))
          return () => { throw new Error("Scheduling fixture transaction rejects unrelated operations"); };
        return (...args: unknown[]) => {
          const id = property === "beginOrderNotificationSubmission" ? (args[0] as { id: string }).id : args[0] as string;
          if (!touched.has(id)) touched.set(id, structuredClone(this.data.notifications.get(id)));
          const method = Reflect.get(target, property) as (...values: unknown[]) => unknown;
          return method.apply(target, args);
        };
      },
    });
    try { return await work(tx); }
    catch (error) {
      for (const [id, value] of touched) {
        if (value) this.data.notifications.set(id, value); else this.data.notifications.delete(id);
      }
      throw error;
    } finally { release(); }
  }
}

async function settleDrain<T>(run: Promise<T>): Promise<T> {
  let settled = false, value: T | undefined, failure: unknown;
  const completion = run.then(result => { value = result; }, error => { failure = error; }).finally(() => { settled = true; });
  const start = Date.now();
  while (!settled && Date.now()-start < 20_000) await vi.advanceTimersByTimeAsync(100);
  if (!settled) throw new Error(`Drain did not settle in its 20-second virtual budget; timers=${vi.getTimerCount()}`);
  await completion;
  if (failure !== undefined) throw failure;
  return value as T;
}

async function fixture(withPlan = true, recordScoped = false) {
  const store = recordScoped ? new NotificationSchedulingStore(false) : new MemoryStore(false);
  await store.saveUser({ id: "user", wechatOpenId: "openid", status: "ACTIVE", createdAt: now() });
  await store.saveOrder(order);
  if (withPlan) await store.saveDeliveryPlan(plan);
  return store;
}


afterEach(() => vi.useRealTimers());
async function pending(count: number, recordScoped = false) {
  const store = await fixture(true, recordScoped);
  for (let index = 0; index < count; index++) {
    await store.createOrderNotificationIfAbsent({...notification(), id: `throughput-${index}`, eventKey: `throughput:${index}`});
  }
  return store;
}
describe("bounded notification throughput", () => {
  it("drains 1000 due notifications within the five-minute scheduling budget at 100ms provider latency", async () => {
    vi.useFakeTimers();
    const fixtureStarted = wallClock.now();
    const store = await pending(1000, true);
    console.info(JSON.stringify({probe: "Q02-notification", phase: "fixture", wallMs: wallClock.now()-fixtureStarted}));
    const costs = { readSnapshots: 0, readElapsedMs: 0, transactions: 0, transactionElapsedMs: 0 };
    const read = store.readSnapshot.bind(store), transaction = store.transaction.bind(store);
    store.readSnapshot = async <T>(work: (snapshot: CommerceStore) => Promise<T>): Promise<T> => {
      const start = wallClock.now(); costs.readSnapshots++;
      try { return await read(work); } finally { costs.readElapsedMs += wallClock.now()-start; }
    };
    store.transaction = async <T>(work: (tx: CommerceStore) => Promise<T>): Promise<T> => {
      const start = wallClock.now(); costs.transactions++;
      try { return await transaction(work); } finally { costs.transactionElapsedMs += wallClock.now()-start; }
    };
    const sent = new Set<string>();
    let active = 0, maximum = 0;
    const service = new NotificationService(store, {send: async ({notification: value}) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(sent.has(value.id)).toBe(false); sent.add(value.id); active--;
    }});
    const started = Date.now();
    for (let round = 0; round < 10; round++) {
      const roundStarted = wallClock.now();
      console.info(JSON.stringify({probe: "Q02-notification", phase: "round-start", round, sent: sent.size, timers: vi.getTimerCount()}));
      const run = service.drainPending();
      expect(await settleDrain(run)).toBe(100);
      console.info(JSON.stringify({probe: "Q02-notification", phase: "round-end", round, sent: sent.size, maximum, virtualMs: Date.now()-started, wallMs: wallClock.now()-roundStarted, timers: vi.getTimerCount()}));
      if (round < 9) await vi.advanceTimersByTimeAsync(28_000);
    }
    console.info(JSON.stringify({probe: "Q02-notification", phase: "store-cost", costs}));
    expect(sent.size).toBe(1000);
    expect(maximum).toBe(5);
    expect(Date.now() - started).toBeLessThanOrEqual(300_000);
    expect(await service.drainPending()).toBe(0);
    expect((await store.listOrderNotificationsByUser("user")).every(value => value.status === "WECHAT_SENT")).toBe(true);
  }, 15_000);
  it("keeps record-scoped scheduling transactions serial, rolls back touched rows and rejects snapshot writes", async () => {
    const store = await pending(2, true);
    const claimed = await store.claimPendingOrderNotifications(2, 1000, "fixture-claim");
    const failed = store.transaction(async tx => {
      await tx.beginOrderNotificationSubmission({ id: claimed[0]!.id, claimToken: "fixture-claim", attemptId: "rolled-back" });
      throw new Error("fixture rollback");
    });
    const second = store.transaction(tx => tx.beginOrderNotificationSubmission({ id: claimed[1]!.id, claimToken: "fixture-claim", attemptId: "completed-fence" }));
    await expect(failed).rejects.toThrow("fixture rollback");
    expect((await second)?.providerSubmissionAttemptId).toBe("completed-fence");
    expect((await store.getOrderNotification(claimed[0]!.id))?.status).toBe("PENDING_DELIVERY");
    await expect(store.readSnapshot(tx => tx.saveUser({id: "forbidden", status: "ACTIVE", wechatOpenId: null, createdAt: now()}))).rejects.toThrow("Readonly aggregate snapshot rejects");
    await expect(store.transaction(tx => tx.saveUser({id: "forbidden", status: "ACTIVE", wechatOpenId: null, createdAt: now()}))).rejects.toThrow("rejects unrelated operations");
    expect(await store.getUser("forbidden")).toBeNull();
  });
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
