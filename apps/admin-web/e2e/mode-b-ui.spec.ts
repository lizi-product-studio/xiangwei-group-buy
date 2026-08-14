import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type ApiEnvelope<T> = { data: T };

async function call<T>(request: APIRequestContext, path: string, method: 'GET' | 'POST', data?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const response = await request.fetch(`http://127.0.0.1:3100${path}`, {
    method,
    headers: { 'x-demo-user-id': 'mode-b-e2e-admin', 'x-demo-role': 'SUPER_ADMIN', ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders },
    data,
  });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(300);
  return (await response.json() as ApiEnvelope<T>).data;
}

async function chooseFirst(page: Page, label: string) {
  const control = page.getByLabel(label, { exact: true });
  await control.click();
  // Ant Design portals may animate outside the viewport in headless mode.
  // Selecting the first, unique fixture option with the keyboard keeps this
  // a browser interaction while avoiding a coordinate-dependent click.
  await control.press('ArrowDown');
  await control.press('Enter');
}

test('Mode B 采购、收货差异和财务退款依据在后台可完成核对', async ({ page, request }) => {
  const suffix = `ui-${Date.now()}`;
  const warehouse = await call<{ id: string }>(request, '/api/v1/admin/platform/warehouses', 'POST', { name: `E2E 中心仓 ${suffix}`, address: `E2E 仓库地址 ${suffix}`, status: 'ACTIVE' });
  const supplier = await call<{ id: string }>(request, '/api/v1/admin/platform/suppliers', 'POST', { name: `E2E 供应商 ${suffix}`, contactName: '验收员', contactPhone: '13800000000', status: 'ACTIVE' });
  await call(request, `/api/v1/admin/platform/suppliers/${supplier.id}/qualifications`, 'POST', { qualificationType: '食品经营许可', qualificationNo: `E2E-${suffix}`, expiresAt: '2099-01-01', status: 'APPROVED', evidenceSummary: 'E2E 已核验' });
  const sku = await call<{ id: string }>(request, '/api/v1/admin/platform/skus', 'POST', { title: `E2E 模式B米粉 ${suffix}`, category: '干货', origin: '河北', imageUrl: null, skuName: '500g', retailPriceCents: 3000, status: 'ACTIVE' });
  const offer = await call<{ id: string }>(request, '/api/v1/admin/platform/offers', 'POST', { supplierId: supplier.id, platformSkuId: sku.id, purchasePriceCents: 1800, minimumPurchaseQuantity: 1, leadTimeDays: 1, status: 'ACTIVE' });
  const campaign = await call<{ id: string }>(request, '/api/v1/admin/platform/campaigns', 'POST', { title: `E2E 差异团 ${suffix}`, serviceAreaId: 'service-bd-lianchi', warehouseId: warehouse.id, cutoffAt: new Date(Date.now() + 1_100).toISOString(), dispatchAt: new Date(Date.now() + 86_400_000).toISOString(), minTotalQuantity: 1, failureAction: 'CANCEL_AND_REFUND', items: [{ platformSkuId: sku.id, supplierOfferId: offer.id, sellableQuantity: 3 }] });
  await call(request, '/api/v1/admin/delivery-plans', 'POST', { campaignId: campaign.id, pickupPointId: 'pickup-demo-001', siteName: '莲池家乡味自提点', address: '保定市莲池区示范路 88 号', arrivalStartAt: null, arrivalEndAt: null, contactName: null, contactPhone: null, remark: null });
  await call(request, `/api/v1/admin/campaigns/${campaign.id}/open`, 'POST');
  const order = await call<{ id: string; orderNo: string }>(request, '/api/v1/orders', 'POST', { campaignId: campaign.id, serviceAreaId: 'service-bd-lianchi', pickupPointId: 'pickup-demo-001', items: [{ skuId: sku.id, quantity: 3 }] }, { 'idempotency-key': `mode-b-e2e-${suffix}` });
  await call(request, `/api/v1/orders/${order.id}/mock-pay`, 'POST');
  await page.waitForTimeout(1_250);
  await call(request, `/api/v1/admin/campaigns/${campaign.id}/close`, 'POST');
  const purchaseOrders = await call<Array<{ id: string; purchaseNo: string; campaignId: string; items: Array<{ id: string }> }>>(request, '/api/v1/admin/platform/purchase-orders', 'GET');
  const purchaseOrder = purchaseOrders.find((value) => value.campaignId === campaign.id);
  expect(purchaseOrder).toBeTruthy();
  const plans = await call<Array<{ id: string; campaignId: string }>>(request, '/api/v1/admin/delivery-plans', 'GET');
  const plan = plans.find((value) => value.campaignId === campaign.id);
  expect(plan).toBeTruthy();
  await call(request, `/api/v1/admin/delivery-plans/${plan!.id}/book-vehicle`, 'POST', { vehicleOrderNo: `E2E-${suffix}`, driverName: '配送员', driverPhone: '13900000000', vehiclePlate: '冀F12345' });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await page.getByRole('button', { name: /采购与中心仓/ }).click();
  await expect(page.getByRole('heading', { name: /采购单与验收队列/ })).toBeVisible();

  // The operator actions below are deliberately browser-driven. Fixture setup
  // may use the API, but receipt, sorting, outbound, handover and disposition
  // must remain a real UI regression path.
  await page.getByRole('button', { name: '登记收货验收' }).click();
  await chooseFirst(page, '采购单');
  await page.getByLabel('食品批次号（有合格实收时必填）').fill(`LOT-${suffix}`);
  await page.getByLabel('生产日期').fill('2026-08-13');
  await page.getByLabel('到期日期').fill('2027-08-13');
  await page.getByLabel('验收说明（有拒收/短收时必填）').fill('E2E 合格验收');
  await page.getByLabel('证据链接（可选）').fill('https://evidence.example/e2e-receipt');
  await page.getByRole('button', { name: '保存本次验收批次' }).click();
  await expect(page.getByRole('dialog', { name: '登记供应商收货验收' })).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: purchaseOrder!.purchaseNo })).toContainText('0');

  await page.getByRole('button', { name: '创建分拣任务' }).click();
  await expect(page.getByRole('button', { name: '完成分拣' })).toBeVisible();
  await page.getByRole('button', { name: '完成分拣' }).click();
  await page.getByRole('button', { name: '创建出库配送' }).click();
  await expect(page.getByRole('dialog', { name: '创建出库配送' })).toBeVisible();
  await page.getByLabel('配送/承运参考号').fill(`E2E-${suffix}`);
  await page.getByRole('button', { name: '确认出库配送' }).click();
  await expect(page.getByRole('dialog', { name: '创建出库配送' })).toBeHidden();

  await page.getByRole('button', { name: '登记交接事实' }).click();
  await chooseFirst(page, '待交接出库单');
  await page.getByLabel('点位接货人').fill('E2E 接货人');
  await page.getByLabel('交接说明').fill('E2E 短少一件');
  await page.getByLabel('实到').fill('2');
  await page.getByLabel('短少').fill('1');
  await chooseFirst(page, '差异原因（有差异时必填）');
  await page.getByLabel('差异证据说明（有差异时必填）').fill('E2E 清点记录');
  await page.getByRole('button', { name: '提交交接事实' }).click();
  await expect(page.getByRole('dialog', { name: '登记点位交接与差异' })).toBeHidden();

  await expect(page.getByText(order.orderNo)).toBeVisible();
  await expect(page.getByText(`E2E 模式B米粉 ${suffix} · 500g`, { exact: true })).toBeVisible();
  const exceptionRow = page.locator('tr').filter({ hasText: order.orderNo });
  await expect(exceptionRow.getByText(/异常 1 件，已退 0 件，本退 1 件/)).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept('E2E 运营确认短少退款'));
  await exceptionRow.getByRole('button', { name: '确认退款' }).click();
  const execute = exceptionRow.getByRole('button', { name: '核对后执行退款' });
  await expect(execute).toBeVisible();
  await execute.click();
  await expect(page.getByText(/订单实付/)).toBeVisible();
  await expect(page.getByText(/累计已退.*退款处理中.*可退余额/)).toBeVisible();
});
