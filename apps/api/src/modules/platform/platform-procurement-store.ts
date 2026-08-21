import type { CommerceStore } from '../core/store.js';

/**
 * Procurement, warehouse and handover capabilities for PLATFORM_PROCUREMENT.
 * Community allocation/cancellation and legacy merchant-settlement methods are
 * purposefully absent, so the procurement service cannot call them.
 */
export interface PlatformProcurementStore {
  transaction<T>(work: (store: PlatformProcurementStore) => Promise<T>): Promise<T>;
  appendInventoryMovement: CommerceStore['appendInventoryMovement'];
  appendLedgerTransaction: CommerceStore['appendLedgerTransaction'];
  listLedgerTransactions: CommerceStore['listLedgerTransactions'];
  getCampaign: CommerceStore['getCampaign'];
  getDeliveryPlan: CommerceStore['getDeliveryPlan'];
  getDeliveryPlanByCampaign: CommerceStore['getDeliveryPlanByCampaign'];
  getFulfillmentExceptionByOrderRequestForUpdate: CommerceStore['getFulfillmentExceptionByOrderRequestForUpdate'];
  getFulfillmentExceptionForUpdate: CommerceStore['getFulfillmentExceptionForUpdate'];
  getGoodsReceiptByPurchaseOrder: CommerceStore['getGoodsReceiptByPurchaseOrder'];
  getOrderForUpdate: CommerceStore['getOrderForUpdate'];
  getOutboundOrderByCampaign: CommerceStore['getOutboundOrderByCampaign'];
  getOutboundOrderForUpdate: CommerceStore['getOutboundOrderForUpdate'];
  getPickupHandoverByOutbound: CommerceStore['getPickupHandoverByOutbound'];
  getPlatformSku: CommerceStore['getPlatformSku'];
  getPurchaseOrder: CommerceStore['getPurchaseOrder'];
  getPurchaseOrderForUpdate: CommerceStore['getPurchaseOrderForUpdate'];
  getSortingTaskByCampaign: CommerceStore['getSortingTaskByCampaign'];
  getSupplier: CommerceStore['getSupplier'];
  getSupplierSkuOffer: CommerceStore['getSupplierSkuOffer'];
  getUser: CommerceStore['getUser'];
  getWarehouse: CommerceStore['getWarehouse'];
  hasActivePickupPointAssignment: CommerceStore['hasActivePickupPointAssignment'];
  listCampaigns: CommerceStore['listCampaigns'];
  listFulfillmentAllocations: CommerceStore['listFulfillmentAllocations'];
  listFulfillmentExceptions: CommerceStore['listFulfillmentExceptions'];
  listGoodsReceiptsByPurchaseOrder: CommerceStore['listGoodsReceiptsByPurchaseOrder'];
  listInventoryBalances: CommerceStore['listInventoryBalances'];
  listOrdersByCampaign: CommerceStore['listOrdersByCampaign'];
  listPickupPoints: CommerceStore['listPickupPoints'];
  listPlatformOrderItemsByCampaign: CommerceStore['listPlatformOrderItemsByCampaign'];
  listPlatformSalesLinesByCampaign: CommerceStore['listPlatformSalesLinesByCampaign'];
  listPlatformSalesLinesByCampaignForUpdate: CommerceStore['listPlatformSalesLinesByCampaignForUpdate'];
  listPurchaseOrders: CommerceStore['listPurchaseOrders'];
  listServiceAreas: CommerceStore['listServiceAreas'];
  listSupplierQualifications: CommerceStore['listSupplierQualifications'];
  replaceCampaignPlatformItems: CommerceStore['replaceCampaignPlatformItems'];
  saveAuditLog: CommerceStore['saveAuditLog'];
  saveCampaign: CommerceStore['saveCampaign'];
  saveDeliveryPlan: CommerceStore['saveDeliveryPlan'];
  saveFulfillmentAllocations: CommerceStore['saveFulfillmentAllocations'];
  saveFulfillmentException: CommerceStore['saveFulfillmentException'];
  saveGoodsReceipt: CommerceStore['saveGoodsReceipt'];
  saveInventoryLot: CommerceStore['saveInventoryLot'];
  saveOrderStatus: CommerceStore['saveOrderStatus'];
  saveOutboundOrder: CommerceStore['saveOutboundOrder'];
  savePickupCredential: CommerceStore['savePickupCredential'];
  savePickupHandover: CommerceStore['savePickupHandover'];
  savePurchaseOrder: CommerceStore['savePurchaseOrder'];
  saveSortingTask: CommerceStore['saveSortingTask'];
  saveSupplierPayable: CommerceStore['saveSupplierPayable'];
  updateCampaign: CommerceStore['updateCampaign'];
  updateFulfillmentAllocations: CommerceStore['updateFulfillmentAllocations'];
  updatePlatformSalesLine: CommerceStore['updatePlatformSalesLine'];
}
