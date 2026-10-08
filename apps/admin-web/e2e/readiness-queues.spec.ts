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
  const qualityRows = [
    {id: "quality-pending", orderId: "quality-order", orderNo: "待核对品质订单", status: "REFUNDING", financeRefundStatus: null, financeRefundStatuses: [], refundAmountCents: 1200, refundAmountKind: "PENDING", financialFactsError: null, items: [{name: "新鲜苹果", quantity: 2, description: "顾客反馈破损"}], decisionNote: "运营已核对"},
    {id: "quality-processing", orderId: "quality-order-2", orderNo: "已提交品质订单", status: "REFUNDING", financeRefundStatus: "PROCESSING", financeRefundStatuses: ["PROCESSING"], refundAmountCents: 600, refundAmountKind: "RECORDED", refundStatus: "PROCESSING", financialFactsError: null, items: [], decisionNote: "已交支付渠道"},
    {id: "quality-mixed", orderId: "quality-order-3", orderNo: "仍有一笔处理中", status: "REFUNDING", financeRefundStatus: "PROCESSING", financeRefundStatuses: ["SUCCEEDED", "PROCESSING"], refundAmountCents: 900, refundAmountKind: "RECORDED", refundStatus: "PROCESSING", financialFactsError: null, items: [], decisionNote: "多笔义务尚未全部成功"},
    {id: "quality-settled", orderId: "quality-order-4", orderNo: "退款已全部成功待财务确认", status: "REFUNDING", financeRefundStatus: "SUCCEEDED", financeRefundStatuses: ["SUCCEEDED", "SUCCEEDED"], refundAmountCents: 900, refundAmountKind: "RECORDED", refundStatus: "SUCCEEDED", financialFactsError: null, items: [], decisionNote: "支付渠道已确认"},
  ];
  let qualitySettled = false;
  await page.route("**/api/v1/admin/quality-cases*", route => route.fulfill({json: {
    data: qualitySettled
      ? qualityRows.filter(value => value.id !== "quality-settled")
      : qualityRows,
    pagination: {total: qualitySettled ? 3 : qualityRows.length, page: 1, pageSize: 20},
  }}));
  await page.goto("/");
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码").fill((await created.json()).data.temporaryPassword);
  await page.getByRole("button", {name: /登\s*录/}).click();
  await page.getByLabel("新密码", {exact: true}).fill("readiness finance password");
  await page.getByLabel("确认新密码").fill("readiness finance password");
  await page.getByRole("button", {name: "保存新密码"}).click();
  const quality = page.getByRole("region", {name: "品质售后退款"});
  const pending = quality.getByRole("row").filter({hasText: "待核对品质订单"});
  await expect(pending.getByText("待执行", {exact: true})).toBeVisible();
  await pending.getByRole("button", {name: "执行退款"}).click();
  await expect(page.getByRole("dialog").getByText(/退款金额：待执行 ¥12.00/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", {name: /取\s*消/}).click();
  const processing = quality.getByRole("row").filter({hasText: "已提交品质订单"});
  await expect(processing.getByText("退款处理中", {exact: true})).toBeVisible();
  await expect(processing.getByRole("button", {name: "执行退款"})).toHaveCount(0);
  await expect(processing.getByRole("button", {name: "确认退款已结清"})).toHaveCount(0);
  await processing.getByRole("button", {name: "查看详情"}).click();
  await expect(page.getByText("已交支付渠道", {exact: true})).toBeVisible();
  await page.getByRole("dialog").locator(".ant-modal-close").click();
  const mixed = quality.getByRole("row").filter({hasText: "仍有一笔处理中"});
  await expect(mixed.getByRole("button", {name: "确认退款已结清"})).toHaveCount(0);
  let settlementConfirmations = 0;
  await page.route("**/api/v1/admin/quality-cases/quality-settled/refund", async route => {
    settlementConfirmations += 1;
    qualitySettled = true;
    await route.fulfill({json: {data: {
      id: "quality-settled",
      orderId: "quality-order-4",
      orderNo: "退款已全部成功待财务确认",
      status: "RESOLVED",
      financeRefundStatus: "SUCCEEDED",
      financeRefundStatuses: ["SUCCEEDED", "SUCCEEDED"],
    }}});
  });
  const settled = quality.getByRole("row").filter({hasText: "退款已全部成功待财务确认"});
  await settled.getByRole("button", {name: "确认退款已结清"}).click();
  const confirmDialog = page.getByRole("dialog", {name: "二次确认品质退款结清"});
  await expect(confirmDialog.getByText(/只记录财务结清确认，不会再次向支付渠道提交退款/)).toBeVisible();
  await confirmDialog.getByRole("button", {name: "确认结清"}).click();
  await expect.poll(() => settlementConfirmations).toBe(1);
  await expect(settled).toHaveCount(0);
  const cancellations = page.getByRole("region", {name: "截单后取消退款"});
  await page.getByRole("tab", {name: "取消退款"}).click();
  await expect(quality).toHaveCount(0);
  await expect(cancellations.getByText("共 501 条")).toBeVisible();
  await cancellations.locator('.ant-pagination-item[title="26"]').click();
  await expect(cancellations.getByRole("row").filter({hasText: "历史待退款501"})).toBeVisible();
  expect(queries.some(value => value.includes("page=26") && value.includes("status=APPROVED_WAITING_FINANCE"))).toBe(true);
  await page.getByRole("tab", {name: "到货差异"}).click();
  await page.getByRole("combobox", {name: "待办状态筛选"}).click();
  await expect(page.getByRole("option", {name: "全部可见状态"})).toHaveCount(0);
  await page.keyboard.press("Escape");
  const exception = page.getByRole("region", {name: "到货差异退款"}).getByRole("row").filter({hasText: "缺快照订单"});
  await expect(exception.getByText(/关联订单行或价格快照缺失/)).toBeVisible();
  await expect(exception.getByRole("button", {name: "执行退款"})).toBeDisabled();
});
