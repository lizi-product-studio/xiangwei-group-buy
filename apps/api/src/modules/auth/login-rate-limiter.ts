import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { BusinessError } from "@hometown/domain";

const WINDOW_SECONDS = 15 * 60;
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 20;

type Counter = { count: number; resetAt: number; windowId: string };

export interface LoginRateLimiter {
  claim(ip: string, username: string): Promise<LoginAttemptClaim>;
  recordFailure(claim: LoginAttemptClaim): Promise<void>;
  clearSuccessfulLogin(claim: LoginAttemptClaim): Promise<void>;
  health(): Promise<"ok" | "degraded">;
  close(): Promise<void>;
}

export interface LoginAttemptClaim {
  id: string;
  ip: string;
  username: string;
  source: "memory" | "redis";
  accountWindowId: string;
  ipWindowId: string;
}

function limited(retryAfterSeconds: number): BusinessError {
  return new BusinessError(
    "LOGIN_RATE_LIMITED",
    "登录尝试过于频繁，请稍后再试",
    429,
    { retryAfterSeconds },
  );
}

class MemoryLoginRateLimiter implements LoginRateLimiter {
  private readonly account = new Map<string, Counter>();
  private readonly ip = new Map<string, Counter>();
  private readonly claims = new Map<string, LoginAttemptClaim>();

  private read(map: Map<string, Counter>, key: string, now: number): Counter {
    const current = map.get(key);
    if (!current || current.resetAt <= now) {
      const next = {
        count: 0,
        resetAt: now + WINDOW_SECONDS * 1_000,
        windowId: randomUUID(),
      };
      map.set(key, next);
      return next;
    }
    return current;
  }

  public async claim(ip: string, username: string): Promise<LoginAttemptClaim> {
    const now = Date.now();
    const normalized = username.trim().toLowerCase();
    const account = this.read(this.account, normalized, now);
    const address = this.read(this.ip, ip, now);
    if (account.count >= ACCOUNT_LIMIT || address.count >= IP_LIMIT) {
      const activeResetTimes = [
        ...(account.count >= ACCOUNT_LIMIT ? [account.resetAt] : []),
        ...(address.count >= IP_LIMIT ? [address.resetAt] : []),
      ];
      const resetAt = Math.max(...activeResetTimes);
      throw limited(Math.max(1, Math.ceil((resetAt - now) / 1_000)));
    }
    account.count += 1;
    address.count += 1;
    const claim: LoginAttemptClaim = {
      id: randomUUID(),
      ip,
      username: normalized,
      source: "memory",
      accountWindowId: account.windowId,
      ipWindowId: address.windowId,
    };
    this.claims.set(claim.id, claim);
    return claim;
  }

  public async recordFailure(claim: LoginAttemptClaim): Promise<void> {
    this.claims.delete(claim.id);
  }

  public async clearSuccessfulLogin(claim: LoginAttemptClaim): Promise<void> {
    if (!this.claims.delete(claim.id)) return;
    const account = this.account.get(claim.username);
    const address = this.ip.get(claim.ip);
    if (account?.windowId === claim.accountWindowId) {
      account.count -= 1;
      if (account.count <= 0) this.account.delete(claim.username);
    }
    if (address?.windowId === claim.ipWindowId) {
      address.count -= 1;
      if (address.count <= 0) this.ip.delete(claim.ip);
    }
  }

  public async health(): Promise<"ok"> {
    return "ok";
  }

  public async close(): Promise<void> {}
}

/**
 * Redis-backed counters are used in production so the account+IP and IP
 * windows remain shared across API instances. Redis errors fail closed in
 * production; local/test runs use the deterministic in-memory adapter.
 */
class RedisLoginRateLimiter implements LoginRateLimiter {
  private readonly fallback = new MemoryLoginRateLimiter();
  public constructor(
    private readonly redis: Redis,
    private readonly strict: boolean,
  ) {}

