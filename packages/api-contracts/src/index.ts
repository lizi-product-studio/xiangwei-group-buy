import { z } from "zod";

export const identifierSchema = z.string().trim().min(1).max(64);
export const mainlandChinaMobileSchema = z
  .string()
  .trim()
  .regex(/^1[3-9]\d{9}$/, "请输入有效的中国大陆手机号");
const privacyNoticeVersionSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
export const adminPasswordSchema = z.string().min(8).max(128);

export const wechatLoginSchema = z.object({
  phoneCode: z.string().trim().min(1).max(256).optional(),
  code: z.string().trim().min(6).max(128),
  privacyAccepted: z.literal(true),
  privacyVersion: privacyNoticeVersionSchema,
});
export const adminLoginSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/),
  password: adminPasswordSchema,
});
export const adminPasswordChangeSchema = z.object({
  currentPassword: adminPasswordSchema,
  newPassword: adminPasswordSchema,
});
export const completeAdminPasswordChangeSchema = z.object({
  passwordChangeToken: z.string().trim().min(32).max(128),
  newPassword: adminPasswordSchema,
});
export const internalStaffRoleSchema = z.enum([
  "SUPER_ADMIN",
  "OPERATOR",
  "CUSTOMER_SERVICE",
  "FINANCE",
  "PICKUP_MANAGER",
]);
export const internalStaffStatusSchema = z.enum([
  "PASSWORD_SETUP_REQUIRED",
  "ACTIVE",
  "SUSPENDED",
]);
const internalStaffBaseSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  phone: mainlandChinaMobileSchema,
  role: internalStaffRoleSchema,
  accessRoleId: identifierSchema.optional(),
  pickupPointIds: z.array(identifierSchema).max(100).default([]),
});
export const createInternalStaffSchema = internalStaffBaseSchema.extend({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/),
  status: z.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
});
export const updateInternalStaffSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    phone: mainlandChinaMobileSchema.optional(),
    role: internalStaffRoleSchema.optional(),
    accessRoleId: identifierSchema.optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
    pickupPointIds: z.array(identifierSchema).max(100).optional(),
    reason: z.string().trim().min(2).max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提供一项员工变更",
  });
export const resetInternalStaffCredentialSchema = z.object({
  reason: z.string().trim().min(2).max(500),
});
export const archiveInternalStaffSchema = z.object({
  reason: z.string().trim().min(2).max(500),
});
export const internalStaffDirectoryQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
});

export const catalogSkuSchema = z.object({
  id: identifierSchema.optional(),
  productId: identifierSchema.optional(),
  categoryId: identifierSchema.nullable().optional(),
  title: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(40),
  origin: z.string().trim().min(2).max(160),
  imageUrl: z.string().trim().max(2048).nullable().default(null),
  imageUrls: z.array(z.string().trim().min(1).max(2048)).max(5).default([]),
  description: z.string().trim().max(300).default(""),
  detailImageUrls: z.array(z.string().trim().min(1).max(2048)).max(10).default([]),
  skuName: z.string().trim().min(1).max(160),
  retailPriceCents: z.int().min(1),
  defaultSellableQuantity: z.int().min(0).max(10_000_000).default(0),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export const productCategorySchema = z.object({
  id: identifierSchema.optional(),
  name: z.string().trim().min(2).max(40),
  sortOrder: z.int().min(0).max(1_000_000).default(0),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

/** Homepage merchandising content.  Image references are validated against
 * the product image service at the API boundary; the contract only carries
 * the stable public URL. */
export const homepageBannerSchema = z
  .object({
    id: identifierSchema.optional(),
    title: z.string().trim().min(2).max(80),
    subtitle: z.string().trim().max(120).default(""),
    imageUrl: z.string().trim().min(1).max(2048),
    targetType: z.enum(["NONE", "CAMPAIGN", "CATEGORY"]).default("NONE"),
    targetValue: identifierSchema.nullable().default(null),
    scope: z.enum(["ALL", "SERVICE_AREA"]).default("ALL"),
    serviceAreaId: identifierSchema.nullable().default(null),
    startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    sortOrder: z.int().min(0).max(1_000_000).default(0),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
    version: z.int().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.endsAt && value.startsAt && Date.parse(value.endsAt) < Date.parse(value.startsAt))
      context.addIssue({ code: "custom", path: ["endsAt"], message: "结束时间不能早于开始时间" });
    if (value.scope === "SERVICE_AREA" && !value.serviceAreaId)
      context.addIssue({ code: "custom", path: ["serviceAreaId"], message: "指定区域投放时必须选择服务区域" });
    if (value.scope === "ALL" && value.serviceAreaId)
      context.addIssue({ code: "custom", path: ["serviceAreaId"], message: "全量投放不能填写服务区域" });
    if (value.targetType === "NONE" && value.targetValue)
      context.addIssue({ code: "custom", path: ["targetValue"], message: "无跳转轮播不能填写跳转目标" });
    if (value.targetType !== "NONE" && !value.targetValue)
      context.addIssue({ code: "custom", path: ["targetValue"], message: "设置跳转目标时必须填写目标" });
  });

export const consumerProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(30).refine(
    (value) => ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    }),
    "姓名不能包含控制字符",
  ),
  avatarUrl: z.string().trim().max(2048).nullable(),
  expectedVersion: z.int().min(0).default(0),
});

