import { moneyCents, type MoneyCents } from '@hometown/domain';
import type { AdminCredential, AfterSale, AuditLog, AuthSession, Campaign, CampaignItemSnapshot, CommunityCampaignItem, CommunityDeliveryConfirmation, CommunityPickupReceipt, DeliveryPlan, DispatchBatch, FulfillmentAllocation, FulfillmentException, GoodsReceipt, InternalStaff, InventoryBalance, InventoryLot, InventoryMovement, LedgerTransaction, Merchant, NotificationPreference, Order, OrderNotification, OutboundOrder, Payment, PickupCredential, PickupHandover, PickupPoint, PickupVerifierAssignment, PlatformCampaignItem, PlatformPartialRefund, PlatformRefund, PlatformSalesLine, PlatformSku, PrivacyConsent, Product, PurchaseOrder, Refund, Role, ServiceArea, ServiceAreaInterest, Settlement, SortingTask, StaffPickupPointAssignment, Supplier, SupplierPayable, SupplierQualification, SupplierSkuOffer, Sku, User, Warehouse } from './types.js';
import type { PlatformStore } from '../platform/platform-store.js';

export interface IdempotencyRecord {
  fingerprint: string;
  orderId: string;
}

export interface CommerceStore extends PlatformStore {
  transaction<T>(work: (store: CommerceStore) => Promise<T>): Promise<T>;
  health(): Promise<'ok'>;
  close(): Promise<void>;
  listCampaigns(): Promise<Campaign[]>;
  getCampaign(id: string): Promise<Campaign | null>;
  getCampaignForUpdate(id: string): Promise<Campaign | null>;
  saveCampaign(campaign: Campaign): Promise<void>;
  updateCampaign(campaign: Campaign, expectedVersion: number): Promise<boolean>;
  replaceCampaignItems(campaign: Campaign): Promise<void>;
  getSku(id: string): Promise<Sku | null>;
  getSkuForUpdate(id: string): Promise<Sku | null>;
  getCampaignSku(campaignId: string, skuId: string): Promise<Sku | null>;
  reserveCampaignSkuStock(campaignId: string, skuId: string, quantity: number): Promise<boolean>;
  releaseCampaignSkuStock(campaignId: string, skuId: string, quantity: number): Promise<boolean>;
  listOrdersByCampaign(campaignId: string): Promise<Order[]>;
  listOrdersByUser(userId: string): Promise<Order[]>;
  listOrders(limit:number):Promise<Order[]>;
  listExpiredPendingOrders(now:string,limit:number):Promise<Order[]>;
  listSettlementEligibleOrders(now:string,limit:number):Promise<Order[]>;
  getOrder(id: string): Promise<Order | null>;
  getOrderForUpdate(id: string): Promise<Order | null>;
  getOrderByNo(orderNo:string):Promise<Order|null>;
  getOrderByNoForUpdate(orderNo:string):Promise<Order|null>;
  saveOrder(order: Order): Promise<void>;
  saveOrderStatus(order: Order): Promise<void>;
  transitionOrderStatus(orderId:string, expectedStatuses:Order['status'][], nextStatus:Order['status'], paidAt?:string|null):Promise<boolean>;
  cancelPendingOrder(orderId: string): Promise<boolean>;
  markPendingOrderPaid(orderId: string, paidAt: string): Promise<boolean>;
  getIdempotency(actorId: string, key: string): Promise<IdempotencyRecord | null>;
  getIdempotencyForUpdate(actorId: string, key: string): Promise<IdempotencyRecord | null>;
  saveIdempotency(actorId: string, key: string, record: IdempotencyRecord): Promise<void>;
  listMerchants(): Promise<Merchant[]>; saveMerchant(value:Merchant):Promise<void>; deleteMerchant(id:string):Promise<boolean>;
  listProducts(): Promise<Product[]>; saveProduct(value:Product):Promise<void>;
  updateProductStatus(id:string,status:Product['status']):Promise<boolean>; deleteProduct(id:string):Promise<boolean>;
  listServiceAreas(): Promise<ServiceArea[]>; saveServiceArea(value:ServiceArea):Promise<void>; updateServiceAreaOrderEnabled(id:string,orderEnabled:boolean):Promise<boolean>;
  listPickupPoints(serviceAreaId?:string): Promise<PickupPoint[]>; savePickupPoint(value:PickupPoint):Promise<void>;
  getDeliveryPlan(id:string):Promise<DeliveryPlan|null>; getDeliveryPlanByCampaign(campaignId:string):Promise<DeliveryPlan|null>; listDeliveryPlans():Promise<DeliveryPlan[]>; saveDeliveryPlan(value:DeliveryPlan):Promise<void>;
  getDispatchBatch(id:string):Promise<DispatchBatch|null>; listDispatchBatches():Promise<DispatchBatch[]>; saveDispatchBatch(value:DispatchBatch):Promise<void>;
  getPickupCredential(orderId:string):Promise<PickupCredential|null>; savePickupCredential(value:PickupCredential):Promise<void>;
  pickupRecordExists(orderId:string):Promise<boolean>; savePickupRecord(orderId:string,deliveryPlanId:string,verifierId:string):Promise<void>;
  grantPickupVerifier(userId:string,pickupPointId:string):Promise<void>; revokePickupVerifier(userId:string,pickupPointId:string):Promise<void>; hasActivePickupVerifierAssignment(userId:string,pickupPointId:string):Promise<boolean>; listPickupVerifierAssignments(userId?:string):Promise<PickupVerifierAssignment[]>;
  /** New staff-point authorization. Falls back to legacy verifier events only for non-staff accounts. */
  hasActivePickupPointAssignment(userId:string,pickupPointId:string):Promise<boolean>;
  findUserByWechatOpenId(openId:string):Promise<User|null>; saveUser(value:User):Promise<void>;
  getUser(id:string):Promise<User|null>;
  savePrivacyConsent(userId:string,documentVersion:string):Promise<void>; getPrivacyConsent(userId:string,documentVersion:string):Promise<PrivacyConsent|null>;
  findAdminCredential(username:string):Promise<AdminCredential|null>; findAdminCredentialByUserId(userId:string):Promise<AdminCredential|null>; saveAdminCredential(value:AdminCredential):Promise<void>; saveUserRole(userId:string,role:Role):Promise<void>; replaceUserRoles(userId:string,roles:Role[]):Promise<void>;
  getInternalStaff(userId:string):Promise<InternalStaff|null>; listInternalStaff(query?:string):Promise<InternalStaff[]>; saveInternalStaff(value:InternalStaff):Promise<void>;
  listStaffPickupPointAssignments(staffUserId?:string):Promise<StaffPickupPointAssignment[]>; replaceStaffPickupPointAssignments(staffUserId:string,assignments:StaffPickupPointAssignment[]):Promise<void>;
  getAuthSession(tokenHash:string):Promise<AuthSession|null>; saveAuthSession(value:AuthSession):Promise<void>;
  deleteAuthSession(tokenHash:string):Promise<void>; deleteAuthSessionsByUser(userId:string):Promise<void>;
  getPaymentByOrder(orderId:string):Promise<Payment|null>; getPaymentByOrderForUpdate(orderId:string):Promise<Payment|null>; savePayment(value:Payment):Promise<void>; savePaymentIfStatus(value:Payment, expectedStatuses:Payment['status'][]):Promise<boolean>;
  /** Atomically claims a new or expired provider-initiation lease for this payment. */
  claimPaymentInitiation(value:Payment,leaseUntil:string,now:string,claimToken:string):Promise<boolean>;
  /** Persists a provider result only for the worker that still owns its lease. */
  savePaymentIfInitiationClaimed(value:Payment,claimToken:string):Promise<boolean>;
  /**
   * Atomically reserves a provider callback event inside the caller's transaction.
   * A false result means another delivery has already claimed it.
   */
  claimPaymentCallback(provider:Payment['provider'],eventId:string,type:string,bodyHash:string):Promise<boolean>;
  listRefundsByOrder(orderId:string):Promise<Refund[]>; getRefundByProviderNo(providerRefundNo:string):Promise<Refund|null>; saveRefund(value:Refund):Promise<void>;
  /**
   * Claims submission or recovery work. The caller's token fences any late
   * provider response from a previous lease holder.
   */
  claimRefundSubmission(refundId:string,leaseUntil:string,now:string,claimToken:string):Promise<boolean>;
  saveRefundIfClaimed(value:Refund,claimToken:string):Promise<boolean>;
  /** Saves a query result only while no submitter owns the refund. */
  saveRefundIfUnclaimed(value:Refund,now:string):Promise<boolean>;
  saveRefundIfStatus(value:Refund,expectedStatuses:Refund['status'][]):Promise<boolean>;
  listRefunds(limit:number):Promise<Refund[]>;
  listPendingRefunds(limit:number):Promise<Refund[]>;
  listRefundingOrders(limit:number):Promise<Order[]>;
  appendLedgerTransaction(value:LedgerTransaction):Promise<boolean>; listLedgerTransactions(referenceId?:string):Promise<LedgerTransaction[]>;
  listSettlements(orderId?:string):Promise<Settlement[]>; listPendingSettlements(limit:number):Promise<Settlement[]>; saveSettlement(value:Settlement):Promise<void>;
  saveAuditLog(value:AuditLog):Promise<void>; findLatestAudit(resourceType:string,resourceId:string,action:string):Promise<AuditLog|null>; listAuditLogs(limit:number):Promise<AuditLog[]>;
  saveServiceAreaInterest(value:ServiceAreaInterest):Promise<void>; getServiceAreaInterest(id:string):Promise<ServiceAreaInterest|null>; listServiceAreaInterests(limit:number):Promise<ServiceAreaInterest[]>; listServiceAreaInterestsByUser(userId:string):Promise<ServiceAreaInterest[]>;
  saveAfterSale(value:AfterSale):Promise<void>; getAfterSale(id:string):Promise<AfterSale|null>; listAfterSales(limit:number):Promise<AfterSale[]>; listAfterSalesByUser(userId:string):Promise<AfterSale[]>; hasOpenAfterSaleForOrder(orderId:string):Promise<boolean>;
  createOrderNotificationIfAbsent(value:OrderNotification):Promise<boolean>; saveOrderNotification(value:OrderNotification):Promise<void>; saveOrderNotificationIfClaimed(value:OrderNotification,claimToken:string):Promise<boolean>; getOrderNotification(id:string):Promise<OrderNotification|null>; listOrderNotificationsByUser(userId:string):Promise<OrderNotification[]>; listManualOrderNotifications(limit:number):Promise<OrderNotification[]>; claimPendingOrderNotifications(limit:number,leaseUntil:string,now:string,claimToken:string):Promise<OrderNotification[]>; markOrderNotificationRead(id:string,readAt:string):Promise<void>; requeuePendingOrderNotification(id:string,now:string):Promise<OrderNotification|null>; markOrderNotificationManualCompleted(id:string):Promise<void>; saveNotificationPreference(value:NotificationPreference):Promise<void>; getNotificationPreference(userId:string):Promise<NotificationPreference|null>;
}

