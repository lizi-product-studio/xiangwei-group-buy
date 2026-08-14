import { createHmac, randomUUID } from 'node:crypto';
import { BusinessError, moneyCents, transitionCampaign, transitionOrder } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { Campaign, FulfillmentAllocation, FulfillmentException, FulfillmentExceptionItem, FulfillmentExceptionType, GoodsReceipt, OutboundOrder, PickupHandover, PlatformCampaignItem, PurchaseOrder, SortingTask } from '../core/types.js';
import type { LedgerService } from '../finance/ledger-service.js';

type CampaignInput={title:string;serviceAreaId:string;warehouseId:string;cutoffAt:string;dispatchAt:string;minTotalQuantity:number;failureAction:'CANCEL_AND_REFUND'|'POSTPONE';items:Array<{platformSkuId:string;supplierOfferId:string;sellableQuantity:number}>};
type ReceiptInput={purchaseOrderItemId:string;acceptedQuantity:number;rejectedQuantity:number;batchNo:string|null;productionDate:string|null;expiresAt:string|null;inspectionNote:string|null;exceptionReason?:FulfillmentExceptionType|null;evidenceUrl?:string|null};
type HandoverInput={receivedBy:string;items:Array<{platformSkuId:string;receivedQuantity:number;rejectedQuantity:number;shortQuantity:number;damagedQuantity:number;reason:FulfillmentExceptionType|null;evidenceNote:string|null;evidenceUrl?:string|null}>;exceptionNote:string|null};
type ExceptionDecision={resolution:'WAITING_REPLENISHMENT'|'TRANSFER_PENDING'|'CONFIRM_PARTIAL_REFUND';responsibility:'SUPPLIER'|'WAREHOUSE'|'CARRIER'|'PICKUP_POINT'|'PLATFORM'|'PENDING';note:string};
type CustomerClaimInput={clientRequestId:string;items:Array<{platformSkuId:string;quantity:number;reason:'PICKUP_SHORTAGE'|'PICKUP_DAMAGE'|'QUALITY_CLAIM';description:string;evidenceUrl:string|null}>};
type WarehouseExceptionInput=Array<{platformSkuId:string;shortQuantity:number;damagedQuantity:number;reason:'WAREHOUSE_SHORTAGE'|'WAREHOUSE_DAMAGE'|'MIS_SORTED';description:string;evidenceUrl:string|null}>;
type TransferReinspectionInput={evidenceNote:string;items:Array<{platformSkuId:string;acceptedQuantity:number}>};
type AuditContext={requestId:string};
type CustomerClaimAuditContext={requestId:string};

/**
 * Mode-B purchasing, warehouse and handover workflow.  It deliberately never
 * reads merchant_orders, commissions or settlements: supplier payable, stock
 * and consumer sales remain separate facts.
 */
export class PlatformProcurementService {
  public constructor(private readonly store:CommerceStore,private readonly pickupCodeSecret:string,private readonly ledger:LedgerService){}
  private now(){return new Date().toISOString();}
  private async campaign(id:string,store:CommerceStore=this.store):Promise<Campaign>{
    const value=await store.getCampaign(id);
    if(!value||value.businessModelVersion!=='PLATFORM_PROCUREMENT')throw new BusinessError('RESOURCE_NOT_FOUND','平台采购团期不存在',404);
    return value;
  }
  /** Keep mode-B credentials wire-compatible with the established six-digit verifier. */
  private pickupHash(orderId:string):string{const hex=createHmac('sha256',this.pickupCodeSecret).update(`pickup:${orderId}`).digest('hex');const code=String(Number.parseInt(hex.slice(0,12),16)%1_000_000).padStart(6,'0');return createHmac('sha256',this.pickupCodeSecret).update(code).digest('hex');}
  private async audit(store:CommerceStore,context:AuditContext|undefined,actorId:string,action:string,resourceType:string,resourceId:string,beforeData:unknown,afterData:unknown):Promise<void>{if(!context)return;await store.saveAuditLog({id:randomUUID(),actorId,action,resourceType,resourceId,requestId:context.requestId,beforeData,afterData,createdAt:this.now()});}

  public async reconcileLockedCampaigns():Promise<void>{
    for(const campaign of await this.store.listCampaigns()){
      if(campaign.businessModelVersion==='PLATFORM_PROCUREMENT'&&campaign.status==='LOCKED'){
        try{await this.createPurchaseOrders(campaign.id);}catch{ /* retried on the next scheduler run */ }
      }
    }
  }

  public async createCampaign(input:CampaignInput):Promise<Campaign>{return this.store.transaction(async(store)=>{
    const warehouse=await store.getWarehouse(input.warehouseId);
    const area=(await store.listServiceAreas()).find((value)=>value.id===input.serviceAreaId&&value.status==='ENABLED'&&value.orderEnabled);
    if(!warehouse||warehouse.status!=='ACTIVE'||!area)throw new BusinessError('RESOURCE_NOT_FOUND','中心仓或服务区域不可用',404);
    const seen=new Set<string>(); const items:PlatformCampaignItem[]=[];
    for(const requested of input.items){
      if(seen.has(requested.platformSkuId))throw new BusinessError('VALIDATION_ERROR','团期平台商品不能重复',400);
      seen.add(requested.platformSkuId);
      const [sku,offer]=await Promise.all([store.getPlatformSku(requested.platformSkuId),store.getSupplierSkuOffer(requested.supplierOfferId)]);
      const supplier=offer?await store.getSupplier(offer.supplierId):null;
      const qualification=supplier?await store.listSupplierQualifications(supplier.id):[];
      if(!sku||sku.status!=='ACTIVE'||sku.product.status!=='ACTIVE'||!offer||offer.platformSkuId!==sku.id||offer.status!=='ACTIVE'||offer.purchasePriceCents===null||!supplier||supplier.status!=='ACTIVE'||!qualification.some((item)=>item.status==='APPROVED'&&(!item.expiresAt||Date.parse(item.expiresAt)>=Date.now())))throw new BusinessError('SUPPLIER_OFFER_NOT_READY','平台商品必须具备已启用供应商、有效资质、采购价和供货关系',409,{platformSkuId:requested.platformSkuId});
      items.push({platformSkuId:sku.id,supplierOfferId:offer.id,productId:sku.productId,title:sku.product.title,category:sku.product.category,skuName:sku.name,origin:sku.product.origin,imageUrl:sku.product.imageUrl,retailPriceCents:sku.retailPriceCents,purchasePriceCents:offer.purchasePriceCents,sellableQuantity:requested.sellableQuantity,reservedQuantity:0});
    }
    const now=this.now(); const campaign:Campaign={id:randomUUID(),title:input.title,serviceAreaId:input.serviceAreaId,warehouseId:input.warehouseId,cutoffAt:input.cutoffAt,dispatchAt:input.dispatchAt,minTotalQuantity:input.minTotalQuantity,failureAction:input.failureAction,businessModelVersion:'PLATFORM_PROCUREMENT',skuIds:[],items:[],platformItems:items,status:'DRAFT',version:1,createdAt:now};
    await store.saveCampaign(campaign); await store.replaceCampaignPlatformItems(campaign);
    await store.saveDeliveryPlan({id:randomUUID(),campaignId:campaign.id,serviceAreaId:campaign.serviceAreaId,pickupPointId:null,status:'PENDING_SITE',siteName:null,address:null,arrivalStartAt:null,arrivalEndAt:null,contactName:null,contactPhone:null,vehicleOrderNo:null,driverName:null,driverPhone:null,vehiclePlate:null,remark:null,confirmedAt:null,bookedAt:null,dispatchedAt:null,arrivedAt:null,createdAt:now,updatedAt:now});
    return campaign;
  });}

