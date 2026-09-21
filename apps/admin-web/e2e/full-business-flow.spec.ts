import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3101';
const bootstrap = { 'x-demo-user-id': 'demo-super-admin', 'x-demo-role': 'SUPER_ADMIN' };
async function post<T>(request: APIRequestContext, path: string, data: unknown, headers: Record<string, string> = bootstrap): Promise<T> {
  const response = await request.post(`${apiBase}${path}`, { headers, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).data as T;
}
async function login(page: Page, username: string, password: string) {
  await page.getByLabel('账号').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page.getByText('请先设置新密码', { exact: true })).toBeVisible();
  await page.getByLabel('新密码', { exact: true }).fill('full flow local password');
  await page.getByLabel('确认新密码').fill('full flow local password');
  await page.getByRole('button', { name: '保存新密码' }).click();
}

test('同一主图商品与网页开售团贯穿运输到货及分批核销（消费者 API demo / 支付 mock）', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const suffix = String(Date.now());
  const productTitle = `连续主图商品 ${suffix}`;
  const campaignTitle = `连续网页团 ${suffix}`;
  const pointName = `连续自提点 ${suffix}`;
  const categoryName = `连续分类 ${suffix}`;
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  // Only local fixture bootstrap uses super-admin demo headers. Every browser
  // business mutation below must carry an actual password-issued Bearer token.
  const mutations: Array<{ path: string; body: Record<string, unknown> }> = [];
  page.on('request', outgoing => {
    if (outgoing.method() !== 'POST' || !outgoing.url().includes('/api/v1/')) return;
    if (outgoing.url().includes('/auth/')) return;
    expect(outgoing.headers().authorization).toMatch(/^Bearer .+/);
    expect(outgoing.headers()['x-demo-role']).toBeUndefined();
    if (!outgoing.url().endsWith('/product-images')) mutations.push({ path: new URL(outgoing.url()).pathname, body: outgoing.postDataJSON() ?? {} });
  });
  const area = await post<{ id: string; name: string }>(request, '/api/v1/admin/service-areas', { regionCode: '110101' });
  await post(request, `/api/v1/admin/service-areas/${area.id}/order-status`, { orderEnabled: true });
  const point = await post<{ id: string }>(request, '/api/v1/admin/pickup-points', {
    serviceAreaId: area.id, name: pointName, address: '东城区社区服务站 1 号', businessHours: '每日 09:00–20:00', pickupInstructions: '出示取货码', longitude: 116.4167, latitude: 39.9289,
    contactName: '本地测试店长', contactPhone: '13800138000', capacityPerDay: 100,
  });
  await post(request, '/api/v1/admin/catalog/categories', { name: categoryName });
  const operator = await post<{ temporaryPassword: string }>(request, '/api/v1/admin/staff', { displayName: '连续测试运营', username: `flow.op.${suffix}`, phone: `137${suffix.slice(-8)}`, role: 'OPERATOR', pickupPointIds: [] });
  const manager = await post<{ temporaryPassword: string }>(request, '/api/v1/admin/staff', { displayName: '连续测试负责人', username: `flow.pm.${suffix}`, phone: `139${suffix.slice(-8)}`, role: 'PICKUP_MANAGER', pickupPointIds: [point.id] });
  const screenshot = async (name: string) => { await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.ant-message-notice')).toHaveCount(0); const path = testInfo.outputPath(`${name}.png`); await page.screenshot({ path, fullPage: true }); await testInfo.attach(name, { path, contentType: 'image/png' }); };
  await page.goto('/');
  await login(page, `flow.op.${suffix}`, operator.temporaryPassword);
  await page.getByRole('menuitem', { name: '商品列表' }).click();
  await page.getByRole('button', { name: '新增商品' }).click();
  await page.getByLabel('商品名称').fill(productTitle);
  await page.getByLabel('分类', { exact: true }).click();
  await page.getByText(categoryName, { exact: true }).click();
  await page.getByLabel('产地').fill('本地农场');
  await page.getByLabel('销售规格（包装单位）').fill('一份');
  await page.getByLabel('售价（元）').fill('12.50');
  await page.getByLabel('默认团期可售量').fill('10');
  const uploaded = page.waitForResponse(r => r.url().endsWith('/api/v1/admin/product-images') && r.request().method() === 'POST');
  await page.getByLabel('上传商品主图').setInputFiles({ name: 'local-fixture.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4EGQERAwQCgArtgXRlFwMYgAAAABJRU5ErkJggg==', 'base64') });
  const upload = await uploaded;
  expect(upload.ok()).toBeTruthy();
  const imageUrl: string = (await upload.json()).data.imageUrl;
  await page.getByRole('button', { name: '保存商品' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: productTitle }).getByRole('img', { name: '商品主图', exact: true })).toHaveAttribute('src', imageUrl);
  await screenshot('01-product-source');
  const dateInput = (offset: number) => {
    const date = new Date(Date.now() + offset); const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  await page.getByRole('menuitem', { name: '团期管理' }).click();
  await page.getByRole('button', { name: '创建团期' }).click();
  await page.getByLabel('团期名称').fill(campaignTitle);
  const areaSelect = page.getByLabel('服务区域');
  if (await areaSelect.count()) { await areaSelect.click(); await page.locator('.ant-select-item-option').filter({ hasText: area.name }).click(); }
  await page.getByLabel('固定自提点').locator('xpath=../..').click();
  await page.getByText(pointName, { exact: true }).last().click();
  const cutoffAt = Date.now() + 30_000;
  await page.getByLabel('截单时间').fill(dateInput(30_000));
  await page.getByLabel('计划发车时间').fill(dateInput(3_600_000));
  await page.getByLabel(/预计到货时段.*开始/).fill(dateInput(7_200_000));
  await page.getByLabel(/预计到货时段.*结束/).fill(dateInput(10_800_000));
  await page.getByLabel('商品', { exact: true }).click();
  await page.getByText(`${productTitle} · 一份 · 产地：本地农场`, { exact: true }).last().click();
  await page.getByLabel('本团售价（元）').fill('12.50');
  await page.getByLabel('可售量').fill('10');
  await page.getByRole('button', { name: '下一步：发布复核' }).click();
  const creation = page.waitForResponse(r => r.url().endsWith('/api/v1/admin/campaigns') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '确认创建团期' }).click();
  const created = await creation;
  expect(created.ok(), await created.text()).toBeTruthy();
  const campaign = (await created.json()).data as { id: string };
  const campaignRow = page.getByRole('row').filter({ hasText: campaignTitle });
  await campaignRow.getByRole('button', { name: /开\s*售/ }).click();
  await page.getByRole('button', { name: '已复核，确认开售' }).click();
  await expect(campaignRow.getByText('开售中', { exact: true })).toBeVisible();
  const publicResponse = await request.get(`${apiBase}/api/v1/campaigns/${campaign.id}`);
  expect(publicResponse.ok()).toBeTruthy();
  const publicCampaign = (await publicResponse.json()).data;
  expect(publicCampaign).toMatchObject({ id: campaign.id, status: 'OPEN', pickupPoint: { id: point.id }, items: [{ title: productTitle, imageUrl, unitPriceCents: 1250 }] });
  const skuId: string = publicCampaign.items[0].skuId;
  expect((await request.get(`${apiBase}${imageUrl}`)).ok()).toBeTruthy();
  await screenshot('02-same-campaign-open');
  // Consumer calls intentionally simulate the mini-program API client. They
  // are NOT evidence of registration, real WeChat runtime, or real payment.
  const consumer = { 'x-demo-user-id': `flow.consumer.${suffix}`, 'x-demo-role': 'USER' };
  const order = await post<{ id: string; orderNo: string }>(request, '/api/v1/orders', { campaignId: campaign.id, serviceAreaId: area.id, pickupPointId: point.id, items: [{ skuId, quantity: 2 }] }, { ...consumer, 'idempotency-key': `flow-${suffix}` });
  await post(request, `/api/v1/orders/${order.id}/pay/mock-confirm`, undefined, consumer);
  const readOrder = async () => { const r = await request.get(`${apiBase}/api/v1/orders/${order.id}`, { headers: consumer }); expect(r.ok()).toBeTruthy(); return (await r.json()).data; };
  expect(await readOrder()).toMatchObject({ campaignId: campaign.id, status: 'PAID_WAITING_CLOSE', items: [{ skuId, quantity: 2 }] });
  await expect.poll(() => Date.now(), { timeout: 35_000, intervals: [500] }).toBeGreaterThan(cutoffAt);
  await campaignRow.getByRole('button', { name: /截\s*单/ }).click();
  await page.getByRole('button', { name: '立即截单', exact: true }).click();
  await expect(campaignRow.getByRole('button', { name: '生成装袋标签' })).toBeVisible();
  await page.getByRole('menuitem', { name: '发货与运输' }).click();
  const planRow = page.getByRole('row').filter({ hasText: campaignTitle });
  await planRow.getByRole('button', { name: '登记运输信息' }).click();
  await page.getByLabel('承运方').fill('本地测试车队');
  await page.getByLabel('运输单号').fill(`FLOW-${suffix}`);
  await page.getByLabel('司机', { exact: true }).fill('测试司机');
  await page.getByLabel('车牌').fill('京A12345');
  await page.locator('.ant-modal:visible button[type="submit"]').click();
  await planRow.getByRole('button', { name: /确认发车|创建批次并发车/ }).click();
  await page.getByRole('dialog', { name: '发车前复核' }).getByRole('button', { name: '确认发车' }).click();
  await expect(planRow.getByRole('button', { name: /确认发车|创建批次并发车/ })).toHaveCount(0);
  await screenshot('03-operator-dispatched');
  await page.getByRole('button', { name: '打开账号菜单' }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await login(page, `flow.pm.${suffix}`, manager.temporaryPassword);
  await expect(page.getByRole('heading', { name: '到货确认' })).toBeVisible();
  await expect(page.getByRole('button', { name: '紧急代办到货' })).toHaveCount(0);
  await page.getByRole('row').filter({ hasText: campaignTitle }).getByRole('button', { name: '逐商品确认到货' }).click();
  await expect(page.getByLabel('紧急代办原因')).toHaveCount(0);
  await page.getByLabel('现场接收人').fill('本点负责人');
  await page.getByLabel('实到').fill('2');
  await page.getByRole('button', { name: '提交到货确认' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const arrival = mutations.find(m => /\/dispatch-batches\/[^/]+\/arrival$/.test(m.path));
  expect(arrival).toBeDefined();
  expect(arrival!.body.emergencyReason).toBeUndefined();
  expect(arrival!.body.items).toEqual([expect.objectContaining({ catalogSkuId: skuId, receivedQuantity: 2, shortQuantity: 0, damagedQuantity: 0 })]);
  await screenshot('04-manager-normal-arrival');
  const codeResponse = await request.get(`${apiBase}/api/v1/pickup-code?orderId=${order.id}`, { headers: consumer });
  expect(codeResponse.ok()).toBeTruthy();
  const code: string = (await codeResponse.json()).data.code;
  await page.getByRole('menuitem', { name: '领取核销', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '核销自提点' })).toBeEnabled();
  await expect(page.locator('.ant-select')).toContainText(pointName);
  await page.getByPlaceholder('6 位取货码').fill(code);
  await page.getByRole('button', { name: '查找待领取商品' }).click();
  const pickupQuantity = page.getByRole('spinbutton', { name: `${productTitle} · 一份 本次领取数量`, exact: true });
  const pickupRow = page.getByRole('row').filter({ has: pickupQuantity });
  await expect(pickupRow).toContainText(productTitle);
  await expect(pickupRow).toContainText('一份');
  await expect(page.getByRole('columnheader', { name: '到货可领总量', exact: true })).toBeVisible();
  for (const quantity of [1, 2]) {
    await pickupQuantity.fill('1');
    await page.getByRole('button', { name: '确认本次领取' }).click();
    await page.getByRole('dialog', { name: '本次领取复核' }).getByRole('button', { name: '确认提交核销' }).click();
    await expect.poll(async () => (await readOrder()).items[0].pickedUpQuantity).toBe(quantity);
    await screenshot(`05-pickup-${quantity}`);
  }
  await expect(pickupQuantity).toBeDisabled();
  await expect(pickupRow).toContainText(`${productTitle} · 一份`);
  const completed = await readOrder();
  expect(completed).toMatchObject({ id: order.id, campaignId: campaign.id, status: 'PICKED_UP', items: [{ skuId, quantity: 2, pickedUpQuantity: 2 }] });
  expect(mutations.filter(m => m.path === '/api/v1/pickup/verify')).toHaveLength(2);
  expect(mutations.filter(m => m.path === `/api/v1/admin/campaigns/${campaign.id}/open`)).toHaveLength(1);
  expect(failures).toEqual([]);
  await testInfo.attach('same-aggregate-evidence', { body: JSON.stringify({ campaignId: campaign.id, skuId, imageUrl, orderId: order.id, orderNo: order.orderNo, quantity: 2, pickedUpQuantity: 2, status: completed.status, consumer: 'API demo, payment mock; not WeChat runtime' }, null, 2), contentType: 'application/json' });
});
