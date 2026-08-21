import { describe, expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import { MemoryStore } from "../core/store.js";
import type { Campaign, DeliveryPlan, Order } from "../core/types.js";
import { CommunityFulfillmentService } from "./community-fulfillment-service.js";

const arrivedAt = "2026-08-21T08:00:00.000Z";
describe("arrival discrepancy allocation", () => {
  it("allocates received quantity by paidAt then orderNo and waits for operator confirmation", async () => {
    const store = new MemoryStore(false);
    const campaign: Campaign = {
      id: "campaign",
      title: "社区团",
      serviceAreaId: "area",
      cutoffAt: "2026-08-20T00:00:00.000Z",
      dispatchAt: arrivedAt,
      minTotalQuantity: 1,
      failureAction: "CANCEL_AND_REFUND",
      items: [
        {
          catalogSkuId: "sku",
          productId: "product",
          title: "商品",
          category: "食品",
          skuName: "一份",
          origin: "本地",
          imageUrl: null,
          retailPriceCents: moneyCents(1000),
          sellableQuantity: 10,
          reservedQuantity: 4,
        },
      ],
      status: "FULFILLING",
      version: 1,
      createdAt: arrivedAt,
    };
    const plan: DeliveryPlan = {
      id: "plan",
      campaignId: "campaign",
      serviceAreaId: "area",
      pickupPointId: "point",
      status: "IN_TRANSIT",
      siteName: "社区点",
      address: "社区地址",
      arrivalStartAt: null,
      arrivalEndAt: null,
      contactName: null,
      contactPhone: null,
      vehicleOrderNo: "V-1",
      driverName: null,
      driverPhone: null,
      vehiclePlate: null,
      logisticsPlatform: "人工约车",
      estimatedArrivalAt: null,
      remark: null,
      confirmedAt: arrivedAt,
      bookedAt: arrivedAt,
      dispatchedAt: arrivedAt,
      arrivedAt: null,
      createdAt: arrivedAt,
      updatedAt: arrivedAt,
    };
    await store.saveCampaign(campaign);
    await store.saveDeliveryPlan(plan);
    await store.saveDispatchBatch({
      id: "batch",
      campaignId: "campaign",
      serviceAreaId: "area",
      status: "IN_TRANSIT",
      createdAt: arrivedAt,
      dispatchedAt: arrivedAt,
      arrivedAt: null,
    });
    const saveOrder = async (id: string, orderNo: string, paidAt: string) => {
      const value: Order = {
        id,
        orderNo,
        userId: id,
        campaignId: "campaign",
        serviceAreaId: "area",
        pickupPointId: "point",
        deliveryPlanId: "plan",
        status: "IN_TRANSIT",
        totalCents: moneyCents(2000),
        items: [],
        createdAt: paidAt,
        expiresAt: paidAt,
        paidAt,
        pickedUpAt: null,
      };
      await store.saveOrder(value);
      await store.saveOrderLines(id, [
        {
          id: `line-${id}`,
          catalogSkuId: "sku",
          productId: "product",
          title: "商品",
          skuName: "一份",
          quantity: 2,
          unitPriceCents: 1000,
          amountCents: 2000,
        },
      ]);
    };
    await saveOrder("later", "ORDER-2", "2026-08-20T02:00:00.000Z");
    await saveOrder("earlier", "ORDER-1", "2026-08-20T01:00:00.000Z");
    const service = new CommunityFulfillmentService(
      store,
      "pickup-secret-at-least-16",
    );
    const confirmation = await service.confirmArrival(
      "batch",
      "manager",
      {
        receivedBy: "负责人",
        confirmationNote: null,
        emergencyReason: null,
        items: [
          {
            catalogSkuId: "sku",
            receivedQuantity: 3,
            rejectedQuantity: 0,
            shortQuantity: 1,
            damagedQuantity: 0,
            reason: "SHORT_RECEIPT",
            evidenceNote: "现场清点短少一件",
          },
        ],
      },
      "arrival-request",
    );
    const draft = await store.getCommunityAllocationDraftByDeliveryForUpdate(
      confirmation.id,
    );
    expect(
      draft?.items.map((v) => [
        v.orderNo,
        v.fulfilledQuantity,
        v.exceptionQuantity,
      ]),
    ).toEqual([
      ["ORDER-1", 2, 0],
      ["ORDER-2", 1, 1],
    ]);
    expect(
      (await store.listOrderLinesByCampaign("campaign")).every(
        (v) => v.fulfilledQuantity === 0,
      ),
    ).toBe(true);
    await service.confirmAllocationDraft(
      confirmation.id,
      "operator",
      "confirm-request",
    );
    expect(
      (await store.listFulfillmentAllocations(draft!.exceptionId))[0],
    ).toMatchObject({ orderId: "later", exceptionQuantity: 1 });
    expect(
      (await store.getFulfillmentException(draft!.exceptionId))?.status,
    ).toBe("REFUND_CONFIRMED");
  });
});
