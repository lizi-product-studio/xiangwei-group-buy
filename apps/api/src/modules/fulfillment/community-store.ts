import type {
  Campaign,
  CampaignGroup,
  CommunityAllocationDraft,
  CampaignItem,
  CommunityDeliveryConfirmation,
  CommunityPickupWindow,
  DeliveryPlan,
  DispatchBatch,
  FulfillmentAllocation,
  FulfillmentException,
  Order,
  PickupCredential,
  PickupPoint,
  NotificationPreference,
  OrderNotification,
  OrderLine,
  CatalogSku,
  ServiceArea,
} from "../core/types.js";

/** Storage capabilities required by community delivery and pickup entitlement. */
export interface CommunityStore {
  transaction<T>(work: (store: CommunityStore) => Promise<T>): Promise<T>;
  listServiceAreas(): Promise<ServiceArea[]>;
  listPickupPoints(serviceAreaId?: string): Promise<PickupPoint[]>;
  getCatalogSku(id: string): Promise<CatalogSku | null>;
  saveCampaign(campaign: Campaign): Promise<void>;
  listCampaignGroups(): Promise<CampaignGroup[]>;
  getCampaignGroup(id: string): Promise<CampaignGroup | null>;
  saveCampaignGroup(value: CampaignGroup): Promise<void>;
  updateCampaignGroup(value: CampaignGroup, expectedVersion: number): Promise<boolean>;
  updateCampaign(campaign: Campaign, expectedVersion: number): Promise<boolean>;
  deleteDraftCampaign(id: string, expectedVersion: number): Promise<boolean>;
  hasCampaignBusinessReferences(id: string): Promise<boolean>;
  replaceCampaignItems(
    campaignId: string,
    items: CampaignItem[],
  ): Promise<void>;
  saveDeliveryPlan(value: DeliveryPlan): Promise<void>;
  getDeliveryPlanByCampaign(campaignId: string): Promise<DeliveryPlan | null>;
  getDispatchBatch(id: string): Promise<DispatchBatch | null>;
  saveDispatchBatch(value: DispatchBatch): Promise<void>;
  getCampaignForUpdate(id: string): Promise<Campaign | null>;
  getCommunityDeliveryConfirmationByBatch(
    batchId: string,
  ): Promise<CommunityDeliveryConfirmation | null>;
  saveCommunityDeliveryConfirmation(
    value: CommunityDeliveryConfirmation,
  ): Promise<boolean>;
  listOrderLinesByCampaignForUpdate(campaignId: string): Promise<OrderLine[]>;
  updateOrderLine(value: OrderLine): Promise<boolean>;
  saveFulfillmentException(value: FulfillmentException): Promise<void>;
  getFulfillmentExceptionForUpdate(
    id: string,
  ): Promise<FulfillmentException | null>;
  saveFulfillmentAllocations(values: FulfillmentAllocation[]): Promise<void>;
  getCommunityAllocationDraftByDeliveryForUpdate(
    communityDeliveryId: string,
  ): Promise<CommunityAllocationDraft | null>;
  saveCommunityAllocationDraft(
    value: CommunityAllocationDraft,
  ): Promise<boolean>;
  getOrderForUpdate(id: string): Promise<Order | null>;
  getOrder(id: string): Promise<Order | null>;
  listOrdersByCampaign(campaignId: string): Promise<Order[]>;
  getNotificationPreference(
    userId: string,
  ): Promise<NotificationPreference | null>;
  createOrderNotificationIfAbsent(value: OrderNotification): Promise<boolean>;
  saveOrderStatus(order: Order): Promise<void>;
  savePickupCredential(value: PickupCredential): Promise<void>;
  saveCommunityPickupWindow(value: CommunityPickupWindow): Promise<void>;
  saveAuditLog(value: {
    id: string;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    requestId: string;
    beforeData: unknown;
    afterData: unknown;
    createdAt: string;
  }): Promise<void>;
}