  public async createPurchaseOrders(campaignId:string):Promise<PurchaseOrder[]>{return this.store.transaction(async(store)=>{
    const campaign=await this.campaign(campaignId,store); if(campaign.status!=='LOCKED')throw new BusinessError('INVALID_STATE_TRANSITION','仅锁单团期可生成采购单',409);
    const existing=await store.listPurchaseOrders(campaign.id); if(existing.length)return existing;
    const demand=await store.listPlatformOrderItemsByCampaign(campaign.id); const snapshot=new Map(campaign.platformItems.map((item)=>[item.platformSkuId,item]));
    const groups=new Map<string,Array<{item:PlatformCampaignItem;quantity:number;minimum:number}>>();
    for(const line of demand){
      const item=snapshot.get(line.platformSkuId); const offer=item?await store.getSupplierSkuOffer(item.supplierOfferId):null;
      if(!item||!offer||offer.status!=='ACTIVE'||offer.purchasePriceCents===null)throw new BusinessError('SUPPLIER_OFFER_NOT_READY','销售明细的供货关系不可用',409);
      const group=groups.get(offer.supplierId)??[]; const matched=group.find((value)=>value.item.platformSkuId===item.platformSkuId);
      if(matched)matched.quantity+=line.quantity;else group.push({item,quantity:line.quantity,minimum:offer.minimumPurchaseQuantity}); groups.set(offer.supplierId,group);
    }
    const created:PurchaseOrder[]=[];
    for(const [supplierId,lines] of groups){const now=this.now();const po:PurchaseOrder={id:randomUUID(),purchaseNo:`PO${Date.now()}${randomUUID().slice(0,6).toUpperCase()}`,campaignId:campaign.id,supplierId,warehouseId:campaign.warehouseId!,status:'ORDERED',plannedArrivalAt:null,items:lines.map(({item,quantity,minimum})=>({id:randomUUID(),purchaseOrderId:'',platformSkuId:item.platformSkuId,supplierOfferId:item.supplierOfferId,plannedQuantity:Math.max(quantity,minimum),purchaseUnitCents:item.purchasePriceCents,createdAt:now})),createdAt:now,updatedAt:now};po.items.forEach((item)=>item.purchaseOrderId=po.id);await store.savePurchaseOrder(po);created.push(po);}
    return created;
  });}

  /** A receipt is an immutable batch. A later replenishment appends a new batch,
   * lot and supplier payable rather than overwriting the original short receipt. */
  public async receive(purchaseOrderId:string,actorId:string,input:ReceiptInput[],auditContext?:AuditContext):Promise<GoodsReceipt>{return this.store.transaction(async(store)=>{
    // A final receipt may be retried after the purchase order transitioned to
    // RECEIVED. The immutable batch match therefore precedes the state guard.
    const retryPurchaseOrder=await store.getPurchaseOrderForUpdate(purchaseOrderId);
    if(retryPurchaseOrder){
      const retryIds=new Set(input.map((item)=>item.purchaseOrderItemId));
      if(input.length&&retryIds.size===input.length&&[...retryIds].every((id)=>retryPurchaseOrder.items.some((item)=>item.id===id))){
        const existingReceipts=await store.listGoodsReceiptsByPurchaseOrder(retryPurchaseOrder.id);
        const exactRetry=existingReceipts.find((receipt)=>receipt.items.length===input.length&&receipt.items.every((line)=>{
          const value=input.find((item)=>item.purchaseOrderItemId===line.purchaseOrderItemId);
          return value!==undefined&&value.acceptedQuantity===line.acceptedQuantity&&value.rejectedQuantity===line.rejectedQuantity&&value.batchNo===line.batchNo&&value.productionDate===line.productionDate&&value.expiresAt===line.expiresAt&&value.inspectionNote===line.inspectionNote&&(value.exceptionReason??null)===line.exceptionReason&&(value.evidenceUrl??null)===line.evidenceUrl;
        }));
        if(exactRetry)return exactRetry;
      }
    }
    const po=await store.getPurchaseOrderForUpdate(purchaseOrderId);if(!po||!['ORDERED','RECEIVING'].includes(po.status))throw new BusinessError('INVALID_STATE_TRANSITION','采购单当前不可验收',409);
    const ids=new Set(input.map((item)=>item.purchaseOrderItemId));if(!input.length||ids.size!==input.length||[...ids].some((id)=>!po.items.some((item)=>item.id===id)))throw new BusinessError('VALIDATION_ERROR','验收批次必须包含不重复的采购单明细',400);
    const receipts=await store.listGoodsReceiptsByPurchaseOrder(po.id);
    const acceptedByItem=new Map<string,number>();for(const receipt of receipts)for(const line of receipt.items)acceptedByItem.set(line.purchaseOrderItemId,(acceptedByItem.get(line.purchaseOrderItemId)??0)+line.acceptedQuantity);
    const beforeInventory=await store.listInventoryBalances(po.warehouseId);const now=this.now();const receipt:GoodsReceipt={id:randomUUID(),receiptNo:`GR${Date.now()}${randomUUID().slice(0,6).toUpperCase()}`,purchaseOrderId:po.id,warehouseId:po.warehouseId,status:input.some((item)=>item.rejectedQuantity>0)?'EXCEPTION':'COMPLETED',receivedBy:actorId,inspectedBy:actorId,receivedAt:now,createdAt:now,items:[]};
    for(const value of input){const purchase=po.items.find((item)=>item.id===value.purchaseOrderItemId)!;const remaining=purchase.plannedQuantity-(acceptedByItem.get(purchase.id)??0);if(value.acceptedQuantity<0||value.rejectedQuantity<0||value.acceptedQuantity+value.rejectedQuantity<=0||value.acceptedQuantity+value.rejectedQuantity>remaining)throw new BusinessError('VALIDATION_ERROR','本次验收数量必须为正且不能超过待补合格数量',400,{purchaseOrderItemId:purchase.id,remaining});if(value.acceptedQuantity>0&&!value.batchNo)throw new BusinessError('VALIDATION_ERROR','合格入库必须提供食品批次号',400);if(value.rejectedQuantity>0&&(!value.exceptionReason||!['SHORT_RECEIPT','QUALITY_REJECTED','PACKAGE_DAMAGED'].includes(value.exceptionReason)||!value.inspectionNote))throw new BusinessError('VALIDATION_ERROR','拒收数量必须说明适用原因和验收说明',400);receipt.items.push({id:randomUUID(),goodsReceiptId:receipt.id,purchaseOrderItemId:purchase.id,acceptedQuantity:value.acceptedQuantity,rejectedQuantity:value.rejectedQuantity,batchNo:value.batchNo,productionDate:value.productionDate,expiresAt:value.expiresAt,qualityResult:value.acceptedQuantity===0?'REJECTED':value.rejectedQuantity===0?'ACCEPTED':'PARTIALLY_ACCEPTED',inspectionNote:value.inspectionNote});acceptedByItem.set(purchase.id,(acceptedByItem.get(purchase.id)??0)+value.acceptedQuantity);}
    for(const line of receipt.items){const submitted=input.find((item)=>item.purchaseOrderItemId===line.purchaseOrderItemId)!;line.exceptionReason=submitted.exceptionReason??null;line.evidenceUrl=submitted.evidenceUrl??null;}
    await store.saveGoodsReceipt(receipt);for(const line of receipt.items){const purchase=po.items.find((item)=>item.id===line.purchaseOrderItemId)!;if(!line.acceptedQuantity)continue;const lotId=randomUUID();await store.saveInventoryLot({id:lotId,warehouseId:po.warehouseId,platformSkuId:purchase.platformSkuId,supplierId:po.supplierId,goodsReceiptItemId:line.id,lotNo:line.batchNo!,productionDate:line.productionDate,expiresAt:line.expiresAt,qualifiedQuantity:line.acceptedQuantity,createdAt:now});await store.appendInventoryMovement({id:randomUUID(),inventoryLotId:lotId,movementType:'RECEIPT',fromBucket:null,toBucket:'QUALIFIED',quantity:line.acceptedQuantity,referenceType:'GOODS_RECEIPT',referenceId:receipt.id,actorId,note:line.inspectionNote,createdAt:now});const payable={id:randomUUID(),supplierId:po.supplierId,purchaseOrderItemId:purchase.id,goodsReceiptItemId:line.id,qualifiedQuantity:line.acceptedQuantity,purchaseUnitCents:purchase.purchaseUnitCents,amountCents:moneyCents(Number(purchase.purchaseUnitCents)*line.acceptedQuantity),status:'PENDING' as const,paymentReference:null,paidAt:null,createdAt:now,updatedAt:now};await store.saveSupplierPayable(payable);await this.ledger.recordSupplierPayable(store,payable);}
    const rejected=input.filter((item)=>item.rejectedQuantity>0);let supplierException:FulfillmentException|null=null;if(rejected.length){supplierException={id:randomUUID(),campaignId:po.campaignId,orderId:null,clientRequestId:null,outboundOrderId:null,deliveryPlanId:null,sourceStage:'SUPPLIER_RECEIPT',status:'WAITING_REPLENISHMENT',responsibility:'SUPPLIER',registeredBy:actorId,confirmedBy:null,resolutionNote:'待补货或由运营确认销售缺货处置',registeredAt:now,confirmedAt:null,items:rejected.map((value)=>{const purchase=po.items.find((item)=>item.id===value.purchaseOrderItemId)!;return{id:randomUUID(),exceptionId:'',platformSkuId:purchase.platformSkuId,expectedQuantity:purchase.plannedQuantity,acceptedQuantity:value.acceptedQuantity,rejectedQuantity:value.rejectedQuantity,shortQuantity:0,damagedQuantity:0,reason:value.exceptionReason!,description:value.inspectionNote!,evidenceUrl:value.evidenceUrl??null};})};supplierException.items.forEach((item)=>item.exceptionId=supplierException!.id);await store.saveFulfillmentException(supplierException);}
    const fullyReceived=po.items.every((item)=>(acceptedByItem.get(item.id)??0)>=item.plannedQuantity);po.status=fullyReceived?'RECEIVED':'RECEIVING';po.updatedAt=now;await store.savePurchaseOrder(po);if(fullyReceived){const skuIds=new Set(po.items.map((item)=>item.platformSkuId));for(const exception of await store.listFulfillmentExceptions('WAITING_REPLENISHMENT'))if(exception.campaignId===po.campaignId&&exception.sourceStage==='SUPPLIER_RECEIPT'&&exception.items.every((item)=>skuIds.has(item.platformSkuId))){exception.status='RESOLVED';exception.confirmedBy=actorId;exception.confirmedAt=now;exception.resolutionNote=`${exception.resolutionNote??''}\n补货验收完成`.slice(0,500);await store.saveFulfillmentException(exception);}}
    const evidence={receipt,purchaseOrder:po,inventory:{before:beforeInventory,after:await store.listInventoryBalances(po.warehouseId)},supplierException};await this.audit(store,auditContext,actorId,'GOODS_RECEIPT_COMPLETED','GOODS_RECEIPT',receipt.id,{purchaseOrderId:po.id,receiptCount:receipts.length},evidence);if(supplierException)await this.audit(store,auditContext,actorId,'FULFILLMENT_EXCEPTION_REGISTERED','FULFILLMENT_EXCEPTION',supplierException.id,null,{exception:supplierException,inventory:evidence.inventory});return receipt;
  });}

