import { describe, expect, it } from 'vitest';
import { moneyCents } from '@hometown/domain';
import { MemoryStore } from '../core/store.js';
import { NotificationService } from '../notifications/notification-service.js';
import type { PaymentService } from '../payments/payment-service.js';
import { CommunityOperationsService } from './community-operations-service.js';

const now='2027-01-03T00:00:00.000Z';
const operations=(store:MemoryStore)=>new CommunityOperationsService(store,{} as PaymentService,new NotificationService(store,{send:async()=>undefined}));

async function seed(store:MemoryStore,input:{id:string;quantity:number;picked:number;refunded:number;status:'READY_FOR_PICKUP'|'PICKED_UP'|'REFUNDED';windowStatus:'EXPIRED_PENDING'|'REFUND_PENDING';paymentStatus:'SUCCEEDED'|'REFUNDED';credentialStatus:'ACTIVE'|'USED'|'REVOKED';refundStatus?:'FAILED'|'SUCCEEDED'}){
  const amount=input.quantity*100;
  await store.saveOrder({id:input.id,orderNo:`OVERDUE-${input.id}`,userId:'customer',campaignId:'campaign',serviceAreaId:'area',pickupPointId:'point',deliveryPlanId:'plan',businessModelVersion:'PLATFORM_COMMUNITY',paymentRoute:'PLATFORM_DIRECT',status:input.status,totalCents:moneyCents(amount),commissionCents:moneyCents(0),items:[],merchantOrders:[],createdAt:now,expiresAt:now,paidAt:now,pickedUpAt:input.picked?now:null});
  await store.saveSalesOrderItems(input.id,[{id:`line-${input.id}`,platformSkuId:'sku',productId:'product',title:'测试商品',skuName:'一份',quantity:input.quantity,unitPriceCents:100,purchaseUnitCents:0,amountCents:amount}]);
  await store.updatePlatformSalesLine({id:`line-${input.id}`,orderId:input.id,platformSkuId:'sku',quantity:input.quantity,unitPriceCents:moneyCents(100),purchaseUnitCents:moneyCents(0),amountCents:moneyCents(amount),fulfilledQuantity:input.quantity,pickedUpQuantity:input.picked,exceptionQuantity:0,refundedQuantity:input.refunded,refundedAmountCents:moneyCents(input.refunded*100),paidAt:now});
  await store.savePayment({id:`payment-${input.id}`,orderId:input.id,provider:'mock',paymentRoute:'PLATFORM_DIRECT',providerPaymentId:'provider-payment',status:input.paymentStatus,amountCents:moneyCents(amount),clientPayload:null,providerContext:null,initiationLeaseUntil:null,initiationClaimToken:null,createdAt:now,succeededAt:now});
  const exceptionId=`exception-${input.id}`;
  await store.saveCommunityPickupWindow({orderId:input.id,deliveryPlanId:'plan',arrivedAt:'2026-12-31T00:00:00.000Z',deadlineAt:'2027-01-01T00:00:00.000Z',status:input.windowStatus,extensionCount:0,extendedBy:null,extendedAt:null,dispositionBy:'operator',dispositionAt:now,dispositionNote:'逾期待处理',refundExceptionId:input.windowStatus==='REFUND_PENDING'?exceptionId:null,lossExceptionId:null});
  await store.savePickupCredential({orderId:input.id,codeHash:'hash',status:input.credentialStatus,expiresAt:'2027-01-01T00:00:00.000Z'});
  if(input.windowStatus==='REFUND_PENDING')await store.savePlatformPartialRefund({id:`refund-${input.id}`,exceptionId,orderId:input.id,paymentId:`payment-${input.id}`,providerRefundNo:`provider-refund-${input.id}`,providerRefundId:input.refundStatus==='SUCCEEDED'?'provider-refund-id':null,status:input.refundStatus??'SUCCEEDED',amountCents:moneyCents((input.quantity-input.picked)*100),createdAt:now,submissionLeaseUntil:null,submissionClaimToken:null});
}

