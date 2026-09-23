import { beforeEach, describe, expect, it, vi } from 'vitest';

type CartPage = {
  data: Record<string, unknown>;
  setData: (patch: Record<string, unknown>) => void;
  refresh: () => void;
  openPickup: () => void;
};

describe('empty cart pickup context', () => {
  const storage = new Map<string, unknown>();
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    const navigateTo = vi.fn(() => Promise.resolve());
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      navigateTo,
      showModal: vi.fn(),
    });
    vi.stubGlobal('getApp', () => ({ globalData: { apiBaseUrl: 'http://127.0.0.1:3100', authMode: 'demo', demoLoginEnabled: true, accessToken: null, subscriptionTemplates: [] } }));
    vi.stubGlobal('Page', (definition: CartPage) => definition);
  });

  it('shows the current saved point even when the cart has no items', async () => {
    const point = {
      id: 'point-1', serviceAreaId: 'area-1', name: '松林社区自提点', address: '松林路 8 号',
      businessHours: '', pickupInstructions: '', latitude: 39.2, longitude: 115.4,
      contactName: '', contactPhone: '', status: 'ACTIVE', capacityPerDay: null,
    };
    storage.set('selectedPickupPoint', point);
    let page: CartPage | undefined;
    vi.stubGlobal('Page', (definition: CartPage) => { page = definition; return definition; });
    await import('./index');
    page!.setData = (patch) => Object.assign(page!.data, patch);
    page!.refresh.call(page);
    expect(page!.data.cart).toBeNull();
    expect(page!.data.pickupPoint).toMatchObject({ name: '松林社区自提点', address: '松林路 8 号' });
  });
});
