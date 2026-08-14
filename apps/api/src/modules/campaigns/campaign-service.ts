import { randomUUID } from 'node:crypto';
import type { CreateCampaignInput, PostponeCampaignInput, UpdateCampaignInput } from '@hometown/api-contracts';
import { BusinessError, transitionCampaign } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { Campaign, CampaignItemSnapshot, DeliveryPlan } from '../core/types.js';
import { NoopCampaignScheduler, type CampaignScheduler } from './campaign-scheduler.js';
import { isDeliveryPlanReadyForSale } from './sellability.js';

export class CampaignService {
  private refundHandler:((orderId:string)=>Promise<void>)|null=null;
  private lockedHandler:((campaignId:string)=>Promise<void>)|null=null;
  public constructor(private readonly store: CommerceStore, private readonly scheduler: CampaignScheduler = new NoopCampaignScheduler()) {}
  public setRefundHandler(handler:(orderId:string)=>Promise<void>):void{this.refundHandler=handler;}
  /** Called after the mode-B lock transaction commits, never inside legacy settlement code. */
  public setLockedHandler(handler:(campaignId:string)=>Promise<void>):void{this.lockedHandler=handler;}

  public async list(): Promise<Campaign[]> {
    return this.store.listCampaigns();
  }

  /** Only expose campaigns that a customer can actually order from right now. */
  public async listPublic(now = Date.now()): Promise<Campaign[]> {
    const [campaigns, areas, plans, points] = await Promise.all([
      this.store.listCampaigns(),
      this.store.listServiceAreas(),
      this.store.listDeliveryPlans(),
      this.store.listPickupPoints(),
    ]);
    const enabledAreaIds = new Set(areas.filter((area) => area.status === 'ENABLED' && area.orderEnabled).map((area) => area.id));
    const activePointIds = new Set(points.filter((point) => point.status === 'ACTIVE').map((point) => point.id));
    const planByCampaign = new Map(plans.map((plan) => [plan.campaignId, plan]));
    return campaigns.filter((campaign) => {
      const plan = planByCampaign.get(campaign.id);
      return campaign.status === 'OPEN'
        && Date.parse(campaign.cutoffAt) > now
        && enabledAreaIds.has(campaign.serviceAreaId)
        && plan?.serviceAreaId === campaign.serviceAreaId
        && isDeliveryPlanReadyForSale(plan)
        && activePointIds.has(plan.pickupPointId);
    });
  }

  public async getPublic(id: string, now = Date.now()): Promise<Campaign> {
    const campaign = (await this.listPublic(now)).find((item) => item.id === id);
    if (!campaign) throw new BusinessError('RESOURCE_NOT_FOUND', '团期不存在或当前不可购买', 404);
    return campaign;
  }

  public async get(id: string, store: CommerceStore = this.store): Promise<Campaign> {
    const campaign = await store.getCampaign(id);
    if (!campaign) throw new BusinessError('RESOURCE_NOT_FOUND', '团期不存在', 404);
    return campaign;
  }

  private async getForUpdate(id: string, store: CommerceStore): Promise<Campaign> {
    const campaign = await store.getCampaignForUpdate(id);
    if (!campaign) throw new BusinessError('RESOURCE_NOT_FOUND', '团期不存在', 404);
    return campaign;
  }

  public async create(input: CreateCampaignInput): Promise<Campaign> {
    return this.store.transaction(async (store) => {
      const area = (await store.listServiceAreas()).find((item) => item.id === input.serviceAreaId && item.status === 'ENABLED' && item.orderEnabled);
      if (!area) throw new BusinessError('RESOURCE_NOT_FOUND', '服务区县不存在', 404);
      const items = await this.snapshotItems(store, input.skuIds);
      const now = new Date().toISOString();
      const campaign: Campaign = {
        id: randomUUID(),
        ...input,
      businessModelVersion:'LEGACY_MARKETPLACE', warehouseId:null, platformItems:[], communityItems:[],
        skuIds: items.map((item) => item.skuId),
        items,
        status: 'DRAFT',
        version: 1,
        createdAt: now,
      };
      await store.saveCampaign(campaign);
      const deliveryPlan: DeliveryPlan = {
        id: randomUUID(), campaignId: campaign.id, serviceAreaId: campaign.serviceAreaId, pickupPointId:null, status: 'PENDING_SITE',
        siteName: null, address: null, arrivalStartAt: null, arrivalEndAt: null,
        contactName: null, contactPhone: null, vehicleOrderNo: null, driverName: null, driverPhone: null, vehiclePlate: null,
        remark: null, confirmedAt: null, bookedAt: null, dispatchedAt: null, arrivedAt: null, createdAt: now, updatedAt: now,
      };
      await store.saveDeliveryPlan(deliveryPlan);
      return campaign;
    });
  }

