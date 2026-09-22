import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3101";
const adminBase = process.env.E2E_ADMIN_BASE_URL ?? "http://127.0.0.1:5174";
const superHeaders = {
  "x-demo-user-id": "demo-super-admin",
  "x-demo-role": "SUPER_ADMIN",
  "content-type": "application/json",
};

async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: superHeaders,
    data,
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
  return (await response.json()).data as T;
}

function watchBrowser(page: Page, expectedInvalidation = () => false): string[] {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "unknown";
    if (error !== "net::ERR_ABORTED") failures.push(`requestfailed: ${request.url()} ${error}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !expectedInvalidation())
      failures.push(`http ${response.status()}: ${response.url()}`);
  });
  return failures;
}

test("登录密码显隐可键盘操作，429 按 Retry-After 倒计时恢复", async ({ page }) => {
  let releaseLogin!: () => void;
  const loginGate = new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  await page.route("**/api/v1/auth/admin/login", async (route) => {
    await loginGate;
    await route.fulfill({
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "2" },
      body: JSON.stringify({
        code: "LOGIN_RATE_LIMITED",
        message: "登录尝试过于频繁，请稍后再试",
      }),
    });
  });
  await page.goto("/");
  const username = page.getByLabel("账号");
  const password = page.getByLabel("密码");
  const visibility = page.getByRole("button", { name: "显示凭据内容" });
  const login = page.getByRole("button", { name: /登\s*录/ });
  await username.focus();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(visibility).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(login).toBeFocused();
  await username.fill("rate.limit.admin");
  await password.fill("rate limit password");
  const responsePending = login.click();
  await expect(visibility).toBeDisabled();
  await expect(page.getByRole("button", { name: /忘记密码/ })).toBeDisabled();
  releaseLogin();
  await responsePending;
  await expect(page.getByRole("alert")).toContainText("登录尝试过于频繁，请在 0 分");
  await expect(login).toBeDisabled();
  await expect(login).toHaveCSS("background-color", "rgb(215, 219, 224)");
  await login.hover();
  await expect(login).toHaveCSS("background-color", "rgb(215, 219, 224)");
  await expect(login).toBeEnabled({ timeout: 4_000 });
});

async function findStaffRow(page: Page, displayName: string) {
  const row = page.getByRole("row").filter({ hasText: displayName });
  while ((await row.count()) === 0) {
    const nextPage = page.locator(
      ".ant-pagination-next:not(.ant-pagination-disabled) button",
    );
    await expect(nextPage).toHaveCount(1);
    await nextPage.click();
  }
  return row;
}

async function findLedgerReference(page: Page, referenceId: string) {
  const ledger = page.getByRole("region", { name: "财务流水" });
  const reference = ledger.getByText(referenceId, { exact: true });
  while ((await reference.count()) === 0) {
    const nextPage = ledger.locator(
      ".ant-pagination-next:not(.ant-pagination-disabled) button",
    );
    await expect(nextPage).toHaveCount(1);
    await nextPage.click();
  }
  return reference;
}

test("超管从网页创建员工，临时密码改密与撤权后的默认页可恢复", async ({
  page,
  browser,
  request,
}) => {
  const failures = watchBrowser(page);
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const managerDisplayName = `P1-A 点位负责人 ${suffix}`;
  const area = await post<{ id: string }>(request, "/api/v1/admin/service-areas", {
    regionCode: "110101",
  });
  const point = await post<{ id: string }>(request, "/api/v1/admin/pickup-points", {
    serviceAreaId: area.id,
    name: `P1-A 授权点 ${suffix}`,
    address: "东城区 P1-A 测试点",
    businessHours: "09:00–20:00",
    pickupInstructions: "出示领取码",
    longitude: 116.41,
    latitude: 39.92,
    contactName: "点位负责人",
    contactPhone: "13800138009",
    capacityPerDay: 10,
  });
  const bootstrap = await post<{ temporaryPassword: string }>(request, "/api/v1/admin/staff", {
    displayName: "P1-A 超管",
    username: `p1a.admin.${suffix}`,
    phone: `137${suffix.slice(-8)}`,
    role: "SUPER_ADMIN",
    pickupPointIds: [],
  });

  await page.goto("/");
  await page.getByLabel("账号").fill(`p1a.admin.${suffix}`);
  await page.getByLabel("密码").fill(bootstrap.temporaryPassword);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByText("请先设置新密码", { exact: true })).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill("p1a admin setup password");
  await page.getByLabel("确认新密码").fill("p1a admin setup password");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();

  await page.getByRole("button", { name: "打开账号菜单" }).click();
  await page.getByRole("button", { name: "修改我的密码" }).click();
  const ownPasswordDialog = page.getByRole("dialog", { name: "修改密码" });
  await ownPasswordDialog
    .getByLabel("当前密码")
    .fill("p1a admin setup password");
  await ownPasswordDialog
    .getByLabel("新密码", { exact: true })
    .fill("p1a admin profile password");
  await ownPasswordDialog
    .getByLabel("确认新密码")
    .fill("p1a admin profile password");
  await ownPasswordDialog.getByRole("button", { name: "保存新密码" }).click();
  await expect(ownPasswordDialog).toHaveCount(0);
  await expect(page.getByText("密码已修改，其他旧会话已失效")).toBeVisible();
  const oldPasswordLogin = await request.post(
    `${apiBase}/api/v1/auth/admin/login`,
    {
      data: {
        username: `p1a.admin.${suffix}`,
        password: "p1a admin setup password",
      },
    },
  );
  expect(oldPasswordLogin.status()).toBe(401);
  const newPasswordLogin = await request.post(
    `${apiBase}/api/v1/auth/admin/login`,
    {
      data: {
        username: `p1a.admin.${suffix}`,
        password: "p1a admin profile password",
      },
    },
  );
  expect(newPasswordLogin.status(), await newPasswordLogin.text()).toBe(200);

  await page.getByRole("menuitem", { name: "员工与权限" }).click();
  await page.getByRole("button", { name: "新增员工" }).click();
  await page.getByLabel("姓名").fill(managerDisplayName);
  await page.getByLabel("登录账号").fill(`p1a.manager.${suffix}`);
  await page.getByLabel("手机号").fill(`136${suffix.slice(-8)}`);
  await page.getByLabel("角色").click();
  await page
    .locator(".ant-select-item-option")
    .filter({ hasText: "点位负责人" })
    .click();
  await page.keyboard.press("Escape");
  await page.getByLabel("授权自提点").fill(`P1-A 授权点 ${suffix}`);
  await page
    .locator(".ant-select-item-option")
    .filter({ hasText: `P1-A 授权点 ${suffix}` })
    .click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "创建账号" }).click();
  const credentialDialog = page.getByRole("dialog", { name: /临时密码/ });
  await expect(credentialDialog).toBeVisible();
  const managerCredential = await credentialDialog.locator("code").textContent();
  expect(managerCredential).toBeTruthy();
  await credentialDialog.getByRole("button", { name: "我已安全交付给员工" }).click();
  await expect(credentialDialog).toHaveCount(0);

  let invalidated = false;
  const managerContext = await browser.newContext({ baseURL: adminBase });
  const managerPage = await managerContext.newPage();
  const managerFailures = watchBrowser(managerPage, () => invalidated);
  await managerPage.goto("/");
  await managerPage.getByLabel("账号").fill(`p1a.manager.${suffix}`);
  await managerPage.getByLabel("密码").fill(managerCredential!);
  await managerPage.getByRole("button", { name: /登\s*录/ }).click();
  await expect(managerPage.getByText("请先设置新密码", { exact: true })).toBeVisible();
  await managerPage
    .getByLabel("新密码", { exact: true })
    .fill("p1a manager setup password");
  await managerPage
    .getByLabel("确认新密码")
    .fill("p1a manager setup password");
  await managerPage.getByRole("button", { name: "保存新密码" }).click();
  await expect(managerPage.getByRole("heading", { name: "到货确认" })).toBeVisible();
  await expect(managerPage.getByRole("button", { name: "打开账号菜单" })).toContainText(`p1a.manager.${suffix}`);
  await expect(managerPage.getByText("商品列表", { exact: true })).toHaveCount(0);
  await expect(managerPage.getByText(`P1-A 授权点 ${suffix}`, { exact: true })).toHaveCount(0);

  const staffRow = await findStaffRow(page, managerDisplayName);
  await staffRow.getByRole("button", { name: "编辑" }).click();
  const editor = page.getByRole("dialog", { name: "编辑员工权限" });
  await expect(editor).toBeVisible();
  await editor.locator("#role").click();
  await editor
    .locator(".ant-select-item-option")
    .filter({ hasText: "财务" })
    .click();
  await editor.getByLabel("变更原因").fill("岗位调整为财务");
  await editor.getByRole("button", { name: /^保\s*存$/ }).click();
  await expect(editor).toHaveCount(0);
  invalidated = true;
  await managerPage.reload();
  await expect(
    managerPage.getByRole("button", { name: /登\s*录/ }),
  ).toBeVisible();

  await staffRow.getByRole("button", { name: "停用" }).click();
  let confirm = page.getByRole("dialog", { name: "确认停用员工" });
  await confirm.getByLabel("操作原因").fill("离岗交接");
  await confirm.getByRole("button", { name: "确认执行" }).click();
  await expect(staffRow.getByText("已停用", { exact: true })).toBeVisible();
  await staffRow.getByRole("button", { name: "恢复" }).click();
  confirm = page.getByRole("dialog", { name: "确认恢复员工" });
  await confirm.getByLabel("操作原因").fill("完成交接后恢复");
  await confirm.getByRole("button", { name: "确认执行" }).click();
  await staffRow.getByRole("button", { name: "编辑" }).click();
  const resetEditor = page.getByRole("dialog", { name: "编辑员工权限" });
  await resetEditor.getByRole("button", { name: "重置密码" }).click();
  confirm = page.getByRole("dialog", { name: "重置密码" });
  await confirm.getByLabel("操作原因").fill("密码轮换");
  await confirm.getByRole("button", { name: "确认执行" }).click();
  const resetCredentialDialog = page.getByRole("dialog", { name: /临时密码/ });
  await expect(resetCredentialDialog).toBeVisible();
  await resetCredentialDialog.getByRole("button", { name: "我已安全交付给员工" }).click();
  await staffRow.getByRole("button", { name: "停用" }).click();
  confirm = page.getByRole("dialog", { name: "确认停用员工" });
  await confirm.getByLabel("操作原因").fill("离岗归档");
  await confirm.getByRole("button", { name: "确认执行" }).click();
  await staffRow.getByRole("button", { name: "删除" }).click();
  confirm = page.getByRole("dialog", { name: "删除员工" });
  await confirm.getByLabel("操作原因").fill("人员资料归档");
  await confirm.getByRole("button", { name: "确认执行" }).click();
  await expect(staffRow).toHaveCount(0);

  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "新增员工" })).toBeVisible();
  }
  expect(failures).toEqual([]);
  expect(managerFailures).toEqual([]);
  await managerContext.close();
  void point;
});

test("同一标签切换账号会清空旧工作区，客服和财务刷新只重取当前页数据", async ({
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
  await expect(page.getByRole("heading", { name: "到货确认" })).toBeVisible();
  await logout();
  await expect(page.getByRole("heading", { name: "到货确认" })).toHaveCount(0);
  await loginWithTemporaryPassword(managerB);
  await expect(page.getByRole("heading", { name: "到货确认" })).toBeVisible();
  await expect(page.getByText(`换号点位 A ${suffix}`, { exact: true })).toHaveCount(0);

  await logout();
  const serviceReads: string[] = [];
  page.on("response", (response) => {
    if (
      response.request().method() === "GET" &&
      [
        "/api/v1/admin/quality-cases",
        "/api/v1/admin/fulfillment-exceptions",
      ].some((path) => response.url().includes(path))
    ) {
      serviceReads.push(response.url());
    }
  });
  await loginWithTemporaryPassword(customerService);
  await expect(page.getByRole("heading", { name: "售后与异常" })).toBeVisible();
  // Cancellation requests have their own page; this view owns two queues.
  await expect.poll(() => serviceReads.length).toBeGreaterThanOrEqual(2);
  const serviceBeforeRefresh = serviceReads.length;
  await page.getByRole("button", { name: "刷新" }).click();
  await expect.poll(() => serviceReads.length).toBeGreaterThanOrEqual(serviceBeforeRefresh + 2);

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
  await expect(page.getByRole("heading", { name: "退款待办" })).toBeVisible();
  await expect.poll(() => financeReads.length).toBeGreaterThanOrEqual(2);
  await page.getByRole("menuitem", { name: "账务流水", exact: true }).click();
  await expect(page.getByRole("heading", { name: "账务流水", level: 2 })).toBeVisible();
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
