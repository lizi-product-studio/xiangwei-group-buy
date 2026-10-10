import { test, expect, type Page, type Response } from "@playwright/test";
import { secureBrowserFixture } from "./secure-browser-process.ts";
let fixture: Awaited<ReturnType<typeof secureBrowserFixture>>;
test.beforeAll(async () => { fixture = await secureBrowserFixture(); });
test.afterAll(async () => { await fixture?.close(); });
test.use({ ignoreHTTPSErrors: true });
test.setTimeout(120000);
async function login(page: Page, origin: string, username: string) {
  await page.goto(origin);
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByRole("button", { name: "打开账号菜单" })).toContainText(username, { timeout: 90000 });
}
test("real TLS cookie isolation, refresh/logout, production proof and deployed CSP rendering", async ({ context, page }, testInfo) => {
  const violations: string[] = []; const pageErrors: string[] = [];
  page.on("console", message => { if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text()); });
  page.on("pageerror", error => pageErrors.push(error.message));
  const started = Date.now(); await login(page, fixture.admin, "tls.admin");
  await testInfo.attach("18-bit-browser-login", { body: JSON.stringify({ elapsedMs: Date.now() - started }), contentType: "application/json" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("staff-");
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /token|roles|userId|username/i.test(key)))).toEqual([]);
  const cookie = (await context.cookies(fixture.admin)).find(value => value.name === "__Host-staff-session")!;
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/", domain: "localhost" });
  expect((await context.cookies(fixture.sibling)).some(value => value.name === cookie.name)).toBe(false);
  const sibling = await context.newPage(); await login(sibling, fixture.sibling, "tls.finance");
  await page.reload(); await expect(page.getByRole("button", { name: "打开账号菜单" })).toContainText("tls.admin");
  await sibling.reload(); await expect(sibling.getByRole("button", { name: "打开账号菜单" })).toContainText("tls.finance");
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("menuitem", { name: "商品列表", exact: true }).click();
  await expect(page.getByRole("heading", { name: "商品列表", exact: true })).toBeVisible();
  const productImage = page.locator('img[src*="/api/v1/product-images/"]').first();
  await expect(productImage).toBeVisible();
  await expect.poll(() => productImage.evaluate((value: HTMLImageElement) => value.complete && value.naturalWidth > 0)).toBe(true);
  const htmlResponse = await page.request.get(fixture.admin);
  expect(htmlResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(htmlResponse.headers()["strict-transport-security"]).toBe("max-age=31536000");
  expect(htmlResponse.headers()["x-frame-options"]).toBe("DENY");
  await page.screenshot({ path: testInfo.outputPath("tls-csp-catalog.png"), fullPage: true });
  await page.getByRole("button", { name: "打开账号菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: /登\s*录/ })).toBeVisible();
  await page.reload(); await expect(page.getByRole("button", { name: /登\s*录/ })).toBeVisible();
  await sibling.reload(); await expect(sibling.getByRole("button", { name: "打开账号菜单" })).toContainText("tls.finance");
  expect(violations).toEqual([]); expect(pageErrors).toEqual([]);
});
test("wrong step-up password keeps the employee logged in and does not execute the pending action", async ({ page }) => {
  await login(page, fixture.admin, "tls.admin");
  await page.getByRole("menuitem", { name: "员工管理" }).click();
  await page.getByRole("button", { name: "新增员工" }).click();
  await page.getByLabel("姓名").fill("合成安全员工");
  await page.getByLabel("登录账号").fill("tls.created");
  await page.getByLabel("手机号").fill("13800138009");
  await page.getByLabel("角色").click();
  await page.locator(".ant-select-item-option").filter({ hasText: "客服" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "创建账号" }).click();
  const dialog = page.getByRole("dialog", { name: "验证登录密码" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("当前登录密码").fill("incorrect step-up password");
  await dialog.getByRole("button", { name: "验证并继续" }).click();
  await expect(dialog.getByRole("alert")).toContainText("账号或密码不正确", { timeout: 90000 });
  expect(await page.evaluate(async () => (await (await fetch("/api/v1/admin/staff")).json()).data.some((value: { displayName: string }) => value.displayName === "合成安全员工"))).toBe(false);
  await expect(page.getByRole("button", { name: "打开账号菜单" })).toBeVisible();
  await dialog.getByLabel("当前登录密码").fill(fixture.password);
  await dialog.getByRole("button", { name: "验证并继续" }).click();
  await expect(page.getByRole("dialog", { name: /临时密码/ })).toBeVisible({ timeout: 90000 });

});
test("permission-loading failure logout revokes the server cookie and survives refresh", async ({ page, context }) => {
  await login(page, fixture.admin, "tls.admin");
  const before = (await context.cookies(fixture.admin)).find(value => value.name === "__Host-staff-session")!;
  await page.route("**/api/v1/admin/me/access", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TRANSIENT_READ_FAILURE", message: "合成权限加载失败" }) }));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("后台服务暂时不可用");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("button", { name: /登\s*录/ })).toBeVisible();
  expect((await context.cookies(fixture.admin)).some(value => value.name === before.name)).toBe(false);
  const stale = await page.request.get(`${fixture.admin}/api/v1/admin/me/access`, { headers: { cookie: `${before.name}=${before.value}`, origin: fixture.admin } });
  expect(stale.status()).toBe(401);
  await page.reload(); await expect(page.getByRole("button", { name: /登\s*录/ })).toBeVisible();
});

test("consumer phone button uses browser CSRF/origin, keeps masked state on failure or cancel, then loads the selected number", async ({ page, context }, testInfo) => {
  await login(page, fixture.admin, "tls.admin");
  const phoneRequests: Array<{ method: string; origin: string | undefined; csrf: string | undefined; fetchSite: string | undefined; url: string }> = [];
  page.on("request", async request => {
    if (new URL(request.url()).pathname.endsWith("/admin/consumers/1/phone")) {
      const headers = await request.allHeaders();
      phoneRequests.push({ method: request.method(), origin: headers.origin, csrf: headers["x-csrf-token"], fetchSite: headers["sec-fetch-site"], url: request.url() });
    }
  });
  await page.getByRole("menuitem", { name: "用户管理", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "138****8010" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "查看详情" }).click();
  const detail = page.getByRole("dialog", { name: "用户详情" });
  await expect(detail.getByText("138****8010", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "查看完整手机号" })).toBeVisible();
  await detail.getByRole("button", { name: "查看完整手机号" }).click();
  let verification = page.getByRole("dialog", { name: "验证登录密码" });
  await expect(verification).toBeVisible();
  await verification.getByLabel("当前登录密码").fill("incorrect step-up password");
  const incorrectProofStarted = Date.now();
  const rejectedAuthentication = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/v1/auth/admin/reauthenticate" && response.request().method() === "POST",
    { timeout: 90_000 });
  const observeIncorrectPasswordChallenge = (response: Response): void => {
    if (new URL(response.url()).pathname === "/api/v1/auth/admin/challenge" && response.request().method() === "POST")
      console.info(JSON.stringify({ operation: "incorrect-phone-password-challenge", status: response.status(), elapsedMs: Date.now()-incorrectProofStarted }));
  };
  page.on("response", observeIncorrectPasswordChallenge);
  await verification.getByRole("button", { name: "验证并继续" }).click();
  const rejected = await rejectedAuthentication;
  page.off("response", observeIncorrectPasswordChallenge);
  const rejection = await rejected.json() as { code?: string; requestId?: string };
  const safeRequestId = typeof rejection.requestId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(rejection.requestId) ? rejection.requestId : undefined;
  const safeCode = typeof rejection.code === "string" && /^[A-Z0-9_]{1,80}$/.test(rejection.code) ? rejection.code : undefined;
  console.info(JSON.stringify({ operation: "incorrect-phone-password", status: rejected.status(), code: safeCode,
    requestId: safeRequestId, elapsedMs: Date.now()-incorrectProofStarted }));
  await testInfo.attach("incorrect-phone-password", { body: JSON.stringify({status:rejected.status(),code:safeCode,requestId:safeRequestId}), contentType:"application/json" });
  expect(rejected.status(), `Incorrect password response: ${safeCode ?? "unknown"}, requestId=${safeRequestId ?? "unavailable"}`).toBe(401);
  expect(rejection.code).toBe("INVALID_CREDENTIALS");
  await expect(verification.getByRole("alert")).toContainText("账号或密码不正确", { timeout: 5000 });
  await expect(detail.getByText("138****8010", { exact: true })).toBeVisible();
  await expect(detail.getByText("13800138010", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(detail.getByRole("button", { name: "查看完整手机号" })).toBeEnabled();
  await expect(detail.getByText("138****8010", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "查看完整手机号" }).click();
  verification = page.getByRole("dialog", { name: "验证登录密码" });
  await verification.getByLabel("当前登录密码").fill(fixture.password);
  const oldSession = (await context.cookies(fixture.admin)).find(value => value.name === "__Host-staff-session")!;
  const reauthenticationResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/v1/auth/admin/reauthenticate" && response.request().method() === "POST",
    { timeout: 90_000 });
  const selectedPhoneResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/v1/admin/consumers/1/phone" && response.request().method() === "GET",
    { timeout: 90_000 }).then(response => ({ response }), error => ({ errorType: error instanceof Error ? error.name : "Error" }));
  const proofStarted = Date.now();
  page.on("response", response => {
    if (new URL(response.url()).pathname === "/api/v1/auth/admin/challenge" && response.request().method() === "POST")
      console.info(JSON.stringify({ operation: "consumer-phone-challenge", status: response.status(), elapsedMs: Date.now()-proofStarted }));
  });
  await verification.getByRole("button", { name: "验证并继续" }).click();
  async function assertSuccessfulResponse(response: Response, operation: string) {
    let code: string | undefined, requestId: string | undefined;
    if (response.status() !== 200) {
      const error = await response.json().catch(() => null) as { code?: string; requestId?: string } | null;
      if (typeof error?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(error.code)) code = error.code;
      if (typeof error?.requestId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(error.requestId)) requestId = error.requestId;
    }
    console.info(JSON.stringify({ operation, status: response.status(), code, requestId, elapsedSinceProofStartedMs: Date.now()-proofStarted }));
    await testInfo.attach(operation, { body: JSON.stringify({ status: response.status(), code, requestId,
      elapsedSinceProofStartedMs: Date.now()-proofStarted }), contentType: "application/json" });
    expect(response.status(), `${operation}: ${code ?? "unexpected status"}, requestId=${requestId ?? "unavailable"}`).toBe(200);
  }
  await assertSuccessfulResponse(await reauthenticationResponse, "consumer-phone-reauthentication");
  const phone = await selectedPhoneResponse;
  if (!("response" in phone)) throw new Error(`Selected consumer phone response failed: ${phone.errorType}`);
  await assertSuccessfulResponse(phone.response, "selected-consumer-phone");
  await expect(detail.getByText("13800138010", { exact: true })).toBeVisible({ timeout: 5000 });
  expect(phoneRequests).toHaveLength(3);
  expect(phoneRequests.at(-1)?.csrf).not.toBe(phoneRequests[0]?.csrf);
  for (const request of phoneRequests) expect(request).toMatchObject({ method: "GET", origin: undefined, fetchSite: "same-origin", csrf: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
  await detail.locator(".ant-modal-footer button").click();
  await expect(detail).toHaveCount(0);
  const other = page.getByRole("row").filter({ hasText: "139****9010" });
  await other.getByRole("button", { name: "查看详情" }).click();
  const otherDetail = page.getByRole("dialog", { name: "用户详情" });
  await expect(otherDetail.getByText("139****9010", { exact: true })).toBeVisible();
  await expect(otherDetail.getByText("13800138010", { exact: true })).toHaveCount(0);
  const staleSession = await page.request.get(`${fixture.admin}/api/v1/admin/me/access`, {
    headers: { cookie: `${oldSession.name}=${oldSession.value}`, origin: fixture.admin },
  });
  expect(staleSession.status()).toBe(401);
});
