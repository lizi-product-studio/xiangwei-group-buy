import { createHash, randomUUID } from "node:crypto";
import type { OrderRequest } from "@hometown/api-contracts";
import {
  BusinessError,
  moneyCents,
  multiplyMoney,
  sumMoney,
  transitionOrder,
} from "@hometown/domain";
import type { CampaignService } from "../campaigns/campaign-service.js";
import { isDeliveryPlanReadyForSale } from "../campaigns/sellability.js";
import type { CommerceStore } from "../core/store.js";
import type { Order, OrderItem } from "../core/types.js";

export class OrderService {
  public constructor(
    private readonly store: CommerceStore,
    private readonly campaigns: CampaignService,
  ) {}
  private fingerprint(input: OrderRequest): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  }
  public async preview(
    userId: string,
    input: OrderRequest,
    store: CommerceStore = this.store,
  ): Promise<
    Omit<
      Order,
      "id" | "orderNo" | "createdAt" | "expiresAt" | "paidAt" | "pickedUpAt"
    >
  > {
    const campaign = await store.getCampaignForUpdate(input.campaignId);
    if (!campaign)
      throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
    if (campaign.status !== "OPEN")
      throw new BusinessError("CAMPAIGN_NOT_OPEN", "团期当前不可下单", 409);
    if (Date.parse(campaign.cutoffAt) <= Date.now())
      throw new BusinessError("CAMPAIGN_CLOSED", "团期已截单", 409);
    if (campaign.serviceAreaId !== input.serviceAreaId)
      throw new BusinessError(
        "VALIDATION_ERROR",
        "所选区域不在本团服务范围内",
        400,
      );
    const area = (await store.listServiceAreas()).find(
      (item) =>
        item.id === campaign.serviceAreaId &&
        item.status === "ENABLED" &&
        item.orderEnabled,
    );
    const point = (await store.listPickupPoints(campaign.serviceAreaId)).find(
      (item) => item.id === input.pickupPointId && item.status === "ACTIVE",
    );
    const plan = await store.getDeliveryPlanByCampaign(campaign.id);
    if (
      !area ||
      !point ||
      !plan ||
      plan.pickupPointId !== point.id ||
      !isDeliveryPlanReadyForSale(plan)
    )
      throw new BusinessError(
        "VALIDATION_ERROR",
        "本团固定自提点当前不可用",
        409,
      );
    const merged = new Map<string, number>();
    for (const line of input.items)
      merged.set(line.skuId, (merged.get(line.skuId) ?? 0) + line.quantity);
    const items: OrderItem[] = [];
    for (const [skuId, quantity] of merged) {
      const item = await store.getCampaignItem(campaign.id, skuId);
      if (!item)
        throw new BusinessError(
          "RESOURCE_NOT_FOUND",
          `商品 ${skuId} 不属于当前团期`,
          404,
        );
      const available = item.sellableQuantity - item.reservedQuantity;
      if (available < quantity)
        throw new BusinessError(
          "SKU_STOCK_INSUFFICIENT",
          `${item.skuName} 可售数量不足`,
          409,
          { skuId, available },
        );
      const amountCents = multiplyMoney(item.retailPriceCents, quantity);
      items.push({
        orderLineId: null,
        skuId,
        productId: item.productId,
        name: item.skuName,
        quantity,
        unitPriceCents: item.retailPriceCents,
        amountCents,
        fulfilledQuantity: 0,
        pickedUpQuantity: 0,
        exceptionQuantity: 0,
        refundedQuantity: 0,
        refundedAmountCents: moneyCents(0),
      });
    }
    return {
      userId,
      campaignId: campaign.id,
      serviceAreaId: campaign.serviceAreaId,
      pickupPointId: point.id,
      deliveryPlanId: plan.id,
      status: "PENDING_PAYMENT",
      totalCents: sumMoney(items.map((item) => item.amountCents)),
      items,
    };
  }
  public async create(
    userId: string,
    input: OrderRequest,
    idempotencyKey: string,
  ): Promise<Order> {
    return this.store.transaction(async (store) => {
      const fingerprint = this.fingerprint(input);
      const existing = await store.getIdempotencyForUpdate(
        userId,
        idempotencyKey,
      );
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new BusinessError(
            "IDEMPOTENCY_CONFLICT",
            "同一幂等键不能用于不同订单内容",
            409,
          );
        return this.getForUser(existing.orderId, userId, store);
      }
      const preview = await this.preview(userId, input, store);
      for (const item of preview.items)
        if (
          !(await store.reserveCampaignInventory(
            input.campaignId,
            item.skuId,
            item.quantity,
          ))
        )
          throw new BusinessError(
            "SKU_STOCK_INSUFFICIENT",
            `${item.name} 库存不足`,
            409,
          );
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const campaign = await this.campaigns.get(input.campaignId, store);
      const order: Order = {
        id,
        orderNo: `HT${Date.now()}${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`,
        ...preview,
        createdAt,
        expiresAt: new Date(
          Math.min(Date.now() + 15 * 60_000, Date.parse(campaign.cutoffAt)),
        ).toISOString(),
        paidAt: null,
        pickedUpAt: null,
      };
      await store.saveOrder(order);
      await store.saveOrderLines(
        order.id,
        order.items.map((item) => ({
          id: randomUUID(),
          catalogSkuId: item.skuId,
          productId: item.productId,
          title: item.name,
          skuName: item.name,
          quantity: item.quantity,
          unitPriceCents: Number(item.unitPriceCents),
          amountCents: Number(item.amountCents),
        })),
      );
      await store.saveIdempotency(userId, idempotencyKey, {
        fingerprint,
        orderId: id,
      });
      return (await store.getOrder(id))!;
    });
  }
  public async expirePendingOrders(limit = 100): Promise<number> {
    let expired = 0;
    for (const candidate of await this.store.listExpiredPendingOrders(
      new Date().toISOString(),
      limit,
    ))
      await this.store.transaction(async (store) => {
        const order = await store.getOrderForUpdate(candidate.id);
        if (
          !order ||
          order.status !== "PENDING_PAYMENT" ||
          Date.parse(order.expiresAt) > Date.now()
        )
          return;
        if (await this.cancelPendingOrder(store, order)) expired += 1;
      });
    return expired;
  }
  public async cancelPending(id: string, userId: string): Promise<Order> {
    return this.store.transaction(async (store) => {
      const order = await this.getForUser(id, userId, store);
      if (order.status === "CANCELLED") return order;
      if (order.status !== "PENDING_PAYMENT")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "仅待支付订单可以直接取消",
          409,
        );
      if (!(await this.cancelPendingOrder(store, order)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "订单状态已变化，请刷新后重试",
          409,
        );
      order.status = transitionOrder(order.status, "CANCELLED");
      return order;
    });
  }
  public async getForUser(
    id: string,
    userId: string,
    store: CommerceStore = this.store,
  ): Promise<Order> {
    const order = await store.getOrder(id);
    if (!order)
      throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
    if (order.userId !== userId)
      throw new BusinessError("FORBIDDEN", "无权查看该订单", 403);
    return order;
  }
  public async mockPay(id: string, userId: string): Promise<Order> {
    return this.store.transaction(async (store) => {
      const order = await this.getForUser(id, userId, store);
      if (order.status === "PAID_WAITING_CLOSE") return order;
      if (order.status !== "PENDING_PAYMENT")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "订单当前不可支付",
          409,
        );
      const paidAt = new Date().toISOString();
      if (!(await store.markPendingOrderPaid(order.id, paidAt)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "订单状态已变化",
          409,
        );
      order.status = transitionOrder(order.status, "PAID_WAITING_CLOSE");
      order.paidAt = paidAt;
      return order;
    });
  }
  private async cancelPendingOrder(
    store: CommerceStore,
    order: Order,
  ): Promise<boolean> {
    if (!(await store.cancelPendingOrder(order.id))) return false;
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
    const payment = await store.getPaymentByOrder(order.id);
    if (payment?.status === "CREATED") {
      payment.status = "FAILED";
      await store.savePayment(payment);
    }
    return true;
  }
}