  /*
   * Retired implementation kept below temporarily for source-history review.
   * The callable Mode-B receipt path is the immutable multi-batch method above.
   *
  private async receiveSingleBatchLegacy(purchaseOrderId:string,actorId:string,input:ReceiptInput[]):Promise<GoodsReceipt>{return this.store.transaction(async(store)=>{
    const po=await store.getPurchaseOrder(purchaseOrderId); if(!po||!['ORDERED','RECEIVING'].includes(po.status))throw new BusinessError('INVALID_STATE_TRANSITION','采购单当前不可验收',409);
    const existing=await store.getGoodsReceiptByPurchaseOrder(po.id); if(existing)return existing;
    const inputIds=new Set(input.map((item)=>item.purchaseOrderItemId)); if(inputIds.size!==po.items.length||po.items.some((item)=>!inputIds.has(item.id)))throw new BusinessError('VALIDATION_ERROR','必须逐项完成采购单验收',400);
    const now=this.now(); const receipt:GoodsReceipt={id:randomUUID(),receiptNo:`GR${Date.now()}${randomUUID().slice(0,6).toUpperCase()}`,purchaseOrderId:po.id,warehouseId:po.warehouseId,status:input.some((item)=>item.rejectedQuantity>0)?'EXCEPTION':'COMPLETED',receivedBy:actorId,inspectedBy:actorId,receivedAt:now,createdAt:now,items:[]};
    for(const value of input){
      const purchaseItem=po.items.find((item)=>item.id===value.purchaseOrderItemId)!;
      if(value.acceptedQuantity+value.rejectedQuantity!==purchaseItem.plannedQuantity||value.acceptedQuantity<0||value.rejectedQuantity<0)throw new BusinessError('VALIDATION_ERROR','验收数量必须等于采购计划数量',400);
      if(value.acceptedQuantity>0&&!value.batchNo)throw new BusinessError('VALIDATION_ERROR','合格入库必须提供食品批次号',400);
      if(value.rejectedQuantity>0&&(!value.exceptionReason||!['SHORT_RECEIPT','QUALITY_REJECTED','PACKAGE_DAMAGED'].includes(value.exceptionReason)||!value.inspectionNote))throw new BusinessError('VALIDATION_ERROR','拒收数量必须说明适用的异常原因和验收说明',400);
      receipt.items.push({id:randomUUID(),goodsReceiptId:receipt.id,purchaseOrderItemId:value.purchaseOrderItemId,acceptedQuantity:value.acceptedQuantity,rejectedQuantity:value.rejectedQuantity,batchNo:value.batchNo,productionDate:value.productionDate,expiresAt:value.expiresAt,qualityResult:value.acceptedQuantity===0?'REJECTED':value.rejectedQuantity===0?'ACCEPTED':'PARTIALLY_ACCEPTED',inspectionNote:value.inspectionNote});
    }
    await store.saveGoodsReceipt(receipt);
    for(const line of receipt.items){const purchase=po.items.find((item)=>item.id===line.purchaseOrderItemId)!;if(line.acceptedQuantity<=0)continue;const lotId=randomUUID();await store.saveInventoryLot({id:lotId,warehouseId:po.warehouseId,platformSkuId:purchase.platformSkuId,supplierId:po.supplierId,goodsReceiptItemId:line.id,lotNo:line.batchNo!,productionDate:line.productionDate,expiresAt:line.expiresAt,qualifiedQuantity:line.acceptedQuantity,createdAt:now});await store.appendInventoryMovement({id:randomUUID(),inventoryLotId:lotId,movementType:'RECEIPT',fromBucket:null,toBucket:'QUALIFIED',quantity:line.acceptedQuantity,referenceType:'GOODS_RECEIPT',referenceId:receipt.id,actorId,note:line.inspectionNote,createdAt:now});const payable={id:randomUUID(),supplierId:po.supplierId,purchaseOrderItemId:purchase.id,goodsReceiptItemId:line.id,qualifiedQuantity:line.acceptedQuantity,purchaseUnitCents:purchase.purchaseUnitCents,amountCents:moneyCents(Number(purchase.purchaseUnitCents)*line.acceptedQuantity),status:'PENDING' as const,paymentReference:null,paidAt:null,createdAt:now,updatedAt:now};await store.saveSupplierPayable(payable);await this.ledger.recordSupplierPayable(store,payable);}
    const rejected=input.filter((item)=>item.rejectedQuantity>0);
    if(rejected.length){const campaign=await this.campaign(po.campaignId,store);const exception:FulfillmentException={id:randomUUID(),campaignId:campaign.id,orderId:null,clientRequestId:null,outboundOrderId:null,deliveryPlanId:null,sourceStage:'SUPPLIER_RECEIPT',status:'WAITING_REPLENISHMENT',responsibility:'SUPPLIER',registeredBy:actorId,confirmedBy:null,resolutionNote:'待补货或由运营确认销售缺货处置',registeredAt:now,confirmedAt:null,items:rejected.map((value)=>{const purchase=po.items.find((item)=>item.id===value.purchaseOrderItemId)!;return{id:randomUUID(),exceptionId:'',platformSkuId:purchase.platformSkuId,expectedQuantity:purchase.plannedQuantity,acceptedQuantity:value.acceptedQuantity,rejectedQuantity:value.rejectedQuantity,shortQuantity:0,damagedQuantity:0,reason:value.exceptionReason!,description:value.inspectionNote!,evidenceUrl:value.evidenceUrl??null};})};exception.items.forEach((item)=>item.exceptionId=exception.id);await store.saveFulfillmentException(exception);po.status='RECEIVING';}else po.status='RECEIVED'; po.updatedAt=now;await store.savePurchaseOrder(po);return receipt;
  });}

  */
  private async desiredBySku(store:CommerceStore,campaign:Campaign):Promise<Map<string,number>>{const lines=await store.listPlatformSalesLinesByCampaign(campaign.id);return new Map(campaign.platformItems.map((item)=>{const skuLines=lines.filter((line)=>line.platformSkuId===item.platformSkuId);const hasAllocation=skuLines.some((line)=>line.fulfilledQuantity>0||line.exceptionQuantity>0);return[item.platformSkuId,hasAllocation?skuLines.reduce((sum,line)=>sum+line.fulfilledQuantity,0):item.reservedQuantity];}));}
  public async createSorting(campaignId:string,actorId:string):Promise<SortingTask>{return this.store.transaction(async(store)=>{
    const campaign=await this.campaign(campaignId,store);if(campaign.status!=='LOCKED')throw new BusinessError('INVALID_STATE_TRANSITION','未锁单团期不能分拣',409);
    const existing=await store.getSortingTaskByCampaign(campaign.id);if(existing)return existing;
    if((await store.listFulfillmentExceptions()).some((item)=>item.campaignId===campaign.id&&['SUPPLIER_RECEIPT','WAREHOUSE'].includes(item.sourceStage)&&['REGISTERED','WAITING_REPLENISHMENT','TRANSFER_PENDING'].includes(item.status)))throw new BusinessError('FULFILLMENT_EXCEPTION_NOT_READY','供应商或仓库差异仍待补货、调拨或运营处置，不能分拣',409);
    const desired=await this.desiredBySku(store,campaign);const balances=await store.listInventoryBalances(campaign.warehouseId!);const now=this.now();const task:SortingTask={id:randomUUID(),campaignId,warehouseId:campaign.warehouseId!,status:'PENDING',createdBy:actorId,completedBy:null,createdAt:now,completedAt:null,items:[]};
    for(const [skuId,quantityWanted] of desired){let remaining=quantityWanted;for(const balance of balances.filter((value)=>value.platformSkuId===skuId&&value.qualified>0).sort((a,b)=>(a.expiresAt??'9999').localeCompare(b.expiresAt??'9999'))){const quantity=Math.min(remaining,balance.qualified);if(quantity){task.items.push({id:randomUUID(),sortingTaskId:task.id,inventoryLotId:balance.inventoryLotId,platformSkuId:skuId,quantity,createdAt:now});remaining-=quantity;}if(!remaining)break;}if(remaining)throw new BusinessError('WAREHOUSE_STOCK_INSUFFICIENT','中心仓合格批次库存不足，不能分拣',409,{platformSkuId:skuId,missing:remaining});}
    for(const item of task.items)await store.appendInventoryMovement({id:randomUUID(),inventoryLotId:item.inventoryLotId,movementType:'SORT_RESERVED',fromBucket:'QUALIFIED',toBucket:'RESERVED',quantity:item.quantity,referenceType:'SORTING_TASK',referenceId:task.id,actorId,note:null,createdAt:now});await store.saveSortingTask(task);return task;
  });}
  public async completeSorting(campaignId:string,actorId:string):Promise<SortingTask>{return this.store.transaction(async(store)=>{const task=await store.getSortingTaskByCampaign(campaignId);if(!task||task.status!=='PENDING')throw new BusinessError('SORTING_REQUIRED','没有待完成的分拣任务',409);const now=this.now();for(const item of task.items)await store.appendInventoryMovement({id:randomUUID(),inventoryLotId:item.inventoryLotId,movementType:'SORT_COMPLETED',fromBucket:'RESERVED',toBucket:'SORTED',quantity:item.quantity,referenceType:'SORTING_TASK',referenceId:task.id,actorId,note:null,createdAt:now});task.status='COMPLETED';task.completedBy=actorId;task.completedAt=now;await store.saveSortingTask(task);return task;});}
  public async createOutbound(campaignId:string,actorId:string,carrierReference:string|null):Promise<OutboundOrder>{return this.store.transaction(async(store)=>{
    const campaign=await this.campaign(campaignId,store);const task=await store.getSortingTaskByCampaign(campaign.id);const plan=await store.getDeliveryPlanByCampaign(campaign.id);
    if(!task||task.status!=='COMPLETED')throw new BusinessError('SORTING_REQUIRED','分拣完成后才能出库',409);if(!plan||plan.status!=='VEHICLE_BOOKED')throw new BusinessError('DELIVERY_PLAN_NOT_READY','固定自提点和配送预约尚未完成',409);
    const existing=await store.getOutboundOrderByCampaign(campaign.id);if(existing)return existing;const now=this.now();const outbound:OutboundOrder={id:randomUUID(),outboundNo:`OB${Date.now()}${randomUUID().slice(0,6).toUpperCase()}`,campaignId:campaign.id,warehouseId:campaign.warehouseId!,deliveryPlanId:plan.id,sortingTaskId:task.id,status:'DISPATCHED',carrierReference,dispatchedBy:actorId,dispatchedAt:now,items:task.items.map((item)=>({id:randomUUID(),outboundOrderId:'',inventoryLotId:item.inventoryLotId,platformSkuId:item.platformSkuId,quantity:item.quantity})),createdAt:now};outbound.items.forEach((item)=>item.outboundOrderId=outbound.id);
    for(const item of outbound.items)await store.appendInventoryMovement({id:randomUUID(),inventoryLotId:item.inventoryLotId,movementType:'OUTBOUND',fromBucket:'SORTED',toBucket:'OUTBOUND',quantity:item.quantity,referenceType:'OUTBOUND_ORDER',referenceId:outbound.id,actorId,note:carrierReference,createdAt:now});await store.saveOutboundOrder(outbound);plan.status='IN_TRANSIT';plan.dispatchedAt=now;plan.updatedAt=now;await store.saveDeliveryPlan(plan);for(const order of await store.listOrdersByCampaign(campaign.id))if(order.status==='LOCKED'){order.status=transitionOrder(order.status,'ALLOCATING');await store.saveOrderStatus(order);order.status=transitionOrder(order.status,'IN_TRANSIT');await store.saveOrderStatus(order);}campaign.status=transitionCampaign(campaign.status,'FULFILLING');campaign.version+=1;await store.updateCampaign(campaign,campaign.version-1);return outbound;
  });}

