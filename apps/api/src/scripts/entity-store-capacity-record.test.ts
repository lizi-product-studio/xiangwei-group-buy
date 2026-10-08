import { describe, expect, it } from "vitest";
import { toEntityRecord } from "../modules/core/entity-store-records.js";
import { assertCapacityEnrichmentGraph } from "./entity-store-capacity-record.js";

describe("capacity fixture records", () => {
  it("keeps callback event keys independent from a repeated body hash", () => {
    const first = toEntityRecord("callbacks", "capacity-callback-event-1", "same-callback-body-hash");
    const second = toEntityRecord("callbacks", "capacity-callback-event-2", "same-callback-body-hash");
    expect(first.entityKey).toBe("capacity-callback-event-1");
    expect(second.entityKey).toBe("capacity-callback-event-2");
  });

  it("keys order lines by parent order and line id", () => {
    const line = { id: "line-1", orderId: "order-1", catalogSkuId: "sku-1", amountCents: 1000 };
    expect(toEntityRecord("lines", "order-1", line).entityKey).toBe("order-1:line-1");
  });

  it("accepts a reconciled enrichment graph and rejects changed financial facts", () => {
    const partialLineA = { id: "capacity-enrich-partial-line-a", orderId: "capacity-enrich-partial-order", catalogSkuId: "capacity-enrich-sku-1000", productId: "capacity-enrich-product-1000", amountCents: 1000, unitPriceCents: 1000 };
    const partialLineB = { id: "capacity-enrich-partial-line-b", orderId: "capacity-enrich-partial-order", catalogSkuId: "capacity-enrich-sku", productId: "capacity-enrich-product", amountCents: 500, unitPriceCents: 500 };
    const fullLine = { id: "capacity-enrich-full-line", orderId: "capacity-enrich-full-order", catalogSkuId: "capacity-enrich-sku-1000", productId: "capacity-enrich-product-1000", amountCents: 1000, unitPriceCents: 1000 };
    const lineItem = (line: typeof partialLineA | typeof partialLineB | typeof fullLine) => ({ orderLineId: line.id, skuId: line.catalogSkuId, amountCents: line.amountCents });
    const records = [
      toEntityRecord("lines", partialLineA.orderId, partialLineA), toEntityRecord("lines", partialLineB.orderId, partialLineB),
      toEntityRecord("lines", fullLine.orderId, fullLine),
      toEntityRecord("orders", "capacity-enrich-partial-order", { id: "capacity-enrich-partial-order", totalCents: 1500, items: [lineItem(partialLineA), lineItem(partialLineB)] }),
      toEntityRecord("orders", "capacity-enrich-full-order", { id: "capacity-enrich-full-order", totalCents: 1000, items: [lineItem(fullLine)] }),
      toEntityRecord("payments", "capacity-enrich-payment-partial", { orderId: "capacity-enrich-partial-order", checkoutBatchId: "capacity-enrich-checkout-partial", amountCents: 1500 }),
      toEntityRecord("payments", "capacity-enrich-payment-full", { orderId: "capacity-enrich-full-order", checkoutBatchId: "capacity-enrich-checkout-full", amountCents: 1000 }),
      toEntityRecord("checkoutBatches", "capacity-enrich-checkout-partial", { userId: "capacity-user-1", totalCents: 1500, orderIds: ["capacity-enrich-partial-order"] }),
      toEntityRecord("checkoutBatches", "capacity-enrich-checkout-full", { userId: "capacity-user-1", totalCents: 1000, orderIds: ["capacity-enrich-full-order"] }),
      toEntityRecord("paymentBatches", "capacity-enrich-payment-batch-partial", { checkoutBatchId: "capacity-enrich-checkout-partial", amountCents: 1500 }),
      toEntityRecord("paymentBatches", "capacity-enrich-payment-batch-full", { checkoutBatchId: "capacity-enrich-checkout-full", amountCents: 1000 }),
      toEntityRecord("partialRefunds", "capacity-enrich-partial-refund", { id: "capacity-enrich-partial-refund", exceptionId: "capacity-enrich-exception", orderId: "capacity-enrich-partial-order", paymentId: "capacity-enrich-payment-partial", amountCents: 500 }),
      toEntityRecord("orderRefunds", "capacity-enrich-full-refund", { id: "capacity-enrich-full-refund", orderId: "capacity-enrich-full-order", paymentId: "capacity-enrich-payment-full", amountCents: 1000 }),
      toEntityRecord("campaigns", "capacity-enrich-campaign", { items: [
        { catalogSkuId: "capacity-enrich-sku", retailPriceCents: 500 },
        { catalogSkuId: "capacity-enrich-sku-1000", productId: "capacity-enrich-product-1000", retailPriceCents: 1000 },
      ] }),
      toEntityRecord("catalog", "capacity-enrich-sku", { retailPriceCents: 500 }),
      toEntityRecord("catalog", "capacity-enrich-sku-1000", { retailPriceCents: 1000, productId: "capacity-enrich-product-1000" }),
      toEntityRecord("exceptions", "capacity-enrich-exception", { orderId: "capacity-enrich-partial-order", campaignId: "capacity-enrich-campaign" }),
      toEntityRecord("allocations", "capacity-enrich-allocation", { exceptionId: "capacity-enrich-exception", orderId: "capacity-enrich-partial-order", orderLineId: partialLineB.id, catalogSkuId: "capacity-enrich-sku", refundedQuantity: 1 }),
      toEntityRecord("notifications", "capacity-enrich-retry-notice", { orderId: "capacity-enrich-partial-order", status: "PENDING_DELIVERY", lastDeliveryError: "retry", nextAttemptAt: "2026-01-01T00:00:00.000Z" }),
      toEntityRecord("notifications", "capacity-enrich-manual-notice", { orderId: "capacity-enrich-full-order", status: "MANUAL_REQUIRED" }),
      toEntityRecord("callbacks", "capacity-enrich-callback-partial", "synthetic-partial-callback-body-hash"),
      toEntityRecord("callbacks", "capacity-enrich-callback-full", "synthetic-full-callback-body-hash"),
      ...[
        ["capacity-enrich-payment-ledger-partial", "PAYMENT_SUCCEEDED", "ORDER", "capacity-enrich-partial-order", 1500, "PAYMENT_CLEARING", "CUSTOMER_CONTRACT_LIABILITY"],
        ["capacity-enrich-refund-ledger-partial", "PARTIAL_REFUND_SUCCEEDED", "FULFILLMENT_EXCEPTION", "capacity-enrich-partial-refund", 500, "CUSTOMER_CONTRACT_LIABILITY", "PAYMENT_CLEARING"],
        ["capacity-enrich-payment-ledger-full", "PAYMENT_SUCCEEDED", "ORDER", "capacity-enrich-full-order", 1000, "PAYMENT_CLEARING", "CUSTOMER_CONTRACT_LIABILITY"],
        ["capacity-enrich-refund-ledger-full", "REFUND_SUCCEEDED", "ORDER", "capacity-enrich-full-order", 1000, "CUSTOMER_CONTRACT_LIABILITY", "PAYMENT_CLEARING"],
      ].map(([id, eventType, referenceType, referenceId, amount, debitAccount, creditAccount]) => toEntityRecord("ledger", String(id), {
        eventType, referenceType, referenceId,
        lines: [
          { accountCode: debitAccount, ownerId: null, direction: "DEBIT", amountCents: Number(amount) },
          { accountCode: creditAccount, ownerId: null, direction: "CREDIT", amountCents: Number(amount) },
        ],
      })),
    ];

    expect(() => assertCapacityEnrichmentGraph(records)).not.toThrow();
    const corrupted = records.map((record) => record.collection === "payments" && record.entityKey === "capacity-enrich-payment-partial"
      ? toEntityRecord("payments", record.entityKey, { ...(record.document as object), amountCents: 1499 })
      : record);
    expect(() => assertCapacityEnrichmentGraph(corrupted)).toThrow(/payment does not reconcile/);
  });
});
