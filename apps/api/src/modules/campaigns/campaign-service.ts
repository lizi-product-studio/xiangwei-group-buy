import type { PostponeCampaignInput } from "@hometown/api-contracts";
import { BusinessError, transitionCampaign } from "@hometown/domain";
import type { CampaignScheduler } from "./campaign-scheduler.js";
import type { CommerceStore } from "../core/store.js";
import type { Campaign, Order } from "../core/types.js";
import { isDeliveryPlanReadyForSale } from "./sellability.js";

export class CampaignService {
  private refundHandler: ((orderId: string) => Promise<void>) | null = null;
  public constructor(
    private readonly store: CommerceStore,
    private readonly scheduler: CampaignScheduler,
  ) {}
  public setRefundHandler(handler: (orderId: string) => Promise<void>): void {
    this.refundHandler = handler;
  }
  public async list(): Promise<Campaign[]> {
    return this.store.listCampaigns();
  }
  public async listPublic(now = Date.now()): Promise<Campaign[]> {
    const [campaigns, areas, plans, points] = await Promise.all([
      this.store.listCampaigns(),
      this.store.listServiceAreas(),
      this.store.listDeliveryPlans(),
      this.store.listPickupPoints(),
    ]);
    const enabledAreas = new Set(
      areas
        .filter((area) => area.status === "ENABLED" && area.orderEnabled)
        .map((area) => area.id),
    );
    const activePoints = new Set(
      points
        .filter((point) => point.status === "ACTIVE")
        .map((point) => point.id),
    );
    const planByCampaign = new Map(
      plans.map((plan) => [plan.campaignId, plan]),
    );
    return campaigns.filter((campaign) => {
      const plan = planByCampaign.get(campaign.id);
      return (
        campaign.status === "OPEN" &&
        Date.parse(campaign.cutoffAt) > now &&
        enabledAreas.has(campaign.serviceAreaId) &&
        plan?.serviceAreaId === campaign.serviceAreaId &&
        isDeliveryPlanReadyForSale(plan) &&
        activePoints.has(plan.pickupPointId)
      );
    });
  }
  public async getPublic(id: string, now = Date.now()): Promise<Campaign> {
    const campaign = (await this.listPublic(now)).find(
      (item) => item.id === id,
    );
    if (!campaign)
      throw new BusinessError(
        "RESOURCE_NOT_FOUND",
        "团期不存在或当前不可购买",
        404,
      );
    return campaign;
  }
  public async get(
    id: string,
    store: CommerceStore = this.store,
  ): Promise<Campaign> {
    const campaign = await store.getCampaign(id);
    if (!campaign)
      throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
    return campaign;
  }
  public async postpone(
    id: string,
    input: PostponeCampaignInput,
  ): Promise<Campaign> {
    const result = await this.store.transaction(async (store) => {
      const campaign = await store.getCampaignForUpdate(id);
      if (!campaign)
        throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
      if (campaign.status !== "POSTPONED")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "只有已顺延团期可以重新开售",
          409,
        );
      if (Date.parse(input.cutoffAt) <= Date.now())
        throw new BusinessError(
          "VALIDATION_ERROR",
          "新的截单时间必须晚于当前时间",
          400,
        );
      const expected = campaign.version;
      Object.assign(campaign, input, {
        status: transitionCampaign(campaign.status, "OPEN"),
        version: expected + 1,
      });
      if (!(await store.updateCampaign(campaign, expected)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "团期已被其他操作更新",
          409,
        );
      return campaign;
    });
    await this.scheduler
      .scheduleClose(result.id, result.cutoffAt, result.version)
      .catch(() => undefined);
    return result;
  }
  public async open(id: string): Promise<Campaign> {
    const result = await this.store.transaction(async (store) => {
      const campaign = await store.getCampaignForUpdate(id);
      if (!campaign)
        throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
      if (Date.parse(campaign.cutoffAt) <= Date.now())
        throw new BusinessError(
          "CAMPAIGN_CLOSED",
          "截单时间已过，不能开售",
          409,
        );
      const area = (await store.listServiceAreas()).find(
        (item) =>
          item.id === campaign.serviceAreaId &&
          item.status === "ENABLED" &&
          item.orderEnabled,
      );
      const plan = await store.getDeliveryPlanByCampaign(id);
      const point = plan
        ? (await store.listPickupPoints(campaign.serviceAreaId)).find(
            (item) =>
              item.id === plan.pickupPointId && item.status === "ACTIVE",
          )
        : null;
      if (!area || !plan || !point || !isDeliveryPlanReadyForSale(plan))
        throw new BusinessError(
          "DELIVERY_SITE_NOT_CONFIRMED",
          "服务区域或固定自提点不可用",
          409,
        );
      const expected = campaign.version;
      campaign.status = transitionCampaign(campaign.status, "OPEN");
      campaign.version += 1;
      if (!(await store.updateCampaign(campaign, expected)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "团期已被其他操作更新",
          409,
        );
      return campaign;
    });
    await this.scheduler
      .scheduleClose(result.id, result.cutoffAt, result.version)
      .catch(() => undefined);
    return result;
  }
  public async close(
    id: string,
    triggeredByScheduler = false,
    scheduledVersion?: number,
  ): Promise<Campaign> {
    if (!triggeredByScheduler) {
      const campaign = await this.get(id);
      if (Date.parse(campaign.cutoffAt) > Date.now())
        throw new BusinessError(
          "CAMPAIGN_CLOSED",
          "未到截单时间，不能提前结团",
          409,
        );
      await this.scheduler.cancelClose(id).catch(() => undefined);
    }
    const refunds: string[] = [];
    const result = await this.store.transaction(async (store) => {
      const campaign = await store.getCampaignForUpdate(id);
      if (!campaign)
        throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
      if (
        scheduledVersion !== undefined &&
        campaign.version !== scheduledVersion
      )
        return campaign;
      if (
        [
          "LOCKED",
          "POSTPONED",
          "CANCELLED",
          "FULFILLING",
          "COMPLETED",
        ].includes(campaign.status)
      )
        return campaign;
      const expected = campaign.version;
      campaign.status = transitionCampaign(campaign.status, "CLOSING");
      const orders = await store.listOrdersByCampaign(id);
      const quantity = orders
        .filter((order) => order.status === "PAID_WAITING_CLOSE")
        .flatMap((order) => order.items)
        .reduce((sum, item) => sum + item.quantity, 0);
      if (quantity >= campaign.minTotalQuantity) {
        campaign.status = transitionCampaign(campaign.status, "LOCKED");
        for (const order of orders) {
          if (order.status === "PAID_WAITING_CLOSE")
            await store.transitionOrderStatus(
              order.id,
              ["PAID_WAITING_CLOSE"],
              "LOCKED",
            );
          else if (order.status === "PENDING_PAYMENT")
            await this.cancelPending(store, order);
        }
      } else if (campaign.failureAction === "POSTPONE") {
        campaign.status = transitionCampaign(campaign.status, "POSTPONED");
      } else {
        campaign.status = transitionCampaign(campaign.status, "CANCELLED");
        for (const order of orders) {
          if (order.status === "PENDING_PAYMENT")
            await this.cancelPending(store, order);
          else if (
            order.status === "PAID_WAITING_CLOSE" &&
            (await this.markRefunding(store, order))
          )
            refunds.push(order.id);
        }
      }
      campaign.version += 1;
      if (!(await store.updateCampaign(campaign, expected)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "团期已被其他操作更新",
          409,
        );
      return campaign;
    });
    if (this.refundHandler)
      await Promise.allSettled(
        refunds.map((orderId) => this.refundHandler!(orderId)),
      );
    return result;
  }
  public async cancel(id: string): Promise<Campaign> {
    await this.scheduler.cancelClose(id).catch(() => undefined);
    const refunds: string[] = [];
    const result = await this.store.transaction(async (store) => {
      const campaign = await store.getCampaignForUpdate(id);
      if (!campaign)
        throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
      if (!["DRAFT", "OPEN", "POSTPONED"].includes(campaign.status))
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "当前团期不能取消",
          409,
        );
      const expected = campaign.version;
      for (const order of await store.listOrdersByCampaign(id)) {
        if (order.status === "PENDING_PAYMENT")
          await this.cancelPending(store, order);
        else if (
          order.status === "PAID_WAITING_CLOSE" &&
          (await this.markRefunding(store, order))
        )
          refunds.push(order.id);
      }
      campaign.status = transitionCampaign(campaign.status, "CANCELLED");
      campaign.version += 1;
      if (!(await store.updateCampaign(campaign, expected)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "团期已被其他操作更新",
          409,
        );
      return campaign;
    });
    if (this.refundHandler)
      await Promise.allSettled(
        refunds.map((orderId) => this.refundHandler!(orderId)),
      );
    return result;
  }
  private async cancelPending(
    store: CommerceStore,
    order: Order,
  ): Promise<void> {
    if (!(await store.cancelPendingOrder(order.id))) return;
    for (const item of order.items)
      if (
        !(await store.releaseCampaignInventory(
          order.campaignId,
          item.skuId,
          item.quantity,
        ))
      )
        throw new BusinessError(
          "INVENTORY_INCONSISTENT",
          "取消订单释放库存失败",
          500,
        );
  }
  private async markRefunding(
    store: CommerceStore,
    order: Order,
  ): Promise<boolean> {
    if (
      !(await store.transitionOrderStatus(
        order.id,
        ["PAID_WAITING_CLOSE"],
        "REFUNDING",
      ))
    )
      return false;
    for (const item of order.items)
      if (
        !(await store.releaseCampaignInventory(
          order.campaignId,
          item.skuId,
          item.quantity,
        ))
      )
        throw new BusinessError(
          "INVENTORY_INCONSISTENT",
          "退款释放库存失败",
          500,
        );
    return true;
  }
}
