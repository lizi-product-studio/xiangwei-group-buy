import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { BusinessError } from "@hometown/domain";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../config.js";
import { MemoryStore } from "../core/store.js";
import { createAdminCredential } from "./admin-auth.js";
import { createLoginRateLimiter } from "./login-rate-limiter.js";

function redisStub(overrides: Partial<Redis>): Redis {
  return {
    get: vi.fn(async () => null),
    ttl: vi.fn(async () => 900),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    eval: vi.fn(async () => [1, 900, "account-window", "ip-window"]),
    del: vi.fn(async () => 1),
    ping: vi.fn(async () => "PONG"),
    quit: vi.fn(async () => "OK"),
    ...overrides,
  } as unknown as Redis;
}

async function saveLoginFixture(store: MemoryStore): Promise<void> {
  const now = new Date().toISOString();
  await store.saveUser({ id: "limited-admin", wechatOpenId: null, status: "ACTIVE", createdAt: now });
  await store.replaceUserRoles("limited-admin", ["SUPER_ADMIN"]);
  await store.saveInternalStaff({
    userId: "limited-admin",
    staffNo: "STF-LIMIT",
    displayName: "限流管理员",
    phone: "13800138000",
    role: "SUPER_ADMIN",
    status: "ACTIVE",
    createdBy: null,
    activatedAt: now,
    suspendedAt: null,
    suspensionReason: null,
    authorizationVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  await store.saveAdminCredential(
    await createAdminCredential(
      "limited.admin",
      "limited-admin",
      "correct limited password",
    ),
  );
}

describe("admin login rate limiter", () => {
  it("limits five failures per account and rolls back only the successful claim", async () => {
    const limiter = createLoginRateLimiter(null, false);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const claim = await limiter.claim("10.0.0.1", "ops.admin");
      await limiter.recordFailure(claim);
    }
    const successfulClaim = await limiter.claim("10.0.0.1", "ops.admin");
    await limiter.clearSuccessfulLogin(successfulClaim);
    const fifthFailure = await limiter.claim("10.0.0.1", "ops.admin");
    await limiter.recordFailure(fifthFailure);
    await expect(limiter.claim("10.0.0.1", "ops.admin")).rejects.toMatchObject({
      code: "LOGIN_RATE_LIMITED",
      statusCode: 429,
    });
    await limiter.close();
  });

  it("counts one account across different IP addresses", async () => {
    const limiter = createLoginRateLimiter(null, false);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const ip = `10.0.1.${attempt + 1}`;
      const claim = await limiter.claim(ip, "OPS.ADMIN");
      await limiter.recordFailure(claim);
    }
    await expect(limiter.claim("10.0.1.99", "ops.admin")).rejects.toMatchObject({
      code: "LOGIN_RATE_LIMITED",
      statusCode: 429,
    });
    await limiter.close();
  });

  it("limits twenty accounts from one IP independently of account counters", async () => {
    const limiter = createLoginRateLimiter(null, false);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const username = `ops.${attempt}`;
      const claim = await limiter.claim("10.0.0.2", username);
      await limiter.recordFailure(claim);
    }
    const error = await limiter.claim("10.0.0.2", "another.account").catch((value) => value);
    expect(error).toBeInstanceOf(BusinessError);
    expect(error).toMatchObject({ code: "LOGIN_RATE_LIMITED", statusCode: 429 });
    await limiter.close();
  });

  it("does not clear an IP risk window when an unrelated account succeeds", async () => {
    const limiter = createLoginRateLimiter(null, false);
    for (let attempt = 0; attempt < 19; attempt += 1) {
      const claim = await limiter.claim("10.0.0.3", `failed.${attempt}`);
      await limiter.recordFailure(claim);
    }
    const successfulClaim = await limiter.claim("10.0.0.3", "successful.account");
    await limiter.clearSuccessfulLogin(successfulClaim);
    const finalFailure = await limiter.claim("10.0.0.3", "another.account");
    await limiter.recordFailure(finalFailure);
    await expect(limiter.claim("10.0.0.3", "blocked.account")).rejects.toMatchObject({
      code: "LOGIN_RATE_LIMITED",
      statusCode: 429,
    });
    await limiter.close();
  });

  it("preserves a Redis threshold BusinessError as 429 with its Retry-After", async () => {
    const redis = redisStub({
      eval: vi.fn(async () => [0, 321]),
    });
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store: new MemoryStore(false),
      loginRateLimiter: createLoginRateLimiter(redis, true),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/login",
        payload: { username: "ops.admin", password: "not a real password" },
      });
      expect(response.statusCode, response.body).toBe(429);
      expect(response.headers["retry-after"]).toBe("321");
      expect(response.json()).toMatchObject({
        code: "LOGIN_RATE_LIMITED",
        details: { retryAfterSeconds: 321 },
      });
    } finally {
      await app.close();
    }
  });

  it("returns a controlled 503 without Redis connection details", async () => {
    const redis = redisStub({
      eval: vi.fn(async () => {
        throw new Error("redis://admin:secret@internal.example:6379 refused");
      }),
    });
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store: new MemoryStore(false),
      loginRateLimiter: createLoginRateLimiter(redis, true),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/login",
        payload: { username: "ops.admin", password: "not a real password" },
      });
      expect(response.statusCode, response.body).toBe(503);
      expect(response.json()).toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        message: "登录保护服务暂时不可用，请稍后重试",
      });
      expect(response.json()).not.toHaveProperty("details");
      expect(response.body).not.toContain("internal.example");
      expect(response.body).not.toContain("secret");
    } finally {
      await app.close();
    }
  });

  it("claims account and IP capacity with expiry in one Redis operation", async () => {
    const evalMock = vi.fn(async () => [1, 900, "account-window", "ip-window"]);
    const redis = redisStub({ eval: evalMock });
    const limiter = createLoginRateLimiter(redis, true);
    const claim = await limiter.claim("10.0.0.4", "ops.admin");
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0]?.slice(1, 7)).toEqual([
      5,
      "admin-login:account:ops.admin",
      "admin-login:ip:10.0.0.4",
      "admin-login:account-window:ops.admin",
      "admin-login:ip-window:10.0.0.4",
      `admin-login:claim:${claim.id}`,
    ]);
    const script = String(evalMock.mock.calls[0]?.[0]);
    expect(script).toContain("redis.call('INCR', key)");
    expect(script).toContain("redis.call('EXPIRE', key, ARGV[3])");
    expect(script.indexOf("if ttl < 0 then")).toBeLessThan(
      script.indexOf("if account >= tonumber(ARGV[1])"),
    );
    expect(redis.incr).not.toHaveBeenCalled();
    expect(redis.expire).not.toHaveBeenCalled();
    await limiter.close();
  });

  it("admits at most five concurrent claims for one account across IPs", async () => {
    const limiter = createLoginRateLimiter(null, false);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        limiter.claim(`10.0.2.${index + 1}`, "same.admin"),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(5);
    expect(rejected.every((result) => result.reason?.code === "LOGIN_RATE_LIMITED")).toBe(true);
    await limiter.close();
  });

  it("returns 429 for five of ten concurrent wrong-password requests across IPs", async () => {
    let accountCount = 0;
    const ipCounts = new Map<string, number>();
    const claimKeys = new Set<string>();
    const redis = redisStub({
      eval: vi.fn(async (script: string, _keyCount: number, ...args: Array<string | number>) => {
        if (script.includes("local account")) {
          const accountKey = String(args[0]);
          const ipKey = String(args[1]);
          const claimKey = String(args[4]);
          expect(accountKey).toBe("admin-login:account:limited.admin");
          const ipCount = ipCounts.get(ipKey) ?? 0;
          if (accountCount >= 5 || ipCount >= 20) return [0, 900];
          accountCount += 1;
          ipCounts.set(ipKey, ipCount + 1);
          claimKeys.add(claimKey);
          return [1, 900, "account-window", `ip-window-${ipKey}`];
        }
        throw new Error("unexpected Redis script");
      }),
      del: vi.fn(async (...keys: string[]) => {
        let deleted = 0;
        for (const key of keys) if (claimKeys.delete(key)) deleted += 1;
        return deleted;
      }),
    });
    const store = new MemoryStore(false);
    await saveLoginFixture(store);
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test", TRUST_PROXY: "true" }),
      store,
      loginRateLimiter: createLoginRateLimiter(redis, true),
    });
    try {
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          app.inject({
            method: "POST",
            url: "/api/v1/auth/admin/login",
            headers: { "x-forwarded-for": `10.9.0.${index + 1}` },
            payload: { username: "limited.admin", password: "wrong password value" },
          }),
        ),
      );
      expect(responses.filter((response) => response.statusCode === 401)).toHaveLength(5);
      expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(5);
      expect(accountCount).toBe(5);
    } finally {
      await app.close();
    }
  });

  it("releases only the successful Redis claim without erasing concurrent failures", async () => {
    let accountCount = 0;
    let ipCount = 0;
    const claims = new Set<string>();
    const redis = redisStub({
      eval: vi.fn(async (script: string, _keyCount: number, ...args: Array<string | number>) => {
        if (script.includes("local account")) {
          if (accountCount >= 5 || ipCount >= 20) return [0, 900];
          accountCount += 1;
          ipCount += 1;
          claims.add(String(args[4]));
          return [1, 900, "account-window", "ip-window"];
        }
        if (script.includes("local function release")) {
          const claimKey = String(args[0]);
          if (!claims.delete(claimKey)) return 0;
          accountCount = Math.max(0, accountCount - 1);
          ipCount = Math.max(0, ipCount - 1);
          return 1;
        }
        throw new Error("unexpected Redis script");
      }),
      del: vi.fn(async (...keys: string[]) => {
        let deleted = 0;
        for (const key of keys) if (claims.delete(key)) deleted += 1;
        return deleted;
      }),
    });
    const limiter = createLoginRateLimiter(redis, true);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const claim = await limiter.claim("10.0.3.1", "ops.admin");
      await limiter.recordFailure(claim);
    }
    const successfulClaim = await limiter.claim("10.0.3.1", "ops.admin");
    await limiter.clearSuccessfulLogin(successfulClaim);
    expect(accountCount).toBe(4);
    await limiter.clearSuccessfulLogin(successfulClaim);
    expect(accountCount).toBe(4);
    const fifthFailure = await limiter.claim("10.0.3.2", "ops.admin");
    await limiter.recordFailure(fifthFailure);
    await expect(limiter.claim("10.0.3.3", "ops.admin")).rejects.toMatchObject({
      code: "LOGIN_RATE_LIMITED",
      statusCode: 429,
    });
    expect(accountCount).toBe(5);
    await limiter.close();
  });

  it("repairs an over-limit Redis counter without TTL before returning 429", async () => {
    const evalMock = vi.fn(async () => [0, 900]);
    const limiter = createLoginRateLimiter(redisStub({ eval: evalMock }), true);
    await expect(limiter.claim("10.0.4.1", "ops.admin")).rejects.toMatchObject({
      code: "LOGIN_RATE_LIMITED",
      statusCode: 429,
      details: { retryAfterSeconds: 900 },
    });
    const script = String(evalMock.mock.calls[0]?.[0]);
    expect(script.indexOf("if ttl < 0 then")).toBeLessThan(
      script.indexOf("if account >= tonumber(ARGV[1])"),
    );
    expect(script).toContain("redis.call('EXPIRE', key, ARGV[3])");
    await limiter.close();
  });

  it("does not let a Memory claim from an expired window decrement the next window", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-03T00:00:00.000Z"));
      const limiter = createLoginRateLimiter(null, false);
      const oldClaim = await limiter.claim("10.0.5.1", "ops.admin");
      vi.setSystemTime(new Date("2026-09-03T00:15:01.000Z"));
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const claim = await limiter.claim(`10.0.5.${attempt + 2}`, "ops.admin");
        await limiter.recordFailure(claim);
      }
      await limiter.clearSuccessfulLogin(oldClaim);
      await expect(limiter.claim("10.0.5.99", "ops.admin")).rejects.toMatchObject({
        code: "LOGIN_RATE_LIMITED",
        statusCode: 429,
      });
      await limiter.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a Redis claim from an old generation decrement the next window", async () => {
    let accountCount = 1;
    let ipCount = 1;
    let accountWindow = "old-account-window";
    let ipWindow = "old-ip-window";
    let claimKey = "";
    const redis = redisStub({
      eval: vi.fn(async (script: string, _keyCount: number, ...args: Array<string | number>) => {
        if (script.includes("local account")) {
          claimKey = String(args[4]);
          return [1, 1, accountWindow, ipWindow];
        }
        if (script.includes("local function release")) {
          expect(String(args[0])).toBe(claimKey);
          if (String(args[5]) === accountWindow) accountCount -= 1;
          if (String(args[6]) === ipWindow) ipCount -= 1;
          return 1;
        }
        throw new Error("unexpected Redis script");
      }),
    });
    const limiter = createLoginRateLimiter(redis, true);
    const oldClaim = await limiter.claim("10.0.6.1", "ops.admin");
    accountWindow = "new-account-window";
    ipWindow = "new-ip-window";
    accountCount = 5;
    ipCount = 7;
    await limiter.clearSuccessfulLogin(oldClaim);
    expect(accountCount).toBe(5);
    expect(ipCount).toBe(7);
    await limiter.close();
  });

  it("reports Redis login protection as degraded without leaking the ping failure", async () => {
    const redis = redisStub({
      ping: vi.fn(async () => {
        throw new Error("private redis endpoint refused");
      }),
    });
    const limiter = createLoginRateLimiter(redis, true);
    await expect(limiter.health()).resolves.toBe("degraded");
    await limiter.close();
  });

  it("marks readiness degraded when the dedicated login-protection Redis is unavailable", async () => {
    const redis = redisStub({ ping: vi.fn(async () => "NOT_READY") });
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test" }),
      store: new MemoryStore(false),
      loginRateLimiter: createLoginRateLimiter(redis, true),
    });
    try {
      const response = await app.inject({ method: "GET", url: "/health/ready" });
      expect(response.statusCode, response.body).toBe(503);
      expect(response.json()).toMatchObject({
        status: "degraded",
        dependencies: { loginProtection: "degraded" },
      });
    } finally {
      await app.close();
    }
  });
});