  private async allocateException(store:CommerceStore,exception:FulfillmentException):Promise<FulfillmentAllocation[]>{
    const existing=await store.listFulfillmentAllocations(exception.id);if(existing.length)return existing;
    const lines=await store.listPlatformSalesLinesByCampaignForUpdate(exception.campaignId);const allocations:FulfillmentAllocation[]=[];
    for(const item of exception.items){let accepted=item.acceptedQuantity;let affected=item.rejectedQuantity+item.shortQuantity+item.damagedQuantity;for(const line of lines.filter((value)=>value.platformSkuId===item.platformSkuId)){const remaining=line.quantity-line.fulfilledQuantity-line.exceptionQuantity;if(remaining<=0)continue;const fulfilled=Math.min(remaining,accepted);accepted-=fulfilled;const exceptional=Math.min(remaining-fulfilled,affected);affected-=exceptional;if(!fulfilled&&!exceptional)continue;line.fulfilledQuantity+=fulfilled;line.exceptionQuantity+=exceptional;if(!await store.updatePlatformSalesLine(line))throw new BusinessError('CONCURRENT_MODIFICATION','销售明细已被并发更新，请重试',409);allocations.push({id:randomUUID(),exceptionId:exception.id,exceptionItemId:item.id,salesOrderItemId:line.id,orderId:line.orderId,platformSkuId:line.platformSkuId,fulfilledQuantity:fulfilled,exceptionQuantity:exceptional,refundedQuantity:0,createdAt:this.now(),refundedAt:null});}}
    if(allocations.length)await store.saveFulfillmentAllocations(allocations);return allocations;
  }
  private async markReadyOrders(store:CommerceStore,campaignId:string):Promise<void>{for(const summary of await store.listOrdersByCampaign(campaignId)){if(summary.status!=='IN_TRANSIT')continue;const order=await store.getOrderForUpdate(summary.id);if(!order||!order.items.some((item)=>item.fulfilledQuantity>0))continue;order.status=transitionOrder(order.status,'READY_FOR_PICKUP');await store.saveOrderStatus(order);await store.savePickupCredential({orderId:order.id,codeHash:this.pickupHash(order.id),status:'ACTIVE',expiresAt:new Date(Date.now()+14*86_400_000).toISOString()});}}
  private async markNormalFulfillment(store:CommerceStore,campaignId:string):Promise<void>{for(const line of await store.listPlatformSalesLinesByCampaign(campaignId)){if(line.fulfilledQuantity||line.exceptionQuantity)continue;line.fulfilledQuantity=line.quantity;if(!await store.updatePlatformSalesLine(line))throw new BusinessError('CONCURRENT_MODIFICATION','销售明细已被并发更新，请重试',409);}}

