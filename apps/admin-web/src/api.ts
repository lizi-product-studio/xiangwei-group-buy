export type CampaignStatus='DRAFT'|'SCHEDULED'|'OPEN'|'CLOSING'|'LOCKED'|'FULFILLING'|'COMPLETED'|'POSTPONED'|'CANCELLED';
export interface Campaign{id:string;title:string;serviceAreaId:string;cutoffAt:string;dispatchAt:string;minTotalQuantity:number;failureAction:'CANCEL_AND_REFUND'|'POSTPONE';businessModelVersion:'LEGACY_MARKETPLACE'|'PLATFORM_PROCUREMENT'|'PLATFORM_COMMUNITY';skuIds:string[];items?:Array<{skuId:string;title:string;skuName:string;unitPriceCents?:number;stock?:number;soldQuantity?:number}>;status:CampaignStatus;version:number}
export interface PlatformSupplier{id:string;name:string;status:'DRAFT'|'ACTIVE'|'SUSPENDED';contactName:string|null;contactPhone:string|null}
export interface PlatformWarehouse{id:string;name:string;address:string;status:'ACTIVE'|'SUSPENDED'}
export interface PlatformSku{id:string;productId:string;name:string;retailPriceCents:number;defaultSellableQuantity?:number;referencePurchaseCostCents?:number|null;supplierNote?:string|null;status:'ACTIVE'|'INACTIVE';product:{title:string;category:string;origin:string;imageUrl:string|null}}
export interface SupplierOffer{id:string;supplierId:string;platformSkuId:string;purchasePriceCents:number|null;minimumPurchaseQuantity:number;leadTimeDays:number;status:'DRAFT'|'ACTIVE'|'SUSPENDED'}
export interface PurchaseOrder{id:string;purchaseNo:string;campaignId:string;supplierId?:string;warehouseId:string;status:string;items:Array<{id:string;platformSkuId:string;plannedQuantity:number;acceptedQuantity?:number;remainingQuantity?:number;purchaseUnitCents?:number}>}
export interface SortingTask{id:string;campaignId:string;warehouseId:string;status:'PENDING'|'COMPLETED'|'CANCELLED';createdAt:string;completedAt:string|null;items:Array<{id:string;platformSkuId:string;quantity:number}>}
export interface OutboundOrder{id:string;outboundNo:string;campaignId:string;deliveryPlanId:string;status:'CREATED'|'DISPATCHED'|'HANDED_OVER'|'EXCEPTION'|'CANCELLED';carrierReference:string|null;items:Array<{platformSkuId:string;quantity:number}>}
export interface InventoryBalance{inventoryLotId:string;platformSkuId:string;warehouseId:string;lotNo:string;expiresAt:string|null;qualified:number;reserved:number;sorted:number;outbound:number;handedOver:number;quarantine:number}
export interface FulfillmentException{id:string;campaignId:string;sourceStage:string;status:string;responsibility:'SUPPLIER'|'WAREHOUSE'|'CARRIER'|'PICKUP_POINT'|'PLATFORM'|'PENDING';registeredAt:string;resolutionNote:string|null;refundableAmountCents:number;refundedAmountCents:number;refundBreakdown:Array<{orderId:string;orderNo:string;salesOrderItemId:string;productName:string;skuName:string;platformSkuId:string;orderTotalCents:number;orderRefundedAmountCents:number;orderRefundInFlightAmountCents:number;orderRefundableBalanceCents:number;exceptionQuantity:number;refundedQuantity:number;refundableQuantity:number;unitPriceCents:number;refundableAmountCents:number;refundedAmountCents:number}>;items:Array<{platformSkuId:string;expectedQuantity:number;acceptedQuantity:number;rejectedQuantity:number;shortQuantity:number;damagedQuantity:number;reason:string;description:string}>}
export interface SupplierPayable{id:string;supplierId:string;qualifiedQuantity:number;purchaseUnitCents:number;amountCents:number;status:'PENDING'|'PAID'|'VOID'}
export interface Merchant{id:string;name:string;status:'PENDING'|'ACTIVE'|'SUSPENDED'|'REJECTED';defaultCommissionBps:number;wechatSubMchid:string|null;createdAt:string}
export interface Product{id:string;merchantId:string;title:string;category:string;origin:string;imageUrl:string|null;status:'DRAFT'|'PENDING_REVIEW'|'APPROVED'|'REJECTED'|'OFF_SHELF';createdAt:string;sku:{id:string;name:string;unitPriceCents:number;stock:number;soldQuantity:number;commissionRateBps:number}}
export interface ServiceArea{id:string;regionCode:string;name:string;status:'ENABLED'|'DISABLED';orderEnabled:boolean;createdAt:string}
export interface RegionDirectoryEntry{regionCode:string;name:string;provinceCode:string;provinceName:string;cityCode:string;cityName:string;path:string}
export interface PickupPoint{id:string;serviceAreaId:string;name:string;address:string;status:'PENDING'|'ACTIVE'|'SUSPENDED'|'REJECTED';capacityPerDay:number|null;createdAt:string}
export interface NetworkPreset{id:'BAODING_COUNTIES';name:string;description:string;totalCities:number;activeCities:number}
export interface NetworkActivationResult{presetId:string;created:number;skipped:number;total:number;areas:ServiceArea[]}
export interface BatchPickupResult{created:number;skipped:number;total:number;points:PickupPoint[]}
export interface DeliveryPlan{id:string;campaignId:string;serviceAreaId:string;pickupPointId:string|null;status:'PENDING_SITE'|'SITE_CONFIRMED'|'VEHICLE_BOOKED'|'IN_TRANSIT'|'ARRIVED';siteName:string|null;address:string|null;arrivalStartAt:string|null;arrivalEndAt:string|null;contactName:string|null;contactPhone:string|null;vehicleOrderNo:string|null;driverName:string|null;driverPhone:string|null;vehiclePlate:string|null;logisticsPlatform?:string|null;estimatedArrivalAt?:string|null;remark:string|null;confirmedAt:string|null;bookedAt:string|null;dispatchedAt:string|null;arrivedAt:string|null;createdAt:string;updatedAt:string}
export interface CommunityDelivery{id:string;campaignId:string;campaignTitle:string;pickupPointId:string|null;status:DeliveryPlan['status'];siteName:string|null;address:string|null;vehicleOrderNo:string|null;logisticsPlatform:string|null;driverName:string|null;vehiclePlate:string|null;estimatedArrivalAt:string|null;dispatchedAt:string|null;arrivedAt:string|null;dispatchBatchId:string|null;arrivalConfirmed:boolean;expectedItems:Array<{platformSkuId:string;title:string;skuName:string;expectedQuantity:number}>}
export interface Order{id:string;orderNo:string;campaignId:string;serviceAreaId:string;pickupPointId:string;deliveryPlanId:string;status:string;totalCents:number;commissionCents:number;createdAt:string;paidAt:string|null;items:Array<{name:string;quantity:number}>}
export interface PickupOrderLookup{id:string;orderNo:string;deliveryPlanId:string;status:string;items:Array<{skuId:string;name:string;quantity:number;readyQuantity:number;alreadyPickedQuantity:number;remainingPickupQuantity:number;exceptionQuantity:number}>}
/** Append-only point-access event. The UI derives current access from the latest event per user and point. */
export interface PickupVerifierAssignment{id:string;userId:string;pickupPointId:string;action:'GRANTED'|'REVOKED';createdAt:string}
export interface PickupVerifierAssignmentChange{userId:string;pickupPointId:string;active:boolean;changed:boolean}
export interface DispatchBatch{id:string;campaignId:string;serviceAreaId:string;status:'DRAFT'|'IN_TRANSIT'|'ARRIVED'|'CLOSED';createdAt:string;dispatchedAt:string|null;arrivedAt:string|null}
export interface Settlement{id:string;orderId:string;outOrderNo:string;status:'CREATED'|'PROCESSING'|'SUCCEEDED'|'FAILED';commissionCents:number;merchantReceivableCents:number;createdAt:string}
export interface Refund{id:string;orderId:string;providerRefundNo:string;status:'CREATED'|'PROCESSING'|'SUCCEEDED'|'FAILED';amountCents:number;createdAt:string}
export interface LedgerTransaction{id:string;referenceId:string;eventType:string;createdAt:string;lines:Array<{accountCode:string;ownerId:string|null;direction:'DEBIT'|'CREDIT';amountCents:number}>}
export interface AuditLog{id:string;actorId:string;action:string;resourceType:string;resourceId:string;createdAt:string}
export interface ServiceAreaInterest{id:string;userId:string;regionText:string;contactName:string;contactPhone:string;privacyVersion:string|null;privacyConsentedAt:string|null;status:'NEW'|'CONTACTED'|'CLOSED';createdAt:string}
export interface AfterSale{id:string;userId:string;orderId:string;reason:string;description:string;status:'SUBMITTED'|'PROCESSING'|'RESOLVED'|'REJECTED';resolutionType:'FULL_REFUND'|'REJECTED'|null;refundAmountCents:number|null;refundIds:string[];resolvedBy:string|null;resolutionNote:string|null;resolvedAt:string|null;createdAt:string;updatedAt:string}
export interface OrderNotification{id:string;eventKey:string;userId:string;orderId:string;type:'SITE_CONFIRMED'|'VEHICLE_DISPATCHED'|'ARRIVED';title:string;content:string;status:'PENDING_DELIVERY'|'WECHAT_SENT'|'IN_APP_AVAILABLE'|'MANUAL_REQUIRED'|'MANUAL_COMPLETED';readAt:string|null;manualCompletedAt:string|null;createdAt:string}

