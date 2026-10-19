// Miller cylindrical projection: like the classic world map, but with less
// stretching near the poles than Mercator. Used to turn lon/lat into map pixels.

export interface MapProjection {
  width: number;
  height: number;
  latTop: number;
  latBottom: number;
}

const DEG = Math.PI / 180;

function millerY(latDeg: number): number {
  return 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * latDeg * DEG));
}

function millerLat(y: number): number {
  return (2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI) / DEG;
}

/** Height in pixels that keeps the map's proportions correct for a given width. */
export function projectedHeight(width: number, latTop: number, latBottom: number): number {
  return Math.round((width * (millerY(latTop) - millerY(latBottom))) / (2 * Math.PI));
}

export function lonLatToPixel(p: MapProjection, lon: number, lat: number): [number, number] {
  const x = ((lon + 180) / 360) * p.width;
  const top = millerY(p.latTop);
  const bottom = millerY(p.latBottom);
  const y = ((top - millerY(lat)) / (top - bottom)) * p.height;
  return [x, y];
}

export function pixelToLonLat(p: MapProjection, x: number, y: number): [number, number] {
  const lon = (x / p.width) * 360 - 180;
  const top = millerY(p.latTop);
  const bottom = millerY(p.latBottom);
  const lat = millerLat(top - (y / p.height) * (top - bottom));
  return [lon, lat];
}
