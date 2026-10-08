import type { FastifyInstance } from "fastify";
import { ALL_PERMISSION_CODES, PERMISSION_CATALOG, identifierSchema } from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import type { CommerceStore } from "../modules/core/store.js";
import { requireActor } from "../modules/auth/auth.js";
import { RoleService } from "../modules/auth/role-service.js";
export function registerAccessRoutes(app: FastifyInstance, store: CommerceStore): void {
  const service = new RoleService(store);
  app.get("/api/v1/admin/dashboard", async request => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return store.readSnapshot(async snapshot => {
      const [areas,points,campaigns,pendingOrders,paidWaitingClose,fulfillment,readyForPickup,refunding]=await Promise.all([
        snapshot.listServiceAreas(), snapshot.listPickupPoints(), snapshot.listCampaigns(),
        snapshot.countOrdersByStatus(undefined, ["COMPLETED", "CANCELLED", "REFUNDED"]),
        snapshot.countOrdersByStatus(["PAID_WAITING_CLOSE"]),
        snapshot.countOrdersByStatus(["LOCKED", "ALLOCATING", "IN_TRANSIT"]),
        snapshot.countOrdersByStatus(["READY_FOR_PICKUP"]),
        snapshot.countOrdersByStatus(["REFUNDING"]),
      ]);
      const activeCampaigns=campaigns.filter(c=>!["COMPLETED","CANCELLED"].includes(c.status));
      return {data:{activeAreas:areas.filter(a=>a.orderEnabled).length,activePoints:points.filter(p=>p.status==="ACTIVE").length,activeCampaigns:activeCampaigns.length,pendingOrders,
        campaigns:activeCampaigns.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,5).map(c=>({id:c.id,title:c.title,cutoffAt:c.cutoffAt,status:c.status})),
        stages:[{label:"待履约",count:paidWaitingClose},{label:"备货与运输",count:fulfillment},{label:"待领取",count:readyForPickup},{label:"退款处理中",count:refunding}]
      }};
    });
  });
  app.get("/api/v1/admin/me/access", async request => {
    const actor = request.actor;
    if (!actor || actor.roles.includes("USER")) throw new BusinessError("AUTH_REQUIRED", "请先登录", 401);
    const isSuperAdmin = actor.roles.includes("SUPER_ADMIN");
    const role = await store.getAccessRole(actor.accessRoleId ?? actor.roles[0]!);
    return { data: { permissions: isSuperAdmin ? ALL_PERMISSION_CODES : actor.permissions ?? role?.permissions ?? [], roleId: isSuperAdmin ? "SUPER_ADMIN" : role?.id, roleName: isSuperAdmin ? "超级管理员" : role?.name ?? "未分配角色", scope: role?.scope ?? "PLATFORM", isSuperAdmin } };
  });
  app.get("/api/v1/admin/access/permissions", async request => { requireActor(request, ["SUPER_ADMIN"]); return { data: PERMISSION_CATALOG }; });
  app.get("/api/v1/admin/access/roles", async request => {
    requireActor(request, ["SUPER_ADMIN"]);
    const [roles, staff] = await Promise.all([store.listAccessRoles(), store.listInternalStaff()]);
    return { data: roles.map(role => ({ ...role, staffCount: staff.filter(person => !person.archivedAt && (person.accessRoleId ?? person.role) === role.id).length })) };
  });
  app.post("/api/v1/admin/access/roles", async request => ({ data: await service.save(null, request.body, requireActor(request, ["SUPER_ADMIN"]), request.id) }));
  app.patch("/api/v1/admin/access/roles/:id", async request => ({ data: await service.save(identifierSchema.parse((request.params as {id: string}).id), request.body, requireActor(request, ["SUPER_ADMIN"]), request.id) }));
  app.delete("/api/v1/admin/access/roles/:id", async request => { await service.delete(identifierSchema.parse((request.params as {id: string}).id), requireActor(request, ["SUPER_ADMIN"]), request.id); return { data: { deleted: true } }; });
}
