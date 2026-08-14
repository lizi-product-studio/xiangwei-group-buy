import { randomUUID } from 'node:crypto';
import { BusinessError, transitionOrder } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { Payment, PlatformPartialRefund, PlatformRefund, Refund, Settlement } from '../core/types.js';
import type { PaymentNotification, PaymentProvider, RefundNotification, RefundRequest } from './payment-provider.js';
import type { LedgerService } from '../finance/ledger-service.js';
import type { NotificationService } from '../notifications/notification-service.js';

interface ProviderSubOrder {merchantOrderId:string;subMchid:string|null;outTradeNo:string;amountCents:number;transactionId?:string}
interface PartialRefundAuditContext {actorId:string;requestId:string;confirmationNote:string}
const refundSubmissionLeaseMilliseconds = 5 * 60_000;
const paymentInitiationLeaseMilliseconds = 2 * 60_000;
const paymentInitiationPollAttempts = 6;
const paymentInitiationPollDelayMilliseconds = 50;

export class PaymentService {
  public constructor(private readonly store:CommerceStore,private readonly provider:PaymentProvider,private readonly ledger:LedgerService,private readonly notifications?:NotificationService){}

  public async initiate(orderId:string,userId:string):Promise<{provider:Payment['provider'];clientPayload:Record<string,string>;status:Payment['status']} >{
    const order=await this.store.getOrder(orderId);
    if(!order)throw new BusinessError('RESOURCE_NOT_FOUND','订单不存在',404);
    if(order.userId!==userId)throw new BusinessError('FORBIDDEN','无权支付该订单',403);
    if(order.status==='PENDING_PAYMENT'&&Date.parse(order.expiresAt)<=Date.now())throw new BusinessError('INVALID_STATE_TRANSITION','订单已超过支付时限',409);
    if(order.status!=='PENDING_PAYMENT'&&order.status!=='PAID_WAITING_CLOSE')throw new BusinessError('INVALID_STATE_TRANSITION','订单当前不可支付',409);
    const existing=await this.store.getPaymentByOrder(order.id);
    const available=this.paymentInitiationResult(existing);
    if(available)return available;
    const user=await this.store.getUser(userId);
    const merchantIds=new Set(order.merchantOrders.map((item)=>item.merchantId));
    const merchants=order.paymentRoute==='LEGACY_COMBINE'?(await this.store.listMerchants()).filter((merchant)=>merchantIds.has(merchant.id)):[];
    const now=Date.now();const claimToken=randomUUID();
    const placeholder:Payment=existing??{id:randomUUID(),orderId:order.id,provider:this.provider.name,paymentRoute:order.paymentRoute,providerPaymentId:null,status:'CREATED',amountCents:order.totalCents,clientPayload:null,providerContext:null,initiationLeaseUntil:null,initiationClaimToken:null,createdAt:new Date(now).toISOString(),succeededAt:null};
    const claimed=await this.store.claimPaymentInitiation(placeholder,new Date(now+paymentInitiationLeaseMilliseconds).toISOString(),new Date(now).toISOString(),claimToken);
    if(!claimed){
      const completed=await this.waitForPaymentInitiation(order.id);
      if(completed)return completed;
      throw new BusinessError('CONCURRENT_MODIFICATION','支付正在创建，请勿重复提交；请稍后刷新订单后继续支付',409);
    }
    const claimedPayment=await this.store.getPaymentByOrder(order.id);
    if(!claimedPayment||claimedPayment.initiationClaimToken!==claimToken){
      const completed=await this.waitForPaymentInitiation(order.id);
      if(completed)return completed;
      throw new BusinessError('CONCURRENT_MODIFICATION','支付正在创建，请稍后刷新订单后继续支付',409);
    }
    // The durable claim is committed before this network call. A crash leaves a
    // short lease; a later customer retry can safely reclaim the same order.
    const initiated=await this.provider.initiate(order,user?.wechatOpenId??null,merchants);
    const payment:Payment={...claimedPayment,provider:this.provider.name,providerPaymentId:initiated.providerPaymentId,status:'CREATED',amountCents:order.totalCents,clientPayload:initiated.clientPayload,providerContext:initiated.providerContext,initiationLeaseUntil:null,initiationClaimToken:null};
    if(await this.store.savePaymentIfInitiationClaimed(payment,claimToken))return{provider:payment.provider,clientPayload:initiated.clientPayload,status:payment.status};
    const completed=await this.waitForPaymentInitiation(order.id);
    if(completed)return completed;
    throw new BusinessError('CONCURRENT_MODIFICATION','支付请求已被新的处理接管，请稍后刷新订单后继续支付',409);
  }

  public async confirmMock(orderId:string,userId:string):Promise<Payment>{
    if(this.provider.name!=='mock')throw new BusinessError('FORBIDDEN','当前环境未启用模拟支付',403);
    await this.initiate(orderId,userId);
    return this.store.transaction(async(store)=>{
      const order=await store.getOrder(orderId);if(!order)throw new BusinessError('RESOURCE_NOT_FOUND','订单不存在',404);
      if(order.userId!==userId)throw new BusinessError('FORBIDDEN','无权支付该订单',403);
      const payment=await store.getPaymentByOrder(orderId);if(!payment)throw new BusinessError('RESOURCE_NOT_FOUND','支付单不存在',404);
      if(payment.status==='SUCCEEDED')return payment;
      if(order.status!=='PENDING_PAYMENT')throw new BusinessError('INVALID_STATE_TRANSITION','订单当前不可支付',409);
      const paidAt=new Date().toISOString();
      if(!(await store.markPendingOrderPaid(order.id,paidAt))){
        const latest=await store.getOrder(order.id);const latestPayment=await store.getPaymentByOrder(order.id);
        if(latest?.status==='PAID_WAITING_CLOSE'&&latestPayment?.status==='SUCCEEDED')return latestPayment;
        throw new BusinessError('INVALID_STATE_TRANSITION',latest?.status==='CANCELLED'?'订单已取消，不能支付':'订单当前不可支付',409);
      }
      order.status=transitionOrder(order.status,'PAID_WAITING_CLOSE');order.paidAt=paidAt;
      payment.status='SUCCEEDED';payment.providerPaymentId=`MOCK-${order.orderNo}`;payment.succeededAt=order.paidAt;
      await store.savePayment(payment);await this.ledger.recordPayment(store,order);
      return payment;
    });
  }

