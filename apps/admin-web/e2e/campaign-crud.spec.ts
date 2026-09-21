import { expect, test, type APIRequestContext } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3101';
const bootstrap = { 'x-demo-user-id': 'demo-super-admin', 'x-demo-role': 'SUPER_ADMIN' };
async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${apiBase}${path}`, { headers: bootstrap, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).data as T;
}
const inputTime = (offset: number) => {
  const date = new Date(Date.now() + offset); const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

test('网页草稿过期恢复、编辑开售、无引用删除与消费者只读查询', async ({ page, request }, testInfo) => {
  const suffix = String(Date.now());
  const title = `CRUD恢复 ${suffix}`;
  const deleteTitle = `CRUD删除 ${suffix}`;
  const staff = await post<{ temporaryPassword: string }>(request, '/api/v1/admin/staff', {
    displayName: '本地CRUD验收', username: `crud.${suffix}`, phone: `138${suffix.slice(-8)}`, role: 'SUPER_ADMIN', pickupPointIds: [],
  });
  const area = await post<{ id: string }>(request, '/api/v1/admin/service-areas', { regionCode: '110101' });
  await post(request, `/api/v1/admin/service-areas/${area.id}/order-status`, { orderEnabled: true });
  const point = await post<{ id: string }>(request, '/api/v1/admin/pickup-points', {
    serviceAreaId: area.id, name: `CRUD点位 ${suffix}`, address: '东城区社区服务站 99 号', businessHours: '09:00-20:00', pickupInstructions: '出示取货码', latitude: 39.9042, longitude: 116.4074, contactName: '本地负责人', contactPhone: '13800138000', capacityPerDay: 100,
  });
  const productTitle = `CRUD蔬菜 ${suffix}`;
  const sku = await post<{ id: string }>(request, '/api/v1/admin/catalog/skus', {
    title: productTitle, category: '蔬菜', origin: '本地', imageUrl: null, skuName: '一份', retailPriceCents: 1500, defaultSellableQuantity: 40, status: 'ACTIVE',
  });
  const draft = (campaignTitle: string, cutoffOffset: number) => post<{ id: string }>(request, '/api/v1/admin/campaigns', {
    title: campaignTitle, serviceAreaId: area.id, pickupPointId: point.id,
    cutoffAt: new Date(Date.now() + cutoffOffset).toISOString(), dispatchAt: new Date(Date.now() + 3_600_000).toISOString(),
    estimatedArrivalStartAt: new Date(Date.now() + 7_200_000).toISOString(), estimatedArrivalEndAt: new Date(Date.now() + 10_800_000).toISOString(),
    minTotalQuantity: 1, failureAction: 'CANCEL_AND_REFUND', items: [{ catalogSkuId: sku.id, retailPriceCents: 1500, sellableQuantity: 40 }],
  });
  const expired = await draft(title, 1000);
  const removable = await draft(deleteTitle, 3_000_000);
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto('/');
  await page.getByLabel('账号').fill(`crud.${suffix}`);
  await page.getByLabel('密码').fill(staff.temporaryPassword);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await page.getByLabel('新密码', { exact: true }).fill('local crud browser password');
  await page.getByLabel('确认新密码').fill('local crud browser password');
  await page.getByRole('button', { name: '保存新密码' }).click();
  await page.getByRole('menuitem', { name: '团期管理' }).click();
  await page.getByLabel('团期关键词').fill(title);
  const row = page.getByRole('row').filter({ hasText: title });
  await row.getByRole('button', { name: /开\s*售/ }).click();
  const openReview = page.getByRole('dialog', { name: '开售前二次确认' });
  await expect(openReview.getByRole('button', { name: '已复核，确认开售' })).toBeDisabled();
  await expect(openReview).toContainText('截单时间已过');
  await openReview.getByRole('button', { name: '编辑草稿' }).click();
  const editor = page.getByRole('dialog', { name: '编辑草稿团期' });
  await expect(editor.getByLabel('团期名称')).toHaveValue(title);
  await expect(editor.getByLabel('本团售价（元）')).toHaveValue('15.00');
  await expect(editor.getByLabel('可售量')).toHaveValue('40');
  await expect(editor).toContainText(productTitle);
  await editor.getByLabel('截单时间').fill(inputTime(1_800_000));
  await editor.getByLabel('计划发车时间').fill(inputTime(3_600_000));
  await editor.getByLabel(/预计到货时段.*开始/).fill(inputTime(7_200_000));
  await editor.getByLabel(/预计到货时段.*结束/).fill(inputTime(10_800_000));
  await editor.getByLabel('本团售价（元）').fill('16.50');
  await editor.getByRole('button', { name: '下一步：发布复核' }).click();
  const updated = page.waitForResponse(response => response.url().endsWith(`/api/v1/admin/campaigns/${expired.id}`) && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: '确认保存草稿' }).click();
  const updateResponse = await updated;
  expect(updateResponse.ok(), await updateResponse.text()).toBeTruthy();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await row.getByRole('button', { name: /开\s*售/ }).click();
  await openReview.getByRole('button', { name: '已复核，确认开售' }).click();
  await expect(row.getByText('开售中', { exact: true })).toBeVisible();
  const publicResponse = await request.get(`${apiBase}/api/v1/campaigns/${expired.id}`);
  expect(publicResponse.ok()).toBeTruthy();
  expect((await publicResponse.json()).data).toMatchObject({ id: expired.id, status: 'OPEN', items: [{ skuId: sku.id, unitPriceCents: 1650 }] });
  await page.getByLabel('团期关键词').fill(deleteTitle);
  const deleteRow = page.getByRole('row').filter({ hasText: deleteTitle });
  await deleteRow.getByRole('button', { name: /更\s*多/ }).click();
  await page.getByRole('menuitem', { name: '删除草稿' }).click();
  const deleteReview = page.getByRole('dialog', { name: '删除草稿团期' });
  await expect(deleteReview).toContainText(deleteTitle);
  const deleted = page.waitForResponse(response => response.url().endsWith(`/api/v1/admin/campaigns/${removable.id}`) && response.request().method() === 'DELETE');
  await deleteReview.getByRole('button', { name: '确认删除' }).click();
  expect((await deleted).ok()).toBeTruthy();
  await expect(deleteRow).toHaveCount(0);
  await expect(deleteReview).not.toBeVisible();
  // Default E2E has no persisted phone-bound consumers. Verify the real
  // empty/search query here; populated masked details are covered by API tests.
  const listed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/consumers');
  await page.getByRole('menuitem', { name: '用户管理' }).click();
  const listResponse = await listed;
  expect(listResponse.ok()).toBeTruthy();
  expect((await listResponse.json()).data).toMatchObject({ page: 1, pageSize: 20 });
  expect(new URL(listResponse.url()).searchParams.get('page')).toBe('1');
  expect(new URL(listResponse.url()).searchParams.get('pageSize')).toBe('20');
  await expect(page.getByRole('heading', { name: '消费者', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '手机号（脱敏）' })).toBeVisible();
  await expect(page.getByRole('button', { name: /新增消费者|删除消费者|编辑消费者/ })).toHaveCount(0);
  const search = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/consumers' && new URL(response.url()).searchParams.get('query') === `absent-${suffix}`);
  await page.getByLabel('搜索消费者').fill(`absent-${suffix}`);
  await page.getByRole('button', { name: /^搜\s*索$/ }).click();
  const searchResponse = await search;
  expect(searchResponse.ok()).toBeTruthy();
  expect((await searchResponse.json()).data).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 });
  await expect(page.getByText('没有匹配的消费者')).toBeVisible();
  const screenshot = testInfo.outputPath('crud-consumers.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('CRUD消费者查询', { path: screenshot, contentType: 'image/png' });
  expect(failures).toEqual([]);
});
