import { describe, expect, it } from "vitest";
import {
  codesFromAdcode,
  findRegionEntry,
  listCities,
  listDistricts,
  listProvinces,
  matchRegionFromAddress,
  matchRegionFromPlace,
  regionAddressPrefix,
  regionSearchBias,
  type RegionDirectoryEntry,
} from "./region-cascade.ts";

const entries: RegionDirectoryEntry[] = [
  {
    regionCode: "000000",
    name: "全国",
    provinceCode: "00",
    provinceName: "全国",
    cityCode: "000000",
    cityName: "全国",
    path: "全国",
  },
  {
    regionCode: "110105",
    name: "朝阳区",
    provinceCode: "110000",
    provinceName: "北京市",
    cityCode: "110100",
    cityName: "北京市",
    path: "北京市 / 北京市 / 朝阳区",
  },
  {
    regionCode: "110101",
    name: "东城区",
    provinceCode: "110000",
    provinceName: "北京市",
    cityCode: "110100",
    cityName: "北京市",
    path: "北京市 / 北京市 / 东城区",
  },
  {
    regionCode: "330106",
    name: "西湖区",
    provinceCode: "330000",
    provinceName: "浙江省",
    cityCode: "330100",
    cityName: "杭州市",
    path: "浙江省 / 杭州市 / 西湖区",
  },
  {
    regionCode: "441900",
    name: "东莞市",
    provinceCode: "440000",
    provinceName: "广东省",
    cityCode: "441900",
    cityName: "东莞市",
    path: "广东省 / 东莞市",
  },
];

describe("pickup region cascade", () => {
  it("lists provinces, cities and districts without nationwide coverage", () => {
    expect(listProvinces(entries).map((item) => item.label)).toEqual([
      "北京市",
      "广东省",
      "浙江省",
    ]);
    expect(listCities(entries, "110000")).toEqual([
      { value: "110100", label: "北京市" },
    ]);
    expect(listDistricts(entries, "110100").map((item) => item.label)).toEqual(
      ["东城区", "朝阳区"].sort((left, right) =>
        left.localeCompare(right, "zh-CN"),
      ),
    );
    expect(listDistricts(entries, "441900")).toEqual([]);
  });

  it("builds a compact address prefix and matches an existing address", () => {
    expect(
      regionAddressPrefix(
        findRegionEntry(entries, {
          provinceCode: "110000",
          cityCode: "110100",
          districtCode: "110105",
        }),
      ),
    ).toBe("北京市朝阳区");
    expect(
      regionSearchBias(entries, {
        provinceCode: "110000",
        cityCode: "110100",
      }),
    ).toBe("北京市");
    expect(
      regionSearchBias(entries, {
        provinceCode: "330000",
        cityCode: "330100",
        districtCode: "330106",
      }),
    ).toBe("浙江省杭州市西湖区");
    expect(
      matchRegionFromAddress(entries, "北京市朝阳区朝阳北路101号大悦城B1层"),
    ).toEqual({
      provinceCode: "110000",
      cityCode: "110100",
      districtCode: "110105",
    });
  });

  it("maps an adcode or POI names onto the cascade selection", () => {
    expect(codesFromAdcode(entries, "110105")).toEqual({
      provinceCode: "110000",
      cityCode: "110100",
      districtCode: "110105",
    });
    expect(codesFromAdcode(entries, "441900")).toEqual({
      provinceCode: "440000",
      cityCode: "441900",
    });
    expect(
      matchRegionFromPlace(entries, {
        provinceName: "浙江省",
        cityName: "杭州市",
        districtName: "西湖区",
      }),
    ).toEqual({
      provinceCode: "330000",
      cityCode: "330100",
      districtCode: "330106",
    });
  });
});
