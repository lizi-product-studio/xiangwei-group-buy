import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./store.js";
import { ensureConsumerPublicNumbers } from "../customers/consumer-directory-service.js";

class SnapshotStore extends MemoryStore {
  public load(raw: string): void {
    this.importState(raw);
  }
  public snapshot(): string {
    return this.exportState();
  }
}

const consumer = (id: string, createdAt: string) => ({
  id,
  wechatOpenId: `openid-${id}`,
  status: "ACTIVE" as const,
  createdAt,
});

describe("consumer public number allocation", () => {
  it("backfills only consumers in stable creation order and survives the aggregate JSON round trip", async () => {
    const store = new SnapshotStore(false);
    store.load(JSON.stringify({
      users: [
        ["staff-user", { ...consumer("staff-user", "2026-09-01T00:00:00.000Z"), consumerNumber: undefined }],
        ["later", consumer("later", "2026-09-02T00:00:00.000Z")],
        ["earlier", consumer("earlier", "2026-09-01T00:00:00.000Z")],
      ],
      staff: [["staff-user", { userId: "staff-user", staffNo: "S-1" }]],
    }));

    await ensureConsumerPublicNumbers(store);
    const users = await store.listConsumerUsers();
    expect(users.map((value) => [value.id, value.consumerNumber])).toEqual([
      ["later", 2],
      ["earlier", 1],
    ]);

    // Prior versions only serialize known root keys, but preserve complete user
    // objects and the existing idempotency map where the high-water marker lives.
    const legacyRoundTrip = new SnapshotStore(false);
    legacyRoundTrip.load(store.snapshot());
    const state = JSON.parse(legacyRoundTrip.snapshot()) as {
      users: Array<[string, { consumerNumber?: number }]>;
      idempotency: Array<[string, { fingerprint: string; orderId: string }]>;
      nextConsumerNumber?: number;
    };
    expect(state.users.find(([id]) => id === "earlier")?.[1].consumerNumber).toBe(1);
    expect(state.idempotency).toContainEqual([
      "__codex_system__:consumer-public-number-sequence-v1",
      { fingerprint: "consumer-public-number-sequence-v1", orderId: "3" },
    ]);
    expect(state).not.toHaveProperty("nextConsumerNumber");
    await legacyRoundTrip.transaction(async (transactionStore) => {
      expect(await transactionStore.allocateConsumerPublicNumber("earlier")).toBe(1);
    });
  });

  it("serializes concurrent allocations and never reuses a reserved number", async () => {
    const store = new SnapshotStore(false);
    const register = (id: string) => store.transaction(async (transactionStore) => {
      await transactionStore.saveUser(consumer(id, "2026-09-01T00:00:00.000Z"));
      const consumerNumber = await transactionStore.allocateConsumerPublicNumber(id);
      await transactionStore.saveUser({ ...consumer(id, "2026-09-01T00:00:00.000Z"), consumerNumber });
      return consumerNumber;
    });

    const allocated = await Promise.all(Array.from({ length: 20 }, (_, index) => register(`consumer-${index}`)));
    expect([...allocated].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    const state = JSON.parse(store.snapshot()) as { users: Array<[string, unknown]> };
    state.users = state.users.filter(([id]) => id !== "consumer-19");
    const restarted = new SnapshotStore(false);
    restarted.load(JSON.stringify(state));
    await restarted.saveUser(consumer("replacement", "2026-09-03T00:00:00.000Z"));
    await restarted.transaction(async (transactionStore) => {
      const next = await transactionStore.allocateConsumerPublicNumber("replacement");
      expect(next).toBe(21);
      await transactionStore.saveUser({ ...consumer("replacement", "2026-09-03T00:00:00.000Z"), consumerNumber: next });
    });
  });

  it("refuses to allocate a public number to an employee or unknown UUID", async () => {
    const store = new MemoryStore(false);
    await store.saveUser({ id: "employee", wechatOpenId: null, status: "ACTIVE", createdAt: "2026-09-01T00:00:00.000Z" });
    await expect(store.allocateConsumerPublicNumber("employee")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(store.allocateConsumerPublicNumber("missing")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("repairs missing numbers in bounded pages without listing every consumer", async () => {
    const store = new MemoryStore(false);
    for (let index = 0; index < 3; index++) await store.saveUser(consumer(`missing-${index}`, `2026-09-0${index + 1}T00:00:00.000Z`));
    const unbounded = vi.spyOn(store, "listConsumerUsers").mockRejectedValue(new Error("unbounded consumer scan"));
    await ensureConsumerPublicNumbers(store);
    expect(unbounded).not.toHaveBeenCalled();
    expect(await store.listConsumerUsersMissingPublicNumbers(500)).toEqual([]);
    const page = await store.searchConsumerUsers("", 1, 10);
    expect(page.total).toBe(3);
    expect(page.items.map((user) => user.consumerNumber)).toEqual([1, 2, 3]);
  });
});
