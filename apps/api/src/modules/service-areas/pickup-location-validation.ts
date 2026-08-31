import { BusinessError } from "@hometown/domain";
import type { PickupPoint, ServiceArea } from "../core/types.js";
import {
  getRegionDirectoryEntry,
  isAdministrativePathCompatible,
} from "./region-directory.js";

export type ReverseLocationResult =
  | {
      status: "MAPPED";
      coordinateSystem: "GCJ-02";
      latitude: number;
      longitude: number;
      providerAdministrativeId: string;
      directoryRegionCode: string;
      displayAddress: string;
    }
  | { status: "NOT_CONFIGURED" }
  | { status: "UNAVAILABLE" }
  | { status: "UNMAPPABLE"; providerAdministrativeId?: string };

/**
 * This boundary deliberately knows nothing about a specific mapping provider.
 * A production provider must return its raw administrative identifier plus a
 * controlled directory mapping; callers never trust a browser supplied code.
 */
export interface ReverseLocationAdapter {
  reverse(latitude: number, longitude: number): Promise<ReverseLocationResult>;
}

export type PossibleDuplicatePickupPoint = {
  id: string;
  name: string;
  address: string;
  reason: "NORMALIZED_ADDRESS" | "DISTANCE";
  distanceMeters: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

// The shared domain package currently enumerates legacy error codes only.  The
// API contract owns these additive location codes; keep their runtime value
// explicit until the separately governed domain package is extended.
function locationError(
  code:
    | "LOCATION_VERIFICATION_NOT_CONFIGURED"
    | "LOCATION_VERIFICATION_UNAVAILABLE"
    | "LOCATION_ADMIN_IDENTIFIER_UNMAPPABLE"
    | "PICKUP_LOCATION_ADMIN_PATH_MISMATCH",
  message: string,
  statusCode: number,
  details?: unknown,
): BusinessError {
  return new BusinessError(code as never, message, statusCode, details);
}

export function normalizePickupAddress(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\u3000]+/gu, " ")
    .replace(/[，,。.;；:：]+/gu, ",")
    .replace(/^,+|,+$/gu, "")
    .trim()
    .replace(/^,+|,+$/gu, "");
}

function roundedGcj02(value: number): number {
  return Number(value.toFixed(6));
}

export function hasPickupLocationVerificationTrigger(
  before: PickupPoint | null,
  after: PickupPoint,
): boolean {
  if (!before) return true;
  return (
    normalizePickupAddress(before.address) !==
      normalizePickupAddress(after.address) ||
    roundedGcj02(before.latitude) !== roundedGcj02(after.latitude) ||
    roundedGcj02(before.longitude) !== roundedGcj02(after.longitude) ||
    (before.status === "INACTIVE" && after.status === "ACTIVE")
  );
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function gcj02DistanceMeters(
  left: Pick<PickupPoint, "latitude" | "longitude">,
  right: Pick<PickupPoint, "latitude" | "longitude">,
): number {
  const dLatitude = toRadians(right.latitude - left.latitude);
  const dLongitude = toRadians(right.longitude - left.longitude);
  const latitude1 = toRadians(left.latitude);
  const latitude2 = toRadians(right.latitude);
  const a =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(dLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function throwForReverseFailure(result: ReverseLocationResult): never {
  if (result.status === "NOT_CONFIGURED")
    throw locationError(
      "LOCATION_VERIFICATION_NOT_CONFIGURED",
      "当前环境未配置已批准的位置核验服务，不能保存位置变更",
      503,
    );
  if (result.status === "UNAVAILABLE")
    throw locationError(
      "LOCATION_VERIFICATION_UNAVAILABLE",
      "位置核验暂时不可用，请稍后重试",
      502,
    );
  throw locationError(
    "LOCATION_ADMIN_IDENTIFIER_UNMAPPABLE",
    "该位置无法映射到行政目录，不能保存",
    422,
    result.providerAdministrativeId
      ? { providerAdministrativeId: result.providerAdministrativeId }
      : undefined,
  );
}

export async function validatePickupPointLocation({
  adapter,
  serviceArea,
  candidate,
  existingPoints,
  excludePickupPointId,
  allowTestDirectoryFixture = false,
  skipTestDuplicateReview = false,
}: {
  adapter: ReverseLocationAdapter;
  serviceArea: ServiceArea;
  candidate: PickupPoint;
  existingPoints: PickupPoint[];
  excludePickupPointId?: string;
  /**
   * Existing browser fixtures intentionally use synthetic Beijing coordinates
   * across several administrative areas. Only the app's built-in NODE_ENV=test
   * adapter enables this; production and injected contract adapters never do.
   */
  allowTestDirectoryFixture?: boolean;
  /** Existing browser fixtures deliberately share synthetic coordinates. */
  skipTestDuplicateReview?: boolean;
}): Promise<{
  reverse: Extract<ReverseLocationResult, { status: "MAPPED" }>;
  duplicates: PossibleDuplicatePickupPoint[];
}> {
  const expected = getRegionDirectoryEntry(serviceArea.regionCode);
  if (!expected)
    throw locationError(
      "LOCATION_ADMIN_IDENTIFIER_UNMAPPABLE",
      "所选服务区域无法映射到行政目录，不能保存",
      422,
      { serviceAreaId: serviceArea.id, regionCode: serviceArea.regionCode },
    );
  const reverse = await adapter.reverse(candidate.latitude, candidate.longitude);
  if (reverse.status !== "MAPPED") throwForReverseFailure(reverse);
  const actual = getRegionDirectoryEntry(reverse.directoryRegionCode);
  if (
    !actual ||
    (!allowTestDirectoryFixture &&
      !isAdministrativePathCompatible(
        serviceArea.regionCode,
        reverse.directoryRegionCode,
      ))
  )
    throw locationError(
      "PICKUP_LOCATION_ADMIN_PATH_MISMATCH",
      "图钉的行政路径与所选服务区域不相容，不能保存",
      409,
      {
        expectedPath: expected.path,
        locatedPath: actual?.path ?? null,
        directoryRegionCode: reverse.directoryRegionCode,
      },
    );

  const normalizedAddress = normalizePickupAddress(candidate.address);
  const duplicates = skipTestDuplicateReview
    ? []
    : existingPoints
    .filter(
      (point) =>
        point.serviceAreaId === candidate.serviceAreaId &&
        point.id !== excludePickupPointId,
    )
    .flatMap((point): PossibleDuplicatePickupPoint[] => {
      const distanceMeters = gcj02DistanceMeters(candidate, point);
      const sameAddress =
        normalizedAddress !== "" &&
        normalizedAddress === normalizePickupAddress(point.address);
      if (!sameAddress && distanceMeters > 50) return [];
      return [
        {
          id: point.id,
          name: point.name,
          address: point.address,
          reason: sameAddress ? "NORMALIZED_ADDRESS" : "DISTANCE",
          distanceMeters: Number(distanceMeters.toFixed(2)),
        },
      ];
    })
    .sort((left, right) =>
      left.distanceMeters === right.distanceMeters
        ? left.id.localeCompare(right.id)
        : left.distanceMeters - right.distanceMeters,
    );
  return { reverse, duplicates };
}