  public async handleNotification(notification:PaymentNotification):Promise<void>{
    let lateRefundOrderId:string|null=null;
    await this.store.transaction(async(store)=>{
      if(notification.type!=='COMBINE_TRANSACTION.SUCCESS'&&notification.type!=='TRANSACTION.SUCCESS')throw new BusinessError('VALIDATION_ERROR','不支持的支付通知类型',400);
      const order=await store.getOrderByNoForUpdate(notification.orderNo);if(!order)throw new BusinessError('RESOURCE_NOT_FOUND','支付通知对应订单不存在',404);
      const expectedNotificationType=order.paymentRoute==='PLATFORM_DIRECT'?'TRANSACTION.SUCCESS':'COMBINE_TRANSACTION.SUCCESS';
      if(notification.type!==expectedNotificationType)throw new BusinessError('VALIDATION_ERROR','支付通知类型与订单支付路由不一致',409);
      if(Number(order.totalCents)!==notification.amountCents)throw new BusinessError('VALIDATION_ERROR','支付通知金额与订单不一致',409);
      let payment=await store.getPaymentByOrderForUpdate(order.id);
      payment??={id:randomUUID(),orderId:order.id,provider:this.provider.name,paymentRoute:order.paymentRoute,providerPaymentId:null,status:'CREATED',amountCents:order.totalCents,clientPayload:null,providerContext:null,initiationLeaseUntil:null,initiationClaimToken:null,createdAt:new Date().toISOString(),succeededAt:null};
      // INSERT IGNORE is the idempotency fence: concurrent delivery of the same
      // provider event becomes a successful no-op rather than a unique-key error.
      if(!(await store.claimPaymentCallback(this.provider.name,notification.eventId,notification.type,notification.bodyHash)))return;
      if(payment.status==='CREATED'||payment.status==='FAILED'){
        if(order.status==='PENDING_PAYMENT'){
          const paidAt=new Date().toISOString();
          if(!(await store.markPendingOrderPaid(order.id,paidAt))){
            const latest=await store.getOrder(order.id);
            if(latest?.status==='CANCELLED'){
              if(!(await store.transitionOrderStatus(order.id,['CANCELLED'],'REFUNDING',paidAt)))throw new BusinessError('CONCURRENT_MODIFICATION','订单状态已被其他操作更新，请重试',409);
              order.status='REFUNDING';order.paidAt=paidAt;lateRefundOrderId=order.id;
            }else throw new BusinessError('INVALID_STATE_TRANSITION','订单状态与支付通知不一致',409);
          }else{order.status=transitionOrder(order.status,'PAID_WAITING_CLOSE');order.paidAt=paidAt;}
        }else if(order.status==='CANCELLED'){
          const paidAt=new Date().toISOString();
          if(!(await store.transitionOrderStatus(order.id,['CANCELLED'],'REFUNDING',paidAt)))throw new BusinessError('CONCURRENT_MODIFICATION','订单状态已被其他操作更新，请重试',409);
          order.status='REFUNDING';order.paidAt=paidAt;lateRefundOrderId=order.id;
        } else if(['LOCKED','ALLOCATING','IN_TRANSIT','READY_FOR_PICKUP','PICKED_UP','COMPLETED','REFUNDING','REFUNDED'].includes(order.status)) {
          // A campaign terminal transition won the race. Persist the provider success and refund it; never overwrite the order state.
          lateRefundOrderId=order.status==='REFUNDED'?null:order.id;
          if(lateRefundOrderId && !(await store.transitionOrderStatus(order.id,[order.status],'REFUNDING',new Date().toISOString()))) throw new BusinessError('CONCURRENT_MODIFICATION','订单状态已被其他操作更新，请重试',409);
          if(lateRefundOrderId) order.status='REFUNDING';
        } else throw new BusinessError('INVALID_STATE_TRANSITION','订单状态与支付通知不一致',409);
        payment.status='SUCCEEDED';payment.providerPaymentId=notification.providerPaymentId;payment.succeededAt=order.paidAt;
        if(order.paymentRoute==='LEGACY_COMBINE'){
          if(!payment.providerContext){const merchants=new Map((await store.listMerchants()).map((item)=>[item.id,item]));payment.providerContext={subOrders:order.merchantOrders.map((item,index)=>{const outTradeNo=`${order.orderNo}${String(index+1).padStart(2,'0')}`.slice(0,32);return{merchantOrderId:item.id,subMchid:merchants.get(item.merchantId)?.wechatSubMchid??null,outTradeNo,amountCents:Number(item.itemAmountCents)};})};}
          const subOrders=this.subOrders(payment).map((item)=>({...item,transactionId:notification.subTransactions.find((transaction)=>transaction.outTradeNo===item.outTradeNo)?.transactionId??item.transactionId}));
          payment.providerContext={...payment.providerContext,subOrders};
        }else payment.providerContext={...(payment.providerContext??{}),paymentRoute:'PLATFORM_DIRECT',outTradeNo:order.orderNo};
        await store.savePayment(payment);await this.ledger.recordPayment(store,order);
      }else if(payment.status==='SUCCEEDED'&&order.status==='CANCELLED'){
        if(await store.transitionOrderStatus(order.id,['CANCELLED'],'REFUNDING',new Date().toISOString()))lateRefundOrderId=order.id;
      }
    });
    if(lateRefundOrderId)await this.refundOrder(lateRefundOrderId);
  }

