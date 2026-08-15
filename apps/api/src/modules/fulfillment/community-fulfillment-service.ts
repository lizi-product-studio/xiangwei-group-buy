import { createHmac, randomUUID } from 'node:crypto';
import { BusinessError, moneyCents, transitionOrder } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { Campaign, CommunityCampaignItem, CommunityDeliveryConfirmation, FulfillmentAllocation, FulfillmentException, FulfillmentExceptionType, PlatformSalesLine } from '../core/types.js';

export type CommunityCampaignInput = {
  title:string; serviceAreaId:string; pickupPointId:string; cutoffAt:string; dispatchAt:string;
  minTotalQuantity:number; failureAction:'CANCEL_AND_REFUND'|'POSTPONE';
  items:Array<{platformSkuId:string;retailPriceCents:number;sellableQuantity:number}>;
};
export type CommunityArrivalInput = {
  receivedBy:string; confirmationNote:string|null; emergencyReason:string|null;
  items:Array<{platformSkuId:string;receivedQuantity:number;rejectedQuantity:number;shortQuantity:number;damagedQuantity:number;reason:FulfillmentExceptionType|null;evidenceNote:string|null}>;
};

/**
 * The simple community flow deliberately has no warehouse, supplier, lot or
 * payable dependency. It only records the dispatch fact, the point's counted
 * arrival and the per-order allocation that makes normal quantities collectible.
 */
export class CommunityFulfillmentService {
  public constructor(private readonly store:CommerceStore,private readonly pickupCodeSecret:string) {}
  private now(){ return new Date().toISOString(); }
  private pickupHash(orderId:string){ const hex=createHmac('sha256',this.pickupCodeSecret).update(`pickup:${orderId}`).digest('hex'); const code=String(Number.parseInt(hex.slice(0,12),16)%1_000_000).padStart(6,'0'); return createHmac('sha256',this.pickupCodeSecret).update(code).digest('hex'); }
  private async audit(store:CommerceStore,actorId:string,requestId:string,action:string,resourceType:string,resourceId:string,beforeData:unknown,afterData:unknown){ await store.saveAuditLog({id:randomUUID(),actorId,action,resourceType,resourceId,requestId,beforeData,afterData,createdAt:this.now()}); }

  public async createCampaign(input:CommunityCampaignInput,actorId:string,requestId:string):Promise<Campaign>{
    return this.store.transaction(async(store)=>{
      const area=(await store.listServiceAreas()).find((item)=>item.id===input.serviceAreaId&&item.status==='ENABLED'&&item.orderEnabled);
      const point=(await store.listPickupPoints(input.serviceAreaId)).find((item)=>item.id===input.pickupPointId&&item.status==='ACTIVE');
      if(!area||!point)throw new BusinessError('RESOURCE_NOT_FOUND','服务区域或固定自提点不可用',404);
      const seen=new Set<string>(); const items:CommunityCampaignItem[]=[];
      for(const requested of input.items){
        if(seen.has(requested.platformSkuId))throw new BusinessError('VALIDATION_ERROR','团期商品不能重复',400);
        seen.add(requested.platformSkuId);
        const sku=await store.getPlatformSku(requested.platformSkuId);
        if(!sku||sku.status!=='ACTIVE'||sku.product.status!=='ACTIVE')throw new BusinessError('RESOURCE_NOT_FOUND','平台商品不存在或已停用',404,{platformSkuId:requested.platformSkuId});
        items.push({platformSkuId:sku.id,productId:sku.productId,title:sku.product.title,category:sku.product.category,skuName:sku.name,origin:sku.product.origin,imageUrl:sku.product.imageUrl,retailPriceCents:moneyCents(requested.retailPriceCents),sellableQuantity:requested.sellableQuantity,reservedQuantity:0});
      }
      const now=this.now();
      const campaign:Campaign={id:randomUUID(),title:input.title,serviceAreaId:input.serviceAreaId,cutoffAt:input.cutoffAt,dispatchAt:input.dispatchAt,minTotalQuantity:input.minTotalQuantity,failureAction:input.failureAction,businessModelVersion:'PLATFORM_COMMUNITY',warehouseId:null,skuIds:[],items:[],platformItems:[],communityItems:items,status:'DRAFT',version:1,createdAt:now};
      await store.saveCampaign(campaign); await store.replaceCommunityCampaignItems(campaign.id,items);
      await store.saveDeliveryPlan({id:randomUUID(),campaignId:campaign.id,serviceAreaId:campaign.serviceAreaId,pickupPointId:point.id,status:'SITE_CONFIRMED',siteName:point.name,address:point.address,arrivalStartAt:null,arrivalEndAt:null,contactName:point.siteLeadName,contactPhone:point.siteLeadPhone,vehicleOrderNo:null,driverName:null,driverPhone:null,vehiclePlate:null,logisticsPlatform:null,estimatedArrivalAt:null,remark:null,confirmedAt:now,bookedAt:null,dispatchedAt:null,arrivedAt:null,createdAt:now,updatedAt:now});
      await this.audit(store,actorId,requestId,'COMMUNITY_CAMPAIGN_CREATED','CAMPAIGN',campaign.id,null,{campaign,items});
      return campaign;
    });
  }

