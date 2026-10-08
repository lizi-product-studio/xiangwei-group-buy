import { describe, expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import type {
  CommunityPickupReceipt,
  FulfillmentException,
  LedgerTransaction,
  Order,
  PartialRefund,
} from "../core/types.js";
import { LedgerService, type LedgerPostingStore } from "./ledger-service.js";
import { toEntityRecord } from "../core/entity-store-records.js";

class LedgerStore implements LedgerPostingStore {
  public readonly values: LedgerTransaction[] = [];
  async appendLedgerTransaction(value: LedgerTransaction) {
    if (this.values.some((item) => item.id === value.id || (value.postingKey && item.postingKey === value.postingKey && item.referenceId === value.referenceId))) return false;
    this.values.push(value);
    return true;
  }
  async listLedgerTransactions(referenceId?: string) {
    return referenceId
      ? this.values.filter((item) => item.referenceId === referenceId)
      : [...this.values];
  }
}

function exception(
  stage: FulfillmentException["refundAccountingStage"],
): FulfillmentException {
  return {
    id: "exception",
    campaignId: "campaign",
    orderId: "order",
    clientRequestId: "request",
    deliveryPlanId: "plan",
    sourceStage: "CUSTOMER_CLAIM",
    refundAccountingStage: stage,
    status: "REFUND_CONFIRMED",
    responsibility: "PLATFORM",
    registeredBy: "actor",
    confirmedBy: "actor",
    resolutionNote: "reason",
    registeredAt: "2026-08-31T00:00:00.000Z",
    confirmedAt: "2026-08-31T00:00:00.000Z",
    items: [],
  };
}

function refund(): PartialRefund {
  return {
    id: "refund",
    exceptionId: "exception",
    orderId: "order",
    providerRefundNo: "provider-refund",
    amountCents: moneyCents(1200),
    status: "SUCCEEDED",
    claimedBy: null,
    claimToken: null,
    claimedUntil: null,
    nextAttemptAt: null,
    submitAttempts: 1,
    queryAttempts: 0,
    recoveryAttempts: 0,
    lastError: null,
    manualHoldReason: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

describe("LedgerService partial refund accounting", () => {
  it("posts each partial pickup receipt once and recognizes only its picked amount", async () => {
    const store = new LedgerStore();
    const order = { id: "order", totalCents: moneyCents(2900), items: [{ skuId: "sku-a", unitPriceCents: moneyCents(1000), pickedUpQuantity: 2 }, { skuId: "sku-b", unitPriceCents: moneyCents(300), pickedUpQuantity: 3 }] } as Order;
    const receipt = (id: string): CommunityPickupReceipt => ({ id, orderId: order.id, pickupRequestId: `req-${id}`, deliveryPlanId: "plan", verifierId: "staff", requestKey: `req-${id}`, payloadHash: null, createdAt: "2026-10-08T00:00:00.000Z", items: id === "r1" ? [{ id: `item-a-${id}`, communityPickupReceiptId: id, catalogSkuId: "sku-a", quantity: 1 }, { id: `item-b-${id}`, communityPickupReceiptId: id, catalogSkuId: "sku-b", quantity: 2 }] : [{ id: `item-a-${id}`, communityPickupReceiptId: id, catalogSkuId: "sku-a", quantity: 1 }, { id: `item-b-${id}`, communityPickupReceiptId: id, catalogSkuId: "sku-b", quantity: 1 }] });
    const ledger = new LedgerService();
    await ledger.recordPickup(store, order, receipt("r1"));
    await ledger.recordPickup(store, order, receipt("r1"));
    await ledger.recordPickup(store, order, receipt("r2"));
    expect(store.values).toHaveLength(2);
    expect(store.values.map(value => Number(value.lines[0]!.amountCents))).toEqual([1600, 1300]);
    expect(toEntityRecord("ledger", store.values[0]!.id, store.values[0]).uniqueKey).not.toBe(toEntityRecord("ledger", store.values[1]!.id, store.values[1]).uniqueKey);
  });

  it("does not append receipt revenue beside a legacy order-level pickup posting", async () => {
    const store = new LedgerStore();
    store.values.push({ id: "legacy", referenceType: "ORDER", referenceId: "order", eventType: "PICKUP_CONFIRMED", lines: [], createdAt: "2026-01-01T00:00:00.000Z" });
    const order = { id: "order", totalCents: moneyCents(2000), items: [{ skuId: "sku", unitPriceCents: moneyCents(1000), pickedUpQuantity: 2 }] } as Order;
    await new LedgerService().recordPickup(store, order, { id: "new-receipt", orderId: "order", deliveryPlanId: "plan", verifierId: "staff", requestKey: "request", pickupRequestId: "request", payloadHash: null, createdAt: new Date().toISOString(), items: [{ id: "item", communityPickupReceiptId: "new-receipt", catalogSkuId: "sku", quantity: 1 }] });
    expect(store.values).toHaveLength(1);
  });

  it("reverses contract liability for expired goods that were never picked up", async () => {
    const store = new LedgerStore();
    await new LedgerService().recordPartialRefund(
      store,
      exception("PRE_REVENUE"),
      refund(),
    );

    expect(store.values[0]?.lines).toEqual([
      expect.objectContaining({
        accountCode: "CUSTOMER_CONTRACT_LIABILITY",
        direction: "DEBIT",
        amountCents: moneyCents(1200),
      }),
      expect.objectContaining({
        accountCode: "PAYMENT_CLEARING",
        direction: "CREDIT",
        amountCents: moneyCents(1200),
      }),
    ]);
  });

  it("reverses recognised revenue for a post-pickup quality refund", async () => {
    const store = new LedgerStore();
    await new LedgerService().recordPartialRefund(
      store,
      exception("POST_REVENUE"),
      refund(),
    );

    expect(store.values[0]?.lines[0]).toEqual(
      expect.objectContaining({
        accountCode: "SALES_REVENUE",
        direction: "DEBIT",
        amountCents: moneyCents(1200),
      }),
    );
    const debit = store.values[0]!.lines
      .filter((line) => line.direction === "DEBIT")
      .reduce((sum, line) => sum + Number(line.amountCents), 0);
    const credit = store.values[0]!.lines
      .filter((line) => line.direction === "CREDIT")
      .reduce((sum, line) => sum + Number(line.amountCents), 0);
    expect(debit).toBe(credit);
  });

  it("does not infer recognized revenue from a legacy CUSTOMER_CLAIM without an accounting stage", async () => {
    const store = new LedgerStore();
    const legacyException = { ...exception("PRE_REVENUE"), refundAccountingStage: undefined } as unknown as FulfillmentException;
    await new LedgerService().recordPartialRefund(store, legacyException, refund());
    expect(store.values[0]?.lines[0]).toMatchObject({ accountCode: "CUSTOMER_CONTRACT_LIABILITY", direction: "DEBIT" });
  });
});
