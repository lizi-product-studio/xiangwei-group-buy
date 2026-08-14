import { createRequire } from 'node:module';

type AreaData = Record<string, Record<string, string>>;

export interface RegionDirectoryEntry {
  regionCode: string;
  name: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  path: string;
}

const require = createRequire(import.meta.url);
const areaData = require('china-area-data/data.json') as AreaData;
const provinces = areaData['86'] ?? {};

function cityDisplayName(provinceName: string, cityName: string): string {
  return cityName === '市辖区' ? provinceName : cityName;
}

function buildDirectory(): RegionDirectoryEntry[] {
  const entries: RegionDirectoryEntry[] = [];
  for (const [provinceCode, provinceName] of Object.entries(provinces)) {
    const cities = areaData[provinceCode] ?? {};
    for (const [cityCode, rawCityName] of Object.entries(cities)) {
      const cityName = cityDisplayName(provinceName, rawCityName);
      const counties = areaData[cityCode] ?? {};
      const countyEntries = Object.entries(counties).filter(([, name]) => name !== '市辖区');
      if (countyEntries.length === 0) {
        entries.push({ regionCode: cityCode, name: cityName, provinceCode, provinceName, cityCode, cityName, path: `${provinceName} / ${cityName}` });
        continue;
      }
      for (const [regionCode, name] of countyEntries) {
        entries.push({ regionCode, name, provinceCode, provinceName, cityCode, cityName, path: `${provinceName} / ${cityName} / ${name}` });
      }
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));
}

const directory = buildDirectory();
const directoryByCode = new Map(directory.map((entry) => [entry.regionCode, entry]));

export function listRegionDirectory(query = ''): RegionDirectoryEntry[] {
  const keyword = query.trim();
  if (!keyword) return directory;
  return directory.filter((entry) => `${entry.regionCode}${entry.path}`.includes(keyword));
}

export function getRegionDirectoryEntry(regionCode: string): RegionDirectoryEntry | null {
  return directoryByCode.get(regionCode) ?? null;
}
