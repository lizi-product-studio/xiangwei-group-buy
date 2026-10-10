import { ROUTE_PERMISSIONS } from "./access-control.js";
import type { FastifyRequest } from "fastify";
import { BusinessError } from "@hometown/domain";
import type { Role } from "../core/types.js";
export type { Role } from "../core/types.js";

export interface Actor {
  userId: string;
  roles: Role[];
  /** Absent only for the explicitly test-only demo header actor. */
  authorizationVersion?: number;
  permissions?: string[];
  accessRoleId?: string;
  accessRoleVersion?: number;
  requiredPermissions?: string[];
  sessionTokenHash?: string;
  webOrigin?: string;
  requireFreshAuthentication?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export function readDemoActor(request: FastifyRequest): Actor | null {
  const userId = request.headers["x-demo-user-id"];
  const rawRoles = request.headers["x-demo-role"];
  if (typeof userId !== "string" || typeof rawRoles !== "string") return null;
  const roles = rawRoles
    .split(",")
    .map((role) => role.trim())
    .filter((role): role is Role =>
      [
        "USER",
        "SUPER_ADMIN",
        "OPERATOR",
        "CUSTOMER_SERVICE",
        "FINANCE",
        "PICKUP_MANAGER",
      ].includes(role),
    );
  return roles.length > 0 ? { userId, roles } : null;
}

export function requireActor(
  request: FastifyRequest,
  allowedRoles: readonly Role[],
): Actor {
  const actor = request.actor;
  if (!actor) throw new BusinessError("AUTH_REQUIRED", "请先登录", 401);
  const path = request.routeOptions?.url ?? "";
  if (actor.sessionTokenHash && !path.startsWith("/api/v1/admin/") && !path.startsWith("/api/v1/pickup/") && path !== "/api/v1/auth/logout")
    throw new BusinessError("FORBIDDEN", "请使用对应的消费者登录身份", 403);
  if (actor.permissions && !actor.roles.includes("SUPER_ADMIN") && (path.startsWith("/api/v1/admin/") || path.startsWith("/api/v1/pickup/")) && path !== "/api/v1/admin/me/change-password") {
    let required = ROUTE_PERMISSIONS[`${request.method} ${path}`];
    if (path === "/api/v1/admin/catalog/skus" && request.method === "POST") {
      const body = request.body as { id?: string } | undefined;
      required = [body?.id ? "products.edit" : "products.create"];
    }
    if (path === "/api/v1/admin/product-images") required = ["products.create", "products.edit", "homepage-banners.manage", "pickup-points.create", "pickup-points.edit"];
    if (!required?.some(code => actor.permissions!.includes(code))) throw new BusinessError("FORBIDDEN", "没有此功能的操作权限", 403);
    actor.requiredPermissions = required;
    return actor;
  }
  if (!actor.roles.some((role) => allowedRoles.includes(role))) {
    throw new BusinessError("FORBIDDEN", "无权执行此操作", 403);
  }
  return actor;
}
