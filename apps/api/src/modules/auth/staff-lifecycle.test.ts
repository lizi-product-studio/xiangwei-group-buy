import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { MemoryStore } from '../core/store.js';
import { createAdminCredential } from './admin-auth.js';

describe('internal staff lifecycle',()=>{
  let app:FastifyInstance;
  let store:MemoryStore;
  let superToken:string;

  beforeEach(async()=>{
    store=new MemoryStore();
    const now=new Date().toISOString();
    await store.saveUser({id:'super-staff',wechatOpenId:null,status:'ACTIVE',createdAt:now});
    await store.replaceUserRoles('super-staff',['SUPER_ADMIN']);
    await store.saveAdminCredential(await createAdminCredential('platform.admin','super-staff','correct horse battery staple',['SUPER_ADMIN']));
    app=await buildApp({config:loadConfig({NODE_ENV:'test'}),store});
    const login=await app.inject({method:'POST',url:'/api/v1/auth/admin/login',payload:{username:'platform.admin',password:'correct horse battery staple'}});
    superToken=login.json().data.accessToken as string;
  });

  afterEach(async()=>app.close());

  const superHeaders=()=>({authorization:`Bearer ${superToken}`});

  it('creates, activates, scopes and immediately revokes a pickup manager without exposing a consumer directory',async()=>{
    const now=new Date().toISOString();
    const noPoint=await app.inject({method:'POST',url:'/api/v1/admin/staff',headers:superHeaders(),payload:{displayName:'无点位负责人',username:'no.point',phone:'13800000001',role:'PICKUP_MANAGER',pickupPointIds:[]}});
    expect(noPoint.statusCode).toBe(400);

    const created=await app.inject({method:'POST',url:'/api/v1/admin/staff',headers:superHeaders(),payload:{displayName:'莲池点位负责人',username:'lianchi.manager',phone:'13800000002',role:'PICKUP_MANAGER',pickupPointIds:['pickup-demo-001']}});
    expect(created.statusCode,created.body).toBe(201);
    const createdData=created.json().data as {staff:{userId:string;phone:string;status:string;pickupPointIds:string[];staffNo:string};initialCredential:string};
    expect(createdData.staff).toMatchObject({phone:'138****0002',status:'PENDING_ACTIVATION',pickupPointIds:['pickup-demo-001']});
    expect(createdData.staff.staffNo).toMatch(/^STF-/);
    expect(createdData.initialCredential.length).toBeGreaterThanOrEqual(12);

    const directory=await app.inject({method:'GET',url:'/api/v1/admin/staff?query=莲池',headers:superHeaders()});
    expect(directory.statusCode).toBe(200);
    expect(directory.body).toContain('138****0002');
    expect(directory.body).not.toContain('wechatOpenId');

    const beforeActivation=await app.inject({method:'POST',url:'/api/v1/auth/admin/login',payload:{username:'lianchi.manager',password:createdData.initialCredential}});
    expect(beforeActivation.statusCode).toBe(403);expect(beforeActivation.json().code).toBe('ACTIVATION_REQUIRED');
    const activated=await app.inject({method:'POST',url:'/api/v1/auth/admin/activate',payload:{username:'lianchi.manager',initialCredential:createdData.initialCredential,newPassword:'a new manager password'}});
    expect(activated.statusCode,activated.body).toBe(200);
    const managerToken=activated.json().data.accessToken as string;
    const managerHeaders={authorization:`Bearer ${managerToken}`};
    expect((await app.inject({method:'GET',url:'/api/v1/admin/community/deliveries',headers:managerHeaders})).statusCode).toBe(200);
    expect((await app.inject({method:'GET',url:'/api/v1/admin/platform/skus',headers:managerHeaders})).statusCode).toBe(403);
    expect((await app.inject({method:'GET',url:'/api/v1/admin/finance/refunds',headers:managerHeaders})).statusCode).toBe(403);
    expect((await app.inject({method:'GET',url:'/api/v1/admin/campaigns',headers:managerHeaders})).statusCode).toBe(403);
    const primaryPlan=(await store.getDeliveryPlan('delivery-plan-demo-001'))!;
    await store.savePickupPoint({id:'pickup-other-staff-test',serviceAreaId:primaryPlan.serviceAreaId,name:'另一测试点',address:'另一测试地址',status:'ACTIVE',capacityPerDay:null,operationMode:'SELF_OPERATED',responsibilityOwner:null,siteLeadName:null,siteLeadPhone:null,createdAt:now});
    await store.saveDeliveryPlan({...primaryPlan,id:'delivery-plan-other-staff-test',pickupPointId:'pickup-other-staff-test',status:'ARRIVED',arrivedAt:now,updatedAt:now});
    expect((await app.inject({method:'GET',url:'/api/v1/pickup/orders/lookup?deliveryPlanId=delivery-plan-other-staff-test&orderNo=HT-NOPE',headers:managerHeaders})).statusCode).toBe(403);

    const suspended=await app.inject({method:'PATCH',url:`/api/v1/admin/staff/${createdData.staff.userId}`,headers:superHeaders(),payload:{status:'SUSPENDED',reason:'人员离岗，立即回收点位权限'}});
    expect(suspended.statusCode,suspended.body).toBe(200);
    expect((await app.inject({method:'GET',url:'/api/v1/admin/community/deliveries',headers:managerHeaders})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/v1/auth/admin/login',payload:{username:'lianchi.manager',password:'a new manager password'}})).statusCode).toBe(403);
    const audits=await store.listAuditLogs(50);
    expect(audits.map((item)=>item.action)).toEqual(expect.arrayContaining(['STAFF_CREATED','STAFF_ACTIVATED','STAFF_SUSPENDED']));
  });

  it('keeps legacy verifier grants behind super-admin compatibility access',async()=>{
    await store.saveUser({id:'legacy-verifier',wechatOpenId:null,status:'ACTIVE',createdAt:new Date().toISOString()});
    const operator={'x-demo-user-id':'operator-1','x-demo-role':'OPERATOR'};
    const payload={userId:'legacy-verifier',pickupPointId:'pickup-demo-001'};
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:operator,payload})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:superHeaders(),payload})).statusCode).toBe(200);
  });

  it('clears a pickup-manager point scope when the employee changes to another fixed role',async()=>{
    const created=await app.inject({method:'POST',url:'/api/v1/admin/staff',headers:superHeaders(),payload:{displayName:'待转岗负责人',username:'role.change',phone:'13800000003',role:'PICKUP_MANAGER',pickupPointIds:['pickup-demo-001']}});
    expect(created.statusCode,created.body).toBe(201);
    const userId=created.json().data.staff.userId as string;
    // A stale hidden form value is deliberately supplied. The server must
    // remove it instead of retaining a non-manager point authorization.
    const changed=await app.inject({method:'PATCH',url:`/api/v1/admin/staff/${userId}`,headers:superHeaders(),payload:{role:'OPERATOR',pickupPointIds:['pickup-demo-001']}});
    expect(changed.statusCode,changed.body).toBe(200);
    expect(changed.json().data).toMatchObject({role:'OPERATOR',pickupPointIds:[]});
    expect(await store.listStaffPickupPointAssignments(userId)).toEqual([]);
  });

  it('does not disclose or let an operator overwrite commercial product references',async()=>{
    const created=await app.inject({method:'POST',url:'/api/v1/admin/platform/skus',headers:superHeaders(),payload:{title:'脱敏测试商品',category:'常温',origin:'保定',imageUrl:null,skuName:'500g',retailPriceCents:2500,defaultSellableQuantity:30,referencePurchaseCostCents:900,supplierNote:'仅采购可见',status:'ACTIVE'}});
    expect(created.statusCode,created.body).toBe(201);
    const sku=created.json().data as {id:string;productId:string;referencePurchaseCostCents:number;supplierNote:string};
    const operator={'x-demo-user-id':'operator-1','x-demo-role':'OPERATOR'};
    const listed=await app.inject({method:'GET',url:'/api/v1/admin/platform/skus',headers:operator});
    expect(listed.statusCode).toBe(200);
    const safe=(listed.json().data as Array<Record<string,unknown>>).find((item)=>item.id===sku.id)!;
    expect(safe).not.toHaveProperty('referencePurchaseCostCents');
    expect(safe).not.toHaveProperty('supplierNote');
    const attempted=await app.inject({method:'POST',url:'/api/v1/admin/platform/skus',headers:operator,payload:{id:sku.id,productId:sku.productId,title:'脱敏测试商品',category:'常温',origin:'保定',imageUrl:null,skuName:'500g',retailPriceCents:2500,defaultSellableQuantity:30,referencePurchaseCostCents:1,supplierNote:'尝试覆盖',status:'ACTIVE'}});
    expect(attempted.statusCode,attempted.body).toBe(200);
    const reviewed=await app.inject({method:'GET',url:'/api/v1/admin/platform/skus',headers:superHeaders()});
    const commercial=(reviewed.json().data as Array<{id:string;referencePurchaseCostCents:number;supplierNote:string}>).find((item)=>item.id===sku.id)!;
    expect(commercial).toMatchObject({referencePurchaseCostCents:900,supplierNote:'仅采购可见'});
  });
});