  public async handover(outboundId:string,actorId:string,input:HandoverInput,auditContext?:AuditContext):Promise<PickupHandover>{return this.store.transaction(async(store)=>{
    const outbound=await store.getOutboundOrderForUpdate(outboundId);const beforeOutbound=outbound?structuredClone(outbound):null;
    if(!outbound)throw new BusinessError('RESOURCE_NOT_FOUND','出库单不存在',404);const existing=await store.getPickupHandoverByOutbound(outbound.id);if(existing)return existing;if(outbound.status!=='DISPATCHED')throw new BusinessError('INVALID_STATE_TRANSITION','出库单当前不可交接',409);
    const expected=new Map<string,number>();for(const item of outbound.items)expected.set(item.platformSkuId,(expected.get(item.platformSkuId)??0)+item.quantity);const supplied=new Map(input.items.map((item)=>[item.platformSkuId,item]));
    if(supplied.size!==expected.size||[...expected.keys()].some((sku)=>!supplied.has(sku)))throw new BusinessError('VALIDATION_ERROR','点位交接必须逐商品记录实到与差异数量',400);
    for(const [sku,quantity] of expected){const item=supplied.get(sku)!;if(item.receivedQuantity+item.rejectedQuantity+item.shortQuantity+item.damagedQuantity!==quantity||[item.receivedQuantity,item.rejectedQuantity,item.shortQuantity,item.damagedQuantity].some((value)=>value<0))throw new BusinessError('VALIDATION_ERROR','交接数量必须等于应交数量',400);if(item.rejectedQuantity+item.shortQuantity+item.damagedQuantity>0&&(!item.reason||!['TRANSIT_SHORTAGE','TRANSIT_DAMAGE','WRONG_POINT','PICKUP_POINT_REJECTED'].includes(item.reason)||!item.evidenceNote))throw new BusinessError('VALIDATION_ERROR','存在交接差异时必须填写适用原因与证据说明',400);}
    const beforeInventory=await store.listInventoryBalances(outbound.warehouseId);const now=this.now();const hasException=input.items.some((item)=>item.rejectedQuantity+item.shortQuantity+item.damagedQuantity>0);const handover:PickupHandover={id:randomUUID(),outboundOrderId:outbound.id,deliveryPlanId:outbound.deliveryPlanId,status:hasException?'EXCEPTION':'COMPLETED',handedOverBy:actorId,receivedBy:input.receivedBy,exceptionNote:input.exceptionNote,handedOverAt:now,items:[...expected.entries()].map(([platformSkuId,expectedQuantity])=>{const item=supplied.get(platformSkuId)!;return{id:randomUUID(),pickupHandoverId:'',platformSkuId,expectedQuantity,receivedQuantity:item.receivedQuantity,rejectedQuantity:item.rejectedQuantity,shortQuantity:item.shortQuantity,damagedQuantity:item.damagedQuantity,reason:item.reason,evidenceNote:item.evidenceNote};}),createdAt:now};handover.items.forEach((item)=>item.pickupHandoverId=handover.id);
    let exception:FulfillmentException|null=null;if(hasException){exception={id:randomUUID(),campaignId:outbound.campaignId,orderId:null,clientRequestId:null,outboundOrderId:outbound.id,deliveryPlanId:outbound.deliveryPlanId,sourceStage:'PICKUP_HANDOVER',status:'REGISTERED',responsibility:'PENDING',registeredBy:actorId,confirmedBy:null,resolutionNote:null,registeredAt:now,confirmedAt:null,items:handover.items.filter((item)=>item.rejectedQuantity+item.shortQuantity+item.damagedQuantity>0).map((item)=>({id:randomUUID(),exceptionId:'',platformSkuId:item.platformSkuId,expectedQuantity:item.expectedQuantity,acceptedQuantity:item.receivedQuantity,rejectedQuantity:item.rejectedQuantity,shortQuantity:item.shortQuantity,damagedQuantity:item.damagedQuantity,reason:item.reason!,description:item.evidenceNote!,evidenceUrl:supplied.get(item.platformSkuId)?.evidenceUrl??null}))};exception.items.forEach((item)=>item.exceptionId=exception!.id);await store.saveFulfillmentException(exception);}
    for(const item of outbound.items){const reported=supplied.get(item.platformSkuId)!;const previous=outbound.items.filter((value)=>value.platformSkuId===item.platformSkuId).filter((value)=>value.id<item.id).reduce((sum,value)=>sum+value.quantity,0);const accepted=Math.max(0,Math.min(item.quantity,reported.receivedQuantity-previous));if(accepted)await store.appendInventoryMovement({id:randomUUID(),inventoryLotId:item.inventoryLotId,movementType:'HANDOVER',fromBucket:'OUTBOUND',toBucket:'HANDED_OVER',quantity:accepted,referenceType:'PICKUP_HANDOVER',referenceId:handover.id,actorId,note:input.exceptionNote,createdAt:now});if(item.quantity>accepted)await store.appendInventoryMovement({id:randomUUID(),inventoryLotId:item.inventoryLotId,movementType:'QUARANTINE',fromBucket:'OUTBOUND',toBucket:'QUARANTINE',quantity:item.quantity-accepted,referenceType:'FULFILLMENT_EXCEPTION',referenceId:exception?.id??handover.id,actorId,note:input.exceptionNote,createdAt:now});}
    await store.savePickupHandover(handover);outbound.status=hasException?'EXCEPTION':'HANDED_OVER';await store.saveOutboundOrder(outbound);const plan=await store.getDeliveryPlan(outbound.deliveryPlanId);if(!plan)throw new BusinessError('FULFILLMENT_PLAN_MISSING','配送计划不存在',409);plan.status='ARRIVED';plan.arrivedAt=now;plan.updatedAt=now;await store.saveDeliveryPlan(plan);
    // Allocate the exceptional SKU first. Only after that may the unaffected
    // sales lines be marked fulfilled; doing this in the opposite order makes
    // an exception consume the entire order's remaining quantity and silently
    // leaves normal SKUs out of the pickup entitlement.
    if(exception)await this.allocateException(store,exception);
    await this.markNormalFulfillment(store,outbound.campaignId);
    await this.markReadyOrders(store,outbound.campaignId);
    const inventory={before:beforeInventory,after:await store.listInventoryBalances(outbound.warehouseId)};await this.audit(store,auditContext,actorId,'PICKUP_HANDOVER_COMPLETED','PICKUP_HANDOVER',handover.id,{outbound:beforeOutbound},{handover,outbound,inventory});if(exception)await this.audit(store,auditContext,actorId,'FULFILLMENT_EXCEPTION_REGISTERED','FULFILLMENT_EXCEPTION',exception.id,null,{exception,inventory});
    return handover;
  });}

