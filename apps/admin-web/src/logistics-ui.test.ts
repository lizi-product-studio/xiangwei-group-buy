import { describe, expect, it } from "vitest";
import {
  adminLoadErrorText,
  apiUnavailableMessage,
  getDeliveryActionLabels,
  getDeliveryNextStep,
  dispatchBlockReason,
  dispatchFailureText,
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

  it.each(["CANCELLED", "COMPLETED"] as const)(
    "hides every transport action and explains terminal campaign status: %s",
    (campaignStatus) => {
      expect(
        getDeliveryActionLabels({
          status: "VEHICLE_BOOKED",
          canOperate: true,
          emergencyProxy: true,
          campaignStatus,
        }),
      ).toEqual([]);
      expect(
        getDeliveryActionLabels({
          status: "IN_TRANSIT",
          canOperate: true,
          emergencyProxy: true,
          campaignStatus,
        }),
      ).toEqual([]);
      expect(getDeliveryNextStep({ status: "VEHICLE_BOOKED", campaignStatus })).toBe(
        campaignStatus === "CANCELLED" ? "团期已取消" : "团期已完成",
      );
    },
  );

  it("describes the next business step without repeating the status", () => {
    expect(getDeliveryNextStep({ status: "SITE_CONFIRMED" })).toBe("登记运输信息");
    expect(getDeliveryNextStep({ status: "VEHICLE_BOOKED", batchStatus: "DRAFT" })).toBe("确认装袋并发车");
    expect(getDeliveryNextStep({ status: "IN_TRANSIT", batchStatus: "IN_TRANSIT" })).toBe("等待自提点确认到货");
    expect(getDeliveryNextStep({ status: "ARRIVED" })).toBe("已完成");
  });
});


describe("dispatch review prerequisites", () => {
  it("blocks an unclosed campaign even after booking transport", () => {
    expect(dispatchBlockReason({ campaignStatus: "OPEN", planStatus: "VEHICLE_BOOKED" })).toContain("成团锁单");
    expect(dispatchBlockReason({ campaignStatus: "CANCELLED", planStatus: "VEHICLE_BOOKED" })).toContain("已取消");
    expect(dispatchBlockReason({ planStatus: "VEHICLE_BOOKED" })).toContain("尚未加载");
  });
  it("allows a locked campaign and retries its existing draft batch during fulfillment", () => {
    expect(dispatchBlockReason({ campaignStatus: "LOCKED", planStatus: "VEHICLE_BOOKED" })).toBeNull();
    expect(dispatchBlockReason({ campaignStatus: "FULFILLING", planStatus: "VEHICLE_BOOKED", batchStatus: "DRAFT" })).toBeNull();
    expect(dispatchBlockReason({ campaignStatus: "FULFILLING", planStatus: "IN_TRANSIT", batchStatus: "IN_TRANSIT" })).toContain("已发车");
    expect(getDeliveryActionLabels({ status: "VEHICLE_BOOKED", batchStatus: "IN_TRANSIT", canOperate: true, emergencyProxy: false })).toEqual(["编辑运输信息"]);
    expect(dispatchBlockReason({ campaignStatus: "LOCKED", planStatus: "SITE_CONFIRMED" })).toContain("运输信息");
    expect(getDeliveryActionLabels({ status: "SITE_CONFIRMED", canOperate: true, emergencyProxy: false, campaignStatus: "POSTPONED" })).toEqual(["登记运输信息"]);
  });
  it("explains dispatch-specific 409s without displaying arbitrary server messages", () => {
    expect(dispatchFailureText({ code: "INVALID_STATE_TRANSITION", message: "只有已成团锁单的团期可以创建发车批次" }, "通用提示")).toContain("尚未成团锁单");
    expect(dispatchFailureText({ code: "DELIVERY_PLAN_NOT_READY" }, "通用提示")).toContain("重新登记");
    expect(dispatchFailureText({ code: "INVALID_STATE_TRANSITION", message: "untrusted detail" }, "通用提示")).toBe("通用提示");
  });
});
