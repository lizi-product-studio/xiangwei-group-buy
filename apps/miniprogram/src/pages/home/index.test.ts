import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadServiceAreaContext } from '../../utils/service-area';
import { readPickupPointSelection } from '../../utils/pickup-point';

type HomePage = {
  data: Record<string, unknown>;
  setData?: (patch: Record<string, unknown>) => void;
  loadCampaigns: () => Promise<void>;
};

const listCampaigns = vi.fn();

vi.mock('../../utils/api', () => ({
  api: { listCampaigns },
  customerErrorMessage: (error: unknown) =>
    error instanceof Error && error.message.includes('HTTP')
      ? '服务暂时不可用，请稍后重试'
      : '商品加载失败，请稍后重试',
}));
vi.mock('../../utils/service-area', () => ({
  loadServiceAreaContext: vi.fn(async () => ({
    areas: [],
    selected: { id: 'area-1', name: '示例区域', regionCode: 'CN-1', orderEnabled: true },
  })),
}));
vi.mock('../../utils/pickup-point', () => ({
  readPickupPointSelection: vi.fn(() => ({
    id: 'point-1',
    serviceAreaId: 'area-1',
    name: '示例自提点',
    address: '示例地址',
    status: 'ACTIVE',
  })),
}));
vi.mock('../../utils/cart', () => ({
  cartCount: vi.fn(() => 0),
}));
vi.mock('../../utils/consumer-display', () => ({
  estimatedArrivalText: vi.fn(() => '09月02日 08:00'),
  formatChinaDateTime: vi.fn(() => '09月01日 12:00'),
  isCampaignPurchasable: vi.fn(() => true),
  shouldShowFloatingCart: vi.fn(() => false),
}));

describe('home remote-service recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    listCampaigns.mockReset();
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn(),
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
      stopPullDownRefresh: vi.fn(),
    });
  });

  async function loadPage(): Promise<HomePage> {
    let page: HomePage | undefined;
    vi.stubGlobal('Page', (definition: HomePage) => {
      page = definition;
      return definition;
    });
    await import('./index');
    if (!page) throw new Error('home page was not registered');
    page.setData = (patch) => Object.assign(page!.data, patch);
    return page;
  }

  const campaign = {
    id: 'campaign-1',
    title: '应季蔬菜团',
    serviceAreaId: 'area-1',
    deliveryPlan: { pickupPointId: 'point-1' },
    pickupPoint: null,
    cutoffAt: '2099-09-01T00:00:00.000Z',
    dispatchAt: '2099-09-01T01:00:00.000Z',
    estimatedArrivalStartAt: '2099-09-02T00:00:00.000Z',
    estimatedArrivalEndAt: '2099-09-02T06:00:00.000Z',
    paidQuantity: 0,
    failureAction: 'CANCEL_AND_REFUND',
    minTotalQuantity: 1,
    status: 'OPEN',
    items: [{
      skuId: 'sku-1',
      title: '应季蔬菜',
      category: '蔬菜',
      origin: '本地',
      skuName: '一份',
      imageUrl: null,
      unitPriceCents: 100,
      stock: 10,
      soldQuantity: 0,
    }, {
      skuId: 'sku-2',
      title: '鲜玉米',
      category: '鲜食',
      origin: '本地',
      skuName: '四根一份',
      imageUrl: '/api/v1/product-images/corn.webp',
      unitPriceCents: 200,
      stock: 10,
      soldQuantity: 0,
    }],
  } as CampaignDto;

  it('shows a recoverable remote-service error instead of an empty table, then reloads on retry', async () => {
    listCampaigns.mockRejectedValueOnce(new Error('HTTP 503 https://liziqi.icu/api/v1/campaigns'));
    const page = await loadPage();

    await page.loadCampaigns.call(page);

    expect(page.data.error).toBe('服务暂时不可用，请稍后重试');
    expect(page.data.campaigns).toEqual([]);
    expect(page.data.loading).toBe(false);

    listCampaigns.mockResolvedValueOnce([campaign]);
    await page.loadCampaigns.call(page);

    expect(listCampaigns).toHaveBeenCalledTimes(2);
    expect(page.data.error).toBe('');
    expect(page.data.campaigns).toHaveLength(2);
    expect(page.data.loading).toBe(false);
  });
  it('distinguishes unavailable service from a selected point awaiting its next campaign', async () => {
    listCampaigns.mockResolvedValue([]);
    vi.mocked(loadServiceAreaContext).mockResolvedValueOnce({ areas: [], selected: null });
    vi.mocked(readPickupPointSelection).mockReturnValueOnce(null);
    const page = await loadPage();
    await page.loadCampaigns.call(page);
    expect(page.data.availableAreaCount).toBe(0);
    expect(page.data.area).toBeNull();
    expect(page.data.pickupPoint).toBeNull();

    const area = { id: 'area-1', name: '示例区域', regionCode: 'CN-1', orderEnabled: true } as ServiceAreaDto;
    vi.mocked(loadServiceAreaContext).mockResolvedValueOnce({ areas: [area], selected: area });
    await page.loadCampaigns.call(page);
    expect(page.data.availableAreaCount).toBe(1);
    expect(page.data.allProducts).toEqual([]);
    expect(page.data.deliveryText).toBe('本期好物正在筹备，开团后即可选购');
    expect(page.data.pickupPoint).toMatchObject({ id: 'point-1' });
  });

  it('refreshes image bindings when switching a filtered category back to all products', async () => {
    listCampaigns.mockResolvedValueOnce([campaign]);
    const page = await loadPage();
    await page.loadCampaigns.call(page);
    const firstRefreshKey = page.data.imageRefreshKey;
    const changeCategory = (page as unknown as { changeCategory: (event: unknown) => void }).changeCategory;

    changeCategory.call(page, { currentTarget: { dataset: { category: '鲜食' } } });
    expect(page.data.campaigns).toHaveLength(1);
    expect((page.data.campaigns as Array<{ category: string }>)[0]?.category).toBe('鲜食');
    const filteredRefreshKey = page.data.imageRefreshKey;
    expect(filteredRefreshKey).toBe((firstRefreshKey as number) + 1);

    changeCategory.call(page, { currentTarget: { dataset: { category: '全部' } } });
    expect(page.data.campaigns).toHaveLength(2);
    expect(page.data.imageRefreshKey).toBe((filteredRefreshKey as number) + 1);
    expect((page.data.campaigns as Array<{ imageUrl: string | null }>).map((item) => item.imageUrl)).toEqual([
      null,
      '/api/v1/product-images/corn.webp',
    ]);
  });

});
