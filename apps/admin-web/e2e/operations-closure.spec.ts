import { test, staffFetch } from "./browser-auth";
import { fixturePhoto } from './media-fixture';
import { expect, type APIRequestContext } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3101";
const superHeaders = {
  "x-demo-user-id": "demo-super-admin",
  "x-demo-role": "SUPER_ADMIN",
};

async function post<T>(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  headers: Record<string, string> = superHeaders,
): Promise<T> {
  const response = await staffFetch(request, `${apiBase}${path}`, {
    method: "POST",
    headers:
      data === undefined
        ? headers
        : { ...headers, "content-type": "application/json" },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
  return (await response.json()).data as T;
}

test("超管通过网页复核运输、发车、紧急纠正、订单详情和取消团期", async ({
  page,
  request,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (failed) => {
    const reason = failed.failure()?.errorText ?? "unknown";
    if (reason !== "net::ERR_ABORTED")
      failures.push(`requestfailed: ${failed.url()} ${reason}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.headers()["x-reauthentication-required"] !== "1")
      failures.push(`http ${response.status()}: ${response.url()}`);
  });

  const suffix = `closure-${Date.now()}`;
  const admin = await post<{ temporaryPassword: string }>(
    request,
    "/api/v1/admin/staff",
    {
      displayName: "网页验收超管",
      username: `closure.admin.${suffix}`,
      phone: `138${suffix.slice(-8)}`,
      role: "SUPER_ADMIN",
      pickupPointIds: [],
    },
  );
  const area = await post<{ id: string }>(
    request,
    "/api/v1/admin/service-areas",
    { regionCode: "110101" },
  );
  await post(request, `/api/v1/admin/service-areas/${area.id}/order-status`, {
    orderEnabled: true,
  });
  const point = await post<{ id: string }>(
    request,
    "/api/v1/admin/pickup-points",
    {
      photoUrl: await fixturePhoto(request),
    serviceAreaId: area.id,
      name: `网页验收点 ${suffix}`,
      address: "东城区社区服务站 99 号",
      businessHours: "09:00-20:00",
      pickupInstructions: "到店出示领取码",
      latitude: 39.9042,
      longitude: 116.4074,
      contactName: "网页验收店长",
      contactPhone: "13800138000",
      capacityPerDay: 100,
    },
  );
  const sku = await post<{ id: string }>(request, "/api/v1/admin/catalog/skus", {
    title: `网页验收番茄 ${suffix}`,
    category: "蔬菜",
    origin: "本地农场",
    imageUrl: null,
    skuName: "每份 2 斤",
    retailPriceCents: 1500,
    defaultSellableQuantity: 40,
    status: "ACTIVE",
  });
  const campaign = await post<{ id: string; deliveryPlan: { id: string } }>(
    request,
    "/api/v1/admin/campaigns",
    {
      title: `网页运输验收 ${suffix}`,
      serviceAreaId: area.id,
      pickupPointId: point.id,
      cutoffAt: new Date(Date.now() + 4_000).toISOString(),
      dispatchAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      estimatedArrivalStartAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      estimatedArrivalEndAt: new Date(Date.now() + 90 * 60_000).toISOString(),
      minTotalQuantity: 1,
      failureAction: "CANCEL_AND_REFUND",
      items: [
        { catalogSkuId: sku.id, retailPriceCents: 1500, sellableQuantity: 40 },
      ],
    },
  );
  await post(request, `/api/v1/admin/campaigns/${campaign.id}/open`);
  const customerHeaders = {
    "x-demo-user-id": `closure.customer.${suffix}`,
    "x-demo-role": "USER",
  };
  const order = await post<{ id: string; orderNo: string }>(
    request,
    "/api/v1/orders",
    {
      campaignId: campaign.id,
      serviceAreaId: area.id,
      pickupPointId: point.id,
      items: [{ skuId: sku.id, quantity: 2 }],
    },
    { ...customerHeaders, "idempotency-key": `closure-order-${suffix}` },
  );
  await post(request, `/api/v1/orders/${order.id}/pay/mock-confirm`, undefined, customerHeaders);
  await expect
    .poll(async () => {
      const response = await staffFetch(request, `${apiBase}/api/v1/admin/campaigns/${campaign.id}/close`, {
        method: "POST",
        headers: superHeaders,
      });
      return response.status();
    }, { timeout: 15_000, intervals: [200, 500] })
    .toBe(200);

  await page.goto("/");
  await page.getByLabel("账号").fill(`closure.admin.${suffix}`);
  await page.getByLabel("密码").fill(admin.temporaryPassword);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByText("请先设置新密码", { exact: true })).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill("closure admin password");
  await page.getByLabel("确认新密码").fill("closure admin password");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();

  await page.getByRole("menuitem", { name: "发货与运输" }).click();
  const planRow = page.getByRole("row").filter({ hasText: `网页运输验收 ${suffix}` });
  await expect(planRow.getByRole("button", { name: "登记运输信息" })).toBeVisible();
  await planRow.getByRole("button", { name: "登记运输信息" }).click();
  await page.getByLabel("承运方").fill("网页验收车队");
  await page.getByLabel("运单号（可选）").fill("WEB-CAR-001");
  await page.getByLabel("司机").fill("网页司机");
  await page.getByLabel("车牌").fill("京W00001");
  await page.locator('.ant-modal:visible button[type="submit"]').click();
  await expect(planRow.getByRole("button", { name: "编辑运输信息" })).toBeVisible();
  await planRow.getByRole("button", { name: "编辑运输信息" }).click();
  await expect(page.getByLabel("运单号（可选）")).toHaveValue("WEB-CAR-001");
  await page.locator('.ant-modal:visible button[type="submit"]').click();
  await planRow.getByRole("button", { name: /确认发车|创建批次并发车/ }).click();
  const review = page.getByRole("dialog", { name: "发车前复核" });
  await expect(review.getByText(`网页运输验收 ${suffix}`, { exact: true })).toBeVisible();
  const orderCountRow = review.locator("tr").filter({ hasText: "订单 / 商品数量" });
  await expect(orderCountRow).toContainText("1");
  await expect(orderCountRow).toContainText("2");
  await review.getByRole("button", { name: "确认发车" }).click();
  await expect(planRow.getByRole("button", { name: "紧急纠正运输信息" })).toBeVisible();
  await planRow.getByRole("button", { name: "紧急纠正运输信息" }).click();
  await page.getByLabel("紧急纠正原因").fill("网页验收：车辆临时替换");
  await page.getByLabel("运单号（可选）").fill("WEB-CAR-002");
  await page.locator('.ant-modal:visible button[type="submit"]').click();

  await page.getByRole("menuitem", { name: "订单列表" }).click();
  const search = page.getByRole("textbox", { name: "订单关键词" });
  await search.fill(order.orderNo);
  await page.getByRole("button", { name: /^查\s*询$/ }).click();
  const orderRow = page.getByRole("row").filter({ hasText: order.orderNo });
  await expect(orderRow).toBeVisible();
  await orderRow.getByRole("button", { name: "查看详情" }).click();
  const detail = page.getByRole("dialog", { name: new RegExp(`订单详情.*${order.orderNo}`) });
  await expect(detail.getByText(`网页验收番茄 ${suffix}`, { exact: true })).toBeVisible();
  await expect(detail.getByText("每份 2 斤", { exact: true })).toBeVisible();
  await expect(detail.getByText(`网页验收点 ${suffix}`, { exact: true })).toBeVisible();
  await detail.locator(".ant-modal-close").click();

  const cancelCampaign = await post<{ id: string }>(request, "/api/v1/admin/campaigns", {
    title: `网页取消验收 ${suffix}`,
    serviceAreaId: area.id,
    pickupPointId: point.id,
    cutoffAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    dispatchAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    estimatedArrivalStartAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
    estimatedArrivalEndAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
    minTotalQuantity: 1,
    failureAction: "CANCEL_AND_REFUND",
    items: [{ catalogSkuId: sku.id, retailPriceCents: 1500, sellableQuantity: 20 }],
  });
  await post(request, `/api/v1/admin/campaigns/${cancelCampaign.id}/open`);
  await page.getByRole("menuitem", { name: "团期管理" }).click();
  await page.getByRole("button", { name: "刷新" }).click();
  const cancelRow = page.getByRole("row").filter({ hasText: `网页取消验收 ${suffix}` });
  await cancelRow.getByRole("button", { name: /更多/ }).click();
  await page.getByRole("menuitem", { name: "取消团期", exact: true }).click();
  const cancelDialog = page.getByRole("dialog", { name: "取消团期前二次确认" });
  await expect(cancelDialog.getByText("不可重新开售")).toBeVisible();
  await expect(cancelDialog.getByRole("button", { name: "确认取消并创建退款义务" })).toBeDisabled();
  await cancelDialog.getByLabel("取消原因").fill("网页验收取消原因");
  await cancelDialog.getByRole("button", { name: "确认取消并创建退款义务" }).click();
  await expect(cancelRow.getByText("已取消", { exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});
