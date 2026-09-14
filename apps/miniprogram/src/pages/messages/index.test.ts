import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationType, SubscriptionTemplate } from '../../config/deployment';
const templates: SubscriptionTemplate[] = [
  { type: 'SITE_CONFIRMED', templateId: 'site' }, { type: 'CAMPAIGN_POSTPONED', templateId: 'site' }, { type: 'PICKUP_EXPIRED', templateId: 'site' },
  { type: 'VEHICLE_DISPATCHED', templateId: 'dispatch' }, { type: 'ARRIVED', templateId: 'arrival' }, { type: 'PICKUP_DEADLINE', templateId: 'deadline' }, { type: 'PARTIAL_REFUND', templateId: 'refund' },
];
type TestPage = { data: { cycleRequestedTypes: NotificationType[]; enableLabel: string; enabling: boolean; subscriptionComplete: boolean; subscriptionOutcome: string }; setData: (patch: Record<string, unknown>) => void; onShow: () => void; onHide: () => void; load: () => Promise<void>; enable: () => Promise<void> };
beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('../../utils/api'); });
async function fixture() {
  let epoch = 1;
  let preferences: { types: NotificationType[]; templateIds?: Record<string, string> } = { types: templates.map((x) => x.type) }; // legacy, no IDs
  const save = vi.fn(async (types: NotificationType[], templateIds: Record<string, string>) => { preferences = { types, templateIds }; });
  vi.doMock('../../utils/api', () => ({
    api: { listNotifications: async () => [], getNotificationPreferences: async () => preferences, saveNotificationPreferences: save },
    customerAuth: { isLoggedIn: () => true, captureSessionEpoch: () => epoch },
    AuthExpiredError: class extends Error {}, customerErrorMessage: (_error: unknown, fallback: string) => fallback,
  }));
  const requestSubscribeMessage = vi.fn((options: { tmplIds: string[]; success: (value: Record<string, string>) => void }) => options.success(Object.fromEntries(options.tmplIds.map((id) => [id, 'accept']))));
  vi.stubGlobal('getApp', () => ({ globalData: { subscriptionTemplates: templates } }));
  vi.stubGlobal('wx', { requestSubscribeMessage, showToast: vi.fn() });
  let page!: TestPage;
  vi.stubGlobal('Page', (definition: TestPage) => { page = definition; });
  await import('./index');
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onShow(); await page.load();
  return { page, requestSubscribeMessage, save, switchAccount: () => { epoch++; page.onShow(); } };
}
describe('message page explicit five-template subscriptions', () => {
  it('requests 3 then 2 templates, binds only accepted IDs and finishes the current cycle', async () => {
    const { page, requestSubscribeMessage, save } = await fixture();
    await page.enable(); expect(requestSubscribeMessage.mock.calls[0]![0].tmplIds).toEqual(['site', 'dispatch', 'arrival']);
    expect(save.mock.calls[0]![0]).not.toContain('PICKUP_DEADLINE'); // old accepted types cannot grant the new ID
    await page.enable(); expect(requestSubscribeMessage.mock.calls[1]![0].tmplIds).toEqual(['deadline', 'refund']);
    expect(page.data.enableLabel).toBe('本次已完成');
    expect(page.data.subscriptionComplete).toBe(true);
    await page.enable(); expect(requestSubscribeMessage).toHaveBeenCalledTimes(2);
  });
  it('advances after rejection without fabricating accepted preferences', async () => {
    const { page, requestSubscribeMessage, save } = await fixture();
    requestSubscribeMessage.mockImplementationOnce((options) => options.success(Object.fromEntries(options.tmplIds.map((id) => [id, 'reject']))));
    await page.enable(); expect(save.mock.calls[0]![0]).toEqual([]);
    await page.enable(); expect(requestSubscribeMessage.mock.calls[1]![0].tmplIds).toEqual(['deadline', 'refund']);
  });
  it('does not save a delayed result after hiding, and clears per-account progress', async () => {
    const { page, requestSubscribeMessage, save, switchAccount } = await fixture();
    let deliver!: (value: Record<string, string>) => void;
    requestSubscribeMessage.mockImplementationOnce((options) => { deliver = options.success; });
    const pending = page.enable(); await Promise.resolve(); await Promise.resolve();
    page.onHide(); deliver({ site: 'accept' }); await pending; expect(save).not.toHaveBeenCalled();
    switchAccount(); await page.load(); expect(page.data.cycleRequestedTypes).toEqual([]); expect(page.data.subscriptionComplete).toBe(false);
  });
});
