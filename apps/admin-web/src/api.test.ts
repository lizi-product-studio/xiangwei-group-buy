import { describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('window', { dispatchEvent: vi.fn() });
vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });

const { api } = await import('./api.js');

describe('admin API boundary', () => {
  it('loads operational campaigns through the protected admin endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
    await expect(api.listCampaigns()).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/campaigns');
  });

  it('uses the point-scoped lookup endpoints for pickup verification', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { id: 'order-1', orderNo: 'HT001', deliveryPlanId: 'plan-1', status: 'READY_FOR_PICKUP' } }) });

    await expect(api.listPickupDeliveryPlans()).resolves.toEqual([]);
    await expect(api.lookupPickupOrder('plan-1', 'HT001')).resolves.toMatchObject({ id: 'order-1', orderNo: 'HT001' });

    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/pickup/delivery-plans');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/pickup/orders/lookup?deliveryPlanId=plan-1&orderNo=HT001');
  });

  it('uses only protected verifier-assignment endpoints for list, grant, and revoke', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { userId: 'verifier-1', pickupPointId: 'point-1', active: true, changed: true } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { userId: 'verifier-1', pickupPointId: 'point-1', active: false, changed: true } }) });

    await expect(api.listPickupVerifierAssignments()).resolves.toEqual([]);
    await expect(api.grantPickupVerifier({ userId: 'verifier-1', pickupPointId: 'point-1' })).resolves.toMatchObject({ active: true });
    await expect(api.revokePickupVerifier({ userId: 'verifier-1', pickupPointId: 'point-1' })).resolves.toMatchObject({ active: false });

    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/v1/admin/pickup-verifier-assignments');
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/v1/admin/pickup-verifier-assignments/grant');
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ userId: 'verifier-1', pickupPointId: 'point-1' }) });
    expect(fetchMock.mock.calls[5]?.[0]).toBe('/api/v1/admin/pickup-verifier-assignments/revoke');
  });

  it('uses protected mode-B discrepancy and handover endpoints', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { id: 'handover-1' } }) });
    await expect(api.listPlatformOutboundOrders()).resolves.toEqual([]);
    await expect(api.completePickupHandover('outbound-1', { receivedBy: 'receiver-1', exceptionNote: '现场短少一件', items: [{ platformSkuId: 'sku-1', receivedQuantity: 1, shortQuantity: 1, rejectedQuantity: 0, damagedQuantity: 0, reason: 'TRANSIT_SHORTAGE', evidenceNote: '现场清点照片已登记' }] })).resolves.toMatchObject({ id: 'handover-1' });
    expect(fetchMock.mock.calls[6]?.[0]).toBe('/api/v1/admin/platform/outbound-orders');
    expect(fetchMock.mock.calls[7]?.[0]).toBe('/api/v1/admin/platform/outbound/outbound-1/handover');
    expect(fetchMock.mock.calls[7]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('posts a text-only community arrival confirmation even when a stale caller carries evidenceUrl', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { id: 'community-arrival-1' } }) });
    const stalePayload = {
      receivedBy: '点位负责人',
      confirmationNote: '现场逐商品清点完成',
      emergencyReason: null,
      items: [{ platformSkuId: 'sku-1', receivedQuantity: 2, rejectedQuantity: 0, shortQuantity: 0, damagedQuantity: 0, reason: null, evidenceNote: null, evidenceUrl: null }],
    } as unknown as Parameters<typeof api.confirmCommunityArrival>[1];

    await expect(api.confirmCommunityArrival('dispatch-batch-1', stalePayload)).resolves.toMatchObject({ id: 'community-arrival-1' });

    const request = fetchMock.mock.calls[8]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ receivedBy: '点位负责人', items: [{ platformSkuId: 'sku-1', evidenceNote: null }] });
    expect(JSON.stringify(body)).not.toContain('evidenceUrl');
  });

  it('posts each supplier receipt batch to the protected replenishment endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { id: 'receipt-2' } }) });
    await expect(api.receivePurchaseOrder('purchase-order-1', { items: [{ purchaseOrderItemId: 'line-1', acceptedQuantity: 2, rejectedQuantity: 0, batchNo: 'LOT-2', productionDate: null, expiresAt: null, inspectionNote: 'replenishment accepted', evidenceUrl: null }] })).resolves.toMatchObject({ id: 'receipt-2' });
    expect(fetchMock.mock.calls[9]?.[0]).toBe('/api/v1/admin/platform/purchase-orders/purchase-order-1/receive');
    expect(fetchMock.mock.calls[9]?.[1]).toMatchObject({ method: 'POST' });
  });
});
