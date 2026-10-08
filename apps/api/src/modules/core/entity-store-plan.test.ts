import { describe, expect, it } from "vitest";
import { entityNeeds } from "./entity-store-plan.js";
import { toEntityRecord } from "./entity-store-records.js";
import { MemoryStore } from "./store.js";

describe("Entity Store indexed read plans", () => {
  it("has an explicit plan or direct SQL handler for each domain Store method", () => {
    const infrastructure = new Set([
      "constructor", "readSnapshot", "transaction", "health", "databaseNow", "close",
      "getPersistenceMode", "setDatabaseNowForTests", "hydrateOrder", "linesForOrder", "claimRefund",
      "exportState", "importState", "importEntityRows", "exportEntityRows",
    ]);
    const unplanned: string[] = [];
    for (const method of Object.getOwnPropertyNames(MemoryStore.prototype)) {
      if (infrastructure.has(method)) continue;
      try { entityNeeds(method, []); } catch { unplanned.push(method); }
    }
    expect(unplanned).toEqual([]);
  });

  it("uses the correct argument positions for expired auth cleanup", () => {
    expect(entityNeeds("deleteExpiredAuthenticationData", ["2026-09-28T00:00:00Z", ["session-a"], ["token-b"]])).toEqual([
      { collection: "sessions", keys: ["session-a"] },
      { collection: "passwordChangeTokens", keys: ["token-b"] },
    ]);
  });

  it("hydrates order delivery facts by order, then resolves plans and allocation exceptions", () => {
    const reads = entityNeeds("listOrderDeliveryFacts", [["order-a", "order-b"]]);
    expect(reads).toContainEqual({ collection: "orders", keys: ["order-a", "order-b"] });
    expect(reads).toContainEqual({ collection: "allocations", index: "a", values: ["order-a", "order-b"] });
    expect(reads).toContainEqual({ collection: "pickupReceipts", index: "a", values: ["order-a", "order-b"] });
  });

  it("reads public campaigns and their plans by status and campaign index only", () => {
    expect(entityNeeds("listCampaignsByStatus", [["OPEN"]])).toEqual([{ collection: "campaigns", statuses: ["OPEN"] }]);
    expect(entityNeeds("listDeliveryPlansByCampaigns", [["campaign-a", "campaign-b"]])).toEqual([
      { collection: "plans", index: "a", values: ["campaign-a", "campaign-b"] },
    ]);
  });

  it("selects refunded allocations by both exception and order", () => {
    expect(entityNeeds("markFulfillmentAllocationsRefunded", ["exception-a", { orderId: "order-b" }, "now"])).toEqual([
      { collection: "allocations", index: "b", value: "exception-a", indexB: "a", valueB: "order-b" },
      { collection: "lines", index: "a", value: "order-b" },
    ]);
  });
});

describe("Entity Store record projections", () => {
  it("keeps request-scoped receipt uniqueness and composite lookup fields", () => {
    const record = toEntityRecord("pickupReceipts", "receipt-a", {
      id: "receipt-a", orderId: "order-a", pickupRequestId: "request-a", deliveryPlanId: "plan-a", createdAt: "2026-09-28T01:02:03.000Z",
    });
    expect(record.lookupA).toBe("order-a");
    expect(record.lookupB).toBe("request-a");
    expect(record.lookupC).toBe("plan-a");
    expect(record.uniqueKey).toBe("order-a:request-a");
  });

  it("preserves distinct notification retry, lease, and provider-start timestamps", () => {
    const record = toEntityRecord("notifications", "notice-a", {
      id: "notice-a", status: "PENDING_DELIVERY", nextAttemptAt: "2026-09-28T01:00:00Z",
      deliveryLeaseUntil: "2026-09-28T01:01:00Z", providerSubmissionStartedAt: "2026-09-28T00:59:00Z",
    });
    expect(record.retryAt).toBe("2026-09-28 01:00:00.000");
    expect(record.leaseUntil).toBe("2026-09-28 01:01:00.000");
    expect(record.providerStartedAt).toBe("2026-09-28 00:59:00.000");
    expect(record.dueAt).toBeNull();
  });

  it("keeps checkout order relations outside bounded lookup projections", () => {
    const record = toEntityRecord("checkoutBatches", "batch-a", { id: "batch-a", outTradeNo: "trade-a", orderIds: ["order-a", "order-b"] });
    expect(record.lookupA).toBeNull();
    expect(record.lookupB).toBe("trade-a");
    expect(record.uniqueKey).toBe("trade-a");
  });

  it("round trips access-role tombstones as a Set rather than Map entries", async () => {
    const store = new MemoryStore(false);
    store.importEntityRows("deletedAccessRoleIds", [["deleted-role", "deleted-role"]]);
    expect(await store.getAccessRole("deleted-role")).toBeNull();
    expect(store.exportEntityRows("deletedAccessRoleIds")).toEqual([["deleted-role", "deleted-role"]]);
  });
});
