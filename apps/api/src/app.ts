import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { activateNetworkPresetSchema, adminLoginSchema, batchCreatePickupPointsSchema, bookVehicleSchema, createAfterSaleSchema, createCampaignSchema, createDeliveryPlanSchema, createDispatchBatchSchema, createMerchantSchema, createPickupPointSchema, createProductSchema, createServiceAreaInterestSchema, exceptionDecisionSchema, fulfillmentClaimSchema, goodsReceiptSchema, identifierSchema, networkPresetIdSchema, notificationPreferenceSchema, openServiceAreaSchema, orderRequestSchema, outboundSchema, partialRefundExecutionSchema, pickupHandoverSchema, pickupOrderLookupQuerySchema, pickupVerifierAssignmentQuerySchema, pickupVerifierAssignmentSchema, platformCampaignSchema, platformSkuSchema, postponeCampaignSchema, receiveBatchSchema, regionDirectoryQuerySchema, resolveAfterSaleRefundSchema, reviewDecisionSchema, supplierOfferSchema, supplierPayablePaymentSchema, supplierQualificationSchema, supplierSchema, transferReinspectionSchema, updateAfterSaleStatusSchema, updateCampaignSchema, updateMerchantSchema, updateMerchantStatusSchema, updateProductSchema, updateServiceAreaInterestStatusSchema, updateServiceAreaOrderStatusSchema, verifyPickupSchema, warehouseExceptionSchema, warehouseSchema, wechatLoginSchema } from '@hometown/api-contracts';
import { BusinessError, moneyCents } from '@hometown/domain';
import type { AppConfig } from './config.js';
import { readDemoActor, requireActor } from './modules/auth/auth.js';
import { AuthService, WechatApiCodeExchange, type WechatCodeExchange } from './modules/auth/wechat-auth.js';
import { AdminAuthService } from './modules/auth/admin-auth.js';
import { CampaignService } from './modules/campaigns/campaign-service.js';
import { NoopCampaignScheduler, RedisCampaignScheduler, type CampaignScheduler } from './modules/campaigns/campaign-scheduler.js';
import { MemoryStore, type CommerceStore } from './modules/core/store.js';
import type { Campaign } from './modules/core/types.js';
import { MysqlStore } from './modules/core/mysql-store.js';
import { OrderService } from './modules/orders/order-service.js';
import { FulfillmentService } from './modules/fulfillment/fulfillment-service.js';
import { DeliveryPlanService } from './modules/fulfillment/delivery-plan-service.js';
import { NotificationService } from './modules/notifications/notification-service.js';
import { DisabledSubscriptionMessageProvider, WechatSubscriptionMessageProvider, type SubscriptionMessageProvider } from './modules/notifications/wechat-subscription-provider.js';
import { MockPaymentProvider, WechatPlatformPaymentProvider, type PaymentProvider } from './modules/payments/payment-provider.js';
import { PaymentService } from './modules/payments/payment-service.js';
import { LedgerService } from './modules/finance/ledger-service.js';
import { getRegionDirectoryEntry, listRegionDirectory } from './modules/service-areas/region-directory.js';
import { PlatformProcurementService } from './modules/platform/platform-procurement-service.js';

declare module 'fastify' { interface FastifyRequest { rawBody:string } }

const NETWORK_PRESETS = {
  BAODING_COUNTIES: {
    id: 'BAODING_COUNTIES',
    name: '保定市区县',
    description: '保定市 5 区、4 个县级市及 15 县',
    cities: [
      ['130602', '竞秀区'], ['130606', '莲池区'], ['130607', '满城区'],
      ['130608', '清苑区'], ['130609', '徐水区'], ['130623', '涞水县'],
      ['130624', '阜平县'], ['130626', '定兴县'], ['130627', '唐县'],
      ['130628', '高阳县'], ['130629', '容城县'], ['130630', '涞源县'],
      ['130631', '望都县'], ['130632', '安新县'], ['130633', '易县'],
      ['130634', '曲阳县'], ['130635', '蠡县'], ['130636', '顺平县'],
      ['130637', '博野县'], ['130638', '雄县'], ['130681', '涿州市'],
      ['130682', '定州市'], ['130683', '安国市'], ['130684', '高碑店市'],
    ] as const,
  },
} as const;

