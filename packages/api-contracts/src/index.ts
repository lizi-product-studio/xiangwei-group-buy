import { z } from 'zod';

export const identifierSchema = z.string().trim().min(1).max(64);
/** Mainland China mobile numbers are the only contact format supported by this MVP. */
export const mainlandChinaMobileSchema = z.string().trim().regex(/^1[3-9]\d{9}$/, '请输入有效的中国大陆手机号');
const privacyNoticeVersionSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
export const wechatLoginSchema = z.object({
  code: z.string().trim().min(6).max(128),
  privacyAccepted: z.literal(true),
  privacyVersion: privacyNoticeVersionSchema,
});
export const adminLoginSchema = z.object({ username: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/), password: z.string().min(12).max(128) });

export const createCampaignSchema = z
  .object({
    title: z.string().trim().min(2).max(80),
    serviceAreaId: identifierSchema,
    cutoffAt: z.iso.datetime({ offset: true }),
    dispatchAt: z.iso.datetime({ offset: true }),
    minTotalQuantity: z.int().min(1).max(1_000_000).default(1),
    failureAction: z.enum(['CANCEL_AND_REFUND', 'POSTPONE']),
    skuIds: z.array(identifierSchema).min(1).max(500),
  })
  .superRefine((value, context) => {
    if (Date.parse(value.dispatchAt) <= Date.parse(value.cutoffAt)) {
      context.addIssue({ code: 'custom', path: ['dispatchAt'], message: '发车时间必须晚于截单时间' });
    }
  });

