// Builds the Earth map from real-world data. Run with: npm run build:map
//
// Inputs:
// - Natural Earth land polygons, 1:10m or 1:50m depending on the map size (via the
//   world-atlas package): the exact shape of the coastlines, and Greenland's outline for ice.
// - NOAA ETOPO1 elevation (data/raw/, downloaded automatically the first time): how high
//   the land is and how deep the sea is. Used to split land into plains / highlands /
//   mountains and for the shaded look.
// - Natural Earth 1:50m lakes and river lines (data/raw/, downloaded the first time). Which
//   lakes and rivers go on the map is set in scripts/earth-water.json.
//
// Outputs (in public/maps/), for each size in MAPS below (e.g. "earth", "earth-1500"):
// - <name>.png: the terrain data, one exact colour per terrain type (see src/map/terrain.ts).
// - <name>-height.png: the elevation of every pixel, in metres (see "heightmap" below).
// - <name>.json: map size, projection and how to read the heightmap.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry, LineString, MultiLineString, MultiPolygon, Polygon, Position } from "geojson";
import { TERRAINS, Terrain } from "../src/map/terrain.ts";
import { lonLatToPixel, pixelToLonLat, projectedHeight, type MapProjection } from "../src/map/projection.ts";

// --- Map sizes and projection -------------------------------------------------
// Patterson keeps mid-latitude shapes close to Miller but squeezes the poles, so the
// whole of Antarctica fits without a huge stretched strip. 84°N is just north of
// Greenland's tip; 90°S is the South Pole.
const LAT_TOP = 84;
const LAT_BOTTOM = -90;

interface MapSize {
  /** File name in public/maps/: <name>.png, <name>-height.png, <name>.json. */
  name: string;
  width: number;
  /**
   * How detailed the coastlines are: Natural Earth "50m" (1:50 million) or "10m" (1:10
   * million). 50m is fine up to ~1500 px; wider maps need 10m, or fjords and island chains
   * near the poles (where the map is stretched) come out smoother than the pixels.
   */
  coastlines: "50m" | "10m";
}

/**
 * The maps to build, all with the same rules; only the size differs (the height follows
 * from the width). "earth" is the one the game loads. To add a size, add a line.
 * earth-1500 keeps the 50m coastlines it was made with, so it stays the same map.
 */
const MAPS: MapSize[] = [
  { name: "earth", width: 2000, coastlines: "10m" },
  { name: "earth-1500", width: 1500, coastlines: "50m" },
];

/**
 * Settings below that are measured in pixels were tuned on the 1500-px-wide map. On a map
 * of another width they're scaled so they cover the same distance on the ground (a pixel
 * of the 1500 map is about 27 km wide at the equator).
 */
const TUNED_AT_WIDTH = 1500;

// --- Terrain rules -------------------------------------------------------------
/** Land at or above this average height (metres) is Highlands. */
const HIGHLANDS_FROM = 700;
/** Land at or above this average height (metres) is Mountains. */
const MOUNTAINS_FROM = 2000;
/** All land south of this latitude is Ice (Antarctica). Greenland is Ice too. */
const ANTARCTIC_ICE_SOUTH_OF = -60;
/** Water pixels this many pixels (or fewer, on the 1500-px map) from land are Shallow water. */
const SHALLOW_RADIUS = 2;

// Snow: the cold north beyond the Arctic tree line (tundra), where the land is snowy most
// of the year. The tree line isn't at one latitude: the Gulf Stream keeps Norway mild up
// to ~70°N, while around Hudson Bay tundra reaches down to ~57°N. This table gives its
// rough latitude at points around the globe (west to east); in between it's interpolated.
const TREE_LINE: [lon: number, lat: number][] = [
  [-180, 62], // Chukotka / Bering Sea
  [-165, 61], // western Alaska coast
  [-150, 67.5], // Brooks Range, northern Alaska
  [-135, 68.5], // Mackenzie delta
  [-115, 64], // Great Bear / Great Slave lakes
  [-100, 60],
  [-94, 58.5], // Churchill, Hudson Bay
  [-80, 56], // east of Hudson Bay
  [-70, 57.5], // Ungava
  [-60, 56], // Labrador coast
  [-40, 61], // Greenland (Ice anyway)
  [-20, 65], // Iceland
  [10, 69.5], // Norway
  [25, 69.5], // Lapland
  [35, 68], // Kola
  [50, 67], // Pechora
  [65, 66.5], // Urals, Yamal
  [85, 69], // Yenisei
  [102, 72], // Taymyr (the world's northernmost forest)
  [130, 71], // Lena delta
  [150, 69], // Indigirka, Kolyma
  [165, 64],
  [180, 62], // same as -180, so the line closes around the globe
];
/** Higher ground is colder: every this many metres of height counts as one degree further north. */
const SNOW_METRES_PER_DEGREE = 140;
/** How much (in degrees) the snow edge wiggles, so it doesn't look like a smooth drawn line. */
const SNOW_EDGE_NOISE = 0.8;

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

