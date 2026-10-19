// Builds the Earth map from real-world data. Run with: npm run build:map
//
// Inputs:
// - Natural Earth land polygons (via the world-atlas package): the exact shape of the
//   coastlines, and Greenland's outline for ice.
// - NOAA ETOPO1 elevation (data/raw/, downloaded automatically the first time): how high
//   the land is and how deep the sea is. Used to split land into plains / highlands /
//   mountains and for the shaded look.
//
// Outputs (in public/maps/):
// - earth.png: the terrain data, one exact colour per terrain type (see src/map/terrain.ts).
// - earth-height.png: the elevation of every pixel, in metres (see "heightmap" below).
// - earth.json: map size, projection and how to read the heightmap.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { TERRAINS, Terrain } from "../src/map/terrain.ts";
import { lonLatToPixel, pixelToLonLat, projectedHeight, type MapProjection } from "../src/map/projection.ts";

// --- Map size and projection -------------------------------------------------
// Patterson keeps mid-latitude shapes close to Miller but squeezes the poles, so the
// whole of Antarctica fits without a huge stretched strip. 84°N is just north of
// Greenland's tip; 90°S is the South Pole.
const WIDTH = 1500;
const LAT_TOP = 84;
const LAT_BOTTOM = -90;

const projection: MapProjection = {
  projection: "patterson",
  width: WIDTH,
  height: projectedHeight("patterson", WIDTH, LAT_TOP, LAT_BOTTOM),
  latTop: LAT_TOP,
  latBottom: LAT_BOTTOM,
};
const { width, height } = projection;

// --- Terrain rules -------------------------------------------------------------
/** Land at or above this average height (metres) is Highlands. */
const HIGHLANDS_FROM = 700;
/** Land at or above this average height (metres) is Mountains. */
const MOUNTAINS_FROM = 2000;
/** All land south of this latitude is Ice (Antarctica). Greenland is Ice too. */
const ANTARCTIC_ICE_SOUTH_OF = -60;
/** Water pixels this many pixels (or fewer) from land are Shallow water. */
const SHALLOW_RADIUS = 2;

// --- Elevation data (NOAA ETOPO1) ------------------------------------------------
// ETOPO1 "ice surface" (top of the Greenland/Antarctic ice sheets), every 5th arc-minute,
// served by NOAA's ERDDAP as a plain-text grid. About 50 MB.
const ETOPO_FILE = "data/raw/etopo1-5min.asc";
const ETOPO_URL =
  "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.esriAscii?altitude%5B(-90):5:(90)%5D%5B(-180):5:(180)%5D";

interface Grid {
  cols: number;
  rows: number;
  /** Degrees between samples. */
  cell: number;
  /** Longitude of column 0 and latitude of row 0 (the northernmost row). */
  lon0: number;
  lat0: number;
  values: Int16Array;
}

async function loadEtopo(): Promise<Grid> {
  if (!existsSync(ETOPO_FILE)) {
    console.log(`Downloading elevation data to ${ETOPO_FILE} (about 50 MB, once)...`);
    const res = await fetch(ETOPO_URL);
    if (!res.ok) throw new Error(`Download failed (${res.status}). Get it by hand from:\n${ETOPO_URL}`);
    mkdirSync("data/raw", { recursive: true });
    writeFileSync(ETOPO_FILE, Buffer.from(await res.arrayBuffer()));
  }
  // ESRI ASCII grid: 6 header lines ("ncols 4321" ...), then rows of numbers, north first.
  const text = readFileSync(ETOPO_FILE, "latin1");
  const header: Record<string, number> = {};
  let pos = 0;
  for (let i = 0; i < 6; i++) {
    const end = text.indexOf("\n", pos);
    const [key, value] = text.slice(pos, end).trim().split(/\s+/);
    header[key.toLowerCase()] = Number(value);
    pos = end + 1;
  }
  const cols = header.ncols, rows = header.nrows, cell = header.cellsize;
  const values = new Int16Array(cols * rows);
  // Hand-rolled number parser: much faster than splitting 9 million strings.
  let n = 0, cur = 0, neg = false, inNum = false;
  for (let i = pos; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      cur = cur * 10 + (c - 48);
      inNum = true;
    } else if (c === 45) {
      neg = true;
    } else if (inNum || neg) {
      values[n++] = neg ? -cur : cur;
      cur = 0, neg = false, inNum = false;
    }
  }
  if (inNum) values[n++] = neg ? -cur : cur;
  if (n !== cols * rows) throw new Error(`${ETOPO_FILE}: expected ${cols * rows} values, got ${n}`);
  return { cols, rows, cell, lon0: header.xllcenter, lat0: header.yllcenter + (rows - 1) * cell, values };
}

/** Elevation in metres at any lon/lat, blending the 4 nearest samples. */
function sampleGrid(g: Grid, lon: number, lat: number): number {
  const lonCols = Math.round(360 / g.cell); // columns in one full turn (the last column repeats the first)
  let c = (lon - g.lon0) / g.cell;
  c = ((c % lonCols) + lonCols) % lonCols;
  const r = Math.min(g.rows - 1, Math.max(0, (g.lat0 - lat) / g.cell));
  const c0 = Math.floor(c), r0 = Math.floor(r);
  const c1 = (c0 + 1) % lonCols, r1 = Math.min(g.rows - 1, r0 + 1);
  const fc = c - c0, fr = r - r0;
  const v = g.values, w = g.cols;
  const top = v[r0 * w + c0] * (1 - fc) + v[r0 * w + c1] * fc;
  const bottom = v[r1 * w + c0] * (1 - fc) + v[r1 * w + c1] * fc;
  return top * (1 - fr) + bottom * fr;
}

