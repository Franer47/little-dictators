// Who owns which pixel, and how a new nation's starting land grows. Plain game logic: no
// drawing here (src/render/territoryLayer.ts draws it), so the simulation can build on it.
//
// How land grows: from the start pixel it always takes the cheapest pixel it can reach next
// (Dijkstra's shortest-path search). Each step costs the terrain's cost (plains 1, highlands
// more, mountains a lot, see public/data/placement.json) times a smooth random "wobble", so
// the land spreads quickly over plains, slowly into mountains, and the borders aren't
// perfect circles. It stops when the claimed area (real km², worked out from the map
// projection) reaches the rolled land size, or when there's nothing left to take: the sea,
// lakes, ice and other nations' land are never taken.

import { Terrain } from "../map/terrain.ts";
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
}

export interface PlacementData {
  region: string;
  regions: Record<string, RegionData>;
  fill: { percent: number; maxNations: number; maxAttempts: number };
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
  /** The outline's bounding box in map pixels. */
  readonly box: { x0: number; y0: number; x1: number; y1: number };

  constructor(
    readonly map: GameMap,
    readonly data: RegionData,
    claimable: (terrain: Terrain) => boolean,
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
    const { x0, y0, x1, y1 } = this.box;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [lon, lat] = pixelToLonLat(map.meta, x + 0.5, y + 0.5);
        if (!insideOutline(lon, lat, data.outline)) continue;
        const i = y * map.width + x;
        this.inside[i] = 1;
        if (claimable(map.terrain[i])) land.push(i);
      }
    }
    this.land = Int32Array.from(land);
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

/** The ownership grid: which nation owns each pixel. */
export class Territory {
  /** Owner id per pixel (y * width + x); 0 = nobody. */
  readonly owner: Uint16Array;
  readonly areas: Float64Array;
  /** By id: holdings[id - 1]. */
  readonly holdings: Holding[] = [];
  /** Cost to take each terrain (Infinity = never). */
  private readonly cost = new Float64Array(16).fill(Infinity);
  private readonly wobble: number;
  // Reused between growths, so a growth doesn't allocate map-sized arrays.
  private readonly dist: Float64Array;
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(
    readonly map: GameMap,
    rules: GrowthRules,
  ) {
    const size = map.width * map.height;
    this.owner = new Uint16Array(size);
    this.dist = new Float64Array(size);
    this.seen = new Uint32Array(size);
    this.areas = rowAreas(map);
    for (const [name, cost] of Object.entries(rules.cost)) {
      if (typeof cost === "number" && cost > 0) this.cost[Terrain[name as keyof typeof Terrain]] = cost;
    }
    this.wobble = rules.wobble;
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
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
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
    if (this.holdings.length >= 65535) throw new Error("Too many nations");
    if (!this.isFree(x, y)) throw new Error(`Pixel (${x}, ${y}) can't be settled`);
    const id = this.holdings.length + 1;
    const { pixels, area } = this.grow(id, x, y, targetArea, seed);
    const holding: Holding = { id, start: [x, y], rolledArea: targetArea, area, pixels };
    this.holdings.push(holding);
    return holding;
  }

  /** Removes every nation. */
  clear(): void {
    this.owner.fill(0);
    this.holdings.length = 0;
  }

  /**
   * A random free spot in the region for a nation of `targetArea` km². Prefers spots far
   * from other nations, and of a few such spots the one with the most room to grow.
   * Null if the region has no free land left.
   */
  freeSpot(region: Region, rng: Rng, targetArea?: number): [number, number] | null {
    const { width } = this.map;
    const free = Array.from(region.land).filter((i) => this.owner[i] === 0);
    if (!free.length) return null;
    const far = this.farFromOthers(region, free);
    const tries = targetArea === undefined ? 1 : Math.min(6, far.length);
    let best: [number, number] | null = null;
    let bestArea = -1;
    for (let t = 0; t < tries; t++) {
      const i = far[Math.floor(rng.next() * far.length)];
      const x = i % width;
      const y = (i - x) / width;
      // A test growth, undone straight away, to see how much room there is.
      const area = targetArea === undefined ? 0 : this.testGrow(x, y, targetArea);
      if (area > bestArea + 1e-6) {
        best = [x, y];
        bestArea = area;
      }
    }
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
    const { pixels, area } = this.grow(65535, x, y, targetArea, 1);
    for (const i of pixels) this.owner[i] = 0;
    return area;
  }

  /** The growth itself (see the top of this file). Writes `id` into the grid as it goes. */
  private grow(id: number, sx: number, sy: number, targetArea: number, seed: number): { pixels: Int32Array; area: number } {
    const { width, height, terrain } = this.map;
    const { owner, dist, seen, cost, areas } = this;
    const stamp = ++this.stamp;
    if (stamp === 0xffffffff) {
      seen.fill(0);
      this.stamp = 1;
    }
    const noise = wobbleField(createRng(seed), this.wobble);
    const heap = new MinHeap();
    const start = sy * width + sx;
    dist[start] = 0;
    seen[start] = this.stamp;
    heap.push(0, start);
    const pixels: number[] = [];
    let area = 0;
    const takeable = (i: number): boolean => owner[i] === 0 && cost[terrain[i]] < Infinity;

    while (heap.size > 0 && area < targetArea) {
      const d = heap.topKey();
      const i = heap.pop();
      if (owner[i] !== 0 || d > dist[i]) continue; // already taken, or a stale queue entry
      const x = i % width;
      const y = (i - x) / width;
      const pa = areas[y];
      // Stop if this pixel would overshoot the target by more than stopping short would miss it.
      if (pixels.length > 0 && area + pa > targetArea && area + pa - targetArea > targetArea - area) break;
      owner[i] = id;
      pixels.push(i);
      area += pa;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          let nx = x + dx;
          if (nx < 0 || nx >= width) {
            if (!this.map.wraps) continue;
            nx = (nx + width) % width;
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
          const nd = d + step * cost[terrain[j]] * noise(nx, ny);
          if (seen[j] !== this.stamp || nd < dist[j]) {
            seen[j] = this.stamp;
            dist[j] = nd;
            heap.push(nd, j);
          }
        }
      }
    }
    return { pixels: Int32Array.from(pixels), area };
  }
}

/**
 * A smooth random field around 1 (e.g. 0.5–2): patches about 8 pixels across, plus
 * smaller ones. Multiplies the step cost, so some patches fill faster than others.
 */
function wobbleField(rng: Rng, strength: number): (x: number, y: number) => number {
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
  return (x, y) => Math.exp(strength * (smooth(x / 8, y / 8) + 0.5 * smooth(x / 3 + 100, y / 3 + 100)));
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
