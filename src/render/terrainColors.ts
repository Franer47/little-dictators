// The map's look: turns terrain + elevation into shaded colours, OpenFront-style.
//
// - Each land terrain has a colour ramp that gets lighter with height
//   (green plains → tan highlands → white mountains).
// - A soft hillshade (light from the north-west) makes slopes read as relief.
// - Land touching water gets a light sandy outline.
// - Water gets darker the deeper it is, and lighter near the coast.
//
// This only affects what you see. Game logic reads the terrain grid, not these colours.

import { Terrain } from "../map/terrain.ts";
import type { GameMap } from "../map/gameMap.ts";

type RGB = [number, number, number];

interface Ramp {
  /** Elevation (metres) where the ramp starts and ends; heights outside are clamped. */
  from: number;
  to: number;
  low: RGB;
  high: RGB;
}

const LAND_RAMPS: Partial<Record<Terrain, Ramp>> = {
  [Terrain.Plains]: { from: 0, to: 700, low: [172, 206, 122], high: [204, 214, 146] },
  [Terrain.Highlands]: { from: 700, to: 2000, low: [206, 188, 140], high: [234, 216, 172] },
  [Terrain.Mountains]: { from: 2000, to: 5500, low: [218, 214, 206], high: [252, 252, 250] },
  [Terrain.Ice]: { from: 0, to: 4000, low: [222, 232, 240], high: [248, 251, 255] },
};

const SEA_SHALLOW: RGB = [84, 146, 192];
const SEA_DEEP: RGB = [56, 110, 162];
/** Depth (metres) at which the sea reaches its darkest colour. */
const SEA_DEEPEST = 5000;
/** Colour Shallow-water pixels are blended towards: more right next to land, less further out. */
const COASTAL_WATER: RGB = [124, 178, 214];
const COASTAL_WATER_NEXT_TO_LAND = 0.4;
const COASTAL_WATER_FURTHER = 0.18;

/** Light outline on land next to water. */
const SHORE: RGB = [228, 222, 184];
const SHORE_MIX = 0.5;

/** How strong the hillshade is (0 = off). */
const HILLSHADE_STRENGTH = 0.55;
/** Height difference (metres) between neighbouring pixels that counts as a 45° slope. Smaller = more dramatic. */
const HILLSHADE_RELIEF = 2500;
// Light from the north-west, a bit above the horizon (x right, y down, z up).
const LIGHT = normalize([-1, -1, 1.2]);

function normalize(v: RGB): RGB {
  const len = Math.hypot(...v);
  return [v[0] / len, v[1] / len, v[2] / len];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Fills `out` (RGBA, one pixel per map pixel) with the shaded map. */
export function paintTerrain(map: GameMap, out: Uint8ClampedArray): void {
  const { width, height, terrain, elevation } = map;
  const water = (x: number, y: number): boolean => {
    const t = terrain[y * width + x];
    return t === Terrain.Ocean || t === Terrain.ShallowWater;
  };
  // Neighbour x across the left/right edge on a wrapping map; clamped at the edge otherwise.
  const nx = (x: number): number => (map.wraps ? map.wrapX(x) : Math.min(width - 1, Math.max(0, x)));
  const landHeight = (x: number, y: number): number => Math.max(0, elevation[y * width + x]);

  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1);
    const down = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = terrain[i];
      const h = elevation[i];
      const left = nx(x - 1);
      const right = nx(x + 1);
      let color: RGB;

      const ramp = LAND_RAMPS[t as Terrain];
      if (ramp) {
        color = mix(ramp.low, ramp.high, clamp01((h - ramp.from) / (ramp.to - ramp.from)));

        // Hillshade: compare the surface's slope with the light direction. Flat ground = 1.
        const dx = (landHeight(right, y) - landHeight(left, y)) / (2 * HILLSHADE_RELIEF);
        const dy = (landHeight(x, down) - landHeight(x, up)) / (2 * HILLSHADE_RELIEF);
        const normal = normalize([-dx, -dy, 1]);
        const lit = (normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]) / LIGHT[2];
        const shade = Math.min(1.25, Math.max(0.6, 1 + HILLSHADE_STRENGTH * (lit - 1)));
        color = [color[0] * shade, color[1] * shade, color[2] * shade];

        if (water(left, y) || water(right, y) || water(x, up) || water(x, down)) {
          color = mix(color, SHORE, SHORE_MIX);
        }
      } else {
        color = mix(SEA_SHALLOW, SEA_DEEP, Math.sqrt(clamp01(-h / SEA_DEEPEST)));
        if (t === Terrain.ShallowWater) {
          const nextToLand = !water(left, y) || !water(right, y) || !water(x, up) || !water(x, down);
          color = mix(color, COASTAL_WATER, nextToLand ? COASTAL_WATER_NEXT_TO_LAND : COASTAL_WATER_FURTHER);
        }
      }

      out[i * 4] = color[0];
      out[i * 4 + 1] = color[1];
      out[i * 4 + 2] = color[2];
      out[i * 4 + 3] = 255;
    }
  }
}