export const updateCampaignSchema = createCampaignSchema;
export const platformCampaignSchema = z.object({
  title:z.string().trim().min(2).max(80), serviceAreaId:identifierSchema, warehouseId:identifierSchema,
  cutoffAt:z.iso.datetime({offset:true}), dispatchAt:z.iso.datetime({offset:true}), minTotalQuantity:z.int().min(1).max(1_000_000).default(1), failureAction:z.enum(['CANCEL_AND_REFUND','POSTPONE']),
  items:z.array(z.object({platformSkuId:identifierSchema,supplierOfferId:identifierSchema,sellableQuantity:z.int().min(1).max(1_000_000)})).min(1).max(500),
}).superRefine((value,context)=>{if(Date.parse(value.dispatchAt)<=Date.parse(value.cutoffAt))context.addIssue({code:'custom',path:['dispatchAt'],message:'发车时间必须晚于截团时间'});});
export const communityCampaignSchema=z.object({
  title:z.string().trim().min(2).max(80),serviceAreaId:identifierSchema,pickupPointId:identifierSchema,
  cutoffAt:z.iso.datetime({offset:true}),dispatchAt:z.iso.datetime({offset:true}),minTotalQuantity:z.int().min(1).max(1_000_000).default(1),failureAction:z.enum(['CANCEL_AND_REFUND','POSTPONE']),
  items:z.array(z.object({platformSkuId:identifierSchema,retailPriceCents:z.int().min(1),sellableQuantity:z.int().min(1).max(1_000_000)})).min(1).max(500),
}).superRefine((value,context)=>{if(Date.parse(value.dispatchAt)<=Date.parse(value.cutoffAt))context.addIssue({code:'custom',path:['dispatchAt'],message:'发车时间必须晚于截团时间'});});
export const supplierSchema=z.object({name:z.string().trim().min(2).max(120),contactName:z.string().trim().min(2).max(80).nullable().default(null),contactPhone:mainlandChinaMobileSchema.nullable().default(null),status:z.enum(['DRAFT','ACTIVE','SUSPENDED']).default('DRAFT')});
export const supplierQualificationSchema=z.object({qualificationType:z.string().trim().min(2).max(64),qualificationNo:z.string().trim().min(2).max(120).nullable().default(null),expiresAt:z.string().date().nullable().default(null),status:z.enum(['PENDING','APPROVED','REJECTED','EXPIRED']).default('PENDING'),evidenceSummary:z.string().trim().min(2).max(500).nullable().default(null)});
export const warehouseSchema=z.object({name:z.string().trim().min(2).max(120),address:z.string().trim().min(5).max(255),status:z.enum(['ACTIVE','SUSPENDED']).default('ACTIVE')});
export const platformSkuSchema=z.object({id:identifierSchema.optional(),productId:identifierSchema.optional(),title:z.string().trim().min(2).max(160),category:z.string().trim().min(2).max(40),origin:z.string().trim().min(2).max(160),imageUrl:z.string().trim().max(2048).nullable().default(null),skuName:z.string().trim().min(1).max(160),retailPriceCents:z.int().min(1),defaultSellableQuantity:z.int().min(0).max(10_000_000).default(0),referencePurchaseCostCents:z.int().min(1).nullable().default(null),supplierNote:z.string().trim().max(500).nullable().default(null),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
export const supplierOfferSchema=z.object({supplierId:identifierSchema,platformSkuId:identifierSchema,purchasePriceCents:z.int().min(1).nullable(),minimumPurchaseQuantity:z.int().min(1).default(1),leadTimeDays:z.int().min(0).max(365).default(1),status:z.enum(['DRAFT','ACTIVE','SUSPENDED']).default('DRAFT')});
/** A finance operator records the external transfer reference; this never touches customer payments. */
export const supplierPayablePaymentSchema=z.object({paymentReference:z.string().trim().min(2).max(160)});
export const fulfillmentExceptionTypeSchema=z.enum(['SHORT_RECEIPT','QUALITY_REJECTED','PACKAGE_DAMAGED','WAREHOUSE_SHORTAGE','WAREHOUSE_DAMAGE','MIS_SORTED','TRANSIT_SHORTAGE','TRANSIT_DAMAGE','WRONG_POINT','PICKUP_POINT_REJECTED','PICKUP_SHORTAGE','PICKUP_DAMAGE','QUALITY_CLAIM']);
export const exceptionResponsibilitySchema=z.enum(['SUPPLIER','WAREHOUSE','CARRIER','PICKUP_POINT','PLATFORM','PENDING']);
export const goodsReceiptSchema=z.object({items:z.array(z.object({purchaseOrderItemId:identifierSchema,acceptedQuantity:z.int().min(0),rejectedQuantity:z.int().min(0),batchNo:z.string().trim().min(1).max(100).nullable(),productionDate:z.string().date().nullable(),expiresAt:z.string().date().nullable(),inspectionNote:z.string().trim().max(500).nullable().default(null),exceptionReason:fulfillmentExceptionTypeSchema.nullable().default(null),evidenceUrl:z.string().url().max(2048).nullable().default(null)})).min(1).max(500)});
export const warehouseExceptionSchema=z.object({items:z.array(z.object({platformSkuId:identifierSchema,shortQuantity:z.int().min(0).default(0),damagedQuantity:z.int().min(0).default(0),reason:z.enum(['WAREHOUSE_SHORTAGE','WAREHOUSE_DAMAGE','MIS_SORTED']),description:z.string().trim().min(5).max(500),evidenceUrl:z.string().url().max(2048).nullable().default(null)})).min(1).max(500)}).superRefine((value,context)=>{for(const [index,item] of value.items.entries()){if(item.shortQuantity+item.damagedQuantity<=0)context.addIssue({code:'custom',path:['items',index],message:'仓库异常数量必须大于零'});if(item.reason==='WAREHOUSE_DAMAGE'&&item.damagedQuantity===0)context.addIssue({code:'custom',path:['items',index,'damagedQuantity'],message:'仓内破损必须登记破损数量'});if(item.reason!=='WAREHOUSE_DAMAGE'&&item.shortQuantity===0)context.addIssue({code:'custom',path:['items',index,'shortQuantity'],message:'短少或错配必须登记短少数量'});}});
export const outboundSchema=z.object({carrierReference:z.string().trim().min(1).max(100).nullable().default(null)});
export const pickupHandoverSchema=z.object({receivedBy:identifierSchema,exceptionNote:z.string().trim().max(500).nullable().default(null),items:z.array(z.object({platformSkuId:identifierSchema,receivedQuantity:z.int().min(0),rejectedQuantity:z.int().min(0).default(0),shortQuantity:z.int().min(0).default(0),damagedQuantity:z.int().min(0).default(0),reason:fulfillmentExceptionTypeSchema.nullable().default(null),evidenceNote:z.string().trim().max(500).nullable().default(null),evidenceUrl:z.string().url().max(2048).nullable().default(null)})).min(1).max(500)}).superRefine((value,context)=>{for(const [index,item] of value.items.entries()){const affected=item.rejectedQuantity+item.shortQuantity+item.damagedQuantity;if(affected>0&&(!item.reason||!item.evidenceNote))context.addIssue({code:'custom',path:['items',index],message:'差异交接必须填写原因和证据说明'});}});
export const exceptionDecisionSchema=z.object({status:z.enum(['WAITING_REPLENISHMENT','TRANSFER_PENDING','REFUND_CONFIRMED']),responsibility:exceptionResponsibilitySchema,resolutionNote:z.string().trim().min(2).max(500)});
export const transferReinspectionSchema=z.object({evidenceNote:z.string().trim().min(5).max(500),items:z.array(z.object({platformSkuId:identifierSchema,acceptedQuantity:z.int().min(1).max(999_999)})).min(1).max(500)});
export const partialRefundExecutionSchema=z.object({confirmationNote:z.string().trim().min(2).max(500)});
export const fulfillmentClaimSchema=z.object({clientRequestId:z.string().trim().min(8).max(64),items:z.array(z.object({platformSkuId:identifierSchema,quantity:z.int().min(1).max(999),reason:z.enum(['PICKUP_SHORTAGE','PICKUP_DAMAGE','QUALITY_CLAIM']),description:z.string().trim().min(5).max(500),evidenceUrl:z.string().url().max(2048).nullable().default(null)})).min(1).max(20)});
export const postponeCampaignSchema = z.object({
  cutoffAt: z.iso.datetime({ offset: true }),
  dispatchAt: z.iso.datetime({ offset: true }),
}).superRefine((value, context) => {
  if (Date.parse(value.dispatchAt) <= Date.parse(value.cutoffAt)) context.addIssue({ code: 'custom', path: ['dispatchAt'], message: '发车时间必须晚于截单时间' });
});

export const orderLineSchema = z.object({
  skuId: identifierSchema,
  quantity: z.int().min(1).max(999),
});

export const orderRequestSchema = z.object({
  campaignId: identifierSchema,
  serviceAreaId: identifierSchema,
  pickupPointId: identifierSchema,
  items: z.array(orderLineSchema).min(1).max(100),
});

export const createMerchantSchema = z.object({ name: z.string().trim().min(2).max(120), defaultCommissionBps: z.int().min(0).max(10_000), wechatSubMchid: z.string().regex(/^\d{8,10}$/).nullable().optional() });
export const updateMerchantSchema = createMerchantSchema;
export const updateMerchantStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) });
export const createProductSchema = z.object({
  merchantId: identifierSchema,
  title: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(40).default('地方特产'),
  origin: z.string().trim().min(2).max(160),
  imageUrl: z.string().trim().max(2048).nullable().default(null),
  skuName: z.string().trim().min(1).max(160),
  priceCents: z.int().min(1),
  stock: z.int().min(0).max(10_000_000),
});
export const updateProductSchema = createProductSchema;
export const openServiceAreaSchema = z.object({ regionCode: z.string().regex(/^\d{6,12}$/) });
export const updateServiceAreaOrderStatusSchema = z.object({ orderEnabled: z.boolean() });
export const regionDirectoryQuerySchema = z.object({ query: z.string().trim().max(80).optional().default('') });
export const createPickupPointSchema = z.object({ serviceAreaId: identifierSchema, name: z.string().trim().min(2).max(120), address: z.string().trim().min(5).max(255), capacityPerDay: z.int().min(1).max(1_000_000).nullable().default(null) });
export const networkPresetIdSchema = z.enum(['BAODING_COUNTIES']);
export const activateNetworkPresetSchema = z.object({ orderEnabled: z.boolean().default(true) });
export const batchCreatePickupPointsSchema = z.object({
  points: z.array(z.object({
    city: z.string().trim().min(2).max(80),
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().min(5).max(255),
    capacityPerDay: z.int().min(1).max(1_000_000).nullable().default(null),
  })).min(1).max(500),
});
export const reviewDecisionSchema = z.object({ decision: z.enum(['APPROVE','REJECT']), reason: z.string().trim().max(500).optional() }).superRefine((value, context) => { if (value.decision === 'REJECT' && !value.reason) context.addIssue({code:'custom',path:['reason'],message:'驳回时必须填写原因'}); });
export const createDispatchBatchSchema = z.object({ campaignId: identifierSchema });
export const createDeliveryPlanSchema = z.object({
  campaignId: identifierSchema,
  pickupPointId: identifierSchema.nullable().default(null),
  siteName: z.string().trim().min(2).max(120).nullable().default(null),
  address: z.string().trim().min(5).max(255).nullable().default(null),
  arrivalStartAt: z.iso.datetime({ offset: true }).nullable().default(null),
  arrivalEndAt: z.iso.datetime({ offset: true }).nullable().default(null),
  contactName: z.string().trim().min(2).max(80).nullable().default(null),
  contactPhone: mainlandChinaMobileSchema.nullable().default(null),
  remark: z.string().trim().max(500).nullable().default(null),
}).superRefine((value, context) => {
  if ((value.siteName && !value.address) || (!value.siteName && value.address)) {
    context.addIssue({ code: 'custom', path: ['siteName'], message: '到货地点名称和详细地址需要同时填写' });
  }
  if (value.arrivalStartAt && value.arrivalEndAt && Date.parse(value.arrivalEndAt) < Date.parse(value.arrivalStartAt)) {
    context.addIssue({ code: 'custom', path: ['arrivalEndAt'], message: '结束时间不能早于开始时间' });
  }
});
export const bookVehicleSchema = z.object({
  logisticsPlatform:z.string().trim().min(2).max(80).default('货拉拉'),
  vehicleOrderNo: z.string().trim().min(2).max(100),
  driverName: z.string().trim().min(2).max(80).nullable().default(null),
  driverPhone: mainlandChinaMobileSchema.nullable().default(null),
  vehiclePlate: z.string().trim().min(2).max(32).nullable().default(null),
  estimatedArrivalAt:z.iso.datetime({offset:true}).nullable().default(null),
});
export const receiveBatchSchema = z.object({ deliveryPlanId: identifierSchema });
export const communityArrivalSchema=z.object({receivedBy:z.string().trim().min(2).max(120),confirmationNote:z.string().trim().max(500).nullable().default(null),items:z.array(z.object({platformSkuId:identifierSchema,receivedQuantity:z.int().min(0),rejectedQuantity:z.int().min(0).default(0),shortQuantity:z.int().min(0).default(0),damagedQuantity:z.int().min(0).default(0),reason:fulfillmentExceptionTypeSchema.nullable().default(null),evidenceNote:z.string().trim().max(500).nullable().default(null),evidenceUrl:z.string().url().max(2048).nullable().default(null)})).min(1).max(500)});
export const verifyPickupSchema = z.object({ orderId: identifierSchema, deliveryPlanId: identifierSchema, code: z.string().regex(/^\d{6}$/), items:z.array(z.object({platformSkuId:identifierSchema,quantity:z.int().min(1).max(999)})).max(100).optional() });
/** Exact, point-scoped lookup used by the on-site pickup verifier. */
export const pickupOrderLookupQuerySchema = z.object({ deliveryPlanId: identifierSchema, orderNo: z.string().trim().min(1).max(64) });
export const pickupVerifierAssignmentSchema = z.object({ userId: identifierSchema, pickupPointId: identifierSchema });
export const pickupVerifierAssignmentQuerySchema = z.object({ userId: identifierSchema.optional() });
export const createServiceAreaInterestSchema = z.object({
  regionText:z.string().trim().min(2).max(160),
  contactName:z.string().trim().min(2).max(80),
  contactPhone:mainlandChinaMobileSchema,
  privacyAccepted:z.literal(true),
  privacyVersion: privacyNoticeVersionSchema,
});
export const updateServiceAreaInterestStatusSchema = z.object({ status:z.enum(['CONTACTED','CLOSED']) });
export const createAfterSaleSchema = z.object({ reason:z.string().trim().min(2).max(80), description:z.string().trim().min(2).max(1000) });
export const updateAfterSaleStatusSchema = z.object({ status:z.enum(['PROCESSING','REJECTED']), resolutionNote:z.string().trim().min(2).max(500).optional() });
export const resolveAfterSaleRefundSchema = z.object({ resolutionNote:z.string().trim().min(2).max(500) });
// An empty list is meaningful: the user declined all current subscription prompts and must enter manual follow-up.
export const notificationPreferenceSchema = z.object({ types:z.array(z.enum(['SITE_CONFIRMED','VEHICLE_DISPATCHED','ARRIVED','PARTIAL_REFUND'])).max(4) });

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type PlatformCampaignInput=z.infer<typeof platformCampaignSchema>;
export type CommunityCampaignInput=z.infer<typeof communityCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type PostponeCampaignInput = z.infer<typeof postponeCampaignSchema>;
export type OrderRequest = z.infer<typeof orderRequestSchema>;
export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;
export type UpdateMerchantInput = z.infer<typeof updateMerchantSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type OpenServiceAreaInput = z.infer<typeof openServiceAreaSchema>;
export type CreatePickupPointInput = z.infer<typeof createPickupPointSchema>;
export type ActivateNetworkPresetInput = z.infer<typeof activateNetworkPresetSchema>;
export type BatchCreatePickupPointsInput = z.infer<typeof batchCreatePickupPointsSchema>;
export type CreateDeliveryPlanInput = z.infer<typeof createDeliveryPlanSchema>;
export type BookVehicleInput = z.infer<typeof bookVehicleSchema>;
export type PickupVerifierAssignmentInput = z.infer<typeof pickupVerifierAssignmentSchema>;

export interface ApiErrorResponse {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
}
