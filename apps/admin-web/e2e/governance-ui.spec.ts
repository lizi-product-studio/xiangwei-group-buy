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
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByText("请先设置新密码", { exact: true })).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill(password);
  await page.getByLabel("确认新密码").fill(password);
  await page.getByRole("button", { name: "保存新密码" }).click();
}

async function loginInBrowser(page: Page, username: string, password: string) {
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: /登\s*录/ }).click();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "打开账号菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: /登\s*录/ })).toBeVisible();
}

function dateInput(hoursFromNow: number) {
  const value = new Date(Date.now() + hoursFromNow * 60 * 60_000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

test("客服、运营、财务和超管从网页完成治理闭环", async ({
  page,
  request,
}) => {
  let allowExpectedQualityRefreshFailure = false;
  let allowExpectedCancellationRefreshFailure = false;
  const failures = watchBrowser(
    page,
    (response) =>
      (response.status() === 409 &&
        response.url().endsWith("/api/v1/admin/catalog/skus")) ||
      (response.status() === 503 &&
        ((allowExpectedQualityRefreshFailure &&
          new URL(response.url()).pathname === "/api/v1/admin/quality-cases") ||
          (allowExpectedCancellationRefreshFailure &&
            new URL(response.url()).pathname === "/api/v1/admin/community/cancellation-requests"))),
  );
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const password = "p1c governance browser password";
  const createStaff = async (
    role: "SUPER_ADMIN" | "OPERATOR" | "CUSTOMER_SERVICE" | "FINANCE" | "PICKUP_MANAGER",
    pickupPointIds: string[] = [],
  ) => {
    const username = `p1c.${role.toLowerCase()}.${suffix}`;
    const value = await post<{ temporaryPassword: string }>(
      request,
      "/api/v1/admin/staff",
      {
        displayName: `P1-C ${role}`,
        username,
        phone: `135${`${suffix}${role.length}`.slice(-8)}`,
        role,
        pickupPointIds,
      },
    );
    return { username, temporaryPassword: value.temporaryPassword };
  };

  const area = await post<{ id: string }>(request, "/api/v1/admin/service-areas", {
    regionCode: "110101",
  });
  const point = await post<{ id: string }>(request, "/api/v1/admin/pickup-points", {
    serviceAreaId: area.id,
    name: `P1-C 治理点 ${suffix}`,
    address: "东城区治理闭环测试点一号",
    businessHours: "每日 09:00–20:00",
    pickupInstructions: "到店后出示六码领取码",
    longitude: 116.41,
    latitude: 39.92,
    contactName: "治理负责人",
    contactPhone: "13800138018",
    capacityPerDay: 30,
  });
  await post<{ id: string }>(request, "/api/v1/admin/pickup-points", {
    serviceAreaId: area.id,
    name: `P1-C 空闲点 ${suffix}`,
    address: "东城区治理闭环测试点二号",
    businessHours: "每日 09:00–20:00",
    pickupInstructions: "到店后出示六码领取码",
    longitude: 116.42,
    latitude: 39.93,
    contactName: "空闲点负责人",
    contactPhone: "13800138028",
    capacityPerDay: 30,
  });
  const superAdmin = await createStaff("SUPER_ADMIN");
  const manager = await createStaff("PICKUP_MANAGER", [point.id]);
  const customerService = await createStaff("CUSTOMER_SERVICE");
  const operator = await createStaff("OPERATOR");
  const finance = await createStaff("FINANCE");

  const superLogin = await request.fetch(`${apiBase}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: {
      username: superAdmin.username,
      password: superAdmin.temporaryPassword,
    },
  });
  expect(superLogin.status(), await superLogin.text()).toBe(200);
  const superChallenge = (await superLogin.json()).data.passwordChangeToken as string;
  const activateResponse = await request.fetch(`${apiBase}/api/v1/auth/admin/complete-password-change`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: {
      passwordChangeToken: superChallenge,
      newPassword: password,
    },
  });
  expect(activateResponse.status(), await activateResponse.text()).toBe(200);
  const superToken = (await activateResponse.json()).data.accessToken as string;
  const managerLogin = await request.fetch(`${apiBase}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: { username: manager.username, password: manager.temporaryPassword },
  });
  expect(managerLogin.status(), await managerLogin.text()).toBe(200);
  const managerChallenge = (await managerLogin.json()).data.passwordChangeToken as string;
  const managerActivation = await request.fetch(`${apiBase}/api/v1/auth/admin/complete-password-change`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: { passwordChangeToken: managerChallenge, newPassword: password },
  });
  expect(managerActivation.status(), await managerActivation.text()).toBe(200);
  const managerToken = (await managerActivation.json()).data.accessToken as string;

  const sku = await post<{ id: string }>(request, "/api/v1/admin/catalog/skus", {
    title: `P1-C 番茄 ${suffix}`,
    category: "蔬菜",
    origin: "本地农场",
    imageUrl: null,
    skuName: "一份",
    retailPriceCents: 1680,
    defaultSellableQuantity: 20,
    status: "ACTIVE",
  });
  const campaign = await post<{ id: string; deliveryPlan: { id: string } }>(
    request,
    "/api/v1/admin/campaigns",
    {
      title: `P1-C 治理团 ${suffix}`,
      serviceAreaId: area.id,
      pickupPointId: point.id,
      // The prerequisite creates four independently paid orders before the
      // explicit close action below. Ten seconds leaves setup headroom while
      // preserving the real cutoff state transition asserted by the poll.
      cutoffAt: new Date(Date.now() + 10_000).toISOString(),
      dispatchAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      estimatedArrivalStartAt: new Date(Date.now() + 90 * 60_000).toISOString(),
      estimatedArrivalEndAt: new Date(Date.now() + 120 * 60_000).toISOString(),
      minTotalQuantity: 1,
      failureAction: "CANCEL_AND_REFUND",
      items: [{ catalogSkuId: sku.id, retailPriceCents: 1680, sellableQuantity: 20 }],
    },
  );
  await post(request, `/api/v1/admin/campaigns/${campaign.id}/open`, {});

  const createPaidOrder = async (index: number) => {
    const userId = `p1c.user.${suffix}.${index}`;
    const headers = {
      "x-demo-user-id": userId,
      "x-demo-role": "USER",
      "content-type": "application/json",
      "idempotency-key": `p1c-governance-order-${suffix}-${index}`,
    };
    const order = await request.fetch(`${apiBase}/api/v1/orders`, {
      method: "POST",
      headers,
      data: {
        campaignId: campaign.id,
        serviceAreaId: area.id,
        pickupPointId: point.id,
        items: [{ skuId: sku.id, quantity: 1 }],
      },
    });
    expect(order.status(), await order.text()).toBe(201);
    const value = (await order.json()).data as { id: string; orderNo: string };
    const paid = await request.fetch(
      `${apiBase}/api/v1/orders/${value.id}/pay/mock-confirm`,
      { method: "POST", headers: { "x-demo-user-id": userId, "x-demo-role": "USER" } },
    );
    expect(paid.status(), await paid.text()).toBeLessThan(300);
    const view = await request.fetch(`${apiBase}/api/v1/orders/${value.id}`, {
      headers: { "x-demo-user-id": userId, "x-demo-role": "USER" },
    });
    expect(view.status(), await view.text()).toBe(200);
    return { ...(await view.json()).data as { id: string; orderNo: string }, userId };
  };
  const qualityA = await createPaidOrder(1);
  const qualityB = await createPaidOrder(2);
  const cancelA = await createPaidOrder(3);
  const cancelB = await createPaidOrder(4);
  await expect
    .poll(async () => {
      const response = await request.fetch(
        `${apiBase}/api/v1/admin/campaigns/${campaign.id}/close`,
        { method: "POST", headers: superHeaders, data: {} },
      );
      if (![200, 409].includes(response.status()))
        throw new Error(`关闭团期异常：${response.status()} ${await response.text()}`);
      return response.status();
    }, { timeout: 15_000, intervals: [250, 500] })
    .toBe(200);

  for (const value of [cancelA, cancelB]) {
    const response = await request.fetch(`${apiBase}/api/v1/orders/${value.id}/cancel`, {
      method: "POST",
      headers: {
        "x-demo-user-id": value.userId,
        "x-demo-role": "USER",
        "content-type": "application/json",
      },
      data: { reason: "截单后需要运营审核的取消申请" },
    });
    expect(response.status(), await response.text()).toBe(200);
  }

  await page.goto("/");
  await completeTemporaryPasswordInBrowser(page, operator.username, operator.temporaryPassword, password);
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();
  await page.getByRole("menuitem", { name: "售后与异常" }).click();
  const cancelApproveRow = page.getByRole("row").filter({ hasText: cancelA.orderNo });
  await cancelApproveRow.getByRole("button", { name: /批\s*准/ }).click();
  await page.getByRole("dialog", { name: "填写取消批准理由" }).getByLabel("审核理由").fill("运营确认可以原路退款");
  await page.getByRole("dialog", { name: "填写取消批准理由" }).getByRole("button", { name: "继续复核" }).click();
  await page.getByRole("dialog", { name: "二次确认取消申请审核" }).getByRole("button", { name: "确认提交" }).click();
  await expect(cancelApproveRow.getByText("待财务退款", { exact: true })).toBeVisible();
  const cancelRejectRow = page.getByRole("row").filter({ hasText: cancelB.orderNo });
  await cancelRejectRow.getByRole("button", { name: /拒\s*绝/ }).click();
  await page.getByRole("dialog", { name: "填写取消拒绝理由" }).getByLabel("审核理由").fill("已有不可撤销的履约安排");
  await page.getByRole("dialog", { name: "填写取消拒绝理由" }).getByRole("button", { name: "继续复核" }).click();
  await page.getByRole("dialog", { name: "二次确认取消申请审核" }).getByRole("button", { name: "确认提交" }).click();
  await expect(cancelRejectRow.getByText("已拒绝", { exact: true })).toBeVisible();

  await logout(page);
  await completeTemporaryPasswordInBrowser(page, finance.username, finance.temporaryPassword, password);
  await expect(page.getByRole("heading", { name: "财务管理" })).toBeVisible();
  const financeCancellation = page.getByRole("region", { name: "截单后取消退款" }).getByRole("row").filter({ hasText: cancelA.orderNo });
  await expect(
    financeCancellation.getByRole("button", { name: "执行退款" }),
  ).toBeVisible();
  let failedCancellationRefreshes = 0;
  await page.route(
    "**/api/v1/admin/community/cancellation-requests?*",
    async (route) => {
      if (!allowExpectedCancellationRefreshFailure) return route.continue();
      failedCancellationRefreshes += 1;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "TRANSIENT_READ_FAILURE",
          message: "模拟刷新失败",
        }),
      });
    },
  );
  allowExpectedCancellationRefreshFailure = true;
  await financeCancellation.getByRole("button", { name: "执行退款" }).click();
  await page.getByRole("dialog", { name: "二次确认执行取消退款" }).getByRole("button", { name: "确认执行退款" }).click();
  await expect.poll(() => failedCancellationRefreshes).toBe(1);
  allowExpectedCancellationRefreshFailure = false;
  await page.unroute("**/api/v1/admin/community/cancellation-requests?*");
  await expect(financeCancellation.getByRole("button", { name: "执行退款" })).toHaveCount(0);

  // Four one-item orders were paid; cancelA has now been refunded and must
  // never contribute to arrival or allocation. The rejected cancelB remains.
  for (const value of [cancelA, qualityA, qualityB, cancelB]) {
    const response = await request.fetch(`${apiBase}/api/v1/orders/${value.id}`, {
      headers: { "x-demo-user-id": value.userId, "x-demo-role": "USER" },
    });
    expect(response.status(), await response.text()).toBe(200);
    expect((await response.json()).data.status).toBe(value.id === cancelA.id ? "REFUNDED" : "LOCKED");
  }

  await post(request, `/api/v1/admin/delivery-plans/${campaign.deliveryPlan.id}/book-vehicle`, {
    logisticsPlatform: "P1-C 测试车队",
    vehicleOrderNo: `P1C-${suffix}`,
    driverName: "张师傅",
    driverPhone: "13800138019",
    vehiclePlate: "京P1C01",
    estimatedArrivalAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  const batch = await post<{ id: string }>(request, "/api/v1/admin/dispatch-batches", { campaignId: campaign.id });
  await post(request, `/api/v1/admin/dispatch-batches/${batch.id}/dispatch`, {});
  const arrival = await request.fetch(
    `${apiBase}/api/v1/admin/community/dispatch-batches/${batch.id}/arrival`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${superToken}`, "content-type": "application/json" },
      data: {
        receivedBy: "P1-C 紧急代办人",
        confirmationNote: "为治理角色验收建立到货前置",
        emergencyReason: "浏览器验收的品质售后前置",
        items: [{ catalogSkuId: sku.id, receivedQuantity: 3, rejectedQuantity: 0, shortQuantity: 0, damagedQuantity: 0, reason: null, evidenceNote: null }],
      },
    },
  );
  expect(arrival.status(), await arrival.text()).toBe(200);
  const managerHeaders = { authorization: `Bearer ${managerToken}`, "content-type": "application/json" };
  for (const [index, value] of [qualityA, qualityB].entries()) {
    const codeResponse = await request.fetch(`${apiBase}/api/v1/pickup-code?orderId=${value.id}`, {
      headers: { "x-demo-user-id": value.userId, "x-demo-role": "USER" },
    });
    expect(codeResponse.status(), await codeResponse.text()).toBe(200);
    const code = (await codeResponse.json()).data.code as string;
    const verify = await request.fetch(`${apiBase}/api/v1/pickup/verify`, {
      method: "POST",
      headers: managerHeaders,
      data: {
        orderId: value.id,
        deliveryPlanId: campaign.deliveryPlan.id,
        code,
        pickupRequestId: randomUUID(),
        items: [{ catalogSkuId: sku.id, quantity: 1 }],
      },
    });
    expect(verify.status(), await verify.text()).toBe(200);
    const quality = await request.fetch(`${apiBase}/api/v1/orders/${value.id}/quality-cases`, {
      method: "POST",
      headers: { "x-demo-user-id": value.userId, "x-demo-role": "USER", "content-type": "application/json" },
      data: {
        clientRequestId: `p1c-quality-${suffix}-${index}`,
        items: [{ catalogSkuId: sku.id, quantity: 1, reason: "QUALITY_CLAIM", description: "番茄在领取后发现明显压伤" }],
      },
    });
    expect(quality.status(), await quality.text()).toBe(201);
  }
  const intent = await request.fetch(`${apiBase}/api/v1/service-area-interests`, {
    method: "POST",
    headers: { "x-demo-user-id": `p1c.intent.${suffix}`, "x-demo-role": "USER", "content-type": "application/json" },
    data: {
      regionText: "朝阳区望京",
      contactName: "意向用户",
      contactPhone: "13900000000",
      privacyAccepted: true,
      privacyVersion: "2026-09-07-phone-v1",
    },
  });
  expect(intent.status(), await intent.text()).toBe(201);
  const areaInterest = (await intent.json()).data as { id: string };

  await logout(page);
  await completeTemporaryPasswordInBrowser(page, customerService.username, customerService.temporaryPassword, password);
  await expect(page.getByRole("heading", { name: "售后与异常" })).toBeVisible();
  for (const value of [qualityA, qualityB]) {
    const row = page.getByRole("row").filter({ hasText: value.orderNo });
    await expect(row.getByText("番茄在领取后发现明显压伤")).toBeVisible();
    await row.getByRole("button", { name: /受\s*理/ }).click();
    const form = page.getByRole("dialog", { name: "填写受理说明" });
    await form.getByLabel("处理说明").fill("客服已核验订单、商品与提货凭据");
    await form.getByRole("button", { name: "继续复核" }).click();
    await page.getByRole("dialog", { name: "二次确认品质售后处理" }).getByRole("button", { name: "确认提交" }).click();
    await expect(row.getByText("已受理", { exact: true })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "运营治理" }).click();
  await expect(page.getByRole("heading", { name: "运营治理" })).toBeVisible();
  const notificationQueue = page.getByRole("region", { name: "通知人工处理队列" });
  await expect(page.getByText("系统未采集手机号", { exact: true })).toBeVisible();
  const retryNotificationRow = notificationQueue
    .getByRole("row")
    .filter({ hasText: qualityA.orderNo })
    .filter({ hasText: "已到货" });
  const manualNotificationRow = notificationQueue
    .getByRole("row")
    .filter({ hasText: qualityB.orderNo })
    .filter({ hasText: "已到货" });
  await expect(retryNotificationRow).toBeVisible();
  await expect(manualNotificationRow).toBeVisible();
  await retryNotificationRow.getByRole("button", { name: "系统重试" }).click();
  const retryDialog = page.getByRole("dialog", { name: "二次确认系统重试" });
  await expect(retryDialog).toContainText(qualityA.orderNo);
  await retryDialog.getByRole("button", { name: /取\s*消/ }).click();
  await expect(retryDialog).toHaveCount(0);
  await expect(retryNotificationRow.getByRole("button", { name: "系统重试" })).toBeVisible();
  await retryNotificationRow.getByRole("button", { name: "系统重试" }).click();
  const retryRequest = page.waitForRequest(
    (candidate) =>
      candidate.method() === "POST" &&
      /\/api\/v1\/admin\/notifications\/[^/]+\/retry$/.test(candidate.url()),
  );
  await retryDialog.getByRole("button", { name: "确认重新投递" }).click();
  await retryRequest;
  await expect(retryNotificationRow.getByRole("button", { name: "系统重试" })).toHaveCount(0);
  await expect(manualNotificationRow.getByRole("button", { name: "人工完成" })).toBeVisible();
  await manualNotificationRow.getByRole("button", { name: "人工完成" }).click();
  const manualForm = page.getByRole("dialog", { name: "填写人工处理说明" });
  await manualForm.getByLabel("联系渠道").click();
  await manualForm.getByLabel("联系渠道").press("ArrowDown");
  await manualForm.getByLabel("联系渠道").press("Enter");
  await manualForm.getByLabel("外部会话或工单编号").fill("wx-session-e2e-001");
  await manualForm.getByLabel("联系结果").click();
  await manualForm.getByLabel("联系结果").press("ArrowDown");
  await manualForm.getByLabel("联系结果").press("ArrowDown");
  await manualForm.getByLabel("联系结果").press("Enter");
  await manualForm.getByLabel("处理说明").fill("已通过既有合规渠道完成到货提醒处理");
  await manualForm.getByRole("button", { name: "继续复核" }).click();
  await page.getByRole("dialog", { name: "二次确认人工完成" }).getByRole("button", { name: "确认人工完成" }).click();
  await expect(manualNotificationRow).toHaveCount(0);
  const interestRow = page.getByRole("region", { name: "区域开通意向" }).getByRole("row").filter({ hasText: "朝阳区望京" });
  await expect(interestRow.getByText("139****0000", { exact: true })).toBeVisible();
  await interestRow.getByRole("button", { name: "登记已联系" }).click();
  const interestForm = page.getByRole("dialog", { name: "登记已联系" });
  await interestForm.getByLabel("状态变更说明").fill("已记录开通条件咨询结果");
  await interestForm.getByRole("button", { name: "继续复核" }).click();
  await page.getByRole("dialog", { name: "二次确认意向状态" }).getByRole("button", { name: "确认更新" }).click();
  await interestRow.getByRole("button", { name: "关闭意向" }).click();
  const closeInterestForm = page.getByRole("dialog", { name: "关闭区域意向" });
  await closeInterestForm.getByLabel("状态变更说明").fill("当前区域条件未达到开通标准，已完成记录");
  await closeInterestForm.getByRole("button", { name: "继续复核" }).click();
  await page.getByRole("dialog", { name: "二次确认意向状态" }).getByRole("button", { name: "确认更新" }).click();
  await expect(interestRow.locator(".ant-tag").filter({ hasText: "已关闭" })).toBeVisible();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expect(page.getByRole("heading", { name: "运营治理" })).toBeVisible();
  }

  await logout(page);
  await loginInBrowser(page, operator.username, password);
  await page.getByRole("menuitem", { name: "售后与异常" }).click();
  const qualityApproveRow = page.getByRole("row").filter({ hasText: qualityA.orderNo });
  await qualityApproveRow.getByRole("button", { name: "批准退款" }).click();
  const approveForm = page.getByRole("dialog", { name: "填写批准退款说明" });
  await approveForm.getByLabel("处理说明").fill("运营确认商品品质问题，批准按原路退款");
  await approveForm.getByRole("button", { name: "继续复核" }).click();
  await page.getByRole("dialog", { name: "二次确认品质售后处理" }).getByRole("button", { name: "确认提交" }).click();
  await expect(qualityApproveRow.getByText("退款中", { exact: true })).toBeVisible();
  const qualityRejectRow = page.getByRole("row").filter({ hasText: qualityB.orderNo });
  await qualityRejectRow.getByRole("button", { name: /拒\s*绝/ }).click();
  const rejectForm = page.getByRole("dialog", { name: "填写拒绝申请说明" });
  await rejectForm.getByLabel("处理说明").fill("凭据与申报内容不匹配，运营拒绝退款");
  await rejectForm.getByRole("button", { name: "继续复核" }).click();
  await page.getByRole("dialog", { name: "二次确认品质售后处理" }).getByRole("button", { name: "确认提交" }).click();
  await expect(qualityRejectRow.getByText("已拒绝", { exact: true })).toBeVisible();

  await logout(page);
  await loginInBrowser(page, finance.username, password);
  const qualityFinanceRow = page.getByRole("region", { name: "品质售后退款" }).getByRole("row").filter({ hasText: qualityA.orderNo });
  await expect(
    qualityFinanceRow.getByRole("button", { name: "执行退款" }),
  ).toBeVisible();
  let failedQualityRefreshes = 0;
  await page.route("**/api/v1/admin/quality-cases?*", async (route) => {
    if (!allowExpectedQualityRefreshFailure) return route.continue();
    failedQualityRefreshes += 1;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "TRANSIENT_READ_FAILURE", message: "模拟刷新失败" }),
    });
  });
  allowExpectedQualityRefreshFailure = true;
  await qualityFinanceRow.getByRole("button", { name: "执行退款" }).click();
  await page.getByRole("dialog", { name: "二次确认执行品质退款" }).getByRole("button", { name: "确认执行退款" }).click();
  await expect.poll(() => failedQualityRefreshes).toBe(1);
  allowExpectedQualityRefreshFailure = false;
  await page.unroute("**/api/v1/admin/quality-cases?*");
  await expect(qualityFinanceRow.getByRole("button", { name: "执行退款" })).toHaveCount(0);
  await expect(page.getByText("已平衡", { exact: true }).first()).toBeVisible();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("heading", { name: "财务管理" })).toBeVisible();
  }

  await logout(page);
  await loginInBrowser(page, superAdmin.username, password);
  await page.getByRole("menuitem", { name: "审计记录" }).click();
  await expect(page.getByRole("heading", { name: "审计记录" })).toBeVisible();
  const auditRows = page
    .getByRole("row")
    .filter({ hasText: "区域意向状态变更" })
    .filter({ hasText: areaInterest.id });
  await expect(auditRows).toHaveCount(2);
  for (let index = 0; index < 2; index += 1)
    await auditRows.nth(index).locator(".ant-table-row-expand-icon").click();
  expect(await page.locator(".audit-snapshot").filter({ hasText: /\[REDACTED\]/ }).count()).toBeGreaterThan(0);
  expect(await page.locator("body").innerText()).not.toContain("13900000000");
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expect(page.getByRole("heading", { name: "审计记录" })).toBeVisible();
  }

  const postponedCampaign = await post<{ id: string }>(request, "/api/v1/admin/campaigns", {
    title: `P1-C 网页顺延团 ${suffix}`,
    serviceAreaId: area.id,
    pickupPointId: point.id,
    cutoffAt: new Date(Date.now() + 1_500).toISOString(),
    dispatchAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    estimatedArrivalStartAt: new Date(Date.now() + 90 * 60_000).toISOString(),
    estimatedArrivalEndAt: new Date(Date.now() + 120 * 60_000).toISOString(),
    minTotalQuantity: 99,
    failureAction: "POSTPONE",
    items: [{ catalogSkuId: sku.id, retailPriceCents: 1680, sellableQuantity: 20 }],
  });
  await post(request, `/api/v1/admin/campaigns/${postponedCampaign.id}/open`, {});
  await expect
    .poll(async () => {
      const response = await request.fetch(
        `${apiBase}/api/v1/admin/campaigns/${postponedCampaign.id}/close`,
        { method: "POST", headers: superHeaders, data: {} },
      );
      if (![200, 409].includes(response.status()))
        throw new Error(`等待顺延团期截单异常：${response.status()} ${await response.text()}`);
      return response.status();
    }, { timeout: 15_000, intervals: [250, 500] })
    .toBe(200);

  await page.getByRole("menuitem", { name: "团期管理" }).click();
  const postponedRow = page.getByRole("row").filter({ hasText: `P1-C 网页顺延团 ${suffix}` });
  await postponedRow.getByRole("button", { name: "顺延团期" }).click();
  const postponeDialog = page.getByRole("dialog", { name: "顺延团期" });
  const fillDate = async (label: string, value: string) => {
    const control = postponeDialog.getByLabel(label);
    await control.fill(value);
    await control.press("Tab");
  };
  await fillDate("新截单时间", dateInput(12));
  await fillDate("新发车时间", dateInput(24));
  await fillDate("新预计到货开始", dateInput(28));
  await fillDate("新预计到货结束", dateInput(32));
  await postponeDialog.getByRole("button", { name: "确认顺延" }).click();
  await expect(postponedRow.getByText("开售中", { exact: true })).toBeVisible();

  await page.getByRole("menuitem", { name: "商品管理" }).click();
  const skuRow = page.getByRole("row").filter({ hasText: `P1-C 番茄 ${suffix}` });
  await skuRow.getByRole("button", { name: /停\s*用/ }).click();
  await expect(page.getByText(/仍有进行中团期或未完成订单/)).toBeVisible();
  await expect(skuRow.getByText("启用", { exact: true })).toBeVisible();

  await page.getByRole("menuitem", { name: "区域与自提点" }).click();
  const idlePointRow = page.getByRole("row").filter({ hasText: `P1-C 空闲点 ${suffix}` });
  await idlePointRow.getByRole("button", { name: /停\s*用/ }).click();
  const pointDialog = page.getByRole("dialog", { name: "编辑自提点" });
  await pointDialog.getByLabel("点位状态").click();
  await page.locator(".ant-select-item-option").filter({ hasText: "停用" }).last().click();
  await page.keyboard.press("Escape");
  await pointDialog.getByRole("button", { name: "保存修改" }).click();
  await expect(idlePointRow.getByText("已停用", { exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});
