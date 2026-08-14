import { describe, expect, it } from 'vitest';
import { CampaignService } from './campaign-service.js';
import { MemoryStore } from '../core/store.js';

describe('CampaignService.close', () => {
  it('allows the scheduled close path to close an open campaign before its cutoff', async () => {
    const store=new MemoryStore();const service = new CampaignService(store);
    const campaign = await service.create({
      title: '计划自动结团测试',
      serviceAreaId: 'service-bd-lianchi',
      cutoffAt: new Date(Date.now() + 3_600_000).toISOString(),
      dispatchAt: new Date(Date.now() + 7_200_000).toISOString(),
      minTotalQuantity: 1,
      failureAction: 'CANCEL_AND_REFUND',
      skuIds: ['sku-demo-001'],
    });
    const plan=await store.getDeliveryPlanByCampaign(campaign.id);expect(plan).toBeTruthy();
    Object.assign(plan!,{pickupPointId:'pickup-demo-001',status:'SITE_CONFIRMED',siteName:'莲池家乡味自提点',address:'保定市莲池区示范路 88 号',confirmedAt:new Date().toISOString()});await store.saveDeliveryPlan(plan!);
    const open = await service.open(campaign.id);

    await expect(service.close(open.id, true, open.version)).resolves.toMatchObject({ status: 'CANCELLED' });
  });
});
