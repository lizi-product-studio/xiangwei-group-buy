import type { FastifyInstance, FastifyRequest } from 'fastify';
import { cancelOrderSchema, identifierSchema, orderRequestSchema } from '@hometown/api-contracts';
import { BusinessError } from '@hometown/domain';
import { requireActor } from '../modules/auth/auth.js';
import type { CommerceStore } from '../modules/core/store.js';
import type { Order } from '../modules/core/types.js';
import type { CommunityOperationsService } from '../modules/fulfillment/community-operations-service.js';
import { buildOrderDeliveryViews } from '../modules/orders/order-read-model.js';
import type { OrderService } from '../modules/orders/order-service.js';
import type { PaymentService } from '../modules/payments/payment-service.js';

type Audit = (request: FastifyRequest, actorId: string, action: string, resourceType: string, resourceId: string, beforeData: unknown, afterData: unknown) => Promise<void>;

export function registerOrderRoutes(app: FastifyInstance, dependencies: {
  store: CommerceStore;
  orders: OrderService;
  payments: PaymentService;
  communityOperations: CommunityOperationsService;
  audit: Audit;
  rejectCommunityExternalEvidence(request: FastifyRequest, actorId: string, resourceType: string, resourceId: string, body: unknown): Promise<void>;
}): void {
  const { store, orders, payments, communityOperations, audit, rejectCommunityExternalEvidence } = dependencies;
  const views = (values: Order[]) => buildOrderDeliveryViews(store, values);

  app.post('/api/v1/orders/preview', async (request) => {
    const actor = requireActor(request, ['USER', 'SUPER_ADMIN']);
    return { data: await orders.preview(actor.userId, orderRequestSchema.parse(request.body)) };
  });

  app.post('/api/v1/orders', async (request, reply) => {
    const actor = requireActor(request, ['USER', 'SUPER_ADMIN']);
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new BusinessError('VALIDATION_ERROR', 'Idempotency-Key 长度必须为 8 到 128 个字符');
    }
    const order = await orders.create(actor.userId, orderRequestSchema.parse(request.body), key);
    return reply.status(201).send({ data: order });
  });

  app.get('/api/v1/orders', async (request) => {
    const actor = requireActor(request, ['USER', 'SUPER_ADMIN']);
    return { data: await views(await store.listOrdersByUser(actor.userId)) };
  });

  app.get('/api/v1/orders/:id', async (request) => {
    const actor = requireActor(request, ['USER', 'SUPER_ADMIN']);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const order = await orders.getForUser(id, actor.userId);
    return { data: (await views([order]))[0]! };
  });

  app.post('/api/v1/orders/:id/cancel', async (request) => {
    const actor = requireActor(request, ['USER', 'SUPER_ADMIN']);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const before = await orders.getForUser(id, actor.userId);
    if (before.businessModelVersion === 'PLATFORM_COMMUNITY') {
      await rejectCommunityExternalEvidence(request, actor.userId, 'ORDER', id, request.body);
      const input = cancelOrderSchema.parse(request.body ?? {});
      return { data: await communityOperations.requestCancellation(id, actor.userId, input.reason ?? '用户申请取消', request.id) };
    }
    const after = await orders.cancelPending(id, actor.userId);
    if (before.status !== after.status) await audit(request, actor.userId, 'ORDER_CANCELLED_BY_USER', 'ORDER', id, before, after);
    return { data: (await views([after]))[0]! };
  });

  app.get('/api/v1/admin/orders', async (request) => {
    requireActor(request, ['OPERATOR', 'FULFILLMENT', 'FINANCE', 'CUSTOMER_SERVICE', 'SUPER_ADMIN']);
    const query = request.query as { orderNo?: string };
    const matched = query.orderNo ? await store.getOrderByNo(query.orderNo.trim()) : null;
    const orders = query.orderNo ? (matched ? [matched] : []) : await store.listOrders(100);
    return { data: await views(orders) };
  });

  app.post('/api/v1/admin/orders/:id/refund', async (request) => {
    const actor = requireActor(request, ['FINANCE', 'SUPER_ADMIN']);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const before = await store.getOrder(id);
    if (before?.businessModelVersion !== 'LEGACY_MARKETPLACE') {
      throw new BusinessError('PARTIAL_REFUND_NOT_SUPPORTED', '模式 B 订单只能从运营确认的履约异常执行退款', 409);
    }
    if ((await store.listSettlements(id)).length) {
      throw new BusinessError('SETTLEMENT_EXISTS', '订单已生成结算单，不能自动退款，请转人工财务处理', 409);
    }
    await payments.requestFullRefund(id);
    const after = await store.getOrder(id);
    await audit(request, actor.userId, 'ORDER_FULL_REFUND_REQUESTED', 'ORDER', id, before, after);
    return { data: after };
  });
}