export class MemoryStore implements CommerceStore {
  private readonly campaigns = new Map<string, Campaign>();
  private readonly orders = new Map<string, Order>();
  private readonly skus = new Map<string, Sku>();
  private readonly campaignSkus = new Map<string, CampaignItemSnapshot>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly merchants = new Map<string, Merchant>(); private readonly products = new Map<string, Product>();
  private readonly serviceAreas = new Map<string, ServiceArea>(); private readonly pickupPoints = new Map<string, PickupPoint>();
  private readonly deliveryPlans = new Map<string, DeliveryPlan>();
  private readonly batches = new Map<string,DispatchBatch>(); private readonly pickupCredentials = new Map<string,PickupCredential>(); private readonly pickupRecords = new Set<string>(); private readonly pickupVerifierAssignments:PickupVerifierAssignment[]=[];
  private readonly usersByOpenId = new Map<string,User>(); private readonly usersById = new Map<string,User>(); private readonly sessions = new Map<string,AuthSession>();
  private readonly privacyConsents = new Map<string,PrivacyConsent>();
  private readonly adminCredentials = new Map<string,AdminCredential>(); private readonly userRoles = new Map<string,Set<Role>>();
  private readonly internalStaff = new Map<string,InternalStaff>(); private readonly staffPickupPointAssignments = new Map<string,StaffPickupPointAssignment>();
  private readonly payments = new Map<string,Payment>(); private readonly paymentCallbacks = new Set<string>();
  // The in-memory adapter serializes transactions for tests. Track callback
  // claims per transaction so a thrown handler mirrors MySQL rollback semantics.
  private readonly paymentCallbackClaimScopes: Set<string>[] = [];
  private readonly refunds = new Map<string,Refund>();
  private readonly platformRefunds = new Map<string, PlatformRefund>(); private readonly platformPartialRefunds = new Map<string,PlatformPartialRefund>();
  private readonly warehouses = new Map<string, Warehouse>(); private readonly suppliers = new Map<string, Supplier>(); private readonly supplierQualifications = new Map<string, SupplierQualification>();
  private readonly platformSkus = new Map<string, PlatformSku>(); private readonly supplierOffers = new Map<string, SupplierSkuOffer>(); private readonly campaignPlatformItems = new Map<string, PlatformCampaignItem>(); private readonly communityCampaignItems=new Map<string,CommunityCampaignItem>();
  private readonly salesOrderItems = new Map<string, Array<{ id:string;platformSkuId: string; productId: string; title: string; skuName: string; quantity: number; unitPriceCents: number; purchaseUnitCents: number; amountCents: number;fulfilledQuantity:number;pickedUpQuantity:number;exceptionQuantity:number;refundedQuantity:number;refundedAmountCents:number }>>();
  private readonly purchaseOrders = new Map<string, PurchaseOrder>(); private readonly goodsReceipts = new Map<string, GoodsReceipt>(); private readonly inventoryLots = new Map<string, InventoryLot>(); private readonly inventoryMovements: InventoryMovement[] = [];
  private readonly supplierPayables = new Map<string, SupplierPayable>(); private readonly sortingTasks = new Map<string, SortingTask>(); private readonly outboundOrders = new Map<string, OutboundOrder>(); private readonly pickupHandovers = new Map<string, PickupHandover>(); private readonly fulfillmentExceptions = new Map<string,FulfillmentException>(); private readonly fulfillmentAllocations = new Map<string,FulfillmentAllocation>();
  private readonly communityDeliveries=new Map<string,CommunityDeliveryConfirmation>(); private readonly communityPickupReceipts=new Map<string,CommunityPickupReceipt>();
  private readonly ledgerTransactions = new Map<string,LedgerTransaction>();
  private readonly settlements = new Map<string,Settlement>();
  private readonly auditLogs:AuditLog[]=[];
  private readonly serviceAreaInterests = new Map<string,ServiceAreaInterest>(); private readonly afterSales = new Map<string,AfterSale>(); private readonly orderNotifications = new Map<string,OrderNotification>(); private readonly notificationPreferences = new Map<string,NotificationPreference>();
  private transactionTail: Promise<void> = Promise.resolve();

