import type { FastifyRequest } from "fastify";
import { BusinessError } from "@hometown/domain";
import type { Role } from "../core/types.js";
export type { Role } from "../core/types.js";

export interface Actor {
  userId: string;
  roles: Role[];
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
  if (!actor.roles.some((role) => allowedRoles.includes(role))) {
    throw new BusinessError("FORBIDDEN", "无权执行此操作", 403);
  }
  return actor;
}
