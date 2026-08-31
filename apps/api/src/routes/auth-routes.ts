import type { FastifyInstance } from "fastify";
import {
  activateAdminStaffSchema,
  adminLoginSchema,
  wechatLoginSchema,
} from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import { requireActor } from "../modules/auth/auth.js";
import type { AdminAuthService } from "../modules/auth/admin-auth.js";
import type { StaffService } from "../modules/auth/staff-service.js";
import type { AuthService } from "../modules/auth/wechat-auth.js";

// A browser matrix activates more than five isolated employees. Keep the
// production brute-force limit intact while allowing the dedicated test app to
// exercise all roles in one deterministic run.
const adminCredentialRateLimit =
  process.env.NODE_ENV === "test"
    ? { max: 50, timeWindow: "5 minutes" }
    : { max: 5, timeWindow: "5 minutes" };

export function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: {
    authService: AuthService | null;
    adminAuthService: AdminAuthService;
    staffService: StaffService;
    privacyNoticeVersion: string;
  },
): void {
  const { authService, adminAuthService, staffService, privacyNoticeVersion } =
    dependencies;
  app.post(
    "/api/v1/auth/wechat/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
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
        data: await authService.login(input.code, input.privacyVersion),
      };
    },
  );
  app.post(
    "/api/v1/auth/admin/login",
    { config: { rateLimit: adminCredentialRateLimit } },
    async (request) => {
      const input = adminLoginSchema.parse(request.body);
      return {
        data: await adminAuthService.login(input.username, input.password),
      };
    },
  );
  app.post(
    "/api/v1/auth/admin/activate",
    { config: { rateLimit: adminCredentialRateLimit } },
    async (request) => {
      const input = activateAdminStaffSchema.parse(request.body);
      await staffService.activate(
        input.username,
        input.initialCredential,
        input.newPassword,
        request.id,
      );
      return {
        data: await adminAuthService.login(input.username, input.newPassword),
      };
    },
  );
  app.post("/api/v1/auth/logout", async (request, reply) => {
    requireActor(request, [
      "USER",
      "OPERATOR",
      "CUSTOMER_SERVICE",
      "PICKUP_MANAGER",
      "FINANCE",
      "SUPER_ADMIN",
    ]);
    await authService?.logout(request.headers.authorization);
    await adminAuthService.logout(request.headers.authorization);
    return reply.status(204).send();
  });
}
