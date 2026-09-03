import { describe, expect, it } from "vitest";
import {
  getAdminNavigation,
  getDefaultAdminPage,
  isAllowedAdminPage,
} from "./navigation.ts";

const visibleItems = (roles: string[]) =>
  getAdminNavigation(roles).flatMap((group) => group.items);

describe("admin navigation", () => {
  it.each([
    ["SUPER_ADMIN", ["SUPER_ADMIN"]],
    ["OPERATOR", ["OPERATOR"]],
    ["CUSTOMER_SERVICE", ["CUSTOMER_SERVICE"]],
    ["FINANCE", ["FINANCE"]],
    ["PICKUP_MANAGER", ["PICKUP_MANAGER"]],
  ])(
    "keeps every visible page and business menu unique for %s",
    (_role, roles) => {
      const items = visibleItems(roles);
      expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
      expect(new Set(items.map((item) => item.label)).size).toBe(items.length);
    },
  );

  it("gives a super administrator the complete PRD primary navigation once", () => {
    const groups = getAdminNavigation(["SUPER_ADMIN"]);
    expect(groups.map((group) => group.label)).toEqual([
      "日常运营",
      "履约管理",
      "客户与资金",
      "权限与审计",
    ]);
    expect(
      groups.flatMap((group) => group.items.map((item) => item.label)),
    ).toEqual([
      "工作台",
      "商品管理",
      "团期管理",
      "订单管理",
      "配送与到货",
      "区域与自提点",
      "售后与异常",
      "运营治理",
      "财务管理",
      "审计记录",
      "人员与权限",
    ]);
  });

  it("keeps a pickup manager in the isolated point workbench", () => {
    expect(getAdminNavigation(["PICKUP_MANAGER"])).toEqual([
      {
        label: "点位工作台",
        items: [
          {
            key: "point-workbench",
            label: "我的点位工作台",
            roles: ["PICKUP_MANAGER"],
          },
        ],
      },
    ]);
  });

  it.each([
    ["SUPER_ADMIN", ["SUPER_ADMIN"], "settings"],
    ["OPERATOR", ["OPERATOR"], "dashboard"],
    ["CUSTOMER_SERVICE", ["CUSTOMER_SERVICE"], "service"],
    ["FINANCE", ["FINANCE"], "finance"],
    ["PICKUP_MANAGER", ["PICKUP_MANAGER"], "point-workbench"],
  ])("uses an allowed first page for %s", (_role, roles, page) => {
    expect(getDefaultAdminPage(roles)).toBe(page);
    expect(isAllowedAdminPage(roles, page as never)).toBe(true);
  });

  it("never gives a consumer an admin default page", () => {
    expect(getDefaultAdminPage(["USER"])).toBeNull();
  });
});
