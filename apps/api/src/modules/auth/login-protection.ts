import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Redis } from "ioredis";
import { BusinessError } from "@hometown/domain";

export const securityHash = (value: string): string => createHash("sha256").update(value).digest("hex");
export interface ChallengeContext { origin: string; browser: string; subject: string; purpose: "login" | "reauth" | "password" }
interface Challenge { id: string; binding: string; expires: number; bits: number }
const TTL_MS = 120_000;
const PREFIX = "hometown:staff-security:v1:";
const busy = () => new BusinessError("AUTH_BUSY", "登录请求较多，请重试", 503);
const invalid = () => new BusinessError("AUTH_CHALLENGE_INVALID", "安全验证已失效，请重试", 400);

/** Work is paid before scrypt, without an account failure counter or lockout.
 * Redis serializes replay consumption and shared admission across API processes.
 * A local cap remains in force even if a shared lease expires during a stall. */
export class LoginProtection {
  private key = randomBytes(32);
  private readonly redis: Redis | null;
  private readonly used = new Map<string, number>();
  private readonly ips = new Map<string, number>();
  private active = 0;
  public constructor(private readonly bits: number, redisUrl?: string) {
    this.redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3000 }) : null;
    this.redis?.on("error", () => { /* callers return a fixed error, never the connection URL */ });
  }
  public async initialize(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.connect();
      await this.redis.set(`${PREFIX}key`, this.key.toString("hex"), "NX");
      const key = await this.redis.get(`${PREFIX}key`);
      if (!key || !/^[a-f0-9]{64}$/.test(key)) throw busy();
      this.key = Buffer.from(key, "hex");
    } catch { this.redis.disconnect(); throw busy(); }
  }
  private binding(context: ChallengeContext): string { return securityHash(JSON.stringify(context)); }
  public issue(context: ChallengeContext): { challenge: string; bits: number; expiresAt: string } {
    const value: Challenge = { id: randomBytes(20).toString("hex"), binding: this.binding(context), expires: Date.now() + TTL_MS, bits: this.bits };
    const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
    const signature = createHmac("sha256", this.key).update(encoded).digest("base64url");
    return { challenge: `${encoded}.${signature}`, bits: value.bits, expiresAt: new Date(value.expires).toISOString() };
  }
  private verify(context: ChallengeContext, token: unknown, nonce: unknown): Challenge {
    if (typeof token !== "string" || token.length > 1024 || typeof nonce !== "string" || !/^\d{1,12}$/.test(nonce)) throw invalid();
    const [encoded, signature, extra] = token.split(".");
    if (!encoded || !signature || extra) throw invalid();
    const actual = Buffer.from(signature, "base64url");
    const expected = createHmac("sha256", this.key).update(encoded).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
    let value: Challenge;
    try { value = JSON.parse(Buffer.from(encoded, "base64url").toString()) as Challenge; } catch { throw invalid(); }
    if (value.binding !== this.binding(context) || value.expires <= Date.now() || value.bits !== this.bits) throw invalid();
    const digest = createHash("sha256").update(`${token}:${nonce}`).digest();
    for (let bit = 0; bit < value.bits; bit += 1) if ((digest[Math.floor(bit / 8)]! & (128 >> (bit % 8))) !== 0) throw invalid();
    return value;
  }
  public async run<T>(context: ChallengeContext, token: unknown, nonce: unknown, ip: string, work: () => Promise<T>): Promise<T> {
    const value = this.verify(context, token, nonce);
    const ipKey = securityHash(ip);
    if (this.active >= 4 || (this.ips.get(ipKey) ?? 0) >= 2) throw busy();
    this.active += 1;
    this.ips.set(ipKey, (this.ips.get(ipKey) ?? 0) + 1);
    let acquired = false;
    try {
      if (this.redis) {
        const result = await this.redis.eval(`
          local now = redis.call('TIME'); local ms = now[1] * 1000 + math.floor(now[2] / 1000)
          redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ms)
          redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ms)
          if redis.call('EXISTS', KEYS[1]) == 1 then return -1 end
          if redis.call('ZCARD', KEYS[2]) >= 4 or redis.call('ZCARD', KEYS[3]) >= 2 then return 0 end
          redis.call('SET', KEYS[1], '1', 'PX', 120000)
          redis.call('ZADD', KEYS[2], ms + 30000, ARGV[1]); redis.call('PEXPIRE', KEYS[2], 30000)
          redis.call('ZADD', KEYS[3], ms + 30000, ARGV[1]); redis.call('PEXPIRE', KEYS[3], 30000)
          return 1`, 3, `${PREFIX}used:${value.id}`, `${PREFIX}active`, `${PREFIX}ip:${ipKey}`, value.id).catch(() => {
          // Redis connection errors can contain credentials; expose only a fixed error.
          throw busy();
        });
        if (result === -1) throw invalid();
        if (result !== 1) throw busy();
        acquired = true;
      } else {
        for (const [key, expires] of this.used) if (expires <= Date.now()) this.used.delete(key);
        if (this.used.has(value.id)) throw invalid();
        if (this.used.size >= 4096) throw busy();
        this.used.set(value.id, value.expires);
      }
      return await work();
    } finally {
      this.active -= 1;
      const count = (this.ips.get(ipKey) ?? 1) - 1;
      if (count) this.ips.set(ipKey, count); else this.ips.delete(ipKey);
      if (acquired) await this.redis!.pipeline().zrem(`${PREFIX}active`, value.id).zrem(`${PREFIX}ip:${ipKey}`, value.id).exec().catch(() => undefined);
    }
  }
  public async health(): Promise<"ok" | "degraded"> {
    try { return !this.redis || await this.redis.ping() === "PONG" ? "ok" : "degraded"; } catch { return "degraded"; }
  }
  public close(): void { this.redis?.disconnect(); }
}
