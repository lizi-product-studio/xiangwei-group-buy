import { z } from "zod";

export type AccessScope = "PLATFORM" | "PICKUP";
export interface PermissionDefinition { code: string; label: string; page: string; group: string; scope: AccessScope; protected?: boolean }
const modules: Array<[string, string, string, string[], AccessScope?]> = [
  ["dashboard", "工作台", "工作台", []],
  ["products", "商品列表", "商品与团期", ["create", "edit"]],
  ["categories", "分类管理", "商品与团期", ["manage", "delete"]],
  ["campaigns", "团期管理", "商品与团期", ["create", "edit", "open", "close", "cancel", "delete", "labels"]],
  ["homepage-banners", "首页轮播", "商品与团期", ["manage", "delete"]],
  ["orders", "订单列表", "订单与售后", []],
  ["cancellations", "取消申请", "订单与售后", ["review"]],
  ["service", "售后与异常", "订单与售后", ["accept", "decision", "pickup"]],
  ["logistics", "发货与运输", "发货管理", ["edit", "dispatch"]],
  ["arrival-exceptions", "到货异常处理", "发货管理", ["confirm"]],
  ["pickup-points", "自提点管理", "自提点与区域", ["create", "edit", "delete"]],
  ["areas", "区域管理", "自提点与区域", ["manage"]],
  ["interests", "区域开通意向", "自提点与区域", ["manage"]],
  ["consumers", "用户管理", "用户与通知", []],
  ["governance", "通知处理", "用户与通知", ["manage"]],
  ["finance", "退款待办", "财务", ["refund"]],
  ["finance-records", "退款记录", "财务", []],
  ["finance-ledger", "账务流水", "财务", []],
  ["audit", "操作日志", "系统", []],
  ["point-workbench", "到货确认", "点位工作台", ["confirm"], "PICKUP"],
  ["point-pickup", "领取核销", "点位工作台", ["verify"], "PICKUP"],
  ["pickup-records", "提货记录", "点位工作台", [], "PICKUP"],
];
const labels: Record<string, string> = { view: "查看", create: "新增", edit: "编辑", status: "上下架", manage: "新增与编辑", delete: "删除", open: "开售", close: "截单", cancel: "取消团期", labels: "生成装袋标签", review: "审核取消申请", accept: "受理售后", decision: "处理售后", pickup: "处理逾期领取", dispatch: "创建批次与发车", confirm: "确认", refund: "执行退款", verify: "核销领取" };
export const PERMISSION_CATALOG: PermissionDefinition[] = modules.flatMap(([page, label, group, actions, scope = "PLATFORM"]) => ["view", ...actions].map(action => ({ code: `${page}.${action}`, label: action === "view" ? `查看${label}` : page === "products" && action === "edit" ? "编辑与上下架" : labels[action]!, page, group, scope })));
export const ACCESS_PAGE_LABELS = Object.fromEntries(modules.map(([page, label]) => [page, label]));
export const PROTECTED_ACCESS_PAGES = ["settings", "roles", "permissions"];
export const ALL_PERMISSION_CODES = PERMISSION_CATALOG.map(p => p.code);
export interface AccessRole { id: string; name: string; description: string; scope: AccessScope; permissions: string[]; status: "ACTIVE" | "INACTIVE"; version: number; builtIn: boolean; updatedAt: string }
const legacyPages: Record<string, string[]> = {
  OPERATOR: ["dashboard", "products", "categories", "campaigns", "homepage-banners", "orders", "cancellations", "service", "logistics", "arrival-exceptions", "pickup-points", "areas", "interests"],
  CUSTOMER_SERVICE: ["orders", "cancellations", "service", "consumers", "governance"],
  FINANCE: ["orders", "finance", "finance-records", "finance-ledger"],
  PICKUP_MANAGER: ["point-workbench", "point-pickup", "pickup-records"],
};
const legacyNames: Record<string, string> = { OPERATOR: "运营", CUSTOMER_SERVICE: "客服", FINANCE: "财务", PICKUP_MANAGER: "点位负责人" };
export const BUILTIN_ACCESS_ROLES: AccessRole[] = Object.entries(legacyPages).map(([id, pages]) => ({
  id, name: legacyNames[id]!, description: "由原系统角色迁移，可调整功能权限", scope: id === "PICKUP_MANAGER" ? "PICKUP" : "PLATFORM", status: "ACTIVE", version: 1, builtIn: true, updatedAt: "2026-09-22T00:00:00.000Z",
  permissions: PERMISSION_CATALOG.filter(p => pages.includes(p.page) && !(id === "CUSTOMER_SERVICE" && ["cancellations.review", "service.decision", "service.pickup"].includes(p.code)) && !(id === "OPERATOR" && p.code === "service.accept")).map(p => p.code),
}));
export const accessRoleInputSchema = z.object({
  name: z.string().trim().min(2).max(40), description: z.string().trim().max(200).default(""), scope: z.enum(["PLATFORM", "PICKUP"]),
  permissions: z.array(z.string().refine(code => ALL_PERMISSION_CODES.includes(code), "未知权限")).max(100),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"), version: z.int().min(1).optional(),
}).superRefine((value, ctx) => {
  for (const code of value.permissions) {
    const permission = PERMISSION_CATALOG.find(p => p.code === code)!;
    if (permission && permission.scope !== value.scope) ctx.addIssue({ code: "custom", message: "点位权限与平台权限不能混合，避免扩大数据范围", path: ["permissions"] });
  }
});
export function normalizePermissions(codes: readonly string[]): string[] {
  return [...new Set(codes.flatMap(code => [code, `${code.split(".")[0]}.view`]))].sort();
}
