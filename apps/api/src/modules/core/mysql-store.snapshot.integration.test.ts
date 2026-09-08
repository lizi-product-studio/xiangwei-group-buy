import { randomUUID } from "node:crypto";
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithInternalWriteActor } from "../auth/internal-write-context.js";
import { MysqlStore } from "./mysql-store.js";
import { MemoryStore } from "./store.js";
import type { User } from "./types.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const required = process.env.REQUIRE_INTEGRATION_TESTS === "true";
const user = (id = randomUUID()): User => ({ id, wechatOpenId: null, status: "ACTIVE", createdAt: new Date().toISOString() });
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};
// A bounded race prevents an accidental FOR UPDATE read from hanging the suite.
const promptly = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Read blocked behind an uncommitted writer")), 1500);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

it.runIf(required)("requires real MySQL configuration for snapshot integration", () => {
  expect(databaseUrl).toBeTruthy();
});

describe.skipIf(!databaseUrl)("MysqlStore real isolated aggregate scopes", () => {
  let first: MysqlStore;
  let second: MysqlStore;
  let control: Pool;
  beforeAll(async () => {
    first = MysqlStore.create(databaseUrl!);
    second = MysqlStore.create(databaseUrl!);
    control = mysql.createPool({ uri: databaseUrl!, timezone: "Z" });
    await first.health();
  });
  afterAll(async () => {
    await Promise.all([first.close(), second.close(), control.end()]);
  });
  async function stored() {
    const [rows] = await control.query<RowDataPacket[]>("SELECT CAST(payload AS CHAR) AS payload, CAST(updated_at AS CHAR) AS updatedAt FROM community_product_state WHERE id=1");
    return rows[0];
  }

  it("loads one plain SELECT for repeated/nested reads and never persists", async () => {
    const value = { ...user(), wechatOpenId: `snapshot-${randomUUID()}` };
    await first.saveUser(value);
    const before = await stored();
    const pool = (first as unknown as { pool: Pool }).pool;
    const acquire = pool.getConnection.bind(pool);
    const querySpies: Array<ReturnType<typeof vi.spyOn<PoolConnection, "query">>> = [];
    const acquisition = vi.spyOn(pool, "getConnection").mockImplementation(async () => {
      const connection = await acquire();
      querySpies.push(vi.spyOn(connection, "query"));
      return connection;
    });
    try {
      await first.readSnapshot(async scoped => {
        expect(scoped).toBe(first);
        expect(await scoped.getUser(value.id)).toEqual(value);
        expect(await first.getUser(value.id)).toEqual(value);
        await first.readSnapshot(async nested => {
          expect(await nested.listConsumerUsers()).toContainEqual(value);
        });
      });
      expect(acquisition).toHaveBeenCalledTimes(1);
      const queries = querySpies.flatMap(spy => spy.mock.calls.map(call => String(call[0])));
      expect(queries).toEqual(["SELECT payload FROM community_product_state WHERE id=1"]);
      expect(await stored()).toEqual(before);
    } finally {
      querySpies.forEach(spy => spy.mockRestore());
      acquisition.mockRestore();
    }
  });

  it("keeps overlapping snapshots independent across a committed write on the same store", async () => {
    const value = user();
    const loaded = gate(); const resume = gate();
    const oldRead = first.readSnapshot(async scoped => {
      expect(await scoped.getUser(value.id)).toBeNull();
      loaded.release();
      await resume.promise;
      expect(await scoped.getUser(value.id)).toBeNull();
    });
    await loaded.promise;
    try {
      await first.saveUser(value);
      await first.readSnapshot(async scoped => {
        expect(await scoped.getUser(value.id)).toEqual(value);
      });
    } finally { resume.release(); }
    await oldRead;
  });

  it("does not read uncommitted state or block readers behind the writer row lock", async () => {
    const value = user();
    const written = gate(); const release = gate();
    const writing = first.transaction(async scoped => {
      await scoped.saveUser(value);
      expect(await scoped.readSnapshot(tx => tx.getUser(value.id))).toEqual(value);
      written.release();
      await release.promise;
    });
    await written.promise;
    try {
      const values = await promptly(Promise.all([first.getUser(value.id), second.getUser(value.id)]));
      expect(values).toEqual([null, null]);
    } finally { release.release(); }
    await writing;
    expect(await second.getUser(value.id)).toEqual(value);
  });

  it("serializes independent pool writes and retains both updates", async () => {
    const a = user(); const b = user();
    const held = gate(); const release = gate();
    const writing = first.transaction(async scoped => {
      await scoped.saveUser(a); held.release(); await release.promise;
    });
    await held.promise;
    let secondEntered = false;
    const other = second.transaction(async scoped => {
      secondEntered = true;
      expect(await scoped.getUser(a.id)).toEqual(a);
      await scoped.saveUser(b);
    });
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(secondEntered).toBe(false);
    } finally { release.release(); }
    await Promise.all([writing, other]);
    expect(await first.getUser(a.id)).toEqual(a);
    expect(await first.getUser(b.id)).toEqual(b);
  });

  it("rolls back writes and reuses the locked snapshot for nested transactions", async () => {
    const value = user();
    await expect(first.transaction(async scoped => {
      await scoped.saveUser(value);
      await scoped.transaction(async nested => {
        expect(await nested.getUser(value.id)).toEqual(value);
      });
      throw new Error("intentional rollback");
    })).rejects.toThrow("intentional rollback");
    expect(await first.getUser(value.id)).toBeNull();
    expect(await second.getUser(value.id)).toBeNull();
  });

  it("rejects writes, ForUpdate, expiry-cleaning getters, and transactions in readonly scopes", async () => {
    const value = user(); const before = await stored();
    await first.readSnapshot(async scoped => {
      await expect(scoped.saveUser(value)).rejects.toThrow(/Readonly/);
      await expect(scoped.getOrderForUpdate("absent")).rejects.toThrow(/Readonly/);
      await expect(scoped.getAuthSession("absent")).rejects.toThrow(/Readonly/);
      await expect(scoped.getPasswordChangeToken("absent")).rejects.toThrow(/Readonly/);
      await expect(scoped.transaction(async () => undefined)).rejects.toThrow(/Readonly/);
    });
    expect(await stored()).toEqual(before);
    expect(await first.getUser(value.id)).toBeNull();
  });

  it("keeps expiry-cleaning getters on the write path", async () => {
    const value = user();
    const tokenHash = randomUUID();
    await first.saveUser(value);
    await first.saveAuthSession({ tokenHash, userId: value.id, expiresAt: "2000-01-01T00:00:00.000Z", createdAt: value.createdAt });
    const before = JSON.parse(String((await stored())!.payload)) as { sessions: Array<[string, unknown]> };
    expect(before.sessions.some(([key]) => key === tokenHash)).toBe(true);
    expect(await first.getAuthSession(tokenHash)).toBeNull();
    const after = JSON.parse(String((await stored())!.payload)) as { sessions: Array<[string, unknown]> };
    expect(after.sessions.some(([key]) => key === tokenHash)).toBe(false);
  });

  it("pure active-session reads reject expiry, revocation and other users without persisting", async () => {
    const a = user(); const b = user();
    const key = randomUUID(); const otherKey = randomUUID();
    await first.saveUser(a); await first.saveUser(b);
    await first.saveAuthSession({tokenHash: key, userId: a.id, roles: ["USER"], authorizationVersion: 0, expiresAt: new Date(Date.now()+60_000).toISOString()});
    await first.saveAuthSession({tokenHash: otherKey, userId: b.id, roles: ["USER"], authorizationVersion: 0, expiresAt: "2000-01-01T00:00:00.000Z"});
    const before = await stored();
    await first.readSnapshot(async scoped => {
      expect(await scoped.getActiveAuthSession(key)).toMatchObject({userId: a.id});
      expect(await scoped.getActiveAuthSession(otherKey)).toBeNull();
      expect(await scoped.getActiveAuthSession(randomUUID())).toBeNull();
    });
    expect(await stored()).toEqual(before);
    await second.saveUser({...a, status: "SUSPENDED"});
    expect(await first.getActiveAuthSession(key)).toBeNull();
    await second.saveUser(a);
    expect(await first.getActiveAuthSession(key)).toMatchObject({userId: a.id});
    await second.deleteAuthSession(key);
    expect(await first.getActiveAuthSession(key)).toBeNull();
  });

  it("defaults a newly introduced store method to the locked write path", async () => {
    const value = user();
    const method = "snapshotTestFutureWrite";
    Object.defineProperty(MemoryStore.prototype, method, {
      configurable: true,
      value: async function(this: MemoryStore, next: User) { await this.saveUser(next); },
    });
    try {
      const extended = first as unknown as Record<string, (next: User) => Promise<void>>;
      await first.readSnapshot(async () => {
        await expect(extended[method]!(value)).rejects.toThrow(/Readonly/);
      });
      await extended[method]!(value);
      expect(await second.getUser(value.id)).toEqual(value);
    } finally { Reflect.deleteProperty(MemoryStore.prototype, method); }
  });

  it("rejects async work inherited from a completed scope", async () => {
    const resume = gate();
    let lateRead!: Promise<User | null>;
    await first.readSnapshot(async () => {
      lateRead = resume.promise.then(() => first.getUser("absent"));
    });
    const assertion = expect(lateRead).rejects.toThrow(/already completed/);
    resume.release();
    await assertion;
  });

  it("keeps internal-write actor revision checks ahead of mutation", async () => {
    const value = user();
    await expect(runWithInternalWriteActor({ userId: "absent-staff", roles: ["OPERATOR"], authorizationVersion: 1 }, () => first.saveUser(value))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await second.getUser(value.id)).toBeNull();
  });

  it("uses database time inside write snapshots for notification lease checks", async () => {
    await first.transaction(async scoped => {
      const actual = await scoped.databaseNow();
      const [rows] = await control.query<RowDataPacket[]>("SELECT UTC_TIMESTAMP(3) AS now");
      expect(Math.abs(Date.parse(actual) - new Date(rows[0]!.now as Date).getTime())).toBeLessThan(2000);
    });
  });
});
