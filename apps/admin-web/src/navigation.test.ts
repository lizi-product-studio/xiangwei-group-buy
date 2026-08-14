import { describe, expect, it } from "vitest";
import { getAdminNavigation } from "./navigation.ts";

const visibleItems = (roles: string[]) => getAdminNavigation(roles).flatMap((group) => group.items);

describe("admin navigation", () => {
  it.each([
    ["SUPER_ADMIN", ["SUPER_ADMIN"]],
    ["OPERATOR", ["OPERATOR"]],
    ["CUSTOMER_SERVICE", ["CUSTOMER_SERVICE"]],
    ["FINANCE", ["FINANCE"]],
    ["PICKUP_MANAGER", ["PICKUP_MANAGER"]],
  ])("keeps every visible page and business menu unique for %s", (_role, roles) => {
    const items = visibleItems(roles);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    expect(new Set(items.map((item) => item.label)).size).toBe(items.length);
  });

  it("gives a super administrator the complete PRD primary navigation once", () => {
    const groups = getAdminNavigation(["SUPER_ADMIN"]);
    expect(groups.map((group) => group.label)).toEqual(["日常运营", "履约管理", "客户与资金", "系统"]);
    expect(groups.flatMap((group) => group.items.map((item) => item.label))).toEqual([
      "工作台", "商品管理", "团期管理", "订单管理", "物流管理", "自提点管理", "售后与异常", "财务管理", "系统设置",
    ]);
  });

  it("keeps a pickup manager in the isolated point workbench", () => {
    expect(getAdminNavigation(["PICKUP_MANAGER"])).toEqual([
      { label: "点位工作台", items: [{ key: "point-workbench", label: "我的点位工作台", roles: ["PICKUP_MANAGER", "PICKUP_VERIFIER"] }] },
    ]);
  });
});
