import type { FastifyInstance } from 'fastify';
import { identifierSchema } from '@hometown/api-contracts';
import type { Campaign, DeliveryPlan, PickupPoint, ServiceArea } from '../modules/core/types.js';

/** Read-only consumer catalogue routes. Serialisers stay injected so this
 * route module cannot acquire operations-only fields by reaching into app.ts. */
export function registerPublicCatalogRoutes(app: FastifyInstance, dependencies: {
  readSnapshot<T>(work: () => Promise<T>): Promise<T>;
  campaigns: { listPublic(): Promise<Campaign[]>; getPublic(id: string): Promise<Campaign> };
  listServiceAreas(): Promise<ServiceArea[]>;
  listPickupPoints(serviceAreaId?: string): Promise<PickupPoint[]>;
  getDeliveryPlanByCampaign(campaignId: string): Promise<DeliveryPlan | null>;
  withCampaignItems(campaign: Campaign): Promise<unknown>;
  publicDeliveryPlan(plan: DeliveryPlan | null): unknown;
}): void {
  app.get('/api/v1/campaigns', async () => dependencies.readSnapshot(async () => ({ data: await Promise.all((await dependencies.campaigns.listPublic()).map(dependencies.withCampaignItems)) })));
  app.get('/api/v1/service-areas', async () => dependencies.readSnapshot(async () => {
    const [areas, points] = await Promise.all([
      dependencies.listServiceAreas(),
      dependencies.listPickupPoints(),
    ]);
    const coveredAreaIds = new Set(
      points
        .filter((point) => point.status === 'ACTIVE')
        .map((point) => point.serviceAreaId),
    );
    return {
      data: areas.filter(
        (area) =>
          area.status === 'ENABLED' &&
          area.orderEnabled &&
          coveredAreaIds.has(area.id),
      ),
    };
  }));
  app.get('/api/v1/pickup-points', async (request) => {
    const query = request.query as { serviceAreaId?: string };
    return { data: (await dependencies.listPickupPoints(query.serviceAreaId)).filter((item) => item.status === 'ACTIVE') };
  });
  app.get('/api/v1/campaigns/:id', async (request) => dependencies.readSnapshot(async () => {
    const id = identifierSchema.parse((request.params as { id: string }).id);
    return { data: await dependencies.withCampaignItems(await dependencies.campaigns.getPublic(id)) };
  }));
  app.get('/api/v1/delivery-plans/:campaignId', async (request) => dependencies.readSnapshot(async () => {
    const campaignId = identifierSchema.parse((request.params as { campaignId: string }).campaignId);
    await dependencies.campaigns.getPublic(campaignId);
    return { data: dependencies.publicDeliveryPlan(await dependencies.getDeliveryPlanByCampaign(campaignId)) };
  }));
}
