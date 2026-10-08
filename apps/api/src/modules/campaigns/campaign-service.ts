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
function summarizeCampaignGroup(campaigns: readonly Campaign[]): Campaign["status"] | "PARTIAL" {
  if (!campaigns.length) return "CANCELLED";
  const statuses = new Set(campaigns.map((campaign) => campaign.status));
  return statuses.size === 1 ? campaigns[0]!.status : "PARTIAL";
}
async function paidQuantityForCampaign(store: CommerceStore, campaignId: string): Promise<number> {
  const skuQuantities = await store.getNetSalesQuantities(campaignId);
  return [...skuQuantities.values()].reduce((sum, quantity) => sum + quantity, 0);
}

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
    // Only OPEN campaigns can be public; read them (and their plans) by index
    // instead of the full campaign history.
    const [campaigns, areas, points] = await Promise.all([
      this.store.listCampaignsByStatus(["OPEN"]),
      this.store.listServiceAreas(),
      this.store.listPickupPoints(),
    ]);
    const plans = await this.store.listDeliveryPlansByCampaigns(campaigns.map((campaign) => campaign.id));
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
    context: CampaignPostponeAuditContext,
  ): Promise<Campaign> {
    const current = await this.store.getCampaign(id);
    if (current?.campaignGroupId)
      throw new BusinessError("INVALID_STATE_TRANSITION", "多点活动必须统一调整截单并逐点设置发车时间", 409);
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
      if ([input.cutoffAt, input.dispatchAt].some((value) => Date.parse(value) <= now) ||
        (input.estimatedArrivalStartAt && Date.parse(input.estimatedArrivalStartAt) <= now) ||
        (input.estimatedArrivalEndAt && Date.parse(input.estimatedArrivalEndAt) <= now))
        throw new BusinessError(
          "VALIDATION_ERROR",
          "顺延后的截单、发车和预计到货时间必须晚于当前时间",
          400,
        );
      const arrivalStartAt = input.estimatedArrivalStartAt;
      const arrivalEndAt = input.estimatedArrivalEndAt;
      if (Boolean(arrivalStartAt) !== Boolean(arrivalEndAt) ||
        (arrivalStartAt && Date.parse(arrivalStartAt) < Date.parse(input.dispatchAt)) ||
        (arrivalStartAt && arrivalEndAt && Date.parse(arrivalEndAt) < Date.parse(arrivalStartAt)))
        throw new BusinessError(
          "VALIDATION_ERROR",
          "顺延后的预计到货时间窗口不完整或顺序无效",
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
  public async postponeCampaignGroup(
    groupId: string,
    input: {
      cutoffAt: string;
      points: Array<{ campaignId: string; dispatchAt: string; estimatedArrivalStartAt: string | null; estimatedArrivalEndAt: string | null }>;
    },
    context: CampaignPostponeAuditContext,
  ): Promise<Campaign[]> {
    const result = await this.store.transaction(async (store) => {
      const group = await store.getCampaignGroup(groupId);
      if (!group) throw new BusinessError("RESOURCE_NOT_FOUND", "活动分组不存在", 404);
      if (!["POSTPONED", "PARTIAL"].includes(group.status) || group.postponementCount >= 1)
        throw new BusinessError("INVALID_STATE_TRANSITION", "当前多点活动不能再次顺延", 409);
      const members = await Promise.all(group.campaignIds.map((id) => store.getCampaignForUpdate(id)));
      if (members.length < 2 || members.some((campaign) => !campaign || campaign.campaignGroupId !== group.id))
        throw new BusinessError("FINANCIAL_INCONSISTENT", "多点活动的团期状态不一致", 409);
      const postponed = (members as Campaign[]).filter((campaign) => campaign.status === "POSTPONED");
      if (!postponed.length || postponed.some((campaign) => (campaign.postponementCount ?? 0) >= 1))
        throw new BusinessError("INVALID_STATE_TRANSITION", "当前没有可顺延的失败点位，或其已达到顺延次数上限", 409);
      const schedules = new Map(input.points.map((point) => [point.campaignId, point]));
      if (schedules.size !== postponed.length || postponed.some((campaign) => !schedules.has(campaign.id)) || [...schedules.keys()].some((id) => !postponed.some((campaign) => campaign.id === id)))
        throw new BusinessError("VALIDATION_ERROR", "只能为所有本轮未成团且已顺延的点位提供新的履约时间", 400);
      const now = Date.now();
      if (Date.parse(input.cutoffAt) <= now) throw new BusinessError("VALIDATION_ERROR", "新的统一截单时间必须晚于当前时间", 400);
      const expectedGroupVersion = group.version;
      for (const campaign of postponed) {
        const schedule = schedules.get(campaign.id)!;
        if (Date.parse(schedule.dispatchAt) <= now || Date.parse(schedule.dispatchAt) <= Date.parse(input.cutoffAt) ||
          (Boolean(schedule.estimatedArrivalStartAt) !== Boolean(schedule.estimatedArrivalEndAt)) ||
          (schedule.estimatedArrivalStartAt && Date.parse(schedule.estimatedArrivalStartAt) <= now) ||
          (schedule.estimatedArrivalEndAt && Date.parse(schedule.estimatedArrivalEndAt) <= now) ||
          (schedule.estimatedArrivalStartAt && Date.parse(schedule.estimatedArrivalStartAt) < Date.parse(schedule.dispatchAt)) ||
          (schedule.estimatedArrivalStartAt && schedule.estimatedArrivalEndAt && Date.parse(schedule.estimatedArrivalEndAt) < Date.parse(schedule.estimatedArrivalStartAt)))
          throw new BusinessError("VALIDATION_ERROR", "顺延后的履约时间无效", 400, { campaignId: campaign.id });
        const before = structuredClone(campaign);
        const expected = campaign.version;
        campaign.cutoffAt = input.cutoffAt;
        campaign.dispatchAt = schedule.dispatchAt;
        campaign.estimatedArrivalStartAt = schedule.estimatedArrivalStartAt;
        campaign.estimatedArrivalEndAt = schedule.estimatedArrivalEndAt;
        campaign.postponementCount = (campaign.postponementCount ?? 0) + 1;
        campaign.status = transitionCampaign(campaign.status, "OPEN");
        campaign.version += 1;
        const plan = await store.getDeliveryPlanByCampaign(campaign.id);
        if (!plan) throw new BusinessError("DELIVERY_SITE_NOT_CONFIRMED", "多点活动缺少固定自提点配送计划", 409, { campaignId: campaign.id });
        plan.arrivalStartAt = schedule.estimatedArrivalStartAt;
        plan.arrivalEndAt = schedule.estimatedArrivalEndAt;
        plan.updatedAt = new Date().toISOString();
        await store.saveDeliveryPlan(plan);
        if (!(await store.updateCampaign(campaign, expected))) throw new BusinessError("CONCURRENT_MODIFICATION", "活动中的点位团期已被其他操作更新", 409);
        if (this.postponeNotificationHandler) await this.postponeNotificationHandler(store, campaign, plan);
        if (this.postponeAuditHandler) await this.postponeAuditHandler(store, context, before, campaign);
      }
      group.cutoffAt = input.cutoffAt;
      group.status = summarizeCampaignGroup(members as Campaign[]);
      group.postponementCount += 1;
      group.version += 1;
      if (!(await store.updateCampaignGroup(group, expectedGroupVersion))) throw new BusinessError("CONCURRENT_MODIFICATION", "多点活动已被其他操作更新", 409);
      return await Promise.all(postponed.map((campaign) => store.getCampaign(campaign.id) as Promise<Campaign | null>));
    });
    const anchor = result[0];
    if (anchor) await this.scheduler.scheduleClose(anchor.id, anchor.cutoffAt, anchor.version).catch(() => undefined);
    return result.filter((campaign): campaign is Campaign => campaign !== null);
  }
  public async open(id: string): Promise<Campaign> {
    const current = await this.store.getCampaign(id);
    if (current?.campaignGroupId)
      return this.openCampaignGroup(current.campaignGroupId, id);
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
        (Boolean(campaign.estimatedArrivalStartAt) !== Boolean(campaign.estimatedArrivalEndAt)) ||
        (campaign.estimatedArrivalStartAt && Date.parse(campaign.estimatedArrivalStartAt) < Date.parse(campaign.dispatchAt)) ||
        (campaign.estimatedArrivalStartAt && campaign.estimatedArrivalEndAt && Date.parse(campaign.estimatedArrivalEndAt) < Date.parse(campaign.estimatedArrivalStartAt))
      )
        throw new BusinessError(
          "DELIVERY_SITE_NOT_CONFIRMED",
          "预计到货时间窗口不完整或顺序无效",
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
  private async openCampaignGroup(groupId: string, requestedCampaignId: string): Promise<Campaign> {
    const result = await this.store.transaction(async (store) => {
      const group = await store.getCampaignGroup(groupId);
      if (!group) throw new BusinessError("RESOURCE_NOT_FOUND", "活动分组不存在", 404);
      const campaigns = await Promise.all(group.campaignIds.map((id) => store.getCampaignForUpdate(id)));
      if (campaigns.length < 2 || campaigns.some((campaign) => !campaign || campaign.campaignGroupId !== group.id))
        throw new BusinessError("FINANCIAL_INCONSISTENT", "活动分组的点位团期映射异常", 500);
      const members = campaigns as Campaign[];
      if (members.some((campaign) => campaign.status !== "DRAFT" || campaign.cutoffAt !== group.cutoffAt))
        throw new BusinessError("INVALID_STATE_TRANSITION", "多点活动必须以统一截单时间整体开售", 409);
      if (Date.parse(group.cutoffAt) <= Date.now())
        throw new BusinessError("CAMPAIGN_CLOSED", "截单时间已过，不能开售", 409);
      const areas = new Map((await store.listServiceAreas()).map((area) => [area.id, area]));
      const points = new Map((await store.listPickupPoints()).map((point) => [point.id, point]));
      for (const campaign of members) {
        const plan = await store.getDeliveryPlanByCampaign(campaign.id);
        const area = areas.get(campaign.serviceAreaId);
        const point = plan ? points.get(plan.pickupPointId) : null;
        if (!area || area.status !== "ENABLED" || !area.orderEnabled || !point || point.status !== "ACTIVE" || point.serviceAreaId !== area.id || !isDeliveryPlanReadyForSale(plan!))
          throw new BusinessError("DELIVERY_SITE_NOT_CONFIRMED", "多点活动中有区域或固定自提点不可用", 409, { campaignId: campaign.id });
        if ((Boolean(campaign.estimatedArrivalStartAt) !== Boolean(campaign.estimatedArrivalEndAt)) || (campaign.estimatedArrivalStartAt && Date.parse(campaign.estimatedArrivalStartAt) < Date.parse(campaign.dispatchAt)) || (campaign.estimatedArrivalStartAt && campaign.estimatedArrivalEndAt && Date.parse(campaign.estimatedArrivalEndAt) < Date.parse(campaign.estimatedArrivalStartAt)))
          throw new BusinessError("DELIVERY_SITE_NOT_CONFIRMED", "多点活动中有无效的预计到货时间", 409, { campaignId: campaign.id });
      }
      const expectedGroupVersion = group.version;
      for (const campaign of members) {
        const expected = campaign.version;
        campaign.status = transitionCampaign(campaign.status, "OPEN");
        campaign.version += 1;
        if (!(await store.updateCampaign(campaign, expected))) throw new BusinessError("CONCURRENT_MODIFICATION", "活动点位团期已被其他操作更新", 409);
      }
      group.status = "OPEN";
      group.version += 1;
      if (!(await store.updateCampaignGroup(group, expectedGroupVersion))) throw new BusinessError("CONCURRENT_MODIFICATION", "多点活动已被其他操作更新", 409);
      return members.find((campaign) => campaign.id === requestedCampaignId) ?? members[0]!;
    });
    // One queue entry represents the shared cutoff. Any replay is fenced by
    // the group transaction and member versions below.
    const anchor = await this.store.getCampaignGroup(groupId);
    const anchorCampaign = anchor ? await this.store.getCampaign(anchor.campaignIds[0]!) : null;
    if (anchorCampaign) await this.scheduler.scheduleClose(anchorCampaign.id, anchorCampaign.cutoffAt, anchorCampaign.version).catch(() => undefined);
    return result;
  }
  public async close(
    id: string,
    triggeredByScheduler = false,
    scheduledVersion?: number,
    context?: CampaignActionAuditContext,
  ): Promise<Campaign> {
    const current = await this.store.getCampaign(id);
    if (current?.campaignGroupId)
      return this.closeCampaignGroup(current.campaignGroupId, id, triggeredByScheduler, scheduledVersion, context);
    // Operators may stop taking orders before the planned cutoff. The
    // transaction below remains the single authority for locking paid
    // orders, cancelling unpaid orders and applying the published
    // unformed-campaign rule.
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
      let orders = await store.listOrdersByCampaign(id);
      orders = await this.refreshCampaignOrdersAfterBatchLocks(store, orders);
      const quantity = await paidQuantityForCampaign(store, id);
      if (quantity >= campaign.minTotalQuantity) {
        campaign.status = transitionCampaign(campaign.status, "LOCKED");
      } else if (
        campaign.failureAction === "POSTPONE" &&
        (campaign.postponementCount ?? 0) < 1
      ) {
        campaign.status = transitionCampaign(campaign.status, "POSTPONED");
      } else {
        campaign.status = transitionCampaign(campaign.status, "CANCELLED");
      }
      campaign.version += 1;
      if (!(await store.updateCampaign(campaign, expected)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "团期已被其他操作更新",
          409,
        );
      if (campaign.status === "LOCKED") {
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
      } else if (campaign.status === "CANCELLED") {
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
      const finalCampaign = await store.getCampaign(id);
      if (!finalCampaign)
        throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
      if (context && this.actionAuditHandler)
        await this.actionAuditHandler(
          store,
          context,
          "CLOSE",
          before,
          finalCampaign,
        );
      return finalCampaign;
    });
    if (!triggeredByScheduler)
      await this.scheduler.cancelClose(id).catch(() => undefined);
    return result;
  }
  private async closeCampaignGroup(
    groupId: string,
    requestedCampaignId: string,
    triggeredByScheduler: boolean,
    scheduledVersion?: number,
    context?: CampaignActionAuditContext,
  ): Promise<Campaign> {
    const result = await this.store.transaction(async (store) => {
      const group = await store.getCampaignGroup(groupId);
      if (!group) throw new BusinessError("RESOURCE_NOT_FOUND", "活动分组不存在", 404);
      const members = await Promise.all(group.campaignIds.map((memberId) => store.getCampaignForUpdate(memberId)));
      if (members.length < 2 || members.some((member) => !member || member.campaignGroupId !== group.id))
        throw new BusinessError("FINANCIAL_INCONSISTENT", "活动分组的点位团期映射异常", 500);
      const campaigns = members as Campaign[];
      const scheduledCampaign = campaigns.find((member) => member.id === requestedCampaignId);
      if (!scheduledCampaign) throw new BusinessError("FINANCIAL_INCONSISTENT", "触发团期不属于该活动分组", 500);
      if (scheduledVersion !== undefined && scheduledCampaign.version !== scheduledVersion) return scheduledCampaign;
      if (scheduledCampaign.status !== "OPEN") return scheduledCampaign;
      const active = campaigns.filter((member) => member.status === "OPEN");
      if (campaigns.some((member) => member.status === "DRAFT"))
        throw new BusinessError("FINANCIAL_INCONSISTENT", "活动分组仍有草稿点位，不能截单", 500);
      if (new Set(active.map((member) => member.cutoffAt)).size > 1)
        throw new BusinessError("FINANCIAL_INCONSISTENT", "同轮开售的活动点位必须共用截单时间", 500);
      const before = new Map(active.map((member) => [member.id, structuredClone(member)]));
      const ordersByCampaign = new Map<string, Order[]>();
      for (const campaign of active) {
        const orders = await store.listOrdersByCampaign(campaign.id);
        ordersByCampaign.set(campaign.id, await this.refreshCampaignOrdersAfterBatchLocks(store, orders));
      }
      const quantities = await Promise.all(active.map((campaign) => paidQuantityForCampaign(store, campaign.id)));
      const outcomeByCampaign = new Map<string, "LOCKED" | "POSTPONED" | "CANCELLED">();
      if (group.groupingMode === "ALL_POINTS") {
        const formed = quantities.reduce((sum, value) => sum + value, 0) >= group.minTotalQuantity;
        const outcome = formed ? "LOCKED" : group.failureAction === "POSTPONE" && active.every((campaign) => (campaign.postponementCount ?? 0) < 1) ? "POSTPONED" : "CANCELLED";
        for (const campaign of active) outcomeByCampaign.set(campaign.id, outcome);
      } else {
        active.forEach((campaign, index) => {
          const formed = quantities[index]! >= group.minTotalQuantity;
          const outcome = formed ? "LOCKED" : group.failureAction === "POSTPONE" && (campaign.postponementCount ?? 0) < 1 ? "POSTPONED" : "CANCELLED";
          outcomeByCampaign.set(campaign.id, outcome);
        });
      }
      for (const campaign of active) {
        const expected = campaign.version;
        campaign.status = transitionCampaign(transitionCampaign(campaign.status, "CLOSING"), outcomeByCampaign.get(campaign.id)!);
        campaign.version += 1;
        if (!(await store.updateCampaign(campaign, expected)))
          throw new BusinessError("CONCURRENT_MODIFICATION", "活动分组中的点位团期已被其他操作更新", 409);
      }
      const expectedGroupVersion = group.version;
      group.status = summarizeCampaignGroup(campaigns.map((campaign) => active.find((value) => value.id === campaign.id) ?? campaign));
      group.version += 1;
      if (!(await store.updateCampaignGroup(group, expectedGroupVersion)))
        throw new BusinessError("CONCURRENT_MODIFICATION", "多点活动已被其他操作更新", 409);

      for (const campaign of active) {
        const outcome = outcomeByCampaign.get(campaign.id)!;
        for (const order of ordersByCampaign.get(campaign.id) ?? []) {
          if (outcome === "LOCKED") {
            if (order.status === "PAID_WAITING_CLOSE")
              await store.transitionOrderStatus(order.id, ["PAID_WAITING_CLOSE"], "LOCKED");
            else if (order.status === "PENDING_PAYMENT") await this.cancelPending(store, order);
          } else if (outcome === "CANCELLED") {
            if (order.status === "PENDING_PAYMENT") await this.cancelPending(store, order);
            else if (order.status === "PAID_WAITING_CLOSE" && await this.markRefunding(store, order))
              await this.createRefundObligation(store, order.id);
          }
        }
        const after = await store.getCampaign(campaign.id);
        if (context && this.actionAuditHandler && after)
          await this.actionAuditHandler(store, context, "CLOSE", before.get(campaign.id)!, after);
      }
      return (await store.getCampaign(requestedCampaignId))!;
    });
    if (!triggeredByScheduler) await this.scheduler.cancelClose(requestedCampaignId).catch(() => undefined);
    return result;
  }
  public async cancel(
    id: string,
    context?: CampaignActionAuditContext,
  ): Promise<Campaign> {
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
      campaign.status = transitionCampaign(campaign.status, "CANCELLED");
      campaign.version += 1;
      if (!(await store.updateCampaign(campaign, expected)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "团期已被其他操作更新",
          409,
        );
      if (campaign.campaignGroupId) {
        const group = await store.getCampaignGroup(campaign.campaignGroupId);
        if (!group) throw new BusinessError("FINANCIAL_INCONSISTENT", "团期所属活动分组不存在", 409);
        const expectedGroupVersion = group.version;
        const members = await Promise.all(group.campaignIds.map((memberId) => store.getCampaign(memberId)));
        if (members.some((member) => !member || member.campaignGroupId !== group.id))
          throw new BusinessError("FINANCIAL_INCONSISTENT", "活动分组的点位团期映射异常", 409);
        group.status = summarizeCampaignGroup(members as Campaign[]);
        group.version += 1;
        if (!(await store.updateCampaignGroup(group, expectedGroupVersion)))
          throw new BusinessError("CONCURRENT_MODIFICATION", "多点活动已被其他操作更新", 409);
      }
      let orders = await store.listOrdersByCampaign(id);
      orders = await this.refreshCampaignOrdersAfterBatchLocks(store, orders);
      for (const order of orders) {
        if (order.status === "PENDING_PAYMENT")
          await this.cancelPending(store, order);
        else if (
          order.status === "PAID_WAITING_CLOSE" &&
          (await this.markRefunding(store, order))
        )
          await this.createRefundObligation(store, order.id);
      }
      const finalCampaign = await store.getCampaign(id);
      if (!finalCampaign)
        throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
      if (context && this.actionAuditHandler)
        await this.actionAuditHandler(
          store,
          context,
          "CANCEL",
          before,
          finalCampaign,
        );
      return finalCampaign;
    });
    await this.scheduler.cancelClose(id).catch(() => undefined);
    const groupId = result.campaignGroupId;
    if (groupId) {
      const group = await this.store.getCampaignGroup(groupId);
      const anchor = group
        ? (await Promise.all(group.campaignIds.map((memberId) => this.store.getCampaign(memberId))))
            .find((member) => member?.status === "OPEN")
        : null;
      if (anchor) await this.scheduler.scheduleClose(anchor.id, anchor.cutoffAt, anchor.version).catch(() => undefined);
    }
    return result;
  }
  public async cancelImpact(id: string): Promise<{
    pendingPaymentOrderCount: number;
    paidOrderCount: number;
    estimatedRefundCents: number;
  }> {
    const campaign = await this.get(id);
    if (!["DRAFT", "OPEN", "POSTPONED"].includes(campaign.status))
      throw new BusinessError("INVALID_STATE_TRANSITION", "当前活动不能取消", 409);
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
    const batchRef = await store.getCheckoutBatchByOrder(order.id);
    if (batchRef) {
      const batch = await store.getCheckoutBatchForUpdate(batchRef.id);
      if (!batch) throw new BusinessError("FINANCIAL_INCONSISTENT", "结算批次映射缺失", 409);
      if (batch.status === "PAID") return;
      const orders = await Promise.all(batch.orderIds.map((id) => store.getOrderForUpdate(id)));
      if (orders.some((value) => !value))
        throw new BusinessError("FINANCIAL_INCONSISTENT", "结算批次子订单缺失", 409);
      for (const child of orders as Order[]) {
        if (child.status === "PENDING_PAYMENT") await this.cancelSinglePending(store, child);
        else if (child.status !== "CANCELLED")
          throw new BusinessError("FINANCIAL_INCONSISTENT", "未付款结算批次包含非待付子订单", 409);
      }
      batch.status = "CANCELLED";
      await store.saveCheckoutBatch(batch);
      return;
    }
    await this.cancelSinglePending(store, order);
  }
  private async cancelSinglePending(store: CommerceStore, order: Order): Promise<void> {
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
  private async refreshCampaignOrdersAfterBatchLocks(store: CommerceStore, orders: Order[]): Promise<Order[]> {
    const batchIds = new Set<string>();
    for (const order of orders) {
      if (order.status !== "PENDING_PAYMENT") continue;
      const batch = await store.getCheckoutBatchByOrder(order.id);
      if (batch) batchIds.add(batch.id);
    }
    const refreshed = new Map(orders.map((order) => [order.id, order]));
    for (const batchId of [...batchIds].sort()) {
      const batch = await store.getCheckoutBatchForUpdate(batchId);
      if (!batch) throw new BusinessError("FINANCIAL_INCONSISTENT", "结算批次映射缺失", 409);
      const children = await Promise.all([...batch.orderIds].sort().map((id) => store.getOrderForUpdate(id)));
      if (children.some((order) => !order))
        throw new BusinessError("FINANCIAL_INCONSISTENT", "结算批次子订单缺失", 409);
      for (const child of children as Order[]) refreshed.set(child.id, child);
      const inconsistentPendingBatch = batch.status === "PENDING_PAYMENT"
        && (children as Order[]).some((child) => child.status === "CANCELLED");
      if (batch.status === "CANCELLED" || inconsistentPendingBatch) {
        for (const child of children as Order[])
          if (child.status === "PENDING_PAYMENT") await this.cancelSinglePending(store, child);
        if (inconsistentPendingBatch) {
          batch.status = "CANCELLED";
          await store.saveCheckoutBatch(batch);
        }
      }
    }
    return orders.map((order) => refreshed.get(order.id) ?? order);
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
