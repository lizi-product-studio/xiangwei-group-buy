import type { PostponeCampaignInput } from "@hometown/api-contracts";
import { BusinessError, transitionCampaign } from "@hometown/domain";
import type { CampaignScheduler } from "./campaign-scheduler.js";
import type { CommerceStore } from "../core/store.js";
import type { Campaign, DeliveryPlan, Order } from "../core/types.js";
import { isDeliveryPlanReadyForSale } from "./sellability.js";

export type CampaignPostponeAuditContext = {
  actorId: string;
  requestId: string;
};
export type CampaignActionAuditContext = CampaignPostponeAuditContext & {
  reason: string | null;
};

export class CampaignService {
  /** Creates a durable refund obligation inside the campaign transaction. */
  private refundHandler: ((store: CommerceStore, orderId: string) => Promise<void>) | null = null;
  /**
   * Campaign time changes are customer-facing facts. The app supplies the
   * notification outbox writer so this service can enqueue inside the same
   * campaign transaction without acquiring a broad notification dependency.
   */
  private postponeNotificationHandler: ((
    store: CommerceStore,
    campaign: Campaign,
    plan: DeliveryPlan,
  ) => Promise<void>) | null = null;
  private postponeAuditHandler: ((
    store: CommerceStore,
    context: CampaignPostponeAuditContext,
    before: Campaign,
    after: Campaign,
  ) => Promise<void>) | null = null;
  private actionAuditHandler: ((
    store: CommerceStore,
    context: CampaignActionAuditContext,
    action: "CLOSE" | "CANCEL",
    before: Campaign,
    after: Campaign,
  ) => Promise<void>) | null = null;
  public constructor(
    private readonly store: CommerceStore,
    private readonly scheduler: CampaignScheduler,
  ) {}
  public setRefundHandler(handler: (store: CommerceStore, orderId: string) => Promise<void>): void {
    this.refundHandler = handler;
  }
  public setPostponeNotificationHandler(
    handler: (
      store: CommerceStore,
      campaign: Campaign,
      plan: DeliveryPlan,
    ) => Promise<void>,
  ): void {
    this.postponeNotificationHandler = handler;
  }
  /** The composition root supplies an audit writer backed by the same store. */
  public setPostponeAuditHandler(
    handler: (
      store: CommerceStore,
      context: CampaignPostponeAuditContext,
      before: Campaign,
      after: Campaign,
    ) => Promise<void>,
  ): void {
    this.postponeAuditHandler = handler;
  }
  public setActionAuditHandler(
    handler: (
      store: CommerceStore,
      context: CampaignActionAuditContext,
      action: "CLOSE" | "CANCEL",
      before: Campaign,
      after: Campaign,
    ) => Promise<void>,
  ): void {
    this.actionAuditHandler = handler;
  }
  private async createRefundObligation(
    store: CommerceStore,
    orderId: string,
  ): Promise<void> {
    if (!this.refundHandler)
      throw new Error(
        "CampaignService requires a refund obligation writer before cancelling paid orders",
      );
    await this.refundHandler(store, orderId);
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
        Boolean(campaign.estimatedArrivalStartAt) &&
        Boolean(campaign.estimatedArrivalEndAt) &&
        Date.parse(campaign.estimatedArrivalStartAt) >=
          Date.parse(campaign.dispatchAt) &&
        Date.parse(campaign.estimatedArrivalEndAt) >=
          Date.parse(campaign.estimatedArrivalStartAt) &&
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
    context: CampaignPostponeAuditContext,
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
      if ((campaign.postponementCount ?? 0) >= 1)
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "团期最多顺延一次，再次未成团必须取消退款",
          409,
        );
      const before = structuredClone(campaign);
      const now = Date.now();
      if (
        [
          input.cutoffAt,
          input.dispatchAt,
          input.estimatedArrivalStartAt,
          input.estimatedArrivalEndAt,
        ].some((value) => Date.parse(value) <= now)
      )
        throw new BusinessError(
          "VALIDATION_ERROR",
          "顺延后的截单、发车和预计到货时间必须晚于当前时间",
          400,
        );
      const arrivalStartAt = input.estimatedArrivalStartAt;
      const arrivalEndAt = input.estimatedArrivalEndAt;
      if (
        !arrivalStartAt ||
        !arrivalEndAt ||
        Date.parse(arrivalStartAt) < Date.parse(input.dispatchAt) ||
        Date.parse(arrivalEndAt) < Date.parse(arrivalStartAt)
      )
        throw new BusinessError(
          "VALIDATION_ERROR",
          "顺延后必须保留有效的预计到货时间窗口",
          400,
        );
      const expected = campaign.version;
      Object.assign(campaign, input, {
        status: transitionCampaign(campaign.status, "OPEN"),
        postponementCount: (campaign.postponementCount ?? 0) + 1,
        version: expected + 1,
      });
      const deliveryPlan = await store.getDeliveryPlanByCampaign(id);
      if (!deliveryPlan)
        throw new BusinessError(
          "DELIVERY_SITE_NOT_CONFIRMED",
          "顺延团期缺少固定自提点配送计划",
          409,
        );
      deliveryPlan.arrivalStartAt = arrivalStartAt;
      deliveryPlan.arrivalEndAt = arrivalEndAt;
      deliveryPlan.updatedAt = new Date().toISOString();
      await store.saveDeliveryPlan(deliveryPlan);
      if (!(await store.updateCampaign(campaign, expected)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "团期已被其他操作更新",
          409,
        );
      if (this.postponeNotificationHandler)
        await this.postponeNotificationHandler(store, campaign, deliveryPlan);
      if (this.postponeAuditHandler)
        await this.postponeAuditHandler(store, context, before, campaign);
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
      if (
        !campaign.estimatedArrivalStartAt ||
        !campaign.estimatedArrivalEndAt ||
        Date.parse(campaign.estimatedArrivalStartAt) <
          Date.parse(campaign.dispatchAt) ||
        Date.parse(campaign.estimatedArrivalEndAt) <
          Date.parse(campaign.estimatedArrivalStartAt)
      )
        throw new BusinessError(
          "DELIVERY_SITE_NOT_CONFIRMED",
          "开售前必须配置有效的预计到货时间窗口",
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
    context?: CampaignActionAuditContext,
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
      const before = structuredClone(campaign);
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
      } else if (
        campaign.failureAction === "POSTPONE" &&
        (campaign.postponementCount ?? 0) < 1
      ) {
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
            await this.createRefundObligation(store, order.id);
        }
      }
      campaign.version += 1;
      if (!(await store.updateCampaign(campaign, expected)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "团期已被其他操作更新",
          409,
        );
      if (context && this.actionAuditHandler)
        await this.actionAuditHandler(
          store,
          context,
          "CLOSE",
          before,
          campaign,
        );
      return campaign;
    });
    return result;
  }
  public async cancel(
    id: string,
    context?: CampaignActionAuditContext,
  ): Promise<Campaign> {
    await this.scheduler.cancelClose(id).catch(() => undefined);
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
      const before = structuredClone(campaign);
      const expected = campaign.version;
      for (const order of await store.listOrdersByCampaign(id)) {
        if (order.status === "PENDING_PAYMENT")
          await this.cancelPending(store, order);
        else if (
          order.status === "PAID_WAITING_CLOSE" &&
          (await this.markRefunding(store, order))
        )
          await this.createRefundObligation(store, order.id);
      }
      campaign.status = transitionCampaign(campaign.status, "CANCELLED");
      campaign.version += 1;
      if (!(await store.updateCampaign(campaign, expected)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "团期已被其他操作更新",
          409,
        );
      if (context && this.actionAuditHandler)
        await this.actionAuditHandler(
          store,
          context,
          "CANCEL",
          before,
          campaign,
        );
      return campaign;
    });
    return result;
  }
  public async cancelImpact(id: string): Promise<{
    pendingPaymentOrderCount: number;
    paidOrderCount: number;
    estimatedRefundCents: number;
  }> {
    const campaign = await this.get(id);
    if (!["DRAFT", "OPEN", "POSTPONED"].includes(campaign.status))
      throw new BusinessError("INVALID_STATE_TRANSITION", "当前团期不能取消", 409);
    const orders = await this.store.listOrdersByCampaign(id);
    const paid = orders.filter((order) => Boolean(order.paidAt));
    return {
      pendingPaymentOrderCount: orders.filter(
        (order) => order.status === "PENDING_PAYMENT",
      ).length,
      paidOrderCount: paid.length,
      estimatedRefundCents: paid
        .filter((order) => order.status !== "CANCELLED")
        .reduce((sum, order) => sum + Number(order.totalCents), 0),
    };
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
