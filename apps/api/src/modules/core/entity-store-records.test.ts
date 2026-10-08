import { describe, expect, it } from "vitest";
import { canonicalEntityRecord, ENTITY_COLLECTIONS, toEntityRecord } from "./entity-store-records.js";

describe("Entity Store primary key projection", () => {
  it("preserves the MemoryStore collection key for every entity collection", () => {
    const sourceKey = "memory-map-primary-key";
    const document = {
      id: "document-id-must-not-win",
      userId: "document-user-id-must-not-win",
      orderId: "document-order-id-must-not-win",
      tokenHash: "document-token-hash-must-not-win",
      username: "document-username-must-not-win",
      eventKey: "document-event-key-must-not-win",
      requestId: "document-request-id-must-not-win",
    };

    for (const collection of ENTITY_COLLECTIONS) {
      const value = collection === "pickupRecords" || collection === "callbacks"
        ? sourceKey
        : collection === "lines"
          ? { ...document, id: "line-id" }
          : document;
      const record = toEntityRecord(collection, sourceKey, value);
      expect(record.entityKey, collection).toBe(collection === "lines" ? `${sourceKey}:line-id` : sourceKey);
    }
  });

  it.each([
    ["sessions", "sha256-session-token", { tokenHash: "sha256-session-token", userId: "user-id" }],
    ["passwordChangeTokens", "sha256-password-change-token", { tokenHash: "sha256-password-change-token", userId: "user-id" }],
    ["payments", "payment-id", { id: "payment-id", orderId: "order-id" }],
    ["orderRefunds", "refund-id", { id: "refund-id", orderId: "order-id" }],
    ["partialRefunds", "partial-refund-id", { id: "partial-refund-id", orderId: "order-id" }],
  ] as const)("keeps the source key for multi-field %s documents", (collection, sourceKey, document) => {
    expect(toEntityRecord(collection, sourceKey, document).entityKey).toBe(sourceKey);
  });

  it("keys line rows by parent order and line id", () => {
    const first = toEntityRecord("lines", "order-a", { id: "line-1", orderId: "order-a" });
    const second = toEntityRecord("lines", "order-b", { id: "line-1", orderId: "order-b" });
    expect(first.entityKey).toBe("order-a:line-1");
    expect(second.entityKey).toBe("order-b:line-1");
  });

  it("indexes completed payment and reconciliation timestamps for bounded reads", () => {
    const payment = toEntityRecord("payments", "payment-1", { id: "payment-1", succeededAt: "2026-09-27T16:00:00.000Z" });
    const bill = toEntityRecord("reconciliationBills", "bill-1", { id: "bill-1", merchantId: "merchant-1", billDate: "2026-09-27", sourceHash: "a".repeat(64), importedAt: "2026-09-28T00:00:00.000Z" });
    const review = toEntityRecord("reconciliationReviews", "bill-1:request-1", { billId: "bill-1", requestId: "request-1" });
    expect(payment.paidAt).toBe("2026-09-27 16:00:00.000");
    expect(bill).toMatchObject({ lookupA: "merchant-1", lookupB: "2026-09-27", createdAt: "2026-09-28 00:00:00.000", uniqueKey: `merchant-1:${"a".repeat(64)}` });
    expect(review).toMatchObject({ lookupA: "bill-1", lookupB: "request-1", uniqueKey: "bill-1:request-1" });
  });

  it("detects same-total payment ownership swaps by canonical record comparison", () => {
    const sourceA = toEntityRecord("payments", "payment-a", { id: "payment-a", orderId: "order-a", amountCents: 1500 });
    const sourceB = toEntityRecord("payments", "payment-b", { id: "payment-b", orderId: "order-b", amountCents: 1500 });
    const misattributedA = toEntityRecord("payments", "payment-a", { id: "payment-a", orderId: "order-b", amountCents: 1500 });
    const misattributedB = toEntityRecord("payments", "payment-b", { id: "payment-b", orderId: "order-a", amountCents: 1500 });

    expect([sourceA, sourceB].reduce((sum, record) => sum + Number((record.document as { amountCents: number }).amountCents), 0))
      .toBe([misattributedA, misattributedB].reduce((sum, record) => sum + Number((record.document as { amountCents: number }).amountCents), 0));
    expect(canonicalEntityRecord(sourceA)).not.toBe(canonicalEntityRecord(misattributedA));
    expect(canonicalEntityRecord(sourceB)).not.toBe(canonicalEntityRecord(misattributedB));
  });
});
