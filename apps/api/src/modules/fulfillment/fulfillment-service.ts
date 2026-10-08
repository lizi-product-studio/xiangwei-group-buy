import { matchesPickupCode, pickupCode } from './pickup-code.js';
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  BusinessError,
  transitionCampaign,
  transitionOrder,
} from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";
import type { DispatchBatch, Order } from "../core/types.js";
import type { LedgerService } from "../finance/ledger-service.js";
import type { NotificationService } from "../notifications/notification-service.js";
import { completeCampaignIfSettled } from "./campaign-completion.js";

export type VerifyPickupCommand = {
  orderId: string;
  deliveryPlanId: string;
  code: string;
  verifierId: string;
  bypassPointAuthorization?: boolean;
  requestedItems: Array<{ catalogSkuId: string; quantity: number }>;
  pickupRequestId: string;
};

export class FulfillmentService {
  public constructor(
    private readonly store: CommerceStore,
    private readonly secret: string,
    private readonly ledger: LedgerService,
    private readonly notifications?: NotificationService,
  ) {}
  private code(orderId: string): string {
    return pickupCode(orderId, this.secret);
  }
  private hash(code: string): string {
    return createHmac("sha256", this.secret).update(code).digest("hex");
  }
  private async batch(
    id: string,
    store: CommerceStore = this.store,
  ): Promise<DispatchBatch> {
    const batch = await store.getDispatchBatch(id);
    if (!batch)
      throw new BusinessError("RESOURCE_NOT_FOUND", "发车批次不存在", 404);
    return batch;
  }
  public async createBatch(campaignId: string): Promise<DispatchBatch> {
    return this.store.transaction(async (store) => {
      const campaign = await store.getCampaignForUpdate(campaignId);
      if (!campaign)
        throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
      if (["CANCELLED", "COMPLETED"].includes(campaign.status))
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          campaign.status === "CANCELLED"
            ? "团期已取消，不能创建或复用发车批次"
            : "团期已完成，不能创建或复用发车批次",
          409,
        );
      const existing = (await store.listDispatchBatches()).find(
        (value) => value.campaignId === campaignId,
      );
      if (existing) return existing;
      if (campaign.status !== "LOCKED")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "只有已成团锁单的团期可以创建发车批次",
          409,
        );
      const plan = await store.getDeliveryPlanByCampaign(campaignId);
      if (!plan || plan.status !== "VEHICLE_BOOKED")
        throw new BusinessError(
          "DELIVERY_PLAN_NOT_READY",
          "请先登记运输信息",
          409,
        );
      const now = new Date().toISOString();
      const batch: DispatchBatch = {
        id: randomUUID(),
        campaignId,
        serviceAreaId: campaign.serviceAreaId,
        status: "DRAFT",
        createdAt: now,
        dispatchedAt: null,
        arrivedAt: null,
      };
      await store.saveDispatchBatch(batch);
      const expected = campaign.version;
      campaign.status = transitionCampaign(campaign.status, "FULFILLING");
      campaign.version += 1;
      if (!(await store.updateCampaign(campaign, expected)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "团期已被其他操作更新",
          409,
        );
      for (const order of await store.listOrdersByCampaign(campaignId))
        if (order.status === "LOCKED")
          await store.transitionOrderStatus(order.id, ["LOCKED"], "ALLOCATING");
      return batch;
    });
  }
  public async dispatch(id: string): Promise<DispatchBatch> {
    return this.store.transaction(async (store) => {
      const batch = await this.batch(id, store);
      const campaign = await store.getCampaignForUpdate(batch.campaignId);
      if (!campaign)
        throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
      if (["CANCELLED", "COMPLETED"].includes(campaign.status))
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          campaign.status === "CANCELLED"
            ? "团期已取消，不能发车"
            : "团期已完成，不能发车",
          409,
        );
      if (batch.status === "IN_TRANSIT") return batch;
      if (batch.status !== "DRAFT")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "批次当前不能发车",
          409,
        );
      const plan = await store.getDeliveryPlanByCampaign(batch.campaignId);
      if (!plan || plan.status !== "VEHICLE_BOOKED")
        throw new BusinessError(
          "DELIVERY_PLAN_NOT_READY",
          "运输信息尚未完成",
          409,
        );
      const now = new Date().toISOString();
      Object.assign(batch, {
        status: "IN_TRANSIT" as const,
        dispatchedAt: now,
      });
      await store.saveDispatchBatch(batch);
      Object.assign(plan, {
        status: "IN_TRANSIT" as const,
        dispatchedAt: now,
        updatedAt: now,
      });
      await store.saveDeliveryPlan(plan);
      for (const order of await store.listOrdersByCampaign(batch.campaignId))
        if (order.status === "ALLOCATING")
          await store.transitionOrderStatus(
            order.id,
            ["ALLOCATING"],
            "IN_TRANSIT",
          );
      if (this.notifications)
        await this.notifications.enqueueCampaign(
          store,
          "VEHICLE_DISPATCHED",
          batch.campaignId,
          plan,
          `dispatch:${batch.id}:${now}`,
        );
      return batch;
    });
  }
  public async getCode(
    orderId: string,
    userId: string,
  ): Promise<{ code: string; expiresAt: string }> {
    const order = await this.store.getOrder(orderId);
    if (!order)
      throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
    if (order.userId !== userId)
      throw new BusinessError("FORBIDDEN", "无权查看该订单取货码", 403);
    const credential = await this.store.getPickupCredential(orderId);
    if (!credential || credential.status !== "ACTIVE")
      throw new BusinessError(
        "PICKUP_CODE_UNAVAILABLE",
        "取货码尚未生成或已使用",
        409,
      );
    const expiresAt = Date.parse(credential.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      throw new BusinessError("PICKUP_CODE_EXPIRED", "取货码已过期", 409);
    return { code: this.code(orderId), expiresAt: credential.expiresAt };
  }
  /** Resolve a consumer code within one selected pickup point only. */
  public async lookupByPickupCode(
    pickupPointId: string,
    code: string,
    orderNo?: string,
  ): Promise<Order> {
    const codeHash = this.hash(code);
    const matches = await this.store.listPickupCodeCandidates(pickupPointId, codeHash, orderNo);
    // Keep constant-time verification at the service boundary even though the
    // indexed hash lookup already narrows the candidate set to a handful.
    const verified = matches.filter((candidate) => matchesPickupCode(code, candidate.codeHash, this.secret));
    if (verified.length > 1)
      throw new BusinessError(
        "PICKUP_CODE_AMBIGUOUS",
        "取货码匹配到多笔订单，请提供订单号查询",
        409,
      );
    if (!verified[0])
      throw new BusinessError(
        "RESOURCE_NOT_FOUND",
        "未找到有效取货码，请核对自提点和取货码，或请用户刷新取货码页面",
        404,
      );
    return verified[0]!.order;
  }
  public async verify(command: VerifyPickupCommand): Promise<Order> {
    return this.store.transaction(async (store) => {
      const {
        orderId,
        deliveryPlanId,
        code,
        verifierId,
        bypassPointAuthorization = false,
      } = command;
      const order = await store.getOrderForUpdate(orderId);
      if (!order)
        throw new BusinessError("RESOURCE_NOT_FOUND", "订单不存在", 404);
      const plan = await store.getDeliveryPlan(deliveryPlanId);
      if (
        !plan ||
        order.deliveryPlanId !== plan.id ||
        order.pickupPointId !== plan.pickupPointId
      )
        throw new BusinessError("FORBIDDEN", "订单不属于当前自提点", 403);
      const verifier = await store.getUser(verifierId);
      const staff = await store.getInternalStaff(verifierId);
      const point = (await store.listPickupPoints(plan.serviceAreaId)).find(
        (value) => value.id === plan.pickupPointId && value.status === "ACTIVE",
      );
      if (
        !verifier ||
        verifier.status !== "ACTIVE" ||
        !point ||
        (!bypassPointAuthorization &&
          (!staff ||
            staff.status !== "ACTIVE" ||
            staff.role !== "PICKUP_MANAGER" ||
            !(await store.hasActivePickupPointAssignment(
              verifierId,
              point.id,
            ))))
      )
        throw new BusinessError("FORBIDDEN", "当前负责人没有该自提点权限", 403);
      const requestId = command.pickupRequestId.toLowerCase();
      const merged = new Map<string, number>();
      for (const item of command.requestedItems) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 1)
          throw new BusinessError(
            "VALIDATION_ERROR",
            "提货数量必须是正整数",
            400,
          );
        merged.set(
          item.catalogSkuId,
          (merged.get(item.catalogSkuId) ?? 0) + item.quantity,
        );
      }
      if (!merged.size)
        throw new BusinessError(
          "VALIDATION_ERROR",
          "本次领取至少选择一项商品",
          400,
        );
      const items = [...merged.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([catalogSkuId, quantity]) => ({ catalogSkuId, quantity }));
      const payloadHash = createHmac("sha256", this.secret)
        .update(JSON.stringify({ orderId, deliveryPlanId, verifierId, items }))
        .digest("hex");
      const existing =
        await store.getCommunityPickupReceiptByRequestIdForUpdate(
          order.id,
          requestId,
        );
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new BusinessError(
            "IDEMPOTENCY_CONFLICT",
            "同一领取请求内容不一致",
            409,
          );
        return order;
      }
      const window = await store.getCommunityPickupWindowForUpdate(order.id);
      if (!window)
        throw new BusinessError(
          "PICKUP_CODE_UNAVAILABLE",
          "领取期限尚未开放",
          409,
        );
      if (
        ["ACTIVE", "EXTENDED"].includes(window.status) &&
        Date.parse(window.deadlineAt) <= Date.now()
      ) {
        window.status = "EXPIRED_PENDING";
        await store.saveCommunityPickupWindow(window);
        throw new BusinessError(
          "PICKUP_CODE_EXPIRED",
          "领取期限已过，请由运营处理",
          409,
        );
      }
      if (!["ACTIVE", "EXTENDED"].includes(window.status))
        throw new BusinessError("PICKUP_CODE_EXPIRED", "订单不能普通核销", 409);
      if (order.status !== "READY_FOR_PICKUP")
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "订单当前不可核销",
          409,
        );
      const credential = await store.getPickupCredential(order.id);
      if (
        !credential ||
        credential.status !== "ACTIVE" ||
        Date.parse(credential.expiresAt) <= Date.now()
      )
        throw new BusinessError(
          "PICKUP_CODE_EXPIRED",
          "取货码无效或已过期",
          409,
        );
      const expected = Buffer.from(credential.codeHash, "hex");
      const actual = Buffer.from(this.hash(code), "hex");
      if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      )
        throw new BusinessError("PICKUP_CODE_INVALID", "取货码不正确", 409);
      const lines = await store.listOrderLinesByOrderForUpdate(order.id);
      const bySku = new Map(lines.map((line) => [line.catalogSkuId, line]));
      for (const item of items) {
        const line = bySku.get(item.catalogSkuId);
        if (
          !line ||
          item.quantity > line.fulfilledQuantity - line.pickedUpQuantity
        )
          throw new BusinessError(
            "VALIDATION_ERROR",
            "领取数量超过待领取数量",
            400,
            { catalogSkuId: item.catalogSkuId },
          );
      }
      const receipt = {
        id: randomUUID(),
        orderId,
        deliveryPlanId,
        verifierId,
        requestKey: createHmac("sha256", this.secret)
          .update(requestId)
          .digest("hex"),
        pickupRequestId: requestId,
        payloadHash,
        createdAt: new Date().toISOString(),
        items: items.map((item) => ({
          id: randomUUID(),
          communityPickupReceiptId: "",
          ...item,
        })),
      };
      receipt.items.forEach(
        (item) => (item.communityPickupReceiptId = receipt.id),
      );
      if (!(await store.saveCommunityPickupReceipt(receipt)))
        throw new BusinessError(
          "CONCURRENT_MODIFICATION",
          "领取操作正在处理中",
          409,
        );
      for (const item of items) {
        const line = bySku.get(item.catalogSkuId)!;
        line.pickedUpQuantity += item.quantity;
        if (!(await store.updateOrderLine(line)))
          throw new BusinessError(
            "CONCURRENT_MODIFICATION",
            "订单商品已被并发领取",
            409,
          );
        const orderItem = order.items.find(
          (value) => value.orderLineId === line.id,
        );
        if (!orderItem)
          throw new BusinessError(
            "INVENTORY_INCONSISTENT",
            "订单明细缺失",
            500,
          );
        orderItem.pickedUpQuantity = line.pickedUpQuantity;
      }
      const complete = lines
        .filter((line) => line.fulfilledQuantity > 0)
        .every((line) => line.pickedUpQuantity === line.fulfilledQuantity);
      await store.saveAuditLog({
        id: randomUUID(),
        actorId: verifierId,
        action: complete ? "PICKUP_COMPLETED" : "PICKUP_PARTIAL",
        resourceType: "COMMUNITY_PICKUP_RECEIPT",
        resourceId: receipt.id,
        requestId,
        beforeData: null,
        afterData: { orderId, deliveryPlanId, pickupPointId: point.id, items },
        createdAt: receipt.createdAt,
      });
      order.pickedUpAt = receipt.createdAt;
      if (complete) {
        order.status = transitionOrder(order.status, "PICKED_UP");
        order.status = transitionOrder(order.status, "COMPLETED");
        credential.status = "USED";
        await store.savePickupCredential(credential);
        await store.savePickupRecord(order.id, deliveryPlanId, verifierId);
      }
      await store.saveOrderStatus(order);
      await this.ledger.recordPickup(store, order, receipt);
      await completeCampaignIfSettled(store, order.campaignId);
      return order;
    });
  }
}
