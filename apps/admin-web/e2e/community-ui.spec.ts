import { expect, test, type APIRequestContext } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3101";
const superHeaders = {
  "x-demo-user-id": "demo-super-admin",
  "x-demo-role": "SUPER_ADMIN",
};
async function call<T>(
  request: APIRequestContext,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(`${apiBase}${path}`, {
    method: "POST",
    headers:
      data === undefined
        ? superHeaders
        : { ...superHeaders, "content-type": "application/json" },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
  return (await response.json()).data as T;
}

test("运营后台只呈现社区主线，点位负责人只进入网页工作台", async ({
  page,
  request,
}) => {
  await page.route("https://webrd0*.is.autonavi.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL50QAAAABJRU5ErkJggg==",
        "base64",
      ),
    }),
  );
  const browserFailures: string[] = [];
  let campaignCreateRequests = 0;
  let pickupPointWrites = 0;
  let allowExpectedLocationVerificationFailure = false;
  let allowExpectedPickupDuplicate = false;
  page.on("pageerror", (error) => browserFailures.push(`pageerror: ${error.message}`));
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/admin/campaigns")
    )
      campaignCreateRequests += 1;
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/admin/pickup-points")
    )
      pickupPointWrites += 1;
  });
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "unknown";
    // Logout intentionally navigates away before its best-effort request can
    // finish; every other failed browser request remains an E2E failure.
    if (error !== "net::ERR_ABORTED")
      browserFailures.push(`requestfailed: ${request.url()} ${error}`);
  });
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      !allowExpectedLocationVerificationFailure &&
      !(
        allowExpectedPickupDuplicate &&
        response.status() === 409 &&
        response.url().endsWith("/api/v1/admin/pickup-points")
      )
    )
      browserFailures.push(`http ${response.status()}: ${response.url()}`);
  });
  const suffix = Date.now().toString();
  const admin = await call<{ initialCredential: string }>(
    request,
    "/api/v1/admin/staff",
    {
      displayName: "E2E 管理员",
      username: `admin.${suffix}`,
      phone: `138${suffix.slice(-8)}`,
      role: "SUPER_ADMIN",
      pickupPointIds: [],
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "首次激活账号" }).click();
  await page.getByLabel("账号").fill(`admin.${suffix}`);
  await page.getByLabel("一次性初始凭据").fill(admin.initialCredential);
  await page.getByLabel("新密码").fill("community e2e admin password");
  await page.getByRole("button", { name: "完成首次激活" }).click();
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  const area = await call<{ id: string }>(
    request,
    "/api/v1/admin/service-areas",
    { regionCode: "110101" },
  );
  await call(request, `/api/v1/admin/service-areas/${area.id}/order-status`, {
    orderEnabled: true,
  });
  await call(request, "/api/v1/admin/catalog/categories", {
    name: `蔬菜 ${suffix}`,
    sortOrder: 1,
  });
  const point = await call<{ id: string }>(
    request,
    "/api/v1/admin/pickup-points",
    {
      serviceAreaId: area.id,
      name: `E2E 社区点 ${suffix}`,
      address: "东城区社区服务站 1 号",
      businessHours: "每日 09:00–20:00",
      pickupInstructions: "到店出示领取码",
      longitude: 116.4167,
      latitude: 39.9289,
      contactName: "王店长",
      contactPhone: "13800138000",
      capacityPerDay: 100,
    },
  );
  const manager = await call<{ initialCredential: string }>(
    request,
    "/api/v1/admin/staff",
    {
      displayName: "E2E 点位负责人",
      username: `manager.${suffix}`,
      phone: `139${suffix.slice(-8)}`,
      role: "PICKUP_MANAGER",
      pickupPointIds: [point.id],
    },
  );
  const operator = await call<{ initialCredential: string }>(
    request,
    "/api/v1/admin/staff",
    {
      displayName: "E2E 运营",
      username: `operator.${suffix}`,
      phone: `137${suffix.slice(-8)}`,
      role: "OPERATOR",
      pickupPointIds: [],
    },
  );
  const finance = await call<{ initialCredential: string }>(
    request,
    "/api/v1/admin/staff",
    {
      displayName: "E2E 财务",
      username: `finance.${suffix}`,
      phone: `136${suffix.slice(-8)}`,
      role: "FINANCE",
      pickupPointIds: [],
    },
  );
  // The service area was prepared through the API so the new launch boundary
  // is exercised without relying on a synthetic default point. Refresh the
  // current admin workspace before selecting that real area in the UI.
  await page.reload();
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  await expect(page.getByText("商品管理", { exact: true })).toBeVisible();
  await expect(page.getByText("团期管理", { exact: true })).toBeVisible();
  await expect(page.getByText("配送与到货", { exact: true })).toBeVisible();
  await page.getByText("商品管理", { exact: true }).click();
  await page.getByRole("button", { name: "新增商品" }).click();
  await page.getByLabel("商品名称").fill(`E2E 时蔬 ${suffix}`);
  await page.getByLabel("分类").click();
  await page.getByText(`蔬菜 ${suffix}`, { exact: true }).click();
  await page.getByLabel("产地").fill("本地农场");
  await page.getByLabel("销售规格（包装单位）").fill("一份");
  await page.getByLabel("售价（元）").fill("19.999");
  await page.getByLabel("默认团期可售量").fill("100");
  await page.getByRole("button", { name: "保存商品" }).click();
  await expect(page.getByText("请输入最多两位小数的元金额")).toBeVisible();
  await page.getByLabel("售价（元）").fill("19.90");
  await page.getByRole("button", { name: "保存商品" }).click();
  await expect(page.getByText(`E2E 时蔬 ${suffix}`)).toBeVisible();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: `E2E 时蔬 ${suffix}` })
      .getByText("¥19.90"),
  ).toBeVisible();

  const reviewPointName = `E2E 复核点 ${suffix}`;
  await page.getByText("区域与自提点", { exact: true }).click();
  await page.getByRole("button", { name: "新增自提点" }).click();
  const pointAreaSelect = page.getByLabel("服务区域");
  if (await pointAreaSelect.count()) {
    await pointAreaSelect.click();
    await page.locator(".ant-select-item-option").last().click();
  }
  await page.getByLabel("自提点名称").fill(reviewPointName);
  await page.getByLabel("详细地址或地点名称").fill("东城区社区大街 88 号一层");
  await page.route("**/api/v1/admin/geo/reverse?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "LOCATION_VERIFICATION_UNAVAILABLE",
        message: "模拟位置服务不可用",
      }),
    }),
  );
  allowExpectedLocationVerificationFailure = true;
  await page
    .getByRole("application", { name: "自提点地图，点击或拖动图钉选择实际位置" })
    .click({ position: { x: 120, y: 100 } });
  await expect(page.getByText(/位置核验暂时不可用/)).toBeVisible();
  await expect(
    page.locator('.ant-modal:visible button[type="submit"]'),
  ).toBeDisabled();
  expect(pickupPointWrites).toBe(0);
  await page.unroute("**/api/v1/admin/geo/reverse?**");
  await page.route("**/api/v1/admin/geo/reverse?**", (route) => {
    const url = new URL(route.request().url());
    const latitude = Number(url.searchParams.get("latitude"));
    const longitude = Number(url.searchParams.get("longitude"));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          title: "东城区社区大街自提点",
          address: "北京市东城区社区大街 88 号一层",
          latitude,
          longitude,
          provinceName: "北京市",
          cityName: "北京市",
          districtName: "东城区",
          adcode: "110101",
        },
      }),
    });
  });
  allowExpectedLocationVerificationFailure = false;
  await page.getByRole("button", { name: "重试核验" }).click();
  await expect(page.getByText("已定位，可拖动图钉微调")).toBeVisible();
  await expect(page.getByText(/地图图钉坐标（只读确认）/)).toBeVisible();
  await page.locator(".leaflet-tile").first().evaluate((tile) => {
    tile.dispatchEvent(new Event("error"));
  });
  await expect(page.getByText(/地图暂时不可用/)).toBeVisible();
  await expect(
    page.locator('.ant-modal:visible button[type="submit"]'),
  ).toBeDisabled();
  expect(pickupPointWrites).toBe(0);
  await page.getByRole("button", { name: "重试地图" }).click();
  await page
    .getByRole("application", { name: "自提点地图，点击或拖动图钉选择实际位置" })
    .click({ position: { x: 120, y: 100 } });
  await expect(page.getByText(/地图暂时不可用/)).toHaveCount(0);
  await expect(
    page.locator('.ant-modal:visible button[type="submit"]'),
  ).toBeEnabled();
  await page.getByLabel("营业时间").fill("每日 08:30–21:00");
  await page.getByLabel("领取提示").fill("请从南门进入并出示领取码");
  await page
    .locator('.ant-modal:visible button[type="submit"]')
    .click();
  await expect(page.getByText(reviewPointName)).toBeVisible();
  expect(pickupPointWrites).toBe(1);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: reviewPointName })
      .getByText("未关联负责人"),
  ).toBeVisible();

  const duplicatePointName = `${reviewPointName}（重复复核）`;
  await page.getByRole("button", { name: "新增自提点" }).click();
  const duplicateDialog = page.getByRole("dialog", { name: "新增自提点" });
  await expect(duplicateDialog).toBeVisible();
  const duplicateAreaSelect = duplicateDialog.getByLabel("服务区域");
  if (await duplicateAreaSelect.count()) {
    await duplicateAreaSelect.click();
    await page.locator(".ant-select-item-option").last().click();
  }
  await page.getByLabel("自提点名称").fill(duplicatePointName);
  await page.getByLabel("详细地址或地点名称").fill("东城区社区大街 88 号一层");
  await page.route("**/api/v1/admin/pickup-points", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as {
      name?: string;
      confirmDuplicate?: boolean;
    };
    if (body.name !== duplicatePointName || body.confirmDuplicate)
      return route.continue();
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        code: "POSSIBLE_DUPLICATE_PICKUP_LOCATION",
        message: "所选服务区域内存在疑似重复自提点",
        details: {
          candidates: [
            {
              id: "existing-e2e-point",
              name: reviewPointName,
              address: "北京市东城区社区大街 88 号一层",
              distanceMeters: 0,
            },
          ],
        },
      }),
    });
  });
  await page
    .getByRole("application", { name: "自提点地图，点击或拖动图钉选择实际位置" })
    .click({ position: { x: 120, y: 100 } });
  await expect(page.getByText("已定位，可拖动图钉微调")).toBeVisible();
  allowExpectedPickupDuplicate = true;
  await page.locator('.ant-modal:visible button[type="submit"]').click();
  const duplicateConfirmDialog = page.getByRole("dialog", { name: "发现疑似重复自提点" });
  await expect(duplicateConfirmDialog).toBeVisible();
  allowExpectedPickupDuplicate = false;
  await duplicateConfirmDialog.getByRole("button", { name: "确认不同，仍保存" }).click();
  await expect(page.getByText(duplicatePointName)).toBeVisible();
  expect(pickupPointWrites).toBe(3);

  const campaignTitle = `E2E 发布复核 ${suffix}`;
  const dateInput = (hoursFromNow: number) => {
    const value = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  };
  await page.getByRole("menuitem", { name: "团期管理" }).click();
  await page.getByRole("button", { name: "创建团期" }).click();
  await page.getByLabel("团期名称").fill(campaignTitle);
  const campaignAreaSelect = page.getByLabel("服务区域");
  if (await campaignAreaSelect.count()) {
    await campaignAreaSelect.click();
    await page.locator(".ant-select-item-option").last().click();
  }
  await page
    .getByLabel("固定自提点")
    .locator("xpath=../..")
    .click();
  await page.getByText(reviewPointName, { exact: true }).last().click();
  const cutoffInput = dateInput(24);
  const dispatchInput = dateInput(36);
  await page.getByLabel("截单时间").fill(cutoffInput);
  // The client must stop an invalid schedule before the review dialog or POST.
  await page.getByLabel("计划发车时间").fill(dateInput(12));
  await page.getByLabel("预计到货开始").fill(dateInput(40));
  await page.getByLabel("预计到货结束").fill(dateInput(44));
  const beforeInvalidCampaignSubmit = campaignCreateRequests;
  await page.getByRole("button", { name: "下一步：发布复核" }).click();
  await expect(page.getByText("计划发车时间必须晚于截单时间")).toBeVisible();
  await expect(page.getByText("创建前发布复核")).not.toBeVisible();
  expect(campaignCreateRequests).toBe(beforeInvalidCampaignSubmit);
  await page.getByLabel("计划发车时间").fill(dispatchInput);
  await page.getByLabel("商品").click();
  await page
    .getByText(`E2E 时蔬 ${suffix} · 一份 · 产地：本地农场`, { exact: true })
    .last()
    .click();
  await page.getByLabel("本团售价（元）").fill("18.80");
  await page.getByLabel("可售量").fill("80");
  await page.getByRole("button", { name: "下一步：发布复核" }).click();
  await expect(page.getByText("创建前发布复核")).toBeVisible();
  await expect(page.getByText("开售后不可修改")).toBeVisible();
  const createReviewDialog = page.getByRole("dialog", { name: "创建前发布复核" });
  const dispatchReviewRow = createReviewDialog.locator("tr").filter({ hasText: "计划发车时间" });
  await expect(dispatchReviewRow).toContainText(dispatchInput.slice(0, 16));
  const reviewPointRow = createReviewDialog.locator("tr").filter({ hasText: "固定自提点" });
  await expect(reviewPointRow).toContainText(reviewPointName);
  await expect(reviewPointRow).toContainText("社区大街 88 号一层");
  await expect(page.getByText("¥18.80")).toBeVisible();
  await page.getByRole("button", { name: "确认创建团期" }).click();
  await expect.poll(() => campaignCreateRequests).toBe(beforeInvalidCampaignSubmit + 1);
  await expect(page.getByText("创建前发布复核")).not.toBeVisible();
  const campaignRow = page
    .getByRole("row")
    .filter({ hasText: campaignTitle });
  await expect(campaignRow).toBeVisible();
  await campaignRow
    .getByRole("button", { name: /开\s*售/ })
    .click();
  await expect(page.getByText("开售前二次确认")).toBeVisible();
  await expect(page.getByRole("button", { name: "已复核，确认开售" })).toBeVisible();
  await page.getByRole("button", { name: "暂不开售" }).click();

  const skuResponse = await request.fetch(`${apiBase}/api/v1/admin/catalog/skus`, {
    headers: superHeaders,
  });
  expect(skuResponse.status(), await skuResponse.text()).toBe(200);
  const sku = ((await skuResponse.json()).data as Array<{ id: string; product: { title: string } }>).find(
    (value) => value.product.title === `E2E 时蔬 ${suffix}`,
  )!;
  const customerHeaders = {
    "x-demo-user-id": `customer.${suffix}`,
    "x-demo-role": "USER",
    "content-type": "application/json",
  };
  const customerActorHeaders = {
    "x-demo-user-id": `customer.${suffix}`,
    "x-demo-role": "USER",
  };
  const createPaidOrder = async (
    campaign: { id: string; deliveryPlan: { id: string } },
    quantity = 1,
  ) => {
    const created = await request.fetch(`${apiBase}/api/v1/orders`, {
      method: "POST",
      headers: {
        ...customerHeaders,
        "idempotency-key": `order-${Date.now()}-${Math.random()}`,
      },
      data: {
        campaignId: campaign.id,
        serviceAreaId: area.id,
        pickupPointId: point.id,
        items: [{ skuId: sku.id, quantity }],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const order = (await created.json()).data as { id: string };
    const paid = await request.fetch(
      `${apiBase}/api/v1/orders/${order.id}/pay/mock-confirm`,
      { method: "POST", headers: customerActorHeaders },
    );
    expect(paid.status(), await paid.text()).toBeLessThan(300);
    return order;
  };
  const createFastCampaign = async (title: string, quantity = 1) => {
    const campaign = await call<{ id: string; deliveryPlan: { id: string } }>(request, "/api/v1/admin/campaigns", {
      title, serviceAreaId: area.id, pickupPointId: point.id,
      cutoffAt: new Date(Date.now() + 5_000).toISOString(),
      dispatchAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      estimatedArrivalStartAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      estimatedArrivalEndAt: new Date(Date.now() + 90 * 60_000).toISOString(),
      minTotalQuantity: 1, failureAction: "CANCEL_AND_REFUND",
      items: [{ catalogSkuId: sku.id, retailPriceCents: 1880, sellableQuantity: 10 }],
    });
    await call(request, `/api/v1/admin/campaigns/${campaign.id}/open`);
    const order = await createPaidOrder(campaign, quantity);
    return { campaign, order };
  };
  const normal = await createFastCampaign(`E2E 正常到货 ${suffix}`, 2);
  const emergency = await createFastCampaign(`E2E 紧急到货 ${suffix}`);
  const expiry = await createFastCampaign(`E2E 逾期领取 ${suffix}`);
  const expiryOrders = [
    expiry.order,
    await createPaidOrder(expiry.campaign),
    await createPaidOrder(expiry.campaign),
  ];
  const unpaid = await request.fetch(`${apiBase}/api/v1/orders`, {
    method: "POST",
    headers: {
      ...customerHeaders,
      "idempotency-key": `unpaid-${suffix}`,
    },
    data: {
      campaignId: normal.campaign.id,
      serviceAreaId: area.id,
      pickupPointId: point.id,
      items: [{ skuId: sku.id, quantity: 1 }],
    },
  });
  expect(unpaid.status(), await unpaid.text()).toBe(201);
  const normalOrderResponse = await request.fetch(
    `${apiBase}/api/v1/orders/${normal.order.id}`,
    { headers: customerActorHeaders },
  );
  expect(normalOrderResponse.status(), await normalOrderResponse.text()).toBe(200);
  const normalOrder = (await normalOrderResponse.json()).data as { orderNo: string };
  const emergencyOrderResponse = await request.fetch(
    `${apiBase}/api/v1/orders/${emergency.order.id}`,
    { headers: customerActorHeaders },
  );
  expect(emergencyOrderResponse.status(), await emergencyOrderResponse.text()).toBe(200);
  const emergencyOrder = (await emergencyOrderResponse.json()).data as { orderNo: string };
  const expiryOrderViews = await Promise.all(
    expiryOrders.map(async (order) => {
      const response = await request.fetch(`${apiBase}/api/v1/orders/${order.id}`, {
        headers: customerActorHeaders,
      });
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()).data as { orderNo: string };
    }),
  );
  const unpaidOrder = (await unpaid.json()).data as { orderNo: string };
  const batchByCampaignId = new Map<string, string>();
  for (const value of [normal, emergency, expiry]) {
    await expect.poll(async () => {
      const response = await request.fetch(`${apiBase}/api/v1/admin/campaigns/${value.campaign.id}/close`, { method: "POST", headers: superHeaders });
      return response.status();
    }, { timeout: 15_000, intervals: [250, 500] }).toBe(200);
    await call(request, `/api/v1/admin/delivery-plans/${value.campaign.deliveryPlan.id}/book-vehicle`, {
      logisticsPlatform: "E2E 车队", vehicleOrderNo: `CAR-${value.campaign.id}`,
      driverName: "张师傅", driverPhone: "13800138000", vehiclePlate: "京A12345",
      estimatedArrivalAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    const batch = await call<{ id: string }>(request, "/api/v1/admin/dispatch-batches", { campaignId: value.campaign.id });
    await call(request, `/api/v1/admin/dispatch-batches/${batch.id}/dispatch`);
    batchByCampaignId.set(value.campaign.id, batch.id);
  }

  await page.getByRole("menuitem", { name: "团期管理" }).click();
  await page.getByRole("button", { name: "刷新" }).click();
  const packingRow = page
    .getByRole("row")
    .filter({ hasText: `E2E 正常到货 ${suffix}` });
  await packingRow.getByRole("button", { name: "生成装袋标签" }).click();
  const labelsDialog = page.getByRole("dialog", { name: /装袋标签/ });
  await expect(labelsDialog.getByText(normalOrder.orderNo, { exact: true })).toBeVisible();
  await expect(labelsDialog.getByText(unpaidOrder.orderNo, { exact: true })).toHaveCount(0);
  await expect(labelsDialog.getByText(`E2E 社区点 ${suffix}`, { exact: true })).toBeVisible();
  await expect(labelsDialog.getByText(`一份 × 2`, { exact: true })).toBeVisible();
  await expect(labelsDialog.getByRole("button", { name: "打印标签" })).toBeEnabled();
  await expect(labelsDialog.getByRole("button", { name: "导出标签" })).toBeEnabled();
  await labelsDialog.locator(".ant-modal-close").click();
  await expect(labelsDialog).toHaveCount(0);

  await page.getByRole("button", { name: /退\s*出/ }).click();
  await expect(page.getByRole("button", { name: "首次激活账号" })).toBeVisible();
  await page.getByRole("button", { name: "首次激活账号" }).click();
  await page.getByLabel("账号").fill(`manager.${suffix}`);
  await page.getByLabel("一次性初始凭据").fill(manager.initialCredential);
  await page.getByLabel("新密码").fill("community e2e manager password");
  await page.getByRole("button", { name: "完成首次激活" }).click();
  await expect(
    page.getByRole("heading", { name: "我的点位工作台" }),
  ).toBeVisible();
  await expect(page.getByText("商品管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("财务管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("系统设置", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 768, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  const normalRow = page.getByRole("row").filter({ hasText: `E2E 正常到货 ${suffix}` });
  await normalRow.getByRole("button", { name: "逐商品确认到货" }).click();
  await page.getByLabel("现场接收人").fill("李店长");
  await page.getByLabel("实到").fill("3");
  await page.getByRole("button", { name: "提交到货确认" }).click();
  await expect(
    page.getByLabel("逐商品确认到货").getByText("数量之和必须等于应到数量"),
  ).toBeVisible();
  await page.getByLabel("实到").fill("2");
  await page.getByRole("button", { name: "提交到货确认" }).click();
  await expect(page.getByText("到货事实已登记")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "逐商品确认到货" })).toHaveCount(0);
  const pickupCode = await request.fetch(`${apiBase}/api/v1/pickup-code?orderId=${normal.order.id}`, { headers: customerActorHeaders });
  expect(pickupCode.status(), await pickupCode.text()).toBe(200);
  const pickupValue = (await pickupCode.json()).data as { code: string };
  let pickupPosts = 0;
  page.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "POST" &&
      browserRequest.url().endsWith("/api/v1/pickup/verify")
    )
      pickupPosts += 1;
  });
  await page.getByRole("combobox").click();
  await page
    .getByText("E2E 社区点 " + suffix + " · 东城区社区服务站 1 号", {
      exact: true,
    })
    .click();
  await page.getByPlaceholder("订单号").fill(normalOrder.orderNo);
  await page.getByRole("button", { name: "查询订单" }).click();
  const quantityInput = page.getByLabel("一份 本次领取数量");
  await expect(quantityInput).toBeVisible();
  await page.getByPlaceholder("6 位取货码").fill(pickupValue.code);
  await page.getByRole("button", { name: "确认本次领取" }).click();
  await expect(page.getByText("请至少填写一项大于 0 的本次领取数量")).toBeVisible();
  expect(pickupPosts).toBe(0);
  await quantityInput.fill("3");
  await quantityInput.blur();
  await expect(quantityInput).toHaveValue("2");
  await quantityInput.fill("1");
  await page.getByRole("button", { name: "确认本次领取" }).click();
  await expect(page.getByRole("dialog", { name: "本次领取复核" })).toBeVisible();
  await page
    .getByRole("dialog", { name: "本次领取复核" })
    .getByRole("button", { name: "确认提交核销" })
    .click();
  await expect.poll(async () => pickupPosts).toBe(1);
  await expect(quantityInput).toHaveValue("0");
  const firstPickupOrder = await request.fetch(
    `${apiBase}/api/v1/orders/${normal.order.id}`,
    { headers: customerActorHeaders },
  );
  expect((await firstPickupOrder.json()).data.items[0].pickedUpQuantity).toBe(1);
  await quantityInput.fill("1");
  await page.getByRole("button", { name: "确认本次领取" }).click();
  await page
    .getByRole("dialog", { name: "本次领取复核" })
    .getByRole("button", { name: "确认提交核销" })
    .click();
  await expect.poll(async () => pickupPosts).toBe(2);
  const completedPickupOrder = await request.fetch(
    `${apiBase}/api/v1/orders/${normal.order.id}`,
    { headers: customerActorHeaders },
  );
  expect((await completedPickupOrder.json()).data.status).toBe("PICKED_UP");

  await page.getByRole("button", { name: /退\s*出/ }).click();
  await expect(page.getByRole("button", { name: "首次激活账号" })).toBeVisible();
  await page.getByLabel("账号").fill(`admin.${suffix}`);
  await page.getByLabel("密码").fill("community e2e admin password");
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  const adminLogin = await request.fetch(`${apiBase}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: {
      username: `admin.${suffix}`,
      password: "community e2e admin password",
    },
  });
  expect(adminLogin.status(), await adminLogin.text()).toBe(200);
  const adminToken = (await adminLogin.json()).data.accessToken as string;
  await page.getByText("配送与到货", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "配送与到货" })).toBeVisible();
  const deliverySnapshot = await request.fetch(`${apiBase}/api/v1/admin/community/deliveries`, {
    headers: { ...superHeaders, accept: "application/json" },
  });
  expect(deliverySnapshot.status(), await deliverySnapshot.text()).toBe(200);
  const deliveryData = (await deliverySnapshot.json()).data as Array<{ campaignTitle: string }>;
  expect(deliveryData.some((value) => value.campaignTitle === `E2E 紧急到货 ${suffix}`)).toBe(true);
  const arrivalTable = page
    .getByRole("heading", { name: "点位到货", exact: true })
    .locator("xpath=following-sibling::*[1]");
  const emergencyRow = arrivalTable
    .getByRole("row")
    .filter({ hasText: `E2E 紧急到货 ${suffix}` });
  for (let pageIndex = 0; pageIndex < 20 && (await emergencyRow.count()) === 0; pageIndex += 1) {
    const activePage = arrivalTable.locator(".ant-pagination-item-active");
    const activePageTitle = await activePage.getAttribute("title");
    const nextPage = arrivalTable.locator(
      ".ant-pagination-next:not(.ant-pagination-disabled) button",
    );
    if ((await nextPage.count()) === 0) break;
    await nextPage.click();
    await expect
      .poll(() => activePage.getAttribute("title"), { timeout: 5_000 })
      .not.toBe(activePageTitle);
  }
  await expect(emergencyRow).toHaveCount(1, { timeout: 15_000 });
  await expect(emergencyRow.getByRole("button", { name: "紧急代办到货" })).toBeVisible({ timeout: 15_000 });
  await emergencyRow.getByRole("button", { name: "紧急代办到货" }).click();
  await page.getByLabel("现场接收人").fill("王店长");
  await page.getByRole("button", { name: "提交到货确认" }).click();
  await expect(page.getByText("紧急代办必须填写原因")).toBeVisible();
  await page.getByLabel("紧急代办原因").fill("负责人临时失联");
  let emergencyArrivalPosts = 0;
  page.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "POST" &&
      /\/api\/v1\/admin\/community\/dispatch-batches\/[^/]+\/arrival$/.test(
        browserRequest.url(),
      )
    )
      emergencyArrivalPosts += 1;
  });
  await page.getByLabel("实到").fill("0");
  await page.getByLabel("短少").fill("1");
  await page.getByRole("button", { name: "提交到货确认" }).click();
  await expect(
    page
      .getByLabel("紧急代办：逐商品确认到货")
      .getByText("必须填写差异说明"),
  ).toBeVisible();
  expect(emergencyArrivalPosts).toBe(0);
  await page.getByLabel("差异说明").fill("现场短少一件，已拍照登记");
  await page.getByRole("button", { name: "提交到货确认" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(emergencyArrivalPosts).toBe(1);
  await expect.poll(async () => {
    const deliveries = await request.fetch(`${apiBase}/api/v1/admin/community/deliveries`, {
      headers: superHeaders,
    });
    const data = (await deliveries.json()).data as Array<{
      campaignTitle: string;
      arrivalResult: string | null;
    }>;
    return data.find((value) => value.campaignTitle === `E2E 紧急到货 ${suffix}`)
      ?.arrivalResult;
  }).toBe("EXCEPTION");
  // API setup is limited to the persisted test precondition. The following
  // operator and finance transitions are exercised only through the browser.
  const expiryArrival = await request.fetch(
    `${apiBase}/api/v1/admin/community/dispatch-batches/${batchByCampaignId.get(expiry.campaign.id)!}/arrival`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      data: {
        receivedBy: "测试代办人",
        confirmationNote: "为逾期领取页面建立已到货前置事实",
        emergencyReason: "浏览器验收建立逾期领取前置事实",
        items: [
          {
            catalogSkuId: sku.id,
            receivedQuantity: 3,
            rejectedQuantity: 0,
            shortQuantity: 0,
            damagedQuantity: 0,
            reason: null,
            evidenceNote: null,
          },
        ],
      },
    },
  );
  expect(expiryArrival.status(), await expiryArrival.text()).toBe(200);
  for (const order of expiryOrders) {
    const expired = await request.fetch(
      `${apiBase}/__test/community/orders/${order.id}/expire-pickup-window`,
      { method: "POST", headers: superHeaders },
    );
    expect(expired.status(), await expired.text()).toBe(200);
  }
  await page.getByRole("button", { name: /退\s*出/ }).click();
  await expect(page.getByRole("button", { name: "首次激活账号" })).toBeVisible();
  await page.getByRole("button", { name: "首次激活账号" }).click();
  await page.getByLabel("账号").fill(`operator.${suffix}`);
  await page.getByLabel("一次性初始凭据").fill(operator.initialCredential);
  await page.getByLabel("新密码").fill("community e2e operator password");
  await page.getByRole("button", { name: "完成首次激活" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.getByText("团期管理", { exact: true }).click();
  const operatorPackingRow = page
    .getByRole("row")
    .filter({ hasText: `E2E 正常到货 ${suffix}` });
  await expect(
    operatorPackingRow.getByRole("button", { name: "生成装袋标签" }),
  ).toBeVisible();
  await operatorPackingRow.getByRole("button", { name: "生成装袋标签" }).click();
  const operatorLabelsDialog = page.getByRole("dialog", { name: /装袋标签/ });
  await expect(
    operatorLabelsDialog.getByText(normalOrder.orderNo, { exact: true }),
  ).toBeVisible();
  await operatorLabelsDialog.locator(".ant-modal-close").click();
  await page.getByText("配送与到货", { exact: true }).click();
  await expect(page.getByRole("button", { name: "逐商品确认到货" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "紧急代办到货" })).toHaveCount(0);
  const operatorArrivalTable = page
    .getByRole("heading", { name: "点位到货", exact: true })
    .locator("xpath=following-sibling::*[1]");
  const differenceRow = operatorArrivalTable
    .getByRole("row")
    .filter({ hasText: `E2E 紧急到货 ${suffix}` });
  for (let pageIndex = 0; pageIndex < 20 && (await differenceRow.count()) === 0; pageIndex += 1) {
    const activePage = operatorArrivalTable.locator(".ant-pagination-item-active");
    const activePageTitle = await activePage.getAttribute("title");
    const nextPage = operatorArrivalTable.locator(
      ".ant-pagination-next:not(.ant-pagination-disabled) button",
    );
    if ((await nextPage.count()) === 0) break;
    await nextPage.click();
    await expect
      .poll(() => activePage.getAttribute("title"), { timeout: 5_000 })
      .not.toBe(activePageTitle);
  }
  await expect(differenceRow).toHaveCount(1, { timeout: 15_000 });
  let allocationPosts = 0;
  page.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "POST" &&
      /\/api\/v1\/admin\/community\/deliveries\/[^/]+\/allocation-draft\/confirm$/.test(
        browserRequest.url(),
      )
    )
      allocationPosts += 1;
  });
  const allocationConfirmRoute =
    /\/api\/v1\/admin\/community\/deliveries\/[^/]+\/allocation-draft\/confirm$/;
  await page.route(allocationConfirmRoute, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  // A slow response must not leave the confirm action live for a second
  // write: the first click owns the action until the refresh completes.
  await differenceRow
    .getByRole("button", { name: "确认差异分配" })
    .dblclick({ delay: 100 });
  await expect.poll(() => allocationPosts).toBe(1);
  await expect(page.getByText("已确认", { exact: true })).toBeVisible();
  await page.unroute(allocationConfirmRoute);
  await page.getByText("售后与异常", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "售后与异常" })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  const pickupWindowTable = page
    .getByRole("heading", { name: "逾期领取处理", exact: true })
    .locator("xpath=following-sibling::*[1]");
  const findWindowRow = async (orderNo: string) => {
    const row = pickupWindowTable.getByRole("row").filter({ hasText: orderNo });
    for (let pageIndex = 0; pageIndex < 20 && (await row.count()) === 0; pageIndex += 1) {
      const activePage = pickupWindowTable.locator(".ant-pagination-item-active");
      const activePageTitle = await activePage.getAttribute("title");
      const nextPage = pickupWindowTable.locator(
        ".ant-pagination-next:not(.ant-pagination-disabled) button",
      );
      if ((await nextPage.count()) === 0) break;
      await nextPage.click();
      await expect
        .poll(() => activePage.getAttribute("title"), { timeout: 5_000 })
        .not.toBe(activePageTitle);
    }
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    return row;
  };
  const extensionWindowRow = await findWindowRow(expiryOrderViews[0]!.orderNo);
  await extensionWindowRow.getByRole("button", { name: "一次延期" }).click();
  const extensionDialog = page.getByRole("dialog", { name: "确认一次延期领取" });
  await extensionDialog.getByRole("button", { name: "二次确认并提交" }).click();
  await expect(extensionDialog.getByText("请选择新的领取截止时间")).toBeVisible();
  await extensionDialog.getByLabel("新的领取截止时间").fill(dateInput(96));
  await extensionDialog.getByLabel("新的领取截止时间").press("Tab");
  await extensionDialog.getByLabel("处理原因").fill("用户已预约下周领取，运营批准一次延期");
  await extensionDialog.getByRole("button", { name: "二次确认并提交" }).click();
  await expect(extensionWindowRow.getByText("已延期", { exact: true })).toBeVisible();

  const refundWindowRow = await findWindowRow(expiryOrderViews[1]!.orderNo);
  await refundWindowRow.getByRole("button", { name: "登记退款" }).click();
  const refundWindowDialog = page.getByRole("dialog", { name: "确认登记逾期退款" });
  await refundWindowDialog.getByRole("button", { name: "二次确认并提交" }).click();
  await expect(refundWindowDialog.getByText("请填写处理原因")).toBeVisible();
  await refundWindowDialog.getByLabel("处理原因").fill("用户逾期未领取，运营登记退款");
  await refundWindowDialog.getByRole("button", { name: "二次确认并提交" }).click();
  await expect(refundWindowRow.getByText("退款处理中", { exact: true })).toBeVisible();

  const lossWindowRow = await findWindowRow(expiryOrderViews[2]!.orderNo);
  await lossWindowRow.getByRole("button", { name: "登记报损" }).click();
  const lossWindowDialog = page.getByRole("dialog", { name: "确认登记逾期报损" });
  await lossWindowDialog.getByLabel("处理原因").fill("用户逾期未领取，运营登记报损");
  await lossWindowDialog.getByRole("button", { name: "二次确认并提交" }).click();
  await expect(lossWindowRow.getByText("已关闭", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /退\s*出/ }).click();
  await expect(page.getByRole("button", { name: "首次激活账号" })).toBeVisible();
  await page.getByRole("button", { name: "首次激活账号" }).click();
  await page.getByLabel("账号").fill(`finance.${suffix}`);
  await page.getByLabel("一次性初始凭据").fill(finance.initialCredential);
  await page.getByLabel("新密码").fill("community e2e finance password");
  await page.getByRole("button", { name: "完成首次激活" }).click();
  await expect(page.getByRole("heading", { name: "财务管理" })).toBeVisible();
  const exceptionRow = page.getByRole("row").filter({ hasText: emergencyOrder.orderNo });
  await expect(exceptionRow.getByRole("button", { name: "执行退款" })).toBeVisible();
  let exceptionRefundPosts = 0;
  page.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "POST" &&
      /\/api\/v1\/admin\/fulfillment-exceptions\/[^/]+\/refund$/.test(
        browserRequest.url(),
      )
    )
      exceptionRefundPosts += 1;
  });
  await exceptionRow.getByRole("button", { name: "执行退款" }).click();
  await page.getByRole("button", { name: "继续复核" }).click();
  await expect(page.getByText("必须填写退款确认说明")).toBeVisible();
  await page
    .getByRole("dialog", { name: "填写差异退款确认说明" })
    .getByRole("textbox", { name: /退款确认说明/ })
    .fill("运营差异已确认，执行一份退款");
  await page.getByRole("button", { name: "继续复核" }).click();
  await expect(page.getByRole("dialog", { name: "二次确认执行差异退款" })).toBeVisible();
  await page
    .getByRole("dialog", { name: "二次确认执行差异退款" })
    .getByRole("button", { name: "确认执行退款" })
    .click();
  await expect.poll(async () => exceptionRefundPosts).toBe(1);
  await expect(exceptionRow.getByRole("button", { name: "执行退款" })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  const pickupRefundRow = page
    .getByRole("region", { name: "逾期领取退款" })
    .getByRole("row")
    .filter({ hasText: expiryOrderViews[1]!.orderNo });
  await expect(pickupRefundRow.getByRole("button", { name: "执行退款" })).toBeVisible();
  let pickupRefundPosts = 0;
  page.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "POST" &&
      /\/api\/v1\/admin\/community\/orders\/[^/]+\/pickup-refund$/.test(
        browserRequest.url(),
      )
    )
      pickupRefundPosts += 1;
  });
  await pickupRefundRow.getByRole("button", { name: "执行退款" }).click();
  await page
    .getByRole("dialog", { name: "二次确认执行逾期领取退款" })
    .getByRole("button", { name: "确认执行退款" })
    .click();
  await expect.poll(async () => pickupRefundPosts).toBe(1);
  await expect(pickupRefundRow.getByRole("button", { name: "执行退款" })).toHaveCount(0);
  const windowsAfterRefund = await request.fetch(
    `${apiBase}/api/v1/admin/community/pickup-windows`,
    { headers: superHeaders },
  );
  expect(windowsAfterRefund.status(), await windowsAfterRefund.text()).toBe(200);
  expect(
    ((await windowsAfterRefund.json()).data as Array<{ orderId: string; status: string }>).find(
      (window) => window.orderId === expiryOrders[1]!.id,
    )?.status,
  ).toBe("CLOSED");
  const refundState = await request.fetch(`${apiBase}/api/v1/admin/finance/refunds`, {
    headers: superHeaders,
  });
  expect(refundState.status(), await refundState.text()).toBe(200);
  const partialRefunds = (await refundState.json()).data.partial as Array<{ orderId: string }>;
  expect(partialRefunds.filter((refund) => refund.orderId === emergency.order.id)).toHaveLength(1);
  expect(browserFailures).toEqual([]);
});
