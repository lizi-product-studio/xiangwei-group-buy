import type {
  Campaign,
  CommunityAllocationDraft,
  CommunityCampaignItem,
  CommunityDeliveryConfirmation,
  CommunityPickupWindow,
  DeliveryPlan,
  DispatchBatch,
  FulfillmentAllocation,
  FulfillmentException,
  Order,
  PickupCredential,
  PickupPoint,
  PlatformSalesLine,
  PlatformSku,
  ServiceArea,
} from '../core/types.js';

/** Community delivery and entitlement capabilities, excluding procurement facts. */
export interface CommunityStore {
  transaction<T>(work: (store: CommunityStore) => Promise<T>): Promise<T>;
  listServiceAreas(): Promise<ServiceArea[]>;
  listPickupPoints(serviceAreaId?: string): Promise<PickupPoint[]>;
  getPlatformSku(id: string): Promise<PlatformSku | null>;
  saveCampaign(campaign: Campaign): Promise<void>;
  replaceCommunityCampaignItems(campaignId: string, items: CommunityCampaignItem[]): Promise<void>;
  saveDeliveryPlan(value: DeliveryPlan): Promise<void>;
  getDeliveryPlanByCampaign(campaignId: string): Promise<DeliveryPlan | null>;
  getDispatchBatch(id: string): Promise<DispatchBatch | null>;
  saveDispatchBatch(value: DispatchBatch): Promise<void>;
  getCampaignForUpdate(id: string): Promise<Campaign | null>;
  getCommunityDeliveryConfirmationByBatch(batchId: string): Promise<CommunityDeliveryConfirmation | null>;
  saveCommunityDeliveryConfirmation(value: CommunityDeliveryConfirmation): Promise<boolean>;
  listPlatformSalesLinesByCampaignForUpdate(campaignId: string): Promise<PlatformSalesLine[]>;
  updatePlatformSalesLine(value: PlatformSalesLine): Promise<boolean>;
  saveFulfillmentException(value: FulfillmentException): Promise<void>;
  getFulfillmentExceptionForUpdate(id: string): Promise<FulfillmentException | null>;
  saveFulfillmentAllocations(values: FulfillmentAllocation[]): Promise<void>;
  getCommunityAllocationDraftByDeliveryForUpdate(communityDeliveryId: string): Promise<CommunityAllocationDraft | null>;
  saveCommunityAllocationDraft(value: CommunityAllocationDraft): Promise<boolean>;
  getOrderForUpdate(id: string): Promise<Order | null>;
  saveOrderStatus(order: Order): Promise<void>;
  savePickupCredential(value: PickupCredential): Promise<void>;
  saveCommunityPickupWindow(value: CommunityPickupWindow): Promise<void>;
  saveAuditLog(value: { id:string; actorId:string; action:string; resourceType:string; resourceId:string; requestId:string; beforeData:unknown; afterData:unknown; createdAt:string }): Promise<void>;
}
