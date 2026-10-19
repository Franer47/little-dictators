// Builds public/maps/earth.png from Natural Earth land data (via the world-atlas package).
// Run with: npm run build:map
//
// Each pixel becomes a terrain colour from src/map/terrain.ts. For now terrain is
// simple: land vs. water, coasts, and Greenland as ice. Real biome and elevation
// data (tundra, desert, mountains…) can be added later.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { TERRAINS, Terrain } from "../src/map/terrain.ts";
import { lonLatToPixel, projectedHeight, type MapProjection } from "../src/map/projection.ts";

const WIDTH = 1000;
const LAT_TOP = 83;
const LAT_BOTTOM = -60; // Cuts off Antarctica, which would be a huge unplayable strip.

const projection: MapProjection = {
  width: WIDTH,
  height: projectedHeight(WIDTH, LAT_TOP, LAT_BOTTOM),
  latTop: LAT_TOP,
  latBottom: LAT_BOTTOM,
};
const { width, height } = projection;

// --- Load polygons ---------------------------------------------------------
const require = createRequire(import.meta.url);

function loadRings(file: string, object: string, filter: (id: string) => boolean = () => true): Position[][] {
  const topology = JSON.parse(readFileSync(require.resolve(`world-atlas/${file}`), "utf8")) as Topology<
    Record<string, GeometryCollection>
  >;
  const rings: Position[][] = [];
  for (const f of feature(topology, topology.objects[object]).features) {
    if (!filter(String(f.id))) continue;
    const geom = f.geometry as Polygon | MultiPolygon;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) rings.push(...poly);
  }
  return rings;
}

const GREENLAND_ID = "304";
const landRings = loadRings("land-50m.json", "land");
const iceRings = loadRings("countries-50m.json", "countries", (id) => id === GREENLAND_ID);

// --- Rasterize polygons with a scanline even-odd fill -----------------------
// Some rings (e.g. eastern Russia) cross the 180° line. Unwrap their longitudes so
// the ring is continuous, then draw it three times (shifted -360°, 0, +360°) so the
// part hanging off one edge of the map shows up on the other edge.
function unwrap(ring: Position[]): Position[] {
  const out: Position[] = [];
  let offset = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    if (i > 0) {
      const diff = lon - ring[i - 1][0];
      if (diff > 180) offset -= 360;
      else if (diff < -180) offset += 360;
    }
    out.push([lon + offset, lat]);
  }
  return out;
}

/** Returns a mask with 1 for every pixel inside the given rings. */
function rasterize(rings: Position[][]): Uint8Array {
  // Projected rings, as flat [x0, y0, x1, y1, ...] arrays.
  const projected: number[][] = [];
  for (const ring of rings.map(unwrap)) {
    for (const shift of [-360, 0, 360]) {
      projected.push(ring.flatMap(([lon, lat]) => lonLatToPixel(projection, lon + shift, lat)));
    }
  }

  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const yc = y + 0.5;
    const crossings: number[] = [];
    for (const pts of projected) {
      const n = pts.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = pts[i * 2], yi = pts[i * 2 + 1];
        const xj = pts[j * 2], yj = pts[j * 2 + 1];
        if (yi > yc !== yj > yc) {
          crossings.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
        }
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const to = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5));
      for (let x = from; x <= to; x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}

const isLand = rasterize(landRings);
const isIce = rasterize(iceRings);

// --- Assign terrain -------------------------------------------------------
const SHALLOW_RADIUS = 2;

function nearLand(x: number, y: number): boolean {
  for (let dy = -SHALLOW_RADIUS; dy <= SHALLOW_RADIUS; dy++) {
    for (let dx = -SHALLOW_RADIUS; dx <= SHALLOW_RADIUS; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && isLand[ny * width + nx]) return true;
    }
  }
  return false;
}

const terrain = new Uint8Array(width * height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (isLand[i]) {
      terrain[i] = isIce[i] ? Terrain.Ice : Terrain.Plains;
    } else {
      terrain[i] = nearLand(x, y) ? Terrain.ShallowWater : Terrain.Ocean;
    }
  }
}

// --- Write PNG + metadata -------------------------------------------------
const png = new PNG({ width, height });
for (let i = 0; i < terrain.length; i++) {
  const [r, g, b] = TERRAINS[terrain[i]].color;
  png.data[i * 4] = r;
  png.data[i * 4 + 1] = g;
  png.data[i * 4 + 2] = b;
  png.data[i * 4 + 3] = 255;
}
writeFileSync("public/maps/earth.png", PNG.sync.write(png));
writeFileSync(
  "public/maps/earth.json",
  JSON.stringify({ name: "Earth", image: "earth.png", projection: "miller", ...projection }, null, 2) + "\n",
);

const landCount = isLand.reduce((sum, v) => sum + v, 0);
console.log(`Wrote public/maps/earth.png (${width}x${height}, ${landCount} land pixels)`);
