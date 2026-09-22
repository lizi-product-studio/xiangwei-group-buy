import { newEnforcer, newModelFromString } from "casbin";
import { ALL_PERMISSION_CODES, normalizePermissions, type AccessRole } from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";
import type { Actor } from "./auth.js";

const model = `[request_definition]
r = sub, obj
[policy_definition]
p = sub, obj
[role_definition]
g = _, _
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = g(r.sub, p.sub) && r.obj == p.obj`;
// Each immutable policy revision gets its own enforcer. Bound the cache; persisted
// policy is always read first so another process can never leave stale grants.
const cache = new Map<string, Promise<string[]>>();
export async function enforcedPermissions(role: AccessRole): Promise<string[]> {
  if (role.status !== "ACTIVE") return [];
  const permissions = normalizePermissions(role.permissions).filter(code => ALL_PERMISSION_CODES.includes(code));
  const key = JSON.stringify([role.id, role.version, permissions]);
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const enforcer = await newEnforcer(newModelFromString(model));
      await enforcer.addRoleForUser("staff", role.id);
      if (permissions.length) await enforcer.addPolicies(permissions.map(code => [role.id, code]));
      const allowed: string[] = [];
      for (const code of permissions) if (await enforcer.enforce("staff", code)) allowed.push(code);
      return allowed;
    })();
    if (cache.size >= 100) cache.clear();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  return [...await pending];
}
export async function attachAccess(store: CommerceStore, actor: Actor | null): Promise<Actor | null> {
  if (!actor || actor.roles.includes("USER") || actor.authorizationVersion === undefined) return actor;
  if (actor.roles.includes("SUPER_ADMIN")) return { ...actor, permissions: [...ALL_PERMISSION_CODES] };
  return store.readSnapshot(async snapshot => {
    const staff = await snapshot.getInternalStaff(actor.userId);
    const roleId = staff?.accessRoleId ?? staff?.role;
    const role = roleId ? await snapshot.getAccessRole(roleId) : null;
    if (!staff || staff.status !== "ACTIVE" || staff.authorizationVersion !== actor.authorizationVersion || !role || role.status !== "ACTIVE" || (role.scope === "PICKUP") !== (staff?.role === "PICKUP_MANAGER"))
      throw new BusinessError("AUTH_REQUIRED", "角色已停用或授权已变化，请联系管理员", 401);
    return { ...actor, accessRoleId: role.id, accessRoleVersion: role.version, permissions: await enforcedPermissions(role) };
  });
}
export function actorCan(actor: Actor, permission: string): boolean {
  return actor.roles.includes("SUPER_ADMIN") || Boolean(actor.permissions?.includes(permission));
}

