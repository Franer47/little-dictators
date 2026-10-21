// Who owns which pixel, and how a new nation's starting land grows. Plain game logic: no
// drawing here (src/render/territoryLayer.ts draws it), so the simulation can build on it.
//
// How land grows (all numbers in public/data/placement.json, "growth"):
// - From the start pixel it keeps taking the cheapest free pixel next to its land. A pixel's
//   price is the cheapest way to walk there from the start: each step costs the terrain's
//   cost (plains 1, highlands more, mountains a lot) times a smooth random "wobble", so land
//   spreads quickly over plains and slowly into mountains, and borders aren't perfect circles.
// - It stops when the claimed area (real km², from the map projection) reaches the rolled
//   land size, or when there's nothing left to take: the sea, lakes, ice and other
//   nations' land are never taken.
// - Snakes are avoided by where nations start, not by shape rules (those made octagons):
//   "Surprise me" and Fill start nations on coasts and riverbanks, so the sea or river
//   closes off one side, and the inland gaps left over are filled by later nations.
// - Afterwards it tidies up: 1-pixel spurs and necks are trimmed (and anything they cut off
//   is let go), and small holes inside the land are filled.

import { TERRAINS, Terrain } from "../map/terrain.ts";
import { lonLatToPixel, pixelToLonLat } from "../map/projection.ts";
import type { GameMap } from "../map/gameMap.ts";
import { createRng, type Rng } from "./random.ts";

export interface RegionData {
  name: string;
  /** The outline as [longitude, latitude] points. */
  outline: [number, number][];
}

export interface GrowthRules {
  /** How hard each terrain (by its name in the Terrain list) is to take; missing = can't be taken. */
  cost: Partial<Record<keyof typeof Terrain, number>>;
  /** How strongly random patches make land cheaper or dearer (0 = none). */
  wobble: number;
  /** Free pockets of up to this many pixels inside a nation's land are filled in (adding at most a tenth of its size). */
  holeSize: number;
}

export interface StartRules {
  /** How often (0..1) "Surprise me" and Fill pick a spot next to the sea, a lake or a river. */
  coastPreference: number;
}

export interface FillRules {
  /** Fill stops when this share (%) of the region's land is owned… */
  percent: number;
  /** …or when no gap has room for a nation of at least this many km²… */
  minArea: number;
  /** …or after this many nations or tries. */
  maxNations: number;
  maxAttempts: number;
  /** At the end of a 100% fill, nations spread up to this many pixels into the leftover land and islands. */
  absorbSteps: number;
}

export interface PlacementData {
  region: string;
  regions: Record<string, RegionData>;
  start: StartRules;
  fill: FillRules;
  growth: GrowthRules;
  colors: { list: string[] };
}

export async function loadPlacementData(): Promise<PlacementData> {
  const res = await fetch("/data/placement.json");
  if (!res.ok) throw new Error(`Couldn't load data/placement.json (${res.status})`);
  const data = (await res.json()) as PlacementData;
  if (!data.regions?.[data.region]) throw new Error(`data/placement.json: no region called "${data.region}"`);
  if (!data.colors?.list?.length) throw new Error("data/placement.json: the colour list is empty");
  for (const key of Object.keys(data.growth?.cost ?? {})) {
    if (!(key in Terrain)) throw new Error(`data/placement.json: growth.cost has an unknown terrain "${key}"`);
  }
  for (const key of ["wobble", "holeSize"] as const) {
    if (!(typeof data.growth[key] === "number" && data.growth[key] >= 0)) throw new Error(`data/placement.json: growth.${key} must be a number, 0 or more`);
  }
  if (!(data.fill?.percent > 0 && data.fill.percent <= 100)) throw new Error("data/placement.json: fill.percent must be from 1 to 100");
  return data;
}

const EARTH_RADIUS_KM = 6371;

/** The real area in km² of one pixel in each map row (pixels near the poles cover less ground). */
export function rowAreas(map: GameMap): Float64Array {
  const areas = new Float64Array(map.height);
  const dLon = (2 * Math.PI) / map.width;
  for (let y = 0; y < map.height; y++) {
    const top = pixelToLonLat(map.meta, 0, y)[1] * (Math.PI / 180);
    const bottom = pixelToLonLat(map.meta, 0, y + 1)[1] * (Math.PI / 180);
    areas[y] = EARTH_RADIUS_KM * EARTH_RADIUS_KM * dLon * Math.abs(Math.sin(top) - Math.sin(bottom));
  }
  return areas;
}

