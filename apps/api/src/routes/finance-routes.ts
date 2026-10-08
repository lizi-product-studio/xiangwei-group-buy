import type { FastifyInstance } from "fastify";
import { requireActor } from "../modules/auth/auth.js";
import type { CommerceStore } from "../modules/core/store.js";
import type { PaymentService } from "../modules/payments/payment-service.js";
import { BusinessError } from "@hometown/domain";

/** Finance reads are isolated from order and fulfilment mutation routes. */
export function registerFinanceRoutes(
  app: FastifyInstance,
  store: CommerceStore,
  payments: PaymentService,
): void {
  app.get("/api/v1/admin/finance/ledger", async (request) => {
    requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
    const query = request.query as { orderId?: string; referenceId?: string; cursor?: string; pageSize?: string };
    const referenceId = (query.referenceId ?? query.orderId)?.trim();
    const result = await store.listFinanceLedgerPage({
      ...(referenceId ? { referenceId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: Math.max(1, Math.min(100, Number(query.pageSize) || 25)),
    });
    return { data: { ...result, items: result.items.map((transaction) => {
      const debitCents = transaction.lines.filter((line) => line.direction === "DEBIT").reduce((total, line) => total + Number(line.amountCents), 0);
      const creditCents = transaction.lines.filter((line) => line.direction === "CREDIT").reduce((total, line) => total + Number(line.amountCents), 0);
      return { ...transaction, debitCents, creditCents, isBalanced: debitCents === creditCents };
    }) } };
  });
  app.get("/api/v1/admin/finance/refunds", async (request) => {
    requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
    const query = request.query as { status?: string; orderId?: string; reference?: string; cursor?: string; pageSize?: string };
    const status = query.status?.trim();
    const orderId = query.orderId?.trim();
    return { data: await store.listFinanceRefundPage({
      ...(status ? { status } : {}),
      ...(orderId ? { orderId } : {}),
      ...(query.reference?.trim() ? { reference: query.reference.trim() } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: Math.max(1, Math.min(100, Number(query.pageSize) || 25)),
    }) };
  });
  app.post("/api/v1/admin/finance/refunds/:type/:id/check", async (request) => {
    const actor = requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
    const { type, id } = request.params as { type: string; id: string };
    if (type !== "FULL" && type !== "PARTIAL") throw new BusinessError("VALIDATION_ERROR", "退款类型无效", 400);
    await payments.checkManualRefund(type, id, actor.userId, request.id);
    return { data: { status: "CHECKED" } };
  });
  app.post("/api/v1/admin/finance/refunds/:type/:id/retry", async (request) => {
    const actor = requireActor(request, ["FINANCE", "SUPER_ADMIN"]);
    const { type, id } = request.params as { type: string; id: string };
    if (type !== "FULL" && type !== "PARTIAL") throw new BusinessError("VALIDATION_ERROR", "退款类型无效", 400);
    await payments.retryManualRefund(type, id, actor.userId, request.id);
    return { data: { status: "RETRY_SUBMITTED" } };
  });
}
