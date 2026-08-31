import { describe, expect, it } from "vitest";
import {
  createAmapReverseLocationAdapter,
  createGeoSearch,
} from "./geo-search.js";

describe("approved pickup location provider boundary", () => {
  it("uses Amap POI results only when the approved adapter is configured", async () => {
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
      expect.objectContaining({
        title: "望京SOHO",
        latitude: 39.996348,
        longitude: 116.480881,
      }),
    ]);
  });

  it("does not fall back to a public endpoint when no approved adapter is configured", async () => {
    const geo = createGeoSearch(async () => {
      throw new Error("must not call a public fallback");
    });
    await expect(geo.search("望京")).rejects.toMatchObject({
      code: "LOCATION_VERIFICATION_NOT_CONFIGURED",
      statusCode: 503,
    });
  });

  it("fails closed when the configured provider returns an unreadable payload", async () => {
    const geo = createGeoSearch(
      async () => new Response("not json", { status: 200 }),
      { AMAP_WEB_KEY: "test-key" },
    );
    await expect(geo.search("望京")).rejects.toMatchObject({
      code: "LOCATION_VERIFICATION_UNAVAILABLE",
      statusCode: 502,
    });
  });

  it("maps only a valid raw administrative identifier to the controlled directory", async () => {
    const mapped = createAmapReverseLocationAdapter(
      async () =>
        new Response(
          JSON.stringify({
            status: "1",
            regeocode: {
              formatted_address: "北京市东城区东华门街道",
              addressComponent: { adcode: "110101" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      { AMAP_WEB_KEY: "test-key" },
    );
    await expect(mapped.reverse(39.9042, 116.4074)).resolves.toMatchObject({
      status: "MAPPED",
      coordinateSystem: "GCJ-02",
      providerAdministrativeId: "110101",
      directoryRegionCode: "110101",
    });

    const unmappable = createAmapReverseLocationAdapter(
      async () =>
        new Response(
          JSON.stringify({
            status: "1",
            regeocode: {
              formatted_address: "未知地点",
              addressComponent: { adcode: "999999" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      { AMAP_WEB_KEY: "test-key" },
    );
    await expect(unmappable.reverse(39.9, 116.4)).resolves.toEqual({
      status: "UNMAPPABLE",
      providerAdministrativeId: "999999",
    });
  });

  it("distinguishes provider outage from a non-mappable response", async () => {
    const unavailable = createAmapReverseLocationAdapter(
      async () => {
        throw new Error("offline");
      },
      { AMAP_WEB_KEY: "test-key" },
    );
    await expect(unavailable.reverse(39.9, 116.4)).resolves.toEqual({
      status: "UNAVAILABLE",
    });
  });
});
