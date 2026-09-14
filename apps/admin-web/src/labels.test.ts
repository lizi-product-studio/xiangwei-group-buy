import { describe, expect, it } from "vitest";
import { displayLabel, STAFF_ROLE_OPTIONS } from "./labels.ts";

describe("displayLabel", () => {
  it("shows Chinese names for staff roles", () => {
    expect(displayLabel("SUPER_ADMIN")).toBe("超级管理员");
    expect(displayLabel("OPERATOR")).toBe("运营");
    expect(displayLabel("CUSTOMER_SERVICE")).toBe("客服");
    expect(displayLabel("FINANCE")).toBe("财务");
    expect(displayLabel("PICKUP_MANAGER")).toBe("点位负责人");
  });

  it("shows Chinese names for common status codes", () => {
    expect(displayLabel("ACTIVE")).toBe("启用");
    expect(displayLabel("SUSPENDED")).toBe("已停用");
    expect(displayLabel("INACTIVE")).toBe("已停用");
    expect(displayLabel("OPEN")).toBe("开售中");
    expect(displayLabel("APPROVED_WAITING_FINANCE")).toBe("待退款");
  });

  it("keeps unknown codes readable instead of hiding them", () => {
    expect(displayLabel("CURRENT_AUDIT")).toBe("CURRENT_AUDIT");
    expect(displayLabel(null)).toBe("—");
  });

  it("shows business Chinese for administrator audit actions", () => {
    expect(displayLabel("STAFF_PASSWORD_CHANGED")).toBe("修改登录密码");
    expect(displayLabel("BOOTSTRAP_ADMIN_ROTATED")).toBe("更新管理员凭据");
    expect(displayLabel("BOOTSTRAP_ADMIN_CREATED")).toBe("创建管理员账号");
  });
});

describe("STAFF_ROLE_OPTIONS", () => {
  it("keeps English values for the API and Chinese labels for operators", () => {
    expect(STAFF_ROLE_OPTIONS.map((option) => option.value)).toEqual([
      "SUPER_ADMIN",
      "OPERATOR",
      "CUSTOMER_SERVICE",
      "FINANCE",
      "PICKUP_MANAGER",
    ]);
    expect(STAFF_ROLE_OPTIONS.map((option) => option.label)).toEqual([
      "超级管理员",
      "运营",
      "客服",
      "财务",
      "点位负责人",
    ]);
  });
});
