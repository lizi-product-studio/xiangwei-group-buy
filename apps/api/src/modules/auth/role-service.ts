import { randomUUID } from "node:crypto";
import { accessRoleInputSchema, normalizePermissions, type AccessRole } from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";
import type { Actor } from "./auth.js";

export class RoleService {
  constructor(private readonly store: CommerceStore) {}
  async save(id: string | null, input: unknown, actor: Actor, requestId: string): Promise<AccessRole> {
    if (!actor.roles.includes("SUPER_ADMIN")) throw new BusinessError("FORBIDDEN", "只有超级管理员可以配置角色", 403);
    const parsed = accessRoleInputSchema.parse(input);
    if (["超级管理员", "SUPER_ADMIN"].includes(parsed.name)) throw new BusinessError("VALIDATION_ERROR", "超级管理员是系统保留角色名称", 400);
    return this.store.transaction(async store => {
      const before = id ? await store.getAccessRole(id) : null;
      if (id && !before) throw new BusinessError("RESOURCE_NOT_FOUND", "角色不存在", 404);
      if (before && parsed.version !== before.version) throw new BusinessError("CONCURRENT_MODIFICATION", "角色已被修改，请刷新后重试", 409);
      if (before && before.scope !== parsed.scope) throw new BusinessError("VALIDATION_ERROR", "角色数据范围创建后不可变更，请新建角色", 400);
      if ((await store.listAccessRoles()).some(role => role.id !== id && role.name === parsed.name)) throw new BusinessError("RESOURCE_IN_USE", "角色名称已存在", 409);
      const role: AccessRole = { ...parsed, id: id ?? randomUUID(), permissions: normalizePermissions(parsed.permissions), builtIn: before?.builtIn ?? false, version: (before?.version ?? 0) + 1, updatedAt: await store.databaseNow() };
      await store.saveAccessRole(role);
      // Role revision and staff/session revocation share the same aggregate lock.
      for (const staff of await store.listInternalStaff()) {
        if (staff.archivedAt || staff.role === "SUPER_ADMIN" || (staff.accessRoleId ?? staff.role) !== role.id) continue;
        const credential = await store.findAdminCredentialByUserId(staff.userId);
        const version = Math.max(staff.authorizationVersion, credential?.authorizationVersion ?? 0) + 1;
        await store.saveInternalStaff({ ...staff, authorizationVersion: version, updatedAt: role.updatedAt });
        await store.replaceUserRoles(staff.userId, [staff.role], version);
        await store.deleteAuthSessionsByUser(staff.userId);
      }
      await store.saveAuditLog({ id: randomUUID(), actorId: actor.userId, action: before ? "ACCESS_ROLE_UPDATED" : "ACCESS_ROLE_CREATED", resourceType: "ACCESS_ROLE", resourceId: role.id, requestId, beforeData: before, afterData: role, createdAt: role.updatedAt });
      return role;
    });
  }
  async delete(id: string, actor: Actor, requestId: string): Promise<void> {
    if (!actor.roles.includes("SUPER_ADMIN")) throw new BusinessError("FORBIDDEN", "只有超级管理员可以删除角色", 403);
    await this.store.transaction(async store => {
      if (id === "SUPER_ADMIN") throw new BusinessError("INVALID_STATE_TRANSITION", "超级管理员是系统保留角色，不能删除", 409);
      const role = await store.getAccessRole(id);
      if (!role) throw new BusinessError("RESOURCE_NOT_FOUND", "角色不存在", 404);
      if ((await store.listInternalStaff()).some(staff => !staff.archivedAt && (staff.accessRoleId ?? staff.role) === id)) throw new BusinessError("RESOURCE_IN_USE", "该角色仍关联员工，请先调整员工角色", 409);
      await store.deleteAccessRole(id);
      await store.saveAuditLog({ id: randomUUID(), actorId: actor.userId, action: "ACCESS_ROLE_DELETED", resourceType: "ACCESS_ROLE", resourceId: id, requestId, beforeData: role, afterData: null, createdAt: await store.databaseNow() });
    });
  }
}
