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

export const wechatLoginSchema = z.object({
  code: z.string().trim().min(6).max(128),
  privacyAccepted: z.literal(true),
  privacyVersion: privacyNoticeVersionSchema,
});
export const adminLoginSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/),
  password: z.string().min(12).max(128),
});
export const internalStaffRoleSchema = z.enum([
  "SUPER_ADMIN",
  "OPERATOR",
  "CUSTOMER_SERVICE",
  "FINANCE",
  "PICKUP_MANAGER",
]);
export const internalStaffStatusSchema = z.enum([
  "PENDING_ACTIVATION",
  "ACTIVE",
  "SUSPENDED",
]);
const internalStaffBaseSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  phone: mainlandChinaMobileSchema,
  role: internalStaffRoleSchema,
  pickupPointIds: z.array(identifierSchema).max(100).default([]),
});
export const createInternalStaffSchema = internalStaffBaseSchema.extend({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/),
  status: z
    .enum(["PENDING_ACTIVATION", "SUSPENDED"])
    .default("PENDING_ACTIVATION"),
});
export const updateInternalStaffSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    phone: mainlandChinaMobileSchema.optional(),
    role: internalStaffRoleSchema.optional(),
    status: internalStaffStatusSchema.optional(),
    pickupPointIds: z.array(identifierSchema).max(100).optional(),
    reason: z.string().trim().min(2).max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提供一项员工变更",
  });
export const resetInternalStaffCredentialSchema = z.object({
  reason: z.string().trim().min(2).max(500),
});
export const activateAdminStaffSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/),
  initialCredential: z.string().min(12).max(128),
  newPassword: z.string().min(12).max(128),
});
export const internalStaffDirectoryQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
});

export const catalogSkuSchema = z.object({
  id: identifierSchema.optional(),
  productId: identifierSchema.optional(),
  title: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(40),
  origin: z.string().trim().min(2).max(160),
  imageUrl: z.string().trim().max(2048).nullable().default(null),
  skuName: z.string().trim().min(1).max(160),
  retailPriceCents: z.int().min(1),
  defaultSellableQuantity: z.int().min(0).max(10_000_000).default(0),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export const communityCampaignSchema = z
  .object({
    title: z.string().trim().min(2).max(80),
    serviceAreaId: identifierSchema,
    pickupPointId: identifierSchema,
    cutoffAt: z.iso.datetime({ offset: true }),
    dispatchAt: z.iso.datetime({ offset: true }),
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
  });
export const postponeCampaignSchema = z
  .object({
    cutoffAt: z.iso.datetime({ offset: true }),
    dispatchAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    if (Date.parse(value.dispatchAt) <= Date.parse(value.cutoffAt))
      context.addIssue({
        code: "custom",
        path: ["dispatchAt"],
        message: "发车时间必须晚于截单时间",
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
export const createPickupPointSchema = z.object({
  serviceAreaId: identifierSchema,
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(255),
  capacityPerDay: z.int().min(1).max(1_000_000).nullable().default(null),
});
export const batchCreatePickupPointsSchema = z.object({
  points: z
    .array(
      z.object({
        city: z.string().trim().min(2).max(80),
        name: z.string().trim().min(2).max(120),
        address: z.string().trim().min(5).max(255),
        capacityPerDay: z.int().min(1).max(1_000_000).nullable().default(null),
      }),
    )
    .min(1)
    .max(500),
});

export const bookVehicleSchema = z.object({
  logisticsPlatform: z.string().trim().min(2).max(80),
  vehicleOrderNo: z.string().trim().min(2).max(100),
  driverName: z.string().trim().min(2).max(80).nullable().default(null),
  driverPhone: mainlandChinaMobileSchema.nullable().default(null),
  vehiclePlate: z.string().trim().min(2).max(32).nullable().default(null),
  estimatedArrivalAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export const createDispatchBatchSchema = z.object({
  campaignId: identifierSchema,
});
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
export const pickupOrderLookupQuerySchema = z.object({
  deliveryPlanId: identifierSchema,
  orderNo: z.string().trim().min(1).max(64),
});
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
export const updateServiceAreaInterestStatusSchema = z.object({
  status: z.enum(["CONTACTED", "CLOSED"]),
});
export const notificationPreferenceSchema = z.object({
  types: z
    .array(
      z.enum([
        "SITE_CONFIRMED",
        "VEHICLE_DISPATCHED",
        "ARRIVED",
        "PARTIAL_REFUND",
        "PICKUP_DEADLINE",
        "PICKUP_EXPIRED",
      ]),
    )
    .max(6),
});

export type CommunityCampaignInput = z.infer<typeof communityCampaignSchema>;
export type PostponeCampaignInput = z.infer<typeof postponeCampaignSchema>;
export type OrderRequest = z.infer<typeof orderRequestSchema>;
export type OpenServiceAreaInput = z.infer<typeof openServiceAreaSchema>;
export type CreatePickupPointInput = z.infer<typeof createPickupPointSchema>;
export type BatchCreatePickupPointsInput = z.infer<
  typeof batchCreatePickupPointsSchema
>;
export type BookVehicleInput = z.infer<typeof bookVehicleSchema>;
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
