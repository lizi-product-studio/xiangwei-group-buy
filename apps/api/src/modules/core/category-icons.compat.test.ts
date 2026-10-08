import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store.js";

class SnapshotStore extends MemoryStore {
  restore(raw: string) { this.importState(raw); }
  snapshot() { return this.exportState(); }
}

describe("category icon state compatibility", () => {
  it("backfills legacy category icons once while preserving configured and unknown-safe values", async () => {
    const store = new SnapshotStore(false);
    const now = "2026-09-23T00:00:00.000Z";
    store.restore(JSON.stringify({
      categories: [
        ["vegetables", { id: "vegetables", name: "时蔬", sortOrder: 1, status: "ACTIVE", createdAt: now, updatedAt: now }],
        ["fruit", { id: "fruit", name: "水果", sortOrder: 2, status: "ACTIVE", createdAt: now, updatedAt: now }],
        ["prepared", { id: "prepared", name: "熟食", sortOrder: 3, status: "ACTIVE", createdAt: now, updatedAt: now }],
        ["tools", { id: "tools", name: "农具", sortOrder: 4, status: "ACTIVE", createdAt: now, updatedAt: now }],
        ["misc", { id: "misc", name: "其他", sortOrder: 5, status: "ACTIVE", createdAt: now, updatedAt: now }],
        ["custom", { id: "custom", name: "定制", iconKey: "tools", sortOrder: 6, status: "ACTIVE", createdAt: now, updatedAt: now }],
      ],
    }));

    await expect(store.listProductCategories(true)).resolves.toMatchObject([
      { id: "vegetables", iconKey: "leaf" },
      { id: "fruit", iconKey: "fruit" },
      { id: "prepared", iconKey: "ready-food" },
      { id: "tools", iconKey: "tools" },
      { id: "misc", iconKey: "basket" },
      { id: "custom", iconKey: "tools" },
    ]);
    const restarted = new SnapshotStore(false);
    restarted.restore(store.snapshot());
    await expect(restarted.getProductCategory("vegetables")).resolves.toMatchObject({ iconKey: "leaf" });
  });
});
