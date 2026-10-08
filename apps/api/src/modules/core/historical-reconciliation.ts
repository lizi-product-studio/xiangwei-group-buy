/** Historical serialized documents only. No live import, comparison or review API.
 * Retained so normal upgrades and reverse exports do not discard existing data. */
/** Source amounts are gross transaction cents, not merchant settlement proceeds. */
export interface FinancialFact {
  key: string; // PAYMENT:<out_trade_no> or REFUND:<out_refund_no>
  kind: "PAYMENT" | "REFUND";
  merchantOrderNo: string;
  providerId: string | null;
  amountCents: number;
  status: "SUCCEEDED" | "PROCESSING" | "FAILED" | "UNKNOWN";
  occurredAt: string | null;
}
export interface BillEntry extends FinancialFact {
  merchantId: string;
  /** WeChat bill transaction day (refund acceptance day, not necessarily completion). */
  billOccurredAt: string;
  feeCents: number;
}
export interface ReconciliationBill {
  id: string;
  merchantId: string;
  billDate: string;
  sourceName: string;
  sourceHash: string;
  importedBy: string;
  importedAt: string;
  entries: BillEntry[];
}
export interface ReconciliationReview {
  id: string;
  billId: string;
  differenceKey: string;
  requestId: string;
  status: "INVESTIGATING" | "RECORDED";
  note: string;
  actorId: string;
  createdAt: string;
}
