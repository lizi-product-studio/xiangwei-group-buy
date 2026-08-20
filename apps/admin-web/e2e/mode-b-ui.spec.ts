import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';

type ApiEnvelope<T> = { data: T };
const demoSuper = { 'x-demo-user-id': 'demo-super-admin', 'x-demo-role': 'SUPER_ADMIN' };
const apiBaseUrl = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3101';

function containsEvidenceUrl(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsEvidenceUrl);
  if (value && typeof value === 'object') return Object.entries(value).some(([key, child]) => key.toLowerCase() === 'evidenceurl' || containsEvidenceUrl(child));
  return false;
}

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
  const cutoffAt = new Date(Date.now() + 3_000).toISOString();
  const normalCampaign = await call<{ id: string }>(request, '/api/v1/admin/community/campaigns', 'POST', { title: `E2E 正常到货团 ${suffix}`, serviceAreaId: area.id, pickupPointId: point.id, cutoffAt, dispatchAt: new Date(Date.now() + 86_400_000).toISOString(), minTotalQuantity: 1, failureAction: 'CANCEL_AND_REFUND', items: [{ platformSkuId: sku.id, retailPriceCents: 1200, sellableQuantity: 1 }] });
  const exceptionCampaign = await call<{ id: string }>(request, '/api/v1/admin/community/campaigns', 'POST', { title: `E2E 差异到货团 ${suffix}`, serviceAreaId: area.id, pickupPointId: point.id, cutoffAt, dispatchAt: new Date(Date.now() + 86_400_000).toISOString(), minTotalQuantity: 1, failureAction: 'CANCEL_AND_REFUND', items: [{ platformSkuId: sku.id, retailPriceCents: 1200, sellableQuantity: 5 }] });
  const emergencyCampaign = await call<{ id: string }>(request, '/api/v1/admin/community/campaigns', 'POST', { title: `E2E 紧急代办团 ${suffix}`, serviceAreaId: area.id, pickupPointId: point.id, cutoffAt, dispatchAt: new Date(Date.now() + 86_400_000).toISOString(), minTotalQuantity: 1, failureAction: 'CANCEL_AND_REFUND', items: [{ platformSkuId: sku.id, retailPriceCents: 1200, sellableQuantity: 1 }] });
  await call(request, `/api/v1/admin/campaigns/${normalCampaign.id}/open`, 'POST');
  await call(request, `/api/v1/admin/campaigns/${exceptionCampaign.id}/open`, 'POST');
  await call(request, `/api/v1/admin/campaigns/${emergencyCampaign.id}/open`, 'POST');
  const normalOrder = await call<{ id: string; orderNo: string }>(request, '/api/v1/orders', 'POST', { campaignId: normalCampaign.id, serviceAreaId: area.id, pickupPointId: point.id, items: [{ skuId: sku.id, quantity: 1 }] }, { ...demoSuper, 'idempotency-key': `staff-ui-normal-order-${suffix}` });
  const exceptionOrder = await call<{ id: string; orderNo: string }>(request, '/api/v1/orders', 'POST', { campaignId: exceptionCampaign.id, serviceAreaId: area.id, pickupPointId: point.id, items: [{ skuId: sku.id, quantity: 5 }] }, { ...demoSuper, 'idempotency-key': `staff-ui-exception-order-${suffix}` });
  const emergencyOrder = await call<{ id: string; orderNo: string }>(request, '/api/v1/orders', 'POST', { campaignId: emergencyCampaign.id, serviceAreaId: area.id, pickupPointId: point.id, items: [{ skuId: sku.id, quantity: 1 }] }, { ...demoSuper, 'idempotency-key': `staff-ui-emergency-order-${suffix}` });
  await call(request, `/api/v1/orders/${normalOrder.id}/mock-pay`, 'POST');
  await call(request, `/api/v1/orders/${exceptionOrder.id}/mock-pay`, 'POST');
  await call(request, `/api/v1/orders/${emergencyOrder.id}/mock-pay`, 'POST');
  await page.waitForTimeout(3_250);
  await call(request, `/api/v1/admin/campaigns/${normalCampaign.id}/close`, 'POST');
  await call(request, `/api/v1/admin/campaigns/${exceptionCampaign.id}/close`, 'POST');
  await call(request, `/api/v1/admin/campaigns/${emergencyCampaign.id}/close`, 'POST');
  const deliveries = await call<Array<{ id: string; campaignId: string }>>(request, '/api/v1/admin/community/deliveries', 'GET');
  const normalDelivery = deliveries.find((item) => item.campaignId === normalCampaign.id) ?? (() => { throw new Error('expected normal community delivery'); })();
  const exceptionDelivery = deliveries.find((item) => item.campaignId === exceptionCampaign.id) ?? (() => { throw new Error('expected exception community delivery'); })();
  const emergencyDelivery = deliveries.find((item) => item.campaignId === emergencyCampaign.id) ?? (() => { throw new Error('expected emergency community delivery'); })();
  const dispatchedBatchIds = new Map<string, string>();
  for (const [campaignId, delivery, suffixPart] of [[normalCampaign.id, normalDelivery, 'normal'], [exceptionCampaign.id, exceptionDelivery, 'exception'], [emergencyCampaign.id, emergencyDelivery, 'emergency']] as const) {
    await call(request, `/api/v1/admin/delivery-plans/${delivery.id}/book-vehicle`, 'POST', { logisticsPlatform: '货拉拉', vehicleOrderNo: `HL-${suffix}-${suffixPart}`, driverName: 'E2E 司机', driverPhone: '13900000000', vehiclePlate: '冀F12345', estimatedArrivalAt: new Date(Date.now() + 3_600_000).toISOString(), remark: null });
    const batch = await call<{ id: string }>(request, '/api/v1/admin/dispatch-batches', 'POST', { campaignId });
    await call(request, `/api/v1/admin/dispatch-batches/${batch.id}/dispatch`, 'POST');
    dispatchedBatchIds.set(campaignId, batch.id);
  }
  const normalBatchId = dispatchedBatchIds.get(normalCampaign.id) ?? (() => { throw new Error('expected normal dispatch batch'); })();
  const emergencyBatchId = dispatchedBatchIds.get(emergencyCampaign.id) ?? (() => { throw new Error('expected emergency dispatch batch'); })();

  await page.goto('/');
  await signIn(page, `e2e.admin.${suffix}`, 'e2e platform administrator password');
  const orderNavigation = page.locator('nav[aria-label="主导航"] .nav-item').filter({ hasText: '订单管理' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(orderNavigation).toHaveCount(1);
  await orderNavigation.click();
  await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible();
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.getByRole('button', { name: '系统设置' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(orderNavigation).toHaveCount(1);
  await orderNavigation.click();
  await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible();
  await expect(page.getByRole('button', { name: '系统设置' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '物流管理' }).click();
  const emergencyRow = page.getByRole('row', { name: new RegExp(`E2E 紧急代办团 ${suffix}`) });
  await emergencyRow.getByRole('button', { name: '紧急代办点位确认' }).click();
  await expect(page.getByText('紧急代办：点位逐商品确认到货', { exact: true })).toBeVisible();
  await page.getByLabel('接货人').fill('E2E 平台负责人');
  await page.getByLabel('紧急代办原因').fill('点位负责人突发疾病，平台负责人现场代办');
  const emergencyArrivalRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes(`/api/v1/admin/community/dispatch-batches/${emergencyBatchId}/arrival`));
  await page.getByRole('button', { name: '确认到货与差异' }).click();
  expect(containsEvidenceUrl((await emergencyArrivalRequest).postDataJSON())).toBe(false);
  await expect(emergencyRow.getByText('已到货', { exact: true })).toBeVisible();
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

  const normalRow = page.getByRole('row', { name: new RegExp(`E2E 正常到货团 ${suffix}`) });
  await normalRow.getByRole('button', { name: '逐商品确认到货' }).click();
  await page.getByLabel('接货人').fill('E2E 点位负责人');
  const normalArrivalRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes(`/api/v1/admin/community/dispatch-batches/${normalBatchId}/arrival`));
  await page.getByRole('button', { name: '确认到货与差异' }).click();
  expect(containsEvidenceUrl((await normalArrivalRequest).postDataJSON())).toBe(false);
  await expect(normalRow.getByText('已到货', { exact: true })).toBeVisible();
  await expect(normalRow.getByRole('button', { name: '查询订单并确认领取' })).toBeVisible();

  const exceptionRow = page.getByRole('row', { name: new RegExp(`E2E 差异到货团 ${suffix}`) });
  await exceptionRow.getByRole('button', { name: '逐商品确认到货' }).click();
  await page.getByLabel('接货人').fill('E2E 点位负责人');
  await page.getByLabel('实到').fill('4');
  await page.getByLabel('短少').fill('1');
  await page.getByLabel('差异原因（有差异时必填）').click();
  await page.getByText('运输短少', { exact: true }).last().click();
  await page.getByLabel('文字证据（有差异时必填）').fill('现场清点短少一件');
  await page.getByRole('button', { name: '确认到货与差异' }).click();
  await expect(exceptionRow.getByText('已到货（有差异）', { exact: true })).toBeVisible();
  await expect(exceptionRow.getByText('存在配送差异，仅可核销正常实到商品')).toBeVisible();

  const code = await call<{ code: string }>(request, `/api/v1/pickup-code?orderId=${exceptionOrder.id}`, 'GET');
  await exceptionRow.getByRole('button', { name: '查询订单并确认领取' }).click();
  await page.getByLabel('订单号').fill(exceptionOrder.orderNo);
  await page.getByRole('button', { name: '查询订单商品' }).click();
  await expect(page.getByText(/待领 4 \/ 已领 0 \/ 异常 1/)).toBeVisible();
  await page.getByLabel('本次领取数量').fill('2');
  await page.getByLabel('六码取货码').fill(code.code);
  type PickupPayload = {
    orderId?: string;
    deliveryPlanId?: string;
    code?: string;
    pickupRequestId?: string;
    items?: Array<{ platformSkuId: string; quantity: number }>;
  };
  const pickupPayloads: PickupPayload[] = [];
  let pickupAttempts = 0;
  const pickupRoute = async (route: Route) => {
    pickupPayloads.push(route.request().postDataJSON() as PickupPayload);
    if (pickupAttempts++ === 0) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'EXTERNAL_SERVICE_ERROR', message: '模拟网络中断，请重试' }) });
      return;
    }
    await route.continue();
  };
  await page.route('**/api/v1/pickup/verify', pickupRoute);
  await page.getByRole('button', { name: '核验并确认本次领取' }).click();
  await expect(page.getByText('模拟网络中断，请重试', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '核验并确认本次领取' })).toBeEnabled();
  expect(await page.evaluate((pickupCode) => Object.values(localStorage).every((value) => !value.includes(pickupCode)), code.code)).toBe(true);
  await page.getByRole('button', { name: '核验并确认本次领取' }).click();
  await page.unroute('**/api/v1/pickup/verify', pickupRoute);
  expect(pickupPayloads).toHaveLength(2);
  expect(pickupPayloads[0]).toEqual(expect.objectContaining({
    orderId: exceptionOrder.id,
    deliveryPlanId: exceptionPlan.id,
    code: code.code,
    items: [{ platformSkuId: sku.id, quantity: 2 }],
  }));
  expect(pickupPayloads[0]?.pickupRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(pickupPayloads[1]).toEqual(pickupPayloads[0]);
  await expect(page.getByText('仅核验当前到货点订单。先查询商品明细，再按实际领取数量确认全提或部分提货。', { exact: true })).toBeHidden();
  await exceptionRow.getByRole('button', { name: '查询订单并确认领取' }).click();
  await page.getByLabel('订单号').fill(exceptionOrder.orderNo);
  await page.getByRole('button', { name: '查询订单商品' }).click();
  await expect(page.getByText(/待领 2 \/ 已领 2 \/ 异常 1/)).toBeVisible();
  await page.getByLabel('本次领取数量').fill('2');
  await page.getByLabel('六码取货码').fill(code.code);
  const secondPickupRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/api/v1/pickup/verify'));
  await page.getByRole('button', { name: '核验并确认本次领取' }).click();
  const secondPickupPayload = (await secondPickupRequest).postDataJSON() as PickupPayload;
  expect(secondPickupPayload.pickupRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(secondPickupPayload.pickupRequestId).not.toBe(pickupPayloads[0]?.pickupRequestId);
  expect(secondPickupPayload.items).toEqual(pickupPayloads[1]?.items);
  await expect(page.getByText('仅核验当前到货点订单。先查询商品明细，再按实际领取数量确认全提或部分提货。', { exact: true })).toBeHidden();
  await exceptionRow.getByRole('button', { name: '查询订单并确认领取' }).click();
  await page.getByLabel('订单号').fill(exceptionOrder.orderNo);
  await page.getByRole('button', { name: '查询订单商品' }).click();
  await expect(page.getByText(/待领 0 \/ 已领 4 \/ 异常 1/)).toBeVisible();
  await call(request, `/api/v1/orders/${exceptionOrder.id}/community-quality-cases`, 'POST', {
    clientRequestId: `quality-case-${suffix}`,
    items: [{ platformSkuId: sku.id, quantity: 1, reason: 'QUALITY_CLAIM', description: 'E2E 用户领取后发现商品品质问题' }],
  });

  const managerToken = await page.evaluate(() => localStorage.getItem('hometown-admin-token'));
  await signOut(page);
  await signIn(page, `e2e.admin.${suffix}`, 'e2e platform administrator password');
  await page.getByRole('button', { name: '售后与异常' }).click();
  await expect(page.getByRole('heading', { name: '客服与售后' })).toBeVisible();
  await expect(page.getByText('品质售后案件', { exact: true })).toBeVisible();
  await expect(page.getByText(exceptionOrder.orderNo, { exact: true })).toBeVisible();
  await expect(page.getByText('E2E 用户领取后发现商品品质问题', { exact: true })).toBeVisible();
  await expect(page.getByText('待受理', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '物流管理' }).click();
  const operationsNormalRow = page.getByRole('row', { name: new RegExp(`E2E 正常到货团 ${suffix}`) });
  const operationsExceptionRow = page.getByRole('row', { name: new RegExp(`E2E 差异到货团 ${suffix}`) });
  await expect(operationsNormalRow.getByText('已到货', { exact: true })).toBeVisible();
  await expect(operationsNormalRow.getByText('等待用户领取')).toBeVisible();
  await expect(operationsExceptionRow.getByText('已到货（有差异）', { exact: true })).toBeVisible();
  await expect(operationsExceptionRow.getByRole('button', { name: '处理配送异常' })).toBeVisible();
  await expect(operationsExceptionRow.getByText('正常商品已可领取')).toBeVisible();
  await page.getByRole('button', { name: '系统设置' }).click();
  const emergencyAuditRow = page.getByRole('row', { name: /紧急代办点位到货确认/ });
  await expect(emergencyAuditRow.getByText('点位负责人突发疾病，平台负责人现场代办')).toBeVisible();
  await page.getByRole('row', { name: new RegExp('E2E 点位负责人') }).getByRole('button', { name: '变更/停用' }).click();
  await page.getByLabel('状态').click();
  await page.getByText('已停用', { exact: true }).last().click();
  await page.getByLabel('停用原因').fill('E2E 离岗回收权限');
  await page.getByRole('button', { name: '保存并回收会话' }).click();
  const revoked = await request.get(`${apiBaseUrl}/api/v1/admin/community/deliveries`, { headers: { authorization: `Bearer ${managerToken ?? ''}` } });
  expect(revoked.status()).toBe(401);
});
