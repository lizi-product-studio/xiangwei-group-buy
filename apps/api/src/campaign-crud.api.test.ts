import { moneyCents } from "@hometown/domain";
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryStore } from './modules/core/store.js';
import { createAdminCredential } from './modules/auth/admin-auth.js';
import type { CommunityCampaignInput } from './modules/fulfillment/community-fulfillment-service.js';

class InspectableStore extends MemoryStore {
  salesOrderReads = 0;
  salesRefundReads = 0;
  override async listOrders(limit: number) { this.salesOrderReads += 1; return super.listOrders(limit); }
  override async listOrderRefunds(limit: number) { this.salesRefundReads += 1; return super.listOrderRefunds(limit); }
  businessSnapshot() {
    const value = JSON.parse(this.exportState()) as Record<string,unknown>;
    return {users:value.users,sessions:value.sessions,audit:value.audits,orders:value.orders,ledger:value.ledger};
  }
}
// TASK-20260908-CRUD-CLOSURE: HTTP with actual bearer sessions; isolated bootstrap fixtures.
describe('draft campaign CRUD and private consumer directory', () => {
  let app: FastifyInstance;
  let store: InspectableStore;
  let headers: {authorization:string};
  let input: CommunityCampaignInput;
  let pointId: string;
  const call = (method: InjectOptions['method'], url:string, payload?:unknown, auth = headers) => app.inject({method,url,headers:auth,...(payload === undefined ? {} : {payload: payload as InjectOptions['payload']})});
  beforeEach(async () => {
    store = new InspectableStore(false);
    const now = new Date().toISOString();
    await store.saveUser({id:'bootstrap',wechatOpenId:null,status:'ACTIVE',createdAt:now});
    await store.replaceUserRoles('bootstrap',['SUPER_ADMIN']);
    await store.saveInternalStaff({userId:'bootstrap',staffNo:'BOOTSTRAP',displayName:'测试管理员',phone:'13800000000',role:'SUPER_ADMIN',status:'ACTIVE',createdBy:null,activatedAt:now,suspendedAt:null,suspensionReason:null,authorizationVersion:1,createdAt:now,updatedAt:now});
    await store.saveAdminCredential(await createAdminCredential('bootstrap','bootstrap','TestBootstrap123',['SUPER_ADMIN'],false,1));
    app = await buildApp({config:loadConfig({NODE_ENV:'test',AUTH_PROVIDER:'wechat',WECHAT_APP_ID:'test-only-app',WECHAT_APP_SECRET:'test-only'}),store});
    const login = await app.inject({method:'POST',url:'/api/v1/auth/admin/login',payload:{username:'bootstrap',password:'TestBootstrap123'}});
    headers = {authorization:`Bearer ${login.json().data.accessToken}`};
    const area = await call('POST','/api/v1/admin/service-areas',{regionCode:'110101'});
    const areaId = area.json().data.id;
    const point = await call('POST','/api/v1/admin/pickup-points',{serviceAreaId:areaId,name:'测试自提点',address:'测试社区一号',businessHours:'09:00-20:00',pickupInstructions:'请出示取货码',latitude:39.9,longitude:116.4,contactName:'测试负责人',contactPhone:'13800000002',capacityPerDay:100,photoUrl:'https://example.com/pickup.jpg'});
    expect(point.statusCode,point.body).toBe(201);
    pointId = point.json().data.id;
    const sku = await call('POST','/api/v1/admin/catalog/skus',{title:'测试蔬菜',category:'蔬菜',origin:'测试农场',imageUrl:null,skuName:'一份',retailPriceCents:1200,defaultSellableQuantity:20,status:'ACTIVE'});
    expect(sku.statusCode,sku.body).toBe(201);
    input = {title:'草稿测试团期',serviceAreaId:areaId,pickupPointId:pointId,cutoffAt:new Date(Date.now()+3600000).toISOString(),dispatchAt:new Date(Date.now()+7200000).toISOString(),estimatedArrivalStartAt:new Date(Date.now()+10800000).toISOString(),estimatedArrivalEndAt:new Date(Date.now()+14400000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',items:[{catalogSkuId:sku.json().data.id,retailPriceCents:1000,sellableQuantity:10}]};
  });
  afterEach(async()=>app?.close());
  const create = async (body=input) => {
    const response = await call('POST','/api/v1/admin/campaigns',body);
    expect(response.statusCode,response.body).toBe(201);
    return response.json().data as {id:string;version:number;deliveryPlan:{id:string}};
  };
  const state = async (id:string) => ({campaign:await store.getCampaign(id),plans:await store.listDeliveryPlans(),orders:await store.listOrdersByCampaign(id),batches:await store.listDispatchBatches(),ledger:await store.listLedgerTransactions(),audit:await store.listAuditLogs(1000)});
  it('uses current catalog images in open campaign list and detail without rewriting snapshots', async () => {
    const campaign = await create();
    expect((await call('POST', `/api/v1/admin/campaigns/${campaign.id}/open`)).statusCode).toBe(200);
    const frozen = await state(campaign.id);
    const sku = (await store.getCatalogSku(input.items[0]!.catalogSkuId))!;
    const assertImage = async (imageUrl: string | null) => {
      const list = await app.inject({method: 'GET', url: '/api/v1/campaigns'});
      const detail = await app.inject({method: 'GET', url: `/api/v1/campaigns/${campaign.id}`});
      expect(list.statusCode).toBe(200);
      expect(detail.statusCode).toBe(200);
      const listed = list.json().data.find((item: {id: string}) => item.id === campaign.id);
      for (const projection of [listed, detail.json().data]) {
        expect(projection.items[0]).toMatchObject({imageUrl, title: '测试蔬菜', unitPriceCents: 1000, stock: 10});
      }
      expect(await state(campaign.id)).toEqual(frozen);
    };
    await assertImage(null);
    // Cover an image added after opening, replacement, and explicit removal.
    for (const imageUrl of ['/api/v1/product-images/first.webp', '/api/v1/product-images/replaced.webp', null]) {
      await store.saveCatalogSku({...sku, product: {...sku.product, title: '新的目录名称', imageUrl}, retailPriceCents: moneyCents(2000)});
      await assertImage(imageUrl);
    }
    await store.saveCatalogSku({...sku, status: 'INACTIVE'});
    const hidden = await app.inject({method: 'GET', url: `/api/v1/campaigns/${campaign.id}`});
    expect(hidden.json().data.items).toEqual([]);
    expect(await state(campaign.id)).toEqual(frozen);
  });
  it('shares one net-sales aggregation across an admin campaign list request', async () => {
    await create();
    await create({ ...input, title: '第二个团期' });
    store.salesOrderReads = 0;
    store.salesRefundReads = 0;
    const response = await call('GET', '/api/v1/admin/campaigns');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toHaveLength(2);
    expect(store.salesOrderReads).toBe(1);
    expect(store.salesRefundReads).toBe(1);
    const campaigns = response.json().data as Array<{ id: string }>;
    for (const campaign of campaigns) expect((await call('POST', `/api/v1/admin/campaigns/${campaign.id}/open`)).statusCode).toBe(200);
    store.salesOrderReads = 0;
    store.salesRefundReads = 0;
    const publicResponse = await app.inject({ method: 'GET', url: '/api/v1/campaigns' });
    expect(publicResponse.statusCode, publicResponse.body).toBe(200);
    expect(publicResponse.json().data).toHaveLength(2);
    expect(store.salesOrderReads).toBe(1);
    expect(store.salesRefundReads).toBe(1);
  });
  it('repairs expired draft through PATCH then opens with preserved identity and updated snapshot',async()=>{
    const campaign = await create({...input,cutoffAt:new Date(Date.now()-1000).toISOString()});
    const failed = await call('POST',`/api/v1/admin/campaigns/${campaign.id}/open`);
    expect(failed.statusCode).toBe(409);
    expect(failed.json().code).toBe('CAMPAIGN_CLOSED');
    const before = (await store.getCampaign(campaign.id))!;
    const edited = await call('PATCH',`/api/v1/admin/campaigns/${campaign.id}`,{...input,title:'修正后的团期',version:1,items:[{...input.items[0]!,retailPriceCents:1500,sellableQuantity:30}]});
    expect(edited.statusCode,edited.body).toBe(200);
    expect(edited.json().data).toMatchObject({id:campaign.id,title:'修正后的团期',version:2});
    expect((await store.getCampaign(campaign.id))?.createdAt).toBe(before.createdAt);
    expect((await store.getCampaign(campaign.id))?.items[0]).toMatchObject({retailPriceCents:1500,sellableQuantity:30,reservedQuantity:0});
    expect((await store.getDeliveryPlanByCampaign(campaign.id))?.id).toBe(campaign.deliveryPlan.id);
    expect((await call('POST',`/api/v1/admin/campaigns/${campaign.id}/open`)).statusCode).toBe(200);
    expect((await call('GET',`/api/v1/campaigns/${campaign.id}`)).json().data.title).toBe('修正后的团期');
    const frozen = await state(campaign.id);
    for (const method of ['PATCH','DELETE'] as const) {
      const response = await call(method,`/api/v1/admin/campaigns/${campaign.id}`,method==='PATCH'?{...input,version:3}:{version:3});
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('CAMPAIGN_NOT_DRAFT');
      expect(await state(campaign.id)).toEqual(frozen);
    }
  });
  it('deletes only draft aggregate and generated plan while preserving audit',async()=>{
    const c = await create();
    const response = await call('DELETE',`/api/v1/admin/campaigns/${c.id}`,{version:1});
    expect(response.statusCode,response.body).toBe(200);
    expect(await store.getCampaign(c.id)).toBeNull();
    expect(await store.getDeliveryPlanByCampaign(c.id)).toBeNull();
    expect(await store.getCampaignItem(c.id,input.items[0]!.catalogSkuId)).toBeNull();
    expect((await call('GET',`/api/v1/campaigns/${c.id}`)).statusCode).toBe(404);
    expect((await call('GET','/api/v1/admin/campaigns')).json().data).toEqual([]);
    const audit = (await store.listAuditLogs(100)).find(a=>a.action==='COMMUNITY_CAMPAIGN_DELETED');
    expect(audit?.beforeData).toMatchObject({campaign:{id:c.id,status:'DRAFT'},plan:{id:c.deliveryPlan.id}});
    expect((await call('DELETE',`/api/v1/admin/campaigns/${c.id}`,{version:1})).statusCode).toBe(404);
  });
  it('rejects stale versions, invalid timelines and invalid catalog without partial writes',async()=>{
    const c = await create();
    const before = await state(c.id);
    for (const payload of [{...input,version:2},{...input,version:1,dispatchAt:input.cutoffAt},{...input,version:1,items:[{...input.items[0]!,catalogSkuId:'missing'}]}]) {
      const response = await call('PATCH',`/api/v1/admin/campaigns/${c.id}`,payload);
      expect([400,404,409]).toContain(response.statusCode);
      expect(await state(c.id)).toEqual(before);
    }
    expect((await call('DELETE',`/api/v1/admin/campaigns/${c.id}`,{version:2})).statusCode).toBe(409);
    expect(await state(c.id)).toEqual(before);
  });
  it('preserves booked transport on safe draft edit and rejects delete, point changes or ETA conflicts',async()=>{
    const c = await create();
    const booking = await call('POST',`/api/v1/admin/delivery-plans/${c.deliveryPlan.id}/book-vehicle`,{logisticsPlatform:'测试平台',vehicleOrderNo:'TEST-001',driverName:'测试司机',estimatedArrivalAt:input.estimatedArrivalStartAt});
    expect(booking.statusCode,booking.body).toBe(200);
    const plan = (await store.getDeliveryPlanByCampaign(c.id))!;
    const edited = await call('PATCH',`/api/v1/admin/campaigns/${c.id}`,{...input,title:'保留运输编辑',version:1});
    expect(edited.statusCode,edited.body).toBe(200);
    const saved = (await store.getDeliveryPlanByCampaign(c.id))!;
    expect(saved).toMatchObject({status:'VEHICLE_BOOKED',vehicleOrderNo:plan.vehicleOrderNo,driverName:plan.driverName,bookedAt:plan.bookedAt,estimatedArrivalAt:plan.estimatedArrivalAt});
    const before = await state(c.id);
    expect((await call('DELETE',`/api/v1/admin/campaigns/${c.id}`,{version:2})).statusCode).toBe(409);
    expect(await state(c.id)).toEqual(before);
    const secondPoint = await call('POST','/api/v1/admin/pickup-points',{serviceAreaId:input.serviceAreaId,name:'另一测试点',address:'测试社区二号',businessHours:'09:00-20:00',pickupInstructions:'请出示取货码',latitude:39.91,longitude:116.4,contactName:'测试负责人',contactPhone:'13800000002',capacityPerDay:100,photoUrl:'https://example.com/second-pickup.jpg'});
    expect((await call('PATCH',`/api/v1/admin/campaigns/${c.id}`,{...input,version:2,pickupPointId:secondPoint.json().data.id})).statusCode).toBe(409);
    expect((await store.getCampaign(c.id))).toEqual(before.campaign);
    const etaConflict = {...input,version:2,dispatchAt:new Date(Date.parse(input.estimatedArrivalStartAt)+1000).toISOString(),estimatedArrivalStartAt:input.estimatedArrivalEndAt,estimatedArrivalEndAt:input.estimatedArrivalEndAt};
    expect((await call('PATCH',`/api/v1/admin/campaigns/${c.id}`,etaConflict)).statusCode).toBe(409);
    expect((await store.getDeliveryPlanByCampaign(c.id))).toEqual(saved);
  });
  it.each(['PATCH','DELETE'] as const)('serializes %s against opening without changing an opened snapshot',async(method)=>{
    const c = await create();
    const [opened,changed] = await Promise.all([call('POST',`/api/v1/admin/campaigns/${c.id}/open`),call(method,`/api/v1/admin/campaigns/${c.id}`,method==='PATCH'?{...input,title:'竞态修改',version:1}:{version:1})]);
    if (opened.statusCode===200) {
      expect(changed.statusCode).toBe(409);
      expect((await store.getCampaign(c.id))).toMatchObject({status:'OPEN',title:input.title});
    } else {
      expect([404,409]).toContain(opened.statusCode);
      expect(changed.statusCode).toBe(200);
    }
    expect(await store.listOrdersByCampaign(c.id)).toEqual([]);
    expect(await store.listLedgerTransactions()).toEqual([]);
  });
  it('allows only one editor or deletion using the same draft version',async()=>{
    const c = await create();
    const responses = await Promise.all([call('PATCH',`/api/v1/admin/campaigns/${c.id}`,{...input,title:'版本编辑',version:1}),call('DELETE',`/api/v1/admin/campaigns/${c.id}`,{version:1})]);
    expect(responses.filter(r=>r.statusCode===200)).toHaveLength(1);
    expect(responses.filter(r=>[404,409].includes(r.statusCode))).toHaveLength(1);
  });
  it.each(['batch','arrival'] as const)('refuses a referenced draft with %s history without any partial writes',async(kind)=>{
    const c = await create();
    // Defensive legacy/inconsistent aggregate fixtures; the public flow cannot create these on DRAFT.
    if (kind==='batch') await store.saveDispatchBatch({id:'historical-batch',campaignId:c.id,serviceAreaId:input.serviceAreaId,status:'DRAFT',createdAt:new Date().toISOString(),dispatchedAt:null});
    else await store.saveCommunityDeliveryConfirmation({id:'historical-arrival',dispatchBatchId:'historical-batch',campaignId:c.id,deliveryPlanId:c.deliveryPlan.id,status:'COMPLETED',confirmedBy:'bootstrap',receivedBy:'测试负责人',confirmationNote:null,confirmedAt:new Date().toISOString(),items:[]});
    const before = await state(c.id);
    for (const method of ['PATCH','DELETE'] as const) {
      const response=await call(method,`/api/v1/admin/campaigns/${c.id}`,method==='PATCH'?{...input,version:1}:{version:1});
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('CAMPAIGN_HAS_REFERENCES');
      expect(await state(c.id)).toEqual(before);
    }
    if(kind==='arrival') expect(await store.getCommunityDeliveryConfirmationByBatch('historical-batch')).not.toBeNull();
  });
  it('refuses deletion when even a cancelled historical order references the draft',async()=>{
    const c=await create();
    const now=new Date().toISOString();
    const sku=(await store.getCatalogSku(input.items[0]!.catalogSkuId))!;
    // A retained historical reference must never be ignored just because payment was cancelled.
    await store.saveOrder({id:'cancelled-order',orderNo:'CANCELLED-TEST',userId:'historical-consumer',campaignId:c.id,serviceAreaId:input.serviceAreaId,pickupPointId:pointId,deliveryPlanId:c.deliveryPlan.id,status:'CANCELLED',totalCents:moneyCents(1000),createdAt:now,expiresAt:now,paidAt:null,pickedUpAt:null,items:[{orderLineId:null,skuId:sku.id,productId:sku.productId,name:'历史蔬菜 · 一份',quantity:1,unitPriceCents:moneyCents(1000),amountCents:moneyCents(1000),fulfilledQuantity:0,pickedUpQuantity:0,exceptionQuantity:0,refundedQuantity:0,refundedAmountCents:moneyCents(0)}]});
    const before=await state(c.id);
    const response=await call('DELETE',`/api/v1/admin/campaigns/${c.id}`,{version:1});
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CAMPAIGN_HAS_REFERENCES');
    expect(await state(c.id)).toEqual(before);
  });
  it('masks consumer list and details, supports stable paging/search and rejects unauthorized roles',async()=>{
    for (let i=0;i<3;i++) await store.saveUser({id:`consumer-${i}`,wechatOpenId:`never-return-openid-${i}`,phoneNumber:`1380013800${i}`,phoneVerifiedAt:new Date().toISOString(),status:'ACTIVE',createdAt:`2026-09-08T00:00:0${i}.000Z`});
    const queryBefore = store.businessSnapshot();
    const list = await call('GET','/api/v1/admin/consumers?page=1&pageSize=2');
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toMatchObject({total:3,page:1,pageSize:2});
    expect(list.json().data.items.map((u:{id:string})=>u.id)).toEqual(['consumer-2','consumer-1']);
    expect(list.body).not.toContain('never-return');
    expect(list.body).not.toContain('138001380');
    const detail = await call('GET','/api/v1/admin/consumers/consumer-0');
    expect(detail.json().data).toEqual({id:'consumer-0',maskedPhone:'138****8000',phoneVerified:true,status:'ACTIVE',createdAt:'2026-09-08T00:00:00.000Z',orderCount:0,orders:[]});
    expect((await call('GET','/api/v1/admin/consumers?query=13800138001')).json().data.total).toBe(1);
    expect((await call('GET','/api/v1/admin/consumers/bootstrap')).statusCode).toBe(404);
    expect((await call('GET','/api/v1/admin/consumers?pageSize=101')).statusCode).toBe(400);
    expect(store.businessSnapshot()).toEqual(queryBefore);
    const c = await create();
    const before = await state(c.id);
    const noAuth = {} as typeof headers;
    expect((await call('GET','/api/v1/admin/consumers',undefined,noAuth)).statusCode).toBe(401);
    for (const role of ['OPERATOR','FINANCE','PICKUP_MANAGER','CUSTOMER_SERVICE'] as const) {
      const username = `test-${role.toLowerCase()}`;
      const created = await call('POST','/api/v1/admin/staff',{role,username,phone:`138000000${10+['OPERATOR','FINANCE','PICKUP_MANAGER','CUSTOMER_SERVICE'].indexOf(role)}`,pickupPointIds:role==='PICKUP_MANAGER'?[pointId]:[],status:'ACTIVE',displayName:username});
      expect(created.statusCode,created.body).toBe(201);
      const login = await app.inject({method:'POST',url:'/api/v1/auth/admin/login',payload:{username,password:created.json().data.temporaryPassword}});
      const change = await app.inject({method:'POST',url:'/api/v1/auth/admin/complete-password-change',payload:{passwordChangeToken:login.json().data.passwordChangeToken,newPassword:'ChangedPassword123'}});
      const roleHeaders = {authorization:`Bearer ${change.json().data.accessToken}`};
      expect((await call('GET','/api/v1/admin/consumers',undefined,roleHeaders)).statusCode).toBe(role==='CUSTOMER_SERVICE'?200:403);
      expect((await call('GET','/api/v1/admin/consumers/consumer-0',undefined,roleHeaders)).statusCode).toBe(role==='CUSTOMER_SERVICE'?200:403);
      if (role !== 'OPERATOR') {
        expect((await call('PATCH',`/api/v1/admin/campaigns/${c.id}`,{...input,version:1},roleHeaders)).statusCode).toBe(403);
        expect((await call('DELETE',`/api/v1/admin/campaigns/${c.id}`,{version:1},roleHeaders)).statusCode).toBe(403);
      }
    }
    expect((await call('PATCH',`/api/v1/admin/campaigns/${c.id}`,{...input,version:1},noAuth)).statusCode).toBe(401);
    expect((await call('DELETE',`/api/v1/admin/campaigns/${c.id}`,{version:1},noAuth)).statusCode).toBe(401);
    const after = await state(c.id);
    expect({...after,audit:[]}).toEqual({...before,audit:[]});
  });
});
