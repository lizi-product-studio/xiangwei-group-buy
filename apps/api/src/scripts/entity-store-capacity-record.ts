import type { EntityRecord } from "../modules/core/entity-store-records.js";

const keys = {
  campaign: "capacity-enrich-campaign",
  partialOrder: "capacity-enrich-partial-order",
  fullOrder: "capacity-enrich-full-order",
  partialLineA: "capacity-enrich-partial-line-a",
  partialLineB: "capacity-enrich-partial-line-b",
  fullLine: "capacity-enrich-full-line",
  partialCheckout: "capacity-enrich-checkout-partial",
  fullCheckout: "capacity-enrich-checkout-full",
  partialPayment: "capacity-enrich-payment-partial",
  fullPayment: "capacity-enrich-payment-full",
  partialRefund: "capacity-enrich-partial-refund",
  fullRefund: "capacity-enrich-full-refund",
  exception: "capacity-enrich-exception",
  allocation: "capacity-enrich-allocation",
  callbackPartial: "capacity-enrich-callback-partial",
  callbackFull: "capacity-enrich-callback-full",
  retryNotice: "capacity-enrich-retry-notice",
  manualNotice: "capacity-enrich-manual-notice",
  paymentLedgerPartial: "capacity-enrich-payment-ledger-partial",
  partialRefundLedger: "capacity-enrich-refund-ledger-partial",
  paymentLedgerFull: "capacity-enrich-payment-ledger-full",
  fullRefundLedger: "capacity-enrich-refund-ledger-full",
  skuA: "capacity-sku-entity",
  skuB: "capacity-enrich-sku",
  skuC: "capacity-enrich-sku-1000",
  skuCProduct: "capacity-enrich-product-1000",
  partialOrderNo: "CAP-ENRICH-PARTIAL",
  fullOrderNo: "CAP-ENRICH-FULL",
  user: "capacity-user-1",
  partialPaymentId: "capacity-enrich-payment-partial",
  fullPaymentId: "capacity-enrich-payment-full",
} as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function recordDocument(record: EntityRecord | undefined): Record<string, unknown> {
  assert(record, "Synthetic enrichment graph is missing a required record");
  return record.document as Record<string, unknown>;
}

