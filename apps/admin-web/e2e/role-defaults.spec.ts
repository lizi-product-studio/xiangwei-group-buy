import { expect, test, type Browser, type Page } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3101";
const adminBase = process.env.E2E_ADMIN_BASE_URL ?? "http://127.0.0.1:5174";
const suffix = () => `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
const adminHeaders = {
  "x-demo-user-id": "demo-super-admin",
  "x-demo-role": "SUPER_ADMIN",
  "content-type": "application/json",
};

function watch(page: Page): string[] {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => failures.push(`requestfailed: ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`http ${response.status()}: ${response.url()}`);
  });
  return failures;
}

async function createStaff(
  browser: Browser,
  role: "SUPER_ADMIN" | "OPERATOR" | "CUSTOMER_SERVICE" | "FINANCE" | "PICKUP_MANAGER",
  pickupPointIds: string[] = [],
) {
  const value = suffix();
  const response = await fetch(`${apiBase}/api/v1/admin/staff`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      displayName: `默认页 ${role}`,
      username: `role.${role.toLowerCase()}.${value}`,
      phone: `135${value.slice(-8)}`,
      role,
      pickupPointIds,
    }),
  });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { data: { temporaryPassword: string } };
  const context = await browser.newContext({
    baseURL: adminBase,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const failures = watch(page);
  await page.goto("/");
  const username = `role.${role.toLowerCase()}.${value}`;
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码").fill(payload.data.temporaryPassword);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByText("请先设置新密码", { exact: true })).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill("role default setup password");
  await page.getByLabel("确认新密码").fill("role default setup password");
  await page.getByRole("button", { name: "保存新密码" }).click();
  return { context, page, failures, username };
}

test("五个内部角色仅加载其默认页与可见菜单，USER 被后台拒绝", async ({ browser, request }) => {
  const pointResponse = await request.fetch(`${apiBase}/api/v1/admin/service-areas`, {
    method: "POST", headers: adminHeaders, data: { regionCode: "110101" },
  });
  expect(pointResponse.status()).toBeLessThan(300);
  const area = (await pointResponse.json()).data as { id: string };
  const pickupResponse = await request.fetch(`${apiBase}/api/v1/admin/pickup-points`, {
    method: "POST", headers: adminHeaders,
    data: { serviceAreaId: area.id, name: `角色点位 ${suffix()}`, address: "东城区角色权限测试点一号", businessHours: "每日 09:00–20:00", pickupInstructions: "请出示领取码后领取商品", longitude: 116.4, latitude: 39.9, contactName: "测试负责人", contactPhone: "13800138008", capacityPerDay: 8 },
  });
  expect(pickupResponse.status()).toBeLessThan(300);
  const point = (await pickupResponse.json()).data as { id: string };
  const matrix = [
    ["SUPER_ADMIN", "运营工作台", "商品管理"],
    ["OPERATOR", "运营工作台", "团期管理"],
    ["CUSTOMER_SERVICE", "售后与异常", "售后与异常"],
    ["FINANCE", "财务管理", "财务管理"],
    ["PICKUP_MANAGER", "我的点位工作台", "我的点位工作台"],
  ] as const;
  for (const [role, heading, menu] of matrix) {
    const session = await createStaff(browser, role, role === "PICKUP_MANAGER" ? [point.id] : []);
    await expect(session.page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(session.page.getByRole("button", { name: "打开账号菜单" })).toContainText(
      role === "SUPER_ADMIN" ? `默认页 ${role}` : session.username,
    );
    await expect(session.page.getByRole("menuitem", { name: menu })).toBeVisible();
    if (role !== "SUPER_ADMIN")
      await expect(session.page.getByText("人员与权限", { exact: true })).toHaveCount(0);
    if (role === "PICKUP_MANAGER")
      await expect(session.page.getByText("商品管理", { exact: true })).toHaveCount(0);
    expect(session.failures).toEqual([]);
    await session.context.close();
  }
  const userDenied = await request.fetch(`${apiBase}/api/v1/admin/orders`, {
    headers: { "x-demo-user-id": "p1a-user", "x-demo-role": "USER" },
  });
  expect(userDenied.status()).toBe(403);
});

test("后台框架提供高对比账号入口、可展开分组和运营可读审计表", async ({ browser }, testInfo) => {
  const session = await createStaff(browser, "SUPER_ADMIN");
  const topbar = session.page.locator("header.topbar");
  await expect(topbar).toHaveCSS("background-color", "rgba(255, 255, 255, 0.98)");
  const accountPanel = session.page.locator(".app-sider__account");
  await expect(accountPanel).toBeVisible();
  const menu = session.page.locator(".app-sider > .ant-layout-sider-children > .ant-menu");
  await expect(menu).toHaveCSS("overflow-y", "auto");
  await expect(menu).toHaveCSS("overflow-x", "hidden");
  const permissionItem = session.page.getByRole("menuitem", { name: "人员与权限" });
  const permissionBox = await permissionItem.boundingBox();
  const accountBounds = await accountPanel.boundingBox();
  expect(permissionBox).not.toBeNull();
  expect(accountBounds).not.toBeNull();
  expect((permissionBox?.y ?? 0) + (permissionBox?.height ?? 0)).toBeLessThanOrEqual(
    accountBounds?.y ?? Number.POSITIVE_INFINITY,
  );
  const accountBox = await accountPanel.boundingBox();
  expect(accountBox).not.toBeNull();
  expect(accountBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(24);
  expect(accountBox?.y ?? 0).toBeGreaterThan(500);
  const account = accountPanel.getByRole("button", { name: "打开账号菜单" });
  await expect(account).toBeVisible();
  await expect(account).toHaveCSS("color", "rgb(23, 38, 58)");
  await expect(account.locator("small")).toHaveCSS("color", "rgb(95, 104, 117)");

  const accessGroup = session.page.getByRole("menuitem", { name: "权限与审计" });
  await expect(accessGroup).toHaveAttribute("aria-expanded", "true");
  await expect(session.page.getByRole("menuitem", { name: "人员与权限" })).toBeVisible();
  await session.page.getByRole("menuitem", { name: "审计记录" }).click();
  await expect(session.page.getByLabel("当前位置")).toContainText("权限与审计");
  await expect(session.page.getByLabel("当前位置")).toContainText("审计记录");
  await expect(session.page.getByRole("columnheader", { name: "操作内容" })).toBeVisible();
  await expect(session.page.getByRole("columnheader", { name: "追踪编号" })).toBeVisible();
  await expect(session.page.getByText("创建员工", { exact: true }).first()).toBeVisible();
  await expect(session.page.getByText(/^STAFF_/)).toHaveCount(0);
  await expect(session.page.locator(".audit-primary-cell span").first()).toHaveCSS(
    "color",
    "rgb(95, 104, 117)",
  );
  await session.page.evaluate(() => {
    const host = document.createElement("div");
    host.className = "audit-primary-cell";
    const fallback = document.createElement("span");
    fallback.className = "audit-technical-code";
    fallback.textContent = "UNKNOWN_AUDIT_ACTION";
    fallback.dataset.testid = "audit-technical-code";
    host.append(fallback);
    document.body.append(host);
  });
  await expect(session.page.getByTestId("audit-technical-code")).toHaveCSS(
    "color",
    "rgb(95, 104, 117)",
  );
  await expect(session.page.getByText("密码已设置，请继续使用")).toBeHidden({ timeout: 10_000 });
  await session.page.screenshot({ path: testInfo.outputPath("audit-shell.png") });

  await account.click();
  const accountIdentity = session.page.getByLabel("当前账号信息");
  await expect(accountIdentity).toBeVisible();
  await expect(session.page.getByRole("menuitem", { name: "退出登录" })).toBeVisible();
  await session.page.screenshot({ path: testInfo.outputPath("account-menu.png") });
  await account.click();
  await expect(accountIdentity).toBeHidden();
  const operationsGroup = session.page.getByRole("menuitem", { name: "日常运营" });
  const operationsSubmenu = operationsGroup.locator("xpath=..");
  await operationsGroup.click();
  await expect(operationsGroup).toHaveAttribute("aria-expanded", "false");
  await expect(operationsSubmenu.getByRole("menuitem", { name: "工作台" })).toBeHidden();
  await expect(operationsSubmenu.getByRole("menuitem", { name: "商品管理" })).toBeHidden();
  await expect(operationsSubmenu.getByRole("menuitem", { name: "团期管理" })).toBeHidden();
  await expect(operationsSubmenu.getByRole("menuitem", { name: "订单管理" })).toBeHidden();
  await expect(operationsSubmenu.locator(".ant-menu-sub")).toBeHidden();
  await session.page.screenshot({ path: testInfo.outputPath("sidebar-collapsed-group.png") });
  expect(session.failures).toEqual([]);
  await session.context.close();
});
