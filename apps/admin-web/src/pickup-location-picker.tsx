import { useEffect, useRef, useState } from "react";
import { AutoComplete, Input, Typography } from "antd";
import type * as Leaflet from "leaflet";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, type GeoPlace } from "./api.ts";
import { pickupSearchQuery, resolvePickupAddress } from "./pickup-address.ts";

const defaultCenter: [number, number] = [35.6, 104.1];
const round6 = (value: number) => Number(value.toFixed(6));

export type LocatedPlace = {
  latitude: number;
  longitude: number;
  title?: string;
  address?: string;
  provinceName?: string;
  cityName?: string;
  districtName?: string;
  adcode?: string;
  replaceAddress?: boolean;
};

export function PickupLocationPicker({
  id,
  active,
  value,
  onChange,
  latitude,
  longitude,
  searchBias = "",
  onLocated,
}: {
  id?: string;
  active: boolean;
  value?: string;
  onChange?: (address: string) => void;
  latitude?: number;
  longitude?: number;
  searchBias?: string;
  onLocated: (place: LocatedPlace) => void;
}) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const onLocatedRef = useRef(onLocated);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  onLocatedRef.current = onLocated;
  onChangeRef.current = onChange;
  valueRef.current = value;
  const [options, setOptions] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const typingRef = useRef(false);
  const lastQueryRef = useRef("");
  const lastBiasRef = useRef("");
  const locatedRef = useRef(false);
  locatedRef.current = latitude != null && longitude != null;

  const commitCoords = (place: LocatedPlace) => {
    onLocatedRef.current(place);
  };
  const applyPlace = (place: GeoPlace, replaceAddress: boolean) => {
    if (replaceAddress) {
      typingRef.current = false;
      const address = resolvePickupAddress({
        reverseAddress: place.address,
        ...(valueRef.current ? { typed: valueRef.current } : {}),
      });
      if (address) onChangeRef.current?.(address);
    }
    commitCoords({
      latitude: place.latitude,
      longitude: place.longitude,
      replaceAddress,
      ...(place.title ? { title: place.title } : {}),
      ...(place.address ? { address: place.address } : {}),
      ...(place.provinceName ? { provinceName: place.provinceName } : {}),
      ...(place.cityName ? { cityName: place.cityName } : {}),
      ...(place.districtName ? { districtName: place.districtName } : {}),
      ...(place.adcode ? { adcode: place.adcode } : {}),
    });
  };

  useEffect(() => {
    if (!active || !mapNode.current || mapRef.current) return;
    let cancelled = false;
    void import("leaflet").then((mod) => {
      if (cancelled || !mapNode.current || mapRef.current) return;
      const L = ((mod as { default?: typeof Leaflet }).default ??
        mod) as typeof Leaflet;
      leafletRef.current = L;
      const map = L.map(mapNode.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView(defaultCenter, 5);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer(
        "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
        {
          subdomains: "1234",
          maxZoom: 18,
          attribution: "&copy; 高德地图",
        },
      ).addTo(map);
      const dropAt = (latitude: number, longitude: number) => {
        const next = { latitude: round6(latitude), longitude: round6(longitude) };
        commitCoords(next);
        void api
          .reversePlace(next.latitude, next.longitude)
          .then((place) => {
            if (!place) return;
            applyPlace(place, true);
          })
          .catch(() => undefined);
      };
      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        dropAt(event.latlng.lat, event.latlng.lng);
      });
      mapRef.current = map;
      map.invalidateSize();
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || !active) return;
    map.invalidateSize();
    if (
      latitude == null ||
      longitude == null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    )
      return;
    const next = L.latLng(latitude, longitude);
    if (!markerRef.current) {
      const marker = L.marker(next, {
        draggable: true,
        icon: L.divIcon({
          className: "pickup-map-pin",
          iconSize: [22, 22],
          iconAnchor: [11, 21],
        }),
      }).addTo(map);
      marker.on("dragend", () => {
        const latlng = marker.getLatLng();
        const dropped = {
          latitude: round6(latlng.lat),
          longitude: round6(latlng.lng),
        };
        commitCoords(dropped);
        void api
          .reversePlace(dropped.latitude, dropped.longitude)
          .then((place) => {
            if (!place) return;
            applyPlace(place, true);
          })
          .catch(() => undefined);
      });
      markerRef.current = marker;
      map.setView(next, Math.max(map.getZoom(), 15));
      return;
    }
    markerRef.current.setLatLng(next);
    if (!map.getBounds().contains(next)) map.panTo(next);
  }, [active, latitude, longitude]);

  useEffect(() => {
    const query = pickupSearchQuery(searchBias, value ?? "");
    if (query.length < 2) {
      setOptions([]);
      return;
    }
    // Changing the administrative region supplies a useful bias but is not a
    // user geocoding request. Avoid probing an external provider for a bare
    // province/city prefix; the detail address is searched only after the
    // operator actually types it (or selects a map location).
    if (!typingRef.current && query === searchBias.replace(/\s/g, "")) {
      setOptions([]);
      return;
    }
    const biasChanged = searchBias !== lastBiasRef.current;
    if (query === lastQueryRef.current && !biasChanged) return;
    const fromTyping = typingRef.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      lastQueryRef.current = query;
      lastBiasRef.current = searchBias;
      void api
        .searchPlaces(query)
        .then((places) => {
          setOptions(places);
          const first = places[0];
          if (
            first &&
            (fromTyping || biasChanged || !locatedRef.current)
          )
            applyPlace(first, false);
        })
        .catch(() => setOptions([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [value, searchBias]);

  const located = latitude != null && longitude != null;

  return (
    <div className="pickup-location">
      <AutoComplete
        value={value ?? ""}
        options={options.map((place) => ({
          value: place.address,
          label: (
            <div className="pickup-location__option">
              <b>{place.title}</b>
              <span>{place.address}</span>
            </div>
          ),
        }))}
        filterOption={false}
        onSearch={(text) => {
          typingRef.current = true;
          onChange?.(text);
        }}
        onSelect={(selected) => {
          const place = options.find((item) => item.address === selected);
          if (!place) return;
          typingRef.current = false;
          onChange?.(place.address);
          applyPlace(place, true);
          setOptions([]);
        }}
        style={{ width: "100%" }}
      >
        <Input
          {...(id ? { id } : {})}
          allowClear
          placeholder="如：朝阳北路101号大悦城B1层"
        />
      </AutoComplete>
      <div className="pickup-map-wrap">
        <div
          ref={mapNode}
          className="pickup-map"
          role="application"
          aria-label="自提点地图"
        />
        <p className="pickup-map-hint">
          {located
            ? "拖动图钉微调精确位置，自动回填经纬度"
            : "输入地址后自动定位，也可直接在地图上点选"}
        </p>
      </div>
      <Typography.Text type={located ? "secondary" : "danger"}>
        {searching
          ? "正在定位…"
          : located
            ? "已定位，可拖动图钉微调"
            : "请选择省市区并填写详细地址，或在地图上点选"}
      </Typography.Text>
    </div>
  );
}
