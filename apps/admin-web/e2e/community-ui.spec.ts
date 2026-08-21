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
    headers: { ...superHeaders, "content-type": "application/json" },
    data,
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
  return (await response.json()).data as T;
}

test("运营后台只呈现社区主线，点位负责人只进入网页工作台", async ({
  page,
  request,
}) => {
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
  await call(request, "/api/v1/auth/admin/activate", {
    username: `admin.${suffix}`,
    initialCredential: admin.initialCredential,
    newPassword: "community e2e admin password",
  });
  const area = await call<{ id: string }>(
    request,
    "/api/v1/admin/service-areas",
    { regionCode: "110101" },
  );
  const point = await call<{ id: string }>(
    request,
    "/api/v1/admin/pickup-points",
    {
      serviceAreaId: area.id,
      name: `E2E 社区点 ${suffix}`,
      address: "东城区社区服务站 1 号",
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
  await call(request, "/api/v1/auth/admin/activate", {
    username: `manager.${suffix}`,
    initialCredential: manager.initialCredential,
    newPassword: "community e2e manager password",
  });

  await page.goto("/");
  await page.getByLabel("账号").fill(`admin.${suffix}`);
  await page.getByLabel("密码").fill("community e2e admin password");
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByText("商品管理", { exact: true })).toBeVisible();
  await expect(page.getByText("团期管理", { exact: true })).toBeVisible();
  await expect(page.getByText("配送与到货", { exact: true })).toBeVisible();
  await page.getByText("商品管理", { exact: true }).click();
  await page.getByRole("button", { name: "新增商品" }).click();
  await page.getByLabel("商品名称").fill(`E2E 时蔬 ${suffix}`);
  await page.getByLabel("分类").fill("蔬菜");
  await page.getByLabel("产地").fill("本地农场");
  await page.getByLabel("规格").fill("一份");
  await page.getByLabel("售价（分）").fill("1990");
  await page.getByLabel("默认可售量").fill("100");
  await page.getByRole("button", { name: "保存商品" }).click();
  await expect(page.getByText(`E2E 时蔬 ${suffix}`)).toBeVisible();

  await page.getByRole("button", { name: /退\s*出/ }).click();
  await page.getByLabel("账号").fill(`manager.${suffix}`);
  await page.getByLabel("密码").fill("community e2e manager password");
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(
    page.getByRole("heading", { name: "我的点位工作台" }),
  ).toBeVisible();
  await expect(page.getByText("商品管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("财务管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("系统设置", { exact: true })).toHaveCount(0);
});
