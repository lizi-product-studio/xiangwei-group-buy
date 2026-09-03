export type AdminPage =
  | "dashboard"
  | "products"
  | "campaigns"
  | "orders"
  | "logistics"
  | "pickup-points"
  | "service"
  | "governance"
  | "finance"
  | "audit"
  | "settings"
  | "point-workbench";

export type AdminNavigationItem = {
  key: AdminPage;
  label: string;
  roles: readonly string[];
};

export type AdminNavigationGroup = {
  label: string;
  items: readonly AdminNavigationItem[];
};

const globalRoles = ["OPERATOR", "SUPER_ADMIN", "FINANCE", "CUSTOMER_SERVICE"];

const mainNavigation: readonly AdminNavigationGroup[] = [
  {
    label: "日常运营",
    items: [
      { key: "dashboard", label: "工作台", roles: ["OPERATOR"] },
      { key: "products", label: "商品管理", roles: ["OPERATOR"] },
      { key: "campaigns", label: "团期管理", roles: ["OPERATOR"] },
      {
        key: "orders",
        label: "订单管理",
        roles: ["OPERATOR", "CUSTOMER_SERVICE", "FINANCE"],
      },
    ],
  },
  {
    label: "履约管理",
    items: [
      { key: "logistics", label: "配送与到货", roles: ["OPERATOR"] },
      { key: "pickup-points", label: "区域与自提点", roles: ["OPERATOR"] },
    ],
  },
  {
    label: "客户与资金",
    items: [
      {
        key: "service",
        label: "售后与异常",
        roles: ["OPERATOR", "CUSTOMER_SERVICE"],
      },
      {
        key: "governance",
        label: "运营治理",
        roles: ["OPERATOR", "CUSTOMER_SERVICE"],
      },
      { key: "finance", label: "财务管理", roles: ["FINANCE"] },
    ],
  },
  {
    label: "权限与审计",
    items: [
      { key: "audit", label: "审计记录", roles: ["SUPER_ADMIN"] },
      { key: "settings", label: "人员与权限", roles: ["SUPER_ADMIN"] },
    ],
  },
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
        label: "点位工作台",
        items: [
          {
            key: "point-workbench",
            label: "我的点位工作台",
            roles: ["PICKUP_MANAGER"],
          },
        ],
      },
    ];
  }
  const isSuperAdmin = roles.includes("SUPER_ADMIN");
  return mainNavigation
    .map((group) => ({
      label: group.label,
      items: group.items.filter(
        (item) =>
          isSuperAdmin || item.roles.some((role) => roles.includes(role)),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

export function getDefaultAdminPage(roles: readonly string[]): AdminPage | null {
  if (roles.includes("SUPER_ADMIN")) return "settings";
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
