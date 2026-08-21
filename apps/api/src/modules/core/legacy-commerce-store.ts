import type {
  Campaign,
  CampaignItemSnapshot,
  DeliveryPlan,
  Order,
  PickupPoint,
  Product,
  ServiceArea,
  Sku,
} from './types.js';

/**
 * Storage contract for the historical marketplace campaign lifecycle.
 *
 * This is deliberately a capability contract rather than a view of the
 * application store: it has no supplier, warehouse, procurement, community
 * allocation, or community after-sales methods.  A mixed-mode adapter may
 * implement it, but legacy campaign code cannot reach those facts directly.
 */
export interface LegacyCommerceStore {
  transaction<T>(work: (store: LegacyCommerceStore) => Promise<T>): Promise<T>;
  listCampaigns(): Promise<Campaign[]>;
  getCampaign(id: string): Promise<Campaign | null>;
  getCampaignForUpdate(id: string): Promise<Campaign | null>;
  saveCampaign(campaign: Campaign): Promise<void>;
  updateCampaign(campaign: Campaign, expectedVersion: number): Promise<boolean>;
  replaceCampaignItems(campaign: Campaign): Promise<void>;
  getSkuForUpdate(id: string): Promise<Sku | null>;
  listProducts(): Promise<Product[]>;
  listServiceAreas(): Promise<ServiceArea[]>;
  listPickupPoints(serviceAreaId?: string): Promise<PickupPoint[]>;
  listDeliveryPlans(): Promise<DeliveryPlan[]>;
  getDeliveryPlanByCampaign(campaignId: string): Promise<DeliveryPlan | null>;
  saveDeliveryPlan(value: DeliveryPlan): Promise<void>;
  listOrdersByCampaign(campaignId: string): Promise<Order[]>;
  getOrder(id: string): Promise<Order | null>;
  getOrderForUpdate(id: string): Promise<Order | null>;
  transitionOrderStatus(orderId: string, expectedStatuses: Order['status'][], nextStatus: Order['status'], paidAt?: string | null): Promise<boolean>;
  /** Releases an existing reservation without exposing the backing mode store. */
  releaseReservedCampaignInventory(campaignId: string, skuId: string, quantity: number, businessModelVersion: Campaign['businessModelVersion']): Promise<boolean>;
}

export type LegacyCampaignItemSnapshot = CampaignItemSnapshot;
