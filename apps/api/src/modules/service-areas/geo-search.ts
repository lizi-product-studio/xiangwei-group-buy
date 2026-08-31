import { BusinessError } from "@hometown/domain";
import { getRegionDirectoryEntry } from "./region-directory.js";
import type {
  ReverseLocationAdapter,
  ReverseLocationResult,
} from "./pickup-location-validation.js";

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

type AmapPoi = {
  name?: string;
  address?: string | string[];
  location?: string;
  pname?: string;
  cityname?: string;
  adname?: string;
};

type AmapSearchResponse = { status?: string; pois?: AmapPoi[] };
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

const AMAP_ORIGIN = "https://restapi.amap.com";
const FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "hometown-food-group-buying/0.1 (community-admin-geo)",
};

function locationError(
  code:
    | "LOCATION_VERIFICATION_NOT_CONFIGURED"
    | "LOCATION_VERIFICATION_UNAVAILABLE"
    | "LOCATION_ADMIN_IDENTIFIER_UNMAPPABLE",
  message: string,
  statusCode: number,
  details?: unknown,
): BusinessError {
  return new BusinessError(code as never, message, statusCode, details);
}

function textValue(value: string | string[] | undefined): string {
  return Array.isArray(value)
    ? value.filter(Boolean).join("")
    : value?.trim() ?? "";
}

function toPlaceFromAmap(poi: AmapPoi): GeoPlace | null {
  const coordinates = (poi.location ?? "").split(",").map(Number);
  const longitude = coordinates[0] ?? Number.NaN;
  const latitude = coordinates[1] ?? Number.NaN;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const title = poi.name?.trim() ?? "";
  const address = [
    poi.pname,
    poi.cityname,
    poi.adname,
    textValue(poi.address),
    title,
  ]
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

function failureToBusinessError(result: ReverseLocationResult): BusinessError {
  if (result.status === "NOT_CONFIGURED")
    return locationError(
      "LOCATION_VERIFICATION_NOT_CONFIGURED",
      "当前环境未配置已批准的位置核验服务",
      503,
    );
  if (result.status === "UNAVAILABLE")
    return locationError(
      "LOCATION_VERIFICATION_UNAVAILABLE",
      "位置核验暂时不可用，请稍后重试",
      502,
    );
  return locationError(
    "LOCATION_ADMIN_IDENTIFIER_UNMAPPABLE",
    "该位置无法映射到行政目录",
    422,
    result.providerAdministrativeId
      ? { providerAdministrativeId: result.providerAdministrativeId }
      : undefined,
  );
}

export function createAmapReverseLocationAdapter(
  fetchImpl: typeof fetch = fetch,
  environment: NodeJS.ProcessEnv = process.env,
): ReverseLocationAdapter {
  const key = environment.AMAP_WEB_KEY?.trim();
  return {
    async reverse(latitude, longitude): Promise<ReverseLocationResult> {
      if (!key) return { status: "NOT_CONFIGURED" };
      let response: Response;
      try {
        response = await fetchImpl(
          `${AMAP_ORIGIN}/v3/geocode/regeo?key=${encodeURIComponent(key)}&location=${encodeURIComponent(`${longitude},${latitude}`)}`,
          { headers: FETCH_HEADERS, signal: AbortSignal.timeout(5_000) },
        );
      } catch {
        return { status: "UNAVAILABLE" };
      }
      if (!response.ok) return { status: "UNAVAILABLE" };
      let payload: AmapRegeoResponse;
      try {
        payload = (await response.json()) as AmapRegeoResponse;
      } catch {
        return { status: "UNAVAILABLE" };
      }
      const component = payload.regeocode?.addressComponent;
      const rawAdministrativeId = component?.adcode?.trim();
      const displayAddress = textValue(payload.regeocode?.formatted_address);
      if (
        payload.status !== "1" ||
        !rawAdministrativeId ||
        !/^\d{6}$/.test(rawAdministrativeId) ||
        !displayAddress
      )
        return {
          status: "UNMAPPABLE",
          ...(rawAdministrativeId
            ? { providerAdministrativeId: rawAdministrativeId }
            : {}),
        };
      const directory = getRegionDirectoryEntry(rawAdministrativeId);
      if (!directory)
        return {
          status: "UNMAPPABLE",
          providerAdministrativeId: rawAdministrativeId,
        };
      return {
        status: "MAPPED",
        coordinateSystem: "GCJ-02",
        latitude: Number(latitude.toFixed(6)),
        longitude: Number(longitude.toFixed(6)),
        providerAdministrativeId: rawAdministrativeId,
        directoryRegionCode: directory.regionCode,
        displayAddress: displayAddress.slice(0, 255),
      };
    },
  };
}

/**
 * Search is deliberately provider-bound and fail-closed. Public OSM is not a
 * production fallback because its terms, privacy and directory mapping are not
 * approved for this product.
 */
export function createGeoSearch(
  fetchImpl: typeof fetch = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const key = environment.AMAP_WEB_KEY?.trim();
  const reverseAdapter = createAmapReverseLocationAdapter(fetchImpl, environment);
  const requestJson = async <T>(url: string): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw locationError(
        "LOCATION_VERIFICATION_UNAVAILABLE",
        "地点搜索暂时不可用，请改用地图选点",
        502,
      );
    }
    if (!response.ok)
      throw locationError(
        "LOCATION_VERIFICATION_UNAVAILABLE",
        "地点搜索暂时不可用，请改用地图选点",
        502,
      );
    try {
      return (await response.json()) as T;
    } catch {
      throw locationError(
        "LOCATION_VERIFICATION_UNAVAILABLE",
        "地点搜索暂时不可用，请改用地图选点",
        502,
      );
    }
  };
  return {
    async search(query: string): Promise<GeoPlace[]> {
      if (!key)
        throw locationError(
          "LOCATION_VERIFICATION_NOT_CONFIGURED",
          "当前环境未配置已批准的位置搜索服务",
          503,
        );
      const payload = await requestJson<AmapSearchResponse>(
        `${AMAP_ORIGIN}/v3/place/text?key=${encodeURIComponent(key)}&keywords=${encodeURIComponent(query)}&offset=8&extensions=base`,
      );
      if (payload.status !== "1" || !Array.isArray(payload.pois)) return [];
      return payload.pois
        .map(toPlaceFromAmap)
        .filter((place): place is GeoPlace => place !== null);
    },
    async reverse(latitude: number, longitude: number): Promise<GeoPlace | null> {
      const result = await reverseAdapter.reverse(latitude, longitude);
      if (result.status !== "MAPPED") throw failureToBusinessError(result);
      return {
        title: result.displayAddress.slice(0, 120),
        address: result.displayAddress,
        latitude: result.latitude,
        longitude: result.longitude,
        adcode: result.directoryRegionCode,
      };
    },
  };
}
