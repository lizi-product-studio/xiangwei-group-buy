import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./store.js";
import type { AuditLog } from "./types.js";

class ReloadableMemoryStore extends MemoryStore {
  public reload(raw: string): void { this.importState(raw); }
  public serialize(): string { return this.exportState(); }
}

const audit = (id: string, requestId: string, action = "UPDATED"): AuditLog => ({
  id, actorId: "actor", action, resourceType: "ITEM", resourceId: "item",
  requestId, beforeData: null, afterData: null, createdAt: "2026-09-28T00:00:00.000Z",
});

describe("aggregate maintenance", () => {
  it("deletes expired sessions and password-change tokens in a bounded batch only", async () => {
    const store = new MemoryStore(false);
    await store.saveAuthSession({ tokenHash: "expired-session", userId: "u", roles: ["USER"], authorizationVersion: 0, expiresAt: "2026-01-01T00:00:00.000Z" });
    await store.saveAuthSession({ tokenHash: "active-session", userId: "u", roles: ["USER"], authorizationVersion: 0, expiresAt: "2027-01-01T00:00:00.000Z" });
    await store.savePasswordChangeToken({ tokenHash: "expired-password", userId: "u", authorizationVersion: 1, expiresAt: "2026-01-01T00:00:00.000Z", createdAt: "2025-12-31T00:00:00.000Z" });
    await store.savePasswordChangeToken({ tokenHash: "active-password", userId: "u", authorizationVersion: 1, expiresAt: "2027-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" });
    const expired = await store.listExpiredAuthenticationData("2026-09-28T00:00:00.000Z", 1);
    expect(expired).toEqual({ sessions: ["expired-session"], passwordChangeTokens: [] });
    expect(await store.transaction((tx) => tx.deleteExpiredAuthenticationData("2026-09-28T00:00:00.000Z", expired.sessions, expired.passwordChangeTokens))).toBe(1);
    expect(await store.getPasswordChangeToken("active-password")).not.toBeNull();
    const nextBatch = await store.listExpiredAuthenticationData("2026-09-28T00:00:00.000Z", 1);
    expect(nextBatch).toEqual({ sessions: [], passwordChangeTokens: ["expired-password"] });
    expect(await store.transaction((tx) => tx.deleteExpiredAuthenticationData("2026-09-28T00:00:00.000Z", nextBatch.sessions, nextBatch.passwordChangeTokens))).toBe(1);
    expect(await store.listExpiredAuthenticationData("2026-09-28T00:00:00.000Z", 10)).toEqual({ sessions: [], passwordChangeTokens: [] });
  });

  it("deduplicates audit writes with a rebuilt index and restores it after rollback", async () => {
    const store = new ReloadableMemoryStore(false);
    await store.saveAuditLog(audit("one", "request-1"));
    await store.saveAuditLog(audit("duplicate", "request-1"));
    const reloaded = new ReloadableMemoryStore(false);
    reloaded.reload(store.serialize());
    await reloaded.saveAuditLog(audit("duplicate-after-reload", "request-1"));
    await expect(reloaded.transaction(async (tx) => {
      await tx.saveAuditLog(audit("rolled-back", "request-2"));
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    await reloaded.saveAuditLog(audit("committed", "request-2"));
    const logs = await reloaded.listAuditLogs(10);
    expect(logs.map((value) => value.id)).toEqual(expect.arrayContaining(["committed", "one"]));
    expect(logs).toHaveLength(2);
  });

  it("reports warning and critical payload crossings once without payload contents", async () => {
    const { AggregatePayloadMonitor } = await import("./mysql-store.js");
    const alert = vi.fn();
    const monitor = new AggregatePayloadMonitor(10, 20, alert);
    monitor.observe(9);
    expect(monitor.status()).toEqual({ payloadBytes: 9, tier: "ok" });
    monitor.observe(10);
    monitor.observe(15);
    monitor.observe(20);
    monitor.observe(25);
    expect(alert.mock.calls.map(([value]) => value)).toEqual([
      { payloadBytes: 10, tier: "warning" },
      { payloadBytes: 20, tier: "critical" },
    ]);
    expect(monitor.status()).toEqual({ payloadBytes: 25, tier: "critical" });
    monitor.observe(5);
    monitor.observe(10);
    expect(alert).toHaveBeenCalledTimes(3);
  });
});
