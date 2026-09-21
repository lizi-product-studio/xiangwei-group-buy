import { PaymentService } from "./modules/payments/payment-service.js";
import { MockPaymentProvider } from "./modules/payments/payment-provider.js";
import { LedgerService } from "./modules/finance/ledger-service.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";

// Synthetic history only: this suite tests queue boundaries, not real registration/capacity.
class HistoryStore extends MemoryStore {
  seed(values: Record<string, unknown>) { this.importState(JSON.stringify({...JSON.parse(this.exportState()), ...values})); }
  snapshot() { return this.exportState(); }
}
const old = "2026-01-01T00:00:00.000Z";
const recent = "2026-02-01T00:00:00.000Z";
const headers = (role: string) => ({"x-demo-user-id": "admin", "x-demo-role": role});
describe("history-safe operations queues", () => {
  let app: FastifyInstance;
  let store: HistoryStore;
  beforeEach(async () => {
    store = new HistoryStore();
    await store.saveUser({id: "admin", wechatOpenId: null, status: "ACTIVE", createdAt: old});
    app = await buildApp({config: loadConfig({NODE_ENV: "test", RATE_LIMIT_MAX: "10000"}), store});
  });
  afterEach(async () => { await app?.close(); });
  const get = (path: string, role = "SUPER_ADMIN") => app.inject({url: path, headers: headers(role)});
  it.each([
    ["cancellations", "/api/v1/admin/community/cancellation-requests", "PENDING_REVIEW", "REFUNDED", "OPERATOR"],
    ["cancellations", "/api/v1/admin/community/cancellation-requests", "APPROVED_WAITING_FINANCE", "REFUNDED", "FINANCE"],
    ["quality", "/api/v1/admin/quality-cases", "REGISTERED", "RESOLVED", "CUSTOMER_SERVICE"],
    ["quality", "/api/v1/admin/quality-cases", "ACCEPTED", "RESOLVED", "OPERATOR"],
    ["quality", "/api/v1/admin/quality-cases", "REFUNDING", "RESOLVED", "FINANCE"],
    ["windows", "/api/v1/admin/community/pickup-windows", "EXPIRED_PENDING", "CLOSED", "OPERATOR"],
    ["windows", "/api/v1/admin/community/pickup-windows", "REFUND_PENDING", "CLOSED", "FINANCE"],
    ["notifications", "/api/v1/admin/notifications/manual", "MANUAL_REQUIRED", "MANUAL_REQUIRED", "CUSTOMER_SERVICE"],
  ])("%s keeps old %s / %s reachable beyond 500", async (kind, path, pending, closed, role) => {
    const entry = (id: string, status: string, at: string) => [id, {id, orderId: id, userId: "synthetic", status, requestedAt: at, registeredAt: at, createdAt: at, deadlineAt: at, items: []}];
    store.seed({[kind]: [entry("old", pending, old), ...Array.from({length: 501}, (_, i) => entry(`new-${String(i).padStart(3, "0")}`, closed, recent))]});
    const before = store.snapshot();
    const filtered = await get(`${path}?page=1&pageSize=100&status=${pending}`, role);
    expect(filtered.statusCode, filtered.body).toBe(200);
    if (pending !== closed) {
      expect(filtered.json().pagination.total).toBe(1);
      expect(filtered.json().data[0].orderId).toBe("old");
    }
    const ids: string[] = [];
    for (let page = 1; page <= 6; page++) {
      const result = await get(`${path}?page=${page}&pageSize=100`, role);
      expect(result.statusCode, result.body).toBe(200);
      ids.push(...result.json().data.map((value: {orderId: string}) => value.orderId));
      // Some roles intentionally cannot see terminal statuses (e.g. customer service).
      expect(result.json().pagination.total).toBe(kind === "quality" && role === "CUSTOMER_SERVICE" ? 1 : 502);
    }
    expect(ids).toContain("old");
    expect(new Set(ids).size).toBe(ids.length);
    expect((await get(`${path}?page=0`, role)).statusCode).toBe(400);
    expect((await get(`${path}?pageSize=101`, role)).statusCode).toBe(400);
    expect(store.snapshot()).toBe(before);
    const legacy = await get(path, role);
    expect(Array.isArray(legacy.json().data)).toBe(true);
  });
  it.each(["EXPIRED_PENDING", "REFUND_PENDING"])("prioritizes the earliest deadline before paginating %s", async status => {
    const entry = (id: string, deadlineAt: string) => [id, {id, orderId: id, status, deadlineAt, createdAt: recent}];
    store.seed({windows: [entry("later", recent), entry("older-b", old), entry("older-a", old)]});
    const before = store.snapshot();
    const ids: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const response = await get(`/api/v1/admin/community/pickup-windows?status=${status}&page=${page}&pageSize=1`);
      expect(response.statusCode).toBe(200);
      expect(response.json().pagination.total).toBe(3);
      ids.push(response.json().data[0].orderId);
    }
    expect(ids).toEqual(["older-a", "older-b", "later"]);
    expect(store.snapshot()).toBe(before);
  });
  it("filters role scope before totals and rejects out-of-scope requests", async () => {
    store.seed({quality: [["private", {id: "private", orderId: "order", status: "REGISTERED", registeredAt: old, items: []}]], cancellations: [["private", {id: "private", orderId: "order", status: "PENDING_REVIEW", requestedAt: old}]]});
    for (const path of ["/api/v1/admin/quality-cases", "/api/v1/admin/community/cancellation-requests"]) {
      const value = await get(path, "FINANCE");
      expect(value.json()).toMatchObject({data: [], pagination: {total: 0}});
      expect((await get(path, "USER")).statusCode).toBe(403);
    }
  });
  it("filters fulfillment exceptions by source stage before pagination", async () => {
    store.seed({exceptions: [
      ["arrival", {id: "arrival", sourceStage: "PICKUP_ARRIVAL", status: "REFUND_CONFIRMED", registeredAt: old, items: []}],
      ["claim", {id: "claim", sourceStage: "CUSTOMER_CLAIM", status: "REFUND_CONFIRMED", registeredAt: recent, items: []}],
    ]});
    const all = await get("/api/v1/admin/fulfillment-exceptions?page=1&pageSize=1");
    expect(all.json().pagination.total).toBe(2);
    const arrival = await get("/api/v1/admin/fulfillment-exceptions?sourceStage=PICKUP_ARRIVAL&page=1&pageSize=1");
    expect(arrival.json()).toMatchObject({pagination: {total: 1}, data: [{id: "arrival"}]});
    const claim = await get("/api/v1/admin/fulfillment-exceptions?sourceStage=CUSTOMER_CLAIM&page=1&pageSize=1");
    expect(claim.json()).toMatchObject({pagination: {total: 1}, data: [{id: "claim"}]});
  });
  it("payment service rejects missing allocation inside transaction but preserves resolved idempotency", async () => {
    const payments = new PaymentService(store, new MockPaymentProvider(), new LedgerService());
    store.seed({exceptions: [["missing", {id: "missing", status: "REFUND_CONFIRMED"}]]});
    const before = store.snapshot();
    await expect(payments.executePartialRefund("missing")).rejects.toMatchObject({code: "FINANCIAL_INCONSISTENT"});
    expect(store.snapshot()).toBe(before);
    store.seed({exceptions: [["missing", {id: "missing", status: "RESOLVED"}]]});
    const resolved = store.snapshot();
    await payments.executePartialRefund("missing");
    expect(store.snapshot()).toBe(resolved);
  });
  it("uses the old order and line price, and missing facts refuse refund without side effects", async () => {
    const item = {orderLineId: "line-old", skuId: "sku", name: "历史蔬菜 · 一份", quantity: 2, unitPriceCents: 1200};
    const order = {id: "order-old", orderNo: "OLD-1200", pickupPointId: "point", items: [item], createdAt: old};
    const exception = {id: "exception", orderId: "order-old", status: "REFUND_CONFIRMED", registeredAt: old, items: [{id: "exception-item", catalogSkuId: "sku", expectedQuantity: 2, acceptedQuantity: 1}]};
    const allocation = {id: "allocation", exceptionId: "exception", exceptionItemId: "exception-item", orderId: "order-old", orderLineId: "line-old", catalogSkuId: "sku", exceptionQuantity: 1, refundedQuantity: 0};
    store.seed({orders: [[order.id, order], ...Array.from({length: 501}, (_, i) => [`new-${i}`, {...order, id: `new-${i}`, createdAt: recent}])], exceptions: [[exception.id, exception]], allocations: [[allocation.id, allocation]]});
    store.seed({exceptions: [[exception.id, {...exception, status: "REGISTERED"}]]});
    const registered = await get("/api/v1/admin/fulfillment-exceptions?status=REGISTERED");
    expect(registered.json()).toMatchObject({pagination: {total: 1}, data: [{id: exception.id, status: "REGISTERED"}]});
    store.seed({exceptions: [[exception.id, exception]]});
    const row = (await get("/api/v1/admin/fulfillment-exceptions")).json().data[0];
    expect(row).toMatchObject({orderNo: "OLD-1200", refundAmountCents: 1200, financialFactsError: null, items: [{name: "历史蔬菜 · 一份", unitPriceCents: 1200, amountCents: 1200}]});
    expect(row.financeRefundFacts).toMatchObject({refundAmountCents: 1200, refundAmountKind: "PENDING"});
    store.seed({partialRefunds: [["partial", {id: "partial", exceptionId: exception.id, orderId: order.id, amountCents: 600, status: "PROCESSING"}]]});
    const recorded = (await get("/api/v1/admin/fulfillment-exceptions")).json().data[0];
    expect(recorded.refundAmountCents).toBe(1200); // existing operations total stays intact
    expect(recorded.financeRefundFacts).toMatchObject({refundAmountCents: 600, refundAmountKind: "RECORDED", refundStatus: "PROCESSING"});
    store.seed({partialRefunds: []});
    for (const patch of [{orders: []}, {orders: [[order.id, {...order, items: []}]]}, {orders: [[order.id, order]], allocations: []}]) {
      store.seed(patch);
      const before = store.snapshot();
      const unavailable = (await get("/api/v1/admin/fulfillment-exceptions")).json().data[0];
      expect(unavailable.refundAmountCents).toBeNull();
      expect(unavailable.financialFactsError).toBeTruthy();
      const refused = await app.inject({method: "POST", url: "/api/v1/admin/fulfillment-exceptions/exception/refund", headers: headers("FINANCE"), payload: {confirmationNote: "核对后退款"}});
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().code).toBe("FINANCIAL_INCONSISTENT");
      expect(store.snapshot()).toBe(before);
    }
  });
});