/** Explicit endpoint -> any-of read capabilities. Write capabilities are one-to-one. */
export const ROUTE_PERMISSIONS: Record<string, string[]> = {};
const route = (method: string, path: string, ...permissions: string[]) => { ROUTE_PERMISSIONS[`${method} /api/v1/${path}`] = permissions; };
const get = (path: string, ...permissions: string[]) => route("GET", path, ...permissions);
const post = (path: string, permission: string) => route("POST", path, permission);
get("admin/region-directory", "areas.view", "pickup-points.view");
get("admin/geo/search", "pickup-points.create", "pickup-points.edit");
get("admin/geo/reverse", "pickup-points.create", "pickup-points.edit");
get("admin/service-areas", "areas.view", "pickup-points.view", "campaigns.view", "homepage-banners.view", "dashboard.view");
post("admin/service-areas", "areas.manage"); post("admin/service-areas/:id/order-status", "areas.manage");
get("admin/pickup-points", "pickup-points.view", "areas.view", "campaigns.view", "dashboard.view");
post("admin/pickup-points", "pickup-points.create"); post("admin/pickup-points/batch", "pickup-points.create");
route("PATCH", "admin/pickup-points/:id", "pickup-points.edit"); route("DELETE", "admin/pickup-points/:id", "pickup-points.delete");
get("admin/catalog/skus", "products.view", "categories.view", "campaigns.view");
get("admin/catalog/categories", "products.view", "categories.view", "homepage-banners.view");
post("admin/catalog/categories", "categories.manage"); route("DELETE", "admin/catalog/categories/:id", "categories.delete");
post("admin/catalog/skus", "products.create"); post("admin/product-images", "products.create");
get("admin/campaigns", "campaigns.view", "orders.view", "logistics.view", "arrival-exceptions.view", "homepage-banners.view", "dashboard.view");
post("admin/campaigns", "campaigns.create"); route("PATCH", "admin/campaigns/:id", "campaigns.edit"); route("DELETE", "admin/campaigns/:id", "campaigns.delete");
for (const action of ["open", "close", "cancel"]) post(`admin/campaigns/:id/${action}`, `campaigns.${action}`);
get("admin/campaigns/:id/cancel-impact", "campaigns.cancel"); post("admin/campaigns/:id/postpone", "campaigns.edit");
get("admin/campaigns/:id/packing-labels", "campaigns.labels", "logistics.view");
get("admin/orders", "orders.view", "dashboard.view", "logistics.view", "arrival-exceptions.view");
get("admin/delivery-plans", "logistics.view", "arrival-exceptions.view"); post("admin/delivery-plans/:id/book-vehicle", "logistics.edit");
get("admin/dispatch-batches", "logistics.view", "arrival-exceptions.view"); post("admin/dispatch-batches", "logistics.dispatch"); post("admin/dispatch-batches/:id/dispatch", "logistics.dispatch");
get("admin/community/deliveries", "logistics.view", "arrival-exceptions.view", "point-workbench.view", "point-pickup.view");
post("admin/community/dispatch-batches/:id/arrival", "point-workbench.confirm"); post("admin/community/deliveries/:id/allocation-draft/confirm", "arrival-exceptions.confirm");
get("pickup/delivery-plans", "point-pickup.view"); get("pickup/orders/lookup", "point-pickup.view"); post("pickup/orders/lookup", "point-pickup.view"); post("pickup/verify", "point-pickup.verify"); get("pickup/records", "pickup-records.view");
get("admin/community/cancellation-requests", "cancellations.view", "finance.view"); post("admin/community/orders/:id/cancellation/review", "cancellations.review"); post("admin/community/orders/:id/cancellation/refund", "finance.refund");
get("admin/quality-cases", "service.view", "finance.view"); post("admin/quality-cases/:id/accept", "service.accept"); post("admin/quality-cases/:id/decision", "service.decision"); post("admin/quality-cases/:id/refund", "finance.refund");
get("admin/fulfillment-exceptions", "service.view", "finance.view"); post("admin/fulfillment-exceptions/:id/refund", "finance.refund");
get("admin/community/pickup-windows", "service.view", "finance.view"); post("admin/community/orders/:id/pickup-extension", "service.pickup"); post("admin/community/orders/:id/pickup-disposition", "service.pickup"); post("admin/community/orders/:id/pickup-refund", "finance.refund");
get("admin/finance/refunds", "finance.view", "finance-records.view"); get("admin/finance/ledger", "finance-ledger.view");
get("admin/consumers", "consumers.view"); get("admin/consumers/:id", "consumers.view");
get("admin/service-area-interests", "interests.view"); post("admin/service-area-interests/:id/status", "interests.manage");
get("admin/notifications/manual", "governance.view"); post("admin/notifications/:id/retry", "governance.manage"); post("admin/notifications/:id/manual-complete", "governance.manage");
get("admin/homepage-banners", "homepage-banners.view"); post("admin/homepage-banners", "homepage-banners.manage"); route("DELETE", "admin/homepage-banners/:id", "homepage-banners.delete");
get("admin/audit-logs", "audit.view");
