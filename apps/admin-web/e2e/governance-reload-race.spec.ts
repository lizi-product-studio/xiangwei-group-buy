import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

async function createLogin(
  request: APIRequestContext,
  role: "SUPER_ADMIN" | "OPERATOR",
  suffix: string,
) {
  const username = `governance.reload.${role.toLowerCase()}.${suffix}`;
  const created = await request.fetch(`${apiBase}/api/v1/admin/staff`, {
    method: "POST",
    headers: superHeaders,
    data: {
      displayName: `治理刷新 ${role}`,
      username,
      phone: `137${`${suffix}${role.length}`.slice(-8)}`,
      role,
      pickupPointIds: [],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const initialCredential = (await created.json()).data.initialCredential as string;
  const activated = await request.fetch(`${apiBase}/api/v1/auth/admin/activate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: {
      username,
      initialCredential,
      newPassword: "governance reload password",
    },
  });
  expect(activated.status(), await activated.text()).toBe(200);
  return { username, password: "governance reload password" };
}

async function login(page: Page, username: string, password: string) {
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: /登\s*录/ }).click();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: /退\s*出/ }).click();
  await expect(page.getByRole("button", { name: /登\s*录/ })).toBeVisible();
}

const notification = (id: string, orderNo: string) => ({
  id,
  type: "ARRIVED",
  orderId: `order-${id}`,
  orderNo,
  userDisplay: "用户 re***",
  status: "MANUAL_REQUIRED",
  deliveryAttempts: 8,
  lastDeliveryError: "模拟失败",
  lastActivityAt: "2026-08-24T00:00:00.000Z",
  manualCompletedAt: null,
  manualCompletedBy: null,
  manualCompletionNote: null,
  providerSubmissionStartedAt: null,
  providerResultRecordedAt: null,
  submissionUnknownReason: null,
});

const audit = (id: string, action: string) => ({
  id,
  actorId: "staff",
  action,
  resourceType: "TEST",
  resourceId: id,
  requestId: `request-${id}`,
  beforeData: null,
  afterData: null,
  createdAt: "2026-08-24T00:00:00.000Z",
});

const interest = (id: string, regionText: string) => ({
  id,
  regionText,
  contactName: "意向用户",
  maskedContactPhone: "139****0000",
  privacyConsentedAt: "2026-08-24T00:00:00.000Z",
  status: "NEW",
  createdAt: "2026-08-24T00:00:00.000Z",
  statusNote: null,
  statusChangedAt: null,
});

test("治理和审计读取的同身份迟到响应不会覆盖最新 generation", async ({
  page,
  request,
}) => {
  const failures = watchBrowser(page);
  const account = await createLogin(request, "SUPER_ADMIN", Date.now().toString());
  let releaseGovernance!: () => void;
  let governanceCalls = 0;
  await page.route("**/api/v1/admin/notifications/manual", async (route) => {
    governanceCalls += 1;
    if (governanceCalls === 1) {
      await new Promise<void>((resolve) => {
        releaseGovernance = resolve;
      });
      return route.fulfill({ json: { data: [] } });
    }
    return route.fulfill({
      json: {
        data: [
          notification("current-governance", "CURRENT-GOVERNANCE"),
          {
            ...notification("unknown-governance", "UNKNOWN-GOVERNANCE"),
            status: "SUBMISSION_UNKNOWN",
            providerSubmissionStartedAt: "2026-08-24T00:00:00.000Z",
            submissionUnknownReason: "provider timeout",
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/admin/service-area-interests", (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.goto("/");
  await login(page, account.username, account.password);
  await page.getByRole("menuitem", { name: "运营治理" }).click();
  await expect.poll(() => governanceCalls).toBe(1);
  await page.getByRole("menuitem", { name: "系统设置" }).click();
  await page.getByRole("menuitem", { name: "运营治理" }).click();
  await expect(page.getByText("CURRENT-GOVERNANCE", { exact: true })).toBeVisible();
  const unknownRow = page
    .getByRole("row")
    .filter({ hasText: "UNKNOWN-GOVERNANCE" });
  await expect(unknownRow).toContainText("微信可能已送达，请勿再次系统发送");
  await expect(unknownRow.getByRole("button", { name: "系统重试" })).toHaveCount(0);
  releaseGovernance();
  await expect(page.getByText("CURRENT-GOVERNANCE", { exact: true })).toBeVisible();

  let releaseAudit!: () => void;
  let auditCalls = 0;
  await page.route("**/api/v1/admin/audit-logs", async (route) => {
    auditCalls += 1;
    if (auditCalls === 1) {
      await new Promise<void>((resolve) => {
        releaseAudit = resolve;
      });
      return route.fulfill({ json: { data: [] } });
    }
    return route.fulfill({ json: { data: [audit("current-audit", "CURRENT_AUDIT")] } });
  });
  await page.getByRole("menuitem", { name: "审计记录" }).click();
  await expect.poll(() => auditCalls).toBe(1);
  await page.getByRole("menuitem", { name: "系统设置" }).click();
  await page.getByRole("menuitem", { name: "审计记录" }).click();
  await expect(page.getByText("CURRENT_AUDIT", { exact: true })).toBeVisible();
  releaseAudit();
  await expect(page.getByText("CURRENT_AUDIT", { exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});

test("跨身份后迟到的治理和审计响应不会泄露前一身份数据", async ({
  page,
  request,
}) => {
  const failures = watchBrowser(page);
  const suffix = Date.now().toString();
  const superAdmin = await createLogin(request, "SUPER_ADMIN", suffix);
  const operator = await createLogin(request, "OPERATOR", `${suffix}1`);
  let releaseGovernance!: () => void;
  let governanceCalls = 0;
  await page.route("**/api/v1/admin/notifications/manual", async (route) => {
    governanceCalls += 1;
    if (governanceCalls === 1) {
      await new Promise<void>((resolve) => {
        releaseGovernance = resolve;
      });
      return route.fulfill({
        json: { data: [notification("previous-governance", "PREVIOUS-GOVERNANCE")] },
      });
    }
    return route.fulfill({
      json: { data: [notification("current-operator", "CURRENT-OPERATOR")] },
    });
  });
  await page.route("**/api/v1/admin/service-area-interests", (route) =>
    route.fulfill({
      json: { data: [interest("current-operator", "CURRENT-OPERATOR")] },
    }),
  );
  await page.route("**/api/v1/admin/audit-logs", (route) =>
    route.fulfill({ json: { data: [audit("previous-audit", "PREVIOUS_AUDIT")] } }),
  );
  await page.goto("/");
  await login(page, superAdmin.username, superAdmin.password);
  await page.getByRole("menuitem", { name: "审计记录" }).click();
  await expect(page.getByRole("heading", { name: "审计记录" })).toBeVisible();
  await page.getByRole("menuitem", { name: "运营治理" }).click();
  await expect.poll(() => governanceCalls).toBe(1);
  await logout(page);
  await login(page, operator.username, operator.password);
  await page.getByRole("menuitem", { name: "运营治理" }).click();
  await expect(page.getByText("CURRENT-OPERATOR", { exact: true })).toBeVisible();
  releaseGovernance();
  await expect(page.getByText("CURRENT-OPERATOR", { exact: true })).toBeVisible();
  await expect(page.getByText("PREVIOUS-GOVERNANCE", { exact: true })).toHaveCount(0);
  await expect(page.getByText("PREVIOUS_AUDIT", { exact: true })).toHaveCount(0);
  expect(failures).toEqual([]);
});
