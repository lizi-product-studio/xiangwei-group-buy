import { randomUUID } from "node:crypto";
import { BusinessError, moneyCents } from "@hometown/domain";
import type {
  FulfillmentException,
  LedgerLine,
  LedgerTransaction,
  Order,
  PartialRefund,
} from "../core/types.js";

export interface LedgerPostingStore {
  appendLedgerTransaction(value: LedgerTransaction): Promise<boolean>;
  listLedgerTransactions(referenceId?: string): Promise<LedgerTransaction[]>;
}
export class LedgerService {
  public async recordPayment(
    store: LedgerPostingStore,
    order: Order,
  ): Promise<void> {
    await this.append(store, order.id, "PAYMENT_SUCCEEDED", [
      {
        accountCode: "PAYMENT_CLEARING",
        ownerId: null,
        direction: "DEBIT",
        amountCents: order.totalCents,
      },
      {
        accountCode: "CUSTOMER_CONTRACT_LIABILITY",
        ownerId: null,
        direction: "CREDIT",
        amountCents: order.totalCents,
      },
    ]);
  }
  public async recordRefund(
    store: LedgerPostingStore,
    order: Order,
  ): Promise<void> {
    const pickedUp = (await store.listLedgerTransactions(order.id)).some(
      (item) => item.eventType === "PICKUP_CONFIRMED",
    );
    await this.append(store, order.id, "REFUND_SUCCEEDED", [
      {
        accountCode: pickedUp ? "SALES_REVENUE" : "CUSTOMER_CONTRACT_LIABILITY",
        ownerId: null,
        direction: "DEBIT",
        amountCents: order.totalCents,
      },
      {
        accountCode: "PAYMENT_CLEARING",
        ownerId: null,
        direction: "CREDIT",
        amountCents: order.totalCents,
      },
    ]);
  }
  public async recordPickup(
    store: LedgerPostingStore,
    order: Order,
  ): Promise<void> {
    const amount = moneyCents(
      order.items.reduce(
        (sum, item) =>
          sum + Number(item.unitPriceCents) * item.pickedUpQuantity,
        0,
      ),
    );
    if (Number(amount) > 0)
      await this.append(store, order.id, "PICKUP_CONFIRMED", [
        {
          accountCode: "CUSTOMER_CONTRACT_LIABILITY",
          ownerId: null,
          direction: "DEBIT",
          amountCents: amount,
        },
        {
          accountCode: "SALES_REVENUE",
          ownerId: null,
          direction: "CREDIT",
          amountCents: amount,
        },
      ]);
  }
  public async recordPartialRefund(
    store: LedgerPostingStore,
    exception: FulfillmentException,
    refund: PartialRefund,
  ): Promise<void> {
    const recognised = exception.sourceStage === "CUSTOMER_CLAIM";
    await this.append(
      store,
      refund.id,
      "PARTIAL_REFUND_SUCCEEDED",
      [
        {
          accountCode: recognised
            ? "SALES_REVENUE"
            : "CUSTOMER_CONTRACT_LIABILITY",
          ownerId: null,
          direction: "DEBIT",
          amountCents: refund.amountCents,
        },
        {
          accountCode: "PAYMENT_CLEARING",
          ownerId: null,
          direction: "CREDIT",
          amountCents: refund.amountCents,
        },
      ],
      "FULFILLMENT_EXCEPTION",
    );
  }
  private async append(
    store: LedgerPostingStore,
    referenceId: string,
    eventType: LedgerTransaction["eventType"],
    lines: LedgerLine[],
    referenceType: LedgerTransaction["referenceType"] = "ORDER",
  ): Promise<void> {
    const debit = lines
      .filter((line) => line.direction === "DEBIT")
      .reduce((sum, line) => sum + Number(line.amountCents), 0);
    const credit = lines
      .filter((line) => line.direction === "CREDIT")
      .reduce((sum, line) => sum + Number(line.amountCents), 0);
    if (!lines.length || debit !== credit)
      throw new BusinessError(
        "FINANCIAL_INCONSISTENT",
        "财务流水借贷不平衡",
        500,
        { debit, credit, eventType },
      );
    await store.appendLedgerTransaction({
      id: randomUUID(),
      referenceType,
      referenceId,
      eventType,
      lines,
      createdAt: new Date().toISOString(),
    });
  }
}
