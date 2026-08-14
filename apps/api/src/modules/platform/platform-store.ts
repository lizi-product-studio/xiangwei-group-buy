import type {
  Campaign,
  GoodsReceipt,
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  OutboundOrder,
  PickupHandover,
  PlatformPartialRefund,
  PlatformRefund,
  PlatformCampaignItem,
  PlatformSku,
  PlatformSalesLine,
  PurchaseOrder,
  SortingTask,
  Supplier,
  SupplierPayable,
  SupplierQualification,
  SupplierSkuOffer,
  Warehouse,
  FulfillmentException,
  FulfillmentAllocation,
} from '../core/types.js';

/**
 * Additive storage surface for the platform-procurement model. It intentionally
 * sits beside CommerceStore so legacy marketplace services cannot accidentally
 * depend on supplier, warehouse or lot state.
 */
export interface PlatformStore {
  getPlatformRefundByOrder(orderId: string): Promise<PlatformRefund | null>;
  getPlatformRefundByProviderNo(providerRefundNo: string): Promise<PlatformRefund | null>;
  savePlatformRefund(value: PlatformRefund): Promise<void>;
  claimPlatformRefundSubmission(refundId: string, leaseUntil: string, now: string, claimToken: string): Promise<boolean>;
  savePlatformRefundIfClaimed(value: PlatformRefund, claimToken: string): Promise<boolean>;
  savePlatformRefundIfUnclaimed(value: PlatformRefund, now: string): Promise<boolean>;
  savePlatformRefundIfStatus(value: PlatformRefund, statuses: PlatformRefund['status'][]): Promise<boolean>;
  listPendingPlatformRefunds(limit: number): Promise<PlatformRefund[]>;
  getPlatformPartialRefundByProviderNo(providerRefundNo:string):Promise<PlatformPartialRefund|null>;
  getPlatformPartialRefund(id:string):Promise<PlatformPartialRefund|null>;
  listPlatformPartialRefundsByOrder(orderId:string):Promise<PlatformPartialRefund[]>;
  listPlatformPartialRefundsByException(exceptionId:string):Promise<PlatformPartialRefund[]>;
  savePlatformPartialRefund(value:PlatformPartialRefund):Promise<void>;
  claimPlatformPartialRefundSubmission(refundId:string,leaseUntil:string,now:string,claimToken:string):Promise<boolean>;
  savePlatformPartialRefundIfClaimed(value:PlatformPartialRefund,claimToken:string):Promise<boolean>;
  savePlatformPartialRefundIfUnclaimed(value:PlatformPartialRefund,now:string):Promise<boolean>;
  savePlatformPartialRefundIfStatus(value:PlatformPartialRefund,statuses:PlatformPartialRefund['status'][]):Promise<boolean>;
  listPendingPlatformPartialRefunds(limit:number):Promise<PlatformPartialRefund[]>;
  listWarehouses(): Promise<Warehouse[]>;
  getWarehouse(id: string): Promise<Warehouse | null>;
  saveWarehouse(value: Warehouse): Promise<void>;
  listSuppliers(): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | null>;
  saveSupplier(value: Supplier): Promise<void>;
  listSupplierQualifications(supplierId?: string): Promise<SupplierQualification[]>;
  saveSupplierQualification(value: SupplierQualification): Promise<void>;
  listPlatformSkus(): Promise<PlatformSku[]>;
  getPlatformSku(id: string): Promise<PlatformSku | null>;
  savePlatformSku(value: PlatformSku): Promise<void>;
  listSupplierSkuOffers(platformSkuId?: string): Promise<SupplierSkuOffer[]>;
  getSupplierSkuOffer(id: string): Promise<SupplierSkuOffer | null>;
  saveSupplierSkuOffer(value: SupplierSkuOffer): Promise<void>;
  getCampaignPlatformItem(campaignId: string, platformSkuId: string): Promise<PlatformCampaignItem | null>;
  replaceCampaignPlatformItems(campaign: Campaign): Promise<void>;
  reserveCampaignPlatformStock(campaignId: string, platformSkuId: string, quantity: number): Promise<boolean>;
  releaseCampaignPlatformStock(campaignId: string, platformSkuId: string, quantity: number): Promise<boolean>;
  saveSalesOrderItems(orderId: string, items: Array<{ id:string; platformSkuId: string; productId: string; title: string; skuName: string; quantity: number; unitPriceCents: number; purchaseUnitCents: number; amountCents: number }>): Promise<void>;
  listPlatformOrderItemsByCampaign(campaignId: string): Promise<Array<{ orderId: string; platformSkuId: string; quantity: number; purchaseUnitCents: number }>>;
  listPlatformSalesLinesByCampaign(campaignId:string):Promise<PlatformSalesLine[]>;
  listPlatformSalesLinesByCampaignForUpdate(campaignId:string):Promise<PlatformSalesLine[]>;
  updatePlatformSalesLine(value:PlatformSalesLine):Promise<boolean>;
  listPurchaseOrders(campaignId?: string): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: string): Promise<PurchaseOrder | null>;
  getPurchaseOrderForUpdate(id: string): Promise<PurchaseOrder | null>;
  savePurchaseOrder(value: PurchaseOrder): Promise<void>;
  getGoodsReceiptByPurchaseOrder(purchaseOrderId: string): Promise<GoodsReceipt | null>;
  listGoodsReceiptsByPurchaseOrder(purchaseOrderId: string): Promise<GoodsReceipt[]>;
  saveGoodsReceipt(value: GoodsReceipt): Promise<void>;
  listInventoryLots(warehouseId?: string): Promise<InventoryLot[]>;
  saveInventoryLot(value: InventoryLot): Promise<void>;
  appendInventoryMovement(value: InventoryMovement): Promise<void>;
  listInventoryBalances(warehouseId?: string): Promise<InventoryBalance[]>;
  listSupplierPayables(supplierId?: string): Promise<SupplierPayable[]>;
  getSupplierPayable(id: string): Promise<SupplierPayable | null>;
  saveSupplierPayable(value: SupplierPayable): Promise<void>;
  getSortingTaskByCampaign(campaignId: string): Promise<SortingTask | null>;
  listSortingTasks(): Promise<SortingTask[]>;
  saveSortingTask(value: SortingTask): Promise<void>;
  getOutboundOrderByCampaign(campaignId: string): Promise<OutboundOrder | null>;
  getOutboundOrderForUpdate(id: string): Promise<OutboundOrder | null>;
  listOutboundOrders(status?: OutboundOrder['status']): Promise<OutboundOrder[]>;
  saveOutboundOrder(value: OutboundOrder): Promise<void>;
  getPickupHandoverByOutbound(outboundOrderId: string): Promise<PickupHandover | null>;
  savePickupHandover(value: PickupHandover): Promise<void>;
  getFulfillmentException(id:string):Promise<FulfillmentException|null>;
  getFulfillmentExceptionByOrderRequest(orderId:string,clientRequestId:string):Promise<FulfillmentException|null>;
  getFulfillmentExceptionByOrderRequestForUpdate(orderId:string,clientRequestId:string):Promise<FulfillmentException|null>;
  listFulfillmentExceptions(status?:FulfillmentException['status']):Promise<FulfillmentException[]>;
  saveFulfillmentException(value:FulfillmentException):Promise<void>;
  listFulfillmentAllocations(exceptionId:string):Promise<FulfillmentAllocation[]>;
  saveFulfillmentAllocations(values:FulfillmentAllocation[]):Promise<void>;
  updateFulfillmentAllocations(values:FulfillmentAllocation[]):Promise<boolean>;
  markFulfillmentAllocationsRefunded(exceptionId:string,partialRefund:PlatformPartialRefund,at:string):Promise<boolean>;
  getFulfillmentExceptionForUpdate(id:string):Promise<FulfillmentException|null>;
}

export const platformStore = (value: unknown): PlatformStore => value as PlatformStore;
