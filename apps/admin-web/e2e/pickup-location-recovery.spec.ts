import { test, staffFetch, loginBrowser } from "./browser-auth";
import { uploadPointPhoto } from './media-fixture';
import { fixturePhoto } from './media-fixture';
import { expect, type APIRequestContext, type Page } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3101";
const demoHeaders = {
  "x-demo-user-id": "demo-super-admin",
  "x-demo-role": "SUPER_ADMIN",
  "content-type": "application/json",
};

async function activateMapAdmin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const username = `pickup.retry.${suffix}`;
  const created = await staffFetch(request, `${apiBase}/api/v1/admin/staff`, {
    method: "POST",
    headers: demoHeaders,
    data: {
      displayName: "地图恢复验收",
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
  const login = await staffFetch(request,
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
  const activated = await staffFetch(request,
    `${apiBase}/api/v1/auth/admin/complete-password-change`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { passwordChangeToken: challenge, newPassword: password },
    },
  );
  expect(activated.status(), await activated.text()).toBe(200);
  await loginBrowser(page, username, password);
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();
}

test("地图同地址重新检测可恢复，候选确认清除旧错误且保持保存门禁", async ({ page, request }) => {
  await activateMapAdmin(request, page);
  const area = await request.post(`${apiBase}/api/v1/admin/service-areas`, { headers: demoHeaders, data: { regionCode: "110105" } });
  expect(area.status(), await area.text()).toBeLessThan(300);
  const areaName = (await area.json()).data.name as string;
  await page.reload();
  await page.getByRole("menuitem", { name: "自提点管理" }).click();
  await page.getByRole("button", { name: "新增自提点", exact: true }).click();
  await uploadPointPhoto(page);
  const dialog = page.getByRole("dialog", { name: "新增自提点" });
  await dialog.getByLabel("服务区域", { exact: true }).click();
  await page.getByTitle(areaName, { exact: true }).last().click();
  await dialog.getByLabel("自提点名称").fill("朝阳测试点");
  const address = dialog.getByLabel("详细地址或地点名称");
  let searches = 0;
  const place = { title: "朝阳测试点", address: "北京市朝阳区朝阳北路101号", latitude: 39.924, longitude: 116.519, provinceName: "北京市", cityName: "北京市", districtName: "朝阳区", adcode: "110105" };
  await page.route("**/api/v1/admin/geo/search?**", async (route) => {
    searches++;
    await route.fulfill({ status: searches === 1 ? 503 : 200, contentType: "application/json", body: JSON.stringify(searches === 1 ? { code: "LOCATION_VERIFICATION_NOT_CONFIGURED", message: "未配置" } : { data: [place] }) });
  });
  await page.route("**/api/v1/admin/geo/reverse?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: place }) }));
  await address.fill("朝阳北路101号");
  await expect(dialog.getByText(/地点服务尚未配置/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^保\s*存$/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "重新检测" }).click();
  await expect.poll(() => searches).toBe(2);
  await address.click();
  await page.getByText(place.address, { exact: true }).last().click();
  await expect(dialog.getByText(/地点服务尚未配置/)).toHaveCount(0);
  await expect(dialog.locator(".ant-form-item-explain-error")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^保\s*存$/ })).toBeEnabled();
  // A later failed address search must disappear once reverse lookup succeeds.
  await page.unroute("**/api/v1/admin/geo/search?**");
  await page.route("**/api/v1/admin/geo/search?**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "LOCATION_PROVIDER_UNAVAILABLE", message: "测试超时" }) }));
  await address.fill("朝阳北路102号");
  await expect(dialog.getByText(/地点搜索暂时不可用/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^保\s*存$/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "重新核验当前位置" }).click();
  await expect(dialog.getByText(/地点搜索暂时不可用/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^保\s*存$/ })).toBeEnabled();
});

test("分类与点位操作精简，状态在编辑中修改且使用居中弹窗", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await activateMapAdmin(request, page);
  const suffix = Date.now();
  await page.getByRole("menuitem", { name: "分类管理", exact: true }).click();
  const categoryName = `布局分类${suffix}`;
  await page.getByRole("button", { name: /新\s*增\s*分\s*类/ }).click();
  const createDialog = page.getByRole("dialog", { name: "新增分类" });
  await createDialog.getByLabel("分类名称", { exact: true }).fill(categoryName);
  await expect(createDialog.getByRole("radio")).toHaveCount(8);
  await createDialog.getByText("工具", { exact: true }).click();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("category-icon-picker.png") });
  await createDialog.getByRole("button", { name: /创\s*建\s*分\s*类/ }).click();
  const categoryRow = page.getByRole("row").filter({ hasText: categoryName });
  await expect(categoryRow.locator("img")).toBeVisible();
  await expect(categoryRow.getByRole("button")).toHaveCount(2);
  const actionCell = categoryRow.locator(".table-actions");
  const cellBox = await actionCell.boundingBox();
  expect(cellBox!.width).toBeLessThanOrEqual(200);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("categories.png") });
  await categoryRow.getByRole("button", { name: /编\s*辑/ }).click();
  const editDialog = page.getByRole("dialog", { name: "编辑分类" });
  await expect(editDialog.getByRole("radio", { name: "工具" })).toBeChecked();
  await editDialog.getByLabel("状态", { exact: true }).click();
  await page.getByTitle("停用", { exact: true }).click();
  await editDialog.getByRole("button", { name: "保存修改" }).click();
  const confirm = page.getByRole("dialog", { name: `停用分类“${categoryName}”` });
  await confirm.getByRole("button", { name: "确认停用" }).click();
  await expect(categoryRow.getByText("已停用", { exact: true })).toBeVisible();
  await categoryRow.getByRole("button", { name: /删\s*除/ }).click();
  await page.getByRole("dialog", { name: "删除分类", exact: true }).getByRole("button", { name: "确认删除" }).click();
  await expect(categoryRow).toHaveCount(0);

  const areaResponse = await request.post(`${apiBase}/api/v1/admin/service-areas`, { headers: demoHeaders, data: { regionCode: "110101" } });
  expect(areaResponse.ok()).toBe(true);
  const area = (await areaResponse.json()).data;
  const pointName = `布局点位${suffix}`;
  const pointResponse = await request.post(`${apiBase}/api/v1/admin/pickup-points`, { headers: demoHeaders, data: {
    photoUrl: await fixturePhoto(request),
    serviceAreaId: area.id, name: pointName, address: "东城区布局测试街 1 号", latitude: 39.94, longitude: 116.44,
    businessHours: "每日 09:00–20:00", pickupInstructions: "出示取货码", contactName: "", contactPhone: "", capacityPerDay: null,
  } });
  expect(pointResponse.ok(), await pointResponse.text()).toBe(true);
  await page.getByRole("menuitem", { name: "自提点管理", exact: true }).click();
  const pointRow = page.getByRole("row").filter({ hasText: pointName });
  await expect(pointRow.getByRole("button")).toHaveCount(2);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("pickup-list.png") });
  await pointRow.getByRole("button", { name: /编\s*辑/ }).click();
  const dialog = page.getByRole("dialog", { name: "编辑自提点" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".ant-drawer")).toHaveCount(0);
  await expect.poll(async () => {
    const bounds = await dialog.boundingBox();
    return bounds ? Math.abs(bounds.x + bounds.width / 2 - 720) : Infinity;
  }).toBeLessThan(2);
  await dialog.getByRole("radio", { name: "停用", exact: true }).check();
  await dialog.getByRole("button", { name: /^保\s*存$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(pointRow.getByText("已停用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新增自提点", exact: true }).click();
  await uploadPointPhoto(page);
  const create = page.getByRole("dialog", { name: "新增自提点" });
  await expect(create).toBeVisible();
  await expect(create.getByRole("button", { name: /^保\s*存$/ })).toBeDisabled();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("pickup-modal.png") });
  await create.getByRole("button", { name: /取\s*消/ }).click();
  await expect(create).toBeHidden();
});
