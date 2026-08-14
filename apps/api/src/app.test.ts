import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryStore } from './modules/core/store.js';
import type { SubscriptionMessageProvider } from './modules/notifications/wechat-subscription-provider.js';
import { PlatformProcurementService } from './modules/platform/platform-procurement-service.js';
import { FulfillmentService } from './modules/fulfillment/fulfillment-service.js';
import { LedgerService } from './modules/finance/ledger-service.js';
import { moneyCents } from '@hometown/domain';
import type { Campaign, DeliveryPlan, Order, OutboundOrder, PickupPoint, PurchaseOrder } from './modules/core/types.js';

const operator = { 'x-demo-user-id': 'operator-1', 'x-demo-role': 'OPERATOR' };
const customer = { 'x-demo-user-id': 'user-1', 'x-demo-role': 'USER' };
const service = { 'x-demo-user-id': 'service-1', 'x-demo-role': 'CUSTOMER_SERVICE' };
const finance = { 'x-demo-user-id': 'finance-1', 'x-demo-role': 'FINANCE' };
const fulfillment = { 'x-demo-user-id': 'fulfillment-1', 'x-demo-role': 'FULFILLMENT' };
const pickupManager = { 'x-demo-user-id': 'pickup-manager-1', 'x-demo-role': 'PICKUP_MANAGER' };
const verifier = { 'x-demo-user-id': 'verifier-1', 'x-demo-role': 'PICKUP_VERIFIER' };
const pointId = 'pickup-demo-001';
const procurement = { 'x-demo-user-id': 'procurement-1', 'x-demo-role': 'PROCUREMENT' };
const warehouse = { 'x-demo-user-id': 'warehouse-1', 'x-demo-role': 'WAREHOUSE_OPERATOR' };
const warehouseReceiver = { 'x-demo-user-id': 'warehouse-receiver-1', 'x-demo-role': 'WAREHOUSE_RECEIVER' };