  public async updateDraft(id: string, input: UpdateCampaignInput): Promise<Campaign> {
    return this.store.transaction(async (store) => {
      const current = await this.getForUpdate(id, store);
      if (current.status !== 'DRAFT') throw new BusinessError('INVALID_STATE_TRANSITION', '只有草稿团期可以编辑；已开售团期请新建下一期', 409);
      const area = (await store.listServiceAreas()).find((item) => item.id === input.serviceAreaId && item.status === 'ENABLED' && item.orderEnabled);
      if (!area) throw new BusinessError('RESOURCE_NOT_FOUND', '收货区域不存在或已暂停收单', 404);
      const items = await this.snapshotItems(store, input.skuIds, current.id);
      const updated: Campaign = { ...current, ...input, skuIds: items.map((item) => item.skuId), items, version: current.version + 1 };
      if (!(await store.updateCampaign(updated, current.version))) throw new BusinessError('CONCURRENT_MODIFICATION', '团期已被其他操作更新，请刷新后重试', 409);
      await store.replaceCampaignItems(updated);
      if(current.serviceAreaId!==updated.serviceAreaId){const plan=await store.getDeliveryPlanByCampaign(id);if(plan){plan.serviceAreaId=updated.serviceAreaId;plan.pickupPointId=null;plan.status='PENDING_SITE';plan.siteName=null;plan.address=null;plan.arrivalStartAt=null;plan.arrivalEndAt=null;plan.contactName=null;plan.contactPhone=null;plan.vehicleOrderNo=null;plan.driverName=null;plan.driverPhone=null;plan.vehiclePlate=null;plan.confirmedAt=null;plan.bookedAt=null;plan.updatedAt=new Date().toISOString();await store.saveDeliveryPlan(plan);}}
      return updated;
    });
  }

  public async postpone(id: string, input: PostponeCampaignInput): Promise<Campaign> {
    const campaign = await this.store.transaction(async (store) => {
      const current = await this.getForUpdate(id, store);
      if (current.status !== 'POSTPONED') throw new BusinessError('INVALID_STATE_TRANSITION', '只有已顺延团期可以设置新的收单时间', 409);
      const area = (await store.listServiceAreas()).find((item) => item.id === current.serviceAreaId && item.status === 'ENABLED' && item.orderEnabled);
      if (!area) throw new BusinessError('INVALID_STATE_TRANSITION', '收货区县当前暂停收单，不能恢复团期', 409);
      if (Date.parse(input.cutoffAt) <= Date.now()) throw new BusinessError('VALIDATION_ERROR', '新的截单时间必须晚于当前时间', 400);
      const updated: Campaign = { ...current, cutoffAt: input.cutoffAt, dispatchAt: input.dispatchAt, status: transitionCampaign(current.status, 'OPEN'), version: current.version + 1 };
      if (!(await store.updateCampaign(updated, current.version))) throw new BusinessError('CONCURRENT_MODIFICATION', '团期已被其他操作更新，请刷新后重试', 409);
      return updated;
    });
    await this.scheduler.scheduleClose(campaign.id, campaign.cutoffAt, campaign.version).catch(() => undefined);
    return campaign;
  }

  public async cancel(id: string): Promise<Campaign> {
    await this.scheduler.cancelClose(id).catch(() => undefined);
    const refundOrderIds: string[] = [];
    const result = await this.store.transaction(async (store) => {
      const campaign = await this.getForUpdate(id, store);
      if (!['DRAFT', 'OPEN', 'POSTPONED'].includes(campaign.status)) throw new BusinessError('INVALID_STATE_TRANSITION', '当前团期不能取消；已成团请通过售后流程处理', 409);
      const expectedVersion = campaign.version;
      for (const order of await this.lockCampaignOrders(store, id)) {
        if (order.status === 'PENDING_PAYMENT') {
          if (await this.cancelPendingAndRelease(store, order)) continue;
          const latest = await store.getOrder(order.id);
          if (latest?.status === 'PAID_WAITING_CLOSE' && await this.refundPaidAndRelease(store, latest)) refundOrderIds.push(latest.id);
        } else if (order.status === 'PAID_WAITING_CLOSE') {
          if (await this.refundPaidAndRelease(store, order)) refundOrderIds.push(order.id);
        }
      }
      campaign.status = transitionCampaign(campaign.status, 'CANCELLED');
      campaign.version += 1;
      if (!(await store.updateCampaign(campaign, expectedVersion))) throw new BusinessError('CONCURRENT_MODIFICATION', '团期已被其他操作更新，请刷新后重试', 409);
      return campaign;
    });
    if (this.refundHandler) await Promise.allSettled(refundOrderIds.map((orderId) => this.refundHandler!(orderId)));
    return result;
  }