/** A part of the map (e.g. Europe): which pixels are in it, and which of those can be settled. */
export class Region {
  /** 1 for pixels inside the outline. */
  readonly inside: Uint8Array;
  /** Every land pixel inside that a nation could start on (by index y * width + x). */
  readonly land: Int32Array;
  /** The ones of those next to the sea, a lake or a river. */
  readonly shore: Int32Array;
  /** The outline's bounding box in map pixels. */
  readonly box: { x0: number; y0: number; x1: number; y1: number };

  constructor(
    readonly map: GameMap,
    readonly data: RegionData,
    canStart: (terrain: Terrain) => boolean,
  ) {
    const corners = data.outline.map(([lon, lat]) => lonLatToPixel(map.meta, lon, lat));
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const clamp = (v: number, max: number): number => Math.max(0, Math.min(max, v));
    this.box = {
      x0: clamp(Math.floor(Math.min(...xs)), map.width - 1),
      y0: clamp(Math.floor(Math.min(...ys)), map.height - 1),
      x1: clamp(Math.ceil(Math.max(...xs)), map.width - 1),
      y1: clamp(Math.ceil(Math.max(...ys)), map.height - 1),
    };
    this.inside = new Uint8Array(map.width * map.height);
    const land: number[] = [];
    const shore: number[] = [];
    const { x0, y0, x1, y1 } = this.box;
    const water = (x: number, y: number): boolean => {
      const p = map.normalize(x, y);
      return p !== null && TERRAINS[map.terrainAt(p[0], p[1])].isWater;
    };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [lon, lat] = pixelToLonLat(map.meta, x + 0.5, y + 0.5);
        if (!insideOutline(lon, lat, data.outline)) continue;
        const i = y * map.width + x;
        this.inside[i] = 1;
        if (!canStart(map.terrain[i])) continue;
        land.push(i);
        if (water(x - 1, y) || water(x + 1, y) || water(x, y - 1) || water(x, y + 1)) shore.push(i);
      }
    }
    this.land = Int32Array.from(land);
    this.shore = Int32Array.from(shore);
  }

  contains(x: number, y: number): boolean {
    return this.inside[y * this.map.width + x] === 1;
  }
}

