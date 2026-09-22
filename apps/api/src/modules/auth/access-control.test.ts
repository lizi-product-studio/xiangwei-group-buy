import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../config.js";
import { MemoryStore } from "../core/store.js";
import { createAdminCredential, AdminAuthService } from "./admin-auth.js";
import { attachAccess } from "./access-control.js";
import { RoleService } from "./role-service.js";
import { StaffService } from "./staff-service.js";
import { runWithInternalWriteActor } from "./internal-write-context.js";
import type { Actor } from "./auth.js";
import type { Role } from "../core/types.js";
const password="RBAC-test-only-Password123!";
const superActor:Actor={userId:"super",roles:["SUPER_ADMIN"],authorizationVersion:1};
const roleInput={name:"商品只读",description:"测试角色",scope:"PLATFORM",permissions:["products.view"],status:"ACTIVE"};
class SnapshotStore extends MemoryStore { dump(){return this.exportState();} restore(raw:string){this.importState(raw);} }
async function account(store:MemoryStore,id:string,role:Role,accessRoleId?:string) {
  if(role==="USER")throw new Error("internal only");
  const now=new Date().toISOString();
  await store.saveUser({id,wechatOpenId:null,status:"ACTIVE",createdAt:now});
  await store.replaceUserRoles(id,[role],1);
  await store.saveInternalStaff({userId:id,staffNo:id,displayName:id,phone:"13800138000",role,status:"ACTIVE",authorizationVersion:1,createdBy:null,activatedAt:now,suspendedAt:null,suspensionReason:null,createdAt:now,updatedAt:now,...(accessRoleId?{accessRoleId}:{})});
  await store.saveAdminCredential(await createAdminCredential(id,id,password,[role],false,1));
  const login=await new AdminAuthService(store,3600).login(id,password);
  if(login.nextAction!=="LOGIN")throw new Error("login failed");
  return {authorization:`Bearer ${login.accessToken}`};
}
describe("configurable access roles",()=>{
  let app:FastifyInstance|undefined;
  afterEach(async()=>app?.close());
  it("enforces persisted grants on real sessions, denies direct writes and governance, then invalidates revoked sessions",async()=>{
    const store=new SnapshotStore(false); const roles=new RoleService(store);
    const root=await account(store,"super","SUPER_ADMIN");
    const custom=await roles.save(null,roleInput,superActor,"create");
    const headers=await account(store,"viewer","OPERATOR",custom.id);
    app=await buildApp({store,config:loadConfig({NODE_ENV:"test"})});
    expect((await app.inject({url:"/api/v1/admin/catalog/skus",headers})).statusCode).toBe(200);
    const access=await app.inject({url:"/api/v1/admin/me/access",headers});
    expect(access.json().data).toMatchObject({roleName:"商品只读",permissions:["products.view"]});
    for(const url of ["/api/v1/admin/access/roles","/api/v1/admin/staff","/api/v1/admin/finance/ledger","/api/v1/admin/audit-logs"])
      expect((await app.inject({url,headers})).statusCode,url).toBe(403);
    expect((await app.inject({method:"POST",url:"/api/v1/admin/catalog/skus",headers,payload:{}})).statusCode).toBe(403);
    const oldActor=await attachAccess(store,await new AdminAuthService(store,3600).authenticate(headers.authorization));
    expect(oldActor).not.toBeNull();
    await roles.save(custom.id,{...roleInput,permissions:[],version:custom.version},superActor,"revoke");
    expect((await app.inject({url:"/api/v1/admin/catalog/skus",headers})).statusCode).toBe(401);
    let wrote=false;
    await expect(runWithInternalWriteActor(oldActor,()=>store.transaction(async()=>{wrote=true;}))).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(wrote).toBe(false);
    expect((await app.inject({url:"/api/v1/admin/access/roles",headers:root})).statusCode).toBe(200);
    const restored=new SnapshotStore(false);restored.restore(store.dump());
    expect((await restored.getAccessRole(custom.id))?.permissions).toEqual([]);
    expect((await restored.getInternalStaff("viewer"))?.accessRoleId).toBe(custom.id);
  });
  it("rejects unknown permissions, mixed scopes, stale versions, unsafe deletion and assignment",async()=>{
    const store=new MemoryStore(false);await account(store,"super","SUPER_ADMIN"); const service=new RoleService(store);
    await expect(service.save(null,{...roleInput,permissions:["invented.root"]},superActor,"unknown")).rejects.toThrow();
    await expect(service.save(null,{...roleInput,permissions:["point-pickup.verify"]},superActor,"scope")).rejects.toThrow();
    const custom=await service.save(null,roleInput,superActor,"create");
    await expect(service.save(custom.id,{...roleInput,version:99},superActor,"stale")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
    await expect(service.delete("OPERATOR",superActor,"builtin")).rejects.toMatchObject({code:"INVALID_STATE_TRANSITION"});
    await account(store,"viewer","OPERATOR",custom.id);
    await expect(service.delete(custom.id,superActor,"bound")).rejects.toMatchObject({code:"RESOURCE_IN_USE"});
    await expect(new StaffService(store).update("viewer",{role:"PICKUP_MANAGER",accessRoleId:custom.id,reason:"调整岗位"},superActor,"assign")).rejects.toMatchObject({code:"VALIDATION_ERROR"});
    const extra=await service.save(null,{...roleInput,name:"待删除"},superActor,"extra");await service.delete(extra.id,superActor,"delete");expect(await store.getAccessRole(extra.id)).toBeNull();
  });
  it("preserves legacy identities and permits a custom finance grant without granting platform governance",async()=>{
    const store=new MemoryStore(false);await account(store,"super","SUPER_ADMIN");
    const service=new RoleService(store);
    const policy=await service.save(null,{...roleInput,name:"财务查看",permissions:["finance-ledger.view"]},superActor,"finance");
    const headers=await account(store,"finance-custom","OPERATOR",policy.id);
    app=await buildApp({store,config:loadConfig({NODE_ENV:"test"})});
    expect((await app.inject({url:"/api/v1/admin/finance/ledger",headers})).statusCode).toBe(200);
    expect((await app.inject({url:"/api/v1/admin/orders",headers})).statusCode).toBe(403);
    for(const identity of ["OPERATOR","CUSTOMER_SERVICE","FINANCE","PICKUP_MANAGER"] as const){
      const h=await account(store,identity.toLowerCase(),identity);
      const response=await app.inject({url:"/api/v1/admin/me/access",headers:h});
      expect(response.statusCode,identity).toBe(200);expect(response.json().data.permissions.length).toBeGreaterThan(0);
    }
    const empty=new SnapshotStore(false);empty.restore('{"accessRoles":[]}');expect(await empty.getAccessRole("OPERATOR")).not.toBeNull();
  });
  it("rolls back role edits and session revision together on audit failure",async()=>{
    class FailingAudit extends MemoryStore { fail=false;override async saveAuditLog(...args:Parameters<MemoryStore["saveAuditLog"]>){if(this.fail)throw new Error("audit unavailable");return super.saveAuditLog(...args);} }
    const store=new FailingAudit(false);await account(store,"super","SUPER_ADMIN");const service=new RoleService(store);
    const custom=await service.save(null,roleInput,superActor,"create");const headers=await account(store,"viewer","OPERATOR",custom.id);store.fail=true;
    await expect(service.save(custom.id,{...roleInput,permissions:[],version:custom.version},superActor,"change")).rejects.toThrow("audit unavailable");
    expect((await store.getAccessRole(custom.id))?.permissions).toEqual(["products.view"]);
    expect((await store.getInternalStaff("viewer"))?.authorizationVersion).toBe(1);
    expect(await new AdminAuthService(store,3600).authenticate(headers.authorization)).not.toBeNull();
  });
});
