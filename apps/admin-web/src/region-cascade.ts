export type RegionDirectoryEntry = {
  regionCode: string;
  name: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  path: string;
};

export type RegionSelection = {
  provinceCode?: string;
  cityCode?: string;
  districtCode?: string;
};

const nationwide = "000000";

export function usableRegions(
  entries: RegionDirectoryEntry[],
): RegionDirectoryEntry[] {
  return entries.filter((entry) => entry.regionCode !== nationwide);
}

export function listProvinces(
  entries: RegionDirectoryEntry[],
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const entry of usableRegions(entries)) {
    if (!seen.has(entry.provinceCode))
      seen.set(entry.provinceCode, entry.provinceName);
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

export function listCities(
  entries: RegionDirectoryEntry[],
  provinceCode?: string,
): Array<{ value: string; label: string }> {
  if (!provinceCode) return [];
  const seen = new Map<string, string>();
  for (const entry of usableRegions(entries)) {
    if (entry.provinceCode !== provinceCode) continue;
    if (!seen.has(entry.cityCode)) seen.set(entry.cityCode, entry.cityName);
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

export function listDistricts(
  entries: RegionDirectoryEntry[],
  cityCode?: string,
): Array<{ value: string; label: string }> {
  if (!cityCode) return [];
  return usableRegions(entries)
    .filter(
      (entry) => entry.cityCode === cityCode && entry.regionCode !== cityCode,
    )
    .map((entry) => ({ value: entry.regionCode, label: entry.name }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

export function findRegionEntry(
  entries: RegionDirectoryEntry[],
  selection: RegionSelection,
): RegionDirectoryEntry | null {
  const usable = usableRegions(entries);
  if (selection.districtCode) {
    return (
      usable.find((entry) => entry.regionCode === selection.districtCode) ??
      null
    );
  }
  if (selection.cityCode) {
    return (
      usable.find(
        (entry) =>
          entry.cityCode === selection.cityCode &&
          entry.regionCode === selection.cityCode,
      ) ??
      usable.find((entry) => entry.cityCode === selection.cityCode) ??
      null
    );
  }
  return null;
}

export function regionAddressPrefix(
  entry: Pick<
    RegionDirectoryEntry,
    "provinceName" | "cityName" | "name" | "cityCode" | "regionCode"
  > | null,
): string {
  if (!entry) return "";
  const city =
    entry.cityName === entry.provinceName ? "" : entry.cityName;
  const district =
    entry.regionCode === entry.cityCode ? "" : entry.name;
  return `${entry.provinceName}${city}${district}`;
}

export function regionSearchBias(
  entries: RegionDirectoryEntry[],
  selection: RegionSelection,
): string {
  const usable = usableRegions(entries);
  const sample = selection.districtCode
    ? usable.find((entry) => entry.regionCode === selection.districtCode)
    : selection.cityCode
      ? usable.find((entry) => entry.cityCode === selection.cityCode)
      : usable.find((entry) => entry.provinceCode === selection.provinceCode);
  if (!sample) return "";
  const cityPart =
    selection.cityCode && sample.cityName !== sample.provinceName
      ? sample.cityName
      : "";
  const districtPart =
    selection.districtCode && sample.regionCode !== sample.cityCode
      ? sample.name
      : "";
  return `${sample.provinceName}${cityPart}${districtPart}`;
}

export function codesFromAdcode(
  entries: RegionDirectoryEntry[],
  adcode?: string,
): RegionSelection {
  if (!adcode || !/^\d{6}$/.test(adcode)) return {};
  const provinceCode = `${adcode.slice(0, 2)}0000`;
  const cityFromPrefix = `${adcode.slice(0, 4)}00`;
  if (listDistricts(entries, cityFromPrefix).some((item) => item.value === adcode))
    return {
      provinceCode,
      cityCode: cityFromPrefix,
      districtCode: adcode,
    };
  if (listCities(entries, provinceCode).some((item) => item.value === adcode))
    return { provinceCode, cityCode: adcode };
  return {};
}

export function matchRegionFromAddress(
  entries: RegionDirectoryEntry[],
  address: string,
): RegionSelection {
  const text = address.replace(/\s/g, "");
  let best: { entry: RegionDirectoryEntry; prefix: string } | null = null;
  for (const entry of usableRegions(entries)) {
    const prefix = regionAddressPrefix(entry);
    if (!prefix || !text.startsWith(prefix)) continue;
    if (!best || prefix.length > best.prefix.length)
      best = { entry, prefix };
  }
  if (!best) return {};
  const { entry } = best;
  return {
    provinceCode: entry.provinceCode,
    cityCode: entry.cityCode,
    ...(entry.regionCode === entry.cityCode
      ? {}
      : { districtCode: entry.regionCode }),
  };
}

export function matchRegionFromPlace(
  entries: RegionDirectoryEntry[],
  place: {
    adcode?: string;
    provinceName?: string;
    cityName?: string;
    districtName?: string;
  },
): RegionSelection {
  const fromAdcode = codesFromAdcode(entries, place.adcode);
  if (fromAdcode.cityCode) return fromAdcode;
  const provinceName = place.provinceName?.trim();
  const cityName = place.cityName?.trim() || provinceName;
  const districtName = place.districtName?.trim();
  if (!provinceName || !cityName) return {};
  const matches = usableRegions(entries).filter((entry) => {
    if (entry.provinceName !== provinceName) return false;
    if (entry.cityName !== cityName && entry.cityName !== place.cityName)
      return false;
    if (!districtName) return entry.regionCode === entry.cityCode;
    return entry.name === districtName;
  });
  const entry =
    matches.find((item) => item.name === districtName) ?? matches[0];
  if (!entry) return {};
  return {
    provinceCode: entry.provinceCode,
    cityCode: entry.cityCode,
    ...(entry.regionCode === entry.cityCode
      ? {}
      : { districtCode: entry.regionCode }),
  };
}