  public async open(id: string): Promise<Campaign> {
    const campaign = await this.store.transaction(async (store) => {
      const value = await this.getForUpdate(id, store);
      if (Date.parse(value.cutoffAt) <= Date.now()) {
        throw new BusinessError('CAMPAIGN_CLOSED', '截单时间已过，不能开售', 409);
      }
      const area = (await store.listServiceAreas()).find((item) => item.id === value.serviceAreaId && item.status === 'ENABLED' && item.orderEnabled);
      if (!area) throw new BusinessError('INVALID_STATE_TRANSITION', '收货区县当前暂停收单，不能开售', 409);
      const plan=await store.getDeliveryPlanByCampaign(value.id);const point=plan?.pickupPointId?(await store.listPickupPoints(value.serviceAreaId)).find((item)=>item.id===plan.pickupPointId&&item.status==='ACTIVE'):null;
      if(!plan||plan.status==='PENDING_SITE'||!point)throw new BusinessError('DELIVERY_SITE_NOT_CONFIRMED','请先为团期选择已启用的固定自提点，再开售',409);
      const expectedVersion = value.version;
      value.status = transitionCampaign(value.status, 'OPEN');
      value.version += 1;
      if (!(await store.updateCampaign(value, expectedVersion))) {
        throw new BusinessError('CONCURRENT_MODIFICATION', '团期已被其他操作更新，请刷新后重试', 409);
      }
      return value;
    });
    await this.scheduler.scheduleClose(campaign.id, campaign.cutoffAt, campaign.version).catch(() => undefined);
    return campaign;
  }

  public async close(id: string, triggeredByScheduler = false, scheduledVersion?: number): Promise<Campaign> {
    if (!triggeredByScheduler) {
      const campaign = await this.get(id);
      if (Date.parse(campaign.cutoffAt) > Date.now()) {
        throw new BusinessError('CAMPAIGN_CLOSED', '未到截单时间，不能提前结团', 409);
      }
    }
    if (!triggeredByScheduler) await this.scheduler.cancelClose(id).catch(() => undefined);
    const refundOrderIds:string[]=[];
    const result=await this.store.transaction(async (store) => {
    const campaign = await this.getForUpdate(id, store);
    if (scheduledVersion !== undefined && campaign.version !== scheduledVersion) return campaign;
    if (['LOCKED', 'POSTPONED', 'CANCELLED', 'FULFILLING', 'COMPLETED'].includes(campaign.status)) return campaign;
    const expectedVersion = campaign.version;
    campaign.status = transitionCampaign(campaign.status, 'CLOSING');
    const campaignOrders = await this.lockCampaignOrders(store, id);
    const totalQuantity = campaignOrders
      .filter((order) => order.campaignId === id && order.status === 'PAID_WAITING_CLOSE')
      .flatMap((order) => order.items)
      .reduce((sum, item) => sum + item.quantity, 0);

    if (totalQuantity >= campaign.minTotalQuantity) {
      campaign.status = transitionCampaign(campaign.status, 'LOCKED');
      for (const order of campaignOrders) {
        if (order.campaignId === id && order.status === 'PAID_WAITING_CLOSE') {
          await store.transitionOrderStatus(order.id, ['PAID_WAITING_CLOSE'], 'LOCKED');
        } else if (order.campaignId === id && order.status === 'PENDING_PAYMENT') {
          if (await this.cancelPendingAndRelease(store, order)) continue;
          const latest = await store.getOrder(order.id);
          if (latest?.status === 'PAID_WAITING_CLOSE' && await this.refundPaidAndRelease(store, latest)) refundOrderIds.push(latest.id);
        }
      }
    } else if (campaign.failureAction === 'POSTPONE') {
      campaign.status = transitionCampaign(campaign.status, 'POSTPONED');
    } else {
      campaign.status = transitionCampaign(campaign.status, 'CANCELLED');
      for (const order of campaignOrders) {
        if (order.status === 'PAID_WAITING_CLOSE') {
          if (await this.refundPaidAndRelease(store, order)) refundOrderIds.push(order.id);
        }
        if (order.status === 'PENDING_PAYMENT') {
          if (await this.cancelPendingAndRelease(store, order)) continue;
          const latest = await store.getOrder(order.id);
          if (latest?.status === 'PAID_WAITING_CLOSE' && await this.refundPaidAndRelease(store, latest)) refundOrderIds.push(latest.id);
        }
      }
    }
    campaign.version += 1;
    if (!(await store.updateCampaign(campaign, expectedVersion))) {
      throw new BusinessError('CONCURRENT_MODIFICATION', '团期已被其他操作更新，请刷新后重试', 409);
    }
    return campaign;
    });
    if(this.refundHandler)await Promise.allSettled(refundOrderIds.map((orderId)=>this.refundHandler!(orderId)));
    if(result.businessModelVersion==='PLATFORM_PROCUREMENT'&&result.status==='LOCKED'&&this.lockedHandler)await this.lockedHandler(result.id);
    return result;
  }

