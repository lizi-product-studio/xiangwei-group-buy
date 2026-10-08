import { expect, type APIRequestContext, type Page } from '@playwright/test';
const sample = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4EGQERAwQCgArtgXRlFwMYgAAAABJRU5ErkJggg==', 'base64');
let sharedUpload: Promise<string> | null = null;
export async function fixturePhoto(request: APIRequestContext): Promise<string> {
  if (!sharedUpload) {
    const apiBase = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3101';
    sharedUpload = request.post(`${apiBase}/api/v1/admin/product-images`, {
      headers: { 'x-demo-user-id': 'demo-super-admin', 'x-demo-role': 'SUPER_ADMIN', 'content-type': 'image/png' }, data: sample,
    }).then(async (response) => {
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()).data.imageUrl as string;
    }).catch((error) => {
      sharedUpload = null;
      throw error;
    });
  }
  return sharedUpload;
}
export async function uploadPointPhoto(page: Page) {
  const uploaded = page.waitForResponse(response => response.url().endsWith('/api/v1/admin/product-images') && response.request().method() === 'POST');
  await page.getByLabel('上传自提点照片').setInputFiles({ name: 'pickup.png', mimeType: 'image/png', buffer: sample });
  const response = await uploaded;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.getByRole('button', { name: '更换自提点照片' })).toBeVisible();
}
