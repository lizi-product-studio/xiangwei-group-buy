import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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
  const created = await request.fetch(`${apiBase}/api/v1/admin/staff`, {
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

test("地图同地址重新检测可恢复，候选确认清除旧错误且保持保存门禁", async ({ page, request }) => {
  await activateMapAdmin(request, page);
  const area = await request.post(`${apiBase}/api/v1/admin/service-areas`, { headers: demoHeaders, data: { regionCode: "110105" } });
  expect(area.status(), await area.text()).toBeLessThan(300);
  const areaName = (await area.json()).data.name as string;
  await page.reload();
  await page.getByRole("menuitem", { name: "区域与自提点" }).click();
  await page.getByRole("button", { name: "新增自提点", exact: true }).click();
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