/** Downloads `url` to `file`, unless it's already there. */
async function download(url: string, file: string, what: string): Promise<void> {
  if (existsSync(file)) return;
  console.log(`Downloading ${what} to ${file} (once)...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}). Get it by hand from:\n${url}\nand save it as ${file}`);
  mkdirSync("data/raw", { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function loadEtopo(): Promise<Grid> {
  await download(ETOPO_URL, ETOPO_FILE, "elevation data (about 50 MB)");
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

const GREENLAND_ID = "304";
// A few rings in the data are slivers hugging the South Pole (artifacts of how the
// globe was cut); they have no area, so skip them.
const landRings = (detail: MapSize["coastlines"]): Position[][] =>
  loadRings(`land-${detail}.json`, "land").filter((r) => r.some(([, lat]) => lat > -89.9));
const iceRings = (detail: MapSize["coastlines"]): Position[][] =>
  loadRings(`countries-${detail}.json`, "countries", (id) => id === GREENLAND_ID);

// --- Lakes and rivers: Natural Earth data + scripts/earth-water.json -----------------
// Natural Earth vector data, pinned to release v5.1.2 so a rebuild always gets the same
// shapes. Public domain. Each file is under 1 MB.
const NATURAL_EARTH_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson";
const LAKES_FILE = "data/raw/ne_50m_lakes.geojson";
const RIVERS_FILE = "data/raw/ne_50m_rivers_lake_centerlines.geojson";

interface WaterConfig {
  lakes: { minAreaKm2: number; kinds: string[]; alsoInclude: string[]; exclude: string[] };
  rivers: {
    name: string;
    parts: string[];
    bbox?: [west: number, south: number, east: number, north: number];
    dropLines?: Position[];
    extraLines?: Position[][];
  }[];
}
const water: WaterConfig = JSON.parse(readFileSync("scripts/earth-water.json", "utf8"));

async function loadNaturalEarth<G extends Geometry>(file: string, what: string): Promise<FeatureCollection<G>> {
  await download(`${NATURAL_EARTH_URL}/${file.slice(file.lastIndexOf("/") + 1)}`, file, what);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Area of a lon/lat ring in km² (on a sphere). */
function ringAreaKm2(ring: Position[]): number {
  const R = 6371, rad = Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i], [lon2, lat2] = ring[i + 1];
    sum += (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((sum * R * R) / 2);
}

// Lakes are ordinary water (Ocean / Shallow water, by the same rule as the sea). Natural
// Earth's land polygons cover the lakes, so cut them out of the land. Islands in a lake
// are holes in its polygon, so they stay land.
const lakeRings: Position[][] = [];
const lakeNames: string[] = [];
for (const f of (await loadNaturalEarth<Polygon | MultiPolygon>(LAKES_FILE, "Natural Earth lakes")).features) {
  const name = String(f.properties?.name);
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const area = polys.reduce((sum, [outer, ...holes]) => sum + ringAreaKm2(outer) - holes.reduce((s, h) => s + ringAreaKm2(h), 0), 0);
  const { minAreaKm2, kinds, alsoInclude, exclude } = water.lakes;
  const big = area >= minAreaKm2 && kinds.includes(f.properties?.featurecla);
  if ((!big && !alsoInclude.includes(name)) || exclude.includes(name) || lakeNames.includes(name)) continue;
  lakeNames.push(name);
  for (const poly of polys) lakeRings.push(...poly);
}
console.log(`Lakes (${lakeNames.length}): ${lakeNames.join(", ")}`);

/** Latitude of the tree line at a longitude, interpolated from TREE_LINE. */
function treeLineLat(lon: number): number {
  for (let k = 1; k < TREE_LINE.length; k++) {
    const [lon1, lat1] = TREE_LINE[k];
    if (lon <= lon1) {
      const [lon0, lat0] = TREE_LINE[k - 1];
      return lat0 + ((lon - lon0) / (lon1 - lon0)) * (lat1 - lat0);
    }
  }
  return TREE_LINE[TREE_LINE.length - 1][1];
}

/** Pseudo-random number in -1..1 for a grid point; the same inputs always give the same number. */
function hash(cx: number, cy: number): number {
  let h = Math.imul(cx, 374761393) ^ Math.imul(cy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
}

// --- Load the data once; every map size is built from it ---------------------------
const etopo = await loadEtopo();
const riverFeatures = (await loadNaturalEarth<LineString | MultiLineString>(RIVERS_FILE, "Natural Earth rivers")).features;

// --- Build one map ---------------------------------------------------------------------
function buildMap({ name, width, coastlines }: MapSize): void {
  console.log(`\n--- ${name}: ${width} px wide, ${coastlines} coastlines ---`);
  const projection: MapProjection = {
    projection: "patterson",
    width,
    height: projectedHeight("patterson", width, LAT_TOP, LAT_BOTTOM),
    latTop: LAT_TOP,
    latBottom: LAT_BOTTOM,
  };
  const { height } = projection;
  /** A distance in pixels of the 1500-px map, in this map's pixels. */
  const px = (pixels: number): number => (pixels * width) / TUNED_AT_WIDTH;

  /** Returns a mask with 1 for every pixel inside the given rings. */
  function rasterize(rings: Position[][]): Uint8Array {
    // Projected rings, as flat [x0, y0, x1, y1, ...] arrays.
    const projected: number[][] = [];
    for (const ring of rings.map(unwrap)) {
      for (const shift of [-360, 0, 360]) {
        projected.push(ring.flatMap(([lon, lat]) => lonLatToPixel(projection, lon + shift, lat)));
      }
    }

    // Where each edge crosses the centre line (y + 0.5) of each pixel row it spans. Going
    // edge by edge (not row by row over all edges) keeps this fast for detailed coastlines.
    const rowCrossings: number[][] = Array.from({ length: height }, () => []);
    for (const pts of projected) {
      const n = pts.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = pts[i * 2], yi = pts[i * 2 + 1];
        const xj = pts[j * 2], yj = pts[j * 2 + 1];
        const first = Math.max(0, Math.ceil(Math.min(yi, yj) - 0.5));
        const last = Math.min(height - 1, Math.ceil(Math.max(yi, yj) - 0.5) - 1);
        for (let y = first; y <= last; y++) {
          const yc = y + 0.5;
          rowCrossings[y].push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
        }
      }
    }

    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const crossings = rowCrossings[y];
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
        const to = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5));
        for (let x = from; x <= to; x++) mask[y * width + x] = 1;
      }
    }
    return mask;
  }

  const isLand = rasterize(landRings(coastlines));
  const isGreenland = rasterize(iceRings(coastlines));

  const isLake = rasterize(lakeRings);
  for (let i = 0; i < isLand.length; i++) if (isLake[i]) isLand[i] = 0;

  // --- Elevation per pixel ----------------------------------------------------------
  // Average a 4×4 grid of samples inside each pixel. Land pixels only average the land
  // samples (and water pixels the water samples), so the coast doesn't blur sea depth into
  // beaches.
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

  // Lakes: ETOPO1 is patchy inside lakes (the lake bottom for the Great Lakes, odd flat
  // values in Lake Victoria...), so every pixel of a lake gets one height instead: a rough
  // surface height from the low end (25th percentile) of the land around its shore, since a
  // lake is the lowest point around. Only used for the hover info; lakes draw like shallow water.
  {
    const seen = new Uint8Array(width * height);
    for (let start = 0; start < isLake.length; start++) {
      if (!isLake[start] || isLand[start] || seen[start]) continue;
      const lake = [start];
      const shore: number[] = [];
      seen[start] = 1;
      for (let k = 0; k < lake.length; k++) {
        for (const n of neighbours4(lake[k])) {
          if (isLand[n]) shore.push(elevation[n]);
          else if (!seen[n]) {
            seen[n] = 1;
            lake.push(n);
          }
        }
      }
      shore.sort((a, b) => a - b);
      const surface = shore[Math.floor(shore.length / 4)] ?? 0;
      for (const i of lake) elevation[i] = surface;
    }
  }

  // --- Assign terrain -------------------------------------------------------------
  const shallowRadius = Math.round(px(SHALLOW_RADIUS));
  function nearLand(x: number, y: number): boolean {
    for (let dy = -shallowRadius; dy <= shallowRadius; dy++) {
      for (let dx = -shallowRadius; dx <= shallowRadius; dx++) {
        const nx = (x + dx + width) % width; // the map wraps east–west
        const ny = y + dy;
        if (ny >= 0 && ny < height && isLand[ny * width + nx]) return true;
      }
    }
    return false;
  }

  /**
   * Smooth noise in -1..1 (blended random values on a grid of `cell`-pixel squares). The
   * grid repeats every map width, so the noise matches up across the east–west seam.
   */
  function smoothNoise(x: number, y: number, cell: number): number {
    const cols = Math.round(width / cell);
    const fx = x / cell, fy = y / cell;
    const cx = Math.floor(fx), cy = Math.floor(fy);
    const tx = fx - cx, ty = fy - cy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (i: number, j: number): number => hash(((i % cols) + cols) % cols, j);
    const top = at(cx, cy) + (at(cx + 1, cy) - at(cx, cy)) * sx;
    const bottom = at(cx, cy + 1) + (at(cx + 1, cy + 1) - at(cx, cy + 1)) * sx;
    return top + (bottom - top) * sy;
  }

  /** True if a land pixel is cold enough to be Snow. */
  function isSnowy(x: number, y: number, lon: number, lat: number, h: number): boolean {
    const wiggle = SNOW_EDGE_NOISE * (0.65 * smoothNoise(x, y, px(30)) + 0.35 * smoothNoise(x, y, px(10)));
    return lat + Math.max(0, h) / SNOW_METRES_PER_DEGREE + wiggle >= treeLineLat(lon);
  }

  const terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const [, lat] = pixelToLonLat(projection, 0, y + 0.5);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (isLand[i]) {
        const h = elevation[i];
        const [lon] = pixelToLonLat(projection, x + 0.5, 0);
        if (isGreenland[i] || lat < ANTARCTIC_ICE_SOUTH_OF) terrain[i] = Terrain.Ice;
        else if (h >= MOUNTAINS_FROM) terrain[i] = Terrain.Mountains;
        else if (lat > 0 && isSnowy(x, y, lon, lat, h)) terrain[i] = Terrain.Snow;
        else if (h >= HIGHLANDS_FROM) terrain[i] = Terrain.Highlands;
        else terrain[i] = Terrain.Plains;
      } else {
        terrain[i] = nearLand(x, y) ? Terrain.ShallowWater : Terrain.Ocean;
      }
    }
  }

  // --- Rivers ------------------------------------------------------------------------
  // Each river becomes a line of River pixels exactly 1 pixel wide and 4-connected: every
  // pixel touches the next one by a side, never only by a corner. So the river cleanly
  // splits the land on its two banks: nothing can slip diagonally between two river pixels.
  // River beats every land terrain except Ice. Where a river crosses the sea or a big lake,
  // that stretch is simply that water.
  //
  // "Water" for rivers means a real body of water: the sea, one of the big lakes, or any
  // patch of water of at least MIN_WATER_BODY pixels. Some estuaries (the Amazon's, the St.
  // Lawrence's) come out of the coastline data as a chain of single water pixels touching
  // only at the corners; a river runs straight through those to the open water.

  // (Sizes in pixels of the 1500-px map, scaled to this map with px().)
  /** When a line loops back or runs right next to itself within this many pixels, cut the loop off. */
  const RIVER_SHORTCUT_WINDOW = Math.round(px(40));
  /** A river end this close (pixels) to water or another piece of river gets joined to it (small gaps in the data). */
  const RIVER_JOIN_GAP = Math.round(px(3));
  /** How far (pixels) a river's mouth may be from the sea, lake or river it flows into; the gap is filled in. */
  const RIVER_MOUTH_REACH = Math.round(px(25));
  /** Smaller patches of water (not counting the big lakes) don't count as somewhere a river can flow into. An area, so scaled twice. */
  const MIN_WATER_BODY = Math.round(px(px(20)));

  /** The 4 side neighbours of a pixel (across the east–west seam too; none past the top/bottom). */
  function neighbours4(i: number): number[] {
    const x = i % width, y = (i - x) / width;
    const out = [y * width + ((x + 1) % width), y * width + ((x - 1 + width) % width)];
    if (y > 0) out.push(i - width);
    if (y < height - 1) out.push(i + width);
    return out;
  }

  /** Pixel offsets of the 3×3 block around a pixel, clockwise from the top-left. */
  const RING: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

  /** 1 for every pixel of a real body of water (see above). */
  const openWater = new Uint8Array(width * height);
  {
    const seen = new Uint8Array(width * height);
    for (let start = 0; start < openWater.length; start++) {
      if (isLand[start] || seen[start]) continue;
      const body = [start];
      seen[start] = 1;
      let hasLake = false;
      for (let k = 0; k < body.length; k++) {
        if (isLake[body[k]]) hasLake = true;
        for (const n of neighbours4(body[k])) {
          if (!isLand[n] && !seen[n]) {
            seen[n] = 1;
            body.push(n);
          }
        }
      }
      if (hasLake || body.length >= MIN_WATER_BODY) for (const i of body) openWater[i] = 1;
    }
  }

  /** True for pixels a river can be drawn on: land (except Ice) and specks of water too small to count. */
  const canHoldRiver = (i: number): boolean => !openWater[i] && terrain[i] !== Terrain.Ice;

  /**
   * The pixels a straight line from (x0, y0) to (x1, y1) passes through, in order. It steps
   * one pixel left/right or up/down at a time, never diagonally, so the result is 4-connected.
   * x isn't wrapped here, so a line can run past the map's edge (it's wrapped when drawn).
   */
  function traceSegment(x0: number, y0: number, x1: number, y1: number, out: [number, number][]): void {
    let cx = Math.floor(x0), cy = Math.floor(y0);
    const ex = Math.floor(x1), ey = Math.floor(y1);
    const dx = x1 - x0, dy = y1 - y0;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    // How far along the line (0..1) the next pixel edge left/right (tx) and up/down (ty) is.
    let tx = dx ? ((sx > 0 ? cx + 1 : cx) - x0) / dx : Infinity;
    let ty = dy ? ((sy > 0 ? cy + 1 : cy) - y0) / dy : Infinity;
    if (out.length === 0 || out[out.length - 1][0] !== cx || out[out.length - 1][1] !== cy) out.push([cx, cy]);
    for (let n = Math.abs(ex - cx) + Math.abs(ey - cy); n > 0; n--) {
      // Cross whichever pixel edge the line reaches first.
      if (cy === ey || (cx !== ex && tx < ty)) {
        cx += sx;
        tx += Math.abs(1 / dx);
      } else {
        cy += sy;
        ty += Math.abs(1 / dy);
      }
      out.push([cx, cy]);
    }
  }

  /**
   * Cleans up a traced line: where it comes back to a pixel it already passed, or runs right
   * next to one, the loop in between is cut off. What's left is a clean 1-pixel line with
   * no 2×2 clumps and no wiggles back and forth inside one pixel.
   */
  function simplifyPath(cells: [number, number][]): [number, number][] {
    const out: [number, number][] = [];
    const at = new Map<number, number>(); // pixel -> its index in out
    const key = (x: number, y: number): number => (x + 4 * width) * height + y;
    const cutTo = (length: number): void => {
      while (out.length > length) {
        const [x, y] = out.pop()!;
        if (at.get(key(x, y)) === out.length) at.delete(key(x, y));
      }
    };
    for (const [x, y] of cells) {
      const recent = out.length - RIVER_SHORTCUT_WINDOW;
      const same = at.get(key(x, y));
      if (same !== undefined && same >= recent) {
        cutTo(same + 1);
        continue;
      }
      let cut = out.length;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = at.get(key(nx, ny));
        if (k !== undefined && k >= recent && k < cut) cut = k;
      }
      if (cut < out.length) cutTo(cut + 1);
      at.set(key(x, y), out.length);
      out.push([x, y]);
    }
    return out;
  }

  /** The (unwrapped) pixels of a lon/lat line. Longitudes are unwrapped so a line crossing 180° doesn't jump across the map. */
  function traceLine(line: Position[]): [number, number][] {
    const cells: [number, number][] = [];
    let prev: [number, number] | null = null;
    let offset = 0;
    for (let k = 0; k < line.length; k++) {
      const [lon, lat] = line[k];
      if (k > 0) {
        const diff = lon - line[k - 1][0];
        if (diff > 180) offset -= 360;
        else if (diff < -180) offset += 360;
      }
      const p = lonLatToPixel(projection, lon + offset, lat);
      if (prev) traceSegment(prev[0], prev[1], p[0], p[1], cells);
      else cells.push([Math.floor(p[0]), Math.floor(p[1])]);
      prev = p;
    }
    return simplifyPath(cells);
  }

  /** The map pixel index for a lon/lat point. */
  function pixelOf(lon: number, lat: number): number {
    const [x, y] = lonLatToPixel(projection, lon, lat);
    const px = ((Math.floor(x) % width) + width) % width;
    return Math.min(height - 1, Math.max(0, Math.floor(y))) * width + px;
  }

  interface River {
    name: string;
    pixels: Set<number>;
    /** Loose ends of its lines (lon/lat): the source, the mouth, delta branch ends, gaps in the data. */
    ends: Position[];
  }

  const rivers: River[] = water.rivers.map((cfg) => {
    const lines: Position[][] = [];
    const inBox = ([lon, lat]: Position): boolean =>
      !cfg.bbox || (lon >= cfg.bbox[0] && lat >= cfg.bbox[1] && lon <= cfg.bbox[2] && lat <= cfg.bbox[3]);
    const dropped = (line: Position[]): boolean =>
      [line[0], line[line.length - 1]].some(([lon, lat]) =>
        (cfg.dropLines ?? []).some(([dLon, dLat]) => Math.abs(lon - dLon) < 0.02 && Math.abs(lat - dLat) < 0.02),
      );
    for (const f of riverFeatures) {
      if (!f.geometry || !cfg.parts.includes(f.properties?.name)) continue;
      const parts = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const line of parts) if (line.some(inBox) && !dropped(line)) lines.push(line);
    }
    lines.push(...(cfg.extraLines ?? []));
    if (lines.length === 0) console.warn(`River ${cfg.name}: no lines found for ${cfg.parts.join(", ")}`);

    const pixels = new Set<number>();
    for (const line of lines) {
      for (const [x, y] of traceLine(line)) {
        if (y < 0 || y >= height) continue;
        const i = y * width + (((x % width) + width) % width);
        if (canHoldRiver(i)) pixels.add(i);
      }
    }

    // Loose ends: line ends that don't meet another line of the same river (within ~1 km).
    const endKey = ([lon, lat]: Position): string => `${lon.toFixed(2)},${lat.toFixed(2)}`;
    const uses = new Map<string, number>();
    for (const line of lines) for (const p of [line[0], line[line.length - 1]]) uses.set(endKey(p), (uses.get(endKey(p)) ?? 0) + 1);
    const ends = lines.flatMap((line) => [line[0], line[line.length - 1]]).filter((p) => uses.get(endKey(p)) === 1);
    return { name: cfg.name, pixels, ends };
  });

  /** How many rivers each pixel belongs to. */
  const riverCount = new Uint8Array(width * height);
  for (const r of rivers) for (const i of r.pixels) riverCount[i]++;

  /**
   * Shortest side-by-side path over land from `start` to the nearest pixel where `isTarget`
   * is true, at most `reach` steps, not passing through `avoid`. Returns the pixels in between
   * (start and target not included), or null if there's nothing in reach.
   */
  function pathTo(start: number, reach: number, isTarget: (j: number) => boolean, avoid: Set<number>): number[] | null {
    const prev = new Map<number, number>([[start, -1]]);
    let frontier = [start];
    for (let d = 0; d < reach && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const i of frontier) {
        for (const n of neighbours4(i)) {
          if (prev.has(n) || avoid.has(n)) continue;
          prev.set(n, i);
          if (isTarget(n)) {
            const path: number[] = [];
            for (let k = i; k !== start; k = prev.get(k)!) path.push(k);
            return path;
          }
          if (canHoldRiver(n)) next.push(n);
        }
      }
      frontier = next;
    }
    return null;
  }

  /** All pixels of `river` connected (side by side) to pixel `start`. */
  function riverPiece(river: River, start: number): Set<number> {
    const piece = new Set([start]);
    const todo = [start];
    while (todo.length > 0) {
      for (const n of neighbours4(todo.pop()!)) {
        if (river.pixels.has(n) && !piece.has(n)) {
          piece.add(n);
          todo.push(n);
        }
      }
    }
    return piece;
  }

  // Join each loose end that stops just short of something:
  // - any end close to another piece of the same river or to water: a small gap in the data;
  // - the mouth (the lowest loose end): to the sea, lake or river it flows into, even if the
  //   data stops a bit before the coast.
  // Only the mouth may join a *different* river, so a source that happens to be near another
  // river (the Danube's, next to the Rhine) doesn't get linked to it.
  for (const river of rivers) {
    if (river.ends.length === 0) continue;
    const mouth = river.ends.reduce((a, b) => (sampleGrid(etopo, b[0], b[1]) < sampleGrid(etopo, a[0], a[1]) ? b : a));
    const inOtherRiver = (j: number): boolean => riverCount[j] > (river.pixels.has(j) ? 1 : 0);
    for (const end of river.ends) {
      const p = pixelOf(end[0], end[1]);
      if (!river.pixels.has(p)) continue; // ends in the sea, a lake or on ice
      if (neighbours4(p).some((n) => openWater[n])) continue; // already at the water
      if (end === mouth && (inOtherRiver(p) || neighbours4(p).some(inOtherRiver))) continue; // already flows into another river
      const piece = riverPiece(river, p);
      let path = pathTo(p, RIVER_JOIN_GAP, (j) => openWater[j] === 1 || (river.pixels.has(j) && !piece.has(j)), piece);
      if (!path && end === mouth) path = pathTo(p, RIVER_MOUTH_REACH, (j) => openWater[j] === 1 || inOtherRiver(j), piece);
      if (path) {
        for (const i of path) {
          river.pixels.add(i);
          riverCount[i]++;
        }
        if (path.length > 1) console.log(`River ${river.name}: joined the end at ${end.map((v) => v.toFixed(2))} (${path.length} px)`);
      } else if (end === mouth) {
        console.warn(`River ${river.name}: mouth at ${end.map((v) => v.toFixed(2))} doesn't reach water`);
      }
    }
  }

  // A source right next to a different river (the Danube's starts ~25 km from the Rhine,
  // under 2 pixels) would make the two touch, as if they were one river. Shorten such a
  // source by a few pixels until there's land between them.
  const RIVER_SOURCE_TRIM = Math.round(px(6));
  for (const river of rivers) {
    if (river.ends.length === 0) continue;
    const mouth = river.ends.reduce((a, b) => (sampleGrid(etopo, b[0], b[1]) < sampleGrid(etopo, a[0], a[1]) ? b : a));
    const inOtherRiver = (j: number): boolean => riverCount[j] > (river.pixels.has(j) ? 1 : 0);
    for (const end of river.ends) {
      if (end === mouth) continue;
      // Walk the first few pixels from the source tip; cut back past the last one that touches another river.
      const tip = pixelOf(end[0], end[1]);
      if (neighbours4(tip).filter((n) => river.pixels.has(n)).length !== 1) continue; // not the tip of a line
      const walk: number[] = [];
      for (let p = tip; walk.length < RIVER_SOURCE_TRIM && river.pixels.has(p); ) {
        walk.push(p);
        const next = neighbours4(p).filter((n) => river.pixels.has(n) && !walk.includes(n));
        if (next.length !== 1) break; // a fork: not a plain line any more
        p = next[0];
      }
      const touches = (p: number): boolean => {
        const x = p % width, y = (p - x) / width;
        return inOtherRiver(p) || RING.some(([dx, dy]) => y + dy >= 0 && y + dy < height && inOtherRiver((y + dy) * width + ((x + dx + width) % width)));
      };
      let last = -1;
      walk.forEach((p, k) => {
        if (touches(p)) last = k;
      });
      for (const p of walk.slice(0, last + 1)) {
        river.pixels.delete(p);
        riverCount[p]--;
      }
      if (last >= 0) console.log(`River ${river.name}: shortened the source at ${end.map((v) => v.toFixed(2))} by ${last + 1} px, away from another river`);
    }
  }

  // Where two rivers meet (or a joined gap runs alongside a line) there can be a 2×2 clump
  // of river. Thin it: remove a pixel of the clump whose neighbours stay connected without
  // it, so the line doesn't break. A pixel next to water is only removed if a
  // river pixel around it touches the water too, so mouths stay joined.
  const isRiver = (i: number): boolean => riverCount[i] > 0;
  function canThin(i: number): boolean {
    const x = i % width, y = (i - x) / width;
    if (y === 0 || y === height - 1) return false;
    const wet = (j: number): boolean => neighbours4(j).some((n) => openWater[n]);
    const at = ([dx, dy]: [number, number]): number => (y + dy) * width + ((x + dx + width) % width);
    if (wet(i) && !RING.some((d) => isRiver(at(d)) && wet(at(d)))) return false;
    // The river pixels around it, going round the ring. They stay connected without the middle
    // pixel only if they form one unbroken run along the ring, where a run may only turn a
    // corner through a corner pixel (two side pixels with an empty corner between them only
    // touch diagonally).
    const ring = RING.map((d) => isRiver(at(d)));
    const sides = [1, 3, 5, 7].filter((k) => ring[k]);
    if (sides.length < 2) return false; // a line end, or it would cut the line
    let runs = 0;
    for (let k = 0; k < 8; k++) if (ring[k] && !ring[(k + 7) % 8]) runs++;
    return runs === 1;
  }
  /** A 1-pixel stub sticking out of a river junction (left over where lines meet). */
  function isStub(i: number): boolean {
    if (!isRiver(i) || neighbours4(i).some((n) => openWater[n])) return false;
    const next = neighbours4(i).filter(isRiver);
    return next.length === 1 && neighbours4(next[0]).filter(isRiver).length >= 3;
  }
  /** Terrain before rivers are drawn, to put back where a river pixel is removed. */
  const baseTerrain = terrain.slice();
  function removeRiver(i: number): void {
    riverCount[i] = 0;
    terrain[i] = baseTerrain[i];
  }
  function thinRivers(): void {
    for (let changed = true; changed; ) {
      changed = false;
      for (let i = 0; i < riverCount.length; i++) {
        if (isStub(i)) {
          removeRiver(i);
          changed = true;
        }
      }
      for (let y = 0; y + 1 < height; y++) {
        for (let x = 0; x < width; x++) {
          const block = [y * width + x, y * width + ((x + 1) % width), (y + 1) * width + x, (y + 1) * width + ((x + 1) % width)];
          if (!block.every(isRiver)) continue;
          const thin = block.find(canThin);
          if (thin !== undefined) {
            removeRiver(thin);
            changed = true;
          }
        }
      }
    }
  }
  thinRivers();

  // (A river through a speck of sea water gets height 0 there, not the sea depth.)
  for (let i = 0; i < riverCount.length; i++) {
    if (riverCount[i]) {
      terrain[i] = Terrain.River;
      elevation[i] = Math.max(0, elevation[i]);
    }
  }

  // Final pass, now that every pixel's terrain is decided: no corner-only links. Wherever two
  // River pixels touch only at a corner (with land in both pixels between them), or a river
  // meets the sea / a lake only at a corner, one of the two in-between land pixels becomes
  // River, so rivers join each other and the water edge to edge. Ice and water never become
  // River. (Two river pixels with water on both in-between pixels are already sealed.)
  // "The sea / a lake" means real water (openWater): like everywhere else for rivers, a
  // speck of water a river only passes at a corner doesn't count.
  const isWaterTerrain = (t: number): boolean => t === Terrain.Ocean || t === Terrain.ShallowWater;
  /** Corner-only links, as [pixel, pixel, in-between, in-between]. */
  function cornerLinks(): [number, number, number, number][] {
    const links: [number, number, number, number][] = [];
    for (let y = 0; y + 1 < height; y++) {
      for (let x = 0; x < width; x++) {
        const tl = y * width + x, tr = y * width + ((x + 1) % width);
        const bl = tl + width, br = tr + width;
        for (const [a, b, c1, c2] of [[tl, br, tr, bl], [tr, bl, tl, br]]) {
          const ta = terrain[a], tb = terrain[b];
          const linked =
            (ta === Terrain.River && (tb === Terrain.River || openWater[b] === 1)) ||
            (tb === Terrain.River && openWater[a] === 1);
          if (!linked) continue;
          // River to river: the corner must be filled with River, unless both in-between pixels
          // are water. River to water: fine if either in-between pixel is River or water.
          const riverOrWater = (j: number): boolean => terrain[j] === Terrain.River || isWaterTerrain(terrain[j]);
          const ok =
            ta === Terrain.River && tb === Terrain.River
              ? terrain[c1] === Terrain.River || terrain[c2] === Terrain.River || (isWaterTerrain(terrain[c1]) && isWaterTerrain(terrain[c2]))
              : riverOrWater(c1) || riverOrWater(c2);
          if (!ok) links.push([a, b, c1, c2]);
        }
      }
    }
    return links;
  }
  // Filling a corner can make a 2×2 clump where two rivers run side by side, so thin again after.
  for (let pass = 0, links = cornerLinks(); links.length > 0 && pass < 10; pass++, links = cornerLinks()) {
    for (const [, , c1, c2] of links) {
      const usable = [c1, c2].filter((j) => terrain[j] !== Terrain.Ice && !isWaterTerrain(terrain[j]) && terrain[j] !== Terrain.River);
      // Prefer the pixel that doesn't make a 2×2 clump of river.
      const makesClump = (j: number): boolean => {
        const x = j % width, y = (j - x) / width;
        const river = (dx: number, dy: number): boolean =>
          dx === 0 && dy === 0 ? true : y + dy >= 0 && y + dy < height && terrain[(y + dy) * width + ((x + dx + width) % width)] === Terrain.River;
        return [[-1, -1], [0, -1], [-1, 0], [0, 0]].some(([ox, oy]) => river(ox, oy) && river(ox + 1, oy) && river(ox, oy + 1) && river(ox + 1, oy + 1));
      };
      const fill = usable.find((j) => !makesClump(j)) ?? usable[0];
      if (fill === undefined) continue;
      terrain[fill] = Terrain.River;
      riverCount[fill] = 1;
    }
    thinRivers();
  }
  {
    const left = cornerLinks();
    if (left.length > 0) {
      const where = left.slice(0, 10).map(([a]) => `(${a % width}, ${Math.floor(a / width)})`).join(", ");
      throw new Error(`${left.length} river pixels still touch another river or the water only at a corner: ${where}`);
    }
  }

  // Checks: every connected stretch of river must reach water, and none may be 2 pixels wide.
  {
    const seen = new Uint8Array(width * height);
    let pieces = 0, dry = 0, clumps = 0;
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] !== Terrain.River || seen[i]) continue;
      pieces++;
      let wet = false;
      const todo = [i];
      seen[i] = 1;
      while (todo.length > 0) {
        for (const n of neighbours4(todo.pop()!)) {
          if (openWater[n]) wet = true;
          else if (terrain[n] === Terrain.River && !seen[n]) {
            seen[n] = 1;
            todo.push(n);
          }
        }
      }
      if (!wet) {
        dry++;
        const x = i % width, y = (i - x) / width;
        console.warn(`A river stretch near (${x}, ${y}) doesn't reach the sea or a lake`);
      }
    }
    for (let y = 0; y + 1 < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x, r = y * width + ((x + 1) % width);
        if ([i, r, i + width, r + width].every((j) => terrain[j] === Terrain.River)) clumps++;
      }
    }
    console.log(`Rivers (${rivers.length}): ${pieces} connected stretches, ${dry} not reaching water, ${clumps} 2×2 clumps`);
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
  writeFileSync(`public/maps/${name}.png`, PNG.sync.write(terrainPng));

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
  writeFileSync(`public/maps/${name}-height.png`, PNG.sync.write(heightPng));

  // wrapX: the map loops east–west (walking off the right edge brings you back on the left).
  const meta = {
    name: "Earth",
    image: `${name}.png`,
    ...projection,
    wrapX: true,
    // metres = (red * 256 + green) + offset
    heightmap: { image: `${name}-height.png`, offset: -HEIGHT_OFFSET },
  };
  writeFileSync(`public/maps/${name}.json`, JSON.stringify(meta, null, 2) + "\n");

  const counts = TERRAINS.map((t) => `${t.name} ${terrain.filter((v) => v === t.id).length}`);
  console.log(`Wrote public/maps/${name}.png + ${name}-height.png + ${name}.json (${width}x${height})`);
  console.log(`Pixels: ${counts.join(", ")}`);
}

for (const map of MAPS) buildMap(map);
