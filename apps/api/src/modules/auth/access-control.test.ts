import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { FastifyRequest, FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../config.js";
import { MemoryStore } from "../core/store.js";
import { createAdminCredential, AdminAuthService } from "./admin-auth.js";
import { ALL_PERMISSION_CODES, BUILTIN_ACCESS_ROLES, normalizePermissions } from "@hometown/api-contracts";
import { requireActor } from "./auth.js";
import { attachAccess, ROUTE_PERMISSIONS } from "./access-control.js";
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
  it("keeps phone-detail permission separate from the consumer directory while granting it to customer service",()=>{
    expect(BUILTIN_ACCESS_ROLES.find(role=>role.id==="CUSTOMER_SERVICE")?.permissions).toContain("consumers.phone.view");
    expect(BUILTIN_ACCESS_ROLES.find(role=>role.id==="OPERATOR")?.permissions).not.toContain("consumers.phone.view");
    expect(normalizePermissions(["consumers.phone.view"])).toEqual(["consumers.phone.view","orders.view"]);
    expect(ROUTE_PERMISSIONS["GET /api/v1/admin/consumers/:id/phone"]).toEqual(["consumers.phone.view"]);
  });
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
  it("allows detail-image uploads with either product create or edit and denies roles without either grant",async()=>{
    const store=new MemoryStore(false);await account(store,"super","SUPER_ADMIN");const service=new RoleService(store);
    const createRole=await service.save(null,{...roleInput,name:"商品新建",permissions:["products.create"]},superActor,"create");
    const editRole=await service.save(null,{...roleInput,name:"商品编辑",permissions:["products.edit"]},superActor,"edit");
    const viewRole=await service.save(null,{...roleInput,name:"仅查看商品",permissions:["products.view"]},superActor,"view");
    const createHeaders=await account(store,"product-create","OPERATOR",createRole.id);
    const editHeaders=await account(store,"product-edit","OPERATOR",editRole.id);
    const viewHeaders=await account(store,"product-view","OPERATOR",viewRole.id);
    const directory=await mkdtemp(join(tmpdir(),"detail-image-rbac-"));
    try {
      app=await buildApp({store,config:loadConfig({NODE_ENV:"test",PRODUCT_IMAGE_DIR:directory})});
      const payload=await sharp({create:{width:2,height:2,channels:3,background:"red"}}).png().toBuffer();
      const request=(headers:{authorization:string})=>app!.inject({method:"POST",url:"/api/v1/admin/product-detail-images",headers:{...headers,"content-type":"image/png"},payload});
      expect((await request(createHeaders)).statusCode).toBe(201);
      expect((await request(editHeaders)).statusCode).toBe(201);
      expect((await request(viewHeaders)).statusCode).toBe(403);
      expect(ROUTE_PERMISSIONS["POST /api/v1/admin/product-detail-images"]).toEqual(["products.create","products.edit"]);
    } finally {
      await app?.close();app=undefined;
      await rm(directory,{recursive:true,force:true});
    }
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
  it("does not expose complete orders to summary and fulfillment roles",async()=>{
    const store=new MemoryStore(false); await account(store,"super","SUPER_ADMIN");
    const service=new RoleService(store); app=await buildApp({store,config:loadConfig({NODE_ENV:"test"})});
    for(const permission of ["dashboard.view","logistics.view","arrival-exceptions.view"]){
      const role=await service.save(null,{...roleInput,name:permission,permissions:[permission]},superActor,"summary");
      const headers=await account(store,permission,"OPERATOR",role.id);
      for(const url of ["/api/v1/admin/orders","/api/v1/admin/orders?orderNo=known-order"])
        expect((await app.inject({url,headers})).statusCode,permission+url).toBe(403);
      if(permission==="dashboard.view"){
        const result=await app.inject({url:"/api/v1/admin/dashboard",headers});
        expect(result.statusCode).toBe(200);
        expect(Object.keys(result.json().data).sort()).toEqual(["activeAreas","activeCampaigns","activePoints","campaigns","pendingOrders","stages"]);
      }
    }
  });
  it("preserves legacy quality-case status boundaries and pickup-window access",async()=>{
    const store=new MemoryStore(false);const now=new Date().toISOString();
    const statuses=["REGISTERED","ACCEPTED","REJECTED","REFUNDING","RESOLVED"] as const;
    for(const status of statuses) await store.saveCommunityQualityCase({id:status,orderId:status,userId:"consumer",clientRequestId:status,payloadHash:status,status,registeredAt:now,acceptedBy:null,acceptedAt:null,acceptanceNote:null,decisionBy:null,decidedAt:null,decisionNote:null,refundApprovedBy:null,refundApprovedAt:null,financeExecutedBy:null,financeExecutedAt:null,refundExceptionId:null,items:[]});
    app=await buildApp({store,config:loadConfig({NODE_ENV:"test"})});
    const expected={CUSTOMER_SERVICE:["REGISTERED","ACCEPTED","REJECTED"],OPERATOR:["ACCEPTED","REJECTED","REFUNDING","RESOLVED"],FINANCE:["REFUNDING","RESOLVED"],SUPER_ADMIN:[...statuses]};
    for(const identity of Object.keys(expected) as Array<keyof typeof expected>){
      const headers=await account(store,identity.toLowerCase(),identity);
      const result=await app.inject({url:"/api/v1/admin/quality-cases",headers});
      expect(result.statusCode,identity).toBe(200);
      expect(result.json().data.map((v:{status:string})=>v.status).sort(),identity).toEqual(expected[identity].sort());
      expect((await app.inject({url:"/api/v1/admin/community/pickup-windows",headers})).statusCode,identity).toBe(identity==="CUSTOMER_SERVICE"?403:200);
    }
  });
  it("denies login while a role is inactive and allows fresh login after reactivation",async()=>{
    const store=new MemoryStore(false);await account(store,"super","SUPER_ADMIN");const service=new RoleService(store);
    const role=await service.save(null,roleInput,superActor,"create");const headers=await account(store,"viewer","OPERATOR",role.id);
    const inactive=await service.save(role.id,{...roleInput,status:"INACTIVE",version:role.version},superActor,"disable");
    const auth=new AdminAuthService(store,3600);
    expect(await auth.authenticate(headers.authorization)).toBeNull();
    await expect(auth.login("viewer",password)).rejects.toMatchObject({code:"ACCOUNT_DISABLED"});
    await service.save(role.id,{...roleInput,version:inactive.version},superActor,"enable");
    const fresh=await auth.login("viewer",password);expect(fresh.nextAction).toBe("LOGIN");
    expect(await auth.authenticate(headers.authorization)).toBeNull();
  });
  it("registers every capability and denies future unregistered protected routes",()=>{
    const routes=new Set(Object.values(ROUTE_PERMISSIONS).flat());
    // These are evaluated after the route guard: SKU upsert branch and quality row projection.
    ["products.edit","service.intake","service.progress"].forEach(code=>routes.add(code));
    expect(ALL_PERMISSION_CODES.filter(code=>!routes.has(code))).toEqual([]);
    expect([...routes].filter(code=>!ALL_PERMISSION_CODES.includes(code))).toEqual([]);
    const request={actor:{userId:"viewer",roles:["OPERATOR"],permissions:[...ALL_PERMISSION_CODES]},method:"GET",routeOptions:{url:"/api/v1/admin/future-sensitive-endpoint"}} as unknown as FastifyRequest;
    expect(()=>requireActor(request,["OPERATOR"])).toThrow("没有此功能的操作权限");
  });

  it("requires both pickup functionality and assigned points, preserving existing fulfillment on inactive points",async()=>{
    const store=new MemoryStore(false);await account(store,"super","SUPER_ADMIN");const service=new RoleService(store);
    const role=await service.save(null,{...roleInput,name:"点位只读",scope:"PICKUP",permissions:["point-pickup.view"]},superActor,"point");
    const headers=await account(store,"point-viewer","PICKUP_MANAGER",role.id);const now=new Date().toISOString();
    for(const id of ["point-a","point-b"]){
      await store.savePickupPoint({id,serviceAreaId:"area",name:id,address:id,businessHours:"09:00-20:00",pickupInstructions:"领取",latitude:39,longitude:116,contactName:"manager",contactPhone:"13800138000",status:"ACTIVE",capacityPerDay:null,createdAt:now});
      await store.saveDeliveryPlan({id,campaignId:id,serviceAreaId:"area",pickupPointId:id,status:"ARRIVED",siteName:id,address:id,arrivalStartAt:null,arrivalEndAt:null,contactName:null,contactPhone:null,vehicleOrderNo:null,driverName:null,driverPhone:null,vehiclePlate:null,logisticsPlatform:null,estimatedArrivalAt:null,remark:null,confirmedAt:now,bookedAt:null,dispatchedAt:null,arrivedAt:now,createdAt:now,updatedAt:now});
    }
    app=await buildApp({store,config:loadConfig({NODE_ENV:"test"})});const url="/api/v1/pickup/delivery-plans";
    expect((await app.inject({url,headers})).json().data).toEqual([]);
    await store.replaceStaffPickupPointAssignments("point-viewer",[{staffUserId:"point-viewer",pickupPointId:"point-a",assignedBy:"super",createdAt:now,updatedAt:now}]);
    expect((await app.inject({url,headers})).json().data.map((p:{id:string})=>p.id)).toEqual(["point-a"]);
    expect((await app.inject({method:"POST",url:"/api/v1/pickup/verify",headers,payload:{}})).statusCode).toBe(403);
    // Point order intake can be disabled without stranding previously paid fulfillment.
    const point=(await store.listPickupPoints()).find(p=>p.id==="point-a")!;await store.savePickupPoint({...point,status:"INACTIVE"});
    expect((await app.inject({url,headers})).json().data.map((p:{id:string})=>p.id)).toEqual(["point-a"]);
    await service.save(role.id,{...roleInput,name:role.name,scope:"PICKUP",permissions:[],version:role.version},superActor,"revoke");
    const login=await new AdminAuthService(store,3600).login("point-viewer",password);if(login.nextAction!=="LOGIN")throw new Error("login");
    const fresh={authorization:`Bearer ${login.accessToken}`};expect((await app.inject({url,headers:fresh})).statusCode).toBe(403);
    const staff=(await store.getInternalStaff("point-viewer"))!;await store.saveInternalStaff({...staff,status:"SUSPENDED",suspendedAt:now,suspensionReason:"停用"});
    expect((await app.inject({url,headers:fresh})).statusCode).toBe(401);
  });

});