export interface AppDependencies {
  config: AppConfig;
  store?: CommerceStore;
  wechatCodeExchange?: WechatCodeExchange;
  subscriptionMessageProvider?: SubscriptionMessageProvider;
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: dependencies.config.NODE_ENV === 'test' ? false : { level: dependencies.config.LOG_LEVEL,redact:['req.headers.authorization','req.headers.cookie','res.headers.set-cookie'] },
    genReqId: () => crypto.randomUUID(),
    trustProxy:dependencies.config.TRUST_PROXY,
    bodyLimit:1_048_576,
  });
  const store = dependencies.store ?? (dependencies.config.DATA_STORE === 'mysql'
    ? MysqlStore.create(dependencies.config.DATABASE_URL!)
    : new MemoryStore());
  const campaignHolder: { service?: CampaignService } = {};
  let scheduler: CampaignScheduler = new NoopCampaignScheduler();
  if (dependencies.config.QUEUE_DRIVER === 'redis') {
    scheduler = new RedisCampaignScheduler(dependencies.config.REDIS_URL!, async (campaignId, version) => {
      if (!campaignHolder.service) throw new Error('团期服务尚未初始化');
      await campaignHolder.service.close(campaignId, true, version);
    });
  }
  const campaigns = new CampaignService(store, scheduler);
  campaignHolder.service = campaigns;
  const orders = new OrderService(store, campaigns);
  const ledger=new LedgerService();
  const subscriptionMessageProvider = dependencies.subscriptionMessageProvider ?? (dependencies.config.WECHAT_APP_ID && dependencies.config.WECHAT_APP_SECRET
    ? new WechatSubscriptionMessageProvider(dependencies.config)
    : new DisabledSubscriptionMessageProvider());
  const notifications = new NotificationService(store, subscriptionMessageProvider);
  const fulfillment = new FulfillmentService(store, dependencies.config.PICKUP_CODE_SECRET,ledger,notifications);
  const platformProcurement=new PlatformProcurementService(store,dependencies.config.PICKUP_CODE_SECRET,ledger);
  const deliveryPlans = new DeliveryPlanService(store,notifications);
  const paymentProvider:PaymentProvider=dependencies.config.PAYMENT_PROVIDER==='wechat-platform'
    ? new WechatPlatformPaymentProvider({appId:dependencies.config.WECHAT_APP_ID!,spMchid:dependencies.config.WECHAT_PAY_SP_MCHID!,...(dependencies.config.WECHAT_PAY_PLATFORM_MCHID&&dependencies.config.WECHAT_PAY_PLATFORM_CERT_SERIAL&&dependencies.config.WECHAT_PAY_PLATFORM_PRIVATE_KEY_PATH?{platformMchid:dependencies.config.WECHAT_PAY_PLATFORM_MCHID,platformCertificateSerial:dependencies.config.WECHAT_PAY_PLATFORM_CERT_SERIAL,platformPrivateKeyPath:dependencies.config.WECHAT_PAY_PLATFORM_PRIVATE_KEY_PATH}:{}),certificateSerial:dependencies.config.WECHAT_PAY_CERT_SERIAL!,privateKeyPath:dependencies.config.WECHAT_PAY_PRIVATE_KEY_PATH!,publicKeyId:dependencies.config.WECHAT_PAY_PUBLIC_KEY_ID!,publicKeyPath:dependencies.config.WECHAT_PAY_PUBLIC_KEY_PATH!,apiV3Key:dependencies.config.WECHAT_PAY_API_V3_KEY!,notifyUrl:dependencies.config.WECHAT_PAY_NOTIFY_URL!,refundNotifyUrl:dependencies.config.WECHAT_PAY_REFUND_NOTIFY_URL!,platformName:dependencies.config.WECHAT_PAY_PLATFORM_NAME!})
    : new MockPaymentProvider();
  const payments=new PaymentService(store,paymentProvider,ledger,notifications);
  campaigns.setRefundHandler((orderId)=>payments.refundOrder(orderId));
  campaigns.setLockedHandler(async(campaignId)=>{await platformProcurement.createPurchaseOrders(campaignId);});
  const authService = dependencies.config.AUTH_PROVIDER === 'wechat'
    ? new AuthService(
      store,
      dependencies.wechatCodeExchange ?? new WechatApiCodeExchange(dependencies.config.WECHAT_APP_ID!, dependencies.config.WECHAT_APP_SECRET!),
      dependencies.config.AUTH_SESSION_TTL_SECONDS,
    )
    : null;
  const adminAuthService=new AdminAuthService(store,dependencies.config.AUTH_SESSION_TTL_SECONDS);
  const audit=async(request:FastifyRequest,actorId:string,action:string,resourceType:string,resourceId:string,beforeData:unknown,afterData:unknown)=>store.saveAuditLog({id:crypto.randomUUID(),actorId,action,resourceType,resourceId,requestId:request.id,beforeData,afterData,createdAt:new Date().toISOString()});
  const setPickupVerifierAssignment=async(request:FastifyRequest,actorId:string,input:{userId:string;pickupPointId:string},active:boolean)=>store.transaction(async(transactionStore)=>{
    const user=await transactionStore.getUser(input.userId);
    if(!user)throw new BusinessError('RESOURCE_NOT_FOUND','核销员用户不存在',404);
    if(active&&user.status!=='ACTIVE')throw new BusinessError('INVALID_STATE_TRANSITION','核销员用户当前未激活',409);
    const pickupPoint=(await transactionStore.listPickupPoints()).find((item)=>item.id===input.pickupPointId);
    if(!pickupPoint)throw new BusinessError('RESOURCE_NOT_FOUND','自提点不存在',404);
    if(active&&pickupPoint.status!=='ACTIVE')throw new BusinessError('INVALID_STATE_TRANSITION','自提点当前未启用',409);
    const wasActive=await transactionStore.hasActivePickupVerifierAssignment(input.userId,input.pickupPointId);
    if(active){
      await transactionStore.saveUserRole(input.userId,'PICKUP_VERIFIER');
      if(!wasActive)await transactionStore.grantPickupVerifier(input.userId,input.pickupPointId);
    }else if(wasActive){
      await transactionStore.revokePickupVerifier(input.userId,input.pickupPointId);
    }
    const before={...input,active:wasActive};const after={...input,active,changed:wasActive!==active};
    await transactionStore.saveAuditLog({id:crypto.randomUUID(),actorId,action:active?'PICKUP_VERIFIER_POINT_GRANTED':'PICKUP_VERIFIER_POINT_REVOKED',resourceType:'PICKUP_VERIFIER_ASSIGNMENT',resourceId:`${input.userId}:${input.pickupPointId}`,requestId:request.id,beforeData:before,afterData:after,createdAt:new Date().toISOString()});
    return after;
  });
  /** Consumer response: never leak operations notes, contacts, vehicle or driver details. */
  const publicDeliveryPlan=(plan:Awaited<ReturnType<CommerceStore['getDeliveryPlan']>>)=>plan?({
    id:plan.id,campaignId:plan.campaignId,serviceAreaId:plan.serviceAreaId,pickupPointId:plan.pickupPointId,status:plan.status,siteName:plan.siteName,address:plan.address,
    arrivalStartAt:plan.arrivalStartAt,arrivalEndAt:plan.arrivalEndAt,
  }):null;
  const withCampaignItems=async(campaign:Campaign)=>{
    const {items:legacyItems,platformItems,warehouseId:_warehouseId,...consumerCampaign}=campaign;
    void _warehouseId;
    return {
    ...consumerCampaign,
    deliveryPlan:publicDeliveryPlan(await store.getDeliveryPlanByCampaign(campaign.id)),
    // The consumer DTO normalises the two catalog models. Supplier, offer and
    // purchase-price data remain inside the operations boundary.
    items:campaign.businessModelVersion==='PLATFORM_PROCUREMENT'
      ?platformItems.map((item)=>({skuId:item.platformSkuId,title:item.title,category:item.category,skuName:item.skuName,origin:item.origin,imageUrl:item.imageUrl,unitPriceCents:Number(item.retailPriceCents),stock:item.sellableQuantity,soldQuantity:item.reservedQuantity}))
      :legacyItems.map((item)=>({skuId:item.skuId,title:item.title,category:item.category,skuName:item.skuName,origin:item.origin,imageUrl:item.imageUrl,unitPriceCents:Number(item.unitPriceCents),stock:item.stock,soldQuantity:item.soldQuantity})),
    };
  };
  const withOrderDelivery=async(order:Awaited<ReturnType<CommerceStore['getOrder']>>)=>{
    if(!order)return null;
    const {merchantOrders:_merchantOrders,commissionCents:_commissionCents,items,...consumerOrder}=order;
    void _merchantOrders;void _commissionCents;
    const exceptionRows=(await Promise.all((await store.listFulfillmentExceptions()).map(async(exception)=>({exception,allocations:await store.listFulfillmentAllocations(exception.id)})))).filter((value)=>value.allocations.some((allocation)=>allocation.orderId===order.id));
    const partialRefunds=order.businessModelVersion==='PLATFORM_PROCUREMENT'?await store.listPlatformPartialRefundsByOrder(order.id):[];
    const refundByException=new Map(partialRefunds.map((refund)=>[refund.exceptionId,refund]));
    return {...consumerOrder,items:items.map((item)=>{const allocationRows=exceptionRows.flatMap(({exception,allocations})=>allocations.filter((allocation)=>allocation.orderId===order.id&&allocation.salesOrderItemId===item.salesOrderItemId).map((allocation)=>({exception,allocation})));const active=allocationRows.find(({allocation})=>allocation.exceptionQuantity>0);const pendingRefund=active?refundByException.get(active.exception.id):undefined;const refundableQuantity=Math.max(0,item.exceptionQuantity-item.refundedQuantity);const refundStatus=item.refundedQuantity>0?'SUCCEEDED':pendingRefund?.status??(active?.exception.status==='REFUND_CONFIRMED'?'PENDING':null);const refundAmountCents=refundableQuantity>0?Number(item.unitPriceCents)*refundableQuantity:Number(item.refundedAmountCents);return{skuId:item.skuId,productId:item.productId,name:item.name,quantity:item.quantity,unitPriceCents:item.unitPriceCents,amountCents:item.amountCents,fulfilledQuantity:item.fulfilledQuantity,exceptionQuantity:item.exceptionQuantity,refundedQuantity:item.refundedQuantity,refundedAmountCents:item.refundedAmountCents,refundStatus,refundAmountCents};}),deliveryPlan:publicDeliveryPlan(await store.getDeliveryPlan(order.deliveryPlanId)),afterSales:(await store.listAfterSalesByUser(order.userId)).filter((item)=>item.orderId===order.id),fulfillmentExceptions:exceptionRows.map(({exception,allocations})=>({id:exception.id,status:exception.status,sourceStage:exception.sourceStage,responsibility:exception.responsibility,resolutionNote:exception.resolutionNote,items:allocations.filter((allocation)=>allocation.orderId===order.id).map((allocation)=>({platformSkuId:allocation.platformSkuId,fulfilledQuantity:allocation.fulfilledQuantity,exceptionQuantity:allocation.exceptionQuantity,refundedQuantity:allocation.refundedQuantity,reason:exception.items.find((item)=>item.id===allocation.exceptionItemId)?.reason??null}))})),partialRefunds:partialRefunds.map((refund)=>({id:refund.id,exceptionId:refund.exceptionId,status:refund.status,amountCents:refund.amountCents}))};
  };
  const withExceptionRefundAmounts=async(exception:Awaited<ReturnType<CommerceStore['getFulfillmentException']>>)=>{
    if(!exception)return null;
    let refundableAmountCents=0;let refundedAmountCents=0;
    for(const allocation of await store.listFulfillmentAllocations(exception.id)){
      const order=await store.getOrder(allocation.orderId);
      const line=order?.items.find((item)=>item.salesOrderItemId===allocation.salesOrderItemId);
      if(!line)continue;
      const unitPrice=Number(line.unitPriceCents);
      refundableAmountCents+=unitPrice*(allocation.exceptionQuantity-allocation.refundedQuantity);
      refundedAmountCents+=unitPrice*allocation.refundedQuantity;
    }
    const refundBreakdown=await Promise.all((await store.listFulfillmentAllocations(exception.id)).map(async(allocation)=>{const order=await store.getOrder(allocation.orderId);const line=order?.items.find((item)=>item.salesOrderItemId===allocation.salesOrderItemId);if(!line||!order)return null;const sku=await store.getPlatformSku(allocation.platformSkuId);const unitPriceCents=Number(line.unitPriceCents);const refundableQuantity=allocation.exceptionQuantity-allocation.refundedQuantity;const allRefunds=await store.listPlatformPartialRefundsByOrder(order.id);const refunded=allRefunds.filter((refund)=>refund.status==='SUCCEEDED').reduce((sum,refund)=>sum+Number(refund.amountCents),0);const inFlight=allRefunds.filter((refund)=>['CREATED','PROCESSING'].includes(refund.status)).reduce((sum,refund)=>sum+Number(refund.amountCents),0);return{orderId:allocation.orderId,orderNo:order.orderNo,salesOrderItemId:allocation.salesOrderItemId,productName:sku?.product.title??line.name,skuName:sku?.name??line.name,platformSkuId:allocation.platformSkuId,orderTotalCents:Number(order.totalCents),orderRefundedAmountCents:refunded,orderRefundInFlightAmountCents:inFlight,orderRefundableBalanceCents:Math.max(0,Number(order.totalCents)-refunded-inFlight),exceptionQuantity:allocation.exceptionQuantity,refundedQuantity:allocation.refundedQuantity,refundableQuantity,unitPriceCents,refundableAmountCents:unitPriceCents*refundableQuantity,refundedAmountCents:unitPriceCents*allocation.refundedQuantity};}));
    return {...exception,refundableAmountCents,refundedAmountCents,refundBreakdown:refundBreakdown.filter((item):item is NonNullable<typeof item>=>item!==null)};
  };
  await scheduler.reconcile(await store.listCampaigns());
  await platformProcurement.reconcileLockedCampaigns();
  await orders.expirePendingOrders();
  await notifications.drainPending().catch((error: unknown) => app.log.error({ err: error }, 'notification outbox initial drain failed'));
  const reconciliationTimer = setInterval(() => {
    void store.listCampaigns()
      .then((items) => scheduler.reconcile(items))
      .then(()=>platformProcurement.reconcileLockedCampaigns())
      .then(()=>orders.expirePendingOrders())
       .then(()=>payments.reconcileRefunds())
       .then(()=>payments.reconcileSettlements())
       .then(()=>payments.settleEligiblePickedUpOrders())
       .then(()=>notifications.drainPending())
      .catch((error: unknown) => app.log.error({ err: error }, 'campaign schedule reconciliation failed'));
  }, 30_000);
  reconciliationTimer.unref();

  app.decorateRequest('rawBody','');
  app.addContentTypeParser('application/json',{parseAs:'string'},(request,body,done)=>{
    const raw=typeof body==='string'?body:body.toString('utf8');
    request.rawBody=raw;
    try{done(null,JSON.parse(raw));}catch{
      done(new BusinessError('VALIDATION_ERROR','请求体不是有效的 JSON',400),undefined);
    }
  });
  await app.register(cors, { origin: dependencies.config.NODE_ENV === 'production' ? false : true });
  await app.register(helmet,{contentSecurityPolicy:false});
  await app.register(rateLimit,{global:true,max:dependencies.config.RATE_LIMIT_MAX,timeWindow:'1 minute',keyGenerator:(request)=>request.ip});
  app.decorateRequest('actor', null);
  if (dependencies.config.REQUIRE_HTTPS) {
    app.addHook('onRequest', async (request) => {
      const forwarded = request.headers['x-forwarded-proto'];
      const protocol = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
      if (protocol !== 'https') throw new BusinessError('HTTPS_REQUIRED', 'HTTPS connection required', 426);
    });
  }
  app.addHook('onRequest', async (request) => {
    request.actor = await adminAuthService.authenticate(request.headers.authorization)
      ?? (dependencies.config.AUTH_PROVIDER === 'demo'
        ? readDemoActor(request)
        : await authService!.authenticate(request.headers.authorization));
  });
  app.addHook('preHandler',async(request)=>{
    const route=request.routeOptions.url;
    if(route!=='/api/v1/orders/:id/after-sales'&&route!=='/api/v1/admin/orders/:id/refund')return;
    const actor=route==='/api/v1/admin/orders/:id/refund'?requireActor(request,['FINANCE','SUPER_ADMIN']):requireActor(request,['USER','SUPER_ADMIN']);
    const id=identifierSchema.parse((request.params as{id:string}).id);const order=await store.getOrder(id);if(!order)return;
    if(route==='/api/v1/orders/:id/after-sales'&&order.userId!==actor.userId)throw new BusinessError('FORBIDDEN','无权操作该订单',403);
    if(order.businessModelVersion==='PLATFORM_PROCUREMENT')throw new BusinessError('PARTIAL_REFUND_NOT_SUPPORTED','模式 B 订单必须通过履约异常的运营确认与财务退款链路处理',409);
    if(route==='/api/v1/admin/orders/:id/refund'&&order.status==='PICKED_UP')throw new BusinessError('INVALID_STATE_TRANSITION','已取货订单必须通过售后申请审批退款',409);
    if(route==='/api/v1/orders/:id/after-sales'&&(['COMPLETED','REFUNDED'].includes(order.status)||(order.status==='PICKED_UP'&&order.pickedUpAt&&Date.parse(order.pickedUpAt)+7*86_400_000<=Date.now())))throw new BusinessError('INVALID_STATE_TRANSITION','当前订单不在售后申请期内',409);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof BusinessError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        requestId: request.id,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    }
    if (typeof error === 'object' && error !== null && 'issues' in error) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: '请求参数不正确',
        requestId: request.id,
        details: error.issues,
      });
    }
    request.log.error({ err: error }, 'unhandled request error');
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: request.id });
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async () => {
    const [dataStore, queue] = await Promise.all([store.health(), scheduler.health()]);
    return { status: 'ok', dependencies: { dataStore, queue } };
  });
  app.addHook('onClose', async () => { clearInterval(reconciliationTimer); await scheduler.close(); await store.close(); });

  app.post('/api/v1/auth/wechat/login',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}}, async (request) => {
    if (!authService) throw new BusinessError('FORBIDDEN', '当前环境未启用微信登录', 403);
    const input=wechatLoginSchema.parse(request.body);
    if(input.privacyVersion!==dependencies.config.PRIVACY_NOTICE_VERSION)throw new BusinessError('VALIDATION_ERROR','隐私说明已更新，请阅读并同意最新版本',400);
    return { data: await authService.login(input.code, input.privacyVersion) };
  });
  app.post('/api/v1/auth/admin/login',{config:{rateLimit:{max:5,timeWindow:'5 minutes'}}},async(request)=>{
    const input=adminLoginSchema.parse(request.body);
    return{data:await adminAuthService.login(input.username,input.password)};
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    requireActor(request, ['USER', 'OPERATOR', 'REVIEWER', 'FULFILLMENT', 'PICKUP_MANAGER', 'PICKUP_VERIFIER', 'FINANCE', 'SUPER_ADMIN']);
    await authService?.logout(request.headers.authorization);
    await adminAuthService.logout(request.headers.authorization);
    return reply.status(204).send();
  });

  app.get('/api/v1/campaigns', async () => ({ data: await Promise.all((await campaigns.listPublic()).map(withCampaignItems)) }));
  app.get('/api/v1/service-areas', async () => ({ data: (await store.listServiceAreas()).filter((item) => item.status === 'ENABLED' && item.orderEnabled) }));
  app.get('/api/v1/pickup-points', async (request) => {
    const query = request.query as { serviceAreaId?: string };
    return { data: (await store.listPickupPoints(query.serviceAreaId)).filter((item)=>item.status==='ACTIVE') };
  });
  app.get('/api/v1/campaigns/:id', async (request) => {
    const id = identifierSchema.parse((request.params as { id: string }).id);
    return { data: await withCampaignItems(await campaigns.getPublic(id)) };
  });
  app.get('/api/v1/delivery-plans/:campaignId', async (request) => {
    const campaignId = identifierSchema.parse((request.params as { campaignId: string }).campaignId);
    await campaigns.getPublic(campaignId);
    return { data: publicDeliveryPlan(await store.getDeliveryPlanByCampaign(campaignId)) };
  });

  app.get('/api/v1/admin/campaigns', async (request) => {
    requireActor(request, ['OPERATOR', 'FULFILLMENT', 'FINANCE', 'SUPER_ADMIN']);
    return { data: await Promise.all((await campaigns.list()).map(withCampaignItems)) };
  });

  app.post('/api/v1/admin/campaigns', async (request, reply) => {
    const actor=requireActor(request, ['OPERATOR', 'SUPER_ADMIN']);
    const campaign = await campaigns.create(createCampaignSchema.parse(request.body));
    await audit(request,actor.userId,'CAMPAIGN_CREATED','CAMPAIGN',campaign.id,null,campaign);
    return reply.status(201).send({ data: campaign });
  });
  app.patch('/api/v1/admin/campaigns/:id', async (request) => {
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=await campaigns.get(id);const after=await campaigns.updateDraft(id,updateCampaignSchema.parse(request.body));await audit(request,actor.userId,'CAMPAIGN_DRAFT_UPDATED','CAMPAIGN',id,before,after);return{data:after};
  });
  app.post('/api/v1/admin/campaigns/:id/postpone', async (request) => {
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=await campaigns.get(id);const after=await campaigns.postpone(id,postponeCampaignSchema.parse(request.body));await audit(request,actor.userId,'CAMPAIGN_POSTPONED','CAMPAIGN',id,before,after);return{data:after};
  });
  app.post('/api/v1/admin/campaigns/:id/cancel', async (request) => {
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=await campaigns.get(id);const after=await campaigns.cancel(id);await audit(request,actor.userId,'CAMPAIGN_CANCELLED','CAMPAIGN',id,before,after);return{data:after};
  });
  app.get('/api/v1/admin/delivery-plans', async (request) => { requireActor(request, ['OPERATOR','FULFILLMENT','SUPER_ADMIN']); return { data: await deliveryPlans.list() }; });
  app.get('/api/v1/pickup/delivery-plans', async (request) => {
    const actor=requireActor(request,['PICKUP_VERIFIER','FULFILLMENT','SUPER_ADMIN']);
    const plans=await deliveryPlans.list();
    if(actor.roles.includes('SUPER_ADMIN')||actor.roles.includes('FULFILLMENT'))return {data:plans};
    const verifier=await store.getUser(actor.userId);
    if(!verifier||verifier.status!=='ACTIVE')throw new BusinessError('FORBIDDEN','当前核销人员不可用',403);
    const activePointIds=new Set((await store.listPickupPoints()).filter((point)=>point.status==='ACTIVE').map((point)=>point.id));
    const allowed=await Promise.all(plans.map(async(plan)=>plan.status==='ARRIVED'&&plan.pickupPointId&&activePointIds.has(plan.pickupPointId)&&(await store.hasActivePickupVerifierAssignment(actor.userId,plan.pickupPointId))?plan:null));
    return {data:allowed.filter((plan):plan is NonNullable<typeof plan>=>plan!==null).map((plan)=>({
      id:plan.id,campaignId:plan.campaignId,serviceAreaId:plan.serviceAreaId,pickupPointId:plan.pickupPointId,status:plan.status,
      siteName:plan.siteName,address:plan.address,arrivalStartAt:plan.arrivalStartAt,arrivalEndAt:plan.arrivalEndAt,
    }))};
  });
  app.post('/api/v1/admin/delivery-plans', async (request) => {
    const actor=requireActor(request,['OPERATOR','FULFILLMENT','SUPER_ADMIN']);
    const input=createDeliveryPlanSchema.parse(request.body);
    const after=await deliveryPlans.saveSite(input);
    await audit(request,actor.userId,'DELIVERY_SITE_SAVED','DELIVERY_PLAN',after.id,null,after);
    return {data:after};
  });
  app.post('/api/v1/admin/delivery-plans/:id/book-vehicle', async (request) => {
    const actor=requireActor(request,['OPERATOR','FULFILLMENT','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=await store.getDeliveryPlan(id);const after=await deliveryPlans.bookVehicle(id,bookVehicleSchema.parse(request.body));await audit(request,actor.userId,'DELIVERY_VEHICLE_BOOKED','DELIVERY_PLAN',id,before,after);return {data:after};
  });
  app.get('/api/v1/admin/merchants', async (request) => { requireActor(request, ['OPERATOR','SUPER_ADMIN']); return { data: await store.listMerchants() }; });
  app.post('/api/v1/admin/merchants', async (request, reply) => {
    requireActor(request, ['OPERATOR','SUPER_ADMIN']); const input=createMerchantSchema.parse(request.body); const now=new Date().toISOString();
    const merchant={id:crypto.randomUUID(),name:input.name,status:'ACTIVE' as const,defaultCommissionBps:input.defaultCommissionBps,wechatSubMchid:input.wechatSubMchid??null,createdAt:now}; await store.saveMerchant(merchant); return reply.status(201).send({data:merchant});
  });
  app.patch('/api/v1/admin/merchants/:id',async(request)=>{
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const input=updateMerchantSchema.parse(request.body);const before=(await store.listMerchants()).find((item)=>item.id===id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','供货商不存在',404);const after={...before,...input,wechatSubMchid:input.wechatSubMchid??before.wechatSubMchid};await store.saveMerchant(after);await audit(request,actor.userId,'MERCHANT_UPDATED','MERCHANT',id,before,after);return{data:after};
  });
  app.post('/api/v1/admin/merchants/:id/status',async(request)=>{
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const input=updateMerchantStatusSchema.parse(request.body);const before=(await store.listMerchants()).find((item)=>item.id===id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','供货商不存在',404);const products=(await store.listProducts()).filter((item)=>item.merchantId===id);const hasActiveCampaign=(await store.listCampaigns()).some((campaign)=>['DRAFT','OPEN','POSTPONED'].includes(campaign.status)&&campaign.items.some((item)=>products.some((product)=>product.sku.id===item.skuId)));if(input.status==='SUSPENDED'&&hasActiveCampaign)throw new BusinessError('INVALID_STATE_TRANSITION','供货商商品正在草稿或收单团期中，请先处理相关团期',409);const after={...before,status:input.status};await store.saveMerchant(after);await audit(request,actor.userId,input.status==='SUSPENDED'?'MERCHANT_SUSPENDED':'MERCHANT_ACTIVATED','MERCHANT',id,before,after);return{data:after};
  });
  app.delete('/api/v1/admin/merchants/:id',async(request,reply)=>{
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=(await store.listMerchants()).find((item)=>item.id===id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','供货商不存在',404);if((await store.listProducts()).some((item)=>item.merchantId===id))throw new BusinessError('RESOURCE_IN_USE','供货商已有商品记录，只能停用，不能删除',409);await store.deleteMerchant(id);await audit(request,actor.userId,'MERCHANT_DELETED','MERCHANT',id,before,null);return reply.status(204).send();
  });
  app.get('/api/v1/admin/products', async (request) => { requireActor(request, ['OPERATOR','SUPER_ADMIN']); return { data: await store.listProducts() }; });
  app.post('/api/v1/admin/products', async (request, reply) => {
    requireActor(request, ['OPERATOR','SUPER_ADMIN']); const input=createProductSchema.parse(request.body); const merchant=(await store.listMerchants()).find((item)=>item.id===input.merchantId);
    if(!merchant)throw new BusinessError('RESOURCE_NOT_FOUND','商户不存在',404); if(merchant.status!=='ACTIVE')throw new BusinessError('INVALID_STATE_TRANSITION','已停用的供货商不能新建商品',409); const now=new Date().toISOString(); const productId=crypto.randomUUID();
    const product={id:productId,merchantId:merchant.id,title:input.title,category:input.category,origin:input.origin,imageUrl:input.imageUrl,storageType:'NORMAL_TEMPERATURE' as const,status:'DRAFT' as const,createdAt:now,sku:{id:crypto.randomUUID(),productId,merchantId:merchant.id,name:input.skuName,unitPriceCents:moneyCents(input.priceCents),stock:input.stock,soldQuantity:0,commissionRateBps:merchant.defaultCommissionBps}}; await store.saveProduct(product); return reply.status(201).send({data:product});
  });
  app.patch('/api/v1/admin/products/:id',async(request)=>{
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const input=updateProductSchema.parse(request.body);const before=(await store.listProducts()).find((item)=>item.id===id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','商品不存在',404);if(before.status==='PENDING_REVIEW')throw new BusinessError('INVALID_STATE_TRANSITION','审核中的商品不能编辑，请先撤回或等待审核结果',409);const references=(await store.listCampaigns()).filter((campaign)=>['DRAFT','OPEN','POSTPONED'].includes(campaign.status)&&campaign.skuIds.includes(before.sku.id));if(references.length)throw new BusinessError('RESOURCE_IN_USE','商品已被草稿或收单团期引用，不能直接修改；请复制或新建商品',409);const merchant=(await store.listMerchants()).find((item)=>item.id===input.merchantId&&item.status==='ACTIVE');if(!merchant)throw new BusinessError('RESOURCE_NOT_FOUND','供货商不存在或已停用',404);if(input.stock<before.sku.soldQuantity)throw new BusinessError('VALIDATION_ERROR','库存不能低于已售数量',400);const after={...before,merchantId:merchant.id,title:input.title,category:input.category,origin:input.origin,imageUrl:input.imageUrl,status:before.status==='APPROVED'?'DRAFT':before.status,sku:{...before.sku,merchantId:merchant.id,name:input.skuName,unitPriceCents:moneyCents(input.priceCents),stock:input.stock,commissionRateBps:merchant.defaultCommissionBps}};await store.saveProduct(after);await audit(request,actor.userId,'PRODUCT_UPDATED','PRODUCT',id,before,after);return{data:after};
  });
  app.post('/api/v1/admin/products/:id/off-shelf',async(request)=>{
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=(await store.listProducts()).find((item)=>item.id===id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','商品不存在',404);if((await store.listCampaigns()).some((campaign)=>['DRAFT','OPEN','POSTPONED'].includes(campaign.status)&&campaign.skuIds.includes(before.sku.id)))throw new BusinessError('RESOURCE_IN_USE','商品正在草稿或收单团期中，不能下架',409);await store.updateProductStatus(id,'OFF_SHELF');const after={...before,status:'OFF_SHELF' as const};await audit(request,actor.userId,'PRODUCT_OFF_SHELF','PRODUCT',id,before,after);return{data:after};
  });
  app.post('/api/v1/admin/products/:id/restore',async(request)=>{
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=(await store.listProducts()).find((item)=>item.id===id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','商品不存在',404);if(before.status!=='OFF_SHELF')throw new BusinessError('INVALID_STATE_TRANSITION','只有已下架商品可以恢复',409);await store.updateProductStatus(id,'DRAFT');const after={...before,status:'DRAFT' as const};await audit(request,actor.userId,'PRODUCT_RESTORED_TO_DRAFT','PRODUCT',id,before,after);return{data:after};
  });
  app.delete('/api/v1/admin/products/:id',async(request,reply)=>{
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=(await store.listProducts()).find((item)=>item.id===id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','商品不存在',404);if(!['DRAFT','REJECTED'].includes(before.status))throw new BusinessError('INVALID_STATE_TRANSITION','仅草稿或已驳回商品可删除，其他商品请下架归档',409);if((await store.listCampaigns()).some((campaign)=>campaign.skuIds.includes(before.sku.id)))throw new BusinessError('RESOURCE_IN_USE','商品已有团期记录，不能删除',409);await store.deleteProduct(id);await audit(request,actor.userId,'PRODUCT_DRAFT_DELETED','PRODUCT',id,before,null);return reply.status(204).send();
  });
  app.post('/api/v1/admin/products/:id/submit-review', async (request) => {
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']); const id=identifierSchema.parse((request.params as {id:string}).id); const product=(await store.listProducts()).find((item)=>item.id===id);
    if(!product)throw new BusinessError('RESOURCE_NOT_FOUND','商品不存在',404); if(!['DRAFT','REJECTED'].includes(product.status))throw new BusinessError('INVALID_STATE_TRANSITION','只有草稿或已驳回商品可以提交审核',409);
    await store.updateProductStatus(id,'PENDING_REVIEW');const updated={...product,status:'PENDING_REVIEW' as const};await audit(request,actor.userId,'PRODUCT_SUBMITTED','PRODUCT',id,product,updated);return {data:updated};
  });
  app.post('/api/v1/admin/products/:id/review', async (request) => {
    const actor=requireActor(request,['REVIEWER','SUPER_ADMIN']); const id=identifierSchema.parse((request.params as {id:string}).id); const input=reviewDecisionSchema.parse(request.body); const product=(await store.listProducts()).find((item)=>item.id===id);
    if(!product)throw new BusinessError('RESOURCE_NOT_FOUND','商品不存在',404); if(product.status!=='PENDING_REVIEW')throw new BusinessError('INVALID_STATE_TRANSITION','商品当前不在待审核状态',409);
    const submission=await store.findLatestAudit('PRODUCT',id,'PRODUCT_SUBMITTED');if(submission?.actorId===actor.userId)throw new BusinessError('FORBIDDEN','提交人与审核人不能是同一人',403);
    const status=input.decision==='APPROVE'?'APPROVED':'REJECTED'; await store.updateProductStatus(id,status);const updated={...product,status,reviewReason:input.reason??null};await audit(request,actor.userId,status==='APPROVED'?'PRODUCT_APPROVED':'PRODUCT_REJECTED','PRODUCT',id,product,updated);return {data:updated};
  });
  app.get('/api/v1/admin/service-areas', async (request) => { requireActor(request, ['OPERATOR','SUPER_ADMIN']); return { data: await store.listServiceAreas() }; });
  app.get('/api/v1/admin/region-directory', async (request) => {
    requireActor(request, ['OPERATOR','SUPER_ADMIN']);
    const { query }=regionDirectoryQuerySchema.parse(request.query);
    return { data: listRegionDirectory(query) };
  });
  app.post('/api/v1/admin/service-areas', async (request, reply) => {
    const actor=requireActor(request, ['OPERATOR','SUPER_ADMIN']); const input=openServiceAreaSchema.parse(request.body); const directoryEntry=getRegionDirectoryEntry(input.regionCode);
    if(!directoryEntry)throw new BusinessError('RESOURCE_NOT_FOUND','行政区划目录中未找到该区域',404);
    const existing=(await store.listServiceAreas()).find((area)=>area.regionCode===input.regionCode);
    if(existing){
      const changed=!existing.orderEnabled; if(changed)await store.updateServiceAreaOrderEnabled(existing.id,true);
      const area={...existing,orderEnabled:true}; if(changed)await audit(request,actor.userId,'SERVICE_AREA_OPENED','SERVICE_AREA',area.id,existing,area);
      return reply.status(200).send({data:area});
    }
    const area={id:crypto.randomUUID(),regionCode:directoryEntry.regionCode,name:directoryEntry.name,status:'ENABLED' as const,orderEnabled:true,createdAt:new Date().toISOString()};
    await store.saveServiceArea(area); await audit(request,actor.userId,'SERVICE_AREA_OPENED','SERVICE_AREA',area.id,null,area); return reply.status(201).send({data:area});
  });
  app.post('/api/v1/admin/service-areas/:id/order-status', async (request) => {
    const actor=requireActor(request, ['OPERATOR','SUPER_ADMIN']); const id=identifierSchema.parse((request.params as {id:string}).id); const input=updateServiceAreaOrderStatusSchema.parse(request.body);
    const existing=(await store.listServiceAreas()).find((area)=>area.id===id);if(!existing)throw new BusinessError('RESOURCE_NOT_FOUND','收货区域不存在',404);
    if(existing.orderEnabled===input.orderEnabled)return {data:existing};
    await store.updateServiceAreaOrderEnabled(id,input.orderEnabled); const area={...existing,orderEnabled:input.orderEnabled};
    await audit(request,actor.userId,input.orderEnabled?'SERVICE_AREA_OPENED':'SERVICE_AREA_PAUSED','SERVICE_AREA',id,existing,area);return {data:area};
  });
  app.get('/api/v1/admin/pickup-points', async (request) => { requireActor(request, ['OPERATOR','SUPER_ADMIN']); return { data: await store.listPickupPoints() }; });
  app.get('/api/v1/admin/pickup-verifier-assignments',async(request)=>{
    requireActor(request,['OPERATOR','SUPER_ADMIN']);
    const {userId}=pickupVerifierAssignmentQuerySchema.parse(request.query);
    return{data:await store.listPickupVerifierAssignments(userId)};
  });
  app.post('/api/v1/admin/pickup-verifier-assignments/grant',async(request)=>{
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);
    return{data:await setPickupVerifierAssignment(request,actor.userId,pickupVerifierAssignmentSchema.parse(request.body),true)};
  });
  app.post('/api/v1/admin/pickup-verifier-assignments/revoke',async(request)=>{
    const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);
    return{data:await setPickupVerifierAssignment(request,actor.userId,pickupVerifierAssignmentSchema.parse(request.body),false)};
  });
  app.get('/api/v1/admin/network-presets', async (request) => {
    requireActor(request, ['OPERATOR','SUPER_ADMIN']);
    const areas=await store.listServiceAreas();
    return {data:Object.values(NETWORK_PRESETS).map((preset)=>({
      id:preset.id,name:preset.name,description:preset.description,totalCities:preset.cities.length,
      activeCities:preset.cities.filter(([code])=>areas.some((area)=>area.regionCode===code)).length,
    }))};
  });
  app.post('/api/v1/admin/network-presets/:presetId/activate', async (request) => {
    const actor=requireActor(request, ['OPERATOR','SUPER_ADMIN']);
    const presetId=networkPresetIdSchema.parse((request.params as {presetId:string}).presetId);
    const input=activateNetworkPresetSchema.parse(request.body??{});
    const preset=NETWORK_PRESETS[presetId];const before=await store.listServiceAreas();
    const knownCodes=new Set(before.map((area)=>area.regionCode));const created=[];
    for(const [regionCode,name] of preset.cities){
      if(knownCodes.has(regionCode))continue;
      const area={id:crypto.randomUUID(),regionCode,name,status:'ENABLED' as const,orderEnabled:input.orderEnabled,createdAt:new Date().toISOString()};
      await store.saveServiceArea(area);created.push(area);knownCodes.add(regionCode);
    }
    const result={presetId,created:created.length,skipped:preset.cities.length-created.length,total:preset.cities.length,areas:created};
    await audit(request,actor.userId,'NETWORK_PRESET_ACTIVATED','NETWORK_PRESET',presetId,{activeCities:before.length},result);
    return {data:result};
  });
  app.post('/api/v1/admin/pickup-points', async (request, reply) => {
    requireActor(request, ['OPERATOR','SUPER_ADMIN']); const input=createPickupPointSchema.parse(request.body); const area=(await store.listServiceAreas()).find((item)=>item.id===input.serviceAreaId); if(!area)throw new BusinessError('RESOURCE_NOT_FOUND','服务区域不存在',404);
    const pickup={id:crypto.randomUUID(),serviceAreaId:area.id,name:input.name,address:input.address,status:'ACTIVE' as const,capacityPerDay:input.capacityPerDay,operationMode:'SELF_OPERATED' as const,responsibilityOwner:null,siteLeadName:null,siteLeadPhone:null,createdAt:new Date().toISOString()}; await store.savePickupPoint(pickup); return reply.status(201).send({data:pickup});
  });
  app.post('/api/v1/admin/pickup-points/batch', async (request, reply) => {
    const actor=requireActor(request, ['OPERATOR','SUPER_ADMIN']);const input=batchCreatePickupPointsSchema.parse(request.body);
    const areas=await store.listServiceAreas();const existing=await store.listPickupPoints();
    const matches=input.points.map((point)=>({point,area:areas.find((item)=>item.name===point.city||item.regionCode===point.city)}));
    const missing=[...new Set(matches.filter((item)=>!item.area).map((item)=>item.point.city))];
    if(missing.length)throw new BusinessError('RESOURCE_NOT_FOUND',`以下区县尚未开通：${missing.join('、')}`,404);
    const created=[];let skipped=0;
    for(const {point,area} of matches){
      if(existing.some((item)=>item.serviceAreaId===area!.id&&item.name===point.name&&item.address===point.address)){skipped+=1;continue;}
      const pickup={id:crypto.randomUUID(),serviceAreaId:area!.id,name:point.name,address:point.address,status:'ACTIVE' as const,capacityPerDay:point.capacityPerDay,operationMode:'SELF_OPERATED' as const,responsibilityOwner:null,siteLeadName:null,siteLeadPhone:null,createdAt:new Date().toISOString()};
      await store.savePickupPoint(pickup);created.push(pickup);existing.push(pickup);
    }
    const result={created:created.length,skipped,total:input.points.length,points:created};
    await audit(request,actor.userId,'PICKUP_POINTS_BATCH_CREATED','PICKUP_POINT','batch',null,result);
    return reply.status(201).send({data:result});
  });
  app.post('/api/v1/admin/campaigns/:id/open', async (request) => {
    const actor=requireActor(request, ['OPERATOR', 'SUPER_ADMIN']);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const before=await campaigns.get(id);const after=await campaigns.open(id);await audit(request,actor.userId,'CAMPAIGN_OPENED','CAMPAIGN',id,before,after);return { data:after };
  });
  app.post('/api/v1/admin/campaigns/:id/close', async (request) => {
    const actor=requireActor(request, ['OPERATOR', 'SUPER_ADMIN']);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const before=await campaigns.get(id);const after=await campaigns.close(id);await audit(request,actor.userId,'CAMPAIGN_CLOSED','CAMPAIGN',id,before,after);return { data:after };
  });

  // Mode-B operational APIs. These endpoints intentionally live under
  // /platform and never expose merchant sub-orders, commissions or settlement data.
  app.get('/api/v1/admin/platform/warehouses',async(request)=>{requireActor(request,['PROCUREMENT','WAREHOUSE_OPERATOR','OPERATOR','SUPER_ADMIN']);return{data:await store.listWarehouses()};});
  app.get('/api/v1/admin/platform/locked-campaigns',async(request)=>{requireActor(request,['PROCUREMENT','WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FULFILLMENT','OPERATOR','SUPER_ADMIN']);const values=(await store.listCampaigns()).filter((item)=>item.businessModelVersion==='PLATFORM_PROCUREMENT'&&item.status==='LOCKED');return{data:await Promise.all(values.map(withCampaignItems))};});
  app.post('/api/v1/admin/platform/warehouses',async(request,reply)=>{const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const input=warehouseSchema.parse(request.body);const now=new Date().toISOString();const value={id:crypto.randomUUID(),...input,createdAt:now,updatedAt:now};await store.saveWarehouse(value);await audit(request,actor.userId,'WAREHOUSE_CREATED','WAREHOUSE',value.id,null,value);return reply.status(201).send({data:value});});
  app.get('/api/v1/admin/platform/suppliers',async(request)=>{requireActor(request,['PROCUREMENT','FINANCE','OPERATOR','SUPER_ADMIN']);return{data:await store.listSuppliers()};});
  app.post('/api/v1/admin/platform/suppliers',async(request,reply)=>{const actor=requireActor(request,['PROCUREMENT','OPERATOR','SUPER_ADMIN']);const input=supplierSchema.parse(request.body);const now=new Date().toISOString();const value={id:crypto.randomUUID(),legacyMerchantId:null,...input,createdAt:now,updatedAt:now};await store.saveSupplier(value);await audit(request,actor.userId,'SUPPLIER_CREATED','SUPPLIER',value.id,null,value);return reply.status(201).send({data:value});});
  app.get('/api/v1/admin/platform/suppliers/:id/qualifications',async(request)=>{requireActor(request,['PROCUREMENT','OPERATOR','SUPER_ADMIN']);return{data:await store.listSupplierQualifications(identifierSchema.parse((request.params as{id:string}).id))};});
  app.post('/api/v1/admin/platform/suppliers/:id/qualifications',async(request,reply)=>{const actor=requireActor(request,['PROCUREMENT','OPERATOR','SUPER_ADMIN']);const supplierId=identifierSchema.parse((request.params as{id:string}).id);if(!await store.getSupplier(supplierId))throw new BusinessError('RESOURCE_NOT_FOUND','供应商不存在',404);const input=supplierQualificationSchema.parse(request.body);const now=new Date().toISOString();const value={id:crypto.randomUUID(),supplierId,...input,createdAt:now,updatedAt:now};await store.saveSupplierQualification(value);await audit(request,actor.userId,'SUPPLIER_QUALIFICATION_SAVED','SUPPLIER_QUALIFICATION',value.id,null,value);return reply.status(201).send({data:value});});
  app.get('/api/v1/admin/platform/skus',async(request)=>{requireActor(request,['PROCUREMENT','OPERATOR','SUPER_ADMIN']);return{data:await store.listPlatformSkus()};});
  app.post('/api/v1/admin/platform/skus',async(request,reply)=>{const actor=requireActor(request,['PROCUREMENT','OPERATOR','SUPER_ADMIN']);const input=platformSkuSchema.parse(request.body);const now=new Date().toISOString();const productId=input.productId??crypto.randomUUID();const value={id:input.id??crypto.randomUUID(),productId,name:input.skuName,retailPriceCents:moneyCents(input.retailPriceCents),status:input.status,product:{id:productId,title:input.title,category:input.category,origin:input.origin,imageUrl:input.imageUrl,storageType:'NORMAL_TEMPERATURE' as const,status:input.status==='ACTIVE'?'ACTIVE' as const:'DRAFT' as const},createdAt:now,updatedAt:now};await store.savePlatformSku(value);await audit(request,actor.userId,'PLATFORM_SKU_SAVED','PLATFORM_SKU',value.id,null,value);return reply.status(201).send({data:value});});
  app.get('/api/v1/admin/platform/offers',async(request)=>{requireActor(request,['PROCUREMENT','FINANCE','SUPER_ADMIN']);return{data:await store.listSupplierSkuOffers()};});
  app.post('/api/v1/admin/platform/offers',async(request,reply)=>{const actor=requireActor(request,['PROCUREMENT','SUPER_ADMIN']);const input=supplierOfferSchema.parse(request.body);const now=new Date().toISOString();const value={id:crypto.randomUUID(),...input,purchasePriceCents:input.purchasePriceCents===null?null:moneyCents(input.purchasePriceCents),createdAt:now,updatedAt:now};await store.saveSupplierSkuOffer(value);await audit(request,actor.userId,'SUPPLIER_OFFER_SAVED','SUPPLIER_SKU_OFFER',value.id,null,value);return reply.status(201).send({data:value});});
  app.post('/api/v1/admin/platform/campaigns',async(request,reply)=>{const actor=requireActor(request,['PROCUREMENT','OPERATOR','SUPER_ADMIN']);if(!dependencies.config.PLATFORM_PROCUREMENT_ENABLED)throw new BusinessError('BUSINESS_MODEL_NOT_ENABLED','平台采购模式尚未启用真实流量',409);const value=await platformProcurement.createCampaign(platformCampaignSchema.parse(request.body));await audit(request,actor.userId,'PLATFORM_CAMPAIGN_CREATED','CAMPAIGN',value.id,null,value);return reply.status(201).send({data:value});});
  app.get('/api/v1/admin/platform/purchase-orders',async(request)=>{const actor=requireActor(request,['PROCUREMENT','WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FINANCE','OPERATOR','SUPER_ADMIN']);const canReadCommercial=actor.roles.some((role)=>['PROCUREMENT','FINANCE','SUPER_ADMIN'].includes(role));const values=await Promise.all((await store.listPurchaseOrders()).map(async(order)=>{const acceptedByItem=new Map<string,number>();for(const receipt of await store.listGoodsReceiptsByPurchaseOrder(order.id))for(const item of receipt.items)acceptedByItem.set(item.purchaseOrderItemId,(acceptedByItem.get(item.purchaseOrderItemId)??0)+item.acceptedQuantity);const items=order.items.map((item)=>{const acceptedQuantity=acceptedByItem.get(item.id)??0;const receiptFact={id:item.id,purchaseOrderId:item.purchaseOrderId,platformSkuId:item.platformSkuId,plannedQuantity:item.plannedQuantity,acceptedQuantity,remainingQuantity:Math.max(0,item.plannedQuantity-acceptedQuantity),createdAt:item.createdAt};return canReadCommercial?{...receiptFact,supplierOfferId:item.supplierOfferId,purchaseUnitCents:item.purchaseUnitCents}:receiptFact;});return canReadCommercial?{...order,items}:{id:order.id,purchaseNo:order.purchaseNo,campaignId:order.campaignId,warehouseId:order.warehouseId,status:order.status,plannedArrivalAt:order.plannedArrivalAt,createdAt:order.createdAt,updatedAt:order.updatedAt,items};}));return{data:values};});
  app.post('/api/v1/admin/platform/campaigns/:id/purchase-orders',async(request)=>{const actor=requireActor(request,['PROCUREMENT','OPERATOR','SUPER_ADMIN']);const values=await platformProcurement.createPurchaseOrders(identifierSchema.parse((request.params as{id:string}).id));await audit(request,actor.userId,'PURCHASE_ORDERS_GENERATED','CAMPAIGN',(request.params as{id:string}).id,null,values);return{data:values};});
  app.post('/api/v1/admin/platform/purchase-orders/:id/receive',async(request)=>{const actor=requireActor(request,['WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','SUPER_ADMIN']);const value=await platformProcurement.receive(identifierSchema.parse((request.params as{id:string}).id),actor.userId,goodsReceiptSchema.parse(request.body).items,{requestId:request.id});return{data:value};});
  app.post('/api/v1/admin/platform/campaigns/:id/warehouse-exceptions',async(request,reply)=>{const actor=requireActor(request,['WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','SUPER_ADMIN']);const value=await platformProcurement.registerWarehouseException(identifierSchema.parse((request.params as{id:string}).id),actor.userId,warehouseExceptionSchema.parse(request.body).items,{requestId:request.id});return reply.status(201).send({data:value});});
  app.get('/api/v1/admin/platform/inventory',async(request)=>{requireActor(request,['WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','PROCUREMENT','FINANCE','SUPER_ADMIN']);return{data:await store.listInventoryBalances()};});
  app.get('/api/v1/admin/platform/payables',async(request)=>{requireActor(request,['FINANCE','PROCUREMENT','SUPER_ADMIN']);return{data:await store.listSupplierPayables()};});
  app.post('/api/v1/admin/platform/payables/:id/mark-paid',async(request)=>{const actor=requireActor(request,['FINANCE','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const input=supplierPayablePaymentSchema.parse(request.body);const value=await store.transaction(async(transactionStore)=>{const current=await transactionStore.getSupplierPayable(id);if(!current)throw new BusinessError('RESOURCE_NOT_FOUND','供应商应付不存在',404);if(current.status==='VOID')throw new BusinessError('INVALID_STATE_TRANSITION','已作废应付不可付款',409);if(current.status==='PAID')return current;const paid={...current,status:'PAID' as const,paymentReference:input.paymentReference,paidAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await transactionStore.saveSupplierPayable(paid);await ledger.recordSupplierPayablePayment(transactionStore,paid);return paid;});await audit(request,actor.userId,'SUPPLIER_PAYABLE_MARKED_PAID','SUPPLIER_PAYABLE',id,null,value);return{data:value};});
  app.get('/api/v1/admin/platform/sorting-tasks',async(request)=>{requireActor(request,['WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FULFILLMENT','OPERATOR','SUPER_ADMIN']);return{data:await store.listSortingTasks()};});
  app.post('/api/v1/admin/platform/campaigns/:id/sorting',async(request)=>{const actor=requireActor(request,['WAREHOUSE_OPERATOR','SUPER_ADMIN']);const value=await platformProcurement.createSorting(identifierSchema.parse((request.params as{id:string}).id),actor.userId);await audit(request,actor.userId,'SORTING_TASK_CREATED','SORTING_TASK',value.id,null,value);return{data:value};});
  app.post('/api/v1/admin/platform/campaigns/:id/sorting/complete',async(request)=>{const actor=requireActor(request,['WAREHOUSE_OPERATOR','SUPER_ADMIN']);const value=await platformProcurement.completeSorting(identifierSchema.parse((request.params as{id:string}).id),actor.userId);await audit(request,actor.userId,'SORTING_TASK_COMPLETED','SORTING_TASK',value.id,null,value);return{data:value};});
  app.post('/api/v1/admin/platform/campaigns/:id/outbound',async(request)=>{const actor=requireActor(request,['WAREHOUSE_OPERATOR','FULFILLMENT','SUPER_ADMIN']);const value=await platformProcurement.createOutbound(identifierSchema.parse((request.params as{id:string}).id),actor.userId,outboundSchema.parse(request.body).carrierReference);await audit(request,actor.userId,'OUTBOUND_DISPATCHED','OUTBOUND_ORDER',value.id,null,value);return{data:value};});
  app.get('/api/v1/admin/platform/outbound-orders',async(request)=>{requireActor(request,['WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FULFILLMENT','OPERATOR','SUPER_ADMIN']);return{data:await store.listOutboundOrders()};});
  app.post('/api/v1/admin/platform/outbound/:id/handover',async(request)=>{const actor=requireActor(request,['FULFILLMENT','SUPER_ADMIN']);const outboundId=identifierSchema.parse((request.params as{id:string}).id);const value=await platformProcurement.handover(outboundId,actor.userId,pickupHandoverSchema.parse(request.body),{requestId:request.id});return{data:value};});
  app.get('/api/v1/admin/platform/fulfillment-exceptions',async(request)=>{requireActor(request,['OPERATOR','PROCUREMENT','WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FULFILLMENT','FINANCE','SUPER_ADMIN']);return{data:(await Promise.all((await store.listFulfillmentExceptions()).map(withExceptionRefundAmounts))).filter((item):item is NonNullable<typeof item>=>item!==null)};});
  app.post('/api/v1/admin/platform/fulfillment-exceptions/:id/decision',async(request)=>{const actor=requireActor(request,['OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const input=exceptionDecisionSchema.parse(request.body);const resolution=input.status==='REFUND_CONFIRMED'?'CONFIRM_PARTIAL_REFUND':input.status;const value=await platformProcurement.decideException(id,actor.userId,{resolution,responsibility:input.responsibility,note:input.resolutionNote},{requestId:request.id});return{data:value};});
  app.post('/api/v1/admin/platform/fulfillment-exceptions/:id/transfer-reinspection',async(request)=>{const actor=requireActor(request,['WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FULFILLMENT','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const value=await platformProcurement.reinspectWrongPointTransfer(id,actor.userId,transferReinspectionSchema.parse(request.body),actor.roles.includes('SUPER_ADMIN'),{requestId:request.id});return{data:value};});
  app.post('/api/v1/admin/platform/fulfillment-exceptions/:id/partial-refund',async(request)=>{const actor=requireActor(request,['FINANCE','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const input=partialRefundExecutionSchema.parse(request.body);await payments.executePartialRefund(id,{actorId:actor.userId,requestId:request.id,confirmationNote:input.confirmationNote});const value=await store.getFulfillmentException(id);if(!value)throw new BusinessError('RESOURCE_NOT_FOUND','异常不存在',404);return{data:value};});

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
    return { data: (await Promise.all((await store.listOrdersByUser(actor.userId)).map(withOrderDelivery))).filter(Boolean) };
  });
  app.get('/api/v1/orders/:id', async (request) => {
    const actor = requireActor(request, ['USER', 'SUPER_ADMIN']);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    return { data: await withOrderDelivery(await orders.getForUser(id, actor.userId)) };
  });
  app.post('/api/v1/orders/:id/cancel', async (request) => {
    const actor=requireActor(request,['USER','SUPER_ADMIN']);
    const id=identifierSchema.parse((request.params as{id:string}).id);
    const before=await orders.getForUser(id,actor.userId);
    const after=await orders.cancelPending(id,actor.userId);
    if(before.status!==after.status)await audit(request,actor.userId,'ORDER_CANCELLED_BY_USER','ORDER',id,before,after);
    return {data:await withOrderDelivery(after)};
  });
  app.post('/api/v1/service-area-interests',async(request,reply)=>{
    const actor=requireActor(request,['USER','SUPER_ADMIN']);const input=createServiceAreaInterestSchema.parse(request.body);
    if(input.privacyVersion!==dependencies.config.PRIVACY_NOTICE_VERSION)throw new BusinessError('VALIDATION_ERROR','隐私说明已更新，请阅读并同意最新版本',400);
    const interest=await store.transaction(async(transactionStore)=>{await transactionStore.savePrivacyConsent(actor.userId,input.privacyVersion);const consent=await transactionStore.getPrivacyConsent(actor.userId,input.privacyVersion);if(!consent)throw new Error('privacy consent persistence failed');const value={id:crypto.randomUUID(),userId:actor.userId,regionText:input.regionText,contactName:input.contactName,contactPhone:input.contactPhone,privacyVersion:input.privacyVersion,privacyConsentedAt:consent.consentedAt,status:'NEW' as const,createdAt:new Date().toISOString()};await transactionStore.saveServiceAreaInterest(value);return value;});
    await audit(request,actor.userId,'SERVICE_AREA_INTEREST_SUBMITTED','SERVICE_AREA_INTEREST',interest.id,null,{...interest,contactPhone:'***',privacyVersion:input.privacyVersion});return reply.status(201).send({data:interest});
  });
  app.get('/api/v1/service-area-interests',async(request)=>{const actor=requireActor(request,['USER','SUPER_ADMIN']);return{data:await store.listServiceAreaInterestsByUser(actor.userId)};});
  app.post('/api/v1/orders/:id/after-sales',async(request,reply)=>{
    const actor=requireActor(request,['USER','SUPER_ADMIN']);const orderId=identifierSchema.parse((request.params as{id:string}).id);const order=await orders.getForUser(orderId,actor.userId);if(order.businessModelVersion==='PLATFORM_PROCUREMENT')throw new BusinessError('PARTIAL_REFUND_NOT_SUPPORTED','模式 B 订单请登记明细履约异常，不能进入历史整单售后',409);if(['PENDING_PAYMENT','CANCELLED','REFUNDED'].includes(order.status))throw new BusinessError('INVALID_STATE_TRANSITION','当前订单不能发起售后',409);const input=createAfterSaleSchema.parse(request.body);const duplicate=(await store.listAfterSalesByUser(actor.userId)).find((item)=>item.orderId===orderId&&['SUBMITTED','PROCESSING'].includes(item.status));if(duplicate)throw new BusinessError('IDEMPOTENCY_CONFLICT','该订单已有处理中售后申请',409);const now=new Date().toISOString();const afterSale={id:crypto.randomUUID(),userId:actor.userId,orderId,reason:input.reason,description:input.description,status:'SUBMITTED' as const,resolutionType:null,refundAmountCents:null,refundIds:[],resolvedBy:null,resolutionNote:null,resolvedAt:null,createdAt:now,updatedAt:now};await store.saveAfterSale(afterSale);await audit(request,actor.userId,'AFTER_SALE_SUBMITTED','AFTER_SALE',afterSale.id,null,afterSale);return reply.status(201).send({data:afterSale});
  });
  app.post('/api/v1/orders/:id/fulfillment-claims',async(request,reply)=>{const actor=requireActor(request,['USER','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const value=await platformProcurement.registerCustomerClaim(id,actor.userId,fulfillmentClaimSchema.parse(request.body),{requestId:request.id});return reply.status(201).send({data:value});});
  app.get('/api/v1/after-sales',async(request)=>{const actor=requireActor(request,['USER','SUPER_ADMIN']);return{data:await store.listAfterSalesByUser(actor.userId)};});
  app.get('/api/v1/notifications',async(request)=>{const actor=requireActor(request,['USER','SUPER_ADMIN']);return{data:await store.listOrderNotificationsByUser(actor.userId)};});
  app.post('/api/v1/notification-preferences',async(request)=>{const actor=requireActor(request,['USER','SUPER_ADMIN']);const value={userId:actor.userId,...notificationPreferenceSchema.parse(request.body),updatedAt:new Date().toISOString()};await store.saveNotificationPreference(value);await audit(request,actor.userId,'NOTIFICATION_PREFERENCE_UPDATED','NOTIFICATION_PREFERENCE',actor.userId,null,{types:value.types});return{data:value};});
  app.post('/api/v1/notifications/:id/read',async(request)=>{const actor=requireActor(request,['USER','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const notification=await store.getOrderNotification(id);if(!notification||notification.userId!==actor.userId)throw new BusinessError('RESOURCE_NOT_FOUND','通知不存在',404);if(!notification.readAt){notification.readAt=new Date().toISOString();await store.markOrderNotificationRead(id,notification.readAt);}return{data:notification};});
  app.post('/api/v1/orders/:id/mock-pay', async (request) => {
    if (dependencies.config.PAYMENT_PROVIDER !== 'mock') {
      throw new BusinessError('FORBIDDEN', '当前环境未启用模拟支付', 403);
    }
    const actor = requireActor(request, ['USER', 'SUPER_ADMIN']);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    await payments.confirmMock(id, actor.userId);
    return { data: await orders.getForUser(id, actor.userId) };
  });
  app.post('/api/v1/orders/:id/pay',async(request)=>{const actor=requireActor(request,['USER','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);return{data:await payments.initiate(id,actor.userId)};});
  app.post('/api/v1/payments/wechat/notify',{config:{rateLimit:{max:5000,timeWindow:'1 minute'}}},async(request,reply)=>{
    if(paymentProvider.name!=='wechat-platform')throw new BusinessError('FORBIDDEN','当前环境未启用微信支付',403);
    const header=(name:string):string|undefined=>{const value=request.headers[name];return typeof value==='string'?value:undefined;};
    const notification=paymentProvider.parseNotification(request.rawBody,{'wechatpay-timestamp':header('wechatpay-timestamp'),'wechatpay-nonce':header('wechatpay-nonce'),'wechatpay-signature':header('wechatpay-signature'),'wechatpay-serial':header('wechatpay-serial')});
    await payments.handleNotification(notification);return reply.status(204).send();
  });
  app.post('/api/v1/refunds/wechat/notify',{config:{rateLimit:{max:5000,timeWindow:'1 minute'}}},async(request,reply)=>{
    if(paymentProvider.name!=='wechat-platform')throw new BusinessError('FORBIDDEN','当前环境未启用微信支付',403);
    const header=(name:string):string|undefined=>{const value=request.headers[name];return typeof value==='string'?value:undefined;};
    const notification=paymentProvider.parseRefundNotification(request.rawBody,{'wechatpay-timestamp':header('wechatpay-timestamp'),'wechatpay-nonce':header('wechatpay-nonce'),'wechatpay-signature':header('wechatpay-signature'),'wechatpay-serial':header('wechatpay-serial')});
    await payments.handleRefundNotification(notification);return reply.status(204).send();
  });
  app.post('/api/v1/admin/dispatch-batches',async(request,reply)=>{requireActor(request,['FULFILLMENT','OPERATOR','SUPER_ADMIN']);const input=createDispatchBatchSchema.parse(request.body);return reply.status(201).send({data:await fulfillment.createBatch(input.campaignId)});});
  app.get('/api/v1/admin/dispatch-batches',async(request)=>{requireActor(request,['FULFILLMENT','OPERATOR','SUPER_ADMIN']);return{data:await store.listDispatchBatches()};});
  app.post('/api/v1/admin/dispatch-batches/:id/dispatch',async(request)=>{requireActor(request,['FULFILLMENT','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);return{data:await fulfillment.dispatch(id)};});
  app.post('/api/v1/pickup/batches/:id/receive',async(request)=>{requireActor(request,['FULFILLMENT','OPERATOR','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const input=receiveBatchSchema.parse(request.body);return{data:await fulfillment.receive(id,input.deliveryPlanId)};});
  app.get('/api/v1/pickup-code',async(request)=>{const actor=requireActor(request,['USER','SUPER_ADMIN']);const query=request.query as{orderId?:string};const orderId=identifierSchema.parse(query.orderId);return{data:await fulfillment.getCode(orderId,actor.userId)};});
  app.get('/api/v1/pickup/orders/lookup',async(request)=>{
    const actor=requireActor(request,['PICKUP_VERIFIER','FULFILLMENT','SUPER_ADMIN']);
    const query=pickupOrderLookupQuerySchema.parse(request.query);
    const plan=await store.getDeliveryPlan(query.deliveryPlanId);
    if(!plan||!plan.pickupPointId||plan.status!=='ARRIVED')throw new BusinessError('RESOURCE_NOT_FOUND','配送计划不存在或当前不可核销',404);
    const pickupPoint=(await store.listPickupPoints(plan.serviceAreaId)).find((item)=>item.id===plan.pickupPointId);
    if(!pickupPoint||pickupPoint.status!=='ACTIVE')throw new BusinessError('FORBIDDEN','当前自提点未启用，不能核销',403);
    const verifier=await store.getUser(actor.userId);
    if(!verifier||verifier.status!=='ACTIVE')throw new BusinessError('FORBIDDEN','当前核销人员不可用',403);
    if(!actor.roles.includes('SUPER_ADMIN')&&!(await store.hasActivePickupVerifierAssignment(actor.userId,plan.pickupPointId)))throw new BusinessError('FORBIDDEN','当前核销人员未获该自提点授权',403);
    const order=await store.getOrderByNo(query.orderNo);
    if(!order||order.deliveryPlanId!==plan.id||order.pickupPointId!==plan.pickupPointId)throw new BusinessError('RESOURCE_NOT_FOUND','未找到本领取点的订单',404);
    return {data:{id:order.id,orderNo:order.orderNo,deliveryPlanId:order.deliveryPlanId,status:order.status}};
  });
  app.post('/api/v1/pickup/verify',async(request)=>{const actor=requireActor(request,['PICKUP_VERIFIER','FULFILLMENT','SUPER_ADMIN']);const input=verifyPickupSchema.parse(request.body);return{data:await fulfillment.verify(input.orderId,input.deliveryPlanId,input.code,actor.userId,actor.roles.includes('SUPER_ADMIN'))};});
  app.get('/api/v1/admin/finance/ledger',async(request)=>{requireActor(request,['FINANCE','SUPER_ADMIN']);const query=request.query as{orderId?:string};return{data:await store.listLedgerTransactions(query.orderId)};});
  app.get('/api/v1/admin/finance/settlements',async(request)=>{requireActor(request,['FINANCE','SUPER_ADMIN']);const query=request.query as{orderId?:string};return{data:await store.listSettlements(query.orderId)};});
  app.get('/api/v1/admin/finance/refunds',async(request)=>{requireActor(request,['FINANCE','OPERATOR','SUPER_ADMIN']);return{data:await store.listRefunds(500)};});
  app.get('/api/v1/admin/orders',async(request)=>{requireActor(request,['OPERATOR','FULFILLMENT','FINANCE','SUPER_ADMIN']);const query=request.query as{orderNo?:string};if(query.orderNo){const value=await store.getOrderByNo(query.orderNo.trim());return{data:value?[value]:[]};}return{data:await store.listOrders(100)};});
  app.post('/api/v1/admin/orders/:id/refund',async(request)=>{const actor=requireActor(request,['FINANCE','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=await store.getOrder(id);if(before?.businessModelVersion==='PLATFORM_PROCUREMENT')throw new BusinessError('PARTIAL_REFUND_NOT_SUPPORTED','模式 B 订单只能从运营确认的履约异常执行退款',409);if((await store.listSettlements(id)).length)throw new BusinessError('SETTLEMENT_EXISTS','订单已生成结算单，不能自动退款，请转人工财务处理',409);await payments.requestFullRefund(id);const after=await store.getOrder(id);await audit(request,actor.userId,'ORDER_FULL_REFUND_REQUESTED','ORDER',id,before,after);return{data:after};});
  app.get('/api/v1/admin/audit-logs',async(request)=>{requireActor(request,['SUPER_ADMIN']);return{data:await store.listAuditLogs(500)};});
  app.get('/api/v1/admin/service-area-interests',async(request)=>{requireActor(request,['OPERATOR','CUSTOMER_SERVICE','SUPER_ADMIN']);return{data:await store.listServiceAreaInterests(500)};});
  app.post('/api/v1/admin/service-area-interests/:id/status',async(request)=>{const actor=requireActor(request,['OPERATOR','CUSTOMER_SERVICE','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=await store.getServiceAreaInterest(id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','开通意向不存在',404);const after={...before,status:updateServiceAreaInterestStatusSchema.parse(request.body).status};await store.saveServiceAreaInterest(after);await audit(request,actor.userId,'SERVICE_AREA_INTEREST_STATUS_UPDATED','SERVICE_AREA_INTEREST',id,before,{...after,contactPhone:'***'});return{data:after};});
  app.get('/api/v1/admin/after-sales',async(request)=>{requireActor(request,['OPERATOR','CUSTOMER_SERVICE','FINANCE','SUPER_ADMIN']);return{data:await store.listAfterSales(500)};});
  app.post('/api/v1/admin/after-sales/:id/status',async(request)=>{const actor=requireActor(request,['OPERATOR','CUSTOMER_SERVICE','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=await store.getAfterSale(id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','售后申请不存在',404);const input=updateAfterSaleStatusSchema.parse(request.body);if(['RESOLVED','REJECTED'].includes(before.status))return{data:before};if(input.status==='PROCESSING'&&before.status!=='SUBMITTED')throw new BusinessError('INVALID_STATE_TRANSITION','只有待受理售后可以进入处理中',409);if(input.status==='REJECTED'&&!input.resolutionNote)throw new BusinessError('VALIDATION_ERROR','驳回售后必须填写处理说明',400);const now=new Date().toISOString();const rejected=input.status==='REJECTED';const after={...before,status:input.status,resolutionType:rejected?('REJECTED' as const):before.resolutionType,resolvedBy:rejected?actor.userId:before.resolvedBy,resolutionNote:rejected?input.resolutionNote!:before.resolutionNote,resolvedAt:rejected?now:before.resolvedAt,updatedAt:now};await store.saveAfterSale(after);await audit(request,actor.userId,'AFTER_SALE_STATUS_UPDATED','AFTER_SALE',id,before,after);return{data:after};});
  app.post('/api/v1/admin/after-sales/:id/refund',async(request)=>{const actor=requireActor(request,['FINANCE','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const input=resolveAfterSaleRefundSchema.parse(request.body);const before=await store.getAfterSale(id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','售后申请不存在',404);if(before.status==='RESOLVED'&&before.resolutionType==='FULL_REFUND')return{data:before};if(before.status!=='PROCESSING')throw new BusinessError('INVALID_STATE_TRANSITION','只有处理中售后可以批准退款',409);const order=await store.getOrder(before.orderId);if(!order)throw new BusinessError('RESOURCE_NOT_FOUND','售后订单不存在',404);if(order.businessModelVersion==='PLATFORM_PROCUREMENT')throw new BusinessError('PARTIAL_REFUND_NOT_SUPPORTED','模式 B 订单不能走历史售后整单退款',409);if((await store.listSettlements(order.id)).length)throw new BusinessError('SETTLEMENT_EXISTS','订单已生成结算单，不能自动退款，请转人工财务处理',409);await payments.requestFullRefund(order.id);const refunds=await store.listRefundsByOrder(order.id);const now=new Date().toISOString();const after={...before,status:'RESOLVED' as const,resolutionType:'FULL_REFUND' as const,refundAmountCents:order.totalCents,refundIds:refunds.map((item)=>item.id),resolvedBy:actor.userId,resolutionNote:input.resolutionNote,resolvedAt:now,updatedAt:now};await store.saveAfterSale(after);await audit(request,actor.userId,'AFTER_SALE_FULL_REFUND_APPROVED','AFTER_SALE',id,before,after);return{data:after};});
  app.get('/api/v1/admin/notifications/manual',async(request)=>{requireActor(request,['OPERATOR','CUSTOMER_SERVICE','SUPER_ADMIN']);return{data:await store.listManualOrderNotifications(500)};});
  app.post('/api/v1/admin/notifications/:id/retry',async(request)=>{const actor=requireActor(request,['OPERATOR','CUSTOMER_SERVICE','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=await store.getOrderNotification(id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','通知不存在',404);const after=await notifications.retryPending(id);await audit(request,actor.userId,'ORDER_NOTIFICATION_DELIVERY_RETRIED','ORDER_NOTIFICATION',id,before,after);return{data:after};});
  app.post('/api/v1/admin/notifications/:id/manual-completed',async(request)=>{const actor=requireActor(request,['OPERATOR','CUSTOMER_SERVICE','SUPER_ADMIN']);const id=identifierSchema.parse((request.params as{id:string}).id);const before=await store.getOrderNotification(id);if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','通知不存在',404);await store.markOrderNotificationManualCompleted(id);const after=await store.getOrderNotification(id);await audit(request,actor.userId,'ORDER_NOTIFICATION_MANUAL_COMPLETED','ORDER_NOTIFICATION',id,before,after);return{data:after};});

  return app;
}
