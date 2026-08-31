import { describe, expect, it } from "vitest";
import { wgs84ToGcj02 } from "./china-coords.js";
import { createGeoSearch } from "./geo-search.js";

describe("geo search", () => {
  it("converts WGS-84 search hits to GCJ-02 for WeChat maps", async () => {
    const wgs = { lon: "116.397128", lat: "39.916527" };
    const geo = createGeoSearch(
      async () =>
        new Response(
          JSON.stringify([
            {
              name: "天安门",
              display_name: "天安门, 东城区, 北京市, 中国",
              lat: wgs.lat,
              lon: wgs.lon,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const [place] = await geo.search("天安门");
    const gcj = wgs84ToGcj02(Number(wgs.lon), Number(wgs.lat));
    expect(place).toMatchObject({
      title: "天安门",
      address: "天安门, 东城区, 北京市, 中国",
      latitude: Number(gcj.latitude.toFixed(6)),
      longitude: Number(gcj.longitude.toFixed(6)),
    });
  });

  it("uses Amap POI results when AMAP_WEB_KEY is configured", async () => {
    const geo = createGeoSearch(
      async () =>
        new Response(
          JSON.stringify({
            status: "1",
            pois: [
              {
                name: "望京SOHO",
                address: "阜通东大街",
                location: "116.480881,39.996348",
                pname: "北京市",
                cityname: "北京市",
                adname: "朝阳区",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      { AMAP_WEB_KEY: "test-key" },
    );
    await expect(geo.search("望京")).resolves.toEqual([
      {
        title: "望京SOHO",
        address: "北京市北京市朝阳区阜通东大街望京SOHO",
        latitude: 39.996348,
        longitude: 116.480881,
        provinceName: "北京市",
        cityName: "北京市",
        districtName: "朝阳区",
      },
    ]);
  });

  it("returns a clear error when the geocoder is unavailable", async () => {
    const geo = createGeoSearch(async () => {
      throw new Error("offline");
    });
    await expect(geo.search("望京")).rejects.toThrow("地点搜索暂时不可用");
  });
});
