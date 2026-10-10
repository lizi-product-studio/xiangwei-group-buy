import { z } from "zod";
import { adminPasswordSchema } from "@hometown/api-contracts";
import type { WebSessions, WebBinding } from "../modules/auth/web-session.js";
import type { LoginProtection } from "../modules/auth/login-protection.js";
import { runWithInternalWriteActor } from "../modules/auth/internal-write-context.js";
import type { AdminLoginResult } from "../modules/auth/admin-auth.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyInstance } from "fastify";
import {
  adminPasswordChangeSchema,
  adminLoginSchema,
  completeAdminPasswordChangeSchema,
  wechatLoginSchema,
} from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import { requireActor } from "../modules/auth/auth.js";
import type { AdminAuthService } from "../modules/auth/admin-auth.js";
import type { AuthService } from "../modules/auth/wechat-auth.js";

// Password setup remains throttled independently of ordinary staff login.
const adminPasswordChangeRateLimit =
  process.env.NODE_ENV === "test"
    ? { max: 50, timeWindow: "15 minutes" }
    : { max: 5, timeWindow: "15 minutes" };

export function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: {
    authService: AuthService | null;
    adminAuthService: AdminAuthService;
    privacyNoticeVersion: string;
    webSessions: WebSessions;
    loginProtection: LoginProtection;
  },
): void {
  const {
    authService,
    adminAuthService,
    privacyNoticeVersion, webSessions, loginProtection,
  } = dependencies;
  app.post(
    "/api/v1/auth/wechat/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      if (request.staffSession) throw new BusinessError("FORBIDDEN", "请使用独立的消费者登录上下文", 403);
      if (!authService)
        throw new BusinessError("FORBIDDEN", "当前环境未启用微信登录", 403);
      const input = wechatLoginSchema.parse(request.body);
      if (input.privacyVersion !== privacyNoticeVersion)
        throw new BusinessError(
          "VALIDATION_ERROR",
          "隐私说明已更新，请阅读并同意最新版本",
          400,
        );
      return {
        data: await authService.login(input.code, input.privacyVersion, input.phoneCode),
      };
    },
  );
  const challengeInput = z.object({ purpose: z.enum(["login", "reauth", "password"]), username: z.string().trim().max(64).default("") });
  const proofSchema = z.object({ challenge: z.string().max(1024), nonce: z.string().regex(/^\d{1,12}$/) });
  const context = (request: FastifyRequest, binding: WebBinding, purpose: "login" | "reauth" | "password", username = "") => ({
    origin: binding.webOrigin, browser: binding.webContextHash, purpose,
    subject: purpose === "reauth" ? request.staffSession?.tokenHash ?? "" : username.trim().toLowerCase(),
  });
  const respond = async (reply: FastifyReply, result: AdminLoginResult) => {
    reply.header("cache-control", "no-store");
    if (result.nextAction === "CHANGE_PASSWORD") return { data: result };
    webSessions.set(reply, result.accessToken, result.expiresAt);
    return { data: { nextAction: "LOGIN", ...await runWithInternalWriteActor(null, () => adminAuthService.browserIdentity(`Bearer ${result.accessToken}`)) } };
  };
  app.post("/api/v1/auth/admin/challenge", { bodyLimit: 4096, config: { rateLimit: false } }, async (request, reply) => {
    const binding = webSessions.binding(request, reply, true);
    const input = challengeInput.parse(request.body);
    if (input.purpose === "reauth" && !request.staffSession) throw new BusinessError("AUTH_REQUIRED", "请先登录", 401);
    reply.header("cache-control", "no-store");
    return { data: loginProtection.issue(context(request, binding, input.purpose, input.username)) };
  });
  app.post("/api/v1/auth/admin/login", { bodyLimit: 4096, config: { rateLimit: false } }, async (request, reply) => {
    const binding = webSessions.binding(request, reply);
    const input = adminLoginSchema.parse(request.body);
    const proof = proofSchema.parse(request.body);
    const result = await loginProtection.run(context(request, binding, "login", input.username), proof.challenge, proof.nonce, request.ip,
      () => runWithInternalWriteActor(null, () => adminAuthService.login(input.username, input.password, binding)));
    // Replace the current browser session when switching identity, without
    // ever interpreting a consumer Authorization header as an employee token.
    await adminAuthService.logout(webSessions.authorization(request));
    return respond(reply, result);
  });
  app.post("/api/v1/auth/admin/complete-password-change", { bodyLimit: 4096, config: { rateLimit: adminPasswordChangeRateLimit } }, async (request, reply) => {
    const binding = webSessions.binding(request, reply);
    const input = completeAdminPasswordChangeSchema.parse(request.body);
    const proof = proofSchema.parse(request.body);
    return respond(reply, await loginProtection.run(context(request, binding, "password"), proof.challenge, proof.nonce, request.ip,
      () => runWithInternalWriteActor(null, () => adminAuthService.changePasswordWithToken(input.passwordChangeToken, input.newPassword, request.id, binding))));
  });
  app.get("/api/v1/auth/admin/session", async (request, reply) => {
    webSessions.assertSameOrigin(request, false);
    reply.header("cache-control", "no-store");
    if (!request.actor || !request.staffSession) { webSessions.clear(reply); return { data: null }; }
    return { data: await adminAuthService.browserIdentity(request.staffAuthorization) };
  });
  app.post("/api/v1/auth/admin/reauthenticate", { bodyLimit: 4096, config: { rateLimit: false } }, async (request, reply) => {
    const binding = webSessions.binding(request, reply);
    if (!request.actor || !request.staffAuthorization) throw new BusinessError("AUTH_REQUIRED", "请先登录", 401);
    const input = z.object({ password: adminPasswordSchema }).parse(request.body);
    const proof = proofSchema.parse(request.body);
    return respond(reply, await loginProtection.run(context(request, binding, "reauth"), proof.challenge, proof.nonce, request.ip,
      () => adminAuthService.reauthenticate(request.actor!, request.staffAuthorization!, input.password, request.id, binding)));
  });
  app.post("/api/v1/admin/me/change-password", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "CUSTOMER_SERVICE", "PICKUP_MANAGER", "FINANCE", "SUPER_ADMIN"]);
    const input = adminPasswordChangeSchema.parse(request.body);
    const proof = proofSchema.parse(request.body);
    const binding = webSessions.binding(request, reply);
    return respond(reply, await loginProtection.run(context(request, binding, "password"), proof.challenge, proof.nonce, request.ip,
      () => adminAuthService.changePassword(actor, input.currentPassword, input.newPassword, request.id, binding)));
  });
  app.post("/api/v1/auth/logout", async (request, reply) => {
    if (webSessions.authorization(request) && !request.staffSession) {
      webSessions.assertSameOrigin(request); webSessions.clear(reply);
      return reply.status(204).send();
    }
    requireActor(request, [
      "USER",
      "OPERATOR",
      "CUSTOMER_SERVICE",
      "PICKUP_MANAGER",
      "FINANCE",
      "SUPER_ADMIN",
    ]);
    await authService?.logout(request.headers.authorization);
    await adminAuthService.logout(request.staffAuthorization);
    webSessions.clear(reply);
    return reply.status(204).send();
  });
}
