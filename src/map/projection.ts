// Map projections: turn longitude/latitude into map pixels and back.
//
// Both are cylindrical (longitude is a straight line across the map), so x is the same
// for both; they only differ in how latitude is spaced vertically.
// - Miller: like the classic Mercator world map, with less stretching near the poles.
// - Patterson: looks like Miller in the middle latitudes (Europe, USA keep their familiar
//   shapes) but squeezes the polar regions, so Antarctica fits without becoming a giant
//   stretched band at the bottom. Used for the Earth map.

export type ProjectionName = "miller" | "patterson";

export interface MapProjection {
  projection: ProjectionName;
  width: number;
  height: number;
  latTop: number;
  latBottom: number;
}

const DEG = Math.PI / 180;

interface Formula {
  /** Projected y (in "radians" units, where the full longitude range is 2π) for a latitude. */
  y(latDeg: number): number;
  /** The inverse: latitude for a projected y. */
  lat(y: number): number;
}

const miller: Formula = {
  y: (latDeg) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * latDeg * DEG)),
  lat: (y) => (2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI) / DEG,
};

// Patterson cylindrical (Patterson, Šavrič & Jenny, 2014): a polynomial in latitude.
const P1 = 1.0148, P2 = 0.23185, P3 = -0.14499, P4 = 0.02406;

function pattersonY(phi: number): number {
  const p2 = phi * phi;
  return phi * (P1 + p2 * p2 * (P2 + p2 * (P3 + P4 * p2)));
}

const patterson: Formula = {
  y: (latDeg) => pattersonY(latDeg * DEG),
  lat: (y) => {
    // No closed-form inverse: solve with a few Newton steps.
    let phi = y / P1;
    for (let i = 0; i < 8; i++) {
      const p2 = phi * phi;
      const slope = P1 + p2 * p2 * (5 * P2 + p2 * (7 * P3 + 9 * P4 * p2));
      phi -= (pattersonY(phi) - y) / slope;
    }
    return Math.max(-90, Math.min(90, phi / DEG));
  },
};

const FORMULAS: Record<ProjectionName, Formula> = { miller, patterson };

/** Height in pixels that keeps the map's proportions correct for a given width. */
export function projectedHeight(name: ProjectionName, width: number, latTop: number, latBottom: number): number {
  const f = FORMULAS[name];
  return Math.round((width * (f.y(latTop) - f.y(latBottom))) / (2 * Math.PI));
}

export function lonLatToPixel(p: MapProjection, lon: number, lat: number): [number, number] {
  const f = FORMULAS[p.projection];
  const x = ((lon + 180) / 360) * p.width;
  const top = f.y(p.latTop);
  const bottom = f.y(p.latBottom);
  const y = ((top - f.y(lat)) / (top - bottom)) * p.height;
  return [x, y];
}

export function pixelToLonLat(p: MapProjection, x: number, y: number): [number, number] {
  const f = FORMULAS[p.projection];
  const lon = (x / p.width) * 360 - 180;
  const top = f.y(p.latTop);
  const bottom = f.y(p.latBottom);
  const lat = f.lat(top - (y / p.height) * (top - bottom));
  return [lon, lat];
}
