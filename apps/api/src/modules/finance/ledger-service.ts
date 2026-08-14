import { randomUUID } from 'node:crypto';
import { BusinessError, moneyCents } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { FulfillmentException, LedgerLine, LedgerTransaction, Order, PlatformPartialRefund, SupplierPayable } from '../core/types.js';

export class LedgerService {
  public async recordPayment(store:CommerceStore,order:Order):Promise<void>{
    if(order.businessModelVersion!=='LEGACY_MARKETPLACE'){
      await this.append(store,order.id,'PAYMENT_SUCCEEDED',[{accountCode:'PLATFORM_PAYMENT_CLEARING',ownerId:null,direction:'DEBIT',amountCents:order.totalCents},{accountCode:'PLATFORM_CONTRACT_LIABILITY',ownerId:null,direction:'CREDIT',amountCents:order.totalCents}]);
      return;
    }
    const lines:LedgerLine[]=[];
    for(const merchantOrder of order.merchantOrders){
      this.line(lines,'PAYMENT_CLEARING',merchantOrder.merchantId,'DEBIT',Number(merchantOrder.itemAmountCents));
      this.line(lines,'MERCHANT_FUNDS_FROZEN',merchantOrder.merchantId,'CREDIT',Number(merchantOrder.merchantReceivableCents));
      this.line(lines,'PLATFORM_COMMISSION_FROZEN',null,'CREDIT',Number(merchantOrder.commissionCents));
    }
    await this.append(store,order.id,'PAYMENT_SUCCEEDED',lines);
  }
  public async recordRefund(store:CommerceStore,order:Order):Promise<void>{
    if(order.businessModelVersion!=='LEGACY_MARKETPLACE'){
      // Before handover the customer payment is still a contract liability.
      // Once the order has been picked up, revenue has already been recognised;
      // a subsequent after-sale refund therefore reverses revenue rather than
      // creating a negative liability balance. Goods are not automatically put
      // back into stock because this MVP has no returned-goods inspection flow.
      const pickedUp=(await store.listLedgerTransactions(order.id)).some((item)=>item.eventType==='PICKUP_CONFIRMED');
      await this.append(store,order.id,'REFUND_SUCCEEDED',[
        {accountCode:pickedUp?'PLATFORM_SALES_REVENUE':'PLATFORM_CONTRACT_LIABILITY',ownerId:null,direction:'DEBIT',amountCents:order.totalCents},
        {accountCode:'PLATFORM_PAYMENT_CLEARING',ownerId:null,direction:'CREDIT',amountCents:order.totalCents},
      ]);
      return;
    }
    const lines:LedgerLine[]=[];
    const pickedUp=(await store.listLedgerTransactions(order.id)).some((item)=>item.eventType==='PICKUP_CONFIRMED');
    for(const merchantOrder of order.merchantOrders){
      this.line(lines,pickedUp?'MERCHANT_SETTLEABLE':'MERCHANT_FUNDS_FROZEN',merchantOrder.merchantId,'DEBIT',Number(merchantOrder.merchantReceivableCents));
      this.line(lines,pickedUp?'PLATFORM_COMMISSION_EARNED':'PLATFORM_COMMISSION_FROZEN',null,'DEBIT',Number(merchantOrder.commissionCents));
      this.line(lines,'PAYMENT_CLEARING',merchantOrder.merchantId,'CREDIT',Number(merchantOrder.itemAmountCents));
    }
    await this.append(store,order.id,'REFUND_SUCCEEDED',lines);
  }
  public async recordPickup(store:CommerceStore,order:Order):Promise<void>{
    if(order.businessModelVersion!=='LEGACY_MARKETPLACE'){
      const amount=moneyCents(order.items.reduce((sum,item)=>sum+Number(item.unitPriceCents)*item.fulfilledQuantity,0));
      const cost=order.items.reduce((sum,item)=>sum+Number(item.purchaseUnitCents??0)*item.fulfilledQuantity,0);
      const lines:LedgerLine[]=[{accountCode:'PLATFORM_CONTRACT_LIABILITY',ownerId:null,direction:'DEBIT',amountCents:amount},{accountCode:'PLATFORM_SALES_REVENUE',ownerId:null,direction:'CREDIT',amountCents:amount}];
      if(cost>0){this.line(lines,'PLATFORM_COST_OF_GOODS_SOLD',null,'DEBIT',cost);this.line(lines,'PLATFORM_INVENTORY_GOODS',null,'CREDIT',cost);}
      await this.append(store,order.id,'PICKUP_CONFIRMED',lines);
      return;
    }
    const lines:LedgerLine[]=[];
    for(const merchantOrder of order.merchantOrders){
      this.line(lines,'MERCHANT_FUNDS_FROZEN',merchantOrder.merchantId,'DEBIT',Number(merchantOrder.merchantReceivableCents));
      this.line(lines,'MERCHANT_SETTLEABLE',merchantOrder.merchantId,'CREDIT',Number(merchantOrder.merchantReceivableCents));
      this.line(lines,'PLATFORM_COMMISSION_FROZEN',null,'DEBIT',Number(merchantOrder.commissionCents));
      this.line(lines,'PLATFORM_COMMISSION_EARNED',null,'CREDIT',Number(merchantOrder.commissionCents));
    }
    await this.append(store,order.id,'PICKUP_CONFIRMED',lines);
  }
  /** A mode-B exception refund reverses only its approved line allocation. */
  public async recordPartialRefund(store:CommerceStore,exception:FulfillmentException,refund:PlatformPartialRefund):Promise<void>{
    const recognised=exception.sourceStage==='CUSTOMER_CLAIM';
    await this.append(store,refund.id,'PARTIAL_REFUND_SUCCEEDED',[
      {accountCode:recognised?'PLATFORM_SALES_REVENUE':'PLATFORM_CONTRACT_LIABILITY',ownerId:null,direction:'DEBIT',amountCents:refund.amountCents},
      {accountCode:'PLATFORM_PAYMENT_CLEARING',ownerId:null,direction:'CREDIT',amountCents:refund.amountCents},
    ],'FULFILLMENT_EXCEPTION');
  }
  /** Records the cost and payable only after a qualified warehouse receipt. */
  public async recordSupplierPayable(store:CommerceStore,payable:SupplierPayable):Promise<void>{
    await this.append(store,payable.id,'SUPPLIER_PAYABLE_RECOGNIZED',[
      {accountCode:'PLATFORM_INVENTORY_GOODS',ownerId:null,direction:'DEBIT',amountCents:payable.amountCents},
      {accountCode:'PLATFORM_SUPPLIER_PAYABLE',ownerId:payable.supplierId,direction:'CREDIT',amountCents:payable.amountCents},
    ],'SUPPLIER_PAYABLE');
  }
  /** Offline payments are evidenced, but no customer-money account is touched. */
  public async recordSupplierPayablePayment(store:CommerceStore,payable:SupplierPayable):Promise<void>{
    await this.append(store,payable.id,'SUPPLIER_PAYABLE_PAID',[
      {accountCode:'PLATFORM_SUPPLIER_PAYABLE',ownerId:payable.supplierId,direction:'DEBIT',amountCents:payable.amountCents},
      {accountCode:'PLATFORM_BANK_OR_CASH',ownerId:null,direction:'CREDIT',amountCents:payable.amountCents},
    ],'SUPPLIER_PAYABLE');
  }
  private line(lines:LedgerLine[],accountCode:string,ownerId:string|null,direction:LedgerLine['direction'],amount:number):void{if(amount>0)lines.push({accountCode,ownerId,direction,amountCents:moneyCents(amount)});}
  private async append(store:CommerceStore,referenceId:string,eventType:LedgerTransaction['eventType'],lines:LedgerLine[],referenceType:LedgerTransaction['referenceType']='ORDER'):Promise<void>{
    const debit=lines.filter((line)=>line.direction==='DEBIT').reduce((sum,line)=>sum+Number(line.amountCents),0);
    const credit=lines.filter((line)=>line.direction==='CREDIT').reduce((sum,line)=>sum+Number(line.amountCents),0);
    if(!lines.length||debit!==credit)throw new BusinessError('FINANCIAL_INCONSISTENT','财务流水借贷不平衡，已中止业务提交',500,{debit,credit,eventType});
    await store.appendLedgerTransaction({id:randomUUID(),referenceType,referenceId,eventType,lines,createdAt:new Date().toISOString()});
  }
}
