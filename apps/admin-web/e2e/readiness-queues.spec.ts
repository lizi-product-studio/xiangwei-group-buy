import { expect, test } from "@playwright/test";

test("财务分页请求历史待办且缺金额依据时禁止退款", async ({page, request}) => {
  // Real staff login; only queue read responses are synthetic to isolate the browser contract.
  // Real endpoint filtering/501+ history and refund refusal are covered by readiness-queues.api.test.ts.
  const suffix = String(Date.now());
  const username = `readiness.finance.${suffix}`;
  const created = await request.post(`${process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3101"}/api/v1/admin/staff`, {
    headers: {"x-demo-user-id": "demo-super-admin", "x-demo-role": "SUPER_ADMIN"},
    data: {displayName: "历史待办财务", username, phone: `137${suffix.slice(-8)}`, role: "FINANCE", pickupPointIds: []},
  });
  expect(created.status(), await created.text()).toBe(201);
  const queries: string[] = [];
  await page.route("**/api/v1/admin/community/cancellation-requests*", async route => {
    const url = new URL(route.request().url());
    queries.push(url.search);
    const current = Number(url.searchParams.get("page") ?? 1);
    const size = Number(url.searchParams.get("pageSize") ?? 20);
    const data = Array.from({length: Math.min(size, Math.max(0, 501 - (current - 1) * size))}, (_, index) => {
      const number = (current - 1) * size + index;
      return {id: `cancel-${number}`, orderId: `order-${number}`, orderNo: number === 500 ? "历史待退款501" : `分页订单${number}`, status: "APPROVED_WAITING_FINANCE", reason: "合成分页检查", items: []};
    });
    await route.fulfill({json: {data, pagination: {total: 501, page: current, pageSize: size}}});
  });
  await page.route("**/api/v1/admin/fulfillment-exceptions*", route => route.fulfill({json: {
    data: [{id: "missing-facts", orderId: "old", orderNo: "缺快照订单", status: "REFUND_CONFIRMED", items: [], refundAmountCents: null, financialFactsError: "关联订单行或价格快照缺失，请联系管理员核查，暂不可执行退款"}],
    pagination: {total: 1, page: 1, pageSize: 20},
  }}));
  await page.goto("/");
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码").fill((await created.json()).data.temporaryPassword);
  await page.getByRole("button", {name: /登\s*录/}).click();
  await page.getByLabel("新密码", {exact: true}).fill("readiness finance password");
  await page.getByLabel("确认新密码").fill("readiness finance password");
  await page.getByRole("button", {name: "保存新密码"}).click();
  const cancellations = page.getByRole("region", {name: "截单后取消退款"});
  await expect(cancellations.getByText("共 501 条")).toBeVisible();
  await cancellations.locator('.ant-pagination-item[title="26"]').click();
  await expect(cancellations.getByRole("row").filter({hasText: "历史待退款501"})).toBeVisible();
  expect(queries.some(value => value.includes("page=26") && value.includes("status=APPROVED_WAITING_FINANCE"))).toBe(true);
  const exception = page.getByRole("region", {name: "到货差异退款"}).getByRole("row").filter({hasText: "缺快照订单"});
  await expect(exception.getByText(/关联订单行或价格快照缺失/)).toBeVisible();
  await expect(exception.getByRole("button", {name: "执行退款"})).toBeDisabled();
});