/** Point-in-polygon test (even–odd rule). */
function insideOutline(lon: number, lat: number, outline: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i];
    const [xj, yj] = outline[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** One nation's land. */
export interface Holding {
  /** Its number in the ownership grid (1, 2, 3…; 0 means nobody). */
  id: number;
  /** The pixel it started from. */
  start: [number, number];
  /** The land size it rolled on the wheel, km². */
  rolledArea: number;
  /** The land it actually got, km² (smaller if it was boxed in by sea or other nations). */
  area: number;
  /** Its pixels, in the order they were taken (the growth animation plays them in this order). */
  pixels: Int32Array;
}

/** The id test growths use while looking for a spot (never a real nation's). */
const TEST_ID = 65535;
const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The ownership grid: which nation owns each pixel. */
export class Territory {
  /** Owner id per pixel (y * width + x); 0 = nobody. */
  readonly owner: Uint16Array;
  readonly areas: Float64Array;
  /** By id: holdings[id - 1]. */
  readonly holdings: Holding[] = [];
  /** Cost to take each terrain (Infinity = never). */
  private readonly cost = new Float64Array(16).fill(Infinity);
  // Reused between growths, so a growth doesn't allocate map-sized arrays.
  private readonly key: Float64Array;
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(
    readonly map: GameMap,
    private rules: GrowthRules,
  ) {
    const size = map.width * map.height;
    this.owner = new Uint16Array(size);
    this.key = new Float64Array(size);
    this.seen = new Uint32Array(size);
    this.areas = rowAreas(map);
    for (const [name, cost] of Object.entries(rules.cost)) {
      if (typeof cost === "number" && cost > 0) this.cost[Terrain[name as keyof typeof Terrain]] = cost;
    }
  }

  /** True if this kind of land can ever be owned (not sea, lakes or ice). */
  claimableTerrain = (t: Terrain): boolean => Number.isFinite(this.cost[t]);

  /** True if nobody owns the pixel and its terrain can be taken. */
  isFree(x: number, y: number): boolean {
    const i = y * this.map.width + x;
    return this.owner[i] === 0 && this.claimableTerrain(this.map.terrain[i]);
  }

  ownerAt(x: number, y: number): number {
    return this.owner[y * this.map.width + x];
  }

  holding(id: number): Holding | undefined {
    return this.holdings[id - 1];
  }

  /** How much of the region's land is owned by someone (0..1), by real area. */
  ownedShare(region: Region): number {
    const { width } = this.map;
    let total = 0;
    let owned = 0;
    for (const i of region.land) {
      const a = this.areas[(i / width) | 0];
      total += a;
      if (this.owner[i] !== 0) owned += a;
    }
    return total > 0 ? owned / total : 0;
  }

  /** The ids of the nations whose land touches this one's (side by side, across the map's seam too). */
  neighbours(id: number): Set<number> {
    const found = new Set<number>();
    const h = this.holding(id);
    if (!h) return found;
    const { width } = this.map;
    for (const i of h.pixels) {
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of SIDES) {
        const p = this.map.normalize(x + dx, y + dy);
        if (!p) continue;
        const other = this.owner[p[1] * width + p[0]];
        if (other !== 0 && other !== id) found.add(other);
      }
    }
    return found;
  }

  /**
   * Places a new nation at (x, y) and grows its land up to `targetArea` km². The same
   * seed, start and map state always give the same land.
   */
  place(x: number, y: number, targetArea: number, seed: number): Holding {
    if (this.holdings.length >= TEST_ID - 1) throw new Error("Too many nations");
    if (!this.isFree(x, y)) throw new Error(`Pixel (${x}, ${y}) can't be settled`);
    const id = this.holdings.length + 1;
    const { pixels, area } = this.grow(id, x, y, targetArea, seed);
    const holding: Holding = { id, start: [x, y], rolledArea: targetArea, area, pixels };
    this.holdings.push(holding);
    return holding;
  }

  /**
   * Gives the region's leftover free land (small islands, slivers between borders) to the
   * nearest nation: every nation spreads out at most `maxSteps` pixels into free land, and
   * across water to islands, one ring at a time, so the closest nation gets each pixel.
   * Returns the pixels each nation gained (by id). Repeatable: no randomness.
   */
  absorbLeftovers(region: Region, maxSteps: number): Map<number, number[]> {
    const gained = new Map<number, number[]>();
    if (!this.holdings.length || maxSteps <= 0) return gained;
    const { width, height, terrain } = this.map;
    // Work in the region's box plus a margin, so nations just outside it can reach in too.
    const x0 = Math.max(0, region.box.x0 - maxSteps);
    const y0 = Math.max(0, region.box.y0 - maxSteps);
    const x1 = Math.min(width - 1, region.box.x1 + maxSteps);
    const y1 = Math.min(height - 1, region.box.y1 + maxSteps);
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const steps = new Int16Array(bw * bh).fill(-1);
    const from = new Uint16Array(bw * bh);
    const queue = new Int32Array(bw * bh);
    let head = 0;
    let tail = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const id = this.owner[y * width + x];
        if (id === 0) continue;
        const b = (y - y0) * bw + (x - x0);
        steps[b] = 0;
        from[b] = id;
        queue[tail++] = b;
      }
    }
    while (head < tail) {
      const b = queue[head++];
      if (steps[b] >= maxSteps) continue;
      const bx = b % bw;
      const by = (b - bx) / bw;
      for (const [dx, dy] of SIDES) {
        const nx = bx + dx;
        const ny = by + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const c = ny * bw + nx;
        if (steps[c] >= 0) continue;
        const i = (ny + y0) * width + (nx + x0);
        if (this.owner[i] !== 0) continue;
        // Free land and water are both crossed (water to reach islands); only free land in the region is taken.
        steps[c] = steps[b] + 1;
        from[c] = from[b];
        queue[tail++] = c;
        if (region.inside[i] && this.cost[terrain[i]] < Infinity) {
          this.owner[i] = from[b];
          const list = gained.get(from[b]) ?? [];
          list.push(i);
          gained.set(from[b], list);
        }
      }
    }
    for (const [id, list] of gained) {
      const h = this.holding(id)!;
      const pixels = new Int32Array(h.pixels.length + list.length);
      pixels.set(h.pixels);
      pixels.set(list, h.pixels.length);
      h.pixels = pixels;
      for (const i of list) h.area += this.areas[(i / width) | 0];
    }
    return gained;
  }

  /** Removes every nation. */
  clear(): void {
    this.owner.fill(0);
    this.holdings.length = 0;
  }

  /**
   * A random free spot in the region for a nation of `targetArea` km², or null if no gap
   * has room for at least `minArea` km² (or the whole target, if that's smaller).
   * Usually (`coastPreference`) a spot next to the sea, a lake or a river, so nations line
   * the coasts and rivers and the inland gaps stay open. Prefers spots far from other
   * nations, and of a few such spots the one with the most room to grow.
   */
  freeSpot(region: Region, rng: Rng, targetArea: number, coastPreference = 0, minArea = 0): [number, number] | null {
    const { width } = this.map;
    const isFree = (i: number): boolean => this.owner[i] === 0;
    const free = Array.from(region.land).filter(isFree);
    if (!free.length) return null;
    const freeShore = Array.from(region.shore).filter(isFree);
    const pool = freeShore.length && rng.next() < coastPreference ? freeShore : free;
    const enough = Math.min(minArea, targetArea);
    let best: [number, number] | null = null;
    let bestArea = 0;
    const tryPixels = (candidates: number[], tries: number): void => {
      for (let t = 0; t < tries && candidates.length; t++) {
        const i = candidates[Math.floor(rng.next() * candidates.length)];
        const x = i % width;
        const y = (i - x) / width;
        // A test growth, undone straight away, to see how much room there is.
        const area = this.testGrow(x, y, targetArea);
        if (area >= enough && area > bestArea + 1e-6) {
          best = [x, y];
          bestArea = area;
        }
      }
    };
    tryPixels(this.farFromOthers(region, pool), 6);
    // Nothing roomy there: look anywhere that's free before giving up.
    if (!best) tryPixels(this.farFromOthers(region, free), 6);
    if (!best) tryPixels(free, 10);
    return best;
  }

  /** The free pixels that are at least 60% as far from any nation as the furthest one. */
  private farFromOthers(region: Region, free: number[]): number[] {
    if (!this.holdings.length) return free;
    // Distance (in steps) from the nearest owned pixel, inside the region's box.
    const { x0, y0, x1, y1 } = region.box;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const dist = new Int32Array(bw * bh).fill(-1);
    const queue = new Int32Array(bw * bh);
    let head = 0;
    let tail = 0;
    const { width } = this.map;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.owner[y * width + x] !== 0) {
          const b = (y - y0) * bw + (x - x0);
          dist[b] = 0;
          queue[tail++] = b;
        }
      }
    }
    if (tail === 0) return free;
    while (head < tail) {
      const b = queue[head++];
      const bx = b % bw;
      const by = (b - bx) / bw;
      const d = dist[b] + 1;
      if (bx > 0 && dist[b - 1] < 0) (dist[b - 1] = d), (queue[tail++] = b - 1);
      if (bx < bw - 1 && dist[b + 1] < 0) (dist[b + 1] = d), (queue[tail++] = b + 1);
      if (by > 0 && dist[b - bw] < 0) (dist[b - bw] = d), (queue[tail++] = b - bw);
      if (by < bh - 1 && dist[b + bw] < 0) (dist[b + bw] = d), (queue[tail++] = b + bw);
    }
    const distOf = (i: number): number => {
      const x = i % width;
      const y = (i - x) / width;
      return dist[(y - y0) * bw + (x - x0)];
    };
    let max = 0;
    for (const i of free) max = Math.max(max, distOf(i));
    return free.filter((i) => distOf(i) >= max * 0.6);
  }

  private testGrow(x: number, y: number, targetArea: number): number {
    const { pixels, area } = this.grow(TEST_ID, x, y, targetArea, 1);
    for (const i of pixels) this.owner[i] = 0;
    return area;
  }

  /** The growth itself (see the top of this file). Writes `id` into the grid as it goes. */
  private grow(id: number, sx: number, sy: number, targetArea: number, seed: number): { pixels: Int32Array; area: number } {
    const { width, height, terrain } = this.map;
    const { owner, key, seen, cost, areas, rules } = this;
    if (++this.stamp === 0xffffffff) {
      seen.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    const noise = wobbleField(createRng(seed), rules.wobble, 8);
    const takeable = (i: number): boolean => owner[i] === 0 && cost[terrain[i]] < Infinity;
    const wrapX = (x: number): number => (x < 0 ? x + width : x >= width ? x - width : x);
    const heap = new MinHeap();
    const start = sy * width + sx;
    key[start] = 0;
    seen[start] = stamp;
    heap.push(0, start);
    const taken: number[] = [];
    let area = 0;

    while (heap.size > 0 && area < targetArea) {
      const k = heap.topKey();
      const i = heap.pop();
      if (owner[i] !== 0 || k !== key[i]) continue; // already taken, or an out-of-date queue entry
      const x = i % width;
      const y = (i - x) / width;
      const pa = areas[y];
      // Stop if this pixel would overshoot the target by more than stopping short would miss it.
      if (taken.length > 0 && area + pa > targetArea && area + pa - targetArea > targetArea - area) break;
      owner[i] = id;
      taken.push(i);
      area += pa;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          let nx = x + dx;
          if (nx < 0 || nx >= width) {
            if (!this.map.wraps) continue;
            nx = wrapX(nx);
          }
          const j = ny * width + nx;
          if (!takeable(j)) continue;
          let step = 1;
          if (dx !== 0 && dy !== 0) {
            // A diagonal step may not squeeze between two pixels it couldn't walk through
            // (e.g. through a gap between two other nations, or across a corner of the sea).
            const sideA = y * width + nx;
            const sideB = ny * width + x;
            if (!takeable(sideA) && owner[sideA] !== id && !takeable(sideB) && owner[sideB] !== id) continue;
            step = Math.SQRT2;
          }
          const nd = key[i] + step * cost[terrain[j]] * noise(nx, ny);
          const fresh = seen[j] !== stamp;
          if (fresh || nd < key[j]) {
            seen[j] = stamp;
            key[j] = nd;
            heap.push(nd, j);
          }
        }
      }
    }
    const extra = this.tidy(id, sx, sy, taken, targetArea);
    // A trimmed pixel can come back as part of a filled hole, so leave those out of `taken`.
    const refilled = new Set(extra);
    const pixels = taken.filter((i) => owner[i] === id && !refilled.has(i)).concat(extra);
    let total = 0;
    for (const i of pixels) total += areas[(i / width) | 0];
    return { pixels: Int32Array.from(pixels), area: total };
  }

  /**
   * After growing: trims 1-pixel spurs and necks (and lets go of anything they cut off from
   * the start), then fills small free pockets inside the land, as long as that adds no more
   * than a tenth of the target (or one pixel), so sizes still match the roll. Returns the
   * pixels it filled.
   */
  private tidy(id: number, sx: number, sy: number, taken: number[], targetArea: number): number[] {
    if (taken.length < 4) return [];
    const { width, height, terrain } = this.map;
    const { owner, cost } = this;
    const start = sy * width + sx;
    const at = (x: number, y: number): number => {
      if (y < 0 || y >= height) return -1;
      if (x < 0 || x >= width) {
        if (!this.map.wraps) return -1;
        x = (x + width) % width;
      }
      return y * width + x;
    };
    const own = (j: number): boolean => j >= 0 && owner[j] === id;

    // 1. Trim: a pixel touching only one own pixel (a spur), or two on opposite sides with
    //    nothing else (a 1-pixel-wide string or neck). A few passes eat strings from the ends.
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const i of taken) {
        if (owner[i] !== id || i === start) continue;
        const x = i % width;
        const y = (i - x) / width;
        const l = own(at(x - 1, y));
        const r = own(at(x + 1, y));
        const u = own(at(x, y - 1));
        const d = own(at(x, y + 1));
        const n = +l + +r + +u + +d;
        if (n <= 1 || (n === 2 && ((l && r) || (u && d)))) {
          owner[i] = 0;
          changed = true;
        }
      }
      if (!changed) break;
    }
    // Keep only what's still joined to the start (side by side).
    const keep = new Set<number>([start]);
    const queue = [start];
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of SIDES) {
        const j = at(x + dx, y + dy);
        if (j >= 0 && owner[j] === id && !keep.has(j)) {
          keep.add(j);
          queue.push(j);
        }
      }
    }
    for (const i of taken) if (owner[i] === id && !keep.has(i)) owner[i] = 0;

    // 2. Fill holes: a free pocket of land touching only this nation (and water) is taken.
    const filled: number[] = [];
    const checked = new Set<number>();
    const limit = this.rules.holeSize;
    if (limit <= 0) return filled;
    let room = Math.max(targetArea * 0.1, this.areas[sy]);
    const free = (j: number): boolean => j >= 0 && owner[j] === 0 && cost[terrain[j]] < Infinity;
    for (const i of keep) {
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of SIDES) {
        const seed = at(x + dx, y + dy);
        if (!free(seed) || checked.has(seed)) continue;
        // Flood the pocket; give up once it's too big or touches someone else (or open land).
        const pocket = [seed];
        checked.add(seed);
        let enclosed = true;
        for (let p = 0; p < pocket.length && enclosed; p++) {
          const px = pocket[p] % width;
          const py = (pocket[p] - px) / width;
          for (const [ex, ey] of SIDES) {
            const j = at(px + ex, py + ey);
            if (j < 0) {
              enclosed = false;
              break;
            }
            if (owner[j] === id || checked.has(j)) continue;
            if (free(j)) {
              checked.add(j);
              pocket.push(j);
              if (pocket.length > limit) enclosed = false;
            } else if (owner[j] !== 0) enclosed = false; // another nation
          }
        }
        const pocketArea = pocket.reduce((sum, j) => sum + this.areas[(j / width) | 0], 0);
        if (enclosed && pocketArea <= room) {
          for (const j of pocket) owner[j] = id;
          filled.push(...pocket);
          room -= pocketArea;
        }
      }
    }
    return filled;
  }
}

