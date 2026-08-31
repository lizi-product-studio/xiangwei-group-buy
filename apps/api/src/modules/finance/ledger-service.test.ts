import { describe, expect, it } from "vitest";
import { moneyCents } from "@hometown/domain";
import type {
  FulfillmentException,
  LedgerTransaction,
  PartialRefund,
} from "../core/types.js";
import { LedgerService, type LedgerPostingStore } from "./ledger-service.js";

class LedgerStore implements LedgerPostingStore {
  public readonly values: LedgerTransaction[] = [];
  async appendLedgerTransaction(value: LedgerTransaction) {
    if (this.values.some((item) => item.id === value.id)) return false;
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
});