/** Validate the synthetic multi-item payment/refund/fulfillment graph before SQL writes. */
export function assertCapacityEnrichmentGraph(records: EntityRecord[]): void {
  const index = new Map(records.map((record) => [`${record.collection}:${record.entityKey}`, record]));
  const get = (collection: EntityRecord["collection"], entityKey: string): EntityRecord | undefined => index.get(`${collection}:${entityKey}`);
  const partialA = recordDocument(get("lines", `${keys.partialOrder}:${keys.partialLineA}`));
  const partialB = recordDocument(get("lines", `${keys.partialOrder}:${keys.partialLineB}`));
  const fullLine = recordDocument(get("lines", `${keys.fullOrder}:${keys.fullLine}`));
  const lineMap = new Map([[keys.partialLineA, partialA], [keys.partialLineB, partialB], [keys.fullLine, fullLine]]);
  const partialRefund = recordDocument(get("partialRefunds", keys.partialRefund));
  const fullRefund = recordDocument(get("orderRefunds", keys.fullRefund));
  const expectedOrders = [
    { id: keys.partialOrder, checkoutId: keys.partialCheckout, paymentId: keys.partialPayment, gross: 1500, refunded: 500, lines: [partialA, partialB] },
    { id: keys.fullOrder, checkoutId: keys.fullCheckout, paymentId: keys.fullPayment, gross: 1000, refunded: 1000, lines: [fullLine] },
  ];
  for (const expected of expectedOrders) {
    const order = recordDocument(get("orders", expected.id));
    const lines = expected.lines;
    const lineTotal = lines.reduce((sum, line) => sum + Number(line.amountCents), 0);
    const items = Array.isArray(order.items) ? order.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
    assert(Number(order.totalCents) === expected.gross && lineTotal === expected.gross && items.length === lines.length,
      `Synthetic order/line gross total mismatch for ${expected.id}`);
    for (const line of lines) assert(items.some((item) => item.orderLineId === line.id && item.skuId === line.catalogSkuId && Number(item.amountCents) === Number(line.amountCents)),
      `Synthetic order item does not match line ${String(line.id)}`);
    const payment = recordDocument(get("payments", expected.paymentId));
    const checkout = recordDocument(get("checkoutBatches", expected.checkoutId));
    const paymentBatchKey = `capacity-enrich-payment-batch-${expected.id === keys.partialOrder ? "partial" : "full"}`;
    const paymentBatch = recordDocument(get("paymentBatches", paymentBatchKey));
    assert(payment.orderId === expected.id && payment.checkoutBatchId === expected.checkoutId && Number(payment.amountCents) === expected.gross,
      `Synthetic payment does not reconcile with ${expected.id}`);
    assert(checkout.userId === keys.user && Number(checkout.totalCents) === expected.gross && Array.isArray(checkout.orderIds) && checkout.orderIds.includes(expected.id),
      `Synthetic checkout batch does not reconcile with ${expected.id}`);
    assert(paymentBatch.checkoutBatchId === expected.checkoutId && Number(paymentBatch.amountCents) === expected.gross,
      `Synthetic provider payment batch does not reconcile with ${expected.id}`);
    const refund = expected.id === keys.partialOrder ? partialRefund : fullRefund;
    assert(refund.orderId === expected.id && refund.paymentId === expected.paymentId && Number(refund.amountCents) === expected.refunded,
      `Synthetic refund does not reconcile with ${expected.id}`);
    const refundRows = records.filter((record) => (record.collection === "partialRefunds" || record.collection === "orderRefunds") && record.lookupA === expected.id);
    assert(refundRows.reduce((sum, record) => sum + Number((record.document as Record<string, unknown>).amountCents), 0) === expected.refunded,
      `Synthetic refund total is inconsistent for ${expected.id}`);
  }
  const campaign = recordDocument(get("campaigns", keys.campaign));
  const campaignItems = Array.isArray(campaign.items) ? campaign.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
  assert(campaignItems.some((item) => item.catalogSkuId === keys.skuB && Number(item.retailPriceCents) === 500) &&
    campaignItems.some((item) => item.catalogSkuId === keys.skuC && item.productId === keys.skuCProduct && Number(item.retailPriceCents) === 1000),
    "Synthetic campaign does not include the 500- and 1000-cent line SKUs");
  const catalogB = recordDocument(get("catalog", keys.skuB));
  const catalogC = recordDocument(get("catalog", keys.skuC));
  assert(Number(catalogB.retailPriceCents) === 500 && Number(catalogC.retailPriceCents) === 1000 && catalogC.productId === keys.skuCProduct,
    "Synthetic catalog unit prices do not match the order lines");
  const exception = recordDocument(get("exceptions", keys.exception));
  const allocation = recordDocument(get("allocations", keys.allocation));
  assert(partialRefund.exceptionId === keys.exception && fullRefund.orderId === keys.fullOrder &&
    exception.orderId === keys.partialOrder && allocation.exceptionId === keys.exception && allocation.orderId === keys.partialOrder &&
    allocation.orderLineId === keys.partialLineB && allocation.catalogSkuId === keys.skuB && Number(allocation.refundedQuantity) === 1,
    "Synthetic exception, refund and allocation references do not reconcile");
  const retry = recordDocument(get("notifications", keys.retryNotice));
  const manual = recordDocument(get("notifications", keys.manualNotice));
  assert(retry.orderId === keys.partialOrder && retry.status === "PENDING_DELIVERY" && retry.lastDeliveryError && retry.nextAttemptAt &&
    manual.orderId === keys.fullOrder && manual.status === "MANUAL_REQUIRED",
    "Synthetic notification retry/manual states do not match their parent orders");
  assert(recordDocument(get("callbacks", keys.callbackPartial)).bodyHash === "synthetic-partial-callback-body-hash" &&
    recordDocument(get("callbacks", keys.callbackFull)).bodyHash === "synthetic-full-callback-body-hash",
    "Synthetic payment callback body hashes are missing");
  const ledgerExpectations = [
    { key: keys.paymentLedgerPartial, event: "PAYMENT_SUCCEEDED", referenceType: "ORDER", referenceId: keys.partialOrder, amount: 1500, debit: "PAYMENT_CLEARING", credit: "CUSTOMER_CONTRACT_LIABILITY" },
    { key: keys.partialRefundLedger, event: "PARTIAL_REFUND_SUCCEEDED", referenceType: "FULFILLMENT_EXCEPTION", referenceId: keys.partialRefund, amount: 500, debit: "CUSTOMER_CONTRACT_LIABILITY", credit: "PAYMENT_CLEARING" },
    { key: keys.paymentLedgerFull, event: "PAYMENT_SUCCEEDED", referenceType: "ORDER", referenceId: keys.fullOrder, amount: 1000, debit: "PAYMENT_CLEARING", credit: "CUSTOMER_CONTRACT_LIABILITY" },
    { key: keys.fullRefundLedger, event: "REFUND_SUCCEEDED", referenceType: "ORDER", referenceId: keys.fullOrder, amount: 1000, debit: "CUSTOMER_CONTRACT_LIABILITY", credit: "PAYMENT_CLEARING" },
  ];
  for (const expected of ledgerExpectations) {
    const ledger = recordDocument(get("ledger", expected.key));
    const lines = Array.isArray(ledger.lines) ? ledger.lines.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === "object")) : [];
    assert(ledger.referenceType === expected.referenceType && ledger.referenceId === expected.referenceId && ledger.eventType === expected.event && lines.length === 2 &&
      lines[0]?.accountCode === expected.debit && lines[0]?.ownerId === null && lines[0]?.direction === "DEBIT" && Number(lines[0]?.amountCents) === expected.amount &&
      lines[1]?.accountCode === expected.credit && lines[1]?.ownerId === null && lines[1]?.direction === "CREDIT" && Number(lines[1]?.amountCents) === expected.amount,
      `Synthetic ledger posting does not match LedgerService for ${expected.key}`);
  }
  assert(lineMap.size === 3, "Synthetic fixture must contain three distinct order-line records");
}
