import { describe, expect, it } from "vitest";
import {
  communityCampaignSchema,
  communityQualityCaseSchema,
  createServiceAreaInterestSchema,
  createInternalStaffSchema,
  wechatLoginSchema,
} from "./index.js";

describe("public API contracts", () => {
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
