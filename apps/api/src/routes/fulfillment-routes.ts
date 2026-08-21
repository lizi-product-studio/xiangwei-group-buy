import type { FastifyInstance } from 'fastify';
import { createDispatchBatchSchema, identifierSchema, pickupOrderLookupQuerySchema, receiveBatchSchema, verifyPickupSchema } from '@hometown/api-contracts';
import { BusinessError } from '@hometown/domain';
import { requireActor } from '../modules/auth/auth.js';
import type { CommerceStore } from '../modules/core/store.js';
import type { FulfillmentService } from '../modules/fulfillment/fulfillment-service.js';

export function registerFulfillmentRoutes(app: FastifyInstance, dependencies: {
  store: CommerceStore;
  fulfillment: FulfillmentService;
  assertActivePickupPointAccess(actor:{userId:string;roles:readonly string[]}, pickupPointId:string):Promise<void>;
}): void {
  const { store, fulfillment, assertActivePickupPointAccess } = dependencies;
  app.post('/api/v1/admin/dispatch-batches', async (request, reply) => { requireActor(request,['FULFILLMENT','OPERATOR','SUPER_ADMIN']); const input=createDispatchBatchSchema.parse(request.body); return reply.status(201).send({data:await fulfillment.createBatch(input.campaignId)}); });
  app.get('/api/v1/admin/dispatch-batches', async (request) => { requireActor(request,['FULFILLMENT','OPERATOR','SUPER_ADMIN']); return {data:await store.listDispatchBatches()}; });
  app.post('/api/v1/admin/dispatch-batches/:id/dispatch', async (request) => { requireActor(request,['FULFILLMENT','OPERATOR','SUPER_ADMIN']); const id=identifierSchema.parse((request.params as{id:string}).id); return {data:await fulfillment.dispatch(id)}; });
  app.post('/api/v1/pickup/batches/:id/receive', async (request) => { requireActor(request,['FULFILLMENT','OPERATOR','SUPER_ADMIN']); const id=identifierSchema.parse((request.params as{id:string}).id); const batch=await store.getDispatchBatch(id); if(!batch)throw new BusinessError('RESOURCE_NOT_FOUND','发车批次不存在',404); const campaign=await store.getCampaign(batch.campaignId); if(!campaign)throw new BusinessError('RESOURCE_NOT_FOUND','团期不存在',404); if(campaign.businessModelVersion==='PLATFORM_COMMUNITY')throw new BusinessError('INVALID_STATE_TRANSITION','社区团购必须使用点位逐商品到货确认入口',409); const input=receiveBatchSchema.parse(request.body); return {data:await fulfillment.receive(id,input.deliveryPlanId)}; });
  app.get('/api/v1/pickup-code', async (request) => { const actor=requireActor(request,['USER','SUPER_ADMIN']); const query=request.query as{orderId?:string}; return {data:await fulfillment.getCode(identifierSchema.parse(query.orderId),actor.userId)}; });
  app.get('/api/v1/pickup/orders/lookup', async (request) => {
    const actor=requireActor(request,['PICKUP_MANAGER','PICKUP_VERIFIER','FULFILLMENT','SUPER_ADMIN']); const query=pickupOrderLookupQuerySchema.parse(request.query); const plan=await store.getDeliveryPlan(query.deliveryPlanId);
    if(!plan||!plan.pickupPointId||plan.status!=='ARRIVED')throw new BusinessError('RESOURCE_NOT_FOUND','配送计划不存在或当前不可核销',404);
    const pickupPoint=(await store.listPickupPoints(plan.serviceAreaId)).find((item)=>item.id===plan.pickupPointId);
    if(!pickupPoint||pickupPoint.status!=='ACTIVE')throw new BusinessError('FORBIDDEN','当前自提点未启用，不能核销',403);
    await assertActivePickupPointAccess(actor,plan.pickupPointId); const order=await store.getOrderByNo(query.orderNo);
    if(!order||order.deliveryPlanId!==plan.id||order.pickupPointId!==plan.pickupPointId)throw new BusinessError('RESOURCE_NOT_FOUND','未找到本领取点的订单',404);
    return {data:{id:order.id,orderNo:order.orderNo,deliveryPlanId:order.deliveryPlanId,status:order.status,items:order.items.map((item)=>({skuId:item.skuId,name:item.name,quantity:item.quantity,readyQuantity:item.fulfilledQuantity,alreadyPickedQuantity:item.pickedUpQuantity,remainingPickupQuantity:Math.max(0,item.fulfilledQuantity-item.pickedUpQuantity),exceptionQuantity:item.exceptionQuantity}))}};
  });
  app.post('/api/v1/pickup/verify', async (request) => { const actor=requireActor(request,['PICKUP_MANAGER','PICKUP_VERIFIER','FULFILLMENT','SUPER_ADMIN']); const input=verifyPickupSchema.parse(request.body); return {data:await fulfillment.verify({orderId:input.orderId,deliveryPlanId:input.deliveryPlanId,code:input.code,verifierId:actor.userId,bypassPointAuthorization:actor.roles.includes('SUPER_ADMIN'),...(input.items?{requestedItems:input.items}:{}),...(input.pickupRequestId?{pickupRequestId:input.pickupRequestId}:{})})}; });
}
