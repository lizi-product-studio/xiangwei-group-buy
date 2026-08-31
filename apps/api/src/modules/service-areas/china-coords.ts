const PI = Math.PI;
const A = 6_378_245.0;
const EE = 0.006693421622965943;

function outOfChina(longitude: number, latitude: number): boolean {
  return (
    longitude < 72.004 ||
    longitude > 137.8347 ||
    latitude < 0.8293 ||
    latitude > 55.8271
  );
}

function transformLatitude(longitude: number, latitude: number): number {
  const x = longitude - 105;
  const y = latitude - 35;
  return (
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x)) +
    ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3 +
    ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3 +
    ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3
  );
}

function transformLongitude(longitude: number, latitude: number): number {
  const x = longitude - 105;
  const y = latitude - 35;
  return (
    300 +
    x +
    2 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x)) +
    ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3 +
    ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3 +
    ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3
  );
}

function delta(longitude: number, latitude: number): { longitude: number; latitude: number } {
  const radLat = (latitude / 180) * PI;
  let magic = 1 - EE * Math.sin(radLat) * Math.sin(radLat);
  const sqrtMagic = Math.sqrt(magic);
  magic = 1 - EE * Math.sin(radLat) * Math.sin(radLat);
  return {
    latitude:
      (transformLatitude(longitude, latitude) * 180) /
      (((A * (1 - EE)) / (magic * sqrtMagic)) * PI),
    longitude:
      (transformLongitude(longitude, latitude) * 180) /
      ((A / sqrtMagic) * Math.cos(radLat) * PI),
  };
}

export function wgs84ToGcj02(
  longitude: number,
  latitude: number,
): { longitude: number; latitude: number } {
  if (outOfChina(longitude, latitude)) return { longitude, latitude };
  const offset = delta(longitude, latitude);
  return {
    longitude: longitude + offset.longitude,
    latitude: latitude + offset.latitude,
  };
}

export function gcj02ToWgs84(
  longitude: number,
  latitude: number,
): { longitude: number; latitude: number } {
  if (outOfChina(longitude, latitude)) return { longitude, latitude };
  const offset = delta(longitude, latitude);
  return {
    longitude: longitude - offset.longitude,
    latitude: latitude - offset.latitude,
  };
}