  /** Operator alone turns factual discrepancy evidence into a refund instruction. Finance still executes the money movement separately. */
  public async decideException(exceptionId:string,actorId:string,input:ExceptionDecision,auditContext?:AuditContext):Promise<FulfillmentException>{return this.store.transaction(async(store)=>{
    const exception=await store.getFulfillmentExceptionForUpdate(exceptionId);if(!exception||!['REGISTERED','WAITING_REPLENISHMENT','TRANSFER_PENDING'].includes(exception.status))throw new BusinessError('INVALID_STATE_TRANSITION','异常当前不可处置',409);
    const before=structuredClone(exception);exception.responsibility=input.responsibility;exception.confirmedBy=actorId;exception.confirmedAt=this.now();exception.resolutionNote=input.note;
    if(input.resolution==='WAITING_REPLENISHMENT'){exception.status='WAITING_REPLENISHMENT';await store.saveFulfillmentException(exception);await this.audit(store,auditContext,actorId,'FULFILLMENT_EXCEPTION_DECIDED','FULFILLMENT_EXCEPTION',exception.id,before,exception);return exception;}
    if(input.resolution==='TRANSFER_PENDING'){exception.status='TRANSFER_PENDING';await store.saveFulfillmentException(exception);await this.audit(store,auditContext,actorId,'FULFILLMENT_EXCEPTION_DECIDED','FULFILLMENT_EXCEPTION',exception.id,before,exception);return exception;}
    if(exception.items.some((item)=>item.reason==='WRONG_POINT')){
      const plan=exception.deliveryPlanId?await store.getDeliveryPlan(exception.deliveryPlanId):null;
      const campaign=await store.getCampaign(exception.campaignId);
      const promisedAt=campaign?.businessModelVersion==='PLATFORM_COMMUNITY'?plan?.estimatedArrivalAt:plan?.arrivalEndAt;
      if(!promisedAt||Date.parse(promisedAt)>Date.now())throw new BusinessError('INVALID_STATE_TRANSITION','错点货物必须优先调拨并完成复验；仅在承诺到货窗口结束后才能确认退款',409);
    }
    const allocations=await this.allocateException(store,exception);exception.status=allocations.some((item)=>item.exceptionQuantity>0)?'REFUND_CONFIRMED':'RESOLVED';await store.saveFulfillmentException(exception);await this.audit(store,auditContext,actorId,'FULFILLMENT_EXCEPTION_DECIDED','FULFILLMENT_EXCEPTION',exception.id,before,{exception,allocations});return exception;
  });}

