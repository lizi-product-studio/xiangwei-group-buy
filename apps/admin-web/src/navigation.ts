export type AdminPage =
  | "dashboard"
  | "products"
  | "campaigns"
  | "orders"
  | "logistics"
  | "pickup-points"
  | "consumers"
  | "service"
  | "governance"
  | "finance"
  | "audit"
  | "settings"
  | "point-workbench"
  | "categories" | "areas" | "cancellations" | "arrival-exceptions"
  | "finance-records" | "finance-ledger" | "interests" | "point-pickup"
  | "pickup-records"
  | "homepage-banners";

export type AdminNavigationItem = {
  key: AdminPage;
  label: string;
  roles: readonly string[];
};

export type AdminNavigationGroup = {
  key: string;
  label: string;
  items: readonly AdminNavigationItem[];
};

const globalRoles = ["OPERATOR", "SUPER_ADMIN", "FINANCE", "CUSTOMER_SERVICE"];

export function getAdminPageModule(page: AdminPage): AdminPage {
  const modules: Partial<Record<AdminPage, AdminPage>> = {
    categories: "products", areas: "pickup-points", cancellations: "service",
    "arrival-exceptions": "logistics", "finance-records": "finance",
    "finance-ledger": "finance", interests: "governance", "point-pickup": "point-workbench",
    "pickup-records": "point-workbench",
  };
  return modules[page] ?? page;
}

const mainNavigation: readonly AdminNavigationGroup[] = [
  { key: "dashboard", label: "工作台", items: [{ key: "dashboard", label: "工作台", roles: ["OPERATOR"] }] },
  { key: "products", label: "商品", items: [
    { key: "products", label: "商品列表", roles: ["OPERATOR"] },
    { key: "categories", label: "分类管理", roles: ["OPERATOR"] },
  ] },
  { key: "merchandising", label: "页面运营", items: [
    { key: "homepage-banners", label: "首页轮播", roles: ["OPERATOR"] },
  ] },
  { key: "campaigns", label: "团期", items: [{ key: "campaigns", label: "团期管理", roles: ["OPERATOR"] }] },
  { key: "orders", label: "订单", items: [
    { key: "orders", label: "订单列表", roles: ["OPERATOR", "CUSTOMER_SERVICE", "FINANCE"] },
    { key: "cancellations", label: "取消申请", roles: ["OPERATOR", "CUSTOMER_SERVICE"] },
  ] },
  { key: "fulfillment", label: "履约管理", items: [
    { key: "logistics", label: "发货与运输", roles: ["OPERATOR"] },
    { key: "arrival-exceptions", label: "到货异常处理", roles: ["OPERATOR"] },
  ] },
  { key: "sites", label: "区域与自提点", items: [
    { key: "areas", label: "区域管理", roles: ["OPERATOR"] },
    { key: "pickup-points", label: "自提点管理", roles: ["OPERATOR"] },
  ] },
  { key: "consumers", label: "用户", items: [{ key: "consumers", label: "用户管理", roles: ["CUSTOMER_SERVICE"] }] },
  { key: "service", label: "售后", items: [{ key: "service", label: "售后与异常", roles: ["OPERATOR", "CUSTOMER_SERVICE"] }] },
  { key: "governance", label: "运营治理", items: [
    { key: "governance", label: "通知处理", roles: ["CUSTOMER_SERVICE"] },
    { key: "interests", label: "区域开通意向", roles: ["OPERATOR"] },
  ] },
  { key: "finance", label: "财务", items: [
    { key: "finance", label: "退款待办", roles: ["FINANCE"] },
    { key: "finance-records", label: "退款记录", roles: ["FINANCE"] },
    { key: "finance-ledger", label: "账务流水", roles: ["FINANCE"] },
  ] },
  { key: "access-audit", label: "系统", items: [
    { key: "settings", label: "员工与权限", roles: ["SUPER_ADMIN"] },
    { key: "audit", label: "操作日志", roles: ["SUPER_ADMIN"] },
  ] },
];

export function isPointWorkbenchUser(roles: readonly string[]): boolean {
  return (
    roles.includes("PICKUP_MANAGER") &&
    !roles.some((role) => globalRoles.includes(role))
  );
}

export function getAdminNavigation(
  roles: readonly string[],
): AdminNavigationGroup[] {
  if (isPointWorkbenchUser(roles)) {
    return [
      {
        key: "point-workbench",
        label: "点位工作台",
        items: [
          {
            key: "point-workbench",
            label: "到货确认",
            roles: ["PICKUP_MANAGER"],
          },
          { key: "point-pickup", label: "领取核销", roles: ["PICKUP_MANAGER"] },
          { key: "pickup-records", label: "提货记录", roles: ["PICKUP_MANAGER"] },
        ],
      },
    ];
  }
  const isSuperAdmin = roles.includes("SUPER_ADMIN");
  return mainNavigation
    .map((group) => ({
      key: group.key,
      label: group.label,
      items: group.items
        .filter(
          (item) =>
            isSuperAdmin || item.roles.some((role) => roles.includes(role)),
        ),
    }))
    .filter((group) => group.items.length > 0);
}

export function getDefaultAdminPage(roles: readonly string[]): AdminPage | null {
  if (roles.includes("SUPER_ADMIN")) return "dashboard";
  if (roles.includes("OPERATOR")) return "dashboard";
  if (roles.includes("CUSTOMER_SERVICE")) return "service";
  if (roles.includes("FINANCE")) return "finance";
  if (isPointWorkbenchUser(roles)) return "point-workbench";
  return null;
}

export function isAllowedAdminPage(
  roles: readonly string[],
  page: AdminPage,
): boolean {
  return getAdminNavigation(roles).some((group) =>
    group.items.some((item) => item.key === page),
  );
}

export function getAdminNavigationPath(
  roles: readonly string[],
  page: AdminPage,
): { groupKey: string; groupLabel: string; pageLabel: string } | null {
  for (const group of getAdminNavigation(roles)) {
    const item = group.items.find((candidate) => candidate.key === page);
    if (item) {
      return {
        groupKey: group.key,
        groupLabel: group.label,
        pageLabel: item.label,
      };
    }
  }
  return null;
}