  public async refundOrder(orderId:string):Promise<void>{
    const model=await this.store.getOrder(orderId);
    if(model?.businessModelVersion==='PLATFORM_PROCUREMENT'){await this.refundPlatformOrder(orderId);return;}
    const refunds=await this.store.transaction(async(store)=>{
      const order=await store.getOrderForUpdate(orderId);if(!order)throw new BusinessError('RESOURCE_NOT_FOUND','订单不存在',404);
      if(order.status==='REFUNDED')return[];
      if(order.status!=='REFUNDING')throw new BusinessError('INVALID_STATE_TRANSITION','订单当前不可退款',409);
      const payment=await store.getPaymentByOrderForUpdate(orderId);if(!payment)throw new BusinessError('INVALID_STATE_TRANSITION','订单没有可退款的成功支付单',409);
      if(payment.status==='REFUNDED')return await store.listRefundsByOrder(orderId);
      if(payment.status==='SUCCEEDED'){
        payment.status='REFUNDING';
        if(!(await store.savePaymentIfStatus(payment,['SUCCEEDED'])))return await store.listRefundsByOrder(orderId);
      } else if(payment.status!=='REFUNDING') throw new BusinessError('INVALID_STATE_TRANSITION','订单没有可退款的成功支付单',409);
      const existing=await store.listRefundsByOrder(orderId);if(existing.length)return existing;
      const subOrders=this.subOrders(payment);
      if(subOrders.length!==order.merchantOrders.length)throw new BusinessError('VALIDATION_ERROR','支付子单与商户订单不一致，暂停自动退款',409);
      const now=new Date().toISOString();const created:Refund[]=[];
      for(const [index,merchantOrder] of order.merchantOrders.entries()){
        const subOrder=subOrders.find((item)=>item.merchantOrderId===merchantOrder.id);if(!subOrder)throw new BusinessError('VALIDATION_ERROR','退款缺少支付子单信息',409);
        const refund:Refund={id:randomUUID(),orderId,paymentId:payment.id,merchantOrderId:merchantOrder.id,providerRefundNo:`RF${order.orderNo}${String(index+1).padStart(2,'0')}`.slice(0,64),providerRefundId:null,status:'CREATED',amountCents:merchantOrder.itemAmountCents,createdAt:now,submissionLeaseUntil:null,submissionClaimToken:null};
        await store.saveRefund(refund);created.push(refund);
      }
      return created;
    });
    // Existing PROCESSING work is deliberately left to reconcileRefunds(),
    // where its provider status is queried before any replay is attempted.
    for(const refund of refunds)if(refund.status==='CREATED'||refund.status==='FAILED')await this.submitRefund(refund);
    await this.finalizeRefund(orderId);
  }

  public async requestFullRefund(orderId:string):Promise<void>{
    await this.store.transaction(async(store)=>{
      const order=await store.getOrderForUpdate(orderId);if(!order)throw new BusinessError('RESOURCE_NOT_FOUND','订单不存在',404);
      if(order.businessModelVersion==='PLATFORM_PROCUREMENT')throw new BusinessError('PARTIAL_REFUND_NOT_SUPPORTED','模式 B 订单只能由已确认履约异常触发退款，不能使用历史整单退款入口',409);
      if(order.status==='REFUNDED'||order.status==='REFUNDING')return;
      if(!['PAID_WAITING_CLOSE','LOCKED','ALLOCATING','IN_TRANSIT','READY_FOR_PICKUP','PICKED_UP'].includes(order.status))throw new BusinessError('INVALID_STATE_TRANSITION','订单当前不可发起退款',409);
      const stockShouldBeReleased=order.status!=='PICKED_UP';
      order.status=transitionOrder(order.status,'REFUNDING');await store.saveOrderStatus(order);
      if(stockShouldBeReleased)for(const item of order.items){const released=await store.releaseCampaignSkuStock(order.campaignId,item.skuId,item.quantity);if(!released)throw new BusinessError('INVENTORY_INCONSISTENT','退款订单可售数量释放失败',500,{orderId:order.id,skuId:item.skuId});}
    });
    await this.refundOrder(orderId);
  }