export const phoneRebindSchema = z.object({
  phoneCode: z.string().trim().min(1).max(256),
  expectedVersion: z.int().min(0).default(0),
});
export const communityCampaignSchema = z
  .object({
    title: z.string().trim().min(2).max(80),
    serviceAreaId: identifierSchema,
    pickupPointId: identifierSchema,
    cutoffAt: z.iso.datetime({ offset: true }),
    dispatchAt: z.iso.datetime({ offset: true }),
    estimatedArrivalStartAt: z.iso.datetime({ offset: true }).nullable().default(null),
    estimatedArrivalEndAt: z.iso.datetime({ offset: true }).nullable().default(null),
    minTotalQuantity: z.int().min(1).max(1_000_000).default(1),
    failureAction: z.enum(["CANCEL_AND_REFUND", "POSTPONE"]),
    items: z
      .array(
        z.object({
          catalogSkuId: identifierSchema,
          retailPriceCents: z.int().min(1),
          sellableQuantity: z.int().min(1).max(1_000_000),
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine((value, context) => {
    if (Date.parse(value.dispatchAt) <= Date.parse(value.cutoffAt))
      context.addIssue({
        code: "custom",
        path: ["dispatchAt"],
        message: "发车时间必须晚于截团时间",
      });
    if (Boolean(value.estimatedArrivalStartAt) !== Boolean(value.estimatedArrivalEndAt))
      context.addIssue({
        code: "custom",
        path: [value.estimatedArrivalStartAt ? "estimatedArrivalEndAt" : "estimatedArrivalStartAt"],
        message: "预计到货开始和结束时间必须同时填写或同时留空",
      });
    if (value.estimatedArrivalStartAt && Date.parse(value.estimatedArrivalStartAt) < Date.parse(value.dispatchAt))
      context.addIssue({
        code: "custom",
        path: ["estimatedArrivalStartAt"],
        message: "预计到货开始时间不能早于发车时间",
      });
    if (value.estimatedArrivalStartAt && value.estimatedArrivalEndAt && Date.parse(value.estimatedArrivalEndAt) < Date.parse(value.estimatedArrivalStartAt))
      context.addIssue({
        code: "custom",
        path: ["estimatedArrivalEndAt"],
        message: "预计到货结束时间不能早于开始时间",
      });
    const seen = new Set<string>();
    for (const [index, item] of value.items.entries()) {
      if (seen.has(item.catalogSkuId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "catalogSkuId"],
          message: "同一商品不能重复添加",
        });
      }
      seen.add(item.catalogSkuId);
    }
  });
export const postponeCampaignSchema = z
  .object({
    cutoffAt: z.iso.datetime({ offset: true }),
    dispatchAt: z.iso.datetime({ offset: true }),
    estimatedArrivalStartAt: z.iso.datetime({ offset: true }).nullable().default(null),
    estimatedArrivalEndAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .superRefine((value, context) => {
    if (Date.parse(value.dispatchAt) <= Date.parse(value.cutoffAt))
      context.addIssue({
        code: "custom",
        path: ["dispatchAt"],
        message: "发车时间必须晚于截单时间",
      });
    if (Boolean(value.estimatedArrivalStartAt) !== Boolean(value.estimatedArrivalEndAt))
      context.addIssue({
        code: "custom",
        path: [value.estimatedArrivalStartAt ? "estimatedArrivalEndAt" : "estimatedArrivalStartAt"],
        message: "预计到货开始和结束时间必须同时填写或同时留空",
      });
    if (value.estimatedArrivalStartAt && Date.parse(value.estimatedArrivalStartAt) < Date.parse(value.dispatchAt))
      context.addIssue({
        code: "custom",
        path: ["estimatedArrivalStartAt"],
        message: "预计到货开始时间不能早于发车时间",
      });
    if (
      value.estimatedArrivalStartAt &&
      value.estimatedArrivalEndAt &&
      Date.parse(value.estimatedArrivalEndAt) <
      Date.parse(value.estimatedArrivalStartAt)
    )
      context.addIssue({
        code: "custom",
        path: ["estimatedArrivalEndAt"],
        message: "预计到货结束时间不能早于开始时间",
      });
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

export const adminOrderSearchQuerySchema = z.object({
  keyword: z.string().trim().max(80).default(""),
  status: z.enum([
    "PENDING_PAYMENT",
    "PAID_WAITING_CLOSE",
    "LOCKED",
    "ALLOCATING",
    "IN_TRANSIT",
    "READY_FOR_PICKUP",
    "PICKED_UP",
    "COMPLETED",
    "CANCELLING",
    "REFUNDING",
    "REFUNDED",
    "CANCELLED",
  ]).optional(),
  campaignId: identifierSchema.optional(),
  pickupPointId: identifierSchema.optional(),
  dateType: z.enum(["CREATED_AT", "PAID_AT"]).default("CREATED_AT"),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).superRefine((value, ctx) => {
  if (value.from && value.to && value.from > value.to)
    ctx.addIssue({ code: "custom", path: ["to"], message: "结束日期不能早于开始日期" });
});

export type AdminOrderSearchQuery = z.infer<typeof adminOrderSearchQuerySchema>;
export const cancelOrderSchema = z
  .object({ reason: z.string().trim().min(2).max(500).optional() })
  .strict();

export const openServiceAreaSchema = z.object({
  regionCode: z.string().regex(/^\d{6,12}$/),
});
export const updateServiceAreaOrderStatusSchema = z.object({
  orderEnabled: z.boolean(),
});
export const regionDirectoryQuerySchema = z.object({
  query: z.string().trim().max(80).optional().default(""),
});
export const geoSearchQuerySchema = z.object({
  query: z.string().trim().min(2).max(80),
});
export const geoReverseQuerySchema = z.object({
  latitude: z.coerce.number().finite().min(-90).max(90),
  longitude: z.coerce.number().finite().min(-180).max(180),
});
export const createPickupPointSchema = z.object({
  serviceAreaId: identifierSchema,
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(255),
  businessHours: z.string().trim().min(2).max(200),
  pickupInstructions: z.string().trim().min(2).max(500),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  contactName: z.string().trim().max(80).default(""),
  contactPhone: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^1[3-9]\d{9}$/.test(value),
      "请输入有效的中国大陆手机号",
    )
    .default(""),
  capacityPerDay: z.int().min(1).max(1_000_000).nullable().default(null),
  photoUrl: z.string().trim().min(1).max(2048),
  /**
   * A duplicate is only a review prompt.  The explicit acknowledgement is
   * intentionally carried on the write request rather than persisted as a
   * second location fact.
   */
  confirmDuplicate: z.boolean().optional().default(false),
});
export const updatePickupPointSchema = createPickupPointSchema
  .omit({ serviceAreaId: true })
  .partial()
  .extend({
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    capacityPerDay: z.int().min(1).max(1_000_000).nullable().optional(),
    // Defaults on create must not leak into PATCH, or a hours-only edit
    // would wipe the manager-synced contact.
    contactName: z.string().trim().max(80).optional(),
    contactPhone: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || /^1[3-9]\d{9}$/.test(value),
        "请输入有效的中国大陆手机号",
      )
      .optional(),
    confirmDuplicate: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提供一项自提点变更",
  });
export const batchCreatePickupPointsSchema = z.object({
  points: z
    .array(
      z.object({
        city: z.string().trim().min(2).max(80),
        name: z.string().trim().min(2).max(120),
        address: z.string().trim().min(5).max(255),
        businessHours: z.string().trim().min(2).max(200),
        pickupInstructions: z.string().trim().min(2).max(500),
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
        contactName: z.string().trim().max(80).default(""),
        contactPhone: z
          .string()
          .trim()
          .refine(
            (value) => value === "" || /^1[3-9]\d{9}$/.test(value),
            "请输入有效的中国大陆手机号",
          )
          .default(""),
        capacityPerDay: z.int().min(1).max(1_000_000).nullable().default(null),
        photoUrl: z.string().trim().min(1).max(2048),
      }),
    )
    .min(1)
    .max(500),
});

export const bookVehicleSchema = z.object({
  logisticsPlatform: z.string().trim().min(2).max(80),
  vehicleOrderNo: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().min(2).max(100).nullable().default(null),
  ),
  driverName: z.string().trim().min(2).max(80).nullable().default(null),
  driverPhone: mainlandChinaMobileSchema.nullable().default(null),
  vehiclePlate: z.string().trim().min(2).max(32).nullable().default(null),
  estimatedArrivalAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export const emergencyVehicleCorrectionSchema = bookVehicleSchema.extend({
  reason: z.string().trim().min(2).max(500),
});
export const createDispatchBatchSchema = z.object({
  campaignId: identifierSchema,
});
export const campaignCancelSchema = z.object({
  reason: z.string().trim().min(2).max(500),
});
export const campaignCloseSchema = z
  .object({ reason: z.string().trim().min(2).max(500).optional() })
  .default({});
export const fulfillmentExceptionTypeSchema = z.enum([
  "SHORT_RECEIPT",
  "QUALITY_REJECTED",
  "PACKAGE_DAMAGED",
  "TRANSIT_SHORTAGE",
  "TRANSIT_DAMAGE",
  "PICKUP_POINT_REJECTED",
  "PICKUP_SHORTAGE",
  "PICKUP_DAMAGE",
  "QUALITY_CLAIM",
]);
export const communityArrivalSchema = z
  .object({
    receivedBy: z.string().trim().min(2).max(120),
    confirmationNote: z.string().trim().max(500).nullable().default(null),
    emergencyReason: z.string().trim().min(2).max(500).nullable().default(null),
    items: z
      .array(
        z
          .object({
            catalogSkuId: identifierSchema,
            receivedQuantity: z.int().min(0),
            rejectedQuantity: z.int().min(0).default(0),
            shortQuantity: z.int().min(0).default(0),
            damagedQuantity: z.int().min(0).default(0),
            reason: fulfillmentExceptionTypeSchema.nullable().default(null),
            evidenceNote: z.string().trim().max(500).nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
const pickupOrderLookupFields = {
  deliveryPlanId: identifierSchema.optional(),
  orderNo: z.string().trim().min(1).max(64).optional(),
  pickupPointId: identifierSchema.optional(),
  code: z.string().regex(/^\d{6}$/).optional(),
} as const;
const pickupOrderLookupSchema = z.object(pickupOrderLookupFields).refine(
  (value) =>
    Boolean(value.deliveryPlanId && value.orderNo) ||
    Boolean(value.pickupPointId && value.code),
  {
    message:
      "查询订单需要配送计划号和订单号，或自提点号和六位取货码",
  },
);
export const pickupOrderLookupQuerySchema = pickupOrderLookupSchema;
export const pickupOrderLookupBodySchema = pickupOrderLookupSchema;
export const verifyPickupSchema = z.object({
  orderId: identifierSchema,
  deliveryPlanId: identifierSchema,
  code: z.string().regex(/^\d{6}$/),
  pickupRequestId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase())
    .optional(),
  items: z
    .array(
      z.object({
        catalogSkuId: identifierSchema,
        quantity: z.int().min(1).max(999),
      }),
    )
    .max(100)
    .optional(),
});

export const communityCancellationReviewSchema = z.object({
  approved: z.boolean(),
  note: z.string().trim().min(2).max(500),
});
export const communityPickupExtensionSchema = z.object({
  deadlineAt: z.iso.datetime({ offset: true }),
  note: z.string().trim().min(2).max(500),
});
export const communityPickupDispositionSchema = z.object({
  action: z.enum(["REFUND", "LOSS"]),
  note: z.string().trim().min(2).max(500),
});
export const partialRefundExecutionSchema = z.object({
  confirmationNote: z.string().trim().min(2).max(500),
});
export const communityQualityCaseSchema = z
  .object({
    clientRequestId: z.string().trim().min(8).max(64),
    items: z
      .array(
        z
          .object({
            catalogSkuId: identifierSchema,
            quantity: z.int().min(1).max(999),
            reason: z.enum([
              "PICKUP_SHORTAGE",
              "PICKUP_DAMAGE",
              "QUALITY_CLAIM",
            ]),
            description: z.string().trim().min(5).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, item] of value.items.entries()) {
      if (seen.has(item.catalogSkuId))
        context.addIssue({
          code: "custom",
          path: ["items", index, "catalogSkuId"],
          message: "同一商品请合并为一条品质申报",
        });
      seen.add(item.catalogSkuId);
    }
  });
export const communityQualityAcceptanceSchema = z.object({
  note: z.string().trim().min(2).max(500),
});
export const communityQualityDecisionSchema = z.object({
  approved: z.boolean(),
  note: z.string().trim().min(2).max(500),
});

export const createServiceAreaInterestSchema = z.object({
  regionText: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(80),
  contactPhone: mainlandChinaMobileSchema,
  privacyAccepted: z.literal(true),
  privacyVersion: privacyNoticeVersionSchema,
});
export const updateOwnServiceAreaInterestSchema =
  createServiceAreaInterestSchema;
export const updateServiceAreaInterestStatusSchema = z.object({
  status: z.enum(["CONTACTED", "CLOSED"]),
  note: z.string().trim().min(2).max(500),
});
export const notificationManualCompletionSchema = z.object({
  note: z.string().trim().min(2).max(500),
  channel: z.enum([
    "WECHAT_CUSTOMER_SERVICE",
    "EXTERNAL_CRM",
    "OTHER_APPROVED_CHANNEL",
  ]),
  externalReference: z.string().trim().min(4).max(120),
  result: z.enum([
    "REACHED",
    "USER_ACKNOWLEDGED",
    "RESOLVED",
  ]),
});
export const notificationPreferenceSchema = z.object({
  templateIds: z.record(z.string(), z.string().trim().min(1).max(128)).optional(),
  types: z
    .array(
      z.enum([
        "SITE_CONFIRMED",
        "VEHICLE_DISPATCHED",
        "ARRIVED",
        "PARTIAL_REFUND",
        "PICKUP_DEADLINE",
        "PICKUP_EXPIRED",
        "CAMPAIGN_POSTPONED",
      ]),
    )
    .max(7),
});

export type CommunityCampaignInput = z.infer<typeof communityCampaignSchema>;
export type PostponeCampaignInput = z.infer<typeof postponeCampaignSchema>;
export type OrderRequest = z.infer<typeof orderRequestSchema>;
export type OpenServiceAreaInput = z.infer<typeof openServiceAreaSchema>;
export type CreatePickupPointInput = z.infer<typeof createPickupPointSchema>;
export type UpdatePickupPointInput = z.infer<typeof updatePickupPointSchema>;
export type BatchCreatePickupPointsInput = z.infer<
  typeof batchCreatePickupPointsSchema
>;
export type BookVehicleInput = z.infer<typeof bookVehicleSchema>;
export type EmergencyVehicleCorrectionInput = z.infer<
  typeof emergencyVehicleCorrectionSchema
>;
export type CreateInternalStaffInput = z.infer<
  typeof createInternalStaffSchema
>;
export type UpdateInternalStaffInput = z.infer<
  typeof updateInternalStaffSchema
>;

export interface ApiErrorResponse {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
}

export * from "./access-control.js";
