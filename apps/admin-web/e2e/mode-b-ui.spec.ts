import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type ApiEnvelope<T> = { data: T };
const demoSuper = { 'x-demo-user-id': 'demo-super-admin', 'x-demo-role': 'SUPER_ADMIN' };
const apiBaseUrl = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3101';

async function call<T>(request: APIRequestContext, path: string, method: 'GET' | 'POST', data?: unknown, headers: Record<string, string> = demoSuper): Promise<T> {
  const response = await request.fetch(`${apiBaseUrl}${path}`, { method, headers: { ...headers, ...(data === undefined ? {} : { 'content-type': 'application/json' }) }, data });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(300);
  return (await response.json() as ApiEnvelope<T>).data;
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('管理员账号').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await page.waitForTimeout(500);
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: '退出登录' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('heading', { name: '登录运营工作台' })).toBeVisible();
}

test('创建点位负责人后，只能在本点工作台完成到货、部分领取并在停用后失效', async ({ page, request }) => {
  const suffix = `staff-ui-${Date.now()}`;
  const phoneTail = Date.now().toString().slice(-8);
  const adminPhone = `138${phoneTail}`;
  const managerPhone = `139${phoneTail}`;
  const bootstrap = await call<{ staff: { userId: string }; initialCredential: string }>(request, '/api/v1/admin/staff', 'POST', {
    displayName: 'E2E 平台负责人', username: `e2e.admin.${suffix}`, phone: adminPhone, role: 'SUPER_ADMIN', pickupPointIds: [],
  });
  await call(request, '/api/v1/auth/admin/activate', 'POST', { username: `e2e.admin.${suffix}`, initialCredential: bootstrap.initialCredential, newPassword: 'e2e platform administrator password' });

  const area = await call<{ id: string }>(request, '/api/v1/admin/service-areas', 'POST', { regionCode: '130606' });
  const point = await call<{ id: string; name: string }>(request, '/api/v1/admin/pickup-points', 'POST', { serviceAreaId: area.id, name: `E2E 点位 ${suffix}`, address: `保定市莲池区 E2E 路 ${suffix}`, capacityPerDay: 100 });
  const sku = await call<{ id: string }>(request, '/api/v1/admin/platform/skus', 'POST', { title: `E2E 干货 ${suffix}`, category: '干货', origin: '河北', imageUrl: null, skuName: '500g', retailPriceCents: 1200, defaultSellableQuantity: 10, referencePurchaseCostCents: null, supplierNote: null, status: 'ACTIVE' });
  const campaign = await call<{ id: string }>(request, '/api/v1/admin/community/campaigns', 'POST', { title: `E2E 团期 ${suffix}`, serviceAreaId: area.id, pickupPointId: point.id, cutoffAt: new Date(Date.now() + 3_000).toISOString(), dispatchAt: new Date(Date.now() + 86_400_000).toISOString(), minTotalQuantity: 1, failureAction: 'CANCEL_AND_REFUND', items: [{ platformSkuId: sku.id, retailPriceCents: 1200, sellableQuantity: 3 }] });
  await call(request, `/api/v1/admin/campaigns/${campaign.id}/open`, 'POST');
  const order = await call<{ id: string; orderNo: string }>(request, '/api/v1/orders', 'POST', { campaignId: campaign.id, serviceAreaId: area.id, pickupPointId: point.id, items: [{ skuId: sku.id, quantity: 3 }] }, { ...demoSuper, 'idempotency-key': `staff-ui-order-${suffix}` });
  await call(request, `/api/v1/orders/${order.id}/mock-pay`, 'POST');
  await page.waitForTimeout(3_250);
  await call(request, `/api/v1/admin/campaigns/${campaign.id}/close`, 'POST');
  const delivery = (await call<Array<{ id: string }>>(request, '/api/v1/admin/community/deliveries', 'GET')).find((item) => item.id) ?? (() => { throw new Error('expected community delivery'); })();
  await call(request, `/api/v1/admin/delivery-plans/${delivery.id}/book-vehicle`, 'POST', { logisticsPlatform: '货拉拉', vehicleOrderNo: `HL-${suffix}`, driverName: 'E2E 司机', driverPhone: '13900000000', vehiclePlate: '冀F12345', estimatedArrivalAt: new Date(Date.now() + 3_600_000).toISOString(), remark: null });
  const batch = await call<{ id: string }>(request, '/api/v1/admin/dispatch-batches', 'POST', { campaignId: campaign.id });
  await call(request, `/api/v1/admin/dispatch-batches/${batch.id}/dispatch`, 'POST');

  await page.goto('/');
  await signIn(page, `e2e.admin.${suffix}`, 'e2e platform administrator password');
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.getByRole('button', { name: '系统设置' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '系统设置' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '系统设置' }).click();
  await page.getByRole('button', { name: '新增内部员工' }).click();
  await page.getByLabel('员工姓名').fill('E2E 点位负责人');
  await page.getByLabel('登录账号').fill(`e2e.manager.${suffix}`);
  await page.getByLabel('联系手机号').fill(managerPhone);
  await page.getByLabel('负责自提点').click();
  await page.getByText(point.name, { exact: false }).last().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '创建并生成初始凭据' }).click();
  const credentialDialog = page.getByRole('dialog').filter({ hasText: '员工已创建' });
  const oneTimeCredential = await credentialDialog.locator('input').inputValue();
  await credentialDialog.getByRole('button', { name: '我已记录并安全转交' }).click();

  await signOut(page);
  await signIn(page, `e2e.manager.${suffix}`, oneTimeCredential);
  await expect(page.getByRole('heading', { name: '首次激活账号' })).toBeVisible();
  await page.getByLabel('一次性初始凭据').fill(oneTimeCredential);
  await page.getByLabel('新密码').fill('e2e point manager new password');
  await page.getByRole('button', { name: '激活并进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '点位工作台' })).toBeVisible();
  await expect(page.getByText('商品管理', { exact: true })).toHaveCount(0);
  await expect(page.getByText('财务管理', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '逐商品确认到货' }).click();
  await page.getByLabel('接货人').fill('E2E 点位负责人');
  await page.getByLabel('实到').fill('2');
  await page.getByLabel('短少').fill('1');
  await page.getByLabel('差异原因（有差异时必填）').click();
  await page.getByText('运输短少', { exact: true }).last().click();
  await page.getByLabel('文字证据（有差异时必填）').fill('现场清点短少一件');
  await page.getByRole('button', { name: '确认到货与差异' }).click();

  const code = await call<{ code: string }>(request, `/api/v1/pickup-code?orderId=${order.id}`, 'GET');
  await page.getByRole('button', { name: '查询订单并确认领取' }).click();
  await page.getByLabel('订单号').fill(order.orderNo);
  await page.getByRole('button', { name: '查询订单商品' }).click();
  await expect(page.getByText(/待领 2 \/ 已领 0 \/ 异常 1/)).toBeVisible();
  await page.getByLabel('六码取货码').fill(code.code);
  await page.getByRole('button', { name: '核验并确认本次领取' }).click();

  const managerToken = await page.evaluate(() => localStorage.getItem('hometown-admin-token'));
  await signOut(page);
  await signIn(page, `e2e.admin.${suffix}`, 'e2e platform administrator password');
  await page.getByRole('button', { name: '系统设置' }).click();
  await page.getByRole('row', { name: new RegExp('E2E 点位负责人') }).getByRole('button', { name: '变更/停用' }).click();
  await page.getByLabel('状态').click();
  await page.getByText('已停用', { exact: true }).last().click();
  await page.getByLabel('停用原因').fill('E2E 离岗回收权限');
  await page.getByRole('button', { name: '保存并回收会话' }).click();
  const revoked = await request.get(`${apiBaseUrl}/api/v1/admin/community/deliveries`, { headers: { authorization: `Bearer ${managerToken ?? ''}` } });
  expect(revoked.status()).toBe(401);
});
