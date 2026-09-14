import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Response,
} from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3101";
const superHeaders = {
  "x-demo-user-id": "demo-super-admin",
  "x-demo-role": "SUPER_ADMIN",
  "content-type": "application/json",
};

function watchBrowser(
  page: Page,
  expected: (response: Response) => boolean = () => false,
): string[] {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "unknown";
    if (reason !== "net::ERR_ABORTED")
      failures.push(`requestfailed: ${request.url()} ${reason}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !expected(response))
      failures.push(`http ${response.status()}: ${response.url()}`);
  });
  return failures;
}

async function post<T>(
  request: APIRequestContext,
  path: string,
  data: unknown,
  headers = superHeaders,
): Promise<T> {
  const response = await request.fetch(`${apiBase}${path}`, {
    method: "POST",
    headers,
    data,
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
  return (await response.json()).data as T;
}

async function completeTemporaryPasswordInBrowser(
  page: Page,
  username: string,
  temporaryPassword: string,
  password: string,
) {
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码").fill(temporaryPassword);
  await page.getByRole("button", { name: /登\s*������$z{-���jם��作区，客服和财务刷新只重取当前页数据", async ({
  page,
  request,
}) => {
  const failures = watchBrowser(page);
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const area = await post<{ id: string }>(request, "/api/v1/admin/service-areas", {
    regionCode: "110101",
  });
  const pointA = await post<{ id: string }>(request, "/api/v1/admin/pickup-points", {
    serviceAreaId: area.id,
    name: `换号点位 A ${suffix}`,
    address: "东城区换号测试点 A",
    businessHours: "09:00–20:00",
    pickupInstructions: "出示领取码",
    longitude: 116.42,
    latitude: 39.91,
    contactName: "负责人 A",
    contactPhone: "13800138010",
    capacityPerDay: 10,
  });
  const pointB = await post<{ id: string }>(request, "/api/v1/admin/pickup-points", {
    serviceAreaId: area.id,
    name: `换号点位 B ${suffix}`,
    address: "东城区换号测试点 B",
    businessHours: "09:00–20:00",
    pickupInstructions: "出示领取码",
    longitude: 116.43,
    latitude: 39.90,
    contactName: "负责人 B",
    contactPhone: "13800138011",
    capacityPerDay: 10,
  });
  let accountSequence = 0;
  const create = async (
    role: "PICKUP_MANAGER" | "CUSTOMER_SERVICE" | "FINANCE",
    pickupPointIds: string[] = [],
  ) => {
    accountSequence += 1;
    const username = `switch.${role.toLowerCase()}.${suffix}.${accountSequence}`;
    const result = await post<{ temporaryPassword: string }>(
      request,
      "/api/v1/admin/staff",
      {
        displayName: `换号 ${role} ${pickupPointIds.join("")}`,
        username,
        phone: `135${`${suffix}${accountSequence}`.slice(-8)}`,
        role,
        pickupPointIds,
      },
    );
    return { username, temporaryPassword: result.temporaryPassword };
  };
  const managerA = await create("PICKUP_MANAGER", [pointA.id]);
  const managerB = await create("PICKUP_MANAGER", [pointB.id]);
  const customerService = await create("CUSTOMER_SERVICE");
  const finance = await create("FINANCE");
  const loginWithTemporaryPassword = async (account: { username: string; temporaryPassword: string }) => {
    await page.getByLabel("账号").fill(account.username);
    await page.getByLabel("密码").fill(account.temporaryPassword);
    await page.getByRole("button", { name: /登\s*录/ }).click();
    await expect(page.getByText("请先设置新密码", { exact: true })).toBeVisible();
    await page
      .getByLabel("新密码", { exact: true })
      .fill("switch account setup password");
    await page
      .getByLabel("确认新密码")
      .fill("switch account setup password");
    await page.getByRole("button", { name: "保存新密码" }).click();
  };
  const logout = async () => {
    await page.getByRole("button", { name: "打开账号菜单" }).click();
    await page.getByRole("menuitem", { name: "退出登录" }).click();
    await expect(page.getByRole("button", { name: /登\s*录/ })).toBeVisible();
  };

  await page.goto("/");
  await loginWithTemporaryPassword(managerA);
  await expect(page.getByRole("heading", { name: "我的点位工作台" })).toBeVisible();
  await logout();
  await expect(page.getByRole("heading", { name: "我的点位工作台" })).toHaveCount(0);
  await loginWithTemporaryPassword(managerB);
  await expect(page.getByRole("heading", { name: "我的点位工作台" })).toBeVisible();
  await expect(page.getByText(`换号点位 A ${suffix}`, { exact: true })).toHaveCount(0);

  await logout();
  const serviceReads: string[] = [];
  page.on("response", (response) => {
    if (
      response.request().method() === "GET" &&
      [
        "/api/v1/admin/quality-cases",
        "/api/v1/admin/community/cancellation-requests",
        "/api/v1/admin/fulfillment-exceptions",
      ].some((path) => response.url().includes(path))
    ) {
      serviceReads.push(response.url());
    }
  });
  await loginWithTemporaryPassword(customerService);
  await expect(page.getByRole("heading", { name: "售后与异常" })).toBeVisible();
  await expect.poll(() => serviceReads.length).toBeGreaterThanOrEqual(3);
  const serviceBeforeRefresh = serviceReads.length;
  await page.getByRole("button", { name: "刷新" }).click();
  await expect.poll(() => serviceReads.length).toBeGreaterThanOrEqual(serviceBeforeRefresh + 3);

  await logout();
  const financeReads: string[] = [];
  page.on("response", (response) => {
    if (
      response.request().method() === "GET" &&
      ["/api/v1/admin/finance/refunds", "/api/v1/admin/finance/ledger"].some(
        (path) => response.url().includes(path),
      )
    ) {
      financeReads.push(response.url());
    }
  });
  await loginWithTemporaryPassword(finance);
  await expect(page.getByRole("heading", { name: "财务管理" })).toBeVisible();
  await expect.poll(() => financeReads.length).toBeGreaterThanOrEqual(2);
  // Create a payment after the finance page's initial read.  The only way it
  // can appear in the visible ledger is the current-page refresh below.
  const sku = await post<{ id: string }>(request, "/api/v1/admin/catalog/skus", {
    title: `刷新账本商品 ${suffix}`,
    category: "蔬菜",
    origin: "本地农场",
    imageUrl: null,
    skuName: "一份",
    retailPriceCents: 1980,
    defaultSellableQuantity: 10,
    status: "ACTIVE",
  });
  const campaign = await post<{ id: string }>(request, "/api/v1/admin/campaigns", {
    title: `刷新账本团期 ${suffix}`,
    serviceAreaId: area.id,
    pickupPointId: pointA.id,
    cutoffAt: new Date(Date.now() + 3_600_000).toISOString(),
    dispatchAt: new Date(Date.now() + 7_200_000).toISOString(),
    estimatedArrivalStartAt: new Date(Date.now() + 10_800_000).toISOString(),
    estimatedArrivalEndAt: new Date(Date.now() + 14_400_000).toISOString(),
    minTotalQuantity: 1,
    failureAction: "CANCEL_AND_REFUND",
    items: [{ catalogSkuId: sku.id, retailPriceCents: 1880, sellableQuantity: 10 }],
  });
  await post(request, `/api/v1/admin/campaigns/${campaign.id}/open`, {});
  const customerHeaders = {
    "x-demo-user-id": `refresh.customer.${suffix}`,
    "x-demo-role": "USER",
    "content-type": "application/json",
    "idempotency-key": `refresh-order-${suffix}`,
  };
  const createdOrder = await request.fetch(`${apiBase}/api/v1/orders`, {
    method: "POST",
    headers: customerHeaders,
    data: {
      campaignId: campaign.id,
      serviceAreaId: area.id,
      pickupPointId: pointA.id,
      items: [{ skuId: sku.id, quantity: 1 }],
    },
  });
  expect(createdOrder.status(), await createdOrder.text()).toBe(201);
  const order = (await createdOrder.json()).data as { id: string };
  const paid = await request.fetch(
    `${apiBase}/api/v1/orders/${order.id}/pay/mock-confirm`,
    {
      method: "POST",
      headers: {
        "x-demo-user-id": customerHeaders["x-demo-user-id"],
        "x-demo-role": "USER",
      },
    },
  );
  expect(paid.status(), await paid.text()).toBeLessThan(300);
  const ledgerResponse = await request.fetch(`${apiBase}/api/v1/admin/finance/ledger`, {
    headers: superHeaders,
  });
  expect(ledgerResponse.status(), await ledgerResponse.text()).toBe(200);
  const externalLedger = (await ledgerResponse.json()).data as Array<{
    referenceId: string;
  }>;
  const externalEntry = externalLedger.find((entry) => entry.referenceId === order.id);
  expect(externalEntry).toBeTruthy();
  const financeBeforeRefresh = financeReads.length;
  await page.getByRole("button", { name: "刷新" }).click();
  await expect.poll(() => financeReads.length).toBeGreaterThanOrEqual(financeBeforeRefresh + 2);
  await expect(
    await findLedgerReference(page, externalEntry!.referenceId),
  ).toBeVisible();
  expect(failures).toEqual([]);
});
