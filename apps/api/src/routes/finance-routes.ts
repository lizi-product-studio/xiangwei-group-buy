import type { FastifyInstance } from "fastify";
import { requireActor } from "../modules/auth/auth.js";
import type { CommerceStore } from "../modules/core/store.js";

/** Finance reads are isolated from order and fulfilment mutation routes. */
export function registerFinanceRoutes(
  app: FastifyInstance,
  store: CommerceStore,
): void {
  app.get("/api/v1/admin/finance/ledger", async (request) => {
    requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
    const query = request.query as { orderId?: string };
    return {
      data: (await store.listLedgerTransactions(query.orderId)).map(
        (transaction) => {
          const debitCents = transaction.lines
            .filter((line) => line.direction === "DEBIT")
            .reduce((total, line) => total + Number(line.amountCents), 0);
          const creditCents = transaction.lines
            .filter((line) => line.direction === "CREDIT")
            .reduce((total, line) => total + Number(line.amountCents), 0);
          return {
            ...transaction,
            debitCents,
            creditCents,
            isBalanced: debitCents === creditCents,
          };
        },
      ),
    };
  });
  app.get("/api/v1/admin/finance/refunds", async (request) => {
    requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
    return {
      data: {
        full: await store.listOrderRefunds(500),
        partial: await store.listPartialRefunds(500),
      },
    };
  });
}
