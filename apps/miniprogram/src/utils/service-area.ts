import { api } from './api';
import { clearPickupPointSelection, readPickupPointSelection } from './pickup-point';
import { clearCart, clearCheckoutDraft } from './cart';

const SERVICE_AREA_STORAGE_KEY = 'selectedServiceArea';

export type ServiceAreaSelection = ServiceAreaDto;

function isStoredArea(value: unknown): value is ServiceAreaSelection {
  if (!value || typeof value !== 'object') return false;
  const area = value as Partial<ServiceAreaSelection>;
  return typeof area.id === 'string' && typeof area.name === 'string' && typeof area.regionCode === 'string';
}

export function readServiceAreaSelection(): ServiceAreaSelection | null {
  const value: unknown = wx.getStorageSync(SERVICE_AREA_STORAGE_KEY);
  return isStoredArea(value) ? value : null;
}

export function saveServiceAreaSelection(area: ServiceAreaSelection): void {
  wx.setStorageSync(SERVICE_AREA_STORAGE_KEY, area);
}

export function clearServiceAreaSelection(): void {
  wx.removeStorageSync(SERVICE_AREA_STORAGE_KEY);
}

export async function loadServiceAreaContext(allowedAreaId?: string): Promise<{
  areas: ServiceAreaSelection[];
  selected: ServiceAreaSelection | null;
  /** Present when a previously stored selection was removed by the server. */
  selectionWasInvalidated?: boolean;
}> {
  const enabledAreas = (await api.listServiceAreas()).filter((area) => area.orderEnabled);
  const areas = enabledAreas.filter((area) => !allowedAreaId || area.id === allowedAreaId);
  const stored = readServiceAreaSelection();
  const selected = areas.find((area) => area.id === stored?.id) ?? null;
  // A pickup point cannot outlive its service area.  This also catches an
  // interrupted old client where the area key was already gone but its point
  // and cart were still stored locally.
  // A campaign's area filter is not evidence that the saved area was removed.
  const storedAreaAvailable = enabledAreas.some((area) => area.id === stored?.id);
  const selectionWasInvalidated = Boolean((stored && !storedAreaAvailable) || (!stored && readPickupPointSelection()));
  if (selectionWasInvalidated) {
    clearServiceAreaSelection();
    clearPickupPointSelection();
    clearCart();
    clearCheckoutDraft();
  }
  return { areas, selected, selectionWasInvalidated };
}