  public async handleRefundNotification(notification:RefundNotification):Promise<void>{
    let orderId:string|null=null; let partialRefundId:string|null=null;
    await this.store.transaction(async(store)=>{
      const platformRefund=await store.getPlatformRefundByProviderNo(notification.providerRefundNo);
      if(platformRefund){
        const order=await store.getOrder(platformRefund.orderId);if(!order||order.paymentRoute!=='PLATFORM_DIRECT')throw new BusinessError('VALIDATION_ERROR','退款路由与订单版本不一致',409);
        if(!(await store.claimPaymentCallback(this.provider.name,notification.eventId,notification.type,notification.bodyHash)))return;
        if(platformRefund.status==='SUCCEEDED')return;
        const saved=await store.savePlatformRefundIfStatus({...platformRefund,providerRefundId:notification.providerRefundId,status:notification.status,submissionLeaseUntil:null,submissionClaimToken:null},['CREATED','PROCESSING','FAILED']);
        if(saved)orderId=platformRefund.orderId;
        return;
      }
      const partial=await store.getPlatformPartialRefundByProviderNo(notification.providerRefundNo);
      if(partial){
        const order=await store.getOrder(partial.orderId);if(!order||order.paymentRoute!=='PLATFORM_DIRECT')throw new BusinessError('VALIDATION_ERROR','部分退款路由与订单版本不一致',409);
        if(!(await store.claimPaymentCallback(this.provider.name,notification.eventId,notification.type,notification.bodyHash)))return;
        if(partial.status==='SUCCEEDED')return;
        if(await store.savePlatformPartialRefundIfStatus({...partial,providerRefundId:notification.providerRefundId,status:notification.status,submissionLeaseUntil:null,submissionClaimToken:null},['CREATED','PROCESSING','FAILED']))partialRefundId=partial.id;
        return;
      }
      const refund=await store.getRefundByProviderNo(notification.providerRefundNo);if(!refund)throw new BusinessError('RESOURCE_NOT_FOUND','退款通知对应退款单不存在',404);
      if(!(await store.claimPaymentCallback(this.provider.name,notification.eventId,notification.type,notification.bodyHash)))return;
      if(refund.status==='SUCCEEDED')return;
      // A signed provider callback is authoritative, so it may supersede an
      // in-flight worker and clears that worker's lease/token.
      refund.providerRefundId=notification.providerRefundId;refund.status=notification.status;refund.submissionLeaseUntil=null;refund.submissionClaimToken=null;
      if(await store.saveRefundIfStatus(refund,['CREATED','PROCESSING','FAILED']))orderId=refund.orderId;
    });
    if(partialRefundId)await this.finalizePartialRefund(partialRefundId);
    if(orderId){const order=await this.store.getOrder(orderId);if(order?.businessModelVersion==='PLATFORM_PROCUREMENT')await this.finalizePlatformRefund(orderId);else await this.finalizeRefund(orderId);}
  }

  public async reconcileRefunds(limit=100):Promise<void>{
    // Campaign closure commits REFUNDING before its provider request. Recover any
    // such order first so a process crash cannot strand customer funds.
    for(const order of await this.store.listRefundingOrders(limit)){
      try{await this.refundOrder(order.id);}catch{continue;}
    }
    for(const refund of await this.store.listPendingRefunds(limit)){
      try{
        if(refund.status==='CREATED'||refund.status==='FAILED')await this.submitRefund(refund);
        else await this.reconcileProcessingRefund(refund);
        await this.finalizeRefund(refund.orderId);
      }catch{continue;}
    }
    for(const refund of await this.store.listPendingPlatformRefunds(limit)){
      try{if(refund.status==='CREATED'||refund.status==='FAILED')await this.submitPlatformRefund(refund);else await this.reconcilePlatformRefund(refund);await this.finalizePlatformRefund(refund.orderId);}catch{continue;}
    }
    for(const refund of await this.store.listPendingPlatformPartialRefunds(limit)){
      try{if(refund.status==='CREATED'||refund.status==='FAILED')await this.submitPlatformPartialRefund(refund);else await this.reconcilePlatformPartialRefund(refund);await this.finalizePartialRefund(refund.id);}catch{continue;}
    }
    // A provider call can persist success immediately before a process crash.
    // Its exception remains the durable recovery index until allocations and
    // the corresponding accounting entry are finalised.
    for(const exception of await this.store.listFulfillmentExceptions('REFUND_PROCESSING')){
      for(const refund of await this.store.listPlatformPartialRefundsByException(exception.id)){
        if(refund.status==='SUCCEEDED')await this.finalizePartialRefund(refund.id);
      }
    }
  }

  public async settleOrder(orderId:string):Promise<void>{
    const settlements=await this.store.transaction(async(store)=>{
      const order=await store.getOrderForUpdate(orderId);if(!order)throw new BusinessError('RESOURCE_NOT_FOUND','订单不存在',404);
      if(order.businessModelVersion!=='LEGACY_MARKETPLACE')throw new BusinessError('INVALID_STATE_TRANSITION','平台采购订单不进入商户分账',409);
      if(!['PICKED_UP','COMPLETED'].includes(order.status))throw new BusinessError('INVALID_STATE_TRANSITION','订单尚未完成自提，不能结算',409);
      const payment=await store.getPaymentByOrderForUpdate(orderId);if(!payment||payment.status!=='SUCCEEDED')throw new BusinessError('INVALID_STATE_TRANSITION','订单没有可结算支付单',409);
      const existing=await store.listSettlements(orderId);if(existing.length)return existing;
      const subOrders=this.subOrders(payment);const now=new Date().toISOString();const created:Settlement[]=[];
      for(const merchantOrder of order.merchantOrders){const subOrder=subOrders.find((item)=>item.merchantOrderId===merchantOrder.id);if(!subOrder)throw new BusinessError('VALIDATION_ERROR','结算缺少微信支付子单信息',409);
        const settlement:Settlement={id:randomUUID(),orderId,paymentId:payment.id,merchantOrderId:merchantOrder.id,outOrderNo:`PS${order.orderNo}${merchantOrder.id.replaceAll('-','').slice(0,6)}`.slice(0,64),providerOrderId:null,status:'CREATED',commissionCents:merchantOrder.commissionCents,merchantReceivableCents:merchantOrder.merchantReceivableCents,createdAt:now};await store.saveSettlement(settlement);created.push(settlement);}
      return created;
    });
    for(const settlement of settlements)if(settlement.status!=='SUCCEEDED')await this.submitSettlement(settlement);
  }
  public async reconcileSettlements(limit=100):Promise<void>{for(const settlement of await this.store.listPendingSettlements(limit)){try{if(settlement.status==='CREATED'||settlement.status==='FAILED')await this.submitSettlement(settlement);else{const result=await this.provider.querySettlement(await this.settlementRequest(settlement));settlement.providerOrderId=result.providerOrderId;settlement.status=result.status;await this.store.saveSettlement(settlement);}}catch{continue;}}}

