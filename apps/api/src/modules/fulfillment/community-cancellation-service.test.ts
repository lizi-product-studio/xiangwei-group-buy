import { describe, expect, it } from 'vitest';
import { moneyCents } from '@hometown/domain';
import { LedgerService } from '../finance/ledger-service.js';
import { MemoryStore } from '../core/store.js';
import type { Campaign, Order, Payment } from '../core/types.js';
import { NotificationService } from '../notifications/notification-service.js';
import { MockPaymentProvider } from '../payments/payment-provider.js';
import { PaymentService } from '../payments/payment-service.js';
import { CommunityOperationsService } from './community-operations-service.js';

const now='2027-02-01T00:00:00.000Z';

async function seed(store:MemoryStore,id:string,status:Order['status'],cutoffAt:string){
  const campaign:Campaign={id:`campaign-${id}`,title:'社区取消测试团',serviceAreaId:'area',warehouseId:null,cutoffAt,dispatchAt:'2027-02-02T00:00:00.000Z',minTotalQuantity:1,failureAction:'CANCEL_AND_REFUND',businessModelVersion:'PLATFORM_COMMUNITY',skuIds:[],items:[],platformItems:[],communityItems:[],status:'LOCKED',version:1,createdAt:now};
  const order:Order={id,orderNo:`CANCEL-${id}`,userId:'customer',campaignId:campaign.id,serviceAreaId:'area',pickupPointId:'point',deliveryPlanId:'plan',businessModelVersion:'PLATFORM_COMMUNITY',paymentRoute:'PLATFORM_DIRECT',status,totalCents:moneyCents(1200),commissionCents:moneyCents(0),items:[],merchantOrders:[],createdAt:now,expiresAt:now,paidAt:now,pickedUpAt:null};
  const payment:Payment={id:`payment-${id}`,orderId:id,provider:'mock',paymentRoute:'PLATFORM_DIRECT',providerPaymentId:'provider-payment',status:'SUCCEEDED',amountCents:moneyCents(1200),clientPayload:null,providerContext:null,initiationLeaseUntil:null,initiationClaimToken:null,createdAt:now,succeededAt:now};
  await store.saveCampaign(campaign);await store.saveOrder(order);await store.savePayment(payment);
}

function service(store:MemoryStore){const notifications=new NotificationService(store,{send:async()=>undefined});const payments=new PaymentService(store,new MockPaymentProvider(),new LedgerService(),notifications);return new CommunityOperationsService(store,payments,notifications);}
class FlakyRefundProvider extends MockPaymentProvider { private attempts=0; public override async refund(){this.attempts+=1;return this.attempts===1?{providerRefundId:null,status:'FAILED' as const}:{providerRefundId:'recovered-provider-refund',status:'SUCCEEDED' as const};} public override async queryRefund(){return{providerRefundId:'recovered-provider-refund',status:'SUCCEEDED' as const};} }

describe('CommunityOperationsService paid cancellation',()=>{
  it('direct-refunds before cutoff once and recovers the request final fact idempotently',async()=>{
    const store=new MemoryStore(false);await seed(store,'direct','PAID_WAITING_CLOSE','2027-02-02T00:00:00.000Z');const operations=service(store);
    const first=await operations.requestCancellation('direct','customer','截单前不再需要','cancel-direct-1');const repeat=await operations.requestCancellation('direct','customer','重复点击不改变申请','cancel-direct-2');
    expect(first).toMatchObject({status:'DIRECT_REFUNDING'});expect(repeat.id).toBe(first.id);expect(await store.getOrder('direct')).toMatchObject({status:'REFUNDED'});expect(await store.getPaymentByOrder('direct')).toMatchObject({status:'REFUNDED'});
    expect(await operations.reconcileCancellationRefunds()).toBe(1);expect(await store.getCommunityCancellationRequestByOrderForUpdate('direct')).toMatchObject({status:'REFUNDED',refundId:expect.any(String)});
    expect(await operations.reconcileCancellationRefunds()).toBe(0);
  });

  it('requires post-cutoff review, preserves rejection, and lets finance settle an approved request',async()=>{
    const store=new MemoryStore(false);await seed(store,'rejected','LOCKED','2027-01-31T00:00:00.000Z');await seed(store,'approved','LOCKED','2027-01-31T00:00:00.000Z');const operations=service(store);
    const requested=await operations.requestCancellation('rejected','customer','截单后申请','cancel-review-1');expect(requested.status).toBe('PENDING_REVIEW');
    await expect(operations.executeCancellationRefund('rejected','finance','cancel-review-before')).rejects.toMatchObject({code:'INVALID_STATE_TRANSITION'});
    expect(await operations.reviewCancellation('rejected','operator',false,'已进入备货，无法取消','cancel-review-reject')).toMatchObject({status:'REJECTED',reviewedBy:'operator'});expect(await store.getOrder('rejected')).toMatchObject({status:'LOCKED'});
    await operations.requestCancellation('approved','customer','截单后申请','cancel-review-2');expect(await operations.reviewCancellation('approved','operator',true,'同意退款','cancel-review-approve')).toMatchObject({status:'APPROVED_WAITING_FINANCE'});
    const executing=await operations.executeCancellationRefund('approved','finance','cancel-finance-1');expect(executing.status).toBe('REFUNDING');expect((await operations.executeCancellationRefund('approved','finance','cancel-finance-repeat')).status).toBe('REFUNDING');
    expect(await operations.reconcileCancellationRefunds()).toBe(1);expect(await store.getCommunityCancellationRequestByOrderForUpdate('approved')).toMatchObject({status:'REFUNDED',financeExecutedBy:'finance',refundId:expect.any(String)});expect(await store.getOrder('approved')).toMatchObject({status:'REFUNDED'});expect(await store.getPaymentByOrder('approved')).toMatchObject({status:'REFUNDED'});
  });

  it('keeps a failed direct refund recoverable with the same cancellation request and provider refund fact',async()=>{
    const store=new MemoryStore(false);await seed(store,'recover','PAID_WAITING_CLOSE','2027-02-02T00:00:00.000Z');const notifications=new NotificationService(store,{send:async()=>undefined});const operations=new CommunityOperationsService(store,new PaymentService(store,new FlakyRefundProvider(),new LedgerService(),notifications),notifications);
    const request=await operations.requestCancellation('recover','customer','支付通道稍后重试','cancel-recover-1');expect(request.status).toBe('DIRECT_REFUNDING');expect(await store.getOrder('recover')).toMatchObject({status:'REFUNDING'});const failed=await store.getPlatformRefundByOrder('recover');expect(failed).toMatchObject({status:'FAILED'});
    expect(await operations.reconcileCancellationRefunds()).toBe(0);const recovered=await store.getPlatformRefundByOrder('recover');expect(recovered).toMatchObject({id:failed?.id,status:'SUCCEEDED'});
    expect(await operations.reconcileCancellationRefunds()).toBe(1);expect(await store.getCommunityCancellationRequestByOrderForUpdate('recover')).toMatchObject({id:request.id,status:'REFUNDED',refundId:recovered?.id});expect(await store.getOrder('recover')).toMatchObject({status:'REFUNDED'});expect(await store.getPaymentByOrder('recover')).toMatchObject({status:'REFUNDED'});
  });
});
