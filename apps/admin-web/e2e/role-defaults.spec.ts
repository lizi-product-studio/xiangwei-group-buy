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
  const payload = (await response.json()) as { data: { initialCredential: string } };
  const context = await browser.newContext({ baseURL: adminBase });
  const page = await context.newPage();
  const failures = watch(page);
  await page.goto("/");
  await page.getByRole("button", { name: "首次激活账号" }).click();
  const username = `role.${role.toLowerCase()}.${value}`;
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("一次性初始凭据").fill(payload.data.initialCredential);
  await page.getByLabel("新密码").fill("role default activation password");
  await page.getByRole("button", { name: "完成首次激活" }).click();
  return { context, page, failures };
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
    ["SUPER_ADMIN", "系统设置", "商品管理"],
    ["OPERATOR", "运营工作台", "团期管理"],
    ["CUSTOMER_SERVICE", "售后与异常", "售后与异常"],
    ["FINANCE", "财务管理", "财务管理"],
    ["PICKUP_MANAGER", "我的点位工作台", "我的点位工作台"],
  ] as const;
  for (const [role, heading, menu] of matrix) {
    const session = await createStaff(browser, role, role === "PICKUP_MANAGER" ? [point.id] : []);
    await expect(session.page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(session.page.getByRole("menuitem", { name: menu })).toBeVisible();
    if (role !== "SUPER_ADMIN")
      await expect(session.page.getByText("系统设置", { exact: true })).toHaveCount(0);
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