export interface CreateCampaignPayload{title:string;serviceAreaId:string;cutoffAt:string;dispatchAt:string;minTotalQuantity:number;failureAction:'CANCEL_AND_REFUND'|'POSTPONE';skuIds:string[]}
interface ApiEnvelope<T>{data:T}
interface ApiErrorEnvelope{code?:string;message?:string;requestId?:string}
const TOKEN_KEY='hometown-admin-token';
const ROLES_KEY='hometown-admin-roles';
export const requiresLogin=import.meta.env.PROD||import.meta.env.VITE_AUTH_MODE==='bearer';
export const auth={token:()=>localStorage.getItem(TOKEN_KEY),roles:():string[]=>{try{const value=JSON.parse(localStorage.getItem(ROLES_KEY)??'[]');return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}catch{return[];}},save:(token:string,roles:string[]=[])=>{localStorage.setItem(TOKEN_KEY,token);localStorage.setItem(ROLES_KEY,JSON.stringify(roles));},clear:()=>{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(ROLES_KEY);}};

function headers(json=true):HeadersInit{
  const value:Record<string,string>={};
  if(json)value['content-type']='application/json';
  if(requiresLogin){const token=auth.token();if(token)value.authorization=`Bearer ${token}`;}
  else{value['x-demo-user-id']='demo-super-admin';value['x-demo-role']='SUPER_ADMIN';}
  return value;
}