  public constructor(seed = true) {
    if (!seed) return;
    this.skus.set('sku-demo-001', {
      id: 'sku-demo-001', productId: 'product-demo-001', merchantId: 'merchant-demo-001',
      name: '家乡风味手工米粉（常温预包装）', unitPriceCents: moneyCents(2_980),
      stock: 2_000, soldQuantity: 0, commissionRateBps: 800,
    });
    this.skus.set('sku-demo-002', {
      id: 'sku-demo-002', productId: 'product-demo-002', merchantId: 'merchant-demo-001',
      name: '高碑店豆腐丝（300g / 袋）', unitPriceCents: moneyCents(1_980),
      stock: 1_600, soldQuantity: 36, commissionRateBps: 800,
    });
    const now = Date.now();
    this.usersById.set('demo-super-admin', { id: 'demo-super-admin', wechatOpenId: null, status: 'ACTIVE', createdAt: new Date(now).toISOString() });
    this.merchants.set('merchant-demo-001',{id:'merchant-demo-001',name:'家乡风味示例商户',status:'ACTIVE',defaultCommissionBps:800,wechatSubMchid:null,createdAt:new Date(now).toISOString()});
    this.products.set('product-demo-001',{id:'product-demo-001',merchantId:'merchant-demo-001',title:'家乡风味手工米粉',category:'米面粮油',origin:'江西赣南',imageUrl:'/assets/product-rice-noodles.jpg',storageType:'NORMAL_TEMPERATURE',status:'APPROVED',sku:this.skus.get('sku-demo-001')!,createdAt:new Date(now).toISOString()});
    this.products.set('product-demo-002',{id:'product-demo-002',merchantId:'merchant-demo-001',title:'高碑店豆腐丝',category:'熟食豆制品',origin:'河北保定',imageUrl:'/assets/product-tofu-strips.jpg',storageType:'NORMAL_TEMPERATURE',status:'APPROVED',sku:this.skus.get('sku-demo-002')!,createdAt:new Date(now).toISOString()});
    this.serviceAreas.set('service-bd-lianchi',{id:'service-bd-lianchi',regionCode:'130606',name:'莲池区',status:'ENABLED',orderEnabled:true,createdAt:new Date(now).toISOString()});
    this.pickupPoints.set('pickup-demo-001',{id:'pickup-demo-001',serviceAreaId:'service-bd-lianchi',name:'莲池家乡味自提点',address:'保定市莲池区示范路 88 号',status:'ACTIVE',capacityPerDay:500,operationMode:'SELF_OPERATED',responsibilityOwner:null,siteLeadName:null,siteLeadPhone:null,createdAt:new Date(now).toISOString()});
    this.campaigns.set('campaign-demo-001', {
      id: 'campaign-demo-001', title: '赣南米粉与客家风味 · 保定莲池区', serviceAreaId: 'service-bd-lianchi',
      cutoffAt: new Date(now + 3 * 86_400_000).toISOString(),
      dispatchAt: new Date(now + 5 * 86_400_000).toISOString(), minTotalQuantity: 20,
      failureAction: 'CANCEL_AND_REFUND', skuIds: ['sku-demo-001','sku-demo-002'],
      items: [
        { skuId:'sku-demo-001',productId:'product-demo-001',merchantId:'merchant-demo-001',title:'家乡风味手工米粉',category:'米面粮油',skuName:'家乡风味手工米粉（常温预包装）',origin:'江西赣南',imageUrl:'/assets/product-rice-noodles.jpg',unitPriceCents:moneyCents(2_980),stock:1_000,soldQuantity:0,commissionRateBps:800 },
        { skuId:'sku-demo-002',productId:'product-demo-002',merchantId:'merchant-demo-001',title:'高碑店豆腐丝',category:'熟食豆制品',skuName:'高碑店豆腐丝（300g / 袋）',origin:'河北保定',imageUrl:'/assets/product-tofu-strips.jpg',unitPriceCents:moneyCents(1_980),stock:800,soldQuantity:36,commissionRateBps:800 },
      ],
      businessModelVersion:'LEGACY_MARKETPLACE',warehouseId:null,platformItems:[],status: 'OPEN', version: 1, createdAt: new Date(now).toISOString(),
    });
    this.deliveryPlans.set('delivery-plan-demo-001', {
      id:'delivery-plan-demo-001',campaignId:'campaign-demo-001',serviceAreaId:'service-bd-lianchi',pickupPointId:'pickup-demo-001',status:'SITE_CONFIRMED',
      siteName:'莲池家乡味自提点',address:'保定市莲池区示范路 88 号',arrivalStartAt:null,arrivalEndAt:null,contactName:null,contactPhone:null,vehicleOrderNo:null,driverName:null,driverPhone:null,vehiclePlate:null,
      remark:'固定自提点',confirmedAt:new Date(now).toISOString(),bookedAt:null,dispatchedAt:null,arrivedAt:null,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),
    });
    for (const item of this.campaigns.get('campaign-demo-001')!.items) this.campaignSkus.set(`campaign-demo-001:${item.skuId}`, structuredClone(item));
  }

  /**
   * Keep the test adapter's transaction semantics aligned with MySQL.  This is
   * deliberately generic so newly added domain maps participate in rollback
   * automatically; promises and other coordination primitives are excluded.
   */
  private snapshotTransactionState(): Map<string, unknown> {
    const state = this as unknown as Record<string, unknown>;
    const snapshot = new Map<string, unknown>();
    for (const key of Object.keys(state)) {
      const value = state[key];
      if (value instanceof Map || value instanceof Set || Array.isArray(value)) snapshot.set(key, structuredClone(value));
    }
    return snapshot;
  }

  private restoreTransactionState(snapshot: Map<string, unknown>): void {
    const state = this as unknown as Record<string, unknown>;
    for (const [key, saved] of snapshot) {
      const current = state[key];
      if (current instanceof Map && saved instanceof Map) {
        current.clear();
        for (const [entryKey, entryValue] of saved) current.set(entryKey, structuredClone(entryValue));
      } else if (current instanceof Set && saved instanceof Set) {
        current.clear();
        for (const entryValue of saved) current.add(structuredClone(entryValue));
      } else if (Array.isArray(current) && Array.isArray(saved)) {
        current.splice(0, current.length, ...structuredClone(saved));
      }
    }
  }

  public async transaction<T>(work: (store: CommerceStore) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release = (): void => undefined;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = this.snapshotTransactionState();
    const callbackClaims=new Set<string>();
    this.paymentCallbackClaimScopes.push(callbackClaims);
    let rolledBack = false;
    try { return await work(this); }
    catch(error){
      rolledBack = true;
      this.restoreTransactionState(snapshot);
      throw error;
    }
    finally {
      if (!rolledBack) this.paymentCallbackClaimScopes.pop();
      release();
    }
  }
  public async health(): Promise<'ok'> { return 'ok'; }
  public async close(): Promise<void> {}
  private campaignWithLiveInventory(value: Campaign): Campaign {
    const copy = structuredClone(value);
    copy.items = copy.items.map((item) => structuredClone(this.campaignSkus.get(`${copy.id}:${item.skuId}`) ?? item));
    copy.platformItems = copy.platformItems.map((item) => structuredClone(this.campaignPlatformItems.get(`${copy.id}:${item.platformSkuId}`) ?? item));
    return copy;
  }
  public async listCampaigns(): Promise<Campaign[]> { return [...this.campaigns.values()].map((value) => this.campaignWithLiveInventory(value)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  public async getCampaign(id: string): Promise<Campaign | null> { const value = this.campaigns.get(id); return value ? this.campaignWithLiveInventory(value) : null; }
  public async getCampaignForUpdate(id: string): Promise<Campaign | null> { return this.getCampaign(id); }
  public async saveCampaign(campaign: Campaign): Promise<void> {
    if (this.campaigns.has(campaign.id)) throw new Error(`Campaign ${campaign.id} already exists`);
    this.campaigns.set(campaign.id, structuredClone(campaign));
    for (const item of campaign.items) this.campaignSkus.set(`${campaign.id}:${item.skuId}`, structuredClone(item));
  }
  public async updateCampaign(campaign: Campaign, expectedVersion: number): Promise<boolean> {
    const current = this.campaigns.get(campaign.id);
    if (!current || current.version !== expectedVersion) return false;
    this.campaigns.set(campaign.id, structuredClone(campaign));
    return true;
  }
  public async replaceCampaignItems(campaign: Campaign): Promise<void> {
    for (const key of [...this.campaignSkus.keys()]) if (key.startsWith(`${campaign.id}:`)) this.campaignSkus.delete(key);
    for (const item of campaign.items) this.campaignSkus.set(`${campaign.id}:${item.skuId}`, structuredClone(item));
  }
  public async getSku(id: string): Promise<Sku | null> {
    const value = this.skus.get(id);
    if (!value) return null;
    const product = this.products.get(value.productId);
    const merchant = this.merchants.get(value.merchantId);
    if (!product || product.status !== 'APPROVED' || !merchant || merchant.status !== 'ACTIVE') return null;
    return structuredClone(value);
  }
  public async getSkuForUpdate(id: string): Promise<Sku | null> { return this.getSku(id); }
  public async getCampaignSku(campaignId: string, skuId: string): Promise<Sku | null> {
    const campaignSku = this.campaignSkus.get(`${campaignId}:${skuId}`);
    if (!campaignSku) return null;
    return { id:campaignSku.skuId,productId:campaignSku.productId,merchantId:campaignSku.merchantId,name:campaignSku.skuName,unitPriceCents:campaignSku.unitPriceCents,stock:campaignSku.stock,soldQuantity:campaignSku.soldQuantity,commissionRateBps:campaignSku.commissionRateBps };
  }
  public async reserveCampaignSkuStock(campaignId: string, skuId: string, quantity: number): Promise<boolean> {
    const sku = this.skus.get(skuId);
    const campaignSku = this.campaignSkus.get(`${campaignId}:${skuId}`);
    if (!sku || !campaignSku || campaignSku.stock - campaignSku.soldQuantity < quantity || sku.stock - sku.soldQuantity < quantity) return false;
    campaignSku.soldQuantity += quantity;
    sku.soldQuantity += quantity;
    return true;
  }
  public async releaseCampaignSkuStock(campaignId: string, skuId: string, quantity: number): Promise<boolean> {
    const sku = this.skus.get(skuId);
    const campaignSku = this.campaignSkus.get(`${campaignId}:${skuId}`);
    if (!sku || !campaignSku || campaignSku.soldQuantity < quantity || sku.soldQuantity < quantity) return false;
    campaignSku.soldQuantity -= quantity;
    sku.soldQuantity -= quantity;
    return true;
  }
  public async listOrdersByCampaign(campaignId: string): Promise<Order[]> { return [...this.orders.values()].filter((order) => order.campaignId === campaignId).map((order)=>structuredClone(order)); }
  public async listOrdersByUser(userId: string): Promise<Order[]> { return [...this.orders.values()].filter((order) => order.userId === userId).map((order) => structuredClone(order)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
  public async listOrders(limit:number):Promise<Order[]>{return[...this.orders.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit).map((order)=>structuredClone(order));}
  public async listExpiredPendingOrders(now:string,limit:number):Promise<Order[]>{return[...this.orders.values()].filter((order)=>order.status==='PENDING_PAYMENT'&&order.expiresAt<=now).slice(0,limit).map((order)=>structuredClone(order));}
  public async listSettlementEligibleOrders(now:string,limit:number):Promise<Order[]>{return[...this.orders.values()].filter((order)=>order.status==='PICKED_UP'&&order.pickedUpAt!==null&&Date.parse(order.pickedUpAt)+7*86_400_000<=Date.parse(now)).sort((a,b)=>(a.pickedUpAt??'').localeCompare(b.pickedUpAt??'')).slice(0,Math.max(1,limit)).map((order)=>structuredClone(order));}
  public async getOrder(id: string): Promise<Order | null> { const value=this.orders.get(id);if(!value)return null;const order=structuredClone(value);if(order.businessModelVersion!=='LEGACY_MARKETPLACE')order.items=(this.salesOrderItems.get(id)??[]).map((item)=>({salesOrderItemId:item.id,skuId:item.platformSkuId,productId:item.productId,merchantId:null,name:item.skuName,quantity:item.quantity,unitPriceCents:moneyCents(item.unitPriceCents),amountCents:moneyCents(item.amountCents),commissionRateBps:0,commissionCents:moneyCents(0),purchaseUnitCents:moneyCents(item.purchaseUnitCents),fulfilledQuantity:item.fulfilledQuantity,pickedUpQuantity:item.pickedUpQuantity,exceptionQuantity:item.exceptionQuantity,refundedQuantity:item.refundedQuantity,refundedAmountCents:moneyCents(item.refundedAmountCents)}));return order; }
  public async getOrderForUpdate(id: string): Promise<Order | null> { return this.getOrder(id); }
  public async getOrderByNo(orderNo:string):Promise<Order|null>{const value=[...this.orders.values()].find((order)=>order.orderNo===orderNo);return value?structuredClone(value):null;}
  public async getOrderByNoForUpdate(orderNo:string):Promise<Order|null>{return this.getOrderByNo(orderNo);}
  public async saveOrder(order: Order): Promise<void> { this.orders.set(order.id, structuredClone(order)); }
  public async saveOrderStatus(order: Order): Promise<void> { this.orders.set(order.id, structuredClone(order)); }
  public async transitionOrderStatus(orderId:string,expectedStatuses:Order['status'][],nextStatus:Order['status'],paidAt?:string|null):Promise<boolean>{const order=this.orders.get(orderId);if(!order||!expectedStatuses.includes(order.status))return false;order.status=nextStatus;if(paidAt!==undefined)order.paidAt=paidAt;this.orders.set(orderId,structuredClone(order));return true;}
  public async cancelPendingOrder(orderId:string):Promise<boolean>{const order=this.orders.get(orderId);if(!order||order.status!=='PENDING_PAYMENT')return false;order.status='CANCELLED';this.orders.set(orderId,structuredClone(order));return true;}
  public async markPendingOrderPaid(orderId:string,paidAt:string):Promise<boolean>{const order=this.orders.get(orderId);if(!order||order.status!=='PENDING_PAYMENT')return false;order.status='PAID_WAITING_CLOSE';order.paidAt=paidAt;this.orders.set(orderId,structuredClone(order));return true;}
  public async getIdempotency(actorId: string, key: string): Promise<IdempotencyRecord | null> { const value=this.idempotency.get(`${actorId}:${key}`);return value?structuredClone(value):null; }
  public async getIdempotencyForUpdate(actorId: string, key: string): Promise<IdempotencyRecord | null> { return this.getIdempotency(actorId,key); }
  public async saveIdempotency(actorId: string, key: string, record: IdempotencyRecord): Promise<void> { this.idempotency.set(`${actorId}:${key}`, record); }
  public async getPlatformRefundByOrder(orderId:string):Promise<PlatformRefund|null>{const value=[...this.platformRefunds.values()].find((item)=>item.orderId===orderId);return value?structuredClone(value):null;} public async getPlatformRefundByProviderNo(providerRefundNo:string):Promise<PlatformRefund|null>{const value=[...this.platformRefunds.values()].find((item)=>item.providerRefundNo===providerRefundNo);return value?structuredClone(value):null;} public async savePlatformRefund(value:PlatformRefund):Promise<void>{this.platformRefunds.set(value.id,structuredClone(value));} public async claimPlatformRefundSubmission(id:string,leaseUntil:string,now:string,token:string):Promise<boolean>{const value=this.platformRefunds.get(id);if(!value||!['CREATED','FAILED','PROCESSING'].includes(value.status)||(value.status==='PROCESSING'&&value.submissionLeaseUntil===null)||(value.submissionLeaseUntil!==null&&value.submissionLeaseUntil>now))return false;value.status='PROCESSING';value.submissionLeaseUntil=leaseUntil;value.submissionClaimToken=token;this.platformRefunds.set(id,structuredClone(value));return true;} public async savePlatformRefundIfClaimed(value:PlatformRefund,token:string):Promise<boolean>{const current=this.platformRefunds.get(value.id);if(!current||current.submissionClaimToken!==token)return false;this.platformRefunds.set(value.id,structuredClone(value));return true;} public async savePlatformRefundIfUnclaimed(value:PlatformRefund,now:string):Promise<boolean>{const current=this.platformRefunds.get(value.id);if(!current||current.submissionClaimToken!==null||(current.submissionLeaseUntil!==null&&current.submissionLeaseUntil>now))return false;this.platformRefunds.set(value.id,structuredClone(value));return true;} public async savePlatformRefundIfStatus(value:PlatformRefund,statuses:PlatformRefund['status'][]):Promise<boolean>{const current=this.platformRefunds.get(value.id);if(!current||!statuses.includes(current.status))return false;this.platformRefunds.set(value.id,structuredClone(value));return true;} public async listPendingPlatformRefunds(limit:number):Promise<PlatformRefund[]>{return [...this.platformRefunds.values()].filter((item)=>['CREATED','PROCESSING','FAILED'].includes(item.status)).slice(0,limit).map((item)=>structuredClone(item));}
  public async getPlatformPartialRefund(id:string):Promise<PlatformPartialRefund|null>{const value=this.platformPartialRefunds.get(id);return value?structuredClone(value):null;}
  public async getPlatformPartialRefundByProviderNo(no:string):Promise<PlatformPartialRefund|null>{const value=[...this.platformPartialRefunds.values()].find((item)=>item.providerRefundNo===no);return value?structuredClone(value):null;} public async listPlatformPartialRefundsByOrder(orderId:string):Promise<PlatformPartialRefund[]>{return [...this.platformPartialRefunds.values()].filter((item)=>item.orderId===orderId).map((item)=>structuredClone(item));} public async listPlatformPartialRefundsByException(exceptionId:string):Promise<PlatformPartialRefund[]>{return [...this.platformPartialRefunds.values()].filter((item)=>item.exceptionId===exceptionId).map((item)=>structuredClone(item));} public async savePlatformPartialRefund(value:PlatformPartialRefund):Promise<void>{this.platformPartialRefunds.set(value.id,structuredClone(value));} public async claimPlatformPartialRefundSubmission(id:string,lease:string,now:string,token:string):Promise<boolean>{const value=this.platformPartialRefunds.get(id);if(!value||!['CREATED','FAILED','PROCESSING'].includes(value.status)||(value.status==='PROCESSING'&&value.submissionLeaseUntil===null)||(value.submissionLeaseUntil!==null&&value.submissionLeaseUntil>now))return false;value.status='PROCESSING';value.submissionLeaseUntil=lease;value.submissionClaimToken=token;return true;} public async savePlatformPartialRefundIfClaimed(value:PlatformPartialRefund,token:string):Promise<boolean>{const current=this.platformPartialRefunds.get(value.id);if(!current||current.submissionClaimToken!==token)return false;this.platformPartialRefunds.set(value.id,structuredClone(value));return true;} public async savePlatformPartialRefundIfUnclaimed(value:PlatformPartialRefund,now:string):Promise<boolean>{const current=this.platformPartialRefunds.get(value.id);if(!current||current.submissionClaimToken!==null||(current.submissionLeaseUntil!==null&&current.submissionLeaseUntil>now))return false;this.platformPartialRefunds.set(value.id,structuredClone(value));return true;} public async savePlatformPartialRefundIfStatus(value:PlatformPartialRefund,statuses:PlatformPartialRefund['status'][]):Promise<boolean>{const current=this.platformPartialRefunds.get(value.id);if(!current||!statuses.includes(current.status))return false;this.platformPartialRefunds.set(value.id,structuredClone(value));return true;} public async listPendingPlatformPartialRefunds(limit:number):Promise<PlatformPartialRefund[]>{return [...this.platformPartialRefunds.values()].filter((item)=>['CREATED','PROCESSING','FAILED'].includes(item.status)).slice(0,limit).map((item)=>structuredClone(item));}
  public async listWarehouses():Promise<Warehouse[]>{return [...this.warehouses.values()].map((item)=>structuredClone(item));} public async getWarehouse(id:string):Promise<Warehouse|null>{const value=this.warehouses.get(id);return value?structuredClone(value):null;} public async saveWarehouse(value:Warehouse):Promise<void>{this.warehouses.set(value.id,structuredClone(value));}
  public async listSuppliers():Promise<Supplier[]>{return [...this.suppliers.values()].map((item)=>structuredClone(item));} public async getSupplier(id:string):Promise<Supplier|null>{const value=this.suppliers.get(id);return value?structuredClone(value):null;} public async saveSupplier(value:Supplier):Promise<void>{this.suppliers.set(value.id,structuredClone(value));}
  public async listSupplierQualifications(supplierId?:string):Promise<SupplierQualification[]>{return [...this.supplierQualifications.values()].filter((item)=>!supplierId||item.supplierId===supplierId).map((item)=>structuredClone(item));} public async saveSupplierQualification(value:SupplierQualification):Promise<void>{this.supplierQualifications.set(value.id,structuredClone(value));}
  public async listPlatformSkus():Promise<PlatformSku[]>{return [...this.platformSkus.values()].map((item)=>structuredClone(item));} public async getPlatformSku(id:string):Promise<PlatformSku|null>{const value=this.platformSkus.get(id);return value?structuredClone(value):null;} public async savePlatformSku(value:PlatformSku):Promise<void>{this.platformSkus.set(value.id,structuredClone(value));}
  public async listSupplierSkuOffers(platformSkuId?:string):Promise<SupplierSkuOffer[]>{return [...this.supplierOffers.values()].filter((item)=>!platformSkuId||item.platformSkuId===platformSkuId).map((item)=>structuredClone(item));} public async getSupplierSkuOffer(id:string):Promise<SupplierSkuOffer|null>{const value=this.supplierOffers.get(id);return value?structuredClone(value):null;} public async saveSupplierSkuOffer(value:SupplierSkuOffer):Promise<void>{this.supplierOffers.set(value.id,structuredClone(value));}
  public async getCampaignPlatformItem(campaignId:string,platformSkuId:string):Promise<PlatformCampaignItem|null>{const value=this.campaignPlatformItems.get(`${campaignId}:${platformSkuId}`);return value?structuredClone(value):null;} public async replaceCampaignPlatformItems(campaign:Campaign):Promise<void>{for(const key of this.campaignPlatformItems.keys())if(key.startsWith(`${campaign.id}:`))this.campaignPlatformItems.delete(key);for(const item of campaign.platformItems)this.campaignPlatformItems.set(`${campaign.id}:${item.platformSkuId}`,structuredClone(item));const persisted=this.campaigns.get(campaign.id);if(persisted){persisted.platformItems=campaign.platformItems.map((item)=>structuredClone(item));this.campaigns.set(campaign.id,persisted);}}
  public async reserveCampaignPlatformStock(campaignId:string,platformSkuId:string,quantity:number):Promise<boolean>{const value=this.campaignPlatformItems.get(`${campaignId}:${platformSkuId}`);if(!value||value.sellableQuantity-value.reservedQuantity<quantity)return false;value.reservedQuantity+=quantity;return true;} public async releaseCampaignPlatformStock(campaignId:string,platformSkuId:string,quantity:number):Promise<boolean>{const value=this.campaignPlatformItems.get(`${campaignId}:${platformSkuId}`);if(!value||value.reservedQuantity<quantity)return false;value.reservedQuantity-=quantity;return true;}
  public async listCommunityCampaignItems(campaignId:string):Promise<CommunityCampaignItem[]>{return [...this.communityCampaignItems.entries()].filter(([key])=>key.startsWith(`${campaignId}:`)).map(([,value])=>structuredClone(value));} public async getCommunityCampaignItem(campaignId:string,platformSkuId:string):Promise<CommunityCampaignItem|null>{const value=this.communityCampaignItems.get(`${campaignId}:${platformSkuId}`);return value?structuredClone(value):null;} public async replaceCommunityCampaignItems(campaignId:string,items:CommunityCampaignItem[]):Promise<void>{for(const key of this.communityCampaignItems.keys())if(key.startsWith(`${campaignId}:`))this.communityCampaignItems.delete(key);for(const item of items)this.communityCampaignItems.set(`${campaignId}:${item.platformSkuId}`,structuredClone(item));const campaign=this.campaigns.get(campaignId);if(campaign){campaign.communityItems=items.map((item)=>structuredClone(item));this.campaigns.set(campaignId,campaign);}} public async reserveCommunityCampaignStock(campaignId:string,platformSkuId:string,quantity:number):Promise<boolean>{const item=this.communityCampaignItems.get(`${campaignId}:${platformSkuId}`);if(!item||item.sellableQuantity-item.reservedQuantity<quantity)return false;item.reservedQuantity+=quantity;return true;} public async releaseCommunityCampaignStock(campaignId:string,platformSkuId:string,quantity:number):Promise<boolean>{const item=this.communityCampaignItems.get(`${campaignId}:${platformSkuId}`);if(!item||item.reservedQuantity<quantity)return false;item.reservedQuantity-=quantity;return true;}
  public async saveSalesOrderItems(orderId:string,items:Array<{id:string;platformSkuId:string;productId:string;title:string;skuName:string;quantity:number;unitPriceCents:number;purchaseUnitCents:number;amountCents:number}>):Promise<void>{this.salesOrderItems.set(orderId,items.map((item)=>({...item,fulfilledQuantity:0,pickedUpQuantity:0,exceptionQuantity:0,refundedQuantity:0,refundedAmountCents:0})));}
  public async listPlatformOrderItemsByCampaign(campaignId:string):Promise<Array<{orderId:string;platformSkuId:string;quantity:number;purchaseUnitCents:number}>>{const rows:Array<{orderId:string;platformSkuId:string;quantity:number;purchaseUnitCents:number}>=[];for(const order of this.orders.values())if(order.campaignId===campaignId&&order.businessModelVersion!=='LEGACY_MARKETPLACE'&&['PAID_WAITING_CLOSE','LOCKED','ALLOCATING','IN_TRANSIT','READY_FOR_PICKUP','PICKED_UP','COMPLETED'].includes(order.status))for(const item of this.salesOrderItems.get(order.id)??[])rows.push({orderId:order.id,platformSkuId:item.platformSkuId,quantity:item.quantity,purchaseUnitCents:item.purchaseUnitCents});return rows;}
  public async listPlatformSalesLinesByCampaign(campaignId:string):Promise<PlatformSalesLine[]>{const rows:PlatformSalesLine[]=[];for(const order of this.orders.values())if(order.campaignId===campaignId&&order.businessModelVersion!=='LEGACY_MARKETPLACE'&&order.paidAt)for(const item of this.salesOrderItems.get(order.id)??[])rows.push({id:item.id,orderId:order.id,platformSkuId:item.platformSkuId,quantity:item.quantity,unitPriceCents:moneyCents(item.unitPriceCents),purchaseUnitCents:moneyCents(item.purchaseUnitCents),amountCents:moneyCents(item.amountCents),fulfilledQuantity:item.fulfilledQuantity,exceptionQuantity:item.exceptionQuantity,refundedQuantity:item.refundedQuantity,refundedAmountCents:moneyCents(item.refundedAmountCents),pickedUpQuantity:item.pickedUpQuantity,paidAt:order.paidAt});return rows.sort((left,right)=>(left.paidAt??'').localeCompare(right.paidAt??'')||left.orderId.localeCompare(right.orderId)||left.id.localeCompare(right.id));}
  public async listPlatformSalesLinesByCampaignForUpdate(campaignId:string):Promise<PlatformSalesLine[]>{return this.listPlatformSalesLinesByCampaign(campaignId);}
  public async updatePlatformSalesLine(value:PlatformSalesLine):Promise<boolean>{const rows=this.salesOrderItems.get(value.orderId);const item=rows?.find((item)=>item.id===value.id);if(!item||value.fulfilledQuantity+value.exceptionQuantity>value.quantity||value.pickedUpQuantity>value.fulfilledQuantity)return false;item.fulfilledQuantity=value.fulfilledQuantity;item.pickedUpQuantity=value.pickedUpQuantity;item.exceptionQuantity=value.exceptionQuantity;item.refundedQuantity=value.refundedQuantity;item.refundedAmountCents=Number(value.refundedAmountCents);return true;}
  public async listPurchaseOrders(campaignId?:string):Promise<PurchaseOrder[]>{return [...this.purchaseOrders.values()].filter((item)=>!campaignId||item.campaignId===campaignId).map((item)=>structuredClone(item));} public async getPurchaseOrder(id:string):Promise<PurchaseOrder|null>{const value=this.purchaseOrders.get(id);return value?structuredClone(value):null;} public async getPurchaseOrderForUpdate(id:string):Promise<PurchaseOrder|null>{return this.getPurchaseOrder(id);} public async savePurchaseOrder(value:PurchaseOrder):Promise<void>{this.purchaseOrders.set(value.id,structuredClone(value));}
  public async getGoodsReceiptByPurchaseOrder(purchaseOrderId:string):Promise<GoodsReceipt|null>{const value=[...this.goodsReceipts.values()].find((item)=>item.purchaseOrderId===purchaseOrderId);return value?structuredClone(value):null;} public async listGoodsReceiptsByPurchaseOrder(purchaseOrderId:string):Promise<GoodsReceipt[]>{return [...this.goodsReceipts.values()].filter((item)=>item.purchaseOrderId===purchaseOrderId).sort((left,right)=>left.createdAt.localeCompare(right.createdAt)||left.id.localeCompare(right.id)).map((item)=>structuredClone(item));} public async saveGoodsReceipt(value:GoodsReceipt):Promise<void>{this.goodsReceipts.set(value.id,structuredClone(value));}
  public async listInventoryLots(warehouseId?:string):Promise<InventoryLot[]>{return [...this.inventoryLots.values()].filter((item)=>!warehouseId||item.warehouseId===warehouseId).map((item)=>structuredClone(item));} public async saveInventoryLot(value:InventoryLot):Promise<void>{this.inventoryLots.set(value.id,structuredClone(value));} public async appendInventoryMovement(value:InventoryMovement):Promise<void>{this.inventoryMovements.push(structuredClone(value));}
  public async listInventoryBalances(warehouseId?:string):Promise<InventoryBalance[]>{const balances=new Map<string,InventoryBalance>();const keyFor=(bucket:InventoryMovement['fromBucket']):keyof Pick<InventoryBalance,'qualified'|'reserved'|'sorted'|'outbound'|'handedOver'|'rejected'|'quarantine'>=>{switch(bucket){case'QUALIFIED':return'qualified';case'RESERVED':return'reserved';case'SORTED':return'sorted';case'OUTBOUND':return'outbound';case'HANDED_OVER':return'handedOver';case'REJECTED':return'rejected';case'QUARANTINE':return'quarantine';default:throw new Error('missing inventory bucket');}};for(const lot of this.inventoryLots.values()){if(warehouseId&&lot.warehouseId!==warehouseId)continue;balances.set(lot.id,{inventoryLotId:lot.id,platformSkuId:lot.platformSkuId,warehouseId:lot.warehouseId,lotNo:lot.lotNo,expiresAt:lot.expiresAt,qualified:0,reserved:0,sorted:0,outbound:0,handedOver:0,rejected:0,quarantine:0});}for(const movement of this.inventoryMovements){const balance=balances.get(movement.inventoryLotId);if(!balance)continue;if(movement.fromBucket){const key=keyFor(movement.fromBucket);balance[key]-=movement.quantity;}if(movement.toBucket){const key=keyFor(movement.toBucket);balance[key]+=movement.quantity;}}return [...balances.values()];}
  public async listSupplierPayables(supplierId?:string):Promise<SupplierPayable[]>{return [...this.supplierPayables.values()].filter((item)=>!supplierId||item.supplierId===supplierId).map((item)=>structuredClone(item));}
  public async getSupplierPayable(id:string):Promise<SupplierPayable|null>{const value=this.supplierPayables.get(id);return value?structuredClone(value):null;}
  public async saveSupplierPayable(value:SupplierPayable):Promise<void>{this.supplierPayables.set(value.id,structuredClone(value));}
  public async getSortingTaskByCampaign(campaignId:string):Promise<SortingTask|null>{const value=[...this.sortingTasks.values()].find((item)=>item.campaignId===campaignId);return value?structuredClone(value):null;} public async listSortingTasks():Promise<SortingTask[]>{return [...this.sortingTasks.values()].sort((left,right)=>right.createdAt.localeCompare(left.createdAt)).map((item)=>structuredClone(item));} public async saveSortingTask(value:SortingTask):Promise<void>{this.sortingTasks.set(value.id,structuredClone(value));}
  public async getOutboundOrderByCampaign(campaignId:string):Promise<OutboundOrder|null>{const value=[...this.outboundOrders.values()].find((item)=>item.campaignId===campaignId);return value?structuredClone(value):null;} public async getOutboundOrderForUpdate(id:string):Promise<OutboundOrder|null>{const value=this.outboundOrders.get(id);return value?structuredClone(value):null;} public async listOutboundOrders(status?:OutboundOrder['status']):Promise<OutboundOrder[]>{return [...this.outboundOrders.values()].filter((item)=>!status||item.status===status).map((item)=>structuredClone(item));} public async saveOutboundOrder(value:OutboundOrder):Promise<void>{this.outboundOrders.set(value.id,structuredClone(value));}
  public async getPickupHandoverByOutbound(outboundOrderId:string):Promise<PickupHandover|null>{const value=[...this.pickupHandovers.values()].find((item)=>item.outboundOrderId===outboundOrderId);return value?structuredClone(value):null;} public async savePickupHandover(value:PickupHandover):Promise<void>{this.pickupHandovers.set(value.id,structuredClone(value));}
  public async getCommunityDeliveryConfirmationByBatch(batchId:string):Promise<CommunityDeliveryConfirmation|null>{const value=[...this.communityDeliveries.values()].find((item)=>item.dispatchBatchId===batchId);return value?structuredClone(value):null;} public async saveCommunityDeliveryConfirmation(value:CommunityDeliveryConfirmation):Promise<boolean>{if(await this.getCommunityDeliveryConfirmationByBatch(value.dispatchBatchId))return false;this.communityDeliveries.set(value.id,structuredClone(value));return true;} public async getCommunityPickupReceipt(orderId:string,requestKey:string):Promise<CommunityPickupReceipt|null>{const value=[...this.communityPickupReceipts.values()].find((item)=>item.orderId===orderId&&item.requestKey===requestKey);return value?structuredClone(value):null;} public async saveCommunityPickupReceipt(value:CommunityPickupReceipt):Promise<boolean>{if(await this.getCommunityPickupReceipt(value.orderId,value.requestKey))return false;this.communityPickupReceipts.set(value.id,structuredClone(value));return true;}
  public async getFulfillmentException(id:string):Promise<FulfillmentException|null>{const value=this.fulfillmentExceptions.get(id);return value?structuredClone(value):null;} public async getFulfillmentExceptionForUpdate(id:string):Promise<FulfillmentException|null>{return this.getFulfillmentException(id);} public async getFulfillmentExceptionByOrderRequest(orderId:string,clientRequestId:string):Promise<FulfillmentException|null>{const value=[...this.fulfillmentExceptions.values()].find((item)=>item.orderId===orderId&&item.clientRequestId===clientRequestId);return value?structuredClone(value):null;} public async getFulfillmentExceptionByOrderRequestForUpdate(orderId:string,clientRequestId:string):Promise<FulfillmentException|null>{return this.getFulfillmentExceptionByOrderRequest(orderId,clientRequestId);} public async listFulfillmentExceptions(status?:FulfillmentException['status']):Promise<FulfillmentException[]>{return [...this.fulfillmentExceptions.values()].filter((item)=>!status||item.status===status).map((item)=>structuredClone(item));} public async saveFulfillmentException(value:FulfillmentException):Promise<void>{this.fulfillmentExceptions.set(value.id,structuredClone(value));} public async listFulfillmentAllocations(exceptionId:string):Promise<FulfillmentAllocation[]>{return [...this.fulfillmentAllocations.values()].filter((item)=>item.exceptionId===exceptionId).map((item)=>structuredClone(item));} public async saveFulfillmentAllocations(values:FulfillmentAllocation[]):Promise<void>{for(const value of values)this.fulfillmentAllocations.set(value.id,structuredClone(value));} public async updateFulfillmentAllocations(values:FulfillmentAllocation[]):Promise<boolean>{for(const value of values){if(!this.fulfillmentAllocations.has(value.id))return false;}for(const value of values)this.fulfillmentAllocations.set(value.id,structuredClone(value));return true;} public async markFulfillmentAllocationsRefunded(exceptionId:string,refund:PlatformPartialRefund,at:string):Promise<boolean>{const allocations=(await this.listFulfillmentAllocations(exceptionId)).filter((item)=>item.orderId===refund.orderId&&!item.refundedQuantity);const total=allocations.reduce((sum,item)=>{const row=(this.salesOrderItems.get(item.orderId)??[]).find((value)=>value.id===item.salesOrderItemId);return sum+(row?item.exceptionQuantity*row.unitPriceCents:NaN);},0);if(!allocations.length||total!==Number(refund.amountCents))return false;for(const allocation of allocations){const row=(this.salesOrderItems.get(allocation.orderId)??[]).find((item)=>item.id===allocation.salesOrderItemId);if(!row)return false;allocation.refundedQuantity=allocation.exceptionQuantity;allocation.refundedAt=at;row.refundedQuantity+=allocation.exceptionQuantity;row.refundedAmountCents+=allocation.exceptionQuantity*row.unitPriceCents;this.fulfillmentAllocations.set(allocation.id,structuredClone(allocation));}return true;}
  public async listMerchants():Promise<Merchant[]>{return [...this.merchants.values()].map((item)=>structuredClone(item));} public async saveMerchant(value:Merchant):Promise<void>{this.merchants.set(value.id,structuredClone(value));} public async deleteMerchant(id:string):Promise<boolean>{return this.merchants.delete(id);}
  public async listProducts():Promise<Product[]>{return [...this.products.values()];} public async saveProduct(value:Product):Promise<void>{this.products.set(value.id,value);this.skus.set(value.sku.id,value.sku);}
  public async updateProductStatus(id:string,status:Product['status']):Promise<boolean>{const product=this.products.get(id);if(!product)return false;product.status=status;return true;} public async deleteProduct(id:string):Promise<boolean>{const product=this.products.get(id);if(!product)return false;this.skus.delete(product.sku.id);return this.products.delete(id);}
  public async listServiceAreas():Promise<ServiceArea[]>{return [...this.serviceAreas.values()];} public async saveServiceArea(value:ServiceArea):Promise<void>{this.serviceAreas.set(value.id,value);} public async updateServiceAreaOrderEnabled(id:string,orderEnabled:boolean):Promise<boolean>{const area=this.serviceAreas.get(id);if(!area)return false;area.orderEnabled=orderEnabled;return true;}
  public async listPickupPoints(serviceAreaId?:string):Promise<PickupPoint[]>{return [...this.pickupPoints.values()].filter((item)=>!serviceAreaId||item.serviceAreaId===serviceAreaId);} public async savePickupPoint(value:PickupPoint):Promise<void>{this.pickupPoints.set(value.id,value);}
  public async getDeliveryPlan(id:string):Promise<DeliveryPlan|null>{const value=this.deliveryPlans.get(id);return value?structuredClone(value):null;}
  public async getDeliveryPlanByCampaign(campaignId:string):Promise<DeliveryPlan|null>{const value=[...this.deliveryPlans.values()].find((item)=>item.campaignId===campaignId);return value?structuredClone(value):null;}
  public async listDeliveryPlans():Promise<DeliveryPlan[]>{return[...this.deliveryPlans.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map((item)=>structuredClone(item));}
  public async saveDeliveryPlan(value:DeliveryPlan):Promise<void>{this.deliveryPlans.set(value.id,structuredClone(value));}
  public async getDispatchBatch(id:string):Promise<DispatchBatch|null>{const value=this.batches.get(id);return value?structuredClone(value):null;} public async listDispatchBatches():Promise<DispatchBatch[]>{return[...this.batches.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map((value)=>structuredClone(value));} public async saveDispatchBatch(value:DispatchBatch):Promise<void>{this.batches.set(value.id,structuredClone(value));}
  public async getPickupCredential(orderId:string):Promise<PickupCredential|null>{return this.pickupCredentials.get(orderId)??null;} public async savePickupCredential(value:PickupCredential):Promise<void>{this.pickupCredentials.set(value.orderId,value);}
  public async pickupRecordExists(orderId:string):Promise<boolean>{return this.pickupRecords.has(orderId);} public async savePickupRecord(orderId:string,deliveryPlanId:string,verifierId:string):Promise<void>{void deliveryPlanId;void verifierId;this.pickupRecords.add(orderId);}
  public async grantPickupVerifier(userId:string,pickupPointId:string):Promise<void>{this.pickupVerifierAssignments.push({id:crypto.randomUUID(),userId,pickupPointId,action:'GRANTED',createdAt:new Date().toISOString()});}
  public async revokePickupVerifier(userId:string,pickupPointId:string):Promise<void>{this.pickupVerifierAssignments.push({id:crypto.randomUUID(),userId,pickupPointId,action:'REVOKED',createdAt:new Date().toISOString()});}
  public async hasActivePickupVerifierAssignment(userId:string,pickupPointId:string):Promise<boolean>{const assignment=[...this.pickupVerifierAssignments].reverse().find((item)=>item.userId===userId&&item.pickupPointId===pickupPointId);return assignment?.action==='GRANTED';}
  public async listPickupVerifierAssignments(userId?:string):Promise<PickupVerifierAssignment[]>{return this.pickupVerifierAssignments.filter((item)=>!userId||item.userId===userId).map((item)=>structuredClone(item));}
  public async hasActivePickupPointAssignment(userId:string,pickupPointId:string):Promise<boolean>{const staff=this.internalStaff.get(userId);if(staff)return staff.status==='ACTIVE'&&staff.role==='PICKUP_MANAGER'&&this.staffPickupPointAssignments.has(`${userId}:${pickupPointId}`);return this.hasActivePickupVerifierAssignment(userId,pickupPointId);}
  public async findUserByWechatOpenId(openId:string):Promise<User|null>{const value=this.usersByOpenId.get(openId);return value?structuredClone(value):null;}
  public async saveUser(value:User):Promise<void>{const copy=structuredClone(value);this.usersById.set(value.id,copy);if(value.wechatOpenId)this.usersByOpenId.set(value.wechatOpenId,copy);}
  public async getUser(id:string):Promise<User|null>{const value=this.usersById.get(id);return value?structuredClone(value):null;}
  public async savePrivacyConsent(userId:string,documentVersion:string):Promise<void>{const key=`${userId}:${documentVersion}`;if(!this.privacyConsents.has(key))this.privacyConsents.set(key,{userId,documentVersion,consentedAt:new Date().toISOString()});}
  public async getPrivacyConsent(userId:string,documentVersion:string):Promise<PrivacyConsent|null>{const value=this.privacyConsents.get(`${userId}:${documentVersion}`);return value?structuredClone(value):null;}
  public async findAdminCredential(username:string):Promise<AdminCredential|null>{const value=this.adminCredentials.get(username.toLowerCase());return value?{...structuredClone(value),roles:[...(this.userRoles.get(value.userId)??new Set(value.roles))]}:null;}
  public async findAdminCredentialByUserId(userId:string):Promise<AdminCredential|null>{const value=[...this.adminCredentials.values()].find((item)=>item.userId===userId);return value?{...structuredClone(value),roles:[...(this.userRoles.get(userId)??new Set(value.roles))]}:null;}
  public async saveAdminCredential(value:AdminCredential):Promise<void>{this.adminCredentials.set(value.username.toLowerCase(),structuredClone(value));}
  public async saveUserRole(userId:string,role:Role):Promise<void>{const roles=this.userRoles.get(userId)??new Set<Role>();roles.add(role);this.userRoles.set(userId,roles);}
  public async replaceUserRoles(userId:string,roles:Role[]):Promise<void>{this.userRoles.set(userId,new Set(roles));}
  public async getInternalStaff(userId:string):Promise<InternalStaff|null>{const value=this.internalStaff.get(userId);return value?structuredClone(value):null;}
  public async listInternalStaff(query?:string):Promise<InternalStaff[]>{const normalized=query?.trim().toLowerCase();return[...this.internalStaff.values()].filter((item)=>!normalized||[item.staffNo,item.displayName,item.phone,item.role,item.status].some((value)=>value.toLowerCase().includes(normalized))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map((item)=>structuredClone(item));}
  public async saveInternalStaff(value:InternalStaff):Promise<void>{this.internalStaff.set(value.userId,structuredClone(value));}
  public async listStaffPickupPointAssignments(staffUserId?:string):Promise<StaffPickupPointAssignment[]>{return[...this.staffPickupPointAssignments.values()].filter((item)=>!staffUserId||item.staffUserId===staffUserId).map((item)=>structuredClone(item));}
  public async replaceStaffPickupPointAssignments(staffUserId:string,assignments:StaffPickupPointAssignment[]):Promise<void>{for(const key of [...this.staffPickupPointAssignments.keys()])if(key.startsWith(`${staffUserId}:`))this.staffPickupPointAssignments.delete(key);for(const assignment of assignments)this.staffPickupPointAssignments.set(`${assignment.staffUserId}:${assignment.pickupPointId}`,structuredClone(assignment));}
  public async getAuthSession(tokenHash:string):Promise<AuthSession|null>{const value=this.sessions.get(tokenHash);if(!value)return null;const user=this.usersById.get(value.userId);const staff=this.internalStaff.get(value.userId);if(!user||user.status!=='ACTIVE'||(staff&&staff.status!=='ACTIVE'))return null;return{...structuredClone(value),roles:[...(this.userRoles.get(value.userId)??new Set(value.roles))]};}
  public async saveAuthSession(value:AuthSession):Promise<void>{this.sessions.set(value.tokenHash,structuredClone(value));}
  public async deleteAuthSession(tokenHash:string):Promise<void>{this.sessions.delete(tokenHash);}
  public async deleteAuthSessionsByUser(userId:string):Promise<void>{for(const [token,session] of this.sessions)if(session.userId===userId)this.sessions.delete(token);}
  public async getPaymentByOrder(orderId:string):Promise<Payment|null>{const value=this.payments.get(orderId);return value?structuredClone(value):null;}
  public async getPaymentByOrderForUpdate(orderId:string):Promise<Payment|null>{return this.getPaymentByOrder(orderId);}
  public async savePayment(value:Payment):Promise<void>{this.payments.set(value.orderId,structuredClone(value));}
  public async savePaymentIfStatus(value:Payment,expectedStatuses:Payment['status'][]):Promise<boolean>{const current=this.payments.get(value.orderId);if(current&&!expectedStatuses.includes(current.status))return false;this.payments.set(value.orderId,structuredClone(value));return true;}
  public async claimPaymentInitiation(value:Payment,leaseUntil:string,now:string,claimToken:string):Promise<boolean>{
    const current=this.payments.get(value.orderId);
    if(current&&(current.status!=='CREATED'||current.clientPayload!==null||(current.initiationLeaseUntil!==null&&current.initiationLeaseUntil>now)))return false;
    this.payments.set(value.orderId,structuredClone({...current??value,initiationLeaseUntil:leaseUntil,initiationClaimToken:claimToken}));
    return true;
  }
  public async savePaymentIfInitiationClaimed(value:Payment,claimToken:string):Promise<boolean>{const current=this.payments.get(value.orderId);if(!current||current.status!=='CREATED'||current.initiationClaimToken!==claimToken)return false;this.payments.set(value.orderId,structuredClone(value));return true;}
  public async claimPaymentCallback(provider:Payment['provider'],eventId:string):Promise<boolean>{const key=`${provider}:${eventId}`;if(this.paymentCallbacks.has(key))return false;this.paymentCallbacks.add(key);this.paymentCallbackClaimScopes.at(-1)?.add(key);return true;}
  public async listRefundsByOrder(orderId:string):Promise<Refund[]>{return[...this.refunds.values()].filter((item)=>item.orderId===orderId).map((item)=>structuredClone(item));}
  public async listRefunds(limit:number):Promise<Refund[]>{return[...this.refunds.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit).map((item)=>structuredClone(item));}
  public async getRefundByProviderNo(providerRefundNo:string):Promise<Refund|null>{const value=[...this.refunds.values()].find((item)=>item.providerRefundNo===providerRefundNo);return value?structuredClone(value):null;}
  public async saveRefund(value:Refund):Promise<void>{this.refunds.set(value.id,structuredClone(value));}
  public async claimRefundSubmission(refundId:string,leaseUntil:string,now:string,claimToken:string):Promise<boolean>{const refund=this.refunds.get(refundId);if(!refund||(!['CREATED','FAILED'].includes(refund.status)&&!(refund.status==='PROCESSING'&&refund.submissionLeaseUntil!==null&&refund.submissionLeaseUntil<=now)))return false;refund.status='PROCESSING';refund.submissionLeaseUntil=leaseUntil;refund.submissionClaimToken=claimToken;this.refunds.set(refundId,structuredClone(refund));return true;}
  public async saveRefundIfClaimed(value:Refund,claimToken:string):Promise<boolean>{const current=this.refunds.get(value.id);if(!current||current.status!=='PROCESSING'||current.submissionClaimToken!==claimToken)return false;this.refunds.set(value.id,structuredClone(value));return true;}
  public async saveRefundIfUnclaimed(value:Refund,now:string):Promise<boolean>{const current=this.refunds.get(value.id);if(!current||current.status!=='PROCESSING'||current.submissionClaimToken!==null||(current.submissionLeaseUntil!==null&&current.submissionLeaseUntil>now))return false;this.refunds.set(value.id,structuredClone(value));return true;}
  public async saveRefundIfStatus(value:Refund,expectedStatuses:Refund['status'][]):Promise<boolean>{const current=this.refunds.get(value.id);if(!current||!expectedStatuses.includes(current.status))return false;this.refunds.set(value.id,structuredClone(value));return true;}
  public async listPendingRefunds(limit:number):Promise<Refund[]>{return[...this.refunds.values()].filter((item)=>item.status==='CREATED'||item.status==='PROCESSING'||item.status==='FAILED').slice(0,limit).map((item)=>structuredClone(item));}
  public async listRefundingOrders(limit:number):Promise<Order[]>{return[...this.orders.values()].filter((item)=>item.status==='REFUNDING').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(0,Math.max(1,Math.min(1_000,Math.trunc(limit)))).map((item)=>structuredClone(item));}
  public async appendLedgerTransaction(value:LedgerTransaction):Promise<boolean>{const key=`${value.referenceType}:${value.referenceId}:${value.eventType}`;if(this.ledgerTransactions.has(key))return false;this.ledgerTransactions.set(key,structuredClone(value));return true;}
  public async listLedgerTransactions(referenceId?:string):Promise<LedgerTransaction[]>{return[...this.ledgerTransactions.values()].filter((item)=>!referenceId||item.referenceId===referenceId).map((item)=>structuredClone(item));}
  public async listSettlements(orderId?:string):Promise<Settlement[]>{return[...this.settlements.values()].filter((item)=>!orderId||item.orderId===orderId).map((item)=>structuredClone(item));}
  public async listPendingSettlements(limit:number):Promise<Settlement[]>{return[...this.settlements.values()].filter((item)=>item.status!=='SUCCEEDED').slice(0,limit).map((item)=>structuredClone(item));}
  public async saveSettlement(value:Settlement):Promise<void>{this.settlements.set(value.id,structuredClone(value));}
  public async saveAuditLog(value:AuditLog):Promise<void>{this.auditLogs.push(structuredClone(value));}
  public async findLatestAudit(resourceType:string,resourceId:string,action:string):Promise<AuditLog|null>{const value=[...this.auditLogs].reverse().find((item)=>item.resourceType===resourceType&&item.resourceId===resourceId&&item.action===action);return value?structuredClone(value):null;}
  public async listAuditLogs(limit:number):Promise<AuditLog[]>{return[...this.auditLogs].reverse().slice(0,limit).map((item)=>structuredClone(item));}
  public async saveServiceAreaInterest(value:ServiceAreaInterest):Promise<void>{this.serviceAreaInterests.set(value.id,structuredClone(value));} public async getServiceAreaInterest(id:string):Promise<ServiceAreaInterest|null>{const value=this.serviceAreaInterests.get(id);return value?structuredClone(value):null;} public async listServiceAreaInterests(limit:number):Promise<ServiceAreaInterest[]>{return[...this.serviceAreaInterests.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit).map((item)=>structuredClone(item));} public async listServiceAreaInterestsByUser(userId:string):Promise<ServiceAreaInterest[]>{return[...this.serviceAreaInterests.values()].filter((item)=>item.userId===userId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map((item)=>structuredClone(item));}
  public async saveAfterSale(value:AfterSale):Promise<void>{this.afterSales.set(value.id,structuredClone(value));} public async getAfterSale(id:string):Promise<AfterSale|null>{const value=this.afterSales.get(id);return value?structuredClone(value):null;} public async listAfterSales(limit:number):Promise<AfterSale[]>{return[...this.afterSales.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit).map((item)=>structuredClone(item));} public async listAfterSalesByUser(userId:string):Promise<AfterSale[]>{return[...this.afterSales.values()].filter((item)=>item.userId===userId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map((item)=>structuredClone(item));} public async hasOpenAfterSaleForOrder(orderId:string):Promise<boolean>{return[...this.afterSales.values()].some((item)=>item.orderId===orderId&&['SUBMITTED','PROCESSING'].includes(item.status));}
  public async createOrderNotificationIfAbsent(value:OrderNotification):Promise<boolean>{if([...this.orderNotifications.values()].some((item)=>item.orderId===value.orderId&&item.eventKey===value.eventKey))return false;this.orderNotifications.set(value.id,structuredClone(value));return true;}
  public async saveOrderNotification(value:OrderNotification):Promise<void>{const existing=this.orderNotifications.get(value.id);if(existing&&existing.deliveryClaimToken!==null&&existing.deliveryClaimToken!==value.deliveryClaimToken)return;this.orderNotifications.set(value.id,structuredClone(value));}
  public async saveOrderNotificationIfClaimed(value:OrderNotification,claimToken:string):Promise<boolean>{const existing=this.orderNotifications.get(value.id);if(!existing||existing.deliveryClaimToken!==claimToken)return false;this.orderNotifications.set(value.id,structuredClone({...existing,status:value.status,deliveryAttempts:value.deliveryAttempts,nextAttemptAt:value.nextAttemptAt,deliveryLeaseUntil:value.deliveryLeaseUntil,deliveryClaimToken:value.deliveryClaimToken,lastDeliveryError:value.lastDeliveryError,deliveredAt:value.deliveredAt}));return true;}
  public async getOrderNotification(id:string):Promise<OrderNotification|null>{const value=this.orderNotifications.get(id);return value?structuredClone(value):null;}
  public async listOrderNotificationsByUser(userId:string):Promise<OrderNotification[]>{return[...this.orderNotifications.values()].filter((item)=>item.userId===userId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map((item)=>structuredClone(item));}
  public async listManualOrderNotifications(limit:number):Promise<OrderNotification[]>{return[...this.orderNotifications.values()].filter((item)=>item.status==='MANUAL_REQUIRED'||item.status==='PENDING_DELIVERY').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit).map((item)=>structuredClone(item));}
  public async claimPendingOrderNotifications(limit:number,leaseUntil:string,now:string,claimToken:string):Promise<OrderNotification[]>{const claimed=[...this.orderNotifications.values()].filter((item)=>item.status==='PENDING_DELIVERY'&&(!item.nextAttemptAt||item.nextAttemptAt<=now)&&(!item.deliveryLeaseUntil||item.deliveryLeaseUntil<=now)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(0,Math.max(1,Math.min(5,Math.trunc(limit))));for(const item of claimed){item.deliveryLeaseUntil=leaseUntil;item.deliveryClaimToken=claimToken;this.orderNotifications.set(item.id,structuredClone(item));}return claimed.map((item)=>structuredClone(item));}
  public async markOrderNotificationRead(id:string,readAt:string):Promise<void>{const value=this.orderNotifications.get(id);if(!value||value.readAt)return;value.readAt=readAt;this.orderNotifications.set(id,value);}
  public async requeuePendingOrderNotification(id:string,now:string):Promise<OrderNotification|null>{const value=this.orderNotifications.get(id);if(!value)return null;if(value.status==='PENDING_DELIVERY'&&(!value.deliveryLeaseUntil||value.deliveryLeaseUntil<=now)){value.nextAttemptAt=now;value.deliveryLeaseUntil=null;value.deliveryClaimToken=null;this.orderNotifications.set(id,value);}return structuredClone(value);}
  public async markOrderNotificationManualCompleted(id:string):Promise<void>{const value=this.orderNotifications.get(id);if(!value)return;value.status='MANUAL_COMPLETED';value.manualCompletedAt=new Date().toISOString();value.deliveryLeaseUntil=null;value.deliveryClaimToken=null;this.orderNotifications.set(id,value);}
  public async saveNotificationPreference(value:NotificationPreference):Promise<void>{this.notificationPreferences.set(value.userId,structuredClone(value));}
  public async getNotificationPreference(userId:string):Promise<NotificationPreference|null>{const value=this.notificationPreferences.get(userId);return value?structuredClone(value):null;}
}

export function asMoney(value: number | string): MoneyCents {
  return moneyCents(Number(value));
}
