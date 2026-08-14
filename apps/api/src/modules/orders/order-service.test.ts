import { describe,expect,it } from 'vitest';
import { CampaignService } from '../campaigns/campaign-service.js';
import { MemoryStore } from '../core/store.js';
import { OrderService } from './order-service.js';

describe('OrderService payment expiry',()=>{
  it('cancels an unpaid order and releases both campaign and global inventory',async()=>{
    const store=new MemoryStore();const orders=new OrderService(store,new CampaignService(store));
    const input={campaignId:'campaign-demo-001',serviceAreaId:'service-bd-lianchi',pickupPointId:'pickup-demo-001',items:[{skuId:'sku-demo-001',quantity:999}]};
    const first=await orders.create('expiry-user-1',input,'expiry-key-0001');
    first.expiresAt=new Date(Date.now()-1_000).toISOString();await store.saveOrderStatus(first);
    expect(await orders.expirePendingOrders()).toBe(1);
    expect((await store.getOrder(first.id))?.status).toBe('CANCELLED');
    const replacement=await orders.create('expiry-user-2',input,'expiry-key-0002');
    expect(replacement.status).toBe('PENDING_PAYMENT');
  });
});