  /** Wrong-point cargo is never made sellable again. A fixed-point reinspection can only restore it from quarantine to handed-over and its original pickup entitlement. */
  public async reinspectWrongPointTransfer(exceptionId:string,actorId:string,input:TransferReinspectionInput,bypassFixedPointAssignment=false,auditContext?:AuditContext):Promise<FulfillmentException>{return this.store.transaction(async(store)=>{
    const exception=await store.getFulfillmentExceptionForUpdate(exceptionId);
    if(!exception||exception.status!=='TRANSFER_PENDING'||!exception.outboundOrderId||!exception.deliveryPlanId||!exception.items.length)throw new BusinessError('INVALID_STATE_TRANSITION','仅待调拨异常可以完成复验交接',409);
    const before=structuredClone(exception);const plan=await store.getDeliveryPlan(exception.deliveryPlanId);const point=plan?.pickupPointId?(await store.listPickupPoints()).find((item)=>item.id===plan.pickupPointId):null;const actor=await store.getUser(actorId);if(!plan?.pickupPointId||!point||point.status!=='ACTIVE'||!actor||actor.status!=='ACTIVE')throw new BusinessError('FORBIDDEN','当前复验人员或固定自提点不可用',403);if(!bypassFixedPointAssignment&&!(await store.hasActivePickupVerifierAssignment(actorId,plan.pickupPointId)))throw new BusinessError('FORBIDDEN','当前人员未获团期固定自提点的复验授权',403);
    const wrongPointItems=exception.items.filter((item)=>item.reason==='WRONG_POINT');
    if(!wrongPointItems.length)throw new BusinessError('INVALID_STATE_TRANSITION','该异常不包含可调拨的错点货物',409);
    const requested=new Map(input.items.map((item)=>[item.platformSkuId,item.acceptedQuantity]));
    if(requested.size!==wrongPointItems.length||wrongPointItems.some((item)=>requested.get(item.platformSkuId)!==(item.rejectedQuantity+item.shortQuantity+item.damagedQuantity)))throw new BusinessError('VALIDATION_ERROR','复验数量必须逐项等于错点异常数量',400);
    const campaign=await this.campaign(exception.campaignId,store);const outbound=await store.getOutboundOrderForUpdate(exception.outboundOrderId);
    if(!outbound||outbound.id!==exception.outboundOrderId)throw new BusinessError('RESOURCE_NOT_FOUND','错点异常对应出库单不存在',404);
    const lines=await store.listPlatformSalesLinesByCampaignForUpdate(campaign.id);
    const allocations=await store.listFulfillmentAllocations(exception.id);if(!allocations.length)throw new BusinessError('FULFILLMENT_EXCEPTION_NOT_READY','错点异常没有可恢复的销售分配',409);
    const allocationUpdates:FulfillmentAllocation[]=[];
    for(const item of wrongPointItems){
      let remaining=requested.get(item.platformSkuId)!;
      for(const allocation of allocations.filter((value)=>value.platformSkuId===item.platformSkuId).sort((left,right)=>left.id.localeCompare(right.id))){
        if(!remaining)break;const restore=Math.min(remaining,allocation.exceptionQuantity-allocation.refundedQuantity);if(!restore)continue;
        const line=lines.find((value)=>value.id===allocation.salesOrderItemId);if(!line)throw new BusinessError('FINANCIAL_INCONSISTENT','错点异常对应销售明细不存在',500);
        line.fulfilledQuantity+=restore;line.exceptionQuantity-=restore;
        if(!await store.updatePlatformSalesLine(line))throw new BusinessError('CONCURRENT_MODIFICATION','销售明细已被并发更新，请重试',409);
        allocationUpdates.push({...allocation,fulfilledQuantity:allocation.fulfilledQuantity+restore,exceptionQuantity:allocation.exceptionQuantity-restore});remaining-=restore;
      }
      if(remaining)throw new BusinessError('CONCURRENT_MODIFICATION','错点异常分配已变化，不能恢复取货权益',409);
    }
    if(!(await store.updateFulfillmentAllocations(allocationUpdates)))throw new BusinessError('CONCURRENT_MODIFICATION','错点异常分配已被并发处理，请重试',409);
    const balances=await store.listInventoryBalances(campaign.warehouseId!);const beforeInventory=structuredClone(balances);const now=this.now();
    for(const item of wrongPointItems){let remaining=requested.get(item.platformSkuId)!;for(const balance of balances.filter((value)=>value.platformSkuId===item.platformSkuId&&value.quarantine>0).sort((a,b)=>a.inventoryLotId.localeCompare(b.inventoryLotId))){const quantity=Math.min(remaining,balance.quarantine);if(quantity)await store.appendInventoryMovement({id:randomUUID(),inventoryLotId:balance.inventoryLotId,movementType:'HANDOVER',fromBucket:'QUARANTINE',toBucket:'HANDED_OVER',quantity,referenceType:'FULFILLMENT_EXCEPTION_REINSPECTION',referenceId:exception.id,actorId,note:input.evidenceNote,createdAt:now});remaining-=quantity;if(!remaining)break;}if(remaining)throw new BusinessError('INVENTORY_INCONSISTENT','错点货物隔离库存不足，不能恢复取货权益',500,{platformSkuId:item.platformSkuId,missing:remaining});}
    const hasOtherUnresolvedItems=exception.items.some((item)=>item.reason!=='WRONG_POINT'&&(item.rejectedQuantity+item.shortQuantity+item.damagedQuantity)>0);
    exception.status=hasOtherUnresolvedItems?'REGISTERED':'RESOLVED';exception.confirmedBy=actorId;exception.confirmedAt=now;exception.resolutionNote=`${exception.resolutionNote??''}${exception.resolutionNote?'\n':''}调拨复验完成：${input.evidenceNote}`.slice(0,500);await store.saveFulfillmentException(exception);
    outbound.status=hasOtherUnresolvedItems?'EXCEPTION':'HANDED_OVER';await store.saveOutboundOrder(outbound);await this.markReadyOrders(store,campaign.id);await this.audit(store,auditContext,actorId,'FULFILLMENT_EXCEPTION_TRANSFER_REINSPECTED','FULFILLMENT_EXCEPTION',exception.id,before,{exception,inventory:{before:beforeInventory,after:await store.listInventoryBalances(campaign.warehouseId!)}});return exception;
  });}