describe('API regression', () => {
  let app: FastifyInstance;
  let store:MemoryStore;
  let notifications: string[];

  beforeEach(async () => {
    store = new MemoryStore();
    await store.saveUser({ id: 'user-1', wechatOpenId: 'openid-user-1', status: 'ACTIVE', createdAt: new Date().toISOString() });
    await store.saveUser({ id: 'fulfillment-1', wechatOpenId: null, status: 'ACTIVE', createdAt: new Date().toISOString() });
    notifications = [];
    const provider: SubscriptionMessageProvider = { send: async ({ notification }) => { notifications.push(notification.type); } };
    app = await buildApp({ config: loadConfig({ NODE_ENV: 'test' }), store, subscriptionMessageProvider: provider });
  });

  afterEach(async () => app.close());

  async function createCampaign(minTotalQuantity = 1): Promise<string> {
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/campaigns', headers: operator, payload: {
      title: '保定家乡味团购', serviceAreaId: 'service-bd-lianchi',
      cutoffAt: new Date(Date.now() + 3_600_000).toISOString(), dispatchAt: new Date(Date.now() + 7_200_000).toISOString(),
      minTotalQuantity, failureAction: 'CANCEL_AND_REFUND', skuIds: ['sku-demo-001'],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const campaignId = created.json().data.id as string;
    const plan = await app.inject({ method: 'POST', url: '/api/v1/admin/delivery-plans', headers: operator, payload: {
      campaignId, pickupPointId: pointId, siteName: '莲池家乡味自提点', address: '保定市莲池区示范路 88 号',
      arrivalStartAt: new Date(Date.now() + 86_400_000).toISOString(), arrivalEndAt: null,
      contactName: '自提点负责人', contactPhone: '13800000000', remark: '固定自提点',
    } });
    expect(plan.statusCode, plan.body).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/campaigns/${campaignId}/open`, headers: operator })).statusCode).toBe(200);
    return campaignId;
  }

  async function createOrder(campaignId: string, quantity = 1, key = crypto.randomUUID()): Promise<string> {
    const created = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { ...customer, 'idempotency-key': key }, payload: {
      campaignId, serviceAreaId: 'service-bd-lianchi', pickupPointId: pointId,
      items: [{ skuId: 'sku-demo-001', quantity }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().data.pickupPointId).toBe(pointId);
    return created.json().data.id as string;
  }

  async function pay(orderId: string): Promise<void> {
    const paid = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/mock-pay`, headers: customer });
    expect(paid.statusCode, paid.body).toBe(200);
  }

  async function close(campaignId: string): Promise<void> {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.now() + 3_600_001));
    try { expect((await app.inject({ method: 'POST', url: `/api/v1/admin/campaigns/${campaignId}/close`, headers: operator })).statusCode).toBe(200); }
    finally { vi.useRealTimers(); }
  }

  async function fulfill(campaignId: string, orderId: string): Promise<string> {
    const plan = await store.getDeliveryPlanByCampaign(campaignId);
    if (!plan) throw new Error('expected delivery plan');
    const planId = plan.id;
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/delivery-plans/${planId}/book-vehicle`, headers: fulfillment, payload: { vehicleOrderNo: 'HL-001', driverName: '李师傅', driverPhone: '13900000000', vehiclePlate: '冀F12345' } })).statusCode).toBe(200);
    const batch = await app.inject({ method: 'POST', url: '/api/v1/admin/dispatch-batches', headers: fulfillment, payload: { campaignId } });
    const batchId = batch.json().data.id as string;
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/dispatch-batches/${batchId}/dispatch`, headers: fulfillment })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/pickup/batches/${batchId}/receive`, headers: fulfillment, payload: { deliveryPlanId: planId } })).statusCode).toBe(200);
    const code = await app.inject({ method: 'GET', url: `/api/v1/pickup-code?orderId=${orderId}`, headers: customer });
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/pickup-verifier-assignments/grant', headers: operator, payload: { userId: 'fulfillment-1', pickupPointId: pointId } })).statusCode).toBe(200);
    const verified = await app.inject({ method: 'POST', url: '/api/v1/pickup/verify', headers: fulfillment, payload: { orderId, deliveryPlanId: planId, code: code.json().data.code } });
    expect(verified.statusCode, verified.body).toBe(200);
    return planId;
  }

  it('requires a real active campaign pickup point and binds it to the order', async () => {
    const campaignId = await createCampaign();
    const campaign = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}` });
    expect(campaign.json().data.deliveryPlan).toMatchObject({ status: 'SITE_CONFIRMED', pickupPointId: pointId });
    expect(campaign.json().data.deliveryPlan).not.toHaveProperty('remark');
    expect(campaign.json().data.deliveryPlan).not.toHaveProperty('contactName');
    expect(campaign.json().data.deliveryPlan).not.toHaveProperty('vehicleOrderNo');
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { ...customer, 'idempotency-key': 'bad-point' }, payload: {
      campaignId, serviceAreaId: 'service-bd-lianchi', pickupPointId: 'not-allowed', items: [{ skuId: 'sku-demo-001', quantity: 1 }],
    } });
    expect(invalid.statusCode).toBe(400);
    await createOrder(campaignId);
  });

  it('runs the lightweight community route without supplier, warehouse, purchase order or stock-lot prerequisites', async () => {
    await app.close();
    await store.saveUser({ id: 'verifier-1', wechatOpenId: null, status: 'ACTIVE', createdAt: new Date().toISOString() });
    await store.savePlatformSku({id:'community-sku-a',productId:'community-product-a',name:'常温杂粮 A（500g）',retailPriceCents:moneyCents(1200),defaultSellableQuantity:20,referencePurchaseCostCents:null,supplierNote:null,status:'ACTIVE',product:{id:'community-product-a',title:'社区杂粮 A',category:'粮油',origin:'保定',imageUrl:null,storageType:'NORMAL_TEMPERATURE',status:'ACTIVE'},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    await store.savePlatformSku({id:'community-sku-b',productId:'community-product-b',name:'真空熟食 B（300g）',retailPriceCents:moneyCents(2000),defaultSellableQuantity:20,referencePurchaseCostCents:null,supplierNote:null,status:'ACTIVE',product:{id:'community-product-b',title:'社区熟食 B',category:'熟食',origin:'保定',imageUrl:null,storageType:'NORMAL_TEMPERATURE',status:'ACTIVE'},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    app=await buildApp({config:loadConfig({NODE_ENV:'test',COMMUNITY_FULFILLMENT_ENABLED:'true'}),store});
    const created=await app.inject({method:'POST',url:'/api/v1/admin/community/campaigns',headers:operator,payload:{title:'社区轻量履约团',serviceAreaId:'service-bd-lianchi',pickupPointId:pointId,cutoffAt:new Date(Date.now()+3_600_000).toISOString(),dispatchAt:new Date(Date.now()+7_200_000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',items:[{platformSkuId:'community-sku-a',retailPriceCents:1200,sellableQuantity:10},{platformSkuId:'community-sku-b',retailPriceCents:2000,sellableQuantity:10}]}});
    expect(created.statusCode,created.body).toBe(201); const campaignId=created.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/open`,headers:operator})).statusCode).toBe(200);
    const orderResponse=await app.inject({method:'POST',url:'/api/v1/orders',headers:{...customer,'idempotency-key':'community-checkout-key'},payload:{campaignId,serviceAreaId:'service-bd-lianchi',pickupPointId:pointId,items:[{skuId:'community-sku-a',quantity:2},{skuId:'community-sku-b',quantity:3}]}});expect(orderResponse.statusCode,orderResponse.body).toBe(201);const orderId=orderResponse.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/orders/${orderId}/mock-pay`,headers:customer})).statusCode).toBe(200);
    vi.useFakeTimers();vi.setSystemTime(new Date(Date.now()+3_600_001));try{expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/close`,headers:operator})).statusCode).toBe(200);}finally{vi.useRealTimers();}
    const plan=await store.getDeliveryPlanByCampaign(campaignId);if(!plan)throw new Error('community plan missing');
    expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${plan.id}/book-vehicle`,headers:fulfillment,payload:{logisticsPlatform:'货拉拉',vehicleOrderNo:'HL-COMMUNITY-1',driverName:'李师傅',driverPhone:'13900000000',vehiclePlate:'冀F12345',estimatedArrivalAt:new Date(Date.now()+86_400_000).toISOString()}})).statusCode).toBe(200);
    const batch=await app.inject({method:'POST',url:'/api/v1/admin/dispatch-batches',headers:fulfillment,payload:{campaignId}});expect(batch.statusCode,batch.body).toBe(201);const batchId=batch.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/dispatch-batches/${batchId}/dispatch`,headers:fulfillment})).statusCode).toBe(200);
    const genericCommunityReceive=await app.inject({method:'POST',url:`/api/v1/pickup/batches/${batchId}/receive`,headers:fulfillment,payload:{deliveryPlanId:plan.id}});
    expect(genericCommunityReceive.statusCode,genericCommunityReceive.body).toBe(409);
    expect((await store.getDeliveryPlanByCampaign(campaignId))?.status).toBe('IN_TRANSIT');
    expect((await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:operator,payload:{userId:'verifier-1',pickupPointId:pointId}})).statusCode).toBe(200);
    const verifierDeliveries=await app.inject({method:'GET',url:'/api/v1/admin/community/deliveries',headers:verifier});expect(verifierDeliveries.statusCode,verifierDeliveries.body).toBe(200);expect(verifierDeliveries.json().data).toEqual([expect.objectContaining({campaignId,dispatchBatchId:batchId,expectedItems:[expect.objectContaining({platformSkuId:'community-sku-a',expectedQuantity:2}),expect.objectContaining({platformSkuId:'community-sku-b',expectedQuantity:3})]})]);expect(verifierDeliveries.body).not.toContain('purchasePriceCents');expect((await app.inject({method:'GET',url:'/api/v1/admin/platform/skus',headers:verifier})).statusCode).toBe(403);
    const arrival={receivedBy:'点位负责人',confirmationNote:'现场已清点',items:[{platformSkuId:'community-sku-a',receivedQuantity:2,rejectedQuantity:0,shortQuantity:0,damagedQuantity:0,reason:null,evidenceNote:null,evidenceUrl:null},{platformSkuId:'community-sku-b',receivedQuantity:2,rejectedQuantity:0,shortQuantity:1,damagedQuantity:0,reason:'TRANSIT_SHORTAGE',evidenceNote:'现场少一袋，已拍照',evidenceUrl:null}]};
    const confirmations=await Promise.all([app.inject({method:'POST',url:`/api/v1/admin/community/dispatch-batches/${batchId}/arrival`,headers:verifier,payload:arrival}),app.inject({method:'POST',url:`/api/v1/admin/community/dispatch-batches/${batchId}/arrival`,headers:verifier,payload:arrival})]);for(const confirmation of confirmations)expect(confirmation.statusCode,confirmation.body).toBe(200);
    const exceptions=(await store.listFulfillmentExceptions()).filter((item)=>item.campaignId===campaignId);expect(exceptions).toHaveLength(1);
    const exceptionId=exceptions[0]!.id;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/fulfillment-exceptions/${exceptionId}/decision`,headers:operator,payload:{status:'REFUND_CONFIRMED',responsibility:'CARRIER',resolutionNote:'无法在承诺时间内补送，按订单快照价退一件'}})).statusCode).toBe(200);
    const partialRefund=await app.inject({method:'POST',url:`/api/v1/admin/platform/fulfillment-exceptions/${exceptionId}/partial-refund`,headers:finance,payload:{confirmationNote:'财务已核对短少证据与订单快照价'}});expect(partialRefund.statusCode,partialRefund.body).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/fulfillment-exceptions/${exceptionId}/partial-refund`,headers:finance,payload:{confirmationNote:'重复请求不得重复退款'}})).statusCode).toBe(200);
    expect((await store.listPlatformPartialRefundsByOrder(orderId))).toHaveLength(1);
    const code=await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer});expect(code.statusCode,code.body).toBe(200);
    const lookup=await app.inject({method:'GET',url:`/api/v1/pickup/orders/lookup?deliveryPlanId=${plan.id}&orderNo=${orderResponse.json().data.orderNo}`,headers:verifier});expect(lookup.statusCode,lookup.body).toBe(200);expect(lookup.json().data.items).toEqual(expect.arrayContaining([expect.objectContaining({skuId:'community-sku-a',remainingPickupQuantity:2}),expect.objectContaining({skuId:'community-sku-b',remainingPickupQuantity:2,exceptionQuantity:1})]));
    const partial=await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:verifier,payload:{orderId,deliveryPlanId:plan.id,code:code.json().data.code,items:[{platformSkuId:'community-sku-a',quantity:2}]}});expect(partial.statusCode,partial.body).toBe(200);expect(partial.json().data.status).toBe('READY_FOR_PICKUP');
    const completed=await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:verifier,payload:{orderId,deliveryPlanId:plan.id,code:code.json().data.code,items:[{platformSkuId:'community-sku-b',quantity:2}]}});expect(completed.statusCode,completed.body).toBe(200);expect(completed.json().data.status).toBe('PICKED_UP');
    expect((await store.listPurchaseOrders(campaignId))).toEqual([]);
  });

  it('keeps platform sales, supplier procurement, warehouse lots and pickup handover isolated from legacy merchant orders', async () => {
    const enabledConfig=loadConfig({NODE_ENV:'test',PLATFORM_PROCUREMENT_ENABLED:'true',DEFAULT_BUSINESS_MODEL_VERSION:'PLATFORM_PROCUREMENT'});
    await app.close();
    await store.saveUser({id:'procurement-1',wechatOpenId:null,status:'ACTIVE',createdAt:new Date().toISOString()});
    await store.saveUser({id:'warehouse-1',wechatOpenId:null,status:'ACTIVE',createdAt:new Date().toISOString()});
    app=await buildApp({config:enabledConfig,store});
    const warehouseCreated=await app.inject({method:'POST',url:'/api/v1/admin/platform/warehouses',headers:operator,payload:{name:'平台中心仓',address:'保定市示范仓库路 1 号',status:'ACTIVE'}});expect(warehouseCreated.statusCode).toBe(201);
    const supplierCreated=await app.inject({method:'POST',url:'/api/v1/admin/platform/suppliers',headers:procurement,payload:{name:'平台供货商',contactName:'张三',contactPhone:'13800000000',status:'ACTIVE'}});expect(supplierCreated.statusCode).toBe(201);
    const skuCreated=await app.inject({method:'POST',url:'/api/v1/admin/platform/skus',headers:procurement,payload:{title:'平台米粉',category:'米面粮油',origin:'江西赣南',imageUrl:null,skuName:'平台米粉 500g',retailPriceCents:3000,status:'ACTIVE'}});expect(skuCreated.statusCode).toBe(201);
    const qualification=await app.inject({method:'POST',url:`/api/v1/admin/platform/suppliers/${supplierCreated.json().data.id}/qualifications`,headers:procurement,payload:{qualificationType:'食品经营许可',qualificationNo:'SC-2026-001',expiresAt:'2027-08-13',status:'APPROVED',evidenceSummary:'已核验资质摘要'}});expect(qualification.statusCode,qualification.body).toBe(201);
    const offerCreated=await app.inject({method:'POST',url:'/api/v1/admin/platform/offers',headers:procurement,payload:{supplierId:supplierCreated.json().data.id,platformSkuId:skuCreated.json().data.id,purchasePriceCents:1800,minimumPurchaseQuantity:1,leadTimeDays:1,status:'ACTIVE'}});expect(offerCreated.statusCode).toBe(201);
    const created=await app.inject({method:'POST',url:'/api/v1/admin/platform/campaigns',headers:procurement,payload:{title:'平台采购团',serviceAreaId:'service-bd-lianchi',warehouseId:warehouseCreated.json().data.id,cutoffAt:new Date(Date.now()+3600_000).toISOString(),dispatchAt:new Date(Date.now()+7200_000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',items:[{platformSkuId:skuCreated.json().data.id,supplierOfferId:offerCreated.json().data.id,sellableQuantity:2}]}});expect(created.statusCode,created.body).toBe(201);const campaignId=created.json().data.id as string;
    const plan=await app.inject({method:'POST',url:'/api/v1/admin/delivery-plans',headers:operator,payload:{campaignId,pickupPointId:pointId,siteName:'莲池家乡味自提点',address:'保定市莲池区示范路 88 号',arrivalStartAt:null,arrivalEndAt:null,contactName:null,contactPhone:null,remark:null}});expect(plan.statusCode,plan.body).toBe(200);expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/open`,headers:operator})).statusCode).toBe(200);
    const publicCampaign=await app.inject({method:'GET',url:`/api/v1/campaigns/${campaignId}`});expect(publicCampaign.statusCode).toBe(200);expect(publicCampaign.json().data.items).toMatchObject([{skuId:skuCreated.json().data.id,unitPriceCents:3000}]);
    const orderCreated=await app.inject({method:'POST',url:'/api/v1/orders',headers:{...customer,'idempotency-key':'platform-flow'},payload:{campaignId,serviceAreaId:'service-bd-lianchi',pickupPointId:pointId,items:[{skuId:skuCreated.json().data.id,quantity:1}]}});expect(orderCreated.statusCode,orderCreated.body).toBe(201);const orderId=orderCreated.json().data.id as string;expect(orderCreated.json().data.merchantOrders).toEqual([]);expect(orderCreated.json().data.paymentRoute).toBe('PLATFORM_DIRECT');await pay(orderId);
    vi.useFakeTimers();vi.setSystemTime(new Date(Date.now()+3600_001));try{expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/close`,headers:operator})).statusCode).toBe(200);}finally{vi.useRealTimers();}
    const purchaseOrders=(await app.inject({method:'GET',url:'/api/v1/admin/platform/purchase-orders',headers:procurement})).json().data as Array<{id:string;items:Array<{id:string}>}>;expect(purchaseOrders).toHaveLength(1);
    const warehousePurchaseOrders=(await app.inject({method:'GET',url:'/api/v1/admin/platform/purchase-orders',headers:warehouseReceiver})).json().data as Array<{supplierId?:string;items:Array<{supplierOfferId?:string;purchaseUnitCents?:number}>}>;
    expect(warehousePurchaseOrders[0]).not.toHaveProperty('supplierId');expect(warehousePurchaseOrders[0]?.items[0]).not.toHaveProperty('supplierOfferId');expect(warehousePurchaseOrders[0]?.items[0]).not.toHaveProperty('purchaseUnitCents');
    const operatorPurchaseOrders=(await app.inject({method:'GET',url:'/api/v1/admin/platform/purchase-orders',headers:operator})).json().data as Array<{supplierId?:string;items:Array<{supplierOfferId?:string;purchaseUnitCents?:number}>}>;
    expect(operatorPurchaseOrders[0]).not.toHaveProperty('supplierId');expect(operatorPurchaseOrders[0]?.items[0]).not.toHaveProperty('supplierOfferId');expect(operatorPurchaseOrders[0]?.items[0]).not.toHaveProperty('purchaseUnitCents');
    const operatorOffers=await app.inject({method:'GET',url:'/api/v1/admin/platform/offers',headers:operator});expect(operatorOffers.statusCode).toBe(403);
    const operatorOfferWrite=await app.inject({method:'POST',url:'/api/v1/admin/platform/offers',headers:operator,payload:{supplierId:supplierCreated.json().data.id,platformSkuId:skuCreated.json().data.id,purchasePriceCents:1,minimumPurchaseQuantity:1,leadTimeDays:1,status:'ACTIVE'}});expect(operatorOfferWrite.statusCode).toBe(403);
    const financeOffers=await app.inject({method:'GET',url:'/api/v1/admin/platform/offers',headers:finance});expect(financeOffers.statusCode).toBe(200);expect(financeOffers.json().data[0]).toMatchObject({supplierId:supplierCreated.json().data.id,purchasePriceCents:1800});
    expect(purchaseOrders[0]).toHaveProperty('supplierId');expect(purchaseOrders[0]?.items[0]).toHaveProperty('purchaseUnitCents');
    const receipt=await app.inject({method:'POST',url:`/api/v1/admin/platform/purchase-orders/${purchaseOrders[0]!.id}/receive`,headers:warehouseReceiver,payload:{items:[{purchaseOrderItemId:purchaseOrders[0]!.items[0]!.id,acceptedQuantity:1,rejectedQuantity:0,batchNo:'LOT-001',productionDate:'2026-08-01',expiresAt:'2027-08-01',inspectionNote:null}]}});expect(receipt.statusCode,receipt.body).toBe(200);
    const payables=(await app.inject({method:'GET',url:'/api/v1/admin/platform/payables',headers:finance})).json().data as Array<{id:string;amountCents:number;status:string}>;expect(payables).toHaveLength(1);expect(payables[0]).toMatchObject({amountCents:1800,status:'PENDING'});expect(await store.listLedgerTransactions(payables[0]!.id)).toHaveLength(1);
    const paid=await app.inject({method:'POST',url:`/api/v1/admin/platform/payables/${payables[0]!.id}/mark-paid`,headers:finance,payload:{paymentReference:'BANK-20260813-001'}});expect(paid.statusCode,paid.body).toBe(200);expect(paid.json().data.status).toBe('PAID');expect(await store.listLedgerTransactions(payables[0]!.id)).toHaveLength(2);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/sorting`,headers:warehouse})).statusCode).toBe(200);const sortingTasks=await app.inject({method:'GET',url:'/api/v1/admin/platform/sorting-tasks',headers:warehouse});expect(sortingTasks.statusCode,sortingTasks.body).toBe(200);expect(sortingTasks.json().data).toEqual([expect.objectContaining({campaignId,status:'PENDING'})]);expect((await app.inject({method:'GET',url:'/api/v1/admin/platform/sorting-tasks',headers:fulfillment})).statusCode).toBe(200);expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/sorting/complete`,headers:warehouse})).statusCode).toBe(200);
    const delivery=await store.getDeliveryPlanByCampaign(campaignId);expect(delivery).toBeTruthy();const booked=await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${delivery!.id}/book-vehicle`,headers:fulfillment,payload:{vehicleOrderNo:'PLATFORM-01',driverName:'配送员',driverPhone:'13900000000',vehiclePlate:'冀F12345'}});expect(booked.statusCode,booked.body).toBe(200);const outbound=await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/outbound`,headers:warehouse,payload:{carrierReference:'配送单-1'}});expect(outbound.statusCode,outbound.body).toBe(200);const outboundData=outbound.json().data as {id:string;items:Array<{platformSkuId:string;quantity:number}>};expect((await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer})).statusCode).toBe(409);const handoverPayload={receivedBy:'fulfillment-1',exceptionNote:null,items:outboundData.items.map((item)=>({platformSkuId:item.platformSkuId,receivedQuantity:item.quantity}))};const handovers=await Promise.all([app.inject({method:'POST',url:`/api/v1/admin/platform/outbound/${outboundData.id}/handover`,headers:fulfillment,payload:handoverPayload}),app.inject({method:'POST',url:`/api/v1/admin/platform/outbound/${outboundData.id}/handover`,headers:fulfillment,payload:handoverPayload})]);for(const handover of handovers)expect(handover.statusCode,handover.body).toBe(200);expect((await store.listAuditLogs(20)).filter((item)=>item.action==='PICKUP_HANDOVER_COMPLETED')).toHaveLength(1);expect((await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer})).statusCode).toBe(200);
  });

  it('accepts a replenishment receipt after a supplier short receipt and closes the shortage fact', async () => {
    const isolated = new MemoryStore(false); const now = new Date().toISOString();
    const campaign: Campaign = { id:'replenishment-campaign',title:'replenishment',serviceAreaId:'area-1',warehouseId:'warehouse-1',cutoffAt:now,dispatchAt:now,minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',businessModelVersion:'PLATFORM_PROCUREMENT',skuIds:[],items:[],platformItems:[],status:'LOCKED',version:1,createdAt:now };
    const purchaseOrder: PurchaseOrder = { id:'replenishment-po',purchaseNo:'PO-REPLENISH-1',campaignId:campaign.id,supplierId:'supplier-1',warehouseId:'warehouse-1',status:'ORDERED',plannedArrivalAt:null,createdAt:now,updatedAt:now,items:[{id:'replenishment-po-line',purchaseOrderId:'replenishment-po',platformSkuId:'sku-1',supplierOfferId:'offer-1',plannedQuantity:10,purchaseUnitCents:100,createdAt:now}] };
    await isolated.saveCampaign(campaign); await isolated.replaceCampaignPlatformItems(campaign); await isolated.savePurchaseOrder(purchaseOrder);
    const procurementService = new PlatformProcurementService(isolated,'replenishment-secret',new LedgerService());
    const first = await procurementService.receive(purchaseOrder.id,'warehouse-1',[{purchaseOrderItemId:purchaseOrder.items[0]!.id,acceptedQuantity:8,rejectedQuantity:2,batchNo:'LOT-REPLENISH-1',productionDate:null,expiresAt:null,inspectionNote:'first delivery short',exceptionReason:'SHORT_RECEIPT'}],{requestId:'receipt-batch-1'});
    const replenishment = [{purchaseOrderItemId:purchaseOrder.items[0]!.id,acceptedQuantity:2,rejectedQuantity:0,batchNo:'LOT-REPLENISH-2',productionDate:'2026-08-12',expiresAt:'2027-08-12',inspectionNote:'replenishment accepted',evidenceUrl:'https://evidence.example/replenishment-2'}] as const;
    const second = await procurementService.receive(purchaseOrder.id,'warehouse-1',replenishment,{requestId:'receipt-batch-2'});
    expect(second.id).not.toBe(first.id); expect(second.items[0]).toMatchObject({acceptedQuantity:2,rejectedQuantity:0}); expect((await isolated.getPurchaseOrder(purchaseOrder.id))?.status).toBe('RECEIVED'); expect((await isolated.listSupplierPayables()).reduce((sum,item)=>sum+Number(item.amountCents),0)).toBe(1000); expect((await isolated.listFulfillmentExceptions())[0]?.status).toBe('RESOLVED');
    const exactRetry=await procurementService.receive(purchaseOrder.id,'warehouse-1',replenishment,{requestId:'receipt-batch-2-retry'});
    expect(exactRetry.id).toBe(second.id);
    await expect(procurementService.receive(purchaseOrder.id,'warehouse-1',[{...replenishment[0],expiresAt:'2027-08-13',evidenceUrl:'https://evidence.example/replenishment-2-revised'}],{requestId:'receipt-batch-2-different-evidence'})).rejects.toMatchObject({code:'INVALID_STATE_TRANSITION'});
    const receiptAudit=(await isolated.listAuditLogs(10)).find((item)=>item.action==='GOODS_RECEIPT_COMPLETED'); expect(receiptAudit?.afterData).toMatchObject({receipt:{id:second.id},inventory:{before:expect.any(Array),after:expect.any(Array)}});
  });

  it('keeps unaffected A lines collectible when B is short and rejects generic mode-B full refunds', async () => {
    const isolated = new MemoryStore(false);
    const now = new Date().toISOString();
    const campaign: Campaign = {
      id: 'platform-campaign-multi-sku', title: 'multi SKU handover', serviceAreaId: 'area-1', warehouseId: 'warehouse-1',
      cutoffAt: now, dispatchAt: now, minTotalQuantity: 1, failureAction: 'CANCEL_AND_REFUND', businessModelVersion: 'PLATFORM_PROCUREMENT',
      skuIds: [], items: [], platformItems: [
        { platformSkuId: 'sku-a', supplierOfferId: 'offer-a', productId: 'product-a', title: 'A', category: 'dry', skuName: 'A', origin: 'origin', imageUrl: null, retailPriceCents: moneyCents(2000), purchasePriceCents: moneyCents(1000), sellableQuantity: 2, reservedQuantity: 2 },
        { platformSkuId: 'sku-b', supplierOfferId: 'offer-b', productId: 'product-b', title: 'B', category: 'dry', skuName: 'B', origin: 'origin', imageUrl: null, retailPriceCents: moneyCents(3000), purchasePriceCents: moneyCents(1500), sellableQuantity: 3, reservedQuantity: 3 },
      ], status: 'FULFILLING', version: 1, createdAt: now,
    };
    const plan: DeliveryPlan = { id: 'platform-plan-multi-sku', campaignId: campaign.id, serviceAreaId: campaign.serviceAreaId, pickupPointId: pointId, status: 'IN_TRANSIT', siteName: 'point', address: 'address', arrivalStartAt: null, arrivalEndAt: null, contactName: null, contactPhone: null, vehicleOrderNo: 'OB-1', driverName: null, driverPhone: null, vehiclePlate: null, remark: null, confirmedAt: now, bookedAt: now, dispatchedAt: now, arrivedAt: null, createdAt: now, updatedAt: now };
    const pickupPoint: PickupPoint = { id: pointId, serviceAreaId: campaign.serviceAreaId, name: 'point', address: 'address', status: 'ACTIVE', capacityPerDay: null, operationMode: 'SELF_OPERATED', responsibilityOwner: null, siteLeadName: null, siteLeadPhone: null, createdAt: now };
    const order: Order = { id: 'platform-order-multi-sku', orderNo: 'PB-MULTI-1', userId: 'user-1', campaignId: campaign.id, serviceAreaId: campaign.serviceAreaId, pickupPointId: pointId, deliveryPlanId: plan.id, businessModelVersion: 'PLATFORM_PROCUREMENT', paymentRoute: 'PLATFORM_DIRECT', status: 'IN_TRANSIT', totalCents: moneyCents(13000), commissionCents: moneyCents(0), items: [], merchantOrders: [], createdAt: now, expiresAt: now, paidAt: now, pickedUpAt: null };
    const outbound: OutboundOrder = { id: 'platform-outbound-multi-sku', outboundNo: 'OB-MULTI-1', campaignId: campaign.id, warehouseId: campaign.warehouseId!, deliveryPlanId: plan.id, sortingTaskId: 'sorting-1', status: 'DISPATCHED', carrierReference: 'carrier', dispatchedBy: 'warehouse-1', dispatchedAt: now, createdAt: now, items: [
      { id: 'outbound-a', outboundOrderId: 'platform-outbound-multi-sku', inventoryLotId: 'lot-a', platformSkuId: 'sku-a', quantity: 2 },
      { id: 'outbound-b', outboundOrderId: 'platform-outbound-multi-sku', inventoryLotId: 'lot-b', platformSkuId: 'sku-b', quantity: 3 },
    ] };
    await isolated.saveCampaign(campaign); await isolated.replaceCampaignPlatformItems(campaign); await isolated.saveDeliveryPlan(plan); await isolated.savePickupPoint(pickupPoint);
    await isolated.saveUser({ id: 'verifier-1', wechatOpenId: null, status: 'ACTIVE', createdAt: now }); await isolated.grantPickupVerifier('verifier-1', pointId);
    await isolated.saveOrder(order);
    await isolated.saveSalesOrderItems(order.id, [
      { id: 'sales-a', platformSkuId: 'sku-a', productId: 'product-a', title: 'A', skuName: 'A', quantity: 2, unitPriceCents: 2000, purchaseUnitCents: 1000, amountCents: 4000 },
      { id: 'sales-b', platformSkuId: 'sku-b', productId: 'product-b', title: 'B', skuName: 'B', quantity: 3, unitPriceCents: 3000, purchaseUnitCents: 1500, amountCents: 9000 },
    ]);
    await isolated.saveOutboundOrder(outbound);
    const procurementService = new PlatformProcurementService(isolated, 'pickup-test-secret', new LedgerService());
    await procurementService.handover(outbound.id, 'verifier-1', { receivedBy: 'receiver-1', exceptionNote: 'B one short', items: [
      { platformSkuId: 'sku-a', receivedQuantity: 2, rejectedQuantity: 0, shortQuantity: 0, damagedQuantity: 0, reason: null, evidenceNote: null },
      { platformSkuId: 'sku-b', receivedQuantity: 2, rejectedQuantity: 0, shortQuantity: 1, damagedQuantity: 0, reason: 'TRANSIT_SHORTAGE', evidenceNote: 'counted at point' },
    ] });
    expect(await isolated.listPlatformSalesLinesByCampaign(campaign.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ platformSkuId: 'sku-a', fulfilledQuantity: 2, exceptionQuantity: 0 }),
      expect.objectContaining({ platformSkuId: 'sku-b', fulfilledQuantity: 2, exceptionQuantity: 1 }),
    ]));
    expect((await isolated.getOrder(order.id))?.status).toBe('READY_FOR_PICKUP');
    const fulfillmentService = new FulfillmentService(isolated, 'pickup-test-secret', new LedgerService());
    const code = await fulfillmentService.getCode(order.id, 'user-1');
    await expect(fulfillmentService.verify(order.id, plan.id, code.code, 'verifier-1')).resolves.toMatchObject({ status: 'PICKED_UP' });

    await store.saveOrder({ ...order, id: 'platform-generic-refund-block', orderNo: 'PB-BLOCK-1', status: 'READY_FOR_PICKUP' });
    const fullRefund = await app.inject({ method: 'POST', url: '/api/v1/admin/orders/platform-generic-refund-block/refund', headers: finance });
    expect(fullRefund.statusCode).toBe(409);
    expect((await store.getOrder('platform-generic-refund-block'))?.status).toBe('READY_FOR_PICKUP');
  });

  it('requires wrong-point transfer reinspection before restoring the pickup entitlement', async () => {
    const isolated = new MemoryStore(false);
    const now = new Date().toISOString();
    const campaign: Campaign = { id:'wrong-point-campaign',title:'wrong point',serviceAreaId:'area-1',warehouseId:'warehouse-1',cutoffAt:now,dispatchAt:now,minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',businessModelVersion:'PLATFORM_PROCUREMENT',skuIds:[],items:[],platformItems:[{platformSkuId:'sku-wrong',supplierOfferId:'offer-wrong',productId:'product-wrong',title:'wrong',category:'dry',skuName:'wrong',origin:'origin',imageUrl:null,retailPriceCents:moneyCents(1000),purchasePriceCents:moneyCents(500),sellableQuantity:1,reservedQuantity:1}],status:'FULFILLING',version:1,createdAt:now };
    const plan: DeliveryPlan = { id:'wrong-point-plan',campaignId:campaign.id,serviceAreaId:'area-1',pickupPointId:pointId,status:'IN_TRANSIT',siteName:'point',address:'address',arrivalStartAt:null,arrivalEndAt:null,contactName:null,contactPhone:null,vehicleOrderNo:'OB-WRONG',driverName:null,driverPhone:null,vehiclePlate:null,remark:null,confirmedAt:now,bookedAt:now,dispatchedAt:now,arrivedAt:null,createdAt:now,updatedAt:now };
    const point: PickupPoint = { id:pointId,serviceAreaId:'area-1',name:'point',address:'address',status:'ACTIVE',capacityPerDay:null,operationMode:'SELF_OPERATED',responsibilityOwner:null,siteLeadName:null,siteLeadPhone:null,createdAt:now };
    const order: Order = { id:'wrong-point-order',orderNo:'PB-WRONG-1',userId:'user-1',campaignId:campaign.id,serviceAreaId:'area-1',pickupPointId:pointId,deliveryPlanId:plan.id,businessModelVersion:'PLATFORM_PROCUREMENT',paymentRoute:'PLATFORM_DIRECT',status:'IN_TRANSIT',totalCents:moneyCents(1000),commissionCents:moneyCents(0),items:[],merchantOrders:[],createdAt:now,expiresAt:now,paidAt:now,pickedUpAt:null };
    const outbound: OutboundOrder = { id:'wrong-point-outbound',outboundNo:'OB-WRONG-1',campaignId:campaign.id,warehouseId:'warehouse-1',deliveryPlanId:plan.id,sortingTaskId:'sorting-wrong',status:'DISPATCHED',carrierReference:null,dispatchedBy:'warehouse-1',dispatchedAt:now,createdAt:now,items:[{id:'wrong-point-outbound-line',outboundOrderId:'wrong-point-outbound',inventoryLotId:'wrong-point-lot',platformSkuId:'sku-wrong',quantity:1}] };
    await isolated.saveCampaign(campaign);await isolated.replaceCampaignPlatformItems(campaign);await isolated.saveDeliveryPlan(plan);await isolated.savePickupPoint(point);await isolated.saveUser({id:'verifier-1',wechatOpenId:null,status:'ACTIVE',createdAt:now});await isolated.grantPickupVerifier('verifier-1',pointId);await isolated.saveOrder(order);await isolated.saveSalesOrderItems(order.id,[{id:'wrong-point-sales',platformSkuId:'sku-wrong',productId:'product-wrong',title:'wrong',skuName:'wrong',quantity:1,unitPriceCents:1000,purchaseUnitCents:500,amountCents:1000}]);await isolated.saveInventoryLot({id:'wrong-point-lot',warehouseId:'warehouse-1',platformSkuId:'sku-wrong',supplierId:'supplier-1',goodsReceiptItemId:'receipt-item',lotNo:'LOT-WRONG',productionDate:null,expiresAt:null,qualifiedQuantity:1,createdAt:now});await isolated.appendInventoryMovement({id:'wrong-point-outbound-movement',inventoryLotId:'wrong-point-lot',movementType:'OUTBOUND',fromBucket:'SORTED',toBucket:'OUTBOUND',quantity:1,referenceType:'OUTBOUND',referenceId:outbound.id,actorId:'warehouse-1',note:null,createdAt:now});await isolated.saveOutboundOrder(outbound);
    const service = new PlatformProcurementService(isolated,'wrong-point-secret',new LedgerService());
    await service.handover(outbound.id,'verifier-1',{receivedBy:'receiver-1',exceptionNote:'wrong point',items:[{platformSkuId:'sku-wrong',receivedQuantity:0,rejectedQuantity:1,shortQuantity:0,damagedQuantity:0,reason:'WRONG_POINT',evidenceNote:'wrong point evidence'}]});
    const exception=(await isolated.listFulfillmentExceptions())[0]!;
    await service.decideException(exception.id,'operator-1',{resolution:'TRANSFER_PENDING',responsibility:'CARRIER',note:'transfer to the fixed point'});
    await isolated.saveUser({id:'unassigned-fulfillment',wechatOpenId:null,status:'ACTIVE',createdAt:now});
    await expect(service.reinspectWrongPointTransfer(exception.id,'unassigned-fulfillment',{evidenceNote:'unassigned user must not clear fixed-point reinspection',items:[{platformSkuId:'sku-wrong',acceptedQuantity:1}]})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect((await isolated.getOrder(order.id))?.status).toBe('IN_TRANSIT');
    await isolated.saveUser({id:'warehouse-1',wechatOpenId:null,status:'ACTIVE',createdAt:now}); await isolated.grantPickupVerifier('warehouse-1',pointId);
    await service.reinspectWrongPointTransfer(exception.id,'warehouse-1',{evidenceNote:'received and reinspected at fixed point',items:[{platformSkuId:'sku-wrong',acceptedQuantity:1}]});
    expect((await isolated.getOrder(order.id))?.status).toBe('READY_FOR_PICKUP');
    expect((await isolated.listInventoryBalances('warehouse-1'))[0]).toMatchObject({handedOver:1,quarantine:0,qualified:0});
  });

  it('continues fulfilment for accepted quantity and refunds only a confirmed mode-B handover shortage',async()=>{
    const enabledConfig=loadConfig({NODE_ENV:'test',PLATFORM_PROCUREMENT_ENABLED:'true',DEFAULT_BUSINESS_MODEL_VERSION:'PLATFORM_PROCUREMENT'});
    await app.close();await store.saveUser({id:'procurement-1',wechatOpenId:null,status:'ACTIVE',createdAt:new Date().toISOString()});await store.saveUser({id:'warehouse-1',wechatOpenId:null,status:'ACTIVE',createdAt:new Date().toISOString()});app=await buildApp({config:enabledConfig,store});
    const warehouseCreated=await app.inject({method:'POST',url:'/api/v1/admin/platform/warehouses',headers:operator,payload:{name:'差异中心仓',address:'测试路 1 号',status:'ACTIVE'}});const warehouseId=warehouseCreated.json().data.id as string;
    const supplierCreated=await app.inject({method:'POST',url:'/api/v1/admin/platform/suppliers',headers:procurement,payload:{name:'差异供应商',contactName:'李四',contactPhone:'13800000001',status:'ACTIVE'}});const supplierId=supplierCreated.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/suppliers/${supplierId}/qualifications`,headers:procurement,payload:{qualificationType:'食品经营许可',qualificationNo:'SC-DIFF',expiresAt:'2027-08-13',status:'APPROVED',evidenceSummary:'已核验'}})).statusCode).toBe(201);
    const skuCreated=await app.inject({method:'POST',url:'/api/v1/admin/platform/skus',headers:procurement,payload:{title:'差异米粉',category:'干货',origin:'江西',imageUrl:null,skuName:'500g',retailPriceCents:3000,status:'ACTIVE'}});const skuId=skuCreated.json().data.id as string;
    const offerCreated=await app.inject({method:'POST',url:'/api/v1/admin/platform/offers',headers:procurement,payload:{supplierId,platformSkuId:skuId,purchasePriceCents:1800,minimumPurchaseQuantity:1,leadTimeDays:1,status:'ACTIVE'}});const offerId=offerCreated.json().data.id as string;
    const created=await app.inject({method:'POST',url:'/api/v1/admin/platform/campaigns',headers:procurement,payload:{title:'部分退款团',serviceAreaId:'service-bd-lianchi',warehouseId,cutoffAt:new Date(Date.now()+3600_000).toISOString(),dispatchAt:new Date(Date.now()+7200_000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',items:[{platformSkuId:skuId,supplierOfferId:offerId,sellableQuantity:3}]}});const campaignId=created.json().data.id as string;
    const savedPoint=(await store.listPickupPoints()).find((value)=>value.id===pointId)!;const boundPlan=await app.inject({method:'POST',url:'/api/v1/admin/delivery-plans',headers:operator,payload:{campaignId,pickupPointId:pointId,siteName:savedPoint.name,address:savedPoint.address,arrivalStartAt:new Date(Date.now()+86_400_000).toISOString(),arrivalEndAt:null,contactName:'点位负责人',contactPhone:'13800000000',remark:null}});expect(boundPlan.statusCode,boundPlan.body).toBe(200);expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/open`,headers:operator})).statusCode).toBe(200);
    const orderCreated=await app.inject({method:'POST',url:'/api/v1/orders',headers:{...customer,'idempotency-key':'partial-shortage-001'},payload:{campaignId,serviceAreaId:'service-bd-lianchi',pickupPointId:pointId,items:[{skuId,quantity:3}]}});const orderId=orderCreated.json().data.id as string;await pay(orderId);
    vi.useFakeTimers();vi.setSystemTime(new Date(Date.now()+3600_001));try{expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/close`,headers:operator})).statusCode).toBe(200);}finally{vi.useRealTimers();}
    const po=(await app.inject({method:'GET',url:'/api/v1/admin/platform/purchase-orders',headers:procurement})).json().data[0] as {id:string;items:Array<{id:string}>};
    const receipt=await app.inject({method:'POST',url:`/api/v1/admin/platform/purchase-orders/${po.id}/receive`,headers:warehouse,payload:{items:[{purchaseOrderItemId:po.items[0]!.id,acceptedQuantity:3,rejectedQuantity:0,batchNo:'LOT-PARTIAL',productionDate:'2026-08-01',expiresAt:'2027-08-01',inspectionNote:null}]}});expect(receipt.statusCode,receipt.body).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/sorting`,headers:warehouse})).statusCode).toBe(200);expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/sorting/complete`,headers:warehouse})).statusCode).toBe(200);
    const plan=await store.getDeliveryPlanByCampaign(campaignId);if(!plan)throw new Error('plan expected');expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${plan.id}/book-vehicle`,headers:fulfillment,payload:{vehicleOrderNo:'DIFF-1',driverName:'配送员',driverPhone:'13900000000',vehiclePlate:'冀F9988'}})).statusCode).toBe(200);
    const outbound=(await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/outbound`,headers:warehouse,payload:{carrierReference:'配送差异'}})).json().data as {id:string;items:Array<{platformSkuId:string;quantity:number}>};
    const handover=await app.inject({method:'POST',url:`/api/v1/admin/platform/outbound/${outbound.id}/handover`,headers:fulfillment,payload:{receivedBy:'fulfillment-1',exceptionNote:'运输少一件',items:outbound.items.map((item)=>({platformSkuId:item.platformSkuId,receivedQuantity:2,rejectedQuantity:0,shortQuantity:1,damagedQuantity:0,reason:'TRANSIT_SHORTAGE',evidenceNote:'现场清点照片已登记'}))}});expect(handover.statusCode,handover.body).toBe(200);
    const ready=await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer});expect(ready.statusCode).toBe(200);
    const exception=(await app.inject({method:'GET',url:'/api/v1/admin/platform/fulfillment-exceptions',headers:operator})).json().data[0] as {id:string;status:string};expect(exception.status).toBe('REGISTERED');
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/fulfillment-exceptions/${exception.id}/decision`,headers:operator,payload:{status:'REFUND_CONFIRMED',responsibility:'CARRIER',resolutionNote:'无法补送，按销售快照退一件'}})).statusCode).toBe(200);
    const basis=(await app.inject({method:'GET',url:'/api/v1/admin/platform/fulfillment-exceptions',headers:finance})).json().data[0] as {refundBreakdown?:Array<{orderNo:string;productName:string;skuName:string;platformSkuId:string;exceptionQuantity:number;refundedQuantity:number;refundableQuantity:number;unitPriceCents:number;refundableAmountCents:number;refundedAmountCents:number;orderTotalCents:number;orderRefundedAmountCents:number;orderRefundInFlightAmountCents:number;orderRefundableBalanceCents:number}>};expect(basis.refundBreakdown).toEqual([expect.objectContaining({orderNo:expect.any(String),productName:'差异米粉',skuName:'500g',platformSkuId:skuId,exceptionQuantity:1,refundedQuantity:0,refundableQuantity:1,unitPriceCents:3000,refundableAmountCents:3000,refundedAmountCents:0,orderTotalCents:9000,orderRefundedAmountCents:0,orderRefundInFlightAmountCents:0,orderRefundableBalanceCents:9000})]);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/fulfillment-exceptions/${exception.id}/partial-refund`,headers:finance,payload:{confirmationNote:'已核对订单快照单价与现场异常证据'}})).statusCode).toBe(200);
    const refundAudit=(await store.listAuditLogs(30)).find((item)=>item.action==='FULFILLMENT_EXCEPTION_PARTIAL_REFUND_EXECUTED');expect(refundAudit?.beforeData).toMatchObject({exception:{id:exception.id},allocations:expect.any(Array)});expect(refundAudit?.afterData).toMatchObject({exception:{id:exception.id},refunds:[{amountCents:3000}],confirmationNote:'已核对订单快照单价与现场异常证据'});const settledAudit=(await store.listAuditLogs(30)).find((item)=>item.action==='FULFILLMENT_EXCEPTION_PARTIAL_REFUND_SETTLED');expect(settledAudit?.afterData).toMatchObject({refund:{amountCents:3000,status:'SUCCEEDED'},allocations:expect.any(Array),orderId});
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/fulfillment-exceptions/${exception.id}/partial-refund`,headers:finance,payload:{confirmationNote:'重复提交不应重复退款'}})).statusCode).toBe(200);
    expect((await store.listAuditLogs(30)).filter((item)=>item.action==='FULFILLMENT_EXCEPTION_PARTIAL_REFUND_EXECUTED')).toHaveLength(1);
    const result=await app.inject({method:'GET',url:`/api/v1/orders/${orderId}`,headers:customer});expect(result.json().data).toMatchObject({status:'READY_FOR_PICKUP',items:[{quantity:3,fulfilledQuantity:2,exceptionQuantity:1,refundedQuantity:1,refundedAmountCents:3000}],fulfillmentExceptions:[{items:[{reason:'TRANSIT_SHORTAGE'}]}],partialRefunds:[{status:'SUCCEEDED',amountCents:3000}]});expect((await store.listPlatformPartialRefundsByOrder(orderId))).toHaveLength(1);expect((await store.listInventoryBalances(warehouseId))[0]!.quarantine).toBe(1);
  });

  it('keeps a picked-up mode-B quality claim on the partial-refund path and deduplicates its retry',async()=>{
    const enabledConfig=loadConfig({NODE_ENV:'test',PLATFORM_PROCUREMENT_ENABLED:'true',DEFAULT_BUSINESS_MODEL_VERSION:'PLATFORM_PROCUREMENT'});
    await app.close();await store.saveUser({id:'procurement-1',wechatOpenId:null,status:'ACTIVE',createdAt:new Date().toISOString()});await store.saveUser({id:'warehouse-1',wechatOpenId:null,status:'ACTIVE',createdAt:new Date().toISOString()});app=await buildApp({config:enabledConfig,store});
    const warehouseId=(await app.inject({method:'POST',url:'/api/v1/admin/platform/warehouses',headers:operator,payload:{name:'售后中心仓',address:'测试路 2 号',status:'ACTIVE'}})).json().data.id as string;
    const supplierId=(await app.inject({method:'POST',url:'/api/v1/admin/platform/suppliers',headers:procurement,payload:{name:'售后供应商',contactName:'王五',contactPhone:'13800000002',status:'ACTIVE'}})).json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/suppliers/${supplierId}/qualifications`,headers:procurement,payload:{qualificationType:'食品经营许可',qualificationNo:'SC-CLAIM',expiresAt:'2027-08-13',status:'APPROVED',evidenceSummary:'已核验'}})).statusCode).toBe(201);
    const skuId=(await app.inject({method:'POST',url:'/api/v1/admin/platform/skus',headers:procurement,payload:{title:'售后干货',category:'干货',origin:'河北',imageUrl:null,skuName:'300g',retailPriceCents:2000,status:'ACTIVE'}})).json().data.id as string;
    const offerId=(await app.inject({method:'POST',url:'/api/v1/admin/platform/offers',headers:procurement,payload:{supplierId,platformSkuId:skuId,purchasePriceCents:1000,minimumPurchaseQuantity:1,leadTimeDays:1,status:'ACTIVE'}})).json().data.id as string;
    const campaignId=(await app.inject({method:'POST',url:'/api/v1/admin/platform/campaigns',headers:procurement,payload:{title:'质量售后团',serviceAreaId:'service-bd-lianchi',warehouseId,cutoffAt:new Date(Date.now()+3600_000).toISOString(),dispatchAt:new Date(Date.now()+7200_000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',items:[{platformSkuId:skuId,supplierOfferId:offerId,sellableQuantity:1}]}})).json().data.id as string;
    const savedPoint=(await store.listPickupPoints()).find((value)=>value.id===pointId)!;expect((await app.inject({method:'POST',url:'/api/v1/admin/delivery-plans',headers:operator,payload:{campaignId,pickupPointId:pointId,siteName:savedPoint.name,address:savedPoint.address,arrivalStartAt:new Date(Date.now()+86_400_000).toISOString(),arrivalEndAt:null,contactName:'现场',contactPhone:'13800000000',remark:null}})).statusCode).toBe(200);expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/open`,headers:operator})).statusCode).toBe(200);
    const orderId=(await app.inject({method:'POST',url:'/api/v1/orders',headers:{...customer,'idempotency-key':'quality-claim-001'},payload:{campaignId,serviceAreaId:'service-bd-lianchi',pickupPointId:pointId,items:[{skuId,quantity:1}]}})).json().data.id as string;await pay(orderId);vi.useFakeTimers();vi.setSystemTime(new Date(Date.now()+3600_001));try{expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${campaignId}/close`,headers:operator})).statusCode).toBe(200);}finally{vi.useRealTimers();}
    const po=(await app.inject({method:'GET',url:'/api/v1/admin/platform/purchase-orders',headers:procurement})).json().data[0] as {id:string;items:Array<{id:string}>};expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/purchase-orders/${po.id}/receive`,headers:warehouse,payload:{items:[{purchaseOrderItemId:po.items[0]!.id,acceptedQuantity:1,rejectedQuantity:0,batchNo:'LOT-CLAIM',productionDate:'2026-08-01',expiresAt:'2027-08-01',inspectionNote:null}]}})).statusCode).toBe(200);expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/sorting`,headers:warehouse})).statusCode).toBe(200);expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/sorting/complete`,headers:warehouse})).statusCode).toBe(200);
    const plan=await store.getDeliveryPlanByCampaign(campaignId);if(!plan)throw new Error('plan expected');expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${plan.id}/book-vehicle`,headers:fulfillment,payload:{vehicleOrderNo:'CLAIM-1',driverName:'配送员',driverPhone:'13900000000',vehiclePlate:'冀F1111'}})).statusCode).toBe(200);const outbound=(await app.inject({method:'POST',url:`/api/v1/admin/platform/campaigns/${campaignId}/outbound`,headers:warehouse,payload:{carrierReference:'质量售后'}})).json().data as {id:string;items:Array<{platformSkuId:string;quantity:number}>};expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/outbound/${outbound.id}/handover`,headers:fulfillment,payload:{receivedBy:'fulfillment-1',exceptionNote:null,items:outbound.items.map((item)=>({platformSkuId:item.platformSkuId,receivedQuantity:item.quantity}))}})).statusCode).toBe(200);
    const code=(await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer})).json().data.code as string;const grant=await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:operator,payload:{userId:'fulfillment-1',pickupPointId:pointId}});expect([200,409]).toContain(grant.statusCode);expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:fulfillment,payload:{orderId,deliveryPlanId:plan.id,code}})).statusCode).toBe(200);
    const rejectedLegacyAfterSale=await app.inject({method:'POST',url:`/api/v1/orders/${orderId}/after-sales`,headers:customer,payload:{reason:'商品质量问题',description:'已领取模式 B 商品必须进入明细异常链'}});expect(rejectedLegacyAfterSale.statusCode).toBe(409);const payload={clientRequestId:'quality-claim-request-001',items:[{platformSkuId:skuId,quantity:1,reason:'QUALITY_CLAIM',description:'商品开封后发现明显质量问题',evidenceUrl:null}]};const auditFailure=vi.spyOn(store,'saveAuditLog').mockRejectedValueOnce(new Error('injected audit persistence failure'));const rejectedClaim=await app.inject({method:'POST',url:`/api/v1/orders/${orderId}/fulfillment-claims`,headers:customer,payload});expect(rejectedClaim.statusCode).toBe(500);expect((await app.inject({method:'GET',url:`/api/v1/orders/${orderId}`,headers:customer})).json().data.items).toMatchObject([{fulfilledQuantity:1,exceptionQuantity:0}]);expect((await store.listFulfillmentExceptions()).filter((item)=>item.orderId===orderId)).toHaveLength(0);auditFailure.mockRestore();const first=await app.inject({method:'POST',url:`/api/v1/orders/${orderId}/fulfillment-claims`,headers:customer,payload});const retry=await app.inject({method:'POST',url:`/api/v1/orders/${orderId}/fulfillment-claims`,headers:customer,payload});expect(first.statusCode,first.body).toBe(201);expect(retry.statusCode,retry.body).toBe(201);expect(retry.json().data.id).toBe(first.json().data.id);const claimId=first.json().data.id as string;const claimAudits=(await store.listAuditLogs(30)).filter((item)=>item.action==='FULFILLMENT_EXCEPTION_CUSTOMER_CLAIMED'&&item.resourceId===claimId);expect(claimAudits).toHaveLength(1);expect(claimAudits[0]?.afterData).toMatchObject({exception:{id:claimId},allocations:[{exceptionId:claimId}],salesLines:[{before:{fulfilledQuantity:1,exceptionQuantity:0},after:{fulfilledQuantity:0,exceptionQuantity:1}}]});
    expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/fulfillment-exceptions/${claimId}/decision`,headers:operator,payload:{status:'REFUND_CONFIRMED',responsibility:'PLATFORM',resolutionNote:'核实质量问题，按订单快照价退款'}})).statusCode).toBe(200);expect((await app.inject({method:'POST',url:`/api/v1/admin/platform/fulfillment-exceptions/${claimId}/partial-refund`,headers:finance,payload:{confirmationNote:'已复核质量申报与单价'}})).statusCode).toBe(200);const order=await app.inject({method:'GET',url:`/api/v1/orders/${orderId}`,headers:customer});expect(order.json().data).toMatchObject({status:'REFUNDED',items:[{fulfilledQuantity:0,exceptionQuantity:1,refundedQuantity:1,refundedAmountCents:2000}],partialRefunds:[{amountCents:2000,status:'SUCCEEDED'}]});
  });

  it('refuses to open a campaign until its active fixed pickup point is bound', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/campaigns', headers: operator, payload: {
      title: '待绑定自提点团期', serviceAreaId: 'service-bd-lianchi',
      cutoffAt: new Date(Date.now() + 3_600_000).toISOString(), dispatchAt: new Date(Date.now() + 7_200_000).toISOString(),
      minTotalQuantity: 1, failureAction: 'CANCEL_AND_REFUND', skuIds: ['sku-demo-001'],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const campaignId = created.json().data.id as string;
    const opened = await app.inject({ method: 'POST', url: `/api/v1/admin/campaigns/${campaignId}/open`, headers: operator });
    expect(opened.statusCode).toBe(409);
    expect(opened.json().code).toBe('DELIVERY_SITE_NOT_CONFIRMED');
  });

  it('only exposes actively sellable campaigns through public endpoints', async () => {
    const campaignId = await createCampaign();
    expect((await app.inject({ method: 'GET', url: '/api/v1/campaigns' })).json().data.some((item:{ id:string }) => item.id === campaignId)).toBe(true);
    await store.updateServiceAreaOrderEnabled('service-bd-lianchi', false);
    expect((await app.inject({ method: 'GET', url: '/api/v1/campaigns' })).json().data.some((item:{ id:string }) => item.id === campaignId)).toBe(false);
    expect((await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}` })).statusCode).toBe(404);
  });

  it('keeps a vehicle-booked campaign publicly sellable and checkoutable before cutoff', async () => {
    const campaignId = await createCampaign();
    const plan = await store.getDeliveryPlanByCampaign(campaignId);
    expect(plan).toBeTruthy();
    const booked = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/delivery-plans/${plan!.id}/book-vehicle`,
      headers: fulfillment,
      payload: { vehicleOrderNo: 'HL-SELLABLE', driverName: '李师傅', driverPhone: '13900000000', vehiclePlate: '冀F12345' },
    });
    expect(booked.statusCode, booked.body).toBe(200);
    expect(booked.json().data.status).toBe('VEHICLE_BOOKED');

    expect((await app.inject({ method: 'GET', url: '/api/v1/campaigns' })).json().data.some((item: { id: string }) => item.id === campaignId)).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}` })).statusCode).toBe(200);
    await createOrder(campaignId, 1, 'vehicle-booked-sellable');
  });

  it('returns a client error for malformed JSON instead of an internal error', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/wechat/login',
      headers: { 'content-type': 'application/json' }, body: '{not-json',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('rejects a production-mode request that bypasses the HTTPS gateway', async () => {
    const productionApp = await buildApp({ config: loadConfig({ NODE_ENV: 'test', REQUIRE_HTTPS: 'true' }), store: new MemoryStore() });
    try {
      expect((await productionApp.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(426);
      expect((await productionApp.inject({ method: 'GET', url: '/health/live', headers: { 'x-forwarded-proto': 'https' } })).statusCode).toBe(200);
    } finally { await productionApp.close(); }
  });

  it('validates mainland contact numbers consistently at the API boundary', async () => {
    const invalid = await app.inject({
      method: 'POST', url: '/api/v1/service-area-interests', headers: customer,
      payload: { regionText: '莲池区', contactName: '测试用户', contactPhone: '123456', privacyAccepted: true, privacyVersion: '2026-08-12' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('records an immutable, server-timestamped privacy acceptance for an interest submission', async () => {
    const payload = { regionText: '莲池区', contactName: '测试用户', contactPhone: '13800000000', privacyAccepted: true as const, privacyVersion: '2026-08-12' };
    const created = await app.inject({ method: 'POST', url: '/api/v1/service-area-interests', headers: customer, payload });
    expect(created.statusCode, created.body).toBe(201);
    const first = await store.getPrivacyConsent('user-1', '2026-08-12');
    expect(first).toMatchObject({ userId: 'user-1', documentVersion: '2026-08-12' });
    expect(first?.consentedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created.json().data).toMatchObject({ privacyVersion: '2026-08-12', privacyConsentedAt: first?.consentedAt });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const retried = await app.inject({ method: 'POST', url: '/api/v1/service-area-interests', headers: customer, payload });
    expect(retried.statusCode).toBe(201);
    expect((await store.getPrivacyConsent('user-1', '2026-08-12'))?.consentedAt).toBe(first?.consentedAt);
    const stale = await app.inject({ method: 'POST', url: '/api/v1/service-area-interests', headers: customer, payload: { ...payload, privacyVersion: '2026-01-01' } });
    expect(stale.statusCode).toBe(400);
  });

  it('cancels an unpaid order once, rejects IDOR and prevents a stale payment win', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId, 2, 'cancel-1');
    expect((await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, headers: { 'x-demo-user-id': 'user-2', 'x-demo-role': 'USER' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, headers: customer })).json().data.status).toBe('CANCELLED');
    expect((await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, headers: customer })).json().data.status).toBe('CANCELLED');
    expect((await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/mock-pay`, headers: customer })).statusCode).toBe(409);
    expect((await store.getCampaign(campaignId))?.items[0]?.soldQuantity).toBe(0);
  });

  it('claims one provider payment initiation across concurrent customer retries', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId, 1, 'concurrent-payment-initiation');
    const paymentService = new (await import('./modules/payments/payment-service.js')).PaymentService(
      store,
      {
        name: 'mock' as const,
        initiate: async () => {
          providerCalls += 1;
          await providerStarted;
          return { providerPaymentId: 'prepay-once', clientPayload: { mock: 'once' }, providerContext: { subOrders: [] } };
        },
        parseNotification: () => { throw new Error('not used'); },
        refund: async () => ({ providerRefundId: null, status: 'SUCCEEDED' as const }),
        queryRefund: async () => ({ providerRefundId: null, status: 'SUCCEEDED' as const }),
        parseRefundNotification: () => { throw new Error('not used'); },
        settle: async () => ({ providerOrderId: null, status: 'SUCCEEDED' as const }),
        querySettlement: async () => ({ providerOrderId: null, status: 'SUCCEEDED' as const }),
      },
      new (await import('./modules/finance/ledger-service.js')).LedgerService(),
    );
    let providerCalls = 0;
    let releaseProvider!: () => void;
    const providerStarted = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const first = paymentService.initiate(orderId, 'user-1');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const second = paymentService.initiate(orderId, 'user-1');
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(providerCalls).toBe(1);
    releaseProvider();
    await expect(first).resolves.toMatchObject({ clientPayload: { mock: 'once' } });
    await expect(second).resolves.toMatchObject({ clientPayload: { mock: 'once' } });
    expect(providerCalls).toBe(1);
    expect(await store.getPaymentByOrder(orderId)).toMatchObject({ clientPayload: { mock: 'once' }, initiationLeaseUntil: null, initiationClaimToken: null });
  });

  it('refunds a late successful provider callback after cancellation without re-releasing stock', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId, 2, 'late-provider-payment');
    expect((await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/pay`, headers: customer })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, headers: customer })).statusCode).toBe(200);
    const order = await store.getOrder(orderId);
    const paymentService = new (await import('./modules/payments/payment-service.js')).PaymentService(
      store,
      new (await import('./modules/payments/payment-provider.js')).MockPaymentProvider(),
      new (await import('./modules/finance/ledger-service.js')).LedgerService(),
    );
    const event = { eventId: 'late-payment-event-1', type: 'COMBINE_TRANSACTION.SUCCESS', orderNo: order!.orderNo, providerPaymentId: 'late-provider-payment-id', amountCents: Number(order!.totalCents), bodyHash: 'a'.repeat(64), subTransactions: [] };
    await paymentService.handleNotification(event);
    await paymentService.handleNotification(event);
    expect((await store.getOrder(orderId))?.status).toBe('REFUNDED');
    expect((await store.getPaymentByOrder(orderId))?.status).toBe('REFUNDED');
    expect(await store.listRefundsByOrder(orderId)).toHaveLength(1);
    expect((await store.getCampaign(campaignId))?.items[0]?.soldQuantity).toBe(0);
  });

  it('treats concurrent duplicate provider callbacks as one successful payment', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId, 1, 'concurrent-provider-payment');
    const order = await store.getOrder(orderId);
    const paymentService = new (await import('./modules/payments/payment-service.js')).PaymentService(
      store,
      new (await import('./modules/payments/payment-provider.js')).MockPaymentProvider(),
      new (await import('./modules/finance/ledger-service.js')).LedgerService(),
    );
    const event = { eventId: 'concurrent-payment-event-1', type: 'COMBINE_TRANSACTION.SUCCESS', orderNo: order!.orderNo, providerPaymentId: 'concurrent-provider-payment-id', amountCents: Number(order!.totalCents), bodyHash: 'b'.repeat(64), subTransactions: [] };
    await expect(Promise.all([paymentService.handleNotification(event), paymentService.handleNotification(event)])).resolves.toEqual([undefined, undefined]);
    expect((await store.getOrder(orderId))?.status).toBe('PAID_WAITING_CLOSE');
    expect((await store.getPaymentByOrder(orderId))?.status).toBe('SUCCEEDED');
    expect(await store.listLedgerTransactions(orderId)).toHaveLength(1);
  });

  it('recovers a committed REFUNDING order that has no refund task after a crash', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId, 1, 'refund-recovery'); await pay(orderId);
    await store.transaction(async (tx) => {
      const order = await tx.getOrderForUpdate(orderId); const payment = await tx.getPaymentByOrderForUpdate(orderId);
      if (!order || !payment) throw new Error('expected paid order');
      order.status = 'REFUNDING'; payment.status = 'REFUNDING';
      await tx.saveOrderStatus(order); await tx.savePayment(payment);
      expect(await tx.releaseCampaignSkuStock(campaignId, 'sku-demo-001', 1)).toBe(true);
    });
    const paymentService = new (await import('./modules/payments/payment-service.js')).PaymentService(
      store,
      new (await import('./modules/payments/payment-provider.js')).MockPaymentProvider(),
      new (await import('./modules/finance/ledger-service.js')).LedgerService(),
    );
    await paymentService.reconcileRefunds();
    expect((await store.getOrder(orderId))?.status).toBe('REFUNDED');
    expect((await store.getPaymentByOrder(orderId))?.status).toBe('REFUNDED');
    expect(await store.listRefundsByOrder(orderId)).toHaveLength(1);
    expect((await store.getCampaign(campaignId))?.items[0]?.soldQuantity).toBe(0);
  });

  it('replays an expired refund-submission lease with the same provider refund number', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId, 1, 'refund-lease-recovery'); await pay(orderId);
    await store.transaction(async (tx) => {
      const order = await tx.getOrderForUpdate(orderId); const payment = await tx.getPaymentByOrderForUpdate(orderId);
      if (!order || !payment) throw new Error('expected paid order');
      order.status = 'REFUNDING'; payment.status = 'REFUNDING';
      await tx.saveOrderStatus(order); await tx.savePayment(payment);
      expect(await tx.releaseCampaignSkuStock(campaignId, 'sku-demo-001', 1)).toBe(true);
    });
    const provider = new (await import('./modules/payments/payment-provider.js')).MockPaymentProvider();
    const paymentService = new (await import('./modules/payments/payment-service.js')).PaymentService(
      store, provider, new (await import('./modules/finance/ledger-service.js')).LedgerService(),
    );
    // First reconciliation creates the durable refund record and finishes the mock refund.
    await paymentService.reconcileRefunds();
    const refund = (await store.listRefundsByOrder(orderId))[0];
    if (!refund) throw new Error('expected refund');
    // Recreate the production crash window: provider work was claimed but no request
    // completed. Recovery must reuse this immutable provider refund number.
    refund.status = 'PROCESSING'; refund.providerRefundId = null; refund.submissionLeaseUntil = new Date(Date.now() - 1).toISOString();
    await store.saveRefund(refund);
    const submitted: string[] = [];
    const recoveringProvider = { ...provider, refund: async (input: { providerRefundNo: string }) => { submitted.push(input.providerRefundNo); return { providerRefundId: 'RECOVERED', status: 'SUCCEEDED' as const }; }, queryRefund: async () => { throw new Error('provider has no record yet'); } };
    const recoveringService = new (await import('./modules/payments/payment-service.js')).PaymentService(
      store, recoveringProvider, new (await import('./modules/finance/ledger-service.js')).LedgerService(),
    );
    await recoveringService.reconcileRefunds();
    expect(submitted).toEqual([refund.providerRefundNo]);
    expect((await store.getOrder(orderId))?.status).toBe('REFUNDED');
    expect((await store.getPaymentByOrder(orderId))?.status).toBe('REFUNDED');
  });

  it('queries an expired processing refund before replaying it', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId, 1, 'refund-query-first'); await pay(orderId);
    const now = new Date().toISOString();
    await store.transaction(async (tx) => {
      const order = await tx.getOrderForUpdate(orderId); const payment = await tx.getPaymentByOrderForUpdate(orderId);
      if (!order || !payment) throw new Error('expected paid order');
      order.status = 'REFUNDING'; payment.status = 'REFUNDING';
      await tx.saveOrderStatus(order); await tx.savePayment(payment);
      await tx.saveRefund({ id: crypto.randomUUID(), orderId, paymentId: payment.id, merchantOrderId: order.merchantOrders[0]!.id, providerRefundNo: `RF-QUERY-${orderId}`, providerRefundId: null, status: 'PROCESSING', amountCents: order.merchantOrders[0]!.itemAmountCents, createdAt: now, submissionLeaseUntil: new Date(Date.now() - 1).toISOString(), submissionClaimToken: 'crashed-worker' });
    });
    let refundCalls = 0;
    const baseProvider = new (await import('./modules/payments/payment-provider.js')).MockPaymentProvider();
    const recoveringProvider = { ...baseProvider, refund: async () => { refundCalls += 1; return { providerRefundId: 'should-not-submit', status: 'SUCCEEDED' as const }; }, queryRefund: async () => ({ providerRefundId: 'query-wins', status: 'SUCCEEDED' as const }) };
    const paymentService = new (await import('./modules/payments/payment-service.js')).PaymentService(store, recoveringProvider, new (await import('./modules/finance/ledger-service.js')).LedgerService());
    await paymentService.reconcileRefunds();
    expect(refundCalls).toBe(0);
    expect((await store.listRefundsByOrder(orderId))[0]).toMatchObject({ providerRefundId: 'query-wins', status: 'SUCCEEDED' });
    expect((await store.getOrder(orderId))?.status).toBe('REFUNDED');
  });

  it('keeps a provider-acknowledged processing refund in query-only recovery', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId, 1, 'refund-processing-query'); await pay(orderId);
    const now = new Date().toISOString();
    await store.transaction(async (tx) => {
      const order = await tx.getOrderForUpdate(orderId); const payment = await tx.getPaymentByOrderForUpdate(orderId);
      if (!order || !payment) throw new Error('expected paid order');
      order.status = 'REFUNDING'; payment.status = 'REFUNDING';
      await tx.saveOrderStatus(order); await tx.savePayment(payment);
      await tx.saveRefund({ id: crypto.randomUUID(), orderId, paymentId: payment.id, merchantOrderId: order.merchantOrders[0]!.id, providerRefundNo: `RF-PROCESSING-${orderId}`, providerRefundId: 'remote-processing', status: 'PROCESSING', amountCents: order.merchantOrders[0]!.itemAmountCents, createdAt: now, submissionLeaseUntil: null, submissionClaimToken: null });
    });
    let refundCalls = 0; let queryCalls = 0;
    const baseProvider = new (await import('./modules/payments/payment-provider.js')).MockPaymentProvider();
    const processingProvider = { ...baseProvider, refund: async () => { refundCalls += 1; return { providerRefundId: 'unexpected', status: 'SUCCEEDED' as const }; }, queryRefund: async () => { queryCalls += 1; return { providerRefundId: 'remote-processing', status: 'PROCESSING' as const }; } };
    const paymentService = new (await import('./modules/payments/payment-service.js')).PaymentService(store, processingProvider, new (await import('./modules/finance/ledger-service.js')).LedgerService());
    await paymentService.reconcileRefunds(); await paymentService.reconcileRefunds();
    expect({ refundCalls, queryCalls }).toEqual({ refundCalls: 0, queryCalls: 2 });
    expect((await store.getRefundByProviderNo(`RF-PROCESSING-${orderId}`))).toMatchObject({ status: 'PROCESSING', submissionLeaseUntil: null, submissionClaimToken: null });
  });

  it('fences a late refund result after an expired lease is claimed again', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId, 1, 'refund-fence'); await pay(orderId);
    const now = new Date().toISOString();
    let refundId = '';
    await store.transaction(async (tx) => {
      const order = await tx.getOrderForUpdate(orderId); const payment = await tx.getPaymentByOrderForUpdate(orderId);
      if (!order || !payment) throw new Error('expected paid order');
      order.status = 'REFUNDING'; payment.status = 'REFUNDING';
      await tx.saveOrderStatus(order); await tx.savePayment(payment);
      refundId = crypto.randomUUID();
      await tx.saveRefund({ id: refundId, orderId, paymentId: payment.id, merchantOrderId: order.merchantOrders[0]!.id, providerRefundNo: `RF-FENCE-${orderId}`, providerRefundId: null, status: 'PROCESSING', amountCents: order.merchantOrders[0]!.itemAmountCents, createdAt: now, submissionLeaseUntil: new Date(Date.now() - 1).toISOString(), submissionClaimToken: 'crashed-worker' });
    });
    let oldRequestStarted!: () => void;
    const oldRequest = new Promise<void>((resolve) => { oldRequestStarted = resolve; });
    let resolveOld!: (value: { providerRefundId: string; status: 'SUCCEEDED' }) => void;
    const baseProvider = new (await import('./modules/payments/payment-provider.js')).MockPaymentProvider();
    const oldProvider = { ...baseProvider, queryRefund: async () => { throw new Error('not found'); }, refund: async () => { oldRequestStarted(); return new Promise<{ providerRefundId: string; status: 'SUCCEEDED' }>((resolve) => { resolveOld = resolve; }); } };
    const oldService = new (await import('./modules/payments/payment-service.js')).PaymentService(store, oldProvider, new (await import('./modules/finance/ledger-service.js')).LedgerService());
    const oldRun = oldService.reconcileRefunds();
    await oldRequest;
    const held = await store.getRefundByProviderNo(`RF-FENCE-${orderId}`);
    if (!held) throw new Error('expected claimed refund');
    await store.saveRefund({ ...held, submissionLeaseUntil: new Date(Date.now() - 1).toISOString() });
    const newProvider = { ...baseProvider, queryRefund: async () => { throw new Error('not found'); }, refund: async () => ({ providerRefundId: 'new-worker-result', status: 'SUCCEEDED' as const }) };
    const newService = new (await import('./modules/payments/payment-service.js')).PaymentService(store, newProvider, new (await import('./modules/finance/ledger-service.js')).LedgerService());
    await newService.reconcileRefunds();
    resolveOld({ providerRefundId: 'late-old-result', status: 'SUCCEEDED' });
    await oldRun;
    expect((await store.getRefundByProviderNo(`RF-FENCE-${orderId}`))).toMatchObject({ providerRefundId: 'new-worker-result', status: 'SUCCEEDED', submissionClaimToken: null });
    expect((await store.getOrder(orderId))?.status).toBe('REFUNDED');
  });

  it('blocks an early manual close and dispatch without vehicle details', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId); await pay(orderId);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/campaigns/${campaignId}/close`, headers: operator })).statusCode).toBe(409);
    await close(campaignId);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/dispatch-batches', headers: fulfillment, payload: { campaignId } })).statusCode).toBe(409);
  });

  it('limits direct refunds to finance and releases stock exactly once', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId, 2); await pay(orderId);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/refund`, headers: operator })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/refund`, headers: finance })).json().data.status).toBe('REFUNDED');
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/refund`, headers: finance })).json().data.status).toBe('REFUNDED');
    expect((await store.getCampaign(campaignId))?.items[0]?.soldQuantity).toBe(0);
  });

  it('requires customer-service acceptance and finance approval for an idempotent full refund', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId); await pay(orderId);
    const submitted = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/after-sales`, headers: customer, payload: { reason: '商品质量问题', description: '包装破损且商品无法正常食用。' } });
    const id = submitted.json().data.id as string;
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/after-sales/${id}/refund`, headers: service, payload: { resolutionNote: '同意退款' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/after-sales/${id}/status`, headers: service, payload: { status: 'PROCESSING' } })).json().data.status).toBe('PROCESSING');
    const refunded = await app.inject({ method: 'POST', url: `/api/v1/admin/after-sales/${id}/refund`, headers: finance, payload: { resolutionNote: '核实质量问题，原路全额退款' } });
    expect(refunded.json().data).toMatchObject({ status: 'RESOLVED', resolutionType: 'FULL_REFUND', refundAmountCents: 2980 });
    const retried = await app.inject({ method: 'POST', url: `/api/v1/admin/after-sales/${id}/refund`, headers: finance, payload: { resolutionNote: '重复请求' } });
    expect(retried.json().data.refundIds).toEqual(refunded.json().data.refundIds);
  });

  it('refunds a picked-up quality claim without reselling consumed stock or creating settlement', async () => {
    const campaignId = await createCampaign(); const orderId = await createOrder(campaignId); await pay(orderId); await close(campaignId); await fulfill(campaignId, orderId);
    expect((await app.inject({ method: 'GET', url: `/api/v1/admin/finance/settlements?orderId=${orderId}`, headers: finance })).json().data).toHaveLength(0);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/orders/${orderId}/refund`,headers:finance})).statusCode).toBe(409);
    const submitted = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/after-sales`, headers: customer, payload: { reason: '取货后质量问题', description: '现场未拆封，回家后发现包装内商品破损。' } });
    const id = submitted.json().data.id as string;
    await app.inject({ method: 'POST', url: `/api/v1/admin/after-sales/${id}/status`, headers: service, payload: { status: 'PROCESSING' } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/after-sales/${id}/refund`, headers: finance, payload: { resolutionNote: '核实后全额退款' } })).statusCode).toBe(200);
    expect((await store.getCampaign(campaignId))?.items[0]?.soldQuantity).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: customer })).json().data.status).toBe('REFUNDED');
    expect(notifications).toHaveLength(0);
  });

  it('settles only after the seven-day after-sales protection period',async()=>{
    const campaignId=await createCampaign();const orderId=await createOrder(campaignId);await pay(orderId);await close(campaignId);await fulfill(campaignId,orderId);
    const payment=(await import('./modules/payments/payment-service.js')).PaymentService;
    const ledger=new (await import('./modules/finance/ledger-service.js')).LedgerService();
    const provider=new (await import('./modules/payments/payment-provider.js')).MockPaymentProvider();
    const serviceObject=new payment(store,provider,ledger);
    const order=await store.getOrder(orderId);expect(order?.pickedUpAt).toBeTruthy();
    expect(await serviceObject.settleEligiblePickedUpOrders(100,Date.parse(order!.pickedUpAt!)+7*86_400_000-1)).toBe(0);
    expect(await serviceObject.settleEligiblePickedUpOrders(100,Date.parse(order!.pickedUpAt!)+7*86_400_000)).toBe(1);
    expect((await store.getOrder(orderId))?.status).toBe('COMPLETED');
    expect(await store.listSettlements(orderId)).toHaveLength(1);
  });

  it('settles eligible older pickups instead of only the latest order page',async()=>{
    const campaignId=await createCampaign();const orderId=await createOrder(campaignId);await pay(orderId);await close(campaignId);await fulfill(campaignId,orderId);
    const order=await store.getOrder(orderId);order!.pickedUpAt=new Date(Date.now()-8*86_400_000).toISOString();await store.saveOrderStatus(order!);
    for(let index=0;index<110;index++)await store.saveOrder({...order!,id:`settlement-newer-${index}`,orderNo:`HTSETTLEMENT${index}`,status:'COMPLETED',createdAt:new Date(Date.now()+index).toISOString()});
    const payment=(await import('./modules/payments/payment-service.js')).PaymentService;
    const serviceObject=new payment(store,new (await import('./modules/payments/payment-provider.js')).MockPaymentProvider(),new (await import('./modules/finance/ledger-service.js')).LedgerService());
    expect(await serviceObject.settleEligiblePickedUpOrders(100)).toBe(1);
    expect((await store.getOrder(orderId))?.status).toBe('COMPLETED');
  });

  it('opens an administrative region idempotently and blocks campaigns while ordering is paused',async()=>{
    const first=await app.inject({method:'POST',url:'/api/v1/admin/service-areas',headers:operator,payload:{regionCode:'130602'}});
    expect(first.statusCode,first.body).toBe(201);const areaId=first.json().data.id as string;
    expect((await app.inject({method:'POST',url:'/api/v1/admin/service-areas',headers:operator,payload:{regionCode:'130602'}})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/service-areas/${areaId}/order-status`,headers:operator,payload:{orderEnabled:false}})).statusCode).toBe(200);
    expect((await app.inject({method:'GET',url:'/api/v1/service-areas'})).json().data.some((item:{id:string})=>item.id===areaId)).toBe(false);
    const blocked=await app.inject({method:'POST',url:'/api/v1/admin/campaigns',headers:operator,payload:{title:'暂停区域团期',serviceAreaId:areaId,cutoffAt:new Date(Date.now()+3_600_000).toISOString(),dispatchAt:new Date(Date.now()+7_200_000).toISOString(),minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',skuIds:['sku-demo-001']}});
    expect(blocked.statusCode).toBe(404);
  });

  it('supports the reviewed merchant and product lifecycle',async()=>{
    const merchant=await app.inject({method:'POST',url:'/api/v1/admin/merchants',headers:operator,payload:{name:'涞水农产供应商',defaultCommissionBps:600,wechatSubMchid:null}});
    expect(merchant.statusCode,merchant.body).toBe(201);const merchantId=merchant.json().data.id as string;
    expect((await app.inject({method:'PATCH',url:`/api/v1/admin/merchants/${merchantId}`,headers:operator,payload:{name:'涞水农产供应商（更新）',defaultCommissionBps:700,wechatSubMchid:null}})).statusCode).toBe(200);
    const product=await app.inject({method:'POST',url:'/api/v1/admin/products',headers:operator,payload:{merchantId,title:'涞水麻核桃',category:'当季农产',origin:'河北保定涞水县',imageUrl:null,skuName:'500g/袋',priceCents:1280,stock:20}});
    expect(product.statusCode,product.body).toBe(201);const productId=product.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/products/${productId}/submit-review`,headers:operator})).json().data.status).toBe('PENDING_REVIEW');
    const reviewer={'x-demo-user-id':'reviewer-1','x-demo-role':'REVIEWER'};
    expect((await app.inject({method:'POST',url:`/api/v1/admin/products/${productId}/review`,headers:reviewer,payload:{decision:'APPROVE'}})).json().data.status).toBe('APPROVED');
    expect((await app.inject({method:'POST',url:`/api/v1/admin/products/${productId}/off-shelf`,headers:operator})).json().data.status).toBe('OFF_SHELF');
    expect((await app.inject({method:'POST',url:`/api/v1/admin/products/${productId}/restore`,headers:operator})).json().data.status).toBe('DRAFT');
  });

  it('edits and cancels only a draft campaign',async()=>{
    const payload={title:'可编辑草稿团',serviceAreaId:'service-bd-lianchi',cutoffAt:new Date(Date.now()+3_600_000).toISOString(),dispatchAt:new Date(Date.now()+7_200_000).toISOString(),minTotalQuantity:12,failureAction:'CANCEL_AND_REFUND',skuIds:['sku-demo-001']};
    const created=await app.inject({method:'POST',url:'/api/v1/admin/campaigns',headers:operator,payload});expect(created.statusCode).toBe(201);const id=created.json().data.id as string;
    const edited=await app.inject({method:'PATCH',url:`/api/v1/admin/campaigns/${id}`,headers:operator,payload:{...payload,title:'已编辑草稿团',minTotalQuantity:16}});
    expect(edited.json().data).toMatchObject({title:'已编辑草稿团',minTotalQuantity:16});
    expect((await app.inject({method:'POST',url:`/api/v1/admin/campaigns/${id}/cancel`,headers:operator})).json().data.status).toBe('CANCELLED');
  });

  it('does not allocate the same remaining SKU inventory to overlapping active campaign snapshots',async()=>{
    const payload=(title:string)=>({title,serviceAreaId:'service-bd-lianchi',cutoffAt:new Date(Date.now()+3_600_000).toISOString(),dispatchAt:new Date(Date.now()+7_200_000).toISOString(),minTotalQuantity:10,failureAction:'CANCEL_AND_REFUND',skuIds:['sku-demo-001']});
    expect((await app.inject({method:'POST',url:'/api/v1/admin/campaigns',headers:operator,payload:payload('库存隔离团 A')})).statusCode).toBe(201);
    const overlap=await app.inject({method:'POST',url:'/api/v1/admin/campaigns',headers:operator,payload:payload('库存隔离团 B')});
    expect(overlap.statusCode).toBe(409);expect(overlap.json().code).toBe('OUT_OF_STOCK');
  });

  it('requires a rejection note and persists the customer-service decision',async()=>{
    const campaignId=await createCampaign();const orderId=await createOrder(campaignId);await pay(orderId);
    const submitted=await app.inject({method:'POST',url:`/api/v1/orders/${orderId}/after-sales`,headers:customer,payload:{reason:'不符合预期',description:'收到商品后发现规格与页面描述不一致。'}});const id=submitted.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/after-sales/${id}/status`,headers:service,payload:{status:'REJECTED'}})).statusCode).toBe(400);
    const rejected=await app.inject({method:'POST',url:`/api/v1/admin/after-sales/${id}/status`,headers:service,payload:{status:'REJECTED',resolutionNote:'核对商品快照后确认规格一致'}});
    expect(rejected.json().data).toMatchObject({status:'REJECTED',resolutionType:'REJECTED',resolutionNote:'核对商品快照后确认规格一致'});
  });

  it('records in-app delivery notifications without sending when the customer did not consent',async()=>{
    const campaignId=await createCampaign();const orderId=await createOrder(campaignId);await pay(orderId);await close(campaignId);await fulfill(campaignId,orderId);
    expect(notifications).toHaveLength(0);
    const inApp=await app.inject({method:'GET',url:'/api/v1/notifications',headers:customer});
    expect(inApp.json().data.map((item:{type:string})=>item.type).sort()).toEqual(['ARRIVED','VEHICLE_DISPATCHED']);
  });

  it('requires an API-managed point grant for pickup verification',async()=>{
    await store.saveUser({id:'fulfillment-1',wechatOpenId:null,status:'ACTIVE',createdAt:new Date().toISOString()});
    const campaignId=await createCampaign();const orderId=await createOrder(campaignId);await pay(orderId);await close(campaignId);
    const plan=await store.getDeliveryPlanByCampaign(campaignId);if(!plan)throw new Error('expected delivery plan');const planId=plan.id;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${planId}/book-vehicle`,headers:fulfillment,payload:{vehicleOrderNo:'HL-POINT-GRANT',driverName:'测试',driverPhone:'13900000000',vehiclePlate:'冀F12345'}})).statusCode).toBe(200);
    const batch=await app.inject({method:'POST',url:'/api/v1/admin/dispatch-batches',headers:fulfillment,payload:{campaignId}});const batchId=batch.json().data.id as string;
    await app.inject({method:'POST',url:`/api/v1/admin/dispatch-batches/${batchId}/dispatch`,headers:fulfillment});
    await app.inject({method:'POST',url:`/api/v1/pickup/batches/${batchId}/receive`,headers:fulfillment,payload:{deliveryPlanId:planId}});
    const code=(await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer})).json().data.code as string;
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:fulfillment,payload:{orderId,deliveryPlanId:planId,code}})).statusCode).toBe(403);
    const granted=await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:operator,payload:{userId:'fulfillment-1',pickupPointId:pointId}});
    expect(granted.statusCode,granted.body).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:fulfillment,payload:{orderId,deliveryPlanId:planId,code}})).statusCode).toBe(200);
  });

  it('only lets a granted verifier look up the exact order at its assigned pickup point',async()=>{
    const now=new Date().toISOString();
    await store.saveUser({id:'verifier-lookup',wechatOpenId:null,status:'ACTIVE',createdAt:now});
    const verifierLookup={'x-demo-user-id':'verifier-lookup','x-demo-role':'PICKUP_VERIFIER'};
    const campaignId=await createCampaign();const orderId=await createOrder(campaignId);await pay(orderId);await close(campaignId);
    const plan=await store.getDeliveryPlanByCampaign(campaignId);if(!plan)throw new Error('expected delivery plan');
    const order=await store.getOrder(orderId);if(!order)throw new Error('expected order');
    const lookupUrl=`/api/v1/pickup/orders/lookup?deliveryPlanId=${encodeURIComponent(plan.id)}&orderNo=${encodeURIComponent(order.orderNo)}`;
    expect((await app.inject({method:'GET',url:lookupUrl,headers:verifierLookup})).statusCode).toBe(404);
    expect((await app.inject({method:'GET',url:`/api/v1/admin/orders?orderNo=${encodeURIComponent(order.orderNo)}`,headers:verifierLookup})).statusCode).toBe(403);
    expect((await app.inject({method:'GET',url:'/api/v1/admin/campaigns',headers:verifierLookup})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:operator,payload:{userId:'verifier-lookup',pickupPointId:pointId}})).statusCode).toBe(200);
    expect((await app.inject({method:'GET',url:lookupUrl,headers:verifierLookup})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${plan.id}/book-vehicle`,headers:fulfillment,payload:{vehicleOrderNo:'HL-LOOKUP',driverName:'Test',driverPhone:'13900000000',vehiclePlate:'JI-LOOKUP'}})).statusCode).toBe(200);
    const batch=(await app.inject({method:'POST',url:'/api/v1/admin/dispatch-batches',headers:fulfillment,payload:{campaignId}})).json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/dispatch-batches/${batch}/dispatch`,headers:fulfillment})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/pickup/batches/${batch}/receive`,headers:fulfillment,payload:{deliveryPlanId:plan.id}})).statusCode).toBe(200);
    const lookup=await app.inject({method:'GET',url:lookupUrl,headers:verifierLookup});
    expect(lookup.statusCode,lookup.body).toBe(200);
    expect(lookup.json().data).toEqual(expect.objectContaining({id:orderId,orderNo:order.orderNo,deliveryPlanId:plan.id,status:'READY_FOR_PICKUP'}));
    expect(lookup.json().data.items).toEqual(expect.arrayContaining([expect.objectContaining({skuId:'sku-demo-001',quantity:1})]));
    expect(lookup.json().data).not.toHaveProperty('userId');
    expect((await app.inject({method:'GET',url:`/api/v1/pickup/orders/lookup?deliveryPlanId=wrong-plan&orderNo=${encodeURIComponent(order.orderNo)}`,headers:verifierLookup})).statusCode).toBe(404);
    const plans=await app.inject({method:'GET',url:'/api/v1/pickup/delivery-plans',headers:verifierLookup});
    expect(plans.statusCode,plans.body).toBe(200);
    expect(plans.json().data.map((item:{id:string})=>item.id)).toContain(plan.id);
    expect(plans.json().data.every((item:{pickupPointId:string})=>item.pickupPointId===pointId)).toBe(true);
    expect((await app.inject({method:'GET',url:'/api/v1/admin/delivery-plans',headers:verifierLookup})).statusCode).toBe(403);
  });

  it('manages verifier point grants through the admin API and rejects cross-point verification',async()=>{
    const now=new Date().toISOString();
    const alternatePointId='pickup-demo-002';
    await store.saveUser({id:'verifier-1',wechatOpenId:null,status:'ACTIVE',createdAt:now});
    await store.saveUser({id:'blocked-verifier',wechatOpenId:null,status:'BLOCKED',createdAt:now});
    await store.savePickupPoint({id:alternatePointId,serviceAreaId:'service-bd-lianchi',name:'Alternate pickup point',address:'Test Road 99',status:'ACTIVE',capacityPerDay:100,createdAt:now});
    await store.savePickupPoint({id:'pickup-suspended',serviceAreaId:'service-bd-lianchi',name:'Suspended pickup point',address:'Test Road 100',status:'SUSPENDED',capacityPerDay:100,createdAt:now});
    const alternateAssignment={userId:'verifier-1',pickupPointId:alternatePointId};
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:customer,payload:alternateAssignment})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:pickupManager,payload:{userId:'missing-verifier',pickupPointId:pointId}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:pickupManager,payload:{userId:'blocked-verifier',pickupPointId:pointId}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:pickupManager,payload:{userId:'verifier-1',pickupPointId:'pickup-suspended'}})).statusCode).toBe(403);
    const alternateGrant=await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:operator,payload:alternateAssignment});
    expect(alternateGrant.statusCode,alternateGrant.body).toBe(200);
    expect(alternateGrant.json().data).toMatchObject({...alternateAssignment,active:true,changed:true});
    const listed=await app.inject({method:'GET',url:'/api/v1/admin/pickup-verifier-assignments?userId=verifier-1',headers:operator});
    expect(listed.statusCode,listed.body).toBe(200);
    expect(listed.json().data).toEqual(expect.arrayContaining([expect.objectContaining({...alternateAssignment,action:'GRANTED'})]));

    const campaignId=await createCampaign();const orderId=await createOrder(campaignId);await pay(orderId);await close(campaignId);
    const plan=await store.getDeliveryPlanByCampaign(campaignId);if(!plan)throw new Error('expected delivery plan');const planId=plan.id;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${planId}/book-vehicle`,headers:fulfillment,payload:{vehicleOrderNo:'HL-POINT-GRANT-API',driverName:'Test',driverPhone:'13900000000',vehiclePlate:'JI-F12345'}})).statusCode).toBe(200);
    const batch=await app.inject({method:'POST',url:'/api/v1/admin/dispatch-batches',headers:fulfillment,payload:{campaignId}});const batchId=batch.json().data.id as string;
    await app.inject({method:'POST',url:`/api/v1/admin/dispatch-batches/${batchId}/dispatch`,headers:fulfillment});
    await app.inject({method:'POST',url:`/api/v1/pickup/batches/${batchId}/receive`,headers:fulfillment,payload:{deliveryPlanId:planId}});
    const code=(await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer})).json().data.code as string;
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:verifier,payload:{orderId,deliveryPlanId:planId,code}})).statusCode).toBe(403);
    const planAssignment={userId:'verifier-1',pickupPointId:pointId};
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:operator,payload:planAssignment})).json().data).toMatchObject({active:true,changed:true});
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/revoke',headers:pickupManager,payload:planAssignment})).statusCode).toBe(403);
    const revoked=await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/revoke',headers:operator,payload:planAssignment});
    expect(revoked.statusCode,revoked.body).toBe(200);
    expect(revoked.json().data).toMatchObject({...planAssignment,active:false,changed:true});
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:verifier,payload:{orderId,deliveryPlanId:planId,code}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:operator,payload:planAssignment})).json().data).toMatchObject({active:true,changed:true});
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:verifier,payload:{orderId,deliveryPlanId:planId,code}})).statusCode).toBe(200);
    expect((await store.listAuditLogs(20)).filter((item)=>item.resourceType==='PICKUP_VERIFIER_ASSIGNMENT').map((item)=>item.action)).toEqual(expect.arrayContaining(['PICKUP_VERIFIER_POINT_GRANTED','PICKUP_VERIFIER_POINT_REVOKED']));
  });

  it('does not let a pickup manager mutate point grants or confirm batch arrival',async()=>{
    await store.saveUser({id:'verifier-restricted-manager',wechatOpenId:null,status:'ACTIVE',createdAt:new Date().toISOString()});
    const campaignId=await createCampaign();const orderId=await createOrder(campaignId);await pay(orderId);await close(campaignId);
    const plan=await store.getDeliveryPlanByCampaign(campaignId);if(!plan)throw new Error('expected delivery plan');
    expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${plan.id}/book-vehicle`,headers:fulfillment,payload:{vehicleOrderNo:'HL-MANAGER-DENIED',driverName:'Test',driverPhone:'13900000000',vehiclePlate:'JI-MANAGER'}})).statusCode).toBe(200);
    const batch=(await app.inject({method:'POST',url:'/api/v1/admin/dispatch-batches',headers:fulfillment,payload:{campaignId}})).json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/dispatch-batches/${batch}/dispatch`,headers:fulfillment})).statusCode).toBe(200);
    const grantPayload={userId:'verifier-restricted-manager',pickupPointId:pointId};
    expect((await app.inject({method:'GET',url:'/api/v1/admin/pickup-verifier-assignments',headers:pickupManager})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:pickupManager,payload:grantPayload})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:`/api/v1/pickup/batches/${batch}/receive`,headers:pickupManager,payload:{deliveryPlanId:plan.id}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:`/api/v1/pickup/batches/${batch}/receive`,headers:fulfillment,payload:{deliveryPlanId:plan.id}})).statusCode).toBe(200);
  });

  it('blocks inactive verifier and pickup point verification, including SuperAdmin, while allowing deactivation cleanup',async()=>{
    const now=new Date().toISOString();
    const superAdmin={'x-demo-user-id':'demo-super-admin','x-demo-role':'SUPER_ADMIN'};
    await store.saveUser({id:'verifier-active-check',wechatOpenId:null,status:'ACTIVE',createdAt:now});
    const campaignId=await createCampaign();const orderId=await createOrder(campaignId);await pay(orderId);await close(campaignId);
    const plan=await store.getDeliveryPlanByCampaign(campaignId);if(!plan)throw new Error('expected delivery plan');const planId=plan.id;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/delivery-plans/${planId}/book-vehicle`,headers:fulfillment,payload:{vehicleOrderNo:'HL-ACTIVE-CHECK',driverName:'Test',driverPhone:'13900000000',vehiclePlate:'JI-ACTIVE'}})).statusCode).toBe(200);
    const batch=await app.inject({method:'POST',url:'/api/v1/admin/dispatch-batches',headers:fulfillment,payload:{campaignId}});const batchId=batch.json().data.id as string;
    expect((await app.inject({method:'POST',url:`/api/v1/admin/dispatch-batches/${batchId}/dispatch`,headers:fulfillment})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/pickup/batches/${batchId}/receive`,headers:fulfillment,payload:{deliveryPlanId:planId}})).statusCode).toBe(200);
    const code=(await app.inject({method:'GET',url:`/api/v1/pickup-code?orderId=${orderId}`,headers:customer})).json().data.code as string;
    const assignment={userId:'verifier-active-check',pickupPointId:pointId};
    const lookupUrl=`/api/v1/pickup/orders/lookup?deliveryPlanId=${encodeURIComponent(planId)}&orderNo=${encodeURIComponent((await store.getOrder(orderId))!.orderNo)}`;
    expect((await app.inject({method:'GET',url:lookupUrl,headers:superAdmin})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:superAdmin,payload:{orderId,deliveryPlanId:planId,code}})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:operator,payload:assignment})).statusCode).toBe(200);
    const pickupPoint=(await store.listPickupPoints()).find((item)=>item.id===pointId);if(!pickupPoint)throw new Error('expected pickup point');
    await store.savePickupPoint({...pickupPoint,status:'SUSPENDED'});
    const verifierHeaders={'x-demo-user-id':'verifier-active-check','x-demo-role':'PICKUP_VERIFIER'};
    const verifyPayload={orderId,deliveryPlanId:planId,code};
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:verifierHeaders,payload:verifyPayload})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:superAdmin,payload:verifyPayload})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/revoke',headers:operator,payload:assignment})).json().data).toMatchObject({active:false,changed:true});
    await store.savePickupPoint({...pickupPoint,status:'ACTIVE'});
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/grant',headers:operator,payload:assignment})).statusCode).toBe(200);
    await store.saveUser({id:'verifier-active-check',wechatOpenId:null,status:'BLOCKED',createdAt:now});
    expect((await app.inject({method:'POST',url:'/api/v1/pickup/verify',headers:verifierHeaders,payload:verifyPayload})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/admin/pickup-verifier-assignments/revoke',headers:operator,payload:assignment})).json().data).toMatchObject({active:false,changed:true});
  });
});
