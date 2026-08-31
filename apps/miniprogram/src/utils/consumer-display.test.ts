import { describe, expect, it } from "vitest";
import {
  campaignPaidQuantity,
  campaignProgressPercent,
  cancellationStatusText,
  cutoffCountdown,
  estimatedArrivalText,
  formatChinaDateTime,
  isCampaignPurchasable,
  orderStatusCopy,
  pickupDeadlineText,
  pickupWindowStatusText,
  qualityDeadlineText,
  refundStatusText,
  shouldShowFloatingCart,
  unformedRuleText,
} from "./consumer-display";

describe("consumer launch display rules", () => {
  it("renders China-time cutoff and exact countdown, then closes at zero", () => {
    const cutoff = "2026-08-21T16:00:00.000Z";
    expect(formatChinaDateTime(cutoff, true)).toBe("08月22日 00:00:00");
    expect(cutoffCountdown(cutoff, Date.parse("2026-08-20T15:59:58.000Z"))).toBe(
      "剩 1天 00:00:02",
    );
    expect(cutoffCountdown(cutoff, Date.parse(cutoff))).toBe("已截单");
  });

  it("requires a configured campaign arrival window before an open campaign is buyable", () => {
    const base = {
      status: "OPEN" as const,
      cutoffAt: "2026-08-22T00:00:00.000Z",
      estimatedArrivalStartAt: null,
      estimatedArrivalEndAt: null,
    };
    expect(isCampaignPurchasable(base, Date.parse("2026-08-21T00:00:00.000Z"))).toBe(false);
    expect(
      isCampaignPurchasable(
        {
          ...base,
          estimatedArrivalStartAt: "2026-08-23T01:00:00.000Z",
          estimatedArrivalEndAt: "2026-08-23T03:30:00.000Z",
        },
        Date.parse("2026-08-21T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isCampaignPurchasable(
        {
          ...base,
          estimatedArrivalStartAt: "2026-08-23T03:30:00.000Z",
          estimatedArrivalEndAt: "2026-08-23T01:00:00.000Z",
        },
        Date.parse("2026-08-21T00:00:00.000Z"),
      ),
    ).toBe(false);
    expect(estimatedArrivalText({
      estimatedArrivalStartAt: "2026-08-23T01:00:00.000Z",
      estimatedArrivalEndAt: "2026-08-23T03:30:00.000Z",
    })).toBe("08月23日 09:00—08月23日 11:30");
  });

  it("uses paid quantity rather than reserved stock for the group progress", () => {
    expect(campaignPaidQuantity({ paidQuantity: 7 })).toBe(7);
    expect(campaignPaidQuantity({})).toBe(0);
    expect(campaignProgressPercent(7, 10)).toBe(70);
    expect(campaignProgressPercent(11, 10)).toBe(100);
  });

  it("explains both allowed failure actions without exposing enum values", () => {
    expect(unformedRuleText({ failureAction: "CANCEL_AND_REFUND" })).toContain("全额退款");
    expect(unformedRuleText({ failureAction: "POSTPONE" })).toContain("延期一次");
  });

  it("shows exact pickup and per-receipt quality deadlines across China calendar days", () => {
    expect(pickupDeadlineText("2026-08-24T15:59:59.000Z")).toBe(
      "领取截止：08月24日 23:59:59（中国时间）",
    );
    expect(qualityDeadlineText("2026-08-25T16:00:00.000Z")).toBe(
      "品质售后截止：08月26日 00:00:00（本次领取后24小时）",
    );
    expect(pickupDeadlineText()).toContain("第3个自然日 23:59:59");
  });

  it("never exposes unknown technical status codes to consumers", () => {
    expect(orderStatusCopy("FUTURE_INTERNAL_STATE").text).toBe("订单状态已更新");
    expect(pickupWindowStatusText("FUTURE_INTERNAL_STATE")).toBe("领取安排已更新，请查看截止时间");
    expect(cancellationStatusText("FUTURE_INTERNAL_STATE")).toBe("取消申请状态已更新");
    expect(refundStatusText("FUTURE_INTERNAL_STATE")).toBe("退款状态已更新");
  });

  it("keeps the fixed cart entry absent for empty carts", () => {
    expect(shouldShowFloatingCart(0)).toBe(false);
    expect(shouldShowFloatingCart(-1)).toBe(false);
    expect(shouldShowFloatingCart(2)).toBe(true);
  });
});
