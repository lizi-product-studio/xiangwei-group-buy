import { describe, expect, it } from "vitest";
import {
  communityCampaignSchema,
  communityQualityCaseSchema,
  createPickupPointSchema,
  updatePickupPointSchema,
  postponeCampaignSchema,
  createServiceAreaInterestSchema,
  createInternalStaffSchema,
  notificationManualCompletionSchema,
  wechatLoginSchema,
} from "./index.js";

describe("public API contracts", () => {
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
        estimatedArrivalStartAt: undefined,
      }).success,
    ).toBe(false);
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
