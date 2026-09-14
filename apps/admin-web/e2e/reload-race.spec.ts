import { expect, test, type Page } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3101";
const superHeaders = {
  "x-demo-user-id": "demo-super-admin",
  "x-demo-role": "SUPER_ADMIN",
  "content-type": "application/json",
};

function watchBrowser(page: Page): string[] {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "unknown";
    if (error !== "net::ERR_ABORTED")
      failures.push(`requestfailed: ${request.url()} ${error}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`http ${response.status()}: ${response.url()}`);
  });
  return failures;
}

async function findStaffRow(page: Page, displayName: string) {
  const row = page.getByRole("row").filter({ hasText: displayName });
  for (let pageTurns = 0; pageTurns < 20; pageTurns += 1) {
    const nextPage = page.locator(".ant-pagination-next button");
    // A creation-triggered reload can render the initial page before its
    // paginator. Wait for either the target row or an enabled next page, then
    // traverse pages semantically rather than treating a transient no-page
    // state as evidence that the new record is missing.
    await expect
      .poll(
        async () =>
          (await row.count()) > 0 ||
          ((await nextPage.count()) === 1 && !(await nextPage.isDisabled())),
        { timeout: 10_000 },
      )
      .toBe(true);
    if ((await row.count()) > 0) return row;
    await nextPage.click();
  }
  throw new Error(`员工列表分页后仍找不到 ${displayName}`);
}

test("同一身份的迟到员工列表响应不会覆盖创建后的最新刷新", async ({
  page,
  request,
}) => {
  const failures = watchBrowser(page);
  const suffix = Date.now().toString();
  const bootstrap = await request.fetch(`${apiBase}/api/v1/admin/staff`, {
    method: "POST",
    headers: superHeaders,
    data: {
      displayName: "刷新竞态超管",
      username: `reload.race.admin.${suffix}`,
      phone: `135${suffix.slice(-8)}`,
      role: "SUPER_ADMIN",
      pickupPointIds: [],
    },
  });
  expect(bootstrap.status(), await bootstrap.text()).toBe(201);
  const temporaryPassword = (await bootstrap.json()).data.temporaryPassword as string;

  let firstStaffResponseHeld = false;
  let firstStaffResponseReleased = false;
  let releaseFirstStaffResponse: (() => void) | null = null;
  await page.route("**/api/v1/admin/staff", async (route) => {
    if (firstStaffResponseHeld) return route.continue();
    firstStaffResponseHeld = true;
    const response = await route.fetch();
    await new Promise<void>((resolve) => {
      releaseFirstStaffResponse = resolve;
    });
    await route.fulfill({ response });
    firstStaffResponseReleased = true;
  });

  await page.goto("/");
  await page.getByLabel("账号").fill(`reload.race.admin.${suffix}`);
  await page.getByLabel("密码").fill(temporaryPassword);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByText("请先设置新密码", { exact: true })).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill("reload race admin password");
  await page.getByLabel("确认新密码").fill("reload race admin password");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("heading", { name: "运营工作台" })).toBeVisible();
  await page.getByRole("menuitem", { name: "人员与权限" }).click();
  await expect(page.getByRole("heading", { name: "人员与权限" })).toBeVisible();
  await expect.poll(() => firstStaffResponseHeld).toBe(true);

  await page.getByRole("button", { name: "新增员工" }).click();
  await page.getByLabel("姓名").fill("迟到响应后仍存在的新员工");
  await page.getByLabel("登录账号").fill(`reload.race.staff.${suffix}`);
  await page.getByLabel("手机号").fill(`136${suffix.slice(-8)}`);
  await page.getByLabel("角色").click();
  await page
    .locator(".ant-select-item-option")
    .filter({ hasText: "超级管理员" })
    .click();
  // Ant Design keeps this select overlay mounted during its close animation;
  // close it through the same keyboard affordance as the staff lifecycle flow
  // before submitting the form.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "创建账号" }).click();
  const credentialDialog = page.getByRole("dialog", { name: /临时密码/ });
  await expect(credentialDialog).toBeVisible();
  // The credential is intentionally modal and shown only once. Acknowledge it
  // before paging the table, just as a real administrator must do.
  await credentialDialog.getByRole("button", { name: "我已安全交付给员工" }).click();
  const row = await findStaffRow(page, "迟到响应后仍存在的新员工");
  await expect(row).toBeVisible();

  const release = releaseFirstStaffResponse as (() => void) | null;
  if (!release) throw new Error("首次员工列表响应未进入延迟状态");
  release();
  await expect.poll(() => firstStaffResponseReleased).toBe(true);
  await expect(row).toBeVisible();
  expect(failures).toEqual([]);
});