  public async settleEligiblePickedUpOrders(limit=100,now=Date.now()):Promise<number>{
    const candidates=await this.store.listSettlementEligibleOrders(new Date(now).toISOString(),limit);
    let settled=0;
    for(const order of candidates){
      if(await this.store.hasOpenAfterSaleForOrder(order.id))continue;
      try{await this.settleOrder(order.id);const settlements=await this.store.listSettlements(order.id);if(!settlements.length||settlements.some((item)=>item.status!=='SUCCEEDED'))continue;await this.store.transaction(async(store)=>{const current=await store.getOrder(order.id);if(current?.status==='PICKED_UP'){current.status=transitionOrder(current.status,'COMPLETED');await store.saveOrderStatus(current);}});settled+=1;}catch{continue;}
    }
    return settled;
  }

  private async submitRefund(refund:Refund,now=Date.now()):Promise<void>{
    const leaseUntil=new Date(now+refundSubmissionLeaseMilliseconds).toISOString();
    const claimToken=randomUUID();
    const claimed=await this.store.transaction((store)=>store.claimRefundSubmission(refund.id,leaseUntil,new Date(now).toISOString(),claimToken));
    if(!claimed)return;
    await this.submitClaimedRefund(refund,claimToken);
  }
  private async refundPlatformOrder(orderId:string):Promise<void>{
    const refund=await this.store.transaction(async(store)=>{const order=await store.getOrderForUpdate(orderId);if(!order)throw new BusinessError('RESOURCE_NOT_FOUND','订单不存在',404);if(order.status==='REFUNDED')return null;if(order.status!=='REFUNDING')throw new BusinessError('INVALID_STATE_TRANSITION','订单当前不可退款',409);if((await store.listPlatformPartialRefundsByOrder(order.id)).some((value)=>value.status!=='FAILED'))throw new BusinessError('PARTIAL_REFUND_NOT_SUPPORTED','订单已有差异部分退款，不能自动全额退款',409);const payment=await store.getPaymentByOrderForUpdate(orderId);if(!payment)throw new BusinessError('INVALID_STATE_TRANSITION','订单没有可退款的成功支付单',409);if(payment.status==='SUCCEEDED'){payment.status='REFUNDING';if(!(await store.savePaymentIfStatus(payment,['SUCCEEDED'])))return await store.getPlatformRefundByOrder(orderId);}else if(payment.status!=='REFUNDING')throw new BusinessError('INVALID_STATE_TRANSITION','订单没有可退款的成功支付单',409);const existing=await store.getPlatformRefundByOrder(orderId);if(existing)return existing;const created:PlatformRefund={id:randomUUID(),orderId,paymentId:payment.id,providerRefundNo:`PRF${order.orderNo}`.slice(0,64),providerRefundId:null,status:'CREATED',amountCents:order.totalCents,createdAt:new Date().toISOString(),submissionLeaseUntil:null,submissionClaimToken:null};await store.savePlatformRefund(created);return created;});if(refund&&(refund.status==='CREATED'||refund.status==='FAILED'))await this.submitPlatformRefund(refund);await this.finalizePlatformRefund(orderId);
  }
  /** Finance executes only an operator-confirmed exception. One exception/order maps to one stable provider refund number. */
  public async executePartialRefund(exceptionId:string,auditContext?:PartialRefundAuditContext):Promise<void>{
    const refunds=await this.store.transaction(async(store)=>{
      const exception=await store.getFulfillmentExceptionForUpdate(exceptionId);
      if(!exception||!['REFUND_CONFIRMED','REFUND_PROCESSING','RESOLVED'].includes(exception.status))throw new BusinessError('INVALID_STATE_TRANSITION','异常尚未由运营确认部分退款',409);
      const before=structuredClone(exception);
      const allocations=(await store.listFulfillmentAllocations(exception.id)).filter((value)=>value.exceptionQuantity>value.refundedQuantity);
      // A repeated finance click after the prior execution has allocated every
      // line is a read-only retry: do not create a second execution audit fact.
      if(!allocations.length)return [] as PlatformPartialRefund[];
      const created:PlatformPartialRefund[]=[];const byOrder=new Map<string,typeof allocations>();for(const allocation of allocations){const rows=byOrder.get(allocation.orderId)??[];rows.push(allocation);byOrder.set(allocation.orderId,rows);}
      for(const [orderId,rows] of byOrder){
        const order=await store.getOrderForUpdate(orderId);const payment=await store.getPaymentByOrderForUpdate(orderId);
        if(!order||order.businessModelVersion!=='PLATFORM_PROCUREMENT'||order.paymentRoute!=='PLATFORM_DIRECT'||!payment||payment.status!=='SUCCEEDED')throw new BusinessError('INVALID_STATE_TRANSITION','异常订单没有可执行的平台成功支付',409);
        const amount=rows.reduce((sum,row)=>{const line=order.items.find((item)=>item.salesOrderItemId===row.salesOrderItemId);return sum+(line?Number(line.unitPriceCents)*(row.exceptionQuantity-row.refundedQuantity):NaN);},0);
        if(!Number.isSafeInteger(amount)||amount<=0)throw new BusinessError('FINANCIAL_INCONSISTENT','异常退款金额无法从销售快照计算',500);
        const existing=(await store.listPlatformPartialRefundsByException(exception.id)).find((value)=>value.orderId===orderId);
        if(existing){if(Number(existing.amountCents)!==amount)throw new BusinessError('FINANCIAL_INCONSISTENT','同一异常退款金额发生变化，已停止执行',500);created.push(existing);continue;}
        const already=(await store.listPlatformPartialRefundsByOrder(orderId)).filter((value)=>value.status!=='FAILED').reduce((sum,value)=>sum+Number(value.amountCents),0);
        if(already+amount>Number(payment.amountCents))throw new BusinessError('REFUND_AMOUNT_EXCEEDED','累计部分退款不能超过用户实付金额',409);
        const refund:PlatformPartialRefund={id:randomUUID(),exceptionId:exception.id,orderId,paymentId:payment.id,providerRefundNo:`PPR${exception.id.replaceAll('-','').slice(0,20)}${order.orderNo}`.slice(0,64),providerRefundId:null,status:'CREATED',amountCents:amount as PlatformPartialRefund['amountCents'],createdAt:new Date().toISOString(),submissionLeaseUntil:null,submissionClaimToken:null};await store.savePlatformPartialRefund(refund);created.push(refund);
      }
      exception.status='REFUND_PROCESSING';await store.saveFulfillmentException(exception);
      // Existing durable refunds are recovered by their own state machine. An
      // EXECUTED audit row belongs only to a newly created finance execution.
      if(auditContext&&created.some((refund)=>refund.status==='CREATED'))await store.saveAuditLog({id:randomUUID(),actorId:auditContext.actorId,action:'FULFILLMENT_EXCEPTION_PARTIAL_REFUND_EXECUTED',resourceType:'FULFILLMENT_EXCEPTION',resourceId:exception.id,requestId:auditContext.requestId,beforeData:{exception:before,allocations},afterData:{exception,refunds:created,confirmationNote:auditContext.confirmationNote,allocations},createdAt:new Date().toISOString()});
      return created;
    });
    for(const refund of refunds)if(refund.status==='CREATED'||refund.status==='FAILED')await this.submitPlatformPartialRefund(refund);
    for(const refund of refunds)await this.finalizePartialRefund(refund.id);
  }
  private async platformRefundRequest(refund:PlatformRefund):Promise<RefundRequest>{const [order,payment]=await Promise.all([this.store.getOrder(refund.orderId),this.store.getPaymentByOrder(refund.orderId)]);if(!order||!payment||order.paymentRoute!=='PLATFORM_DIRECT')throw new BusinessError('VALIDATION_ERROR','平台退款路由不一致',409);return{providerRefundNo:refund.providerRefundNo,subMchid:null,outTradeNo:order.orderNo,amountCents:Number(refund.amountCents),totalCents:Number(payment.amountCents)};}
  private async platformPartialRefundRequest(refund:PlatformPartialRefund):Promise<RefundRequest>{const [order,payment]=await Promise.all([this.store.getOrder(refund.orderId),this.store.getPaymentByOrder(refund.orderId)]);if(!order||!payment||order.businessModelVersion!=='PLATFORM_PROCUREMENT'||order.paymentRoute!=='PLATFORM_DIRECT')throw new BusinessError('VALIDATION_ERROR','部分退款路由不一致',409);return{providerRefundNo:refund.providerRefundNo,subMchid:null,outTradeNo:order.orderNo,amountCents:Number(refund.amountCents),totalCents:Number(payment.amountCents)};}
  private async submitPlatformPartialRefund(refund:PlatformPartialRefund,now=Date.now()):Promise<void>{const token=randomUUID();if(!(await this.store.transaction((store)=>store.claimPlatformPartialRefundSubmission(refund.id,new Date(now+refundSubmissionLeaseMilliseconds).toISOString(),new Date(now).toISOString(),token))))return;const result=await this.provider.refund(await this.platformPartialRefundRequest(refund));await this.store.transaction((store)=>store.savePlatformPartialRefundIfClaimed({...refund,providerRefundId:result.providerRefundId,status:result.status,submissionLeaseUntil:null,submissionClaimToken:null},token));}
  private async reconcilePlatformPartialRefund(refund:PlatformPartialRefund):Promise<void>{const now=Date.now();if(refund.submissionLeaseUntil!==null&&Date.parse(refund.submissionLeaseUntil)>now)return;if(refund.submissionLeaseUntil===null){const result=await this.provider.queryRefund({providerRefundNo:refund.providerRefundNo,subMchid:null});await this.store.savePlatformPartialRefundIfUnclaimed({...refund,providerRefundId:result.providerRefundId,status:result.status,submissionLeaseUntil:null,submissionClaimToken:null},new Date(now).toISOString());return;}const token=randomUUID();if(!(await this.store.transaction((store)=>store.claimPlatformPartialRefundSubmission(refund.id,new Date(now+refundSubmissionLeaseMilliseconds).toISOString(),new Date(now).toISOString(),token))))return;try{const result=await this.provider.queryRefund({providerRefundNo:refund.providerRefundNo,subMchid:null});if(result.status!=='FAILED'){await this.store.transaction((store)=>store.savePlatformPartialRefundIfClaimed({...refund,providerRefundId:result.providerRefundId,status:result.status,submissionLeaseUntil:null,submissionClaimToken:null},token));return;}const response=await this.provider.refund(await this.platformPartialRefundRequest(refund));await this.store.transaction((store)=>store.savePlatformPartialRefundIfClaimed({...refund,providerRefundId:response.providerRefundId,status:response.status,submissionLeaseUntil:null,submissionClaimToken:null},token));}catch{/* retain lease: later recovery remains query-first */}}
  private async submitPlatformRefund(refund:PlatformRefund,now=Date.now()):Promise<void>{
    const claimToken=randomUUID();
    if(!(await this.store.transaction((store)=>store.claimPlatformRefundSubmission(refund.id,new Date(now+refundSubmissionLeaseMilliseconds).toISOString(),new Date(now).toISOString(),claimToken))))return;
    await this.submitClaimedPlatformRefund(refund,claimToken);
  }
  private async reconcilePlatformRefund(refund:PlatformRefund):Promise<void>{
    const now=Date.now();
    if(refund.submissionLeaseUntil!==null&&Date.parse(refund.submissionLeaseUntil)>now)return;
    // A provider-acknowledged PROCESSING refund has no active submitter. It is
    // query-only: replaying the request would violate the stable refund number
    // and can cause a duplicate external operation.
    if(refund.submissionLeaseUntil===null){
      const result=await this.provider.queryRefund({providerRefundNo:refund.providerRefundNo,subMchid:null});
      await this.store.savePlatformRefundIfUnclaimed({...refund,providerRefundId:result.providerRefundId,status:result.status,submissionLeaseUntil:null,submissionClaimToken:null},new Date(now).toISOString());
      return;
    }
    // A lease that expired without a persisted provider response is ambiguous.
    // Take a fresh token, query first, and only replay with that same token when
    // the provider positively reports no refund.
    const token=randomUUID();
    if(!(await this.store.transaction((store)=>store.claimPlatformRefundSubmission(refund.id,new Date(now+refundSubmissionLeaseMilliseconds).toISOString(),new Date(now).toISOString(),token))))return;
    try{
      const result=await this.provider.queryRefund({providerRefundNo:refund.providerRefundNo,subMchid:null});
      if(result.status!=='FAILED'){
        await this.store.transaction((store)=>store.savePlatformRefundIfClaimed({...refund,providerRefundId:result.providerRefundId,status:result.status,submissionLeaseUntil:null,submissionClaimToken:null},token));
        return;
      }
      await this.submitClaimedPlatformRefund({...refund,status:'FAILED'},token);
    }catch{
      // Query unavailability is also ambiguous. Keep the new lease so another
      // worker cannot submit concurrently; its expiry re-enters query-first
      // recovery with the stable provider refund number.
    }
  }
  /** The refund provider call is fenced by the durable submission token. */
  private async submitClaimedPlatformRefund(refund:PlatformRefund,claimToken:string):Promise<void>{
    const result=await this.provider.refund(await this.platformRefundRequest(refund));
    await this.store.transaction((store)=>store.savePlatformRefundIfClaimed({...refund,providerRefundId:result.providerRefundId,status:result.status,submissionLeaseUntil:null,submissionClaimToken:null},claimToken));
  }
  /** Calls the provider only after the caller owns the durable claim token. */
  private async submitClaimedRefund(refund:Refund,claimToken:string):Promise<void>{
    // A rejected provider call deliberately leaves its claim lease in place.
    // Its later recovery is query-first, so an ambiguous network failure cannot
    // be mistaken for a refund that was never submitted.
    const result=await this.provider.refund(await this.refundRequest(refund));
    await this.store.transaction((store)=>store.saveRefundIfClaimed({...refund,providerRefundId:result.providerRefundId,status:result.status,submissionLeaseUntil:null,submissionClaimToken:null},claimToken));
  }
  private async reconcileProcessingRefund(refund:Refund):Promise<void>{
    const now=Date.now();
    const leaseUntil=refund.submissionLeaseUntil;
    if(leaseUntil!==null&&Date.parse(leaseUntil)>now)return;
    const wasExpiredLease=leaseUntil!==null;
    const claimToken=wasExpiredLease?randomUUID():null;
    if(claimToken&&!(await this.store.transaction((store)=>store.claimRefundSubmission(refund.id,new Date(now+refundSubmissionLeaseMilliseconds).toISOString(),new Date(now).toISOString(),claimToken))))return;
    try{
      const input=await this.refundRequest(refund);const result=await this.provider.queryRefund({providerRefundNo:refund.providerRefundNo,subMchid:input.subMchid});
      const resolved:Refund={...refund,providerRefundId:result.providerRefundId,status:result.status,submissionLeaseUntil:null,submissionClaimToken:null};
      const saved=claimToken
        ?await this.store.transaction((store)=>store.saveRefundIfClaimed(resolved,claimToken))
        :await this.store.saveRefundIfUnclaimed(resolved,new Date(now).toISOString());
      if(saved&&result.status==='FAILED')await this.submitRefund(resolved);
    }catch(error){
      // A null lease means the provider previously acknowledged PROCESSING;
      // wait for its next query result. An expired lease means the prior call
      // may have died before reaching the provider, so this holder replays it.
      if(claimToken)await this.submitClaimedRefund(refund,claimToken);
      else throw error;
    }
  }
  private async submitSettlement(settlement:Settlement):Promise<void>{const result=await this.provider.settle(await this.settlementRequest(settlement));settlement.providerOrderId=result.providerOrderId;settlement.status=result.status;await this.store.saveSettlement(settlement);}
  private async settlementRequest(settlement:Settlement){const payment=await this.store.getPaymentByOrder(settlement.orderId);if(!payment)throw new BusinessError('RESOURCE_NOT_FOUND','支付单不存在',404);const subOrder=this.subOrders(payment).find((item)=>item.merchantOrderId===settlement.merchantOrderId);if(!subOrder)throw new BusinessError('VALIDATION_ERROR','结算缺少支付子单信息',409);return{subMchid:subOrder.subMchid,transactionId:subOrder.transactionId??null,outOrderNo:settlement.outOrderNo,commissionCents:Number(settlement.commissionCents)};}
  private paymentInitiationResult(payment:Payment|null):{provider:Payment['provider'];clientPayload:Record<string,string>;status:Payment['status']}|null{
    if(!payment)return null;
    if(payment.status==='SUCCEEDED')return{provider:payment.provider,clientPayload:payment.clientPayload??{},status:payment.status};
    return payment.clientPayload?{provider:payment.provider,clientPayload:payment.clientPayload,status:payment.status}:null;
  }
  private async waitForPaymentInitiation(orderId:string):Promise<{provider:Payment['provider'];clientPayload:Record<string,string>;status:Payment['status']}|null>{
    for(let attempt=0;attempt<paymentInitiationPollAttempts;attempt++){
      await new Promise<void>((resolve)=>setTimeout(resolve,paymentInitiationPollDelayMilliseconds));
      const result=this.paymentInitiationResult(await this.store.getPaymentByOrder(orderId));
      if(result)return result;
    }
    return null;
  }
  private async refundRequest(refund:Refund):Promise<RefundRequest>{
    const payment=await this.store.getPaymentByOrder(refund.orderId);if(!payment)throw new BusinessError('RESOURCE_NOT_FOUND','支付单不存在',404);
    const subOrder=this.subOrders(payment).find((item)=>item.merchantOrderId===refund.merchantOrderId);if(!subOrder)throw new BusinessError('VALIDATION_ERROR','退款缺少支付子单信息',409);
    return{providerRefundNo:refund.providerRefundNo,subMchid:subOrder.subMchid,outTradeNo:subOrder.outTradeNo,amountCents:Number(refund.amountCents),totalCents:subOrder.amountCents};
  }
  private subOrders(payment:Payment):ProviderSubOrder[]{const value=payment.providerContext?.subOrders;return Array.isArray(value)?value.filter((item):item is ProviderSubOrder=>typeof item==='object'&&item!==null&&typeof (item as ProviderSubOrder).merchantOrderId==='string'):[];}
  private async finalizeRefund(orderId:string):Promise<void>{
    await this.store.transaction(async(store)=>{
      const refunds=await store.listRefundsByOrder(orderId);if(!refunds.length||refunds.some((item)=>item.status!=='SUCCEEDED'))return;
      const order=await store.getOrderForUpdate(orderId);const payment=await store.getPaymentByOrderForUpdate(orderId);if(!order||!payment)return;
      if(order.status==='REFUNDING'){order.status=transitionOrder(order.status,'REFUNDED');await store.saveOrderStatus(order);await this.ledger.recordRefund(store,order);}
      if(payment.status==='REFUNDING'){payment.status='REFUNDED';await store.savePaymentIfStatus(payment,['REFUNDING']);}
    });
  }
  private async finalizePlatformRefund(orderId:string):Promise<void>{await this.store.transaction(async(store)=>{const refund=await store.getPlatformRefundByOrder(orderId);if(!refund||refund.status!=='SUCCEEDED')return;const order=await store.getOrderForUpdate(orderId);const payment=await store.getPaymentByOrderForUpdate(orderId);if(!order||!payment||order.paymentRoute!=='PLATFORM_DIRECT')return;if(order.status==='REFUNDING'){order.status=transitionOrder(order.status,'REFUNDED');await store.saveOrderStatus(order);await this.ledger.recordRefund(store,order);}if(payment.status==='REFUNDING'){payment.status='REFUNDED';await store.savePaymentIfStatus(payment,['REFUNDING']);}});}
  private async finalizePartialRefund(refundId:string):Promise<void>{await this.store.transaction(async(store)=>{const refund=await store.getPlatformPartialRefund(refundId);if(!refund||refund.status!=='SUCCEEDED')return;const exception=await store.getFulfillmentExceptionForUpdate(refund.exceptionId);if(!exception)return;const allocationsBefore=await store.listFulfillmentAllocations(exception.id);if(!(await store.markFulfillmentAllocationsRefunded(exception.id,refund,new Date().toISOString())))return;const allocationsAfter=await store.listFulfillmentAllocations(exception.id);await this.ledger.recordPartialRefund(store,exception,refund);const order=await store.getOrderForUpdate(refund.orderId);const plan=order?await store.getDeliveryPlan(order.deliveryPlanId):null;if(order&&plan&&this.notifications)await this.notifications.enqueueOrder(store,'PARTIAL_REFUND',order.id,plan,`partial-refund:${refund.id}`);const remaining=(await store.listFulfillmentAllocations(exception.id)).some((value)=>value.exceptionQuantity>value.refundedQuantity);if(!remaining&&exception.status!=='RESOLVED'){exception.status='RESOLVED';await store.saveFulfillmentException(exception);}if(order)await store.saveAuditLog({id:randomUUID(),actorId:'system',action:'FULFILLMENT_EXCEPTION_PARTIAL_REFUND_SETTLED',resourceType:'PLATFORM_PARTIAL_REFUND',resourceId:refund.id,requestId:`refund-settlement:${refund.id}`,beforeData:{refund:{...refund,status:'PROCESSING'},allocations:allocationsBefore},afterData:{refund,allocations:allocationsAfter,orderId:order.id},createdAt:new Date().toISOString()});if(!order)return;const payment=await store.getPaymentByOrderForUpdate(order.id);const refunded=(await store.listPlatformPartialRefundsByOrder(order.id)).filter((value)=>value.status==='SUCCEEDED').reduce((sum,value)=>sum+Number(value.amountCents),0);if(payment&&refunded===Number(payment.amountCents)&&order.status!=='REFUNDED'){if(order.status!=='REFUNDING'){order.status=transitionOrder(order.status,'REFUNDING');await store.saveOrderStatus(order);}order.status=transitionOrder(order.status,'REFUNDED');await store.saveOrderStatus(order);if(payment.status==='SUCCEEDED'){payment.status='REFUNDING';await store.savePaymentIfStatus(payment,['SUCCEEDED']);payment.status='REFUNDED';await store.savePaymentIfStatus(payment,['REFUNDING']);}}});}
}
