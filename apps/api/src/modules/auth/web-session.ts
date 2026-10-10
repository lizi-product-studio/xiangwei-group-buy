import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { BusinessError } from "@hometown/domain";
import type { AppConfig } from "../../config.js";
import type { AuthSession } from "../core/types.js";
import { ROUTE_PERMISSIONS } from "./access-control.js";
import { securityHash } from "./login-protection.js";

export interface WebBinding { webOrigin: string; webContextHash: string }
declare module "fastify" {
  interface FastifyRequest { staffAuthorization: string | undefined; staffSession: AuthSession | null }
}
export class WebSessions {
  public readonly sessionName: string;
  private readonly contextName: string;
  private readonly secure: boolean;
  public constructor(private readonly config: AppConfig) {
    this.secure = config.REQUIRE_HTTPS || config.NODE_ENV === "production";
    this.sessionName = this.secure ? "__Host-staff-session" : "staff-session";
    this.contextName = this.secure ? "__Host-staff-context" : "staff-context";
  }
  private read(request: FastifyRequest, name: string): string | undefined {
    const matches = (request.headers.cookie ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
    if (matches.length !== 1) return undefined;
    const value = matches[0]!.slice(name.length + 1);
    return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : undefined;
  }
  private write(reply: FastifyReply, name: string, value: string, maxAge: number): void {
    const old = reply.getHeader("set-cookie");
    const cookies = Array.isArray(old) ? old.map(String) : old ? [String(old)] : [];
    reply.header("set-cookie", [...cookies, `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.secure ? "; Secure" : ""}`]);
  }
  public origin(request: FastifyRequest): string {
    const origin = `${this.secure ? "https" : request.protocol}://${request.headers.host ?? ""}`;
    let url: URL;
    try { url = new URL(origin); } catch { throw new BusinessError("FORBIDDEN", "无效的登录站点", 403); }
    const permitted = this.config.STAFF_WEB_ORIGINS.split(",").map(value => value.trim());
    const local = this.config.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!permitted.includes(url.origin) && !local) throw new BusinessError("FORBIDDEN", "无效的登录站点", 403);
    return url.origin;
  }
  public assertSameOrigin(request: FastifyRequest, requireOrigin = true): string {
    const origin = this.origin(request);
    const supplied = request.headers.origin;
    const site = request.headers["sec-fetch-site"];
    if ((requireOrigin && supplied !== origin) || (supplied !== undefined && supplied !== origin) || (site !== undefined && site !== "same-origin" && site !== "none"))
      throw new BusinessError("CSRF_INVALID", "页面验证已失效，请刷新后重试", 403);
    return origin;
  }
  public binding(request: FastifyRequest, reply: FastifyReply, create = false): WebBinding {
    const webOrigin = this.assertSameOrigin(request);
    let browser = this.read(request, this.contextName);
    if (!browser && create) { browser = randomBytes(32).toString("base64url"); this.write(reply, this.contextName, browser, 600); }
    if (!browser) throw new BusinessError("AUTH_CHALLENGE_INVALID", "安全验证已失效，请重试", 400);
    return { webOrigin, webContextHash: securityHash(browser) };
  }
  public authorization(request: FastifyRequest): string | undefined {
    const token = this.read(request, this.sessionName);
    return token ? `Bearer ${token}` : undefined;
  }
  public set(reply: FastifyReply, token: string, expiresAt: string): void {
    this.write(reply, this.sessionName, token, Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)));
    reply.header("cache-control", "no-store");
  }
  public clear(reply: FastifyReply): void { this.write(reply, this.sessionName, "", 0); }
  public assertCsrf(request: FastifyRequest): void {
    this.assertSameOrigin(request);
    const sent = request.headers["x-csrf-token"];
    const expected = request.staffSession?.csrfToken;
    if (typeof sent !== "string" || !expected || Buffer.byteLength(sent) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(sent), Buffer.from(expected)))
      throw new BusinessError("CSRF_INVALID", "页面验证已失效，请刷新后重试", 403);
  }
}

/** Single policy also covers direct API calls; UI visibility is never the gate. */
export function requiresReauthentication(method: string, path: string): boolean {
  if (path === "/api/v1/admin/orders/export" || path === "/api/v1/admin/consumers/:id/phone") return true;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  if (/^\/api\/v1\/admin\/(staff|access\/roles)(\/|$)/.test(path)) return true;
  if (method === "DELETE" && path.startsWith("/api/v1/admin/")) return true;
  return (ROUTE_PERMISSIONS[`${method} ${path}`] ?? []).some(value => ["finance.refund", "campaigns.cancel"].includes(value));
}
