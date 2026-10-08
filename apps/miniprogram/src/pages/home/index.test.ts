import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadServiceAreaContext } from '../../utils/service-area';
import { loadPickupPoints } from '../../utils/pickup-point';

type HomePage = {
  data: Record<string, unknown>;
  setData?: (patch: Record<string, unknown>) => void;
  loadCampaigns: () => Promise<void>;
  openPickupLocation: () => void;
  callPickupPoint: () => void;
};

const listCampaigns = vi.fn();
const listProductCategories = vi.fn();
const openLocation = vi.fn();
const makePhoneCall = vi.fn();
const showToast = vi.fn();

vi.mock('../../utils/api', () => ({
  api: { listCampaigns, listProductCategories },
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
  loadPickupPoints: vi.fn(async () => ({
    points: [{ id: 'point-1', serviceAreaId: 'area-1', name: '示例自提点', address: '示例地址', businessHours: '', pickupInstructions: '', latitude: 0, longitude: 0, contactName: '', contactPhone: '', status: 'ACTIVE', capacityPerDay: null }],
    selected: { id: 'point-1', serviceAreaId: 'area-1', name: '示例自提点', address: '示例地址', businessHours: '', pickupInstructions: '', latitude: 0, longitude: 0, contactName: '', contactPhone: '', status: 'ACTIVE', capacityPerDay: null },
  })),
}));
vi.mock('../../utils/cart', () => ({
  cartCount: vi.fn(() => 0),
}));
vi.mock('../../utils/consumer-display', () => ({
  estimatedArrivalText: vi.fn(() => '09月02日 08:00'),
  formatChinaDateTime: vi.fn((value: string) => value.startsWith('2099-09-03') ? '09月03日 12:00' : '09月01日 12:00'),
  cutoffCountdown: vi.fn(() => '剩余测试倒计时'),
  campaignProgressPercent: (paid: number, minimum: number) => minimum <= 0 ? 100 : Math.min(100, Math.round((Math.max(0, paid) / minimum) * 100)),
  isCampaignPurchasable: vi.fn(() => true),
  shouldShowFloatingCart: vi.fn(() => false),
}));

