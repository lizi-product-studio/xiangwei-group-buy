import { useEffect, useRef, useState } from "react";
import { AutoComplete, Button, Input, Typography } from "antd";
import type * as Leaflet from "leaflet";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, type GeoPlace } from "./api.ts";
import { pickupSearchQuery, resolvePickupAddress } from "./pickup-address.ts";

const defaultCenter: [number, number] = [35.6, 104.1];
const round6 = (value: number) => Number(value.toFixed(6));
export const isLocationServiceUnconfigured = (error: unknown) =>
  Boolean(error && typeof error === "object" &&
    (error as { code?: string }).code === "LOCATION_VERIFICATION_NOT_CONFIGURED");

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

export type PickupLocationVerificationState =
  | "UNCONFIRMED"
  | "VERIFYING"
  | "CONFIRMED"
  | "FAILED";

export function isPickupLocationSubmissionBlocked(
  requiresLocationConfirmation: boolean,
  state: PickupLocationVerificationState,
): boolean {
  return requiresLocationConfirmation && state !== "CONFIRMED";
}

export function PickupLocationPicker({
  id,
  active,
  value,
  onChange,
  latitude,
  longitude,
  disabled = false,
  searchBias = "",
  onLocated,
  onVerificationStateChange,
}: {
  id?: string;
  active: boolean;
  value?: string;
  onChange?: (address: string) => void;
  latitude?: number;
  longitude?: number;
  disabled?: boolean;
  searchBias?: string;
  onLocated: (place: LocatedPlace) => void;
  onVerificationStateChange?: (state: PickupLocationVerificationState) => void;
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState(false);
  const [verificationState, setVerificationState] =
    useState<PickupLocationVerificationState>("UNCONFIRMED");
  const [searchRetry, setSearchRetry] = useState(0);
  const [mapRetry, setMapRetry] = useState(0);
  const typingRef = useRef(false);
  const programmaticAddressRef = useRef<string | null>(null);
  const lastQueryRef = useRef("");
  const lastBiasRef = useRef("");

  const reportVerificationState = (state: PickupLocationVerificationState) => {
    setVerificationState(state);
    onVerificationStateChange?.(state);
  };
  const commitCoords = (place: LocatedPlace) => {
    onLocatedRef.current(place);
  };
  const applyPlace = (place: GeoPlace, replaceAddress: boolean) => {
    const address = replaceAddress
      ? resolvePickupAddress({
          reverseAddress: place.address,
          ...(valueRef.current ? { typed: valueRef.current } : {}),
        })
      : undefined;
    typingRef.current = false;
    programmaticAddressRef.current = address ?? null;
    commitCoords({
      latitude: place.latitude,
      longitude: place.longitude,
      replaceAddress,
      ...(place.title ? { title: place.title } : {}),
      ...(address ? { address } : {}),
      ...(place.provinceName ? { provinceName: place.provinceName } : {}),
      ...(place.cityName ? { cityName: place.cityName } : {}),
      ...(place.districtName ? { districtName: place.districtName } : {}),
      ...(place.adcode ? { adcode: place.adcode } : {}),
    });
  };

  const reverseAt = (latitude: number, longitude: number) => {
    setMapError(null);
    reportVerificationState("VERIFYING");
    void api
      .reversePlace(latitude, longitude)
      .then((place) => {
        setConfigurationError(false);
        if (!place) {
          setMapError("该位置无法映射到行政目录，请移动图钉后重试");
          reportVerificationState("FAILED");
          return;
        }
        applyPlace(place, true);
        setMapError(null);
        reportVerificationState("CONFIRMED");
      })
      .catch((error) => {
        if (isLocationServiceUnconfigured(error)) {
          setConfigurationError(true);
          setMapError(null);
          reportVerificationState("FAILED");
          return;
        }
        setMapError("位置核验暂时不可用，已保留图钉和输入，可重试或取消");
        reportVerificationState("FAILED");
      });
  };

  useEffect(() => {
    if (!active || disabled || !mapNode.current || mapRef.current) return;
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
      const tiles = L.tileLayer(
        "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
        {
          subdomains: "1234",
          maxZoom: 18,
          attribution: "&copy; 高德地图",
        },
      ).addTo(map);
      tiles.on("tileerror", () => {
        setMapError("地图暂时不可用，已保留本次填写内容。请重试或取消。");
        reportVerificationState("FAILED");
      });
      const dropAt = (latitude: number, longitude: number) => {
        const next = { latitude: round6(latitude), longitude: round6(longitude) };
        commitCoords(next);
        reverseAt(next.latitude, next.longitude);
      };
      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        dropAt(event.latlng.lat, event.latlng.lng);
      });
      mapRef.current = map;
      map.invalidateSize();
    }).catch(() => {
      if (cancelled) return;
      setMapError("地图暂时不可用，已保留本次填写内容。请重试或取消。");
      reportVerificationState("FAILED");
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [active, disabled, mapRetry]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || !active || disabled) return;
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
        reverseAt(dropped.latitude, dropped.longitude);
      });
      markerRef.current = marker;
      map.setView(next, Math.max(map.getZoom(), 15));
      return;
    }
    markerRef.current.setLatLng(next);
    if (!map.getBounds().contains(next)) map.panTo(next);
  }, [active, disabled, latitude, longitude]);

  useEffect(() => {
    if (disabled) {
      setOptions([]);
      setSearchError(null);
      return;
    }
    const query = pickupSearchQuery(searchBias, value ?? "");
    if (query.length < 2) {
      setOptions([]);
      return;
    }
    // Changing the administrative region supplies a useful bias but is not a
    // user geocoding request. Avoid probing an external provider for a bare
    // province/city prefix; the detail address is searched only after the
    // operator actually types it (or selects a map location).
    if (!typingRef.current) {
      setOptions([]);
      return;
    }
    const biasChanged = searchBias !== lastBiasRef.current;
    if (query === lastQueryRef.current && !biasChanged) return;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      lastQueryRef.current = query;
      lastBiasRef.current = searchBias;
      void api
        .searchPlaces(query)
        .then((places) => {
          setConfigurationError(false);
          setOptions(places);
        })
        .catch((error) => {
          if (isLocationServiceUnconfigured(error)) {
            setConfigurationError(true);
            setSearchError(null);
            reportVerificationState("FAILED");
            return;
          }
          setOptions([]);
          setSearchError("地点搜索暂时不可用，已保留本次输入。可重试或改用地图选点。");
          reportVerificationState("FAILED");
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [value, searchBias, disabled, searchRetry]);

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
        disabled={disabled}
        onSearch={(text) => {
          // Ant Design may emit onSearch when the controlled address is
          // replaced after a successful reverse lookup. That is a form
          // synchronization event, not new operator input, so it must not
          // invalidate the verification that produced the address.
          if (programmaticAddressRef.current === text) {
            programmaticAddressRef.current = null;
            return;
          }
          typingRef.current = true;
          reportVerificationState("UNCONFIRMED");
          onChange?.(text);
        }}
        onSelect={(selected) => {
          const place = options.find((item) => item.address === selected);
          if (!place) return;
          typingRef.current = false;
          commitCoords({
            latitude: place.latitude,
            longitude: place.longitude,
            ...(place.title ? { title: place.title } : {}),
            ...(place.address ? { address: place.address } : {}),
          });
          reverseAt(place.latitude, place.longitude);
          setOptions([]);
        }}
        style={{ width: "100%" }}
      >
          <Input
          {...(id ? { id } : {})}
            allowClear
          placeholder={disabled ? "请先选择服务区域" : "如：朝阳北路101号大悦城B1层"}
        />
      </AutoComplete>
      <div className="pickup-map-wrap">
        <div
          ref={mapNode}
          className="pickup-map"
          role="application"
          aria-label="自提点地图，点击或拖动图钉选择实际位置"
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
            : "请选择服务区域并填写详细地址，或在地图上点选"}
      </Typography.Text>
      <div aria-live="polite">
        {configurationError ? (
          <Typography.Paragraph type="danger">
            地点服务尚未配置，暂时不能新建或修改位置；请管理员配置后重试。{" "}
            <Button
              type="link"
              size="small"
              onClick={() => {
                setConfigurationError(false);
                if (latitude != null && longitude != null) reverseAt(latitude, longitude);
                else setSearchRetry((value) => value + 1);
              }}
            >
              重新检测
            </Button>
          </Typography.Paragraph>
        ) : searchError && (
          <Typography.Paragraph type="danger">
            {searchError}{" "}
            <Button
              type="link"
              size="small"
              onClick={() => {
                lastQueryRef.current = "";
                setSearchRetry((value) => value + 1);
              }}
            >
              重试搜索
            </Button>
          </Typography.Paragraph>
        )}
        {!configurationError && mapError && (
          <Typography.Paragraph type="danger">
            {mapError}{" "}
            {latitude != null && longitude != null && (
              <Button
                type="link"
                size="small"
                onClick={() => reverseAt(latitude, longitude)}
              >
                重试核验
              </Button>
            )}
            <Button
              type="link"
              size="small"
              onClick={() => {
                setMapError(null);
                mapRef.current?.remove();
                mapRef.current = null;
                markerRef.current = null;
                reportVerificationState("UNCONFIRMED");
                setMapRetry((value) => value + 1);
              }}
            >
              重试地图
            </Button>
          </Typography.Paragraph>
          )}
          {located && verificationState !== "VERIFYING" && (
            <Button
              type="link"
              size="small"
              onClick={() => reverseAt(latitude!, longitude!)}
            >
              重新核验当前位置
            </Button>
          )}
      </div>
    </div>
  );
}