/**
 * A smooth random field around 1 (e.g. 0.5–2): patches about `size` pixels across, plus
 * smaller ones. Multiplies the step cost, so some patches fill faster than others.
 */
function wobbleField(rng: Rng, strength: number, size: number): (x: number, y: number) => number {
  const salt = Math.floor(rng.next() * 0x7fffffff);
  if (strength <= 0) return () => 1;
  const lattice = (x: number, y: number): number => hash01(x, y, salt) * 2 - 1;
  const smooth = (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = lattice(ix, iy) + (lattice(ix + 1, iy) - lattice(ix, iy)) * sx;
    const bottom = lattice(ix, iy + 1) + (lattice(ix + 1, iy + 1) - lattice(ix, iy + 1)) * sx;
    return top + (bottom - top) * sy;
  };
  const small = size * 0.4;
  return (x, y) => Math.exp(strength * (smooth(x / size, y / size) + 0.5 * smooth(x / small + 100, y / small + 100)));
}

/** A repeatable random number in [0, 1) for a grid point. */
function hash01(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A binary min-heap of (key, pixel index) pairs, for the growth's "cheapest next" queue. */
class MinHeap {
  private keys = new Float64Array(1024);
  private values = new Int32Array(1024);
  size = 0;

  push(key: number, value: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
      const values = new Int32Array(this.size * 2);
      values.set(this.values);
      this.values = values;
    }
    let i = this.size++;
    const { keys, values } = this;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      values[i] = values[parent];
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }

  topKey(): number {
    return this.keys[0];
  }

  pop(): number {
    const { keys, values } = this;
    const top = values[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n];
      const value = values[n];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= key) break;
        keys[i] = keys[child];
        values[i] = values[child];
        i = child;
      }
      keys[i] = key;
      values[i] = value;
    }
    return top;
  }
}
