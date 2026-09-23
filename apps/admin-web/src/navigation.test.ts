import { describe, expect, it } from "vitest";
import {
  getAdminNavigation,
  getAdminNavigationPath,
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
      "工作台", "商品与营销", "订单与售后", "履约", "自提点与区域", "用户与通知", "财务", "系统",
    ]);
    expect(groups.flatMap(group => group.items.map(item => item.key))).toContain("categories");
    expect(groups.flatMap(group => group.items.map(item => item.key))).toContain("finance-ledger");
    expect(groups.flatMap(group => group.items.map(item => item.key))).toContain("homepage-banners");
  });

  it("limits the consumer directory to super administrators and customer service", () => {
    for (const role of ["SUPER_ADMIN", "CUSTOMER_SERVICE"]) expect(isAllowedAdminPage([role], "consumers")).toBe(true);
    for (const role of ["OPERATOR", "FINANCE", "PICKUP_MANAGER", "USER"]) expect(isAllowedAdminPage([role], "consumers")).toBe(false);
  });

  it("names the governance page for the work customer service can actually perform", () => {
    expect(getAdminNavigationPath(["CUSTOMER_SERVICE"], "governance")?.pageLabel).toBe("通知处理");
    expect(getAdminNavigationPath(["OPERATOR"], "interests")?.pageLabel).toBe("区域开通意向");
  });

  it("keeps a pickup manager in the isolated point workbench", () => {
    expect(getAdminNavigation(["PICKUP_MANAGER"])).toEqual([
      {
        key: "point-workbench",
        label: "点位工作台",
        items: [
          {
            key: "point-workbench",
            label: "到货确认",
            roles: ["PICKUP_MANAGER"],
          },
          {key:"point-pickup",label:"领取核销",roles:["PICKUP_MANAGER"]},
          {key:"pickup-records",label:"提货记录",roles:["PICKUP_MANAGER"]},
        ],
      },
    ]);
  });

  it.each([
    ["SUPER_ADMIN", ["SUPER_ADMIN"], "dashboard"],
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

  it("resolves a stable parent and child path for the active page", () => {
    expect(getAdminNavigationPath(["SUPER_ADMIN"], "audit")).toEqual({
      groupKey: "access-audit",
      groupLabel: "系统",
      pageLabel: "操作日志",
    });
    expect(getAdminNavigationPath(["PICKUP_MANAGER"], "point-workbench")).toEqual({
      groupKey: "point-workbench",
      groupLabel: "点位工作台",
      pageLabel: "到货确认",
    });
  });
});

describe("split task permissions", () => {
  it("does not expose finance execution or notification work to operations", () => {
    for (const page of ["finance", "finance-records", "finance-ledger", "governance"]) expect(isAllowedAdminPage(["OPERATOR"], page as never)).toBe(false);
    expect(isAllowedAdminPage(["OPERATOR"], "interests")).toBe(true);
    expect(isAllowedAdminPage(["FINANCE"], "orders")).toBe(true);
    expect(isAllowedAdminPage(["FINANCE"], "arrival-exceptions")).toBe(false);
    expect(isAllowedAdminPage(["CUSTOMER_SERVICE"], "interests")).toBe(false);
    expect(isAllowedAdminPage(["PICKUP_MANAGER"], "point-pickup")).toBe(true);
    expect(isAllowedAdminPage(["PICKUP_MANAGER"], "pickup-records")).toBe(true);
    expect(isAllowedAdminPage(["PICKUP_MANAGER"], "orders")).toBe(false);
  });
});


describe("configured capabilities", () => {
  it("uses configured menus without inheriting the underlying legacy role", () => {
    expect(isAllowedAdminPage(["OPERATOR"], "products", ["products.view"])).toBe(true);
    expect(isAllowedAdminPage(["OPERATOR"], "campaigns", ["products.view"])).toBe(false);
    expect(isAllowedAdminPage(["OPERATOR"], "finance-ledger", ["finance-ledger.view"])).toBe(true);
    expect(isAllowedAdminPage(["OPERATOR"], "roles", ["roles.view"])).toBe(false);
    expect(getDefaultAdminPage(["OPERATOR"], [])).toBeNull();
    expect(getDefaultAdminPage(["PICKUP_MANAGER"], ["pickup-records.view"])).toBe("pickup-records");
    expect(isAllowedAdminPage(["PICKUP_MANAGER"], "products", ["products.view"])).toBe(false);
  });
});
