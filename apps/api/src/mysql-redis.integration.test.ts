import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MysqlStore } from './modules/core/mysql-store.js';

const databaseUrl=process.env.INTEGRATION_DATABASE_URL;const redisUrl=process.env.INTEGRATION_REDIS_URL;
const migrationTestDatabaseUrl=process.env.MIGRATION_TEST_DATABASE_URL;
const execFile=promisify(execFileCallback);

function temporaryMigrationDatabaseUrl(baseUrl:string,databaseName:string):string{
  const value=new URL(baseUrl);value.pathname=`/${databaseName}`;return value.toString();
}

function migrationServerUrl(baseUrl:string):string{
  const value=new URL(baseUrl);value.pathname='/';return value.toString();
}

async function runMigrationProcess(url:string,stopAfter?:string,disableStaffRecovery=false):Promise<string>{
  const result=await execFile(process.execPath,['--import','tsx','src/scripts/migrate.ts'],{
    cwd:process.cwd(),
    env:{...process.env,DATABASE_URL:url,NODE_ENV:'test',...(stopAfter?{MIGRATION_TEST_STOP_AFTER:stopAfter}:{}),...(disableStaffRecovery?{MIGRATION_TEST_DISABLE_0033_RECOVERY:'true'}:{})},
  });
  return `${result.stdout}\n${result.stderr}`;
}
describe.skipIf(!databaseUrl||!redisUrl)('real MySQL and Redis integration',()=>{
  let app:FastifyInstance;
  let store:MysqlStore;
  beforeAll(async()=>{
    store=MysqlStore.create(databaseUrl!);
    const createdAt=new Date().toISOString();
    await Promise.all(['integration-platform-operator','integration-platform-customer','integration-community-operator','integration-community-customer'].map((id)=>store.saveUser({id,wechatOpenId:null,status:'ACTIVE',createdAt})));
    app=await buildApp({config:loadConfig({NODE_ENV:'test',DATA_STORE:'mysql',DATABASE_URL:databaseUrl,QUEUE_DRIVER:'redis',REDIS_URL:redisUrl,PICKUP_CODE_SECRET:'integration-pickup-secret-value',PLATFORM_PROCUREMENT_ENABLED:'true',COMMUNITY_FULFILLMENT_ENABLED:'true'}),store});
  });
  afterAll(async()=>{if(app)await app.close();});
  it('runs migrations, persists a campaign and closes it through a recovered Redis job',async()=>{
    expect((await app.inject({method:'GET',url:'/health/ready'})).statusCode).toBe(200);
    const operator={'x-demo-user-id':'integration-operator','x-demo-role':'OPERATOR'};
    const suffix=crypto.randomUUID().slice(0,8);
    const merchant=await app.inject({method:'POST',url:'/api/v1/admin/merchants',headers:operator,payload:{name:`Integration merchant ${suffix}`,defaultCommissionBps:500,wechatSubMchid:null}});
    expect(merchant.statusCode,merchant.body).toBe(201);
    const product=await app.inject({method:'POST',url:'/api/v1/admin/products',headers:operator,payload:{merchantId:merchant.json().data.id,title:`Integration product ${suffix}`,category:'测试',origin:'测试产地',imageUrl:null,skuName:'500g',priceCents:1990,stock:10}});
    expect(product.statusCode,product.body).toBe(201);
    const productId=product.json().data.id as string;const skuId=product.json().data.sku.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/products/${productId}/submit-review`,headers:operator})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/products/${productId}/review`,headers:{'x-demo-user-id':'integration-reviewer','x-demo-role':'REVIEWER'},payload:{decision:'APPROVE'}})).statusCode).toBe(200);
    const cutoffAt=new Date(Date.now()+1_500).toISOString();
    const created=await app.inject({method:'POST',url:'/api/v1/admin/campaigns',headers:operator,payload:{title:'真实基础设施联调团',serviceAreaId:'service-hz',cutoffAt,dispatchAt:new Date(Date.now()+60_000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',skuIds:[skuId]}});
    expect(created.statusCode).toBe(201);const campaignId=created.json().data.id as string;
    const site=await app.inject({method:'POST',url:'/api/v1/admin/delivery-plans',headers:{'x-demo-user-id':'integration-operator','x-demo-role':'OPERATOR'},payload:{campaignId,pickupPointId:'pickup-hz-001',siteName:'莲池区裕华路自提点',address:'河北省保定市莲池区裕华西路（演示地址）',arrivalStartAt:new Date(Date.now()+86_400_000).toISOString(),arrivalEndAt:null,contactName:'集成测试负责人',contactPhone:'13800000000',remark:'真实 MySQL 固定自提点'}});
    expect(site.statusCode,site.body).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/open`,headers:{'x-demo-user-id':'integration-operator','x-demo-role':'OPERATOR'}})).statusCode).toBe(200);
    let status='OPEN';const deadline=Date.now()+8_000;
    while(Date.now()<deadline&&status==='OPEN'){await new Promise((resolve)=>setTimeout(resolve,150));const response=await app.inject({method:'GET',url:'/api/v1/admin/campaigns',headers:operator});status=(response.json().data as Array<{id:string;status:string}>).find((campaign)=>campaign.id===campaignId)?.status ?? 'MISSING';}
    expect(status).toBe('CANCELLED');
  },12_000);

  it('persists two mode-B receipt batches and one replenishment retry through MySQL and Redis',async()=>{
    const operator={'x-demo-user-id':'integration-platform-operator','x-demo-role':'SUPER_ADMIN'};
    const customer={'x-demo-user-id':'integration-platform-customer','x-demo-role':'USER'};
    const suffix=crypto.randomUUID().slice(0,8);
    const warehouse=(await app.inject({method:'POST',url:'/api/v1/admin/platform/warehouses',headers:operator,payload:{name:`Integration warehouse ${suffix}`,address:`Integration warehouse address ${suffix}`,status:'ACTIVE'}}));
    expect(warehouse.statusCode,warehouse.body).toBe(201);
    const supplier=(await app.inject({method:'POST',url:'/api/v1/admin/platform/suppliers',headers:operator,payload:{name:`Integration supplier ${suffix}`,contactName:'Integration contact',contactPhone:'13800000000',status:'ACTIVE'}}));
    expect(supplier.statusCode,supplier.body).toBe(201);
    const qualification=await app.inject({method:'POST',url:`/api/v1/admin/platform/suppliers/${supplier.json().data.id}/qualifications`,headers:operator,payload:{qualificationType:'FOOD_LICENSE',qualificationNo:`QUAL-${suffix}`,expiresAt:'2099-01-01',status:'APPROVED',evidenceSummary:'integration approved qualification'}});
    expect(qualification.statusCode,qualification.body).toBe(201);
    const sku=(await app.inject({method:'POST',url:'/api/v1/admin/platform/skus',headers:operator,payload:{title:`Integration SKU ${suffix}`,category:'Dry goods',origin:'Integration origin',imageUrl:null,skuName:'One pack',retailPriceCents:1200,status:'ACTIVE'}}));
    expect(sku.statusCode,sku.body).toBe(201);
    const offer=(await app.inject({method:'POST',url:'/api/v1/admin/platform/offers',headers:operator,payload:{supplierId:supplier.json().data.id,platformSkuId:sku.json().data.id,purchasePriceCents:700,minimumPurchaseQuantity:1,leadTimeDays:1,status:'ACTIVE'}}));
    expect(offer.statusCode,offer.body).toBe(201);
    const cutoffAt=new Date(Date.now()+1_500).toISOString();
    const campaign=(await app.inject({method:'POST',url:'/api/v1/admin/platform/campaigns',headers:operator,payload:{title:`Integration platform campaign ${suffix}`,serviceAreaId:'service-hz',warehouseId:warehouse.json().data.id,cutoffAt,dispatchAt:new Date(Date.now()+60_000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',items:[{platformSkuId:sku.json().data.id,supplierOfferId:offer.json().data.id,sellableQuantity:10}]}}));
    expect(campaign.statusCode,campaign.body).toBe(201);
    const campaignId=campaign.json().data.id as string;
    const plan=await app.inject({method:'POST',url:'/api/v1/admin/delivery-plans',headers:operator,payload:{campaignId,pickupPointId:'pickup-hz-001',siteName:'莲池区裕华路自提点',address:'河北省保定市莲池区裕华西路（演示地址）',arrivalStartAt:null,arrivalEndAt:null,contactName:null,contactPhone:null,remark:null}});
    expect(plan.statusCode,plan.body).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/open`,headers:operator})).statusCode).toBe(200);
    const order=await app.inject({method:'POST',url:'/api/v1/orders',headers:{...customer,'idempotency-key':`integration-${suffix}`},payload:{campaignId,serviceAreaId:'service-hz',pickupPointId:'pickup-hz-001',items:[{skuId:sku.json().data.id,quantity:10}]}});
    expect(order.statusCode,order.body).toBe(201);
    const paid=await app.inject({method:'POST',url:`/api/v1/orders/${order.json().data.id}/mock-pay`,headers:customer});
    expect(paid.statusCode,paid.body).toBe(200);
    expect(paid.json().data).toMatchObject({status:'PAID_WAITING_CLOSE',paymentRoute:'PLATFORM_DIRECT'});
    let purchaseOrderId:string|undefined;let itemId:string|undefined;
    const deadline=Date.now()+10_000;
    while(Date.now()<deadline&&!purchaseOrderId){await new Promise((resolve)=>setTimeout(resolve,150));const response=await app.inject({method:'GET',url:'/api/v1/admin/platform/purchase-orders',headers:operator});const po=(response.json().data as Array<{campaignId:string;id:string;items:Array<{id:string}>}>).find((value)=>value.campaignId===campaignId);purchaseOrderId=po?.id;itemId=po?.items[0]?.id;}
    expect(purchaseOrderId).toBeTruthy();expect(itemId).toBeTruthy();
    const firstPayload={items:[{purchaseOrderItemId:itemId!,acceptedQuantity:8,rejectedQuantity:2,batchNo:`LOT-${suffix}-A`,productionDate:null,expiresAt:null,inspectionNote:'supplier short receipt',exceptionReason:'SHORT_RECEIPT',evidenceUrl:null}]};
    const first=await app.inject({method:'POST',url:`/api/v1/admin/platform/purchase-orders/${purchaseOrderId}/receive`,headers:operator,payload:firstPayload});
    expect(first.statusCode,first.body).toBe(200);
    const retried=await app.inject({method:'POST',url:`/api/v1/admin/platform/purchase-orders/${purchaseOrderId}/receive`,headers:operator,payload:firstPayload});
    expect(retried.statusCode,retried.body).toBe(200);expect(retried.json().data.id).toBe(first.json().data.id);
    const replenishment=await app.inject({method:'POST',url:`/api/v1/admin/platform/purchase-orders/${purchaseOrderId}/receive`,headers:operator,payload:{items:[{purchaseOrderItemId:itemId!,acceptedQuantity:2,rejectedQuantity:0,batchNo:`LOT-${suffix}-B`,productionDate:null,expiresAt:null,inspectionNote:'replenishment accepted',evidenceUrl:null}]}});
    expect(replenishment.statusCode,replenishment.body).toBe(200);expect(replenishment.json().data.id).not.toBe(first.json().data.id);
    const finalRetry=await app.inject({method:'POST',url:`/api/v1/admin/platform/purchase-orders/${purchaseOrderId}/receive`,headers:operator,payload:{items:[{purchaseOrderItemId:itemId!,acceptedQuantity:2,rejectedQuantity:0,batchNo:`LOT-${suffix}-B`,productionDate:null,expiresAt:null,inspectionNote:'replenishment accepted',evidenceUrl:null}]}});
    expect(finalRetry.statusCode,finalRetry.body).toBe(200);expect(finalRetry.json().data.id).toBe(replenishment.json().data.id);
    const purchaseOrders=await app.inject({method:'GET',url:'/api/v1/admin/platform/purchase-orders',headers:operator});
    expect((purchaseOrders.json().data as Array<{id:string;status:string;items:Array<{acceptedQuantity:number;remainingQuantity:number}>}>).find((value)=>value.id===purchaseOrderId)).toMatchObject({status:'RECEIVED',items:[{acceptedQuantity:10,remainingQuantity:0}]});
    const sorting=await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/sorting`,headers:operator});
    expect(sorting.statusCode,sorting.body).toBe(200);
    const sortingTasks=await app.inject({method:'GET',url:'/api/v1/admin/platform/sorting-tasks',headers:operator});
    expect(sortingTasks.statusCode,sortingTasks.body).toBe(200);
    expect((sortingTasks.json().data as Array<{campaignId:string;status:string}>).find((value)=>value.campaignId===campaignId)).toMatchObject({status:'PENDING'});
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/sorting/complete`,headers:operator})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${plan.json().data.id}/book-vehicle`,headers:operator,payload:{vehicleOrderNo:`VEHICLE-${suffix}`,driverName:'Integration driver',driverPhone:'13900000000',vehiclePlate:'冀F12345'}})).statusCode).toBe(200);
    const outbound=await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/outbound`,headers:operator,payload:{carrierReference:`OUTBOUND-${suffix}`}});
    expect(outbound.statusCode,outbound.body).toBe(200);
  },15_000);

  it('persists a lightweight community sale and manual delivery without warehouse records',async()=>{
    const operator={'x-demo-user-id':'integration-community-operator','x-demo-role':'SUPER_ADMIN'};
    const customer={'x-demo-user-id':'integration-community-customer','x-demo-role':'USER'};
    const suffix=crypto.randomUUID().slice(0,8);
    const sku=await app.inject({method:'POST',url:'/api/v1/admin/platform/skus',headers:operator,payload:{title:`Integration community SKU ${suffix}`,category:'Dry goods',origin:'Integration origin',imageUrl:null,skuName:'One pack',retailPriceCents:1500,defaultSellableQuantity:5,status:'ACTIVE'}});
    expect(sku.statusCode,sku.body).toBe(201);
    const skuId=sku.json().data.id as string;
    const secondSku=await app.inject({method:'POST',url:'/api/v1/admin/platform/skus',headers:operator,payload:{title:`Integration community SKU B ${suffix}`,category:'Dry goods',origin:'Integration origin',imageUrl:null,skuName:'Two pack',retailPriceCents:1700,defaultSellableQuantity:5,status:'ACTIVE'}});
    expect(secondSku.statusCode,secondSku.body).toBe(201);const secondSkuId=secondSku.json().data.id as string;
    const campaign=await app.inject({method:'POST',url:'/api/v1/admin/community/campaigns',headers:operator,payload:{title:`Integration community campaign ${suffix}`,serviceAreaId:'service-hz',pickupPointId:'pickup-hz-001',cutoffAt:new Date(Date.now()+1_500).toISOString(),dispatchAt:new Date(Date.now()+86_400_000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',items:[{platformSkuId:skuId,retailPriceCents:1500,sellableQuantity:5},{platformSkuId:secondSkuId,retailPriceCents:1700,sellableQuantity:5}]}});
    expect(campaign.statusCode,campaign.body).toBe(201);
    const campaignId=campaign.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/open`,headers:operator})).statusCode).toBe(200);
    const order=await app.inject({method:'POST',url:'/api/v1/orders',headers:{...customer,'idempotency-key':`community-integration-${suffix}`},payload:{campaignId,serviceAreaId:'service-hz',pickupPointId:'pickup-hz-001',items:[{skuId,quantity:2},{skuId:secondSkuId,quantity:2}]}});
    expect(order.statusCode,order.body).toBe(201);
    expect((await app.inject({method:'POST',url:`/api/v1/orders/${order.json().data.id}/mock-pay`,headers:customer})).statusCode).toBe(200);
    await new Promise((resolve)=>setTimeout(resolve,1_700));
    expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/close`,headers:operator})).statusCode).toBe(200);
    const plan=(await app.inject({method:'GET',url:'/api/v1/admin/delivery-plans',headers:operator})).json().data.find((value:{campaignId:string})=>value.campaignId===campaignId) as {id:string};
    expect(plan).toBeTruthy();
    expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${plan.id}/book-vehicle`,headers:operator,payload:{logisticsPlatform:'货拉拉',vehicleOrderNo:`COMMUNITY-${suffix}`,driverName:'Integration driver',driverPhone:'13900000000',vehiclePlate:'冀F12345',estimatedArrivalAt:new Date(Date.now()+86_400_000).toISOString()}})).statusCode).toBe(200);
    const firstBatch=await app.inject({method:'POST',url:'/api/v1/admin/dispatch-batches',headers:operator,payload:{campaignId}});
    expect(firstBatch.statusCode,firstBatch.body).toBe(201);
    const repeatedBatch=await app.inject({method:'POST',url:'/api/v1/admin/dispatch-batches',headers:operator,payload:{campaignId}});
    expect(repeatedBatch.statusCode,repeatedBatch.body).toBe(201);
    expect(repeatedBatch.json().data.id).toBe(firstBatch.json().data.id);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/dispatch-batches/${firstBatch.json().data.id}/dispatch`,headers:operator})).statusCode).toBe(200);
    const deliveries=await app.inject({method:'GET',url:'/api/v1/admin/community/deliveries',headers:operator});
    expect(deliveries.statusCode,deliveries.body).toBe(200);
    expect(deliveries.json().data).toEqual(expect.arrayContaining([expect.objectContaining({campaignId,vehicleOrderNo:`COMMUNITY-${suffix}`,logisticsPlatform:'货拉拉',expectedItems:[expect.objectContaining({platformSkuId:skuId,expectedQuantity:2})]})]));
    const orderId=order.json().data.id as string;const batchId=firstBatch.json().data.id as string;
    const arrival=await app.inject({method:'POST',url:`/api/v1/admin/community/dispatch-batches/${batchId}/arrival`,headers:operator,payload:{receivedBy:'Integration emergency proxy',confirmationNote:'逐商品现场清点正常',emergencyReason:'真库集成测试代办',items:[{platformSkuId:skuId,receivedQuantity:2,rejectedQuantity:0,shortQuantity:0,damagedQuantity:0,reason:null,evidenceNote:null},{platformSkuId:secondSkuId,receivedQuantity:2,rejectedQuantity:0,shortQuantity:0,damagedQuantity:0,reason:null,evidenceNote:null}]}});expect(arrival.statusCode,arrival.body).toBe(200);
    const code=await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer});expect(code.statusCode,code.body).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:operator,payload:{orderId,deliveryPlanId:plan.id,code:code.json().data.code,pickupRequestId:'00000000-0000-4000-8000-000000000000'}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:operator,payload:{orderId,deliveryPlanId:plan.id,code:code.json().data.code,pickupRequestId:'00000000-0000-4000-8000-000000000001',items:[]}})).statusCode).toBe(400);
    const sameRequestId='11111111-1111-4111-8111-111111111111';const duplicateResponses=await Promise.all(Array.from({length:20},()=>app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:operator,payload:{orderId,deliveryPlanId:plan.id,code:code.json().data.code,pickupRequestId:sameRequestId,items:[{platformSkuId:skuId,quantity:1}]}})));expect(duplicateResponses.every((response)=>response.statusCode===200)).toBe(true);
    const multiSkuOverflow=await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:operator,payload:{orderId,deliveryPlanId:plan.id,code:code.json().data.code,pickupRequestId:'33333333-3333-4333-8333-333333333333',items:[{platformSkuId:skuId,quantity:1},{platformSkuId:secondSkuId,quantity:3}]}});expect(multiSkuOverflow.statusCode,multiSkuOverflow.body).toBe(400);
    const connection=await mysql.createConnection({uri:databaseUrl!});try{const [receiptRows]=await connection.query<Array<{receipt_count:number;platform_sku_id:string;picked_up_quantity:number}>>('SELECT (SELECT COUNT(*) FROM community_pickup_receipts WHERE order_id=? AND pickup_request_id=?) AS receipt_count,platform_sku_id,picked_up_quantity FROM sales_order_items WHERE order_id=? ORDER BY platform_sku_id',[orderId,sameRequestId,orderId]);expect(receiptRows).toEqual(expect.arrayContaining([{receipt_count:1,platform_sku_id:skuId,picked_up_quantity:1},{receipt_count:1,platform_sku_id:secondSkuId,picked_up_quantity:0}]));}finally{await connection.end();}
    const competingRequests=await Promise.all(Array.from({length:20},(_,index)=>app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:operator,payload:{orderId,deliveryPlanId:plan.id,code:code.json().data.code,pickupRequestId:`44444444-4444-4444-8444-${String(index+1).padStart(12,'0')}`,items:[{platformSkuId:secondSkuId,quantity:1}]}})));expect(competingRequests.filter((response)=>response.statusCode===200)).toHaveLength(2);expect(competingRequests.filter((response)=>response.statusCode===400)).toHaveLength(18);
    const concurrentConnection=await mysql.createConnection({uri:databaseUrl!});try{const [rows]=await concurrentConnection.query<Array<{platform_sku_id:string;picked_up_quantity:number;receipt_count:number}>>('SELECT soi.platform_sku_id,soi.picked_up_quantity,(SELECT COUNT(*) FROM community_pickup_receipts WHERE order_id=?) AS receipt_count FROM sales_order_items soi WHERE soi.order_id=? ORDER BY soi.platform_sku_id',[orderId,orderId]);expect(rows).toEqual(expect.arrayContaining([{platform_sku_id:skuId,picked_up_quantity:1,receipt_count:3},{platform_sku_id:secondSkuId,picked_up_quantity:2,receipt_count:3}]));}finally{await concurrentConnection.end();}
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:operator,payload:{orderId,deliveryPlanId:plan.id,code:code.json().data.code,pickupRequestId:'22222222-2222-4222-8222-222222222222',items:[{platformSkuId:skuId,quantity:1}]}})).statusCode).toBe(200);
    const purchaseOrders=await app.inject({method:'GET',url:'/api/v1/admin/platform/purchase-orders',headers:operator});
    expect((purchaseOrders.json().data as Array<{campaignId:string}>).filter((value)=>value.campaignId===campaignId)).toEqual([]);
  },15_000);

  it('persists a text-only community quality case without changing picked-up sales facts',async()=>{
    const operator={'x-demo-user-id':'integration-community-operator','x-demo-role':'SUPER_ADMIN'};
    const customer={'x-demo-user-id':'integration-community-customer','x-demo-role':'USER'};
    const suffix=crypto.randomUUID().slice(0,8);
    const sku=await app.inject({method:'POST',url:'/api/v1/admin/platform/skus',headers:operator,payload:{title:`Integration quality SKU ${suffix}`,category:'Dry goods',origin:'Integration origin',imageUrl:null,skuName:'One pack',retailPriceCents:1600,defaultSellableQuantity:2,status:'ACTIVE'}});
    expect(sku.statusCode,sku.body).toBe(201);
    const skuId=sku.json().data.id as string;
    const campaign=await app.inject({method:'POST',url:'/api/v1/admin/community/campaigns',headers:operator,payload:{title:`Integration quality campaign ${suffix}`,serviceAreaId:'service-hz',pickupPointId:'pickup-hz-001',cutoffAt:new Date(Date.now()+1_500).toISOString(),dispatchAt:new Date(Date.now()+86_400_000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',items:[{platformSkuId:skuId,retailPriceCents:1600,sellableQuantity:2}]}});
    expect(campaign.statusCode,campaign.body).toBe(201);
    const campaignId=campaign.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/open`,headers:operator})).statusCode).toBe(200);
    const order=await app.inject({method:'POST',url:'/api/v1/orders',headers:{...customer,'idempotency-key':`community-quality-${suffix}`},payload:{campaignId,serviceAreaId:'service-hz',pickupPointId:'pickup-hz-001',items:[{skuId,quantity:2}]}});
    expect(order.statusCode,order.body).toBe(201);
    const orderId=order.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/orders/${orderId}/mock-pay`,headers:customer})).statusCode).toBe(200);
    await new Promise((resolve)=>setTimeout(resolve,1_700));
    expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/close`,headers:operator})).statusCode).toBe(200);
    const plan=(await app.inject({method:'GET',url:'/api/v1/admin/delivery-plans',headers:operator})).json().data.find((value:{campaignId:string})=>value.campaignId===campaignId) as {id:string};
    expect(plan).toBeTruthy();
    expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${plan.id}/book-vehicle`,headers:operator,payload:{logisticsPlatform:'货拉拉',vehicleOrderNo:`QUALITY-${suffix}`,driverName:'Integration driver',driverPhone:'13900000000',vehiclePlate:'冀F12345',estimatedArrivalAt:new Date(Date.now()+86_400_000).toISOString()}})).statusCode).toBe(200);
    const batch=await app.inject({method:'POST',url:'/api/v1/admin/dispatch-batches',headers:operator,payload:{campaignId}});
    expect(batch.statusCode,batch.body).toBe(201);
    const batchId=batch.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/dispatch-batches/${batchId}/dispatch`,headers:operator})).statusCode).toBe(200);
    const arrival=await app.inject({method:'POST',url:`/api/v1/admin/community/dispatch-batches/${batchId}/arrival`,headers:operator,payload:{receivedBy:'Integration emergency proxy',confirmationNote:'逐商品现场清点正常',emergencyReason:'真库集成测试代办',items:[{platformSkuId:skuId,receivedQuantity:2,rejectedQuantity:0,shortQuantity:0,damagedQuantity:0,reason:null,evidenceNote:null}]}});
    expect(arrival.statusCode,arrival.body).toBe(200);
    const code=await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer});
    expect(code.statusCode,code.body).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:operator,payload:{orderId,deliveryPlanId:plan.id,code:code.json().data.code,pickupRequestId:crypto.randomUUID(),items:[{platformSkuId:skuId,quantity:2}]}})).statusCode).toBe(200);
    const payload={clientRequestId:`quality-case-${suffix}`,items:[{platformSkuId:skuId,quantity:1,reason:'QUALITY_CLAIM',description:'真库验证：领取后发现明显质量问题'}]};
    const first=await app.inject({method:'POST',url:`/api/v1/orders/${orderId}/community-quality-cases`,headers:customer,payload});
    expect(first.statusCode,first.body).toBe(201);
    const retry=await app.inject({method:'POST',url:`/api/v1/orders/${orderId}/community-quality-cases`,headers:customer,payload});
    expect(retry.statusCode,retry.body).toBe(201);expect(retry.json().data.id).toBe(first.json().data.id);
    const externalEvidence=await app.inject({method:'POST',url:`/api/v1/orders/${orderId}/community-quality-cases`,headers:customer,payload:{...payload,clientRequestId:`quality-case-url-${suffix}`,items:[{...payload.items[0],evidenceUrl:'https://evidence.example/unsafe'}]}});
    expect(externalEvidence.statusCode).toBe(400);expect(externalEvidence.json()).toMatchObject({code:'EVIDENCE_URL_NOT_ALLOWED'});
    const connection=await mysql.createConnection({uri:databaseUrl!});
    try{
      const [lineRows]=await connection.query<Array<{id:string;fulfilled_quantity:number;picked_up_quantity:number;exception_quantity:number}>>('SELECT id,fulfilled_quantity,picked_up_quantity,exception_quantity FROM sales_order_items WHERE order_id=?',[orderId]);
      const [caseRows]=await connection.query<Array<{case_count:number;item_count:number}>>('SELECT (SELECT COUNT(*) FROM community_quality_cases WHERE order_id=?) AS case_count,(SELECT COUNT(*) FROM community_quality_case_items WHERE community_quality_case_id=?) AS item_count',[orderId,first.json().data.id as string]);
      expect(lineRows).toMatchObject([{fulfilled_quantity:2,picked_up_quantity:2,exception_quantity:0}]);
      expect(caseRows).toEqual([{case_count:1,item_count:1}]);
      const invalidCaseId=crypto.randomUUID();
      await connection.execute('INSERT INTO community_quality_cases (id,order_id,user_id,client_request_id,payload_hash,status,registered_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))',[invalidCaseId,orderId,'integration-community-customer',`invalid-check-${suffix}`,'0'.repeat(64),'REGISTERED']);
      try{
        await expect(connection.execute('INSERT INTO community_quality_case_items (id,community_quality_case_id,sales_order_item_id,platform_sku_id,picked_up_quantity_snapshot,disputed_quantity,reason,description) VALUES (?,?,?,?,?,?,?,?)',[crypto.randomUUID(),invalidCaseId,lineRows[0]!.id,skuId,2,3,'QUALITY_CLAIM','must violate the picked-up snapshot quantity'])).rejects.toThrow();
      }finally{await connection.execute('DELETE FROM community_quality_cases WHERE id=?',[invalidCaseId]);}
    }finally{await connection.end();}
  },20_000);

  it.skipIf(!migrationTestDatabaseUrl)('recovers the 0033 partial-DDL failure without deleting migration artifacts or editing metadata manually',async()=>{
    const databaseName=`hometown_migration_recovery_${crypto.randomUUID().replaceAll('-','')}`;
    if(!databaseName.startsWith('hometown_migration_recovery_'))throw new Error('refusing to create an unexpected migration test database');
    const server=mysql.createConnection({uri:migrationServerUrl(migrationTestDatabaseUrl!)});
    await (await server).query(`CREATE DATABASE \`${databaseName}\``);
    const scratchUrl=temporaryMigrationDatabaseUrl(migrationTestDatabaseUrl!,databaseName);
    try{
      await runMigrationProcess(scratchUrl,'0032_community_fulfillment.sql');
      const scratch=await mysql.createConnection({uri:scratchUrl});
      await scratch.query('ALTER TABLE admin_credentials ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash');
      await scratch.end();

      await expect(runMigrationProcess(scratchUrl,undefined,true)).rejects.toBeDefined();
      const failed=await mysql.createConnection({uri:scratchUrl});
      const [failedRows]=await failed.query<Array<{state:string}>>("SELECT state FROM schema_migrations WHERE name = '0033_internal_staff_accounts.sql'");
      const [partialStaffRows]=await failed.query('SHOW TABLES LIKE \'internal_staff\'');
      const [partialAssignmentRows]=await failed.query('SHOW TABLES LIKE \'staff_pickup_point_assignments\'');
      expect(failedRows).toEqual([{state:'FAILED'}]);
      expect(partialStaffRows).toHaveLength(1);expect(partialAssignmentRows).toHaveLength(1);
      await failed.end();

      const output=await runMigrationProcess(scratchUrl);
      expect(output).toContain('recovered 0033_internal_staff_accounts.sql');
      const verified=await mysql.createConnection({uri:scratchUrl});
      const [migrationRows]=await verified.query<Array<{state:string;error_message:string|null}>>(
        "SELECT state,error_message FROM schema_migrations WHERE name = '0033_internal_staff_accounts.sql'",
      );
      expect(migrationRows).toEqual([{state:'APPLIED',error_message:null}]);
      const [staffRows]=await verified.query('SHOW TABLES LIKE \'internal_staff\'');
      const [assignmentRows]=await verified.query('SHOW TABLES LIKE \'staff_pickup_point_assignments\'');
      expect(staffRows).toHaveLength(1);expect(assignmentRows).toHaveLength(1);
      await verified.end();
      await expect(runMigrationProcess(scratchUrl)).resolves.toBeDefined();
    }finally{
      const cleanup=await server;
      await cleanup.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await cleanup.end();
    }
  },30_000);

  it.skipIf(!migrationTestDatabaseUrl)('refuses a same-named 0033 table whose phone column has an incompatible type',async()=>{
    const databaseName=`hometown_migration_incompatible_${crypto.randomUUID().replaceAll('-','')}`;
    if(!databaseName.startsWith('hometown_migration_incompatible_'))throw new Error('refusing to create an unexpected migration test database');
    const server=mysql.createConnection({uri:migrationServerUrl(migrationTestDatabaseUrl!)});
    await (await server).query(`CREATE DATABASE \`${databaseName}\``);
    const scratchUrl=temporaryMigrationDatabaseUrl(migrationTestDatabaseUrl!,databaseName);
    try{
      await runMigrationProcess(scratchUrl,'0032_community_fulfillment.sql');
      const scratch=await mysql.createConnection({uri:scratchUrl});
      await scratch.query(`CREATE TABLE internal_staff (
        user_id CHAR(36) PRIMARY KEY,
        staff_no VARCHAR(32) NOT NULL,
        display_name VARCHAR(80) NOT NULL,
        phone INT NOT NULL,
        role ENUM('SUPER_ADMIN','OPERATOR','CUSTOMER_SERVICE','FINANCE','PICKUP_MANAGER') NOT NULL,
        status ENUM('PENDING_ACTIVATION','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'PENDING_ACTIVATION',
        created_by CHAR(36) NULL,
        activated_at DATETIME(3) NULL,
        suspended_at DATETIME(3) NULL,
        suspension_reason VARCHAR(500) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        UNIQUE KEY uk_internal_staff_no (staff_no),
        UNIQUE KEY uk_internal_staff_phone (phone),
        INDEX idx_internal_staff_directory (status, role, display_name),
        CONSTRAINT fk_internal_staff_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB`);
      await scratch.query('ALTER TABLE admin_credentials ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash');
      await scratch.end();

      await expect(runMigrationProcess(scratchUrl,undefined,true)).rejects.toBeDefined();
      await expect(runMigrationProcess(scratchUrl)).rejects.toBeDefined();
      const verified=await mysql.createConnection({uri:scratchUrl});
      const [migrationRows]=await verified.query<Array<{state:string}>>("SELECT state FROM schema_migrations WHERE name = '0033_internal_staff_accounts.sql'");
      const [phoneRows]=await verified.query<Array<{Type:string;Null:string}>>('SHOW COLUMNS FROM internal_staff LIKE \'phone\'');
      expect(migrationRows).toEqual([{state:'FAILED'}]);
      expect(phoneRows).toMatchObject([{Type:'int',Null:'NO'}]);
      await verified.end();
    }finally{
      const cleanup=await server;
      await cleanup.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await cleanup.end();
    }
  },30_000);
});
