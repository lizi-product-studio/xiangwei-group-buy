import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3101";
const demoAdmin = { "x-demo-user-id": "demo-super-admin", "x-demo-role": "SUPER_ADMIN" };

async function createAdmin(request: APIRequestContext) {
  const suffix = String(Date.now());
  const username = `url-state.${suffix}`;
  const response = await request.post(`${apiBase}/api/v1/admin/staff`, {
    headers: demoAdmin,
    data: {
      displayName: "URL 状态验收超管",
      username,
      phone: `138${suffix.slice(-8)}`,
      role: "SUPER_ADMIN",
      pickupPointIds: [],
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { username, ...(await response.json()).data as { temporaryPassword: string } };
}

async function createStaff(request: APIRequestContext, role: "OPERATOR" | "FINANCE" | "PICKUP_MANAGER", suffix: string, pickupPointIds: string[] = []) {
  const response = await request.post(`${apiBase}/api/v1/admin/staff`, {
    headers: demoAdmin,
    data: {
      displayName: `URL 状态验收${role}`,
      username: `url-state.${role.toLowerCase()}.${suffix}`,
      phone: `137${suffix.slice(-8)}`,
      role,
      pickupPointIds,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { username: `url-state.${role.toLowerCase()}.${suffix}`, ...(await response.json()).data as { temporaryPassword: string } };
}

async function post<T>(request: APIRequestContext, path: string, data: unknown, headers: Record<string, string> = demoAdmin): Promise<T> {
  const response = await request.post(`${apiBase}${path}`, { headers, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).data as T;
}

async function createUrlFixtures(request: APIRequestContext) {
  const suffix = String(Date.now());
  const area = await post<{ id: string; name: string }>(request, "/api/v1/admin/service-areas", { regionCode: "110101" });
  await post(request, `/api/v1/admin/service-areas/${area.id}/order-status`, { orderEnabled: true });
  const point = await post<{ id: string }>(request, "/api/v1/admin/pickup-points", {
    serviceAreaId: area.id, name: `URL 状态点位 ${suffix}`, address: "东城区社区服务站 9 号",
    businessHours: "09:00-20:00", pickupInstructions: "出示取货码", longitude: 116.4167, latitude: 39.9289,
    contactName: "测试店长", contactPhone: "13800138000", capacityPerDay: 10,
    photoUrl: "https://example.com/url-state-pickup.jpg",
  });
  const sku = await post<{ id: string }>(request, "/api/v1/admin/catalog/skus", {
    title: `URL 状态商品 ${suffix}`, category: "蔬菜", origin: "本地农场", imageUrl: null,
    skuName: "每份 1 斤", retailPriceCents: 1280, defaultSellableQuantity: 5, status: "ACTIVE",
  });
  const date = (offset: number) => new Date(Date.now() + offset).toISOString();
  const campaign = await post<{ id: string }>(request, "/api/v1/admin/campaigns", {
    title: `URL 状态团期 ${suffix}`, serviceAreaId: area.id, pickupPointId: point.id,
    cutoffAt: date(3 * 60 * 60 * 1000), dispatchAt: date(4 * 60 * 60 * 1000),
    estimatedArrivalStartAt: date(5 * 60 * 60 * 1000), estimatedArrivalEndAt: date(6 * 60 * 60 * 1000),
    minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND",
    items: [{ catalogSkuId: sku.id, retailPriceCents: 1280, sellableQuantity: 5 }],
  });
  await post(request, `/api/v1/admin/campaigns/${campaign.id}/open`, {});
  const consumer = { "x-demo-user-id": `url-state.consumer.${suffix}`, "x-demo-role": "USER", "idempotency-key": `url-state-order-${suffix}` };
  const order = await post<{ id: string; orderNo: string }>(request, "/api/v1/orders", {
    campaignId: campaign.id, serviceAreaId: area.id, pickupPointId: point.id,
    items: [{ skuId: sku.id, quantity: 1 }],
  }, consumer);
  await post(request, `/api/v1/orders/${order.id}/pay/mock-confirm`, undefined, consumer);

  const operator = await createStaff(request, "OPERATOR", `${suffix}1`);
  const finance = await createStaff(request, "FINANCE", `${suffix}2`);
  const pickupManager = await createStaff(request, "PICKUP_MANAGER", `${suffix}3`, [point.id]);
  return { order, operator, finance, pickupManager };
}

async function login(page: Page, staff: { username: string; temporaryPassword: string }) {
  await page.goto("/");
  await page.getByLabel("账号").fill(staff.username);
  await page.getByLabel("密码").fill(staff.temporaryPassword);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.getByLabel("新密码", { exact: true }).fill("url state browser password");
  await page.getByLabel("确认新密码").fill("url state browser password");
  const accessLoaded = page.waitForResponse(response => response.url().endsWith("/api/v1/admin/me/access") && response.ok());
  await page.getByRole("button", { name: "保存新密码" }).click();
  await accessLoaded;
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "打开账号菜单" }).click();
  const logoutCompleted = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/v1/auth/logout" && response.request().method() === "POST",
  );
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  expect((await logoutCompleted).status()).toBe(204);
  await expect(page.getByLabel("账号")).toBeVisible();
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
}

test("管理员页面与订单详情从 URL 恢复，刷新与浏览器后退保持一致", async ({ page, request }) => {
  test.setTimeout(120_000);
  const fixtures = await createUrlFixtures(request);
  const staff = await createAdmin(request);
  await page.goto("/");
  await page.getByLabel("账号").fill(staff.username);
  await page.getByLabel("密码").fill(staff.temporaryPassword);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.getByLabel("新密码", { exact: true }).fill("url state browser password");
  await page.getByLabel("确认新密码").fill("url state browser password");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();

  await page.goto("/?page=orders");
  await expect(page.getByRole("heading", { name: "订单列表" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "订单列表" })).toBeVisible();

  await page.getByRole("menuitem", { name: "工作台" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/page=orders/);
  await expect(page.getByRole("heading", { name: "订单列表" })).toBeVisible();

  const missingOrderId = "00000000-0000-4000-8000-000000000000";
  await page.goto(`/?page=orders&orderId=${missingOrderId}`);
  await expect(page.getByRole("dialog", { name: "订单详情" })).toBeVisible();
  await expect(page.getByText("订单详情加载失败")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "订单详情" })).toBeVisible();
  await expect(page.getByText("订单详情加载失败")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/page=orders(?!.*orderId)/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await logout(page);
  await login(page, fixtures.finance);
  await page.goto('/?page=finance-reconciliation&billId=removed-bill');
  await expect(page).not.toHaveURL(/finance-reconciliation|billId=/);
  await expect(page.getByRole("menuitem", { name: "账单对账" })).toHaveCount(0);
  await page.goto('/?page=finance-ledger');
  await expect(page.getByRole("heading", { name: "账务流水" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "账务流水" })).toBeVisible();

  await logout(page);
  await login(page, fixtures.operator);
  await page.goto(`/?page=orders&orderId=${fixtures.order.id}`);
  const existingOrderDialog = page.getByRole("dialog", { name: new RegExp(`订单详情.*${fixtures.order.orderNo}`) });
  await expect(existingOrderDialog).toBeVisible();
  await expect(existingOrderDialog.getByText(fixtures.order.orderNo, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog", { name: new RegExp(`订单详情.*${fixtures.order.orderNo}`) })).toBeVisible();
  await existingOrderDialog.locator("button.ant-modal-close").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto('/?page=finance-reconciliation&billId=removed-bill');
  await expect(page).not.toHaveURL(/billId=/);
  await expect(page.getByText(/对账明细/)).toHaveCount(0);

  await logout(page);
  await login(page, fixtures.pickupManager);
  await page.goto(`/?page=orders&orderId=${fixtures.order.id}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/orderId=/);
});