  private async releaseOrderStock(store: CommerceStore, order: { campaignId: string; businessModelVersion:Campaign['businessModelVersion']; items: Array<{ skuId: string; quantity: number }> }): Promise<void> {
    for (const item of order.items) {
      const released=order.businessModelVersion==='PLATFORM_PROCUREMENT'?await store.releaseCampaignPlatformStock(order.campaignId,item.skuId,item.quantity):order.businessModelVersion==='PLATFORM_COMMUNITY'?await store.releaseCommunityCampaignStock(order.campaignId,item.skuId,item.quantity):await store.releaseCampaignSkuStock(order.campaignId,item.skuId,item.quantity);
      if (!released) {
        throw new BusinessError('INVENTORY_INCONSISTENT', '订单库存释放失败，已回滚本次结团', 500, {
          campaignId: order.campaignId,
          skuId: item.skuId,
        });
      }
    }
  }

  private async cancelPendingAndRelease(store: CommerceStore, order: { id:string; campaignId:string; businessModelVersion:Campaign['businessModelVersion']; items:Array<{skuId:string;quantity:number}> }): Promise<boolean> {
    if (!(await store.transitionOrderStatus(order.id, ['PENDING_PAYMENT'], 'CANCELLED'))) return false;
    await this.releaseOrderStock(store, order);
    return true;
  }

  private async refundPaidAndRelease(store: CommerceStore, order: { id:string; campaignId:string; businessModelVersion:Campaign['businessModelVersion']; items:Array<{skuId:string;quantity:number}> }): Promise<boolean> {
    if (!(await store.transitionOrderStatus(order.id, ['PAID_WAITING_CLOSE'], 'REFUNDING'))) return false;
    await this.releaseOrderStock(store, order);
    return true;
  }

  private async lockCampaignOrders(store: CommerceStore, campaignId: string) {
    const summaries = await store.listOrdersByCampaign(campaignId);
    const locked = await Promise.all([...summaries].sort((left, right) => left.id.localeCompare(right.id)).map((order) => store.getOrderForUpdate(order.id)));
    return locked.filter((order): order is NonNullable<typeof order> => order !== null);
  }

  private async snapshotItems(store: CommerceStore, skuIds: string[], excludeCampaignId?: string): Promise<CampaignItemSnapshot[]> {
    const uniqueSkuIds = [...new Set(skuIds)];
    // Every create/edit runs inside a store transaction. Lock in a stable order so two
    // operators cannot both reserve the same unallocated SKU quantity for different campaigns.
    const lockedSkus = new Map<string, Awaited<ReturnType<CommerceStore['getSkuForUpdate']>>>();
    for (const skuId of [...uniqueSkuIds].sort()) lockedSkus.set(skuId, await store.getSkuForUpdate(skuId));
    const products = new Map((await store.listProducts()).map((product) => [product.sku.id, product]));
    const activeCampaigns = (await store.listCampaigns()).filter((campaign) => campaign.id !== excludeCampaignId && !['CANCELLED', 'COMPLETED'].includes(campaign.status));
    const snapshots: CampaignItemSnapshot[] = [];
    for (const skuId of uniqueSkuIds) {
      const product = products.get(skuId);
      const purchasableSku = lockedSkus.get(skuId);
      if (!product || !purchasableSku) throw new BusinessError('RESOURCE_NOT_FOUND', `商品 ${skuId} 不存在或当前不可开团`, 404);
      const allocatedElsewhere = activeCampaigns
        .flatMap((campaign) => campaign.items)
        .filter((item) => item.skuId === skuId)
        .reduce((sum, item) => sum + Math.max(0, item.stock - item.soldQuantity), 0);
      const available = product.sku.stock - product.sku.soldQuantity - allocatedElsewhere;
      if (available <= 0) throw new BusinessError('OUT_OF_STOCK', `${product.title} 已无可售库存`, 409);
      snapshots.push({
        skuId, productId: product.id, merchantId: product.merchantId, title: product.title, category: product.category,
        skuName: product.sku.name, origin: product.origin, imageUrl: product.imageUrl,
        unitPriceCents: product.sku.unitPriceCents, stock: available, soldQuantity: 0, commissionRateBps: purchasableSku.commissionRateBps,
      });
    }
    return snapshots;
  }
}