async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(path,{...init,headers:{...headers(init.body!==undefined),...(init.headers??{})}});
  if(!response.ok){
    const body=await response.json().catch(()=>({})) as ApiErrorEnvelope;
    if(response.status===401&&requiresLogin){auth.clear();window.dispatchEvent(new Event('admin-auth-expired'));}
    const error=new Error(body.message??`请求失败（${response.status}）`);Object.assign(error,{code:body.code,requestId:body.requestId});throw error;
  }
  if(response.status===204)return undefined as T;
  return (await response.json() as ApiEnvelope<T>).data;
}

export const api={
  login:async(username:string,password:string)=>{const data=await request<{accessToken:string;expiresAt:string;roles:string[]}>('/api/v1/auth/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});auth.save(data.accessToken,data.roles);return data;},
  logout:()=>request<void>('/api/v1/auth/logout',{method:'POST'}),
  // The operations view must never fall back to the public, OPEN-only campaign feed.
  listCampaigns:()=>request<Campaign[]>('/api/v1/admin/campaigns'),
  listLockedPlatformCampaigns:()=>request<Campaign[]>('/api/v1/admin/platform/locked-campaigns'),
  listPlatformSuppliers:()=>request<PlatformSupplier[]>('/api/v1/admin/platform/suppliers'),
  listPlatformWarehouses:()=>request<PlatformWarehouse[]>('/api/v1/admin/platform/warehouses'),
  listPlatformSkus:()=>request<PlatformSku[]>('/api/v1/admin/platform/skus'),
  savePlatformSku:(payload:{id?:string;productId?:string;title:string;category:string;origin:string;imageUrl:string|null;skuName:string;retailPriceCents:number;defaultSellableQuantity:number;referencePurchaseCostCents:number|null;supplierNote:string|null;status:'ACTIVE'|'INACTIVE'})=>request<PlatformSku>('/api/v1/admin/platform/skus',{method:'POST',body:JSON.stringify(payload)}),
  createCommunityCampaign:(payload:{title:string;serviceAreaId:string;pickupPointId:string;cutoffAt:string;dispatchAt:string;minTotalQuantity:number;failureAction:'CANCEL_AND_REFUND'|'POSTPONE';items:Array<{platformSkuId:string;retailPriceCents:number;sellableQuantity:number}>})=>request<Campaign>('/api/v1/admin/community/campaigns',{method:'POST',body:JSON.stringify(payload)}),
  listCommunityCampaigns:()=>request<Campaign[]>('/api/v1/admin/community/campaigns'),
  listCommunityDeliveries:()=>request<CommunityDelivery[]>('/api/v1/admin/community/deliveries'),
  confirmCommunityArrival:(batchId:string,payload:{receivedBy:string;confirmationNote:string|null;items:Array<{platformSkuId:string;receivedQuantity:number;rejectedQuantity:number;shortQuantity:number;damagedQuantity:number;reason:string|null;evidenceNote:string|null;evidenceUrl:string|null}>})=>request<unknown>(`/api/v1/admin/community/dispatch-batches/${batchId}/arrival`,{method:'POST',body:JSON.stringify(payload)}),
  listSupplierOffers:()=>request<SupplierOffer[]>('/api/v1/admin/platform/offers'),
  listPurchaseOrders:()=>request<PurchaseOrder[]>('/api/v1/admin/platform/purchase-orders'),
  receivePurchaseOrder:(id:string,payload:{items:Array<{purchaseOrderItemId:string;acceptedQuantity:number;rejectedQuantity:number;batchNo:string|null;productionDate:string|null;expiresAt:string|null;inspectionNote:string|null;exceptionReason?:'SHORT_RECEIPT'|'QUALITY_REJECTED'|'PACKAGE_DAMAGED'|null;evidenceUrl?:string|null}>})=>request<unknown>(`/api/v1/admin/platform/purchase-orders/${id}/receive`,{method:'POST',body:JSON.stringify(payload)}),
  listPlatformOutboundOrders:()=>request<OutboundOrder[]>('/api/v1/admin/platform/outbound-orders'),
  completePickupHandover:(id:string,payload:{receivedBy:string;exceptionNote:string|null;items:Array<{platformSkuId:string;receivedQuantity:number;rejectedQuantity?:number;shortQuantity?:number;damagedQuantity?:number;reason?:string|null;evidenceNote?:string|null;evidenceUrl?:string|null}>})=>request<unknown>(`/api/v1/admin/platform/outbound/${id}/handover`,{method:'POST',body:JSON.stringify(payload)}),
  listPlatformInventory:()=>request<InventoryBalance[]>('/api/v1/admin/platform/inventory'),
  listSupplierPayables:()=>request<SupplierPayable[]>('/api/v1/admin/platform/payables'),
  listPlatformSortingTasks:()=>request<SortingTask[]>('/api/v1/admin/platform/sorting-tasks'),
  createPlatformSorting:(campaignId:string)=>request<SortingTask>(`/api/v1/admin/platform/campaigns/${campaignId}/sorting`,{method:'POST'}),
  completePlatformSorting:(campaignId:string)=>request<SortingTask>(`/api/v1/admin/platform/campaigns/${campaignId}/sorting/complete`,{method:'POST'}),
  createPlatformOutbound:(campaignId:string,carrierReference:string|null)=>request<OutboundOrder>(`/api/v1/admin/platform/campaigns/${campaignId}/outbound`,{method:'POST',body:JSON.stringify({carrierReference})}),
  listFulfillmentExceptions:()=>request<FulfillmentException[]>('/api/v1/admin/platform/fulfillment-exceptions'),
  decideFulfillmentException:(id:string,payload:{status:'WAITING_REPLENISHMENT'|'TRANSFER_PENDING'|'REFUND_CONFIRMED';responsibility:'SUPPLIER'|'WAREHOUSE'|'CARRIER'|'PICKUP_POINT'|'PLATFORM'|'PENDING';resolutionNote:string})=>request<FulfillmentException>(`/api/v1/admin/platform/fulfillment-exceptions/${id}/decision`,{method:'POST',body:JSON.stringify(payload)}),
  executePartialRefund:(id:string,confirmationNote:string)=>request<FulfillmentException>(`/api/v1/admin/platform/fulfillment-exceptions/${id}/partial-refund`,{method:'POST',body:JSON.stringify({confirmationNote})}),
  reinspectWrongPointTransfer:(id:string,payload:{evidenceNote:string;items:Array<{platformSkuId:string;acceptedQuantity:number}>})=>request<FulfillmentException>(`/api/v1/admin/platform/fulfillment-exceptions/${id}/transfer-reinspection`,{method:'POST',body:JSON.stringify(payload)}),
  registerWarehouseException:(campaignId:string,payload:{items:Array<{platformSkuId:string;shortQuantity:number;damagedQuantity:number;reason:'WAREHOUSE_SHORTAGE'|'WAREHOUSE_DAMAGE'|'MIS_SORTED';description:string;evidenceUrl:string|null}>})=>request<FulfillmentException>(`/api/v1/admin/platform/campaigns/${campaignId}/warehouse-exceptions`,{method:'POST',body:JSON.stringify(payload)}),
  createCampaign:(payload:CreateCampaignPayload)=>request<Campaign>('/api/v1/admin/campaigns',{method:'POST',body:JSON.stringify(payload)}),
  updateCampaign:(id:string,payload:CreateCampaignPayload)=>request<Campaign>(`/api/v1/admin/campaigns/${id}`,{method:'PATCH',body:JSON.stringify(payload)}),
  postponeCampaign:(id:string,payload:{cutoffAt:string;dispatchAt:string})=>request<Campaign>(`/api/v1/admin/campaigns/${id}/postpone`,{method:'POST',body:JSON.stringify(payload)}),
  cancelCampaign:(id:string)=>request<Campaign>(`/api/v1/admin/campaigns/${id}/cancel`,{method:'POST'}),
  openCampaign:(id:string)=>request<Campaign>(`/api/v1/admin/campaigns/${id}/open`,{method:'POST'}),
  closeCampaign:(id:string)=>request<Campaign>(`/api/v1/admin/campaigns/${id}/close`,{method:'POST'}),
  listDeliveryPlans:()=>request<DeliveryPlan[]>('/api/v1/admin/delivery-plans'),
  listPickupDeliveryPlans:()=>request<DeliveryPlan[]>('/api/v1/pickup/delivery-plans'),
  saveDeliveryPlan:(payload:{campaignId:string;pickupPointId:string|null;siteName:string|null;address:string|null;arrivalStartAt:string|null;arrivalEndAt:string|null;contactName:string|null;contactPhone:string|null;remark:string|null})=>request<DeliveryPlan>('/api/v1/admin/delivery-plans',{method:'POST',body:JSON.stringify(payload)}),
  bookVehicle:(id:string,payload:{logisticsPlatform?:string;vehicleOrderNo:string;driverName:string|null;driverPhone:string|null;vehiclePlate:string|null;estimatedArrivalAt?:string|null})=>request<DeliveryPlan>(`/api/v1/admin/delivery-plans/${id}/book-vehicle`,{method:'POST',body:JSON.stringify(payload)}),
  listMerchants:()=>request<Merchant[]>('/api/v1/admin/merchants'),
  createMerchant:(payload:{name:string;defaultCommissionBps:number;wechatSubMchid:string|null})=>request<Merchant>('/api/v1/admin/merchants',{method:'POST',body:JSON.stringify(payload)}),
  updateMerchant:(id:string,payload:{name:string;defaultCommissionBps:number;wechatSubMchid:string|null})=>request<Merchant>(`/api/v1/admin/merchants/${id}`,{method:'PATCH',body:JSON.stringify(payload)}),
  updateMerchantStatus:(id:string,status:'ACTIVE'|'SUSPENDED')=>request<Merchant>(`/api/v1/admin/merchants/${id}/status`,{method:'POST',body:JSON.stringify({status})}),
  deleteMerchant:(id:string)=>request<void>(`/api/v1/admin/merchants/${id}`,{method:'DELETE'}),
  listProducts:()=>request<Product[]>('/api/v1/admin/products'),
  createProduct:(payload:{merchantId:string;title:string;category:string;origin:string;imageUrl:string|null;skuName:string;priceCents:number;stock:number})=>request<Product>('/api/v1/admin/products',{method:'POST',body:JSON.stringify(payload)}),
  updateProduct:(id:string,payload:{merchantId:string;title:string;category:string;origin:string;imageUrl:string|null;skuName:string;priceCents:number;stock:number})=>request<Product>(`/api/v1/admin/products/${id}`,{method:'PATCH',body:JSON.stringify(payload)}),
  offShelfProduct:(id:string)=>request<Product>(`/api/v1/admin/products/${id}/off-shelf`,{method:'POST'}),
  restoreProduct:(id:string)=>request<Product>(`/api/v1/admin/products/${id}/restore`,{method:'POST'}),
  deleteProduct:(id:string)=>request<void>(`/api/v1/admin/products/${id}`,{method:'DELETE'}),
  submitProduct:(id:string)=>request<Product>(`/api/v1/admin/products/${id}/submit-review`,{method:'POST'}),
  reviewProduct:(id:string,decision:'APPROVE'|'REJECT',reason?:string)=>request<Product>(`/api/v1/admin/products/${id}/review`,{method:'POST',body:JSON.stringify({decision,reason})}),
  listServiceAreas:()=>request<ServiceArea[]>('/api/v1/admin/service-areas'),
  listRegionDirectory:()=>request<RegionDirectoryEntry[]>('/api/v1/admin/region-directory'),
  openServiceArea:(payload:{regionCode:string})=>request<ServiceArea>('/api/v1/admin/service-areas',{method:'POST',body:JSON.stringify(payload)}),
  updateServiceAreaOrderStatus:(id:string,orderEnabled:boolean)=>request<ServiceArea>(`/api/v1/admin/service-areas/${id}/order-status`,{method:'POST',body:JSON.stringify({orderEnabled})}),
  listNetworkPresets:()=>request<NetworkPreset[]>('/api/v1/admin/network-presets'),
  activateNetworkPreset:(presetId:'BAODING_COUNTIES')=>request<NetworkActivationResult>(`/api/v1/admin/network-presets/${presetId}/activate`,{method:'POST',body:JSON.stringify({orderEnabled:true})}),
  listPickupPoints:()=>request<PickupPoint[]>('/api/v1/admin/pickup-points'),
  listPickupVerifierAssignments:(userId?:string)=>request<PickupVerifierAssignment[]>(`/api/v1/admin/pickup-verifier-assignments${userId?`?userId=${encodeURIComponent(userId)}`:''}`),
  grantPickupVerifier:(payload:{userId:string;pickupPointId:string})=>request<PickupVerifierAssignmentChange>('/api/v1/admin/pickup-verifier-assignments/grant',{method:'POST',body:JSON.stringify(payload)}),
  revokePickupVerifier:(payload:{userId:string;pickupPointId:string})=>request<PickupVerifierAssignmentChange>('/api/v1/admin/pickup-verifier-assignments/revoke',{method:'POST',body:JSON.stringify(payload)}),
  createPickupPoint:(payload:{serviceAreaId:string;name:string;address:string;capacityPerDay:number|null})=>request<PickupPoint>('/api/v1/admin/pickup-points',{method:'POST',body:JSON.stringify(payload)}),
  batchCreatePickupPoints:(points:Array<{city:string;name:string;address:string;capacityPerDay:number|null}>)=>request<BatchPickupResult>('/api/v1/admin/pickup-points/batch',{method:'POST',body:JSON.stringify({points})}),
  listOrders:(orderNo='')=>request<Order[]>(`/api/v1/admin/orders${orderNo?`?orderNo=${encodeURIComponent(orderNo)}`:''}`),
  lookupPickupOrder:(deliveryPlanId:string,orderNo:string)=>request<PickupOrderLookup>(`/api/v1/pickup/orders/lookup?deliveryPlanId=${encodeURIComponent(deliveryPlanId)}&orderNo=${encodeURIComponent(orderNo)}`),
  refundOrder:(id:string)=>request<Order>(`/api/v1/admin/orders/${id}/refund`,{method:'POST'}),
  listBatches:()=>request<DispatchBatch[]>('/api/v1/admin/dispatch-batches'),
  createBatch:(campaignId:string)=>request<DispatchBatch>('/api/v1/admin/dispatch-batches',{method:'POST',body:JSON.stringify({campaignId})}),
  dispatchBatch:(id:string)=>request<DispatchBatch>(`/api/v1/admin/dispatch-batches/${id}/dispatch`,{method:'POST'}),
  receiveBatch:(id:string,deliveryPlanId:string)=>request<{batch:DispatchBatch;readyOrders:number}>(`/api/v1/pickup/batches/${id}/receive`,{method:'POST',body:JSON.stringify({deliveryPlanId})}),
  verifyPickup:(payload:{orderId:string;deliveryPlanId:string;code:string;items?:Array<{platformSkuId:string;quantity:number}>})=>request<{orderId:string;status:string}>('/api/v1/pickup/verify',{method:'POST',body:JSON.stringify(payload)}),
  listSettlements:()=>request<Settlement[]>('/api/v1/admin/finance/settlements'),
  listRefunds:()=>request<Refund[]>('/api/v1/admin/finance/refunds'),
  listLedger:()=>request<LedgerTransaction[]>('/api/v1/admin/finance/ledger'),
  listAuditLogs:()=>request<AuditLog[]>('/api/v1/admin/audit-logs'),
  listServiceAreaInterests:()=>request<ServiceAreaInterest[]>('/api/v1/admin/service-area-interests'),
  updateServiceAreaInterestStatus:(id:string,status:'CONTACTED'|'CLOSED')=>request<ServiceAreaInterest>(`/api/v1/admin/service-area-interests/${id}/status`,{method:'POST',body:JSON.stringify({status})}),
  listAfterSales:()=>request<AfterSale[]>('/api/v1/admin/after-sales'),
  updateAfterSaleStatus:(id:string,status:'PROCESSING'|'REJECTED',resolutionNote?:string)=>request<AfterSale>(`/api/v1/admin/after-sales/${id}/status`,{method:'POST',body:JSON.stringify({status,resolutionNote})}),
  refundAfterSale:(id:string,resolutionNote:string)=>request<AfterSale>(`/api/v1/admin/after-sales/${id}/refund`,{method:'POST',body:JSON.stringify({resolutionNote})}),
  listManualNotifications:()=>request<OrderNotification[]>('/api/v1/admin/notifications/manual'),
  retryPendingNotification:(id:string)=>request<OrderNotification>(`/api/v1/admin/notifications/${id}/retry`,{method:'POST'}),
  completeManualNotification:(id:string)=>request<OrderNotification>(`/api/v1/admin/notifications/${id}/manual-completed`,{method:'POST'}),
};
