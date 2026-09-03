import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3101";
const demoHeaders = {
  "x-demo-user-id": "demo-super-admin",
  "x-demo-role": "SUPER_ADMIN",
  "content-type": "application/json",
};

async function activatePreviewAdmin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const username = `logistics.empty.${suffix}`;
  const created = await request.fetch(`${apiBase}/api/v1/admin/staff`, {
    method: "POST",
    headers: demoHeaders,
    data: {
      displayName: "配送空状态验收",
      username,
      phone: `138${suffix.slice(-8)}`,
      role: "SUPER_ADMIN",
      pickupPointIds: [],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const createdBody = (await created.json()) as {
    data: { temporaryPassword: string };
  };
  const password = "logistics empty state password";
  const login = await request.fetch(
    `${apiBase}/api/v1/auth/admin/login`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: {
        username,
        password: createdBody.data.temporaryPassword,
      },
    },
  );
  expect(login.status(), await login.text()).toBe(200);
  const challenge = (await login.json()).data.passwordChangeToken as string;
  const activated = await request.fetch(
    `${apiBase}/api/v1/auth/admin/complete-password-change`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { passwordChangeToken: challenge, newPassword: password },
    },
  );
  expect(activated.status(), await activated.text()).toBe(200);
  const activatedBody = (await activated.json()) as {
    data: { accessToken: string; roles: string[]; userId: string };
  };
  await page.goto("/");
  await page.evaluate(({ accessToken, roles, userId, username: loginUsername }) => {
    localStorage.setItem("community-admin-token", accessToken);
    localStorage.setItem("community-admin-roles", JSON.stringify(roles));
    localStorage.setItem("community-admin-user-id", userId);
    localStorage.setItem("community-admin-username", loginUsername);
  }, { ...activatedBody.data, username });
  await page.reload();
  await expect(page.getByRole("heading", { name: "人员与权限" })).toBeVisible();
}

test("配送 API 不可用时显示可恢复错误而不是空表", async ({ page, request }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (failed) =>
    failures.push(`requestfailed: ${failed.url()}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes("/admin/delivery-plans"))
      failures.push(`http ${response.status()}: ${response.url()}`);
  });
  await activatePreviewAdmin(request, page);
  await page.route("**/api/v1/admin/delivery-plans", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "请求失败（500）" }),
    }),
  );
  await page.getByRole("menuitem", { name: "配送与到货" }).click();
  await expect(page.getByText("配送数据加载失败", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/后台服务不可用，数据加载失败。请确认已在项目根目录执行 pnpm dev/),
  ).toBeVisible();
  await expect(
    page.getByText("暂无可配送团期，请先创建商品和团期", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  expect(failures).toEqual([]);
});

test("配送 API 正常返回空数据时提供创建团期引导", async ({ page, request }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (failed) =>
    failures.push(`requestfailed: ${failed.url()}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`http ${response.status()}: ${response.url()}`);
  });
  await activatePreviewAdmin(request, page);
  await page.route("**/api/v1/admin/delivery-plans", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    }),
  );
  await page.route("**/api/v1/admin/community/deliveries", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    }),
  );
  await page.getByRole("menuitem", { name: "配送与到货" }).click();
  await expect(
    page.getByText("暂无可配送团期，请先创建商品和团期", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "去创建团期" })).toBeVisible();
  await expect(
    page.getByText(/创建团期并绑定自提点后，运营可在此登记运输信息/),
  ).toBeVisible();
  await expect(page.getByText(/授权点位负责人负责逐商品确认到货/)).toBeVisible();
  await page.getByRole("button", { name: "去创建团期" }).click();
  await expect(page.getByRole("heading", { name: "团期管理" })).toBeVisible();
  expect(failures).toEqual([]);
});
