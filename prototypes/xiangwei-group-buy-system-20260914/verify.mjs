import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PROTOTYPE_PLAYWRIGHT_PATH || 'playwright');
const origin = process.env.PROTOTYPE_URL || 'http://127.0.0.1:8765';
const output = process.env.PROTOTYPE_EVIDENCE_DIR;
assert.ok(output, 'Set PROTOTYPE_EVIDENCE_DIR to an external evidence directory.');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const results = [];
page.on('pageerror', error => errors.push(error.message));
const record = (name, details) => results.push({ name, ...details });
async function layout(name, selector = 'body') {
  const size = await page.locator(selector).evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  assert.ok(size.scroll <= size.client + 2, `${name}: horizontal overflow ${size.scroll}/${size.client}`);
  record(name, size);
}
try {
  await page.goto(`${origin}/miniprogram/`);
  const screens = await page.locator('[data-screen]').evaluateAll(els => els.map(el => el.dataset.screen));
  assert.ok(screens.length >= 30, 'Existing mini screens must remain available.');
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 932 });
    for (const screen of screens) {
      await page.goto(`${origin}/miniprogram/?screen=${screen}`);
      await layout(`mini ${width} ${screen}`);
      await layout(`mini content ${width} ${screen}`, '#screen');
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (const screen of ['home', 'profile', 'login', 'pickup', 'order-pick', 'order-fail']) {
    await page.goto(`${origin}/miniprogram/?screen=${screen}`);
    await page.locator('#device').screenshot({ path: path.join(output, `mini-${screen}.png`) });
  }
  await page.goto(`${origin}/admin/`);
  await page.locator('#login-user').fill('preview');
  await page.locator('#login-pass').fill('preview-password');
  await page.locator('#login-role').selectOption('SUPER_ADMIN');
  await page.locator('#login-form').evaluate(form => form.requestSubmit());
  await page.locator('.shell').waitFor();
  for (const role of ['SUPER_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE', 'FINANCE', 'PICKUP_MANAGER']) {
    await page.locator('[data-act="role"]').selectOption(role);
    const keys = await page.locator('.nav [data-page]').evaluateAll(els => els.map(el => el.dataset.page));
    if (role === 'OPERATOR') {
      assert.ok(!keys.includes('consumers') && !keys.some(k => k.startsWith('finance-')), 'Operator menu must not expand data/finance permissions.');
      assert.ok(keys.includes('interests'), 'Regional interests remain reachable.');
    }
    if (role === 'FINANCE') {
      assert.ok(keys.includes('orders') && !keys.includes('refund-confirm'), 'Retain finance order query; do not expose operational decision.');
    }
    if (role === 'PICKUP_MANAGER') assert.ok(keys.every(k => k.startsWith('point-')));
    record(`role ${role}`, { keys });
    for (const key of keys) {
      await page.evaluate(key => { location.hash = `#/${key}`; }, key);
      await page.waitForTimeout(30);
      await layout(`admin ${role} ${key}`);
    }
  }
  await page.locator('[data-act="role"]').selectOption('OPERATOR');
  for (const width of [375, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(50);
    await layout(`admin viewport ${width}`);
    await page.screenshot({ path: path.join(output, `admin-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, [], 'Browser runtime errors');
  await writeFile(path.join(output, 'verification.json'), JSON.stringify({ status: 'PASS', results, errors }, null, 2));
  console.log(`PASS: ${results.length} layout/role checks; ${screens.length} mini screens; no page errors.`);
} catch (error) {
  await writeFile(path.join(output, 'verification.json'), JSON.stringify({ status: 'FAIL', error: error.message, results, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
