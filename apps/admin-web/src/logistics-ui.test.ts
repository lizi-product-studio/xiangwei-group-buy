import { describe, expect, it } from "vitest";
import {
  adminLoadErrorText,
  apiUnavailableMessage,
  getDeliveryActionLabels,
  getLogisticsViewState,
} from "./logistics-ui.ts";

describe("logistics loading and action states", () => {
  it("never presents an unavailable API as an empty table", () => {
    expect(
      getLogisticsViewState({
        loading: false,
        error: apiUnavailableMessage,
        planCount: 0,
      }),
    ).toBe("error");
    expect(adminLoadErrorText({ statusCode: 500, message: "请求失败（500）" })).toBe(
      apiUnavailableMessage,
    );
  });

  it("keeps a successful empty response distinct from loading and error", () => {
    expect(getLogisticsViewState({ loading: true, error: null, planCount: 0 })).toBe(
      "loading",
    );
    expect(getLogisticsViewState({ loading: false, error: null, planCount: 0 })).toBe(
      "empty",
    );
    expect(getLogisticsViewState({ loading: false, error: null, planCount: 1 })).toBe(
      "ready",
    );
  });

  it("preserves the transport action matrix for operators", () => {
    expect(
      getDeliveryActionLabels({
        status: "SITE_CONFIRMED",
        canOperate: true,
        emergencyProxy: false,
      }),
    ).toEqual(["登记运输信息"]);
    expect(
      getDeliveryActionLabels({
        status: "VEHICLE_BOOKED",
        canOperate: true,
        emergencyProxy: false,
        batchStatus: "DRAFT",
      }),
    ).toEqual(["编辑运输信息", "确认发车"]);
    expect(
      getDeliveryActionLabels({
        status: "IN_TRANSIT",
        canOperate: true,
        emergencyProxy: false,
      }),
    ).toEqual([]);
    expect(
      getDeliveryActionLabels({
        status: "IN_TRANSIT",
        canOperate: false,
        emergencyProxy: true,
      }),
    ).toEqual(["紧急纠正运输信息"]);
  });
});
