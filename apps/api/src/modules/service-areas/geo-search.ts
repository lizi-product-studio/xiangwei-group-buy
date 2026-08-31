import { BusinessError } from "@hometown/domain";
import { wgs84ToGcj02, gcj02ToWgs84 } from "./china-coords.js";

export type GeoPlace = {
  title: string;
  address: string;
  latitude: number;
  longitude: number;
  provinceName?: string;
  cityName?: string;
  districtName?: string;
  adcode?: string;
};

type NominatimHit = {
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
};

type AmapPoi = {
  name?: string;
  address?: string | string[];
  location?: string;
  pname?: string;
  cityname?: string;
  adname?: string;
};

type AmapSearchResponse = {
  status?: string;
  pois?: AmapPoi[];
};

type AmapRegeoResponse = {
  status?: string;
  regeocode?: {
    formatted_address?: string | string[];
    addressComponent?: {
      township?: string;
      province?: string;
      city?: string | string[];
      district?: string;
      adcode?: string;
    };
  };
};

const NOMINATIM_ORIGIN = "https://nominatim.openstreetmap.org";
const AMAP_ORIGIN = "https://restapi.amap.com";
const FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "hometown-food-group-buying/0.1 (community-admin-geo)",
};

function textValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.filter(Boolean).join("");
  return value?.trim() ?? "";
}

function toPlaceFromNominatim(hit: NominatimHit): GeoPlace | null {
  const latitude = Number(hit.lat);
  const longitude = Number(hit.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const address = hit.display_name?.trim() ?? "";
  if (address.length < 5) return null;
  const gcj = wgs84ToGcj02(longitude, latitude);
  const title = hit.name?.trim() || address.split(",")[0]!.trim();
  return {
    title: title.slice(0, 120),
    address: address.slice(0, 255),
    latitude: Number(gcj.latitude.toFixed(6)),
    longitude: Number(gcj.longitude.toFixed(6)),
  };
}

function toPlaceFromAmap(poi: AmapPoi): GeoPlace | null {
  const coordinates = (poi.location ?? "").split(",").map(Number);
  const longitude = coordinates[0];
  const latitude = coordinates[1];
  if (
    longitude === undefined ||
    latitude === undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  )
    return null;
  const title = poi.name?.trim() ?? "";
  const address = [poi.pname, poi.cityname, poi.adname, textValue(poi.address), title]
    .filter(Boolean)
    .join("");
  if (!title || address.length < 5) return null;
  return {
    title: title.slice(0, 120),
    address: address.slice(0, 255),
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    ...(poi.pname?.trim() ? { provinceName: poi.pname.trim() } : {}),
    ...(poi.cityname?.trim() ? { cityName: poi.cityname.trim() } : {}),
    ...(poi.adname?.trim() ? { districtName: poi.adname.trim() } : {}),
  };
}

export function createGeoSearch(
  fetchImpl: typeof fetch = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const requestJson = async <T>(url: string): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new BusinessError(
        "UPSTREAM_UNAVAILABLE",
        "地点搜索暂时不可用，请改用地图选点",
        502,
      );
    }
    if (!response.ok)
      throw new BusinessError(
        "UPSTREAM_UNAVAILABLE",
        "地点搜索暂时不可用，请改用地图选点",
        502,
      );
    return (await response.json()) as T;
  };
  const searchAmap = async (query: string): Promise<GeoPlace[] | null> => {
    const key = environment.AMAP_WEB_KEY?.trim();
    if (!key) return null;
    const payload = await requestJson<AmapSearchResponse>(
      `${AMAP_ORIGIN}/v3/place/text?key=${encodeURIComponent(key)}&keywords=${encodeURIComponent(query)}&offset=8&extensions=base`,
    );
    if (payload.status !== "1" || !Array.isArray(payload.pois)) return [];
    return payload.pois
      .map(toPlaceFromAmap)
      .filter((place): place is GeoPlace => place !== null);
  };
  const reverseAmap = async (
    latitude: number,
    longitude: number,
  ): Promise<GeoPlace | null | undefined> => {
    const key = environment.AMAP_WEB_KEY?.trim();
    if (!key) return undefined;
    const payload = await requestJson<AmapRegeoResponse>(
      `${AMAP_ORIGIN}/v3/geocode/regeo?key=${encodeURIComponent(key)}&location=${encodeURIComponent(`${longitude},${latitude}`)}`,
    );
    const address = textValue(payload.regeocode?.formatted_address);
    if (payload.status !== "1" || address.length < 5) return null;
    const component = payload.regeocode?.addressComponent;
    const provinceName = textValue(component?.province);
    const cityName = textValue(component?.city) || provinceName;
    const districtName = textValue(component?.district);
    const adcode = component?.adcode?.trim();
    return {
      title: (component?.township || address).slice(0, 120),
      address: address.slice(0, 255),
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
      ...(provinceName ? { provinceName } : {}),
      ...(cityName ? { cityName } : {}),
      ...(districtName ? { districtName } : {}),
      ...(adcode && /^\d{6}$/.test(adcode) ? { adcode } : {}),
    };
  };
  return {
    async search(query: string): Promise<GeoPlace[]> {
      const amap = await searchAmap(query);
      if (amap) return amap;
      const hits = await requestJson<NominatimHit[]>(
        `${NOMINATIM_ORIGIN}/search?format=jsonv2&limit=8&accept-language=zh-CN&countrycodes=cn&q=${encodeURIComponent(query)}`,
      );
      if (!Array.isArray(hits)) return [];
      const unique = new Map<string, GeoPlace>();
      for (const hit of hits) {
        const place = toPlaceFromNominatim(hit);
        if (!place) continue;
        unique.set(`${place.latitude},${place.longitude}`, place);
      }
      return [...unique.values()];
    },
    async reverse(latitude: number, longitude: number): Promise<GeoPlace | null> {
      const amap = await reverseAmap(latitude, longitude);
      if (amap !== undefined) return amap;
      const wgs = gcj02ToWgs84(longitude, latitude);
      const hit = await requestJson<NominatimHit>(
        `${NOMINATIM_ORIGIN}/reverse?format=jsonv2&accept-language=zh-CN&lat=${encodeURIComponent(String(wgs.latitude))}&lon=${encodeURIComponent(String(wgs.longitude))}`,
      );
      return toPlaceFromNominatim(hit);
    },
  };
}