describe('CommunityOperationsService overdue pickup closure',()=>{
  it('preserves a zero-picked full refund as REFUNDED rather than cancelling it',async()=>{
    const store=new MemoryStore(false);await seed(store,{id:'full-refund',quantity:1,picked:0,refunded:1,status:'REFUNDED',windowStatus:'REFUND_PENDING',paymentStatus:'REFUNDED',credentialStatus:'REVOKED',refundStatus:'SUCCEEDED'});
    expect(await operations(store).reconcileExpiredPickupRefunds()).toBe(1);
    expect(await store.getOrder('full-refund')).toMatchObject({status:'REFUNDED'});expect(await store.getPaymentByOrder('full-refund')).toMatchObject({status:'REFUNDED'});expect(await store.getCommunityPickupWindowForUpdate('full-refund')).toMatchObject({status:'CLOSED'});expect(await store.getPickupCredential('full-refund')).toMatchObject({status:'REVOKED'});
  });

  it('closes a partially-picked partial refund as completed while retaining payment and item facts',async()=>{
    const store=new MemoryStore(false);await seed(store,{id:'partial-refund',quantity:2,picked:1,refunded:1,status:'READY_FOR_PICKUP',windowStatus:'REFUND_PENDING',paymentStatus:'SUCCEEDED',credentialStatus:'REVOKED',refundStatus:'SUCCEEDED'});
    expect(await operations(store).reconcileExpiredPickupRefunds()).toBe(1);
    expect(await store.getOrder('partial-refund')).toMatchObject({status:'COMPLETED'});expect(await store.getPaymentByOrder('partial-refund')).toMatchObject({status:'SUCCEEDED'});expect((await store.listPlatformSalesLinesByOrderForUpdate('partial-refund'))[0]).toMatchObject({pickedUpQuantity:1,refundedQuantity:1});expect(await store.getCommunityPickupWindowForUpdate('partial-refund')).toMatchObject({status:'CLOSED'});expect(await store.getPickupCredential('partial-refund')).toMatchObject({status:'REVOKED'});
  });

  it('closes a partially-picked loss as completed and records one mutually exclusive shortage quantity',async()=>{
    const store=new MemoryStore(false);await seed(store,{id:'partial-loss',quantity:2,picked:1,refunded:0,status:'READY_FOR_PICKUP',windowStatus:'EXPIRED_PENDING',paymentStatus:'SUCCEEDED',credentialStatus:'ACTIVE'});
    await expect(operations(store).disposeExpiredPickup('partial-loss','operator','LOSS','客户逾期未领取剩余商品','loss-1')).resolves.toMatchObject({status:'CLOSED'});
    const [loss]=await store.listFulfillmentExceptions();const [item]=loss?.items??[];
    expect(await store.getOrder('partial-loss')).toMatchObject({status:'COMPLETED'});expect(await store.getPaymentByOrder('partial-loss')).toMatchObject({status:'SUCCEEDED'});expect(await store.getPickupCredential('partial-loss')).toMatchObject({status:'REVOKED'});expect(item).toMatchObject({expectedQuantity:1,acceptedQuantity:0,rejectedQuantity:0,shortQuantity:1,damagedQuantity:0});expect((item?.acceptedQuantity??0)+(item?.rejectedQuantity??0)+(item?.shortQuantity??0)+(item?.damagedQuantity??0)).toBe(item?.expectedQuantity);
  });

  it('refuses overdue disposition when every fulfilled item was already picked up',async()=>{
    const store=new MemoryStore(false);await seed(store,{id:'all-picked',quantity:1,picked:1,refunded:0,status:'PICKED_UP',windowStatus:'EXPIRED_PENDING',paymentStatus:'SUCCEEDED',credentialStatus:'USED'});
    await expect(operations(store).disposeExpiredPickup('all-picked','operator','LOSS','不应产生处置','loss-2')).rejects.toMatchObject({code:'INVALID_STATE_TRANSITION'});
    expect(await store.getOrder('all-picked')).toMatchObject({status:'PICKED_UP'});expect(await store.getCommunityPickupWindowForUpdate('all-picked')).toMatchObject({status:'EXPIRED_PENDING'});expect(await store.getPickupCredential('all-picked')).toMatchObject({status:'USED'});
  });
});