  /** Warehouse workers record factual loss or damage; only operations can later decide the customer remedy. */
  public async registerWarehouseException(campaignId:string,actorId:string,items:WarehouseExceptionInput,auditContext?:AuditContext):Promise<FulfillmentException>{return this.store.transaction(async(store)=>{
    const campaign=await this.campaign(campaignId,store);if(campaign.status!=='LOCKED')throw new BusinessError('INVALID_STATE_TRANSITION','仓库差异只能在锁单后、分拣前登记',409);if(await store.getSortingTaskByCampaign(campaign.id))throw new BusinessError('INVALID_STATE_TRANSITION','分拣任务已创建，请按后续履约异常流程处理',409);
    const skuIds=new Set(campaign.platformItems.map((item)=>item.platformSkuId));const seen=new Set<string>();for(const item of items){if(!skuIds.has(item.platformSkuId)||seen.has(item.platformSkuId))throw new BusinessError('VALIDATION_ERROR','仓库异常商品必须属于团期且不能重复',400);seen.add(item.platformSkuId);}
    const paidDemand=await store.listPlatformSalesLinesByCampaignForUpdate(campaign.id);
    const existing=await store.listFulfillmentExceptions();
    const expectedBySku=new Map<string,number>();for(const line of paidDemand)expectedBySku.set(line.platformSkuId,(expectedBySku.get(line.platformSkuId)??0)+line.quantity);
    for(const item of items){
      const expected=expectedBySku.get(item.platformSkuId)??0;
      if(!expected)throw new BusinessError('VALIDATION_ERROR','仓库异常商品没有已付款销售需求，不能登记差异',400,{platformSkuId:item.platformSkuId});
      if(item.shortQuantity+item.damagedQuantity>expected)throw new BusinessError('VALIDATION_ERROR','仓库异常数量不能超过已付款销售需求',400,{platformSkuId:item.platformSkuId,expectedQuantity:expected});
      if(existing.some((value)=>value.campaignId===campaign.id&&value.sourceStage==='WAREHOUSE'&&value.status!=='RESOLVED'&&value.items.some((row)=>row.platformSkuId===item.platformSkuId)))throw new BusinessError('FULFILLMENT_EXCEPTION_NOT_READY','该商品已有未解决的仓库异常，不能重复登记',409,{platformSkuId:item.platformSkuId});
    }
    const now=this.now();const exception:FulfillmentException={id:randomUUID(),campaignId:campaign.id,orderId:null,clientRequestId:null,outboundOrderId:null,deliveryPlanId:null,sourceStage:'WAREHOUSE',status:'REGISTERED',responsibility:'WAREHOUSE',registeredBy:actorId,confirmedBy:null,resolutionNote:null,registeredAt:now,confirmedAt:null,items:items.map((item)=>{const expectedQuantity=expectedBySku.get(item.platformSkuId)!;return{id:randomUUID(),exceptionId:'',platformSkuId:item.platformSkuId,expectedQuantity,acceptedQuantity:expectedQuantity-item.shortQuantity-item.damagedQuantity,rejectedQuantity:0,shortQuantity:item.shortQuantity,damagedQuantity:item.damagedQuantity,reason:item.reason,description:item.description,evidenceUrl:item.evidenceUrl};})};exception.items.forEach((item)=>item.exceptionId=exception.id);
    const balances=await store.listInventoryBalances(campaign.warehouseId!);for(const item of exception.items){let damaged=item.damagedQuantity;for(const balance of balances.filter((value)=>value.platformSkuId===item.platformSkuId&&value.qualified>0).sort((left,right)=>(left.expiresAt??'9999').localeCompare(right.expiresAt??'9999'))){if(!damaged)break;const quantity=Math.min(damaged,balance.qualified);await store.appendInventoryMovement({id:randomUUID(),inventoryLotId:balance.inventoryLotId,movementType:'QUARANTINE',fromBucket:'QUALIFIED',toBucket:'QUARANTINE',quantity,referenceType:'FULFILLMENT_EXCEPTION',referenceId:exception.id,actorId,note:item.description,createdAt:now});damaged-=quantity;}if(damaged)throw new BusinessError('WAREHOUSE_STOCK_INSUFFICIENT','仓内破损数量超过当前合格批次库存',409,{platformSkuId:item.platformSkuId,missing:damaged});}
    await store.saveFulfillmentException(exception);await this.audit(store,auditContext,actorId,'WAREHOUSE_EXCEPTION_REGISTERED','FULFILLMENT_EXCEPTION',exception.id,null,{exception,inventory:{before:balances,after:await store.listInventoryBalances(campaign.warehouseId!)}});return exception;
  });}

  /** A user may report only a factual picked-up quality/quantity issue. Operations still decides the outcome. */
  public async registerCustomerClaim(orderId:string,userId:string,input:CustomerClaimInput,auditContext?:CustomerClaimAuditContext):Promise<FulfillmentException>{return this.store.transaction(async(store)=>{
    const order=await store.getOrderForUpdate(orderId);if(!order||order.userId!==userId)throw new BusinessError('RESOURCE_NOT_FOUND','订单不存在',404);
    if(order.businessModelVersion==='LEGACY_MARKETPLACE'||order.paymentRoute!=='PLATFORM_DIRECT'||!['PICKED_UP','COMPLETED'].includes(order.status))throw new BusinessError('INVALID_STATE_TRANSITION','只有模式 B 已领取订单可以登记商品异常',409);
    const duplicate=await store.getFulfillmentExceptionByOrderRequestForUpdate(order.id,input.clientRequestId);if(duplicate)return duplicate;
    const ids=new Set(input.items.map((item)=>item.platformSkuId));if(ids.size!==input.items.length)throw new BusinessError('VALIDATION_ERROR','同一商品请合并为一条异常申报',400);
    const now=this.now();const exception:FulfillmentException={id:randomUUID(),campaignId:order.campaignId,orderId:order.id,clientRequestId:input.clientRequestId,outboundOrderId:null,deliveryPlanId:order.deliveryPlanId,sourceStage:'CUSTOMER_CLAIM',status:'REGISTERED',responsibility:'PENDING',registeredBy:userId,confirmedBy:null,resolutionNote:null,registeredAt:now,confirmedAt:null,items:[]};const allocations:FulfillmentAllocation[]=[];const salesLines:Array<{before:unknown;after:unknown}>=[];
    for(const claimed of input.items){const line=order.items.find((item)=>item.salesOrderItemId&&item.skuId===claimed.platformSkuId);if(!line||!line.salesOrderItemId||claimed.quantity>line.fulfilledQuantity)throw new BusinessError('VALIDATION_ERROR','申报数量不能超过当前已领取的合格数量',400,{platformSkuId:claimed.platformSkuId});const before={id:line.salesOrderItemId,fulfilledQuantity:line.fulfilledQuantity,exceptionQuantity:line.exceptionQuantity,refundedQuantity:line.refundedQuantity,refundedAmountCents:line.refundedAmountCents};line.fulfilledQuantity-=claimed.quantity;line.exceptionQuantity+=claimed.quantity;const persisted={id:line.salesOrderItemId,orderId:order.id,platformSkuId:line.skuId,quantity:line.quantity,unitPriceCents:line.unitPriceCents,purchaseUnitCents:line.purchaseUnitCents??moneyCents(0),amountCents:line.amountCents,fulfilledQuantity:line.fulfilledQuantity,pickedUpQuantity:line.pickedUpQuantity,exceptionQuantity:line.exceptionQuantity,refundedQuantity:line.refundedQuantity,refundedAmountCents:line.refundedAmountCents,paidAt:order.paidAt};if(!await store.updatePlatformSalesLine(persisted))throw new BusinessError('CONCURRENT_MODIFICATION','订单明细已被并发更新，请刷新后重试',409);salesLines.push({before,after:{id:persisted.id,fulfilledQuantity:persisted.fulfilledQuantity,exceptionQuantity:persisted.exceptionQuantity,refundedQuantity:persisted.refundedQuantity,refundedAmountCents:persisted.refundedAmountCents}});const item:FulfillmentExceptionItem={id:randomUUID(),exceptionId:exception.id,platformSkuId:claimed.platformSkuId,expectedQuantity:claimed.quantity,acceptedQuantity:0,rejectedQuantity:claimed.reason==='PICKUP_SHORTAGE'?claimed.quantity:0,shortQuantity:claimed.reason==='PICKUP_SHORTAGE'?claimed.quantity:0,damagedQuantity:claimed.reason==='PICKUP_SHORTAGE'?0:claimed.quantity,reason:claimed.reason,description:claimed.description,evidenceUrl:claimed.evidenceUrl};exception.items.push(item);allocations.push({id:randomUUID(),exceptionId:exception.id,exceptionItemId:item.id,salesOrderItemId:line.salesOrderItemId,orderId:order.id,platformSkuId:line.skuId,fulfilledQuantity:0,exceptionQuantity:claimed.quantity,refundedQuantity:0,createdAt:now,refundedAt:null});}
    await store.saveFulfillmentException(exception);await store.saveFulfillmentAllocations(allocations);await this.audit(store,auditContext,userId,'FULFILLMENT_EXCEPTION_CUSTOMER_CLAIMED','FULFILLMENT_EXCEPTION',exception.id,null,{exception,allocations,salesLines});return exception;
  });}
}