describe('home remote-service recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    listCampaigns.mockReset();
    listProductCategories.mockReset().mockResolvedValue([{ id: 'vegetables', name: '蔬菜', iconKey: 'leaf' }, { id: 'fresh', name: '鲜食', iconKey: 'basket' }]);
    openLocation.mockReset();
    makePhoneCall.mockReset();
    showToast.mockReset();
    vi.mocked(loadPickupPoints).mockReset().mockResolvedValue({
      points: [{ id: 'point-1', serviceAreaId: 'area-1', name: '示例自提点', address: '示例地址', businessHours: '', pickupInstructions: '', latitude: 0, longitude: 0, contactName: '', contactPhone: '', status: 'ACTIVE', capacityPerDay: null }],
      selected: { id: 'point-1', serviceAreaId: 'area-1', name: '示例自提点', address: '示例地址', businessHours: '', pickupInstructions: '', latitude: 0, longitude: 0, contactName: '', contactPhone: '', status: 'ACTIVE', capacityPerDay: null },
    });
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn(),
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
      stopPullDownRefresh: vi.fn(),
      showToast,
      openLocation,
      makePhoneCall,
    });
    vi.stubGlobal('getApp', () => ({ globalData: { apiBaseUrl: 'https://example.test' } }));
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
      description: '雨后采收，口感清甜。',
      imageUrl: null,
      imageUrls: [],
      unitPriceCents: 100,
      stock: 10,
      soldQuantity: 0,
    }, {
      skuId: 'sku-2',
      title: '鲜玉米',
      category: '鲜食',
      origin: '本地',
      skuName: '四根一份',
      description: '本地鲜食，按本团统一备货。',
      imageUrl: '/api/v1/product-images/corn.webp',
      imageUrls: ['/api/v1/product-images/corn.webp', '/api/v1/product-images/corn-detail.webp', '/api/v1/product-images/corn.webp', '/api/v1/product-images/corn-field.webp', '/api/v1/product-images/corn-back.webp', '/api/v1/product-images/ignored.webp'],
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
    expect(page.data.heroCampaign).toBeNull();
  });

  it('shows the latest pickup-point name returned by the server', async () => {
    listCampaigns.mockResolvedValueOnce([]);
    vi.mocked(loadPickupPoints).mockResolvedValueOnce({
      points: [{ id: 'point-1', serviceAreaId: 'area-1', name: '后台改名后的自提点', address: '最新地址', businessHours: '', pickupInstructions: '', latitude: 0, longitude: 0, contactName: '', contactPhone: '', status: 'ACTIVE', capacityPerDay: null }],
      selected: { id: 'point-1', serviceAreaId: 'area-1', name: '后台改名后的自提点', address: '最新地址', businessHours: '', pickupInstructions: '', latitude: 0, longitude: 0, contactName: '', contactPhone: '', status: 'ACTIVE', capacityPerDay: null },
    });
    const page = await loadPage();

    await page.loadCampaigns.call(page);

    expect(page.data.pickupPoint).toMatchObject({ name: '后台改名后的自提点', address: '最新地址' });
  });

  it('shows enabled backend categories even before they have products in this campaign', async () => {
    listCampaigns.mockResolvedValueOnce([]);
    listProductCategories.mockResolvedValueOnce([{ id: 'fruit', name: '水果', iconKey: 'fruit' }, { id: 'tools', name: '工具', iconKey: 'tools' }]);
    const page = await loadPage();
    await page.loadCampaigns.call(page);
    expect(page.data.allProducts).toEqual([]);
    expect(page.data.categoryItems).toMatchObject([
      { value: '全部' }, { value: '水果' }, { value: '工具' },
    ]);
  });

  it('uses live descriptions, real category icons, and the selected point campaign schedule in the home view', async () => {
    listCampaigns.mockResolvedValueOnce([campaign]);
    const page = await loadPage();
    await page.loadCampaigns.call(page);

    expect((page.data.allProducts as Array<{ description: string }>)[0]?.description).toBe('雨后采收，口感清甜。');
    expect(page.data.categoryItems).toMatchObject([
      { value: '全部', icon: '/assets/category-icon-all.png' },
      { value: '蔬菜', icon: '/assets/category-icon-leaf.png' },
      { value: '鲜食', icon: '/assets/category-icon-basket.png' },
    ]);
    expect(page.data.heroCampaign).toMatchObject({
      title: '应季蔬菜团',
      cutoffAt: campaign.cutoffAt,
      cutoffText: '09月01日 12:00',
      arrivalText: '09月02日 08:00',
    });
    expect(page.data.countdownText).toBe('剩余测试倒计时');
  });

  it('keeps campaigns at the same pickup point in separate period groups with independent schedules and progress', async () => {
    const secondCampaign = {
      ...campaign,
      id: 'campaign-2',
      title: '鲜食专场 · 第03期',
      cutoffAt: '2099-09-03T00:00:00.000Z',
      estimatedArrivalStartAt: '2099-09-04T00:00:00.000Z',
      estimatedArrivalEndAt: '2099-09-04T06:00:00.000Z',
      paidQuantity: 8,
      minTotalQuantity: 5,
      items: [campaign.items[1]!],
    } as CampaignDto;
    listCampaigns.mockResolvedValueOnce([campaign, secondCampaign]);
    const page = await loadPage();

    await page.loadCampaigns.call(page);

    expect(page.data.campaignGroups).toMatchObject([
      { id: 'campaign-1', title: '应季蔬菜团', cutoffText: '09月01日 12:00', paidQuantity: 0, minimumQuantity: 1, products: [{ skuId: 'sku-1' }, { skuId: 'sku-2' }] },
      { id: 'campaign-2', title: '鲜食专场 · 第03期', cutoffText: '09月03日 12:00', paidQuantity: 8, minimumQuantity: 5, products: [{ skuId: 'sku-2' }] },
    ]);
    expect(page.data.campaignGroups).toHaveLength(2);
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
    expect((page.data.campaigns as Array<{ imageUrls: string[] }>).map((item) => item.imageUrls)).toEqual([
      [],
      [
        'https://example.test/api/v1/product-images/corn.webp',
        'https://example.test/api/v1/product-images/corn-detail.webp',
        'https://example.test/api/v1/product-images/corn-field.webp',
        'https://example.test/api/v1/product-images/corn-back.webp',
        'https://example.test/api/v1/product-images/ignored.webp',
      ],
    ]);
  });

  it('uses the latest selected point for its photo, address, navigation, and phone actions', async () => {
    listCampaigns.mockResolvedValueOnce([]);
    const latestPoint = { id: 'point-2', serviceAreaId: 'area-1', name: '更新后的点位', address: '更新后的地址', photoUrl: '/api/v1/pickup-point-images/point-2.webp', businessHours: '', pickupInstructions: '', latitude: 39.3, longitude: 115.6, contactName: '', contactPhone: '13800000000', status: 'ACTIVE' as const, capacityPerDay: null };
    vi.mocked(loadPickupPoints).mockResolvedValueOnce({ points: [latestPoint], selected: latestPoint });
    const page = await loadPage();
    await page.loadCampaigns.call(page);
    expect(page.data.pickupPoint).toMatchObject({ id: 'point-2', name: '更新后的点位', address: '更新后的地址', photoUrl: '/api/v1/pickup-point-images/point-2.webp' });
    page.openPickupLocation.call(page);
    page.callPickupPoint.call(page);
    expect(openLocation).toHaveBeenCalledWith(expect.objectContaining({ latitude: 39.3, longitude: 115.6, name: '更新后的点位', address: '更新后的地址' }));
    expect(makePhoneCall).toHaveBeenCalledWith({ phoneNumber: '13800000000' });
    expect(showToast).not.toHaveBeenCalled();
  });

});