  private async withRedis<T>(
    work: () => Promise<T>,
    fallback: () => Promise<T> | T,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof BusinessError) throw error;
      if (this.strict)
        throw new BusinessError(
          "UPSTREAM_UNAVAILABLE",
          "登录保护服务暂时不可用，请稍后重试",
          503,
        );
      return await fallback();
    }
  }

  public async claim(ip: string, username: string): Promise<LoginAttemptClaim> {
    const normalized = username.trim().toLowerCase();
    const claim: LoginAttemptClaim = {
      id: randomUUID(),
      ip,
      username: normalized,
      source: "redis",
      accountWindowId: randomUUID(),
      ipWindowId: randomUUID(),
    };
    return this.withRedis(async () => {
      const result = (await this.redis.eval(
        `local account = tonumber(redis.call('GET', KEYS[1]) or '0')
         local address = tonumber(redis.call('GET', KEYS[2]) or '0')
         local function window(key, generationKey, proposedGeneration)
           local generation = redis.call('GET', generationKey)
           if not generation then
             generation = proposedGeneration
             redis.call('SET', generationKey, generation)
           end
           local ttl = redis.call('TTL', key)
           if ttl < 0 then
             redis.call('EXPIRE', key, ARGV[3])
             ttl = tonumber(ARGV[3])
           end
           local generationTtl = redis.call('TTL', generationKey)
           if generationTtl < 0 then redis.call('EXPIRE', generationKey, ttl) end
           return { generation, ttl }
         end
         local accountWindow = window(KEYS[1], KEYS[3], ARGV[4])
         local ipWindow = window(KEYS[2], KEYS[4], ARGV[5])
         if account >= tonumber(ARGV[1]) or address >= tonumber(ARGV[2]) then
           local retry = 1
           if account >= tonumber(ARGV[1]) then retry = math.max(retry, accountWindow[2]) end
           if address >= tonumber(ARGV[2]) then retry = math.max(retry, ipWindow[2]) end
           return { 0, retry }
         end
         local function reserve(key, generationKey, currentWindow)
           redis.call('INCR', key)
           local ttl = redis.call('TTL', key)
           if ttl < 0 then redis.call('EXPIRE', key, ARGV[3]) end
           local generationTtl = redis.call('TTL', generationKey)
           if generationTtl < 0 then redis.call('EXPIRE', generationKey, ARGV[3]) end
           return currentWindow
         end
         accountWindow = reserve(KEYS[1], KEYS[3], accountWindow)
         ipWindow = reserve(KEYS[2], KEYS[4], ipWindow)
         local claimTtl = math.max(1, math.min(accountWindow[2], ipWindow[2]))
         redis.call('SET', KEYS[5], '1', 'EX', claimTtl, 'NX')
         return { 1, claimTtl, accountWindow[1], ipWindow[1] }`,
        5,
        `admin-login:account:${normalized}`,
        `admin-login:ip:${ip}`,
        `admin-login:account-window:${normalized}`,
        `admin-login:ip-window:${ip}`,
        `admin-login:claim:${claim.id}`,
        ACCOUNT_LIMIT,
        IP_LIMIT,
        WINDOW_SECONDS,
        claim.accountWindowId,
        claim.ipWindowId,
      )) as [number, number, string?, string?];
      if (Number(result[0]) !== 1) throw limited(Math.max(1, Number(result[1])));
      claim.accountWindowId = String(result[2]);
      claim.ipWindowId = String(result[3]);
      return claim;
    }, () => this.fallback.claim(ip, normalized));
  }

  public async recordFailure(claim: LoginAttemptClaim): Promise<void> {
    if (claim.source === "memory") return this.fallback.recordFailure(claim);
    await this.withRedis(async () => {
      await this.redis.del(`admin-login:claim:${claim.id}`);
    }, () => undefined);
  }

  public async clearSuccessfulLogin(claim: LoginAttemptClaim): Promise<void> {
    if (claim.source === "memory") return this.fallback.clearSuccessfulLogin(claim);
    await this.withRedis(async () => {
      await this.redis.eval(
        `if redis.call('DEL', KEYS[1]) == 0 then return 0 end
         local function release(key, generationKey, expectedGeneration)
           if redis.call('GET', generationKey) ~= expectedGeneration then return end
           local count = tonumber(redis.call('GET', key) or '0')
           if count <= 1 then
             redis.call('DEL', key)
             redis.call('DEL', generationKey)
           else
             redis.call('DECR', key)
           end
         end
         release(KEYS[2], KEYS[4], ARGV[1])
         release(KEYS[3], KEYS[5], ARGV[2])
         return 1`,
        5,
        `admin-login:claim:${claim.id}`,
        `admin-login:account:${claim.username}`,
        `admin-login:ip:${claim.ip}`,
        `admin-login:account-window:${claim.username}`,
        `admin-login:ip-window:${claim.ip}`,
        claim.accountWindowId,
        claim.ipWindowId,
      );
    }, () => undefined);
  }

  public async health(): Promise<"ok" | "degraded"> {
    try {
      return (await this.redis.ping()) === "PONG" ? "ok" : "degraded";
    } catch {
      return "degraded";
    }
  }

  public async close(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

export function createLoginRateLimiter(
  redis: Redis | null,
  strict: boolean,
): LoginRateLimiter {
  return redis ? new RedisLoginRateLimiter(redis, strict) : new MemoryLoginRateLimiter();
}
