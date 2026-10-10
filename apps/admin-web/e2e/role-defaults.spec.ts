import { test, staffFetch } from "./browser-auth";
import { fixturePhoto } from './media-fixture';
import { expect, type Browser, type Page } from "@playwright/test";

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
    if (response.status() >= 400 && response.headers()["x-reauthentication-required"] !== "1") failures.push(`http ${response.status()}: ${response.url()}`);
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
  const pointResponse = await staffFetch(request, `${apiBase}/api/v1/admin/service-areas`, {
    method: "POST", headers: adminHeaders, data: { regionCode: "110101" },
  });
  expect(pointResponse.status()).toBeLessThan(300);
  const area = (await pointResponse.json()).data as { id: string };
  const pickupResponse = await staffFetch(request, `${apiBase}/api/v1/admin/pickup-points`, {
    method: "POST", headers: adminHeaders,
    data: { photoUrl: await fixturePhoto(request),
    serviceAreaId: area.id, name: `角色点位 ${suffix()}`, address: "东城区角色权限测试点一号", businessHours: "每日 09:00–20:00", pickupInstructions: "请出示领取码后领取商品", longitude: 116.4, latitude: 39.9, contactName: "测试负责人", contactPhone: "13800138008", capacityPerDay: 8 },
  });
  expect(pickupResponse.status()).toBeLessThan(300);
  const point = (await pickupResponse.json()).data as { id: string };
  const matrix = [
    ["SUPER_ADMIN", "运营工作台", "商品列表"],
    ["OPERATOR", "运营工作台", "团期管理"],
    ["CUSTOMER_SERVICE", "售后与异常", "售后与异常"],
    ["FINANCE", "退款待办", "退款待办"],
    ["PICKUP_MANAGER", "到货确认", "到货确认"],
  ] as const;
  for (const [role, heading, menu] of matrix) {
    const session = await createStaff(browser, role, role === "PICKUP_MANAGER" ? [point.id] : []);
    await expect(session.page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(session.page.getByRole("button", { name: "打开账号菜单" })).toContainText(
      session.username,
    );
    await expect(session.page.getByRole("menuitem", { name: menu })).toBeVisible();
    if (role !== "SUPER_ADMIN")
      await expect(session.page.getByText("员工管理", { exact: true })).toHaveCount(0);
    if (role === "PICKUP_MANAGER")
      await expect(session.page.getByText("商品列表", { exact: true })).toHaveCount(0);
    expect(session.failures).toEqual([]);
    await session.context.close();
  }
  const userDenied = await staffFetch(request, `${apiBase}/api/v1/admin/orders`, {
    headers: { "x-demo-user-id": "p1a-user", "x-demo-role": "USER" },
  });
  expect(userDenied.status()).toBe(403);
});

test("售后按问题类型分栏且保留筛选，小屏无多表堆叠", async ({ browser }, testInfo) => {
  const session = await createStaff(browser, "OPERATOR");
  const { page } = session;
  await page.getByRole("menuitem", { name: "售后与异常", exact: true }).click();
  const quality = page.getByRole("region", { name: "品质售后列表" });
  const differences = page.getByRole("region", { name: "履约差异列表", includeHidden: true });
  const pickup = page.getByRole("region", { name: "逾期领取列表", includeHidden: true });
  await expect(quality).toBeVisible();
  await expect(differences).not.toBeVisible();
  await expect(pickup).not.toBeVisible();
  await quality.getByLabel("待办状态筛选").first().click();
  await page.locator(".ant-select-dropdown:visible").getByText("待运营审核", { exact: true }).click();
  await page.getByRole("tab", { name: "履约差异", exact: true }).click();
  await expect(differences).toBeVisible();
  await expect(quality).not.toBeVisible();
  await page.getByRole("tab", { name: "逾期领取", exact: true }).click();
  await expect(pickup).toBeVisible();
  await expect(differences).not.toBeVisible();
  await page.getByRole("tab", { name: "品质售后", exact: true }).click();
  await expect(quality.getByText("待运营审核", { exact: true })).toBeVisible();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("table")).toHaveCount(1);
  }
  await page.screenshot({ path: testInfo.outputPath("service-tabs.png"), fullPage: true });
  expect(session.failures).toEqual([]);
  await session.context.close();
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
  const permissionItem = session.page.getByRole("menuitem", { name: "员工管理" });
  const menuBox = await menu.boundingBox();
  const accountBounds = await accountPanel.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(accountBounds).not.toBeNull();
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(
    accountBounds?.y ?? Number.POSITIVE_INFINITY,
  );
  await expect(permissionItem).toBeAttached();
  const accountBox = await accountPanel.boundingBox();
  expect(accountBox).not.toBeNull();
  expect(accountBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(24);
  expect(accountBox?.y ?? 0).toBeGreaterThan(500);
  const account = accountPanel.getByRole("button", { name: "打开账号菜单" });
  await expect(account).toBeVisible();
  await expect(account).toHaveCSS("color", "rgb(35, 49, 45)");
  await expect(account.locator("small")).toHaveCSS("color", "rgb(95, 104, 117)");

  const accessGroup = session.page.getByRole("menuitem", { name: "系统" });
  await expect(accessGroup).toHaveAttribute("aria-expanded", "true");
  await expect(session.page.getByRole("menuitem", { name: "员工管理" })).toBeVisible();
  await session.page.getByRole("menuitem", { name: "操作日志" }).click();
  await expect(session.page.getByLabel("当前位置")).toContainText("系统");
  await expect(session.page.getByLabel("当前位置")).toContainText("操作日志");
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
  const operationsGroup = session.page.getByRole("menuitem", { name: "商品与营销", exact: true });
  const operationsSubmenu = operationsGroup.locator("xpath=..");
  await operationsGroup.click();
  await expect(operationsGroup).toHaveAttribute("aria-expanded", "false");
  await expect(operationsSubmenu.getByRole("menuitem", { name: "商品列表" })).toBeHidden();
  await expect(operationsSubmenu.getByRole("menuitem", { name: "分类管理" })).toBeHidden();
  await expect(operationsSubmenu.locator(".ant-menu-sub")).toBeHidden();
  await session.page.screenshot({ path: testInfo.outputPath("sidebar-collapsed-group.png") });
  expect(session.failures).toEqual([]);
  await session.context.close();
});