// --- Load polygons -------------------------------------------------------------
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

// --- Rasterize polygons with a scanline even-odd fill ------------------------------
// Some rings (e.g. eastern Russia) cross the 180° line. Unwrap their longitudes so
// the ring is continuous, then draw it three times (shifted -360°, 0, +360°) so the
// part hanging off one edge of the map shows up on the other edge.
//
// Antarctica is special: its coastline goes all the way around the globe, so after
// unwrapping it ends 360° east of where it started instead of closing. We close it by
// running down to the South Pole and back along the bottom edge of the map.
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
  if (offset !== 0) {
    // Goes around the globe: close it through the pole on the side it encircles.
    const poleLat = ring[0][1] < 0 ? -90 : 90;
    out.push([out[out.length - 1][0], poleLat], [out[0][0], poleLat]);
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

const GREENLAND_ID = "304";
// A few rings in the data are slivers hugging the South Pole (artifacts of how the
// globe was cut); they have no area, so skip them.
const landRings = loadRings("land-50m.json", "land").filter((r) => r.some(([, lat]) => lat > -89.9));
const iceRings = loadRings("countries-50m.json", "countries", (id) => id === GREENLAND_ID);

const isLand = rasterize(landRings);
const isGreenland = rasterize(iceRings);

// --- Elevation per pixel ----------------------------------------------------------
// Average a 4×4 grid of samples inside each pixel. Land pixels only average the land
// samples (and water pixels the water samples), so the coast doesn't blur sea depth into
// beaches.
const etopo = await loadEtopo();
const SUB = 4;
// The projection is cylindrical: longitude depends only on x, latitude only on y.
const subLon = Array.from({ length: width * SUB }, (_, k) => pixelToLonLat(projection, (k + 0.5) / SUB, 0)[0]);
const subLat = Array.from({ length: height * SUB }, (_, k) => pixelToLonLat(projection, 0, (k + 0.5) / SUB)[1]);
const elevation = new Int16Array(width * height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const land = isLand[i] === 1;
    let sum = 0, count = 0;
    for (let sy = 0; sy < SUB; sy++) {
      for (let sx = 0; sx < SUB; sx++) {
        const h = sampleGrid(etopo, subLon[x * SUB + sx], subLat[y * SUB + sy]);
        if (land ? h >= 0 : h < 0) {
          sum += h;
          count++;
        }
      }
    }
    // No matching samples (a sliver of coast the elevation data doesn't see): sea level.
    elevation[i] = count ? Math.round(sum / count) : land ? 0 : -1;
  }
}

// --- Assign terrain -------------------------------------------------------------
function nearLand(x: number, y: number): boolean {
  for (let dy = -SHALLOW_RADIUS; dy <= SHALLOW_RADIUS; dy++) {
    for (let dx = -SHALLOW_RADIUS; dx <= SHALLOW_RADIUS; dx++) {
      const nx = (x + dx + width) % width; // the map wraps east–west
      const ny = y + dy;
      if (ny >= 0 && ny < height && isLand[ny * width + nx]) return true;
    }
  }
  return false;
}

const terrain = new Uint8Array(width * height);
for (let y = 0; y < height; y++) {
  const [, lat] = pixelToLonLat(projection, 0, y + 0.5);
  for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (isLand[i]) {
      const h = elevation[i];
      if (isGreenland[i] || lat < ANTARCTIC_ICE_SOUTH_OF) terrain[i] = Terrain.Ice;
      else if (h >= MOUNTAINS_FROM) terrain[i] = Terrain.Mountains;
      else if (h >= HIGHLANDS_FROM) terrain[i] = Terrain.Highlands;
      else terrain[i] = Terrain.Plains;
    } else {
      terrain[i] = nearLand(x, y) ? Terrain.ShallowWater : Terrain.Ocean;
    }
  }
}

// --- Write PNGs + metadata ----------------------------------------------------------
const terrainPng = new PNG({ width, height });
for (let i = 0; i < terrain.length; i++) {
  const [r, g, b] = TERRAINS[terrain[i]].color;
  terrainPng.data[i * 4] = r;
  terrainPng.data[i * 4 + 1] = g;
  terrainPng.data[i * 4 + 2] = b;
  terrainPng.data[i * 4 + 3] = 255;
}
writeFileSync("public/maps/earth.png", PNG.sync.write(terrainPng));

// Heightmap: metres + 32768, as a 16-bit number split over red (high byte) and green
// (low byte). Browsers only read PNGs as 8 bits per channel, so a 16-bit grey PNG
// would lose precision; this way every metre survives.
const HEIGHT_OFFSET = 32768;
const heightPng = new PNG({ width, height });
for (let i = 0; i < elevation.length; i++) {
  const v = elevation[i] + HEIGHT_OFFSET;
  heightPng.data[i * 4] = v >> 8;
  heightPng.data[i * 4 + 1] = v & 255;
  heightPng.data[i * 4 + 2] = 0;
  heightPng.data[i * 4 + 3] = 255;
}
writeFileSync("public/maps/earth-height.png", PNG.sync.write(heightPng));

// wrapX: the map loops east–west (walking off the right edge brings you back on the left).
const meta = {
  name: "Earth",
  image: "earth.png",
  ...projection,
  wrapX: true,
  // metres = (red * 256 + green) + offset
  heightmap: { image: "earth-height.png", offset: -HEIGHT_OFFSET },
};
writeFileSync("public/maps/earth.json", JSON.stringify(meta, null, 2) + "\n");

const counts = TERRAINS.map((t) => `${t.name} ${terrain.filter((v) => v === t.id).length}`);
console.log(`Wrote public/maps/earth.png + earth-height.png (${width}x${height})`);
console.log(`Pixels: ${counts.join(", ")}`);
