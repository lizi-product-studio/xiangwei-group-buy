import { describe, expect, it } from "vitest";
import {
  canSubmitCommunityQualityCase,
  COMMUNITY_QUALITY_TEXT_ONLY_HINT,
  communityQualityCaseStatusText,
} from "./community-quality";

describe("community quality entry", () => {
  const deadline = "2026-08-17T00:00:00.000Z";

  it("only exposes the text-only quality entry for a picked-up community order inside 24 hours", () => {
    expect(
      canSubmitCommunityQualityCase(
        { status: "READY_FOR_PICKUP", qualityDeadlineAt: deadline },
        Date.parse(deadline) - 1,
      ),
    ).toBe(true);
    expect(
      canSubmitCommunityQualityCase(
        { status: "PICKED_UP", qualityDeadlineAt: deadline },
        Date.parse(deadline),
      ),
    ).toBe(false);
    expect(
      canSubmitCommunityQualityCase(
        { status: "READY_FOR_PICKUP", qualityDeadlineAt: null },
        Date.parse(deadline) - 1,
      ),
    ).toBe(false);
    expect(COMMUNITY_QUALITY_TEXT_ONLY_HINT).toContain("文字说明");
  });

  it("renders a user-facing pending status rather than an internal enum", () => {
    expect(communityQualityCaseStatusText("REGISTERED")).toBe("待客服受理");
    expect(communityQualityCaseStatusText("REFUNDING")).toBe("退款处理中");
  });
});
