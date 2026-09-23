import { describe, expect, it } from "vitest";
import { LedgerService } from "../finance/ledger-service.js";
import { MemoryStore } from "../core/store.js";
import type { Campaign, DispatchBatch } from "../core/types.js";
import { FulfillmentService } from "./fulfillment-service.js";

class SnapshotStore extends MemoryStore {
  public snapshot(): string {
    return this.exportState();
  }
}

const campaign: Campaign = {
  id: "campaign-terminal",
  title: "终态团期",
  serviceAreaId: "area-1",
  cutoffAt: "2026-09-01T00:00:00.000Z",
  dispatchAt: "2026-09-02T00:00:00.000Z",
  estimatedArrivalStartAt: "2026-09-03T00:00:00.000Z",
  estimatedArrivalEndAt: "2026-09-04T00:00:00.000Z",
  minTotalQuantity: 1,
  failureAction: "CANCEL_AND_REFUND",
  items: [],
  status: "CANCELLED",
  version: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
};

const batch = (status: DispatchBatch["status"]): DispatchBatch => ({
  id: "batch-terminal",
  campaignId: campaign.id,
  serviceAreaId: campaign.serviceAreaId,
  status,
  createdAt: "2026-09-02T00:00:00.000Z",
  dispatchedAt: status === "IN_TRANSIT" ? "2026-09-02T01:00:00.000Z" : null,
  arrivedAt: null,
});

describe("terminal campaign dispatch guard", () => {
  it.each(["CANCELLED", "COMPLETED"] as const)(
    "does not reuse a historical draft batch for %s campaign",
    async (status) => {
      const store = new SnapshotStore(false);
      await store.saveCampaign({ ...campaign, status });
      await store.saveDispatchBatch(batch("DRAFT"));
      const before = store.snapshot();
      const service = new FulfillmentService(store, "dispatch-test-secret", new LedgerService());

      await expect(service.createBatch(campaign.id)).rejects.toMatchObject({
        code: "INVALID_STATE_TRANSITION",
        statusCode: 409,
      });
      expect(store.snapshot()).toBe(before);
    },
  );

  it.each([
    ["CANCELLED", "DRAFT"],
    ["CANCELLED", "IN_TRANSIT"],
    ["COMPLETED", "DRAFT"],
    ["COMPLETED", "IN_TRANSIT"],
  ] as const)(
    "rejects %s campaign dispatch for a %s batch without writes",
    async (status, batchStatus) => {
      const store = new SnapshotStore(false);
      await store.saveCampaign({ ...campaign, status });
      await store.saveDispatchBatch(batch(batchStatus));
      const before = store.snapshot();
      const service = new FulfillmentService(store, "dispatch-test-secret", new LedgerService());

      await expect(service.dispatch("batch-terminal")).rejects.toMatchObject({
        code: "INVALID_STATE_TRANSITION",
        statusCode: 409,
      });
      expect(store.snapshot()).toBe(before);
    },
  );
});