  public async confirmArrival(batchId:string,actorId:string,input:CommunityArrivalInput,requestId:string,emergencyProxy=false):Promise<CommunityDeliveryConfirmation>{
    return this.store.transaction(async(store)=>{
      const batch=await store.getDispatchBatch(batchId); if(!batch)throw new BusinessError('RESOURCE_NOT_FOUND','配送批次不存在',404);
      const campaign=await store.getCampaignForUpdate(batch.campaignId); if(!campaign||campaign.businessModelVersion!=='PLATFORM_COMMUNITY')throw new BusinessError('RESOURCE_NOT_FOUND','社区团期不存在',404);
      const existing=await store.getCommunityDeliveryConfirmationByBatch(batch.id); if(existing)return existing;
      const plan=await store.getDeliveryPlanByCampaign(batch.campaignId); if(!plan||plan.status!=='IN_TRANSIT'||batch.status!=='IN_TRANSIT')throw new BusinessError('INVALID_STATE_TRANSITION','只有运输中的配送可以由点位确认到货',409);
      const rows=await store.listPlatformSalesLinesByCampaignForUpdate(campaign.id);
      // The sales-line locks serialize two first-arrival requests.  Re-read the
      // idempotency fact after acquiring them, otherwise a contender that read
      // before the first transaction committed could allocate the same paid
      // lines before its INSERT discovers the duplicate confirmation.
      const confirmedAfterLock=await store.getCommunityDeliveryConfirmationByBatch(batch.id); if(confirmedAfterLock)return confirmedAfterLock;
      const expected=new Map<string,number>(); for(const row of rows) expected.set(row.platformSkuId,(expected.get(row.platformSkuId)??0)+row.quantity);
      const supplied=new Map(input.items.map((item)=>[item.platformSkuId,item]));
      if(supplied.size!==input.items.length||supplied.size!==expected.size||[...expected.keys()].some((sku)=>!supplied.has(sku)))throw new BusinessError('VALIDATION_ERROR','点位确认必须逐一覆盖本团已付款商品',400);
      for(const [sku,quantity] of expected){const item=supplied.get(sku)!; const total=item.receivedQuantity+item.rejectedQuantity+item.shortQuantity+item.damagedQuantity; if(total!==quantity)throw new BusinessError('VALIDATION_ERROR','实到、拒收、短少与破损数量之和必须等于应到数量',400,{platformSkuId:sku,expectedQuantity:quantity}); const abnormal=item.rejectedQuantity+item.shortQuantity+item.damagedQuantity; if(abnormal>0&&(!item.reason||!item.evidenceNote))throw new BusinessError('VALIDATION_ERROR','差异商品必须填写原因和证据说明',400,{platformSkuId:sku}); }
      const now=this.now(); const hasException=input.items.some((item)=>item.rejectedQuantity+item.shortQuantity+item.damagedQuantity>0);
      const confirmation:CommunityDeliveryConfirmation={id:randomUUID(),dispatchBatchId:batch.id,campaignId:campaign.id,deliveryPlanId:plan.id,status:hasException?'EXCEPTION':'COMPLETED',confirmedBy:actorId,receivedBy:input.receivedBy,confirmationNote:input.confirmationNote,confirmedAt:now,items:input.items.map((item)=>({id:randomUUID(),communityDeliveryId:'',platformSkuId:item.platformSkuId,expectedQuantity:expected.get(item.platformSkuId)!,receivedQuantity:item.receivedQuantity,rejectedQuantity:item.rejectedQuantity,shortQuantity:item.shortQuantity,damagedQuantity:item.damagedQuantity,reason:item.reason,evidenceNote:item.evidenceNote,evidenceUrl:null}))}; confirmation.items.forEach((item)=>item.communityDeliveryId=confirmation.id);
      const exceptionItems=confirmation.items.filter((item)=>item.rejectedQuantity+item.shortQuantity+item.damagedQuantity>0);
      const exception:FulfillmentException|null=!exceptionItems.length?null:{id:randomUUID(),campaignId:campaign.id,orderId:null,clientRequestId:null,outboundOrderId:null,deliveryPlanId:plan.id,sourceStage:'PICKUP_HANDOVER',status:'REGISTERED',responsibility:'PENDING',registeredBy:actorId,confirmedBy:null,resolutionNote:null,registeredAt:now,confirmedAt:null,items:exceptionItems.map((item)=>({id:randomUUID(),exceptionId:'',platformSkuId:item.platformSkuId,expectedQuantity:item.expectedQuantity,acceptedQuantity:item.receivedQuantity,rejectedQuantity:item.rejectedQuantity,shortQuantity:item.shortQuantity,damagedQuantity:item.damagedQuantity,reason:item.reason!,description:item.evidenceNote!,evidenceUrl:null}))}; if(exception)exception.items.forEach((item)=>item.exceptionId=exception.id);
      const exceptionItemBySku=new Map(exception?.items.map((item)=>[item.platformSkuId,item])??[]); const allocations:FulfillmentAllocation[]=[];
      const remainingBySku=new Map(confirmation.items.map((item)=>[item.platformSkuId,item.receivedQuantity]));
      const updatedRows:PlatformSalesLine[]=[];for(const row of rows){const available=remainingBySku.get(row.platformSkuId)??0; const fulfilled=Math.min(row.quantity,available); remainingBySku.set(row.platformSkuId,available-fulfilled); const exceptional=row.quantity-fulfilled; const next:PlatformSalesLine={...row,fulfilledQuantity:fulfilled,pickedUpQuantity:0,exceptionQuantity:exceptional}; if(!await store.updatePlatformSalesLine(next))throw new BusinessError('CONCURRENT_MODIFICATION','销售明细已被并发更新，请刷新后重试',409);updatedRows.push(next); if(exceptional){const exceptionItem=exceptionItemBySku.get(row.platformSkuId);if(!exceptionItem)throw new BusinessError('INVENTORY_INCONSISTENT','差异分配缺少商品事实',500);allocations.push({id:randomUUID(),exceptionId:exception!.id,exceptionItemId:exceptionItem.id,salesOrderItemId:row.id,orderId:row.orderId,platformSkuId:row.platformSkuId,fulfilledQuantity:0,exceptionQuantity:exceptional,refundedQuantity:0,createdAt:now,refundedAt:null});}}
      if(exception){await store.saveFulfillmentException(exception);await store.saveFulfillmentAllocations(allocations);}
      const orderIds=[...new Set(rows.map((row)=>row.orderId))];
      for(const orderId of orderIds){const order=await store.getOrderForUpdate(orderId);if(!order||order.status!=='IN_TRANSIT')continue; const orderRows=updatedRows.filter((row)=>row.orderId===order.id);if(!orderRows.some((row)=>row.fulfilledQuantity>0))continue; order.status=transitionOrder(order.status,'READY_FOR_PICKUP');await store.saveOrderStatus(order);await store.savePickupCredential({orderId:order.id,codeHash:this.pickupHash(order.id),status:'ACTIVE',expiresAt:new Date(Date.now()+14*86_400_000).toISOString()});}
      batch.status='ARRIVED';batch.arrivedAt=now;await store.saveDispatchBatch(batch);plan.status='ARRIVED';plan.arrivedAt=now;plan.updatedAt=now;await store.saveDeliveryPlan(plan);
      if(!await store.saveCommunityDeliveryConfirmation(confirmation)){const raced=await store.getCommunityDeliveryConfirmationByBatch(batch.id);if(raced)return raced;throw new BusinessError('CONCURRENT_MODIFICATION','到货确认已被并发处理，请刷新后重试',409);}
      await this.audit(store,actorId,requestId,emergencyProxy?'COMMUNITY_DELIVERY_EMERGENCY_CONFIRMED':'COMMUNITY_DELIVERY_CONFIRMED','COMMUNITY_DELIVERY',confirmation.id,null,{confirmation,exception,allocations,emergencyProxy,emergencyReason:emergencyProxy?input.emergencyReason:null});
      return confirmation;
    });
  }
}
