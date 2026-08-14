import { api } from './api';

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

export async function loadServiceAreaContext(allowedAreaId?: string): Promise<{ areas: ServiceAreaSelection[]; selected: ServiceAreaSelection | null }> {
  const areas = (await api.listServiceAreas()).filter((area) => area.orderEnabled && (!allowedAreaId || area.id === allowedAreaId));
  const stored = readServiceAreaSelection();
  const selected = areas.find((area) => area.id === stored?.id) ?? null;
  if (stored && !selected) clearServiceAreaSelection();
  return { areas, selected };
}
