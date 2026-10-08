import { describe, expect, it } from "vitest";
import {
  communityCampaignSchema,
  communityQualityCaseSchema,
  createPickupPointSchema,
  updatePickupPointSchema,
  postponeCampaignSchema,
  createServiceAreaInterestSchema,
  createInternalStaffSchema,
  updateInternalStaffSchema,
  adminLoginSchema,
  completeAdminPasswordChangeSchema,
  notificationManualCompletionSchema,
  wechatLoginSchema,
  productCategorySchema,
  catalogSkuSchema,
  bookVehicleSchema,
} from "./index.js";

describe("public API contracts", () => {
  it("allows optional arrival windows and normalizes an empty transport number", () => {
    const campaign = {
      title: "无预计到货团期",
      serviceAreaId: "area-1",
      pickupPointId: "point-1",
      cutoffAt: "2030-01-01T08:00:00+08:00",
      dispatchAt: "2030-01-02T08:00:00+08:00",
      estimatedArrivalStartAt: null,
      estimatedArrivalEndAt: null,
      failureAction: "CANCEL_AND_REFUND",
      items: [{ catalogSkuId: "sku-1", retailPriceCents: 100, sellableQuantity: 1 }],
    } as const;
    expect(communityCampaignSchema.safeParse(campaign).success).toBe(true);
    expect(bookVehicleSchema.parse({ logisticsPlatform: "平台自送", vehicleOrderNo: "" }).vehicleOrderNo).toBeNull();
    expect(bookVehicleSchema.parse({ logisticsPlatform: "第三方车队", vehicleOrderNo: "OLD-1" }).vehicleOrderNo).toBe("OLD-1");
  });
  it("allows eight-character administrator passwords and validates password-change challenges", () => {
    expect(
      adminLoginSchema.safeParse({ username: "ops.admin", password: "Eight123" }).success,
    ).toBe(true);
    expect(
      adminLoginSchema.safeParse({ username: "ops.admin", password: "Seven12" }).success,
    ).toBe(false);
    expect(
      completeAdminPasswordChangeSchema.safeParse({
        passwordChangeToken: "x".repeat(32),
        newPassword: "Eight123",
      }).success,
    ).toBe(true);
    expect(
      completeAdminPasswordChangeSchema.safeParse({
        passwordChangeToken: "x".repeat(31),
        newPassword: "Eight123",
      }).success,
    ).toBe(false);
  });

  it("rejects historical and credential-owned employee states on current writes", () => {
    const base = {
      displayName: "测试员工",
      username: "staff.test",
      phone: "13800138000",
      role: "OPERATOR",
      pickupPointIds: [],
    };
    expect(createInternalStaffSchema.safeParse({ ...base, status: "PENDING_ACTIVATION" }).success).toBe(false);
    expect(createInternalStaffSchema.safeParse({ ...base, status: "PASSWORD_SETUP_REQUIRED" }).success).toBe(false);
    expect(updateInternalStaffSchema.safeParse({ status: "PENDING_ACTIVATION" }).success).toBe(false);
    expect(updateInternalStaffSchema.safeParse({ status: "PASSWORD_SETUP_REQUIRED" }).success).toBe(false);
    expect(updateInternalStaffSchema.safeParse({ status: "ACTIVE" }).success).toBe(true);
  });

  it("requires valid product category names and sortable lifecycle values", () => {
    expect(productCategorySchema.safeParse({ name: "蔬菜" }).success).toBe(true);
    expect(productCategorySchema.safeParse({ name: "蔬菜" }).success).toBe(true);
    expect(productCategorySchema.safeParse({ name: "蔬菜", iconKey: "unknown" }).success).toBe(false);
    expect(productCategorySchema.safeParse({ name: "A" }).success).toBe(false);
    expect(productCategorySchema.safeParse({ name: "蔬菜", sortOrder: -1 }).success).toBe(false);
  });

  it("accepts a category reference on a catalog SKU without changing the one-SKU shape", () => {
    expect(
      catalogSkuSchema.safeParse({
        title: "本地时蔬",
        category: "蔬菜",
        categoryId: "category-1",
        origin: "本地农场",
        skuName: "500克/袋",
        retailPriceCents: 1990,
        defaultSellableQuantity: 20,
      }).success,
    ).toBe(true);
  });
  it("does not allow an unanswered contact attempt to close a notification", () => {
    const evidence = {
      note: "已通过批准渠道联系",
      channel: "WECHAT_CUSTOMER_SERVICE",
      externalReference: "wx-session-001",
      result: "USER_ACKNOWLEDGED",
    };
    expect(notificationManualCompletionSchema.safeParse(evidence).success).toBe(true);
    expect(
      notificationManualCompletionSchema.safeParse({ ...evidence, result: "NO_RESPONSE" }).success,
    ).toBe(false);
  });

  it("accepts only an explicit mainland mobile number for a service-area interest", () => {
    expect(
      createServiceAreaInterestSchema.safeParse({
        regionText: "测试区域",
        contactName: "测试用户",
        contactPhone: "13800000000",
        privacyAccepted: true,
        privacyVersion: "2026-08-12",
      }).success,
    ).toBe(true);
    expect(
      createServiceAreaInterestSchema.safeParse({
        regionText: "测试区域",
        contactName: "测试用户",
        contactPhone: "123456",
        privacyAccepted: true,
        privacyVersion: "2026-08-12",
      }).success,
    ).toBe(false);
  });

  it("requires an explicit, versioned privacy acceptance for WeChat login", () => {
    expect(
      wechatLoginSchema.safeParse({
        code: "wechat-code-123",
        privacyAccepted: true,
        privacyVersion: "2026-08-12",
      }).success,
    ).toBe(true);
    expect(
      wechatLoginSchema.safeParse({
        code: "wechat-code-123",
        privacyAccepted: false,
        privacyVersion: "2026-08-12",
      }).success,
    ).toBe(false);
    expect(
      wechatLoginSchema.safeParse({
        code: "wechat-code-123",
        privacyAccepted: true,
      }).success,
    ).toBe(false);
  });

  it("accepts only a nonempty bounded optional phone authorization code", () => {
    const input = { code: "wechat-code-123", privacyAccepted: true, privacyVersion: "2026-09-07-phone-v1" };
    expect(wechatLoginSchema.safeParse({ ...input, phoneCode: "phone-code" }).success).toBe(true);
    for (const phoneCode of ["", " ", 123, "x".repeat(257), null]) {
      expect(wechatLoginSchema.safeParse({ ...input, phoneCode }).success).toBe(false);
    }
  });

  it("requires pickup managers to be created through the staff directory", () => {
    const input = {
      displayName: "点位负责人",
      username: "point.manager",
      phone: "13800000000",
      role: "PICKUP_MANAGER",
      pickupPointIds: ["point-1"],
    };
    expect(createInternalStaffSchema.safeParse(input).success).toBe(true);
    expect(
      createInternalStaffSchema.safeParse({
        ...input,
        role: "UNSUPPORTED_ROLE",
      }).success,
    ).toBe(false);
  });

  it("requires one fixed pickup point and configured catalog items for a campaign", () => {
    const input = {
      title: "周末社区团",
      serviceAreaId: "area-1",
      pickupPointId: "point-1",
      cutoffAt: "2026-08-22T10:00:00+08:00",
      dispatchAt: "2026-08-22T12:00:00+08:00",
      estimatedArrivalStartAt: "2026-08-22T14:00:00+08:00",
      estimatedArrivalEndAt: "2026-08-22T16:00:00+08:00",
      failureAction: "CANCEL_AND_REFUND",
      items: [
        {
          catalogSkuId: "sku-1",
          retailPriceCents: 1990,
          sellableQuantity: 100,
        },
      ],
    };
    expect(communityCampaignSchema.safeParse(input).success).toBe(true);
    expect(
      communityCampaignSchema.safeParse({ ...input, pickupPointId: "" })
        .success,
    ).toBe(false);
    expect(
      communityCampaignSchema.safeParse({
        ...input,
        estimatedArrivalStartAt: null,
        estimatedArrivalEndAt: null,
      }).success,
    ).toBe(true);
    expect(
      communityCampaignSchema.safeParse({
        ...input,
        estimatedArrivalStartAt: "2026-08-22T11:00:00+08:00",
      }).success,
    ).toBe(false);
  });

  it("allows creating a pickup point before a manager is assigned", () => {
    const input = {
      serviceAreaId: "area-1",
      name: "社区东门自提点",
      address: "东门服务站 1 号",
      businessHours: "09:00-20:00",
      pickupInstructions: "请从东门进入并出示核销码",
      latitude: 39.9042,
      longitude: 116.4074,
      capacityPerDay: null,
      photoUrl: "https://example.com/pickup.jpg",
    };
    expect(createPickupPointSchema.parse(input)).toMatchObject({
      contactName: "",
      contactPhone: "",
    });
    expect(
      createPickupPointSchema.safeParse({
        ...input,
        contactName: "张店长",
        contactPhone: "13800000000",
      }).success,
    ).toBe(true);
    expect(
      createPickupPointSchema.safeParse({
        ...input,
        contactPhone: "123",
      }).success,
    ).toBe(false);
    expect(
      createPickupPointSchema.safeParse({ ...input, latitude: 91 }).success,
    ).toBe(false);
    expect(updatePickupPointSchema.parse({ businessHours: "08:30-21:00" })).toEqual(
      { businessHours: "08:30-21:00" },
    );
    expect(
      createPickupPointSchema.parse({ ...input, confirmDuplicate: true })
        .confirmDuplicate,
    ).toBe(true);
    expect(
      updatePickupPointSchema.parse({
        address: "东门服务站 1 号",
        confirmDuplicate: true,
      }).confirmDuplicate,
    ).toBe(true);
  });

  it("keeps the arrival window valid when a postponed campaign reopens", () => {
    const input = {
      cutoffAt: "2026-08-23T10:00:00+08:00",
      dispatchAt: "2026-08-23T12:00:00+08:00",
      estimatedArrivalStartAt: "2026-08-23T14:00:00+08:00",
      estimatedArrivalEndAt: "2026-08-23T16:00:00+08:00",
    };
    expect(postponeCampaignSchema.safeParse(input).success).toBe(true);
    expect(
      postponeCampaignSchema.safeParse({
        ...input,
        estimatedArrivalEndAt: undefined,
      }).success,
    ).toBe(false);
    expect(
      postponeCampaignSchema.safeParse({
        ...input,
        estimatedArrivalStartAt: "2026-08-23T11:00:00+08:00",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate product lines in one quality case", () => {
    const item = {
      catalogSkuId: "sku-1",
      quantity: 1,
      reason: "QUALITY_CLAIM",
      description: "商品品质不符合预期",
    };
    expect(
      communityQualityCaseSchema.safeParse({
        clientRequestId: "request-123",
        items: [item],
      }).success,
    ).toBe(true);
    expect(
      communityQualityCaseSchema.safeParse({
        clientRequestId: "request-123",
        items: [item, item],
      }).success,
    ).toBe(false);
  });
});
