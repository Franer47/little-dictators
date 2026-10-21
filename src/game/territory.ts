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
// - It can also cross short stretches of sea ("seaCrossing": dear per sea pixel, and only so
//   wide), so a nation on an island can spread to the next island or the mainland when it
//   runs out of room. The sea itself is never owned.
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
  /**
   * Evens out the flat map's stretching away from the equator (see targetFor): 0 = real km²
   * (northern nations look bigger), 1 = the same size on the map, 0.5 = halfway.
   */
  latitudeBalance?: number;
  /**
   * Growth may cross the sea to reach nearby land (an island nation spreading to the next
   * island or the mainland): each sea pixel costs `cost` (plains = 1), and it never crosses
   * more than `maxWidth` sea pixels in a row. The sea itself is never owned.
   */
  seaCrossing?: { cost: number; maxWidth: number };
}

export interface StartRules {
  /** How often (0..1) "Surprise me" and Fill pick a spot next to the sea, a lake or a river. */
  coastPreference: number;
  /** They never start a nation in a free pocket of land smaller than this (km²)… */
  minGap: number;
  /** …or in a pocket surrounded by just one nation (an enclave) unless it's at least this big (km²). */
  enclaveArea: number;
}

/** What a random start looks for (see freeSpot). */
export interface SpotRules {
  coastPreference?: number;
  /** The test growth must reach at least this (or the whole target, if smaller). */
  minArea?: number;
  minGap?: number;
  enclaveArea?: number;
}

export interface FillRules {
  /** Fill stops making new nations when this share (%) of the region's land is owned (then neighbours take the rest)… */
  percent: number;
  /** …or when no gap has room for a nation of at least this many km²… */
  minArea: number;
  /** …or after this many nations or tries. */
  maxNations: number;
  maxAttempts: number;
  /** Fill leaves land sizes below this (km²) off its nations' wheel (no dot-sized nations). */
  smallestRoll?: number;
  /** Fill places about one nation per this many km² of free land per look at the map (speed). */
  batchArea: number;
  /** At the end of a fill, nations spread up to this many pixels at a time into the leftover land and islands. */
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
  const res = await fetch(`${import.meta.env.BASE_URL}data/placement.json`);
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

/** A look at the region's free land (see Territory.survey). */
export interface Survey {
  room: { left: number; taken: number; biggestGap: number };
  free: number[];
  shore: number[];
  farFree: number[];
  farShore: number[];
}

/** One nation's land. */
export interface Holding {
  /** Its number in the ownership grid (1, 2, 3…; 0 means nobody). */
  id: number;
  /** The pixel it started from. */
  start: [number, number];
  /** The land size it rolled on the wheel, km². */
  rolledArea: number;
  /** What it was meant to get here, km²: the roll, evened out for the latitude (see targetFor). */
  targetArea: number;
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
  // Reused by survey() for the distance-from-nations field.
  private boxDist = new Int32Array(0);
  private boxQueue = new Int32Array(0);
  // Reused by grow(): how many sea pixels in a row the best path to a pixel crossed, and
  // whether that path came ashore from the sea.
  private seaRun: Uint8Array;
  private bySea: Uint8Array;
  /** Per pixel: the size (km²) of the free pocket it was in at the last survey (good pockets only). */
  private pocketArea: Float32Array;
  /** The area of a pixel at the equator (the biggest), km². */
  private readonly biggestPixel: number;

  constructor(
    readonly map: GameMap,
    private rules: GrowthRules,
  ) {
    const size = map.width * map.height;
    this.owner = new Uint16Array(size);
    this.key = new Float64Array(size);
    this.seen = new Uint32Array(size);
    this.pocketArea = new Float32Array(size);
    this.seaRun = new Uint8Array(size);
    this.bySea = new Uint8Array(size);
    this.areas = rowAreas(map);
    this.biggestPixel = Math.max(...this.areas);
    for (const [name, cost] of Object.entries(rules.cost)) {
      if (typeof cost === "number" && cost > 0) this.cost[Terrain[name as keyof typeof Terrain]] = cost;
    }
  }

  /**
   * The land a nation that rolled `rolled` km² should get when it starts in map row y. The
   * flat map stretches land away from the equator (a pixel in Europe covers about half the
   * km² of one in Africa), so equal rolls would look about twice as big up north. This scales
   * the km² by (pixel area here / pixel area at the equator) ^ latitudeBalance.
   */
  targetFor(rolled: number, y: number): number {
    const balance = this.rules.latitudeBalance ?? 0;
    return balance > 0 ? rolled * (this.areas[y] / this.biggestPixel) ** balance : rolled;
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
    const holding: Holding = { id, start: [x, y], rolledArea: targetArea, targetArea: this.targetFor(targetArea, y), area, pixels };
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

  /**
   * Gives these pixels to nation `to` (a peace treaty's land). Keeps every affected nation's
   * area and pixel list right. A nation left with no pixels keeps its (empty) holding.
   */
  transfer(pixels: readonly number[], to: number): void {
    const { width } = this.map;
    const target = this.holding(to);
    if (!target) return;
    const losers = new Set<number>();
    const moved: number[] = [];
    for (const i of pixels) {
      const from = this.owner[i];
      if (from === to) continue;
      moved.push(i);
      const a = this.areas[(i / width) | 0];
      const loser = from ? this.holding(from) : undefined;
      if (loser) {
        loser.area -= a;
        losers.add(from);
      }
      this.owner[i] = to;
      target.area += a;
    }
    for (const id of losers) {
      const h = this.holding(id)!;
      h.pixels = h.pixels.filter((i) => this.owner[i] === id);
    }
    const grown = new Int32Array(target.pixels.length + moved.length);
    grown.set(target.pixels);
    grown.set(moved, target.pixels.length);
    target.pixels = grown;
  }

  /**
   * Restores a saved map: the ownership grid and each nation's holding (its start, sizes, and
   * the pixels and area worked out again from the grid).
   */
  restore(owner: Uint16Array, nations: readonly { start: [number, number]; rolledArea: number; targetArea: number }[]): void {
    this.owner.set(owner);
    this.holdings.length = 0;
    const lists: number[][] = nations.map(() => []);
    const areas = new Float64Array(nations.length);
    const { width } = this.map;
    for (let i = 0; i < owner.length; i++) {
      const id = owner[i];
      if (!id || id > nations.length) continue;
      lists[id - 1].push(i);
      areas[id - 1] += this.areas[(i / width) | 0];
    }
    nations.forEach((n, k) => {
      this.holdings.push({ id: k + 1, start: n.start, rolledArea: n.rolledArea, targetArea: n.targetArea, area: areas[k], pixels: Int32Array.from(lists[k]) });
    });
  }

  /** Removes every nation. */
  clear(): void {
    this.owner.fill(0);
    this.holdings.length = 0;
  }

  /**
   * A look at the region's free land, used to pick start spots. It's the slow part of
   * placing a nation on a big map, so Fill takes one and places several nations with it.
   * - `room`: free land left (km²), how much is taken (0..1), the biggest free patch (km²).
   * - `free` / `shore`: free pixels in pockets a new nation may start in (at least `minGap`
   *   km², and not an enclave inside one nation unless at least `enclaveArea` km²), and the
   *   ones of those next to water.
   * - `farFree` / `farShore`: the same, only those at least 60% as far from any nation as
   *   the furthest one.
   */
  survey(region: Region, rules: SpotRules = {}): Survey {
    const { width, height, terrain } = this.map;
    const { owner, areas, cost } = this;
    const minGap = rules.minGap ?? 0;
    const enclaveArea = rules.enclaveArea ?? 0;
    if (++this.stamp >= 0xfffffffe) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const visited = this.stamp;
    const good = ++this.stamp;
    const seen = this.seen;
    const wraps = this.map.wraps;
    const isFree = (i: number): boolean => owner[i] === 0 && region.inside[i] === 1 && cost[terrain[i]] < Infinity;

    // 1. Flood each free pocket once: its size, and whether it's inside a single nation.
    let total = 0;
    let left = 0;
    let biggestGap = 0;
    const pocket: number[] = [];
    for (const start of region.land) {
      total += areas[(start / width) | 0];
      if (owner[start] !== 0 || seen[start] === visited || seen[start] === good) continue;
      pocket.length = 0;
      pocket.push(start);
      seen[start] = visited;
      let area = 0;
      let firstOwner = 0;
      let manyOwners = false;
      for (let k = 0; k < pocket.length; k++) {
        const j = pocket[k];
        const x = j % width;
        const y = (j - x) / width;
        area += areas[y];
        for (let s = 0; s < 4; s++) {
          let nx = x + SIDES[s][0];
          const ny = y + SIDES[s][1];
          if (ny < 0 || ny >= height) continue;
          if (nx < 0 || nx >= width) {
            if (!wraps) continue;
            nx = nx < 0 ? nx + width : nx - width;
          }
          const n = ny * width + nx;
          const o = owner[n];
          if (o !== 0) {
            if (firstOwner === 0) firstOwner = o;
            else if (o !== firstOwner) manyOwners = true;
          } else if (seen[n] !== visited && isFree(n)) {
            seen[n] = visited;
            pocket.push(n);
          }
        }
      }
      biggestGap = Math.max(biggestGap, area);
      const enclave = firstOwner !== 0 && !manyOwners;
      if (area >= minGap && (!enclave || area >= enclaveArea)) {
        for (const j of pocket) {
          seen[j] = good;
          this.pocketArea[j] = area;
        }
      }
    }
    // Rivers count as free land in the pockets but not in `region.land`; keep "left" to region.land.
    left = 0;
    for (const i of region.land) if (owner[i] === 0) left += areas[(i / width) | 0];
    const room = { left, taken: total > 0 ? 1 - left / total : 0, biggestGap };
    const free = Array.from(region.land).filter((i) => seen[i] === good);
    const shore = Array.from(region.shore).filter((i) => seen[i] === good);
    if (!this.holdings.length) return { room, free, shore, farFree: free, farShore: shore };

    // 2. Distance (in steps) from the nearest owned pixel, inside the region's box.
    const { x0, y0, x1, y1 } = region.box;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (this.boxDist.length < bw * bh) {
      this.boxDist = new Int32Array(bw * bh);
      this.boxQueue = new Int32Array(bw * bh);
    }
    const dist = this.boxDist;
    const queue = this.boxQueue;
    dist.fill(-1, 0, bw * bh);
    let head = 0;
    let tail = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (owner[y * width + x] !== 0) {
          const b = (y - y0) * bw + (x - x0);
          dist[b] = 0;
          queue[tail++] = b;
        }
      }
    }
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
    const far = (list: number[]): number[] => {
      const distOf = (i: number): number => {
        const x = i % width;
        return dist[(((i - x) / width) - y0) * bw + (x - x0)];
      };
      let max = 0;
      for (const i of list) max = Math.max(max, distOf(i));
      return list.filter((i) => distOf(i) >= max * 0.6);
    };
    return { room, free, shore, farFree: far(free), farShore: far(shore) };
  }

  /** Free land left in the region (km²), how much is taken (0..1), and the biggest free patch (km²). */
  room(region: Region): Survey["room"] {
    return this.survey(region).room;
  }

  /**
   * A random free spot in the region for a nation of `targetArea` km², or null if no
   * suitable pocket has room for at least `minArea` km² (or the whole target, if smaller).
   * Usually (`coastPreference`) a spot next to the sea, a lake or a river, so nations line
   * the coasts and rivers and the inland gaps stay open. Prefers spots far from other
   * nations, and of a few such spots the one with the most room to grow.
   */
  freeSpot(region: Region, rng: Rng, targetArea: number, rules: SpotRules = {}): [number, number] | null {
    return this.spotFrom(this.survey(region, rules), rng, targetArea, rules);
  }

  /**
   * A start pixel from a survey, chosen the same way as in spotFrom (coast first, far from
   * others, not taken since, not too close to `avoid`) but before the nation is rolled, so
   * its land size can depend on the free land around it. -1 if none is found.
   */
  pickStart(survey: Survey, rng: Rng, rules: SpotRules = {}, avoid: Holding[] = []): number {
    const { width } = this.map;
    const pools = [survey.farShore.length && rng.next() < (rules.coastPreference ?? 0) ? survey.farShore : survey.farFree, survey.farFree, survey.free];
    for (const pool of pools) {
      for (let pick = 0; pick < 30 && pool.length; pick++) {
        const i = pool[Math.floor(rng.next() * pool.length)];
        if (this.owner[i] !== 0) continue;
        const x = i % width;
        const y = (i - x) / width;
        if (avoid.some((h) => this.nearHolding(x, y, 0, h))) continue;
        return i;
      }
    }
    return -1;
  }

  /** The size (km²) of the free pocket pixel i was in at the last survey. */
  pocketAt(i: number): number {
    return this.pocketArea[i];
  }

  /** Test-grows a nation of `targetArea` from pixel i (undone straight away): the area it would get. */
  roomAt(i: number, targetArea: number): number {
    const x = i % this.map.width;
    return this.testGrow(x, (i - x) / this.map.width, targetArea);
  }

  /** True if (x, y) is closer to holding h's start than their two expected radii together. */
  private nearHolding(x: number, y: number, ownRadius: number, h: Holding): boolean {
    const { width } = this.map;
    let dx = Math.abs(x - h.start[0]);
    if (this.map.wraps) dx = Math.min(dx, width - dx);
    const dy = y - h.start[1];
    const r = ownRadius + Math.sqrt(h.area / this.areas[h.start[1]] / Math.PI);
    return dx * dx + dy * dy < r * r;
  }

  /**
   * Like freeSpot, from a survey that may be a little out of date (Fill places several
   * nations per survey): pixels taken since are skipped, and so are spots too close to the
   * nations in `avoid` (placed since the survey).
   */
  spotFrom(survey: Survey, rng: Rng, targetArea: number, rules: SpotRules = {}, avoid: Holding[] = []): [number, number] | null {
    const { coastPreference = 0, minArea = 0 } = rules;
    const { width } = this.map;
    const enough = Math.min(minArea, targetArea);
    const tooClose = (x: number, y: number): boolean => {
      const own = Math.sqrt(targetArea / this.areas[y] / Math.PI);
      return avoid.some((h) => this.nearHolding(x, y, own, h));
    };
    let best: [number, number] | null = null;
    let bestArea = 0;
    const tryPixels = (candidates: number[], tries: number): void => {
      let tested = 0;
      for (let pick = 0; pick < tries * 6 && tested < tries && candidates.length; pick++) {
        const i = candidates[Math.floor(rng.next() * candidates.length)];
        if (this.owner[i] !== 0) continue;
        const x = i % width;
        const y = (i - x) / width;
        if (tooClose(x, y)) continue;
        tested++;
        // A test growth, undone straight away, to see how much room there is.
        const area = this.testGrow(x, y, targetArea);
        if (area >= enough && area > bestArea + 1e-6) {
          best = [x, y];
          bestArea = area;
        }
      }
    };
    const pool = survey.farShore.length && rng.next() < coastPreference ? survey.farShore : survey.farFree;
    tryPixels(pool, 6);
    // Nothing roomy there: look anywhere that's free before giving up.
    if (!best) tryPixels(survey.farFree, 6);
    if (!best) tryPixels(survey.free, 10);
    return best;
  }

  private testGrow(x: number, y: number, targetArea: number): number {
    const { pixels, area } = this.grow(TEST_ID, x, y, targetArea, 1);
    for (const i of pixels) this.owner[i] = 0;
    return area;
  }

  /** The growth itself (see the top of this file). Writes `id` into the grid as it goes. */
  private grow(id: number, sx: number, sy: number, rolledArea: number, seed: number): { pixels: Int32Array; area: number } {
    const targetArea = this.targetFor(rolledArea, sy);
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
    const { seaRun, bySea } = this;
    const seaCost = rules.seaCrossing?.cost ?? 0;
    const maxSea = seaCost > 0 ? Math.min(255, rules.seaCrossing?.maxWidth ?? 0) : 0;
    /** Sea (or lake) that growth may cross but never own. */
    const isSea = (i: number): boolean => terrain[i] === Terrain.Ocean || terrain[i] === Terrain.ShallowWater;
    const heap = new MinHeap();
    const start = sy * width + sx;
    key[start] = 0;
    seen[start] = stamp;
    seaRun[start] = 0;
    bySea[start] = 0;
    heap.push(0, start);
    const taken: number[] = [];
    /** The start, plus every pixel the land reached over the sea (each holds a part of the nation). */
    const roots: number[] = [start];
    let area = 0;
    const relax = (j: number, nd: number, run: number, fromSea: boolean): void => {
      if (seen[j] !== stamp || nd < key[j]) {
        seen[j] = stamp;
        key[j] = nd;
        seaRun[j] = run;
        bySea[j] = fromSea ? 1 : 0;
        heap.push(nd, j);
      }
    };

    while (heap.size > 0 && area < targetArea) {
      const k = heap.topKey();
      const i = heap.pop();
      if (owner[i] !== 0 || k !== key[i]) continue; // already taken, or an out-of-date queue entry
      const x = i % width;
      const y = (i - x) / width;
      if (maxSea > 0 && isSea(i)) {
        // Out at sea: carry on across it (side steps only), up to maxSea pixels in a row.
        for (const [dx, dy] of SIDES) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          let nx = x + dx;
          if (nx < 0 || nx >= width) {
            if (!this.map.wraps) continue;
            nx = wrapX(nx);
          }
          const j = ny * width + nx;
          if (isSea(j)) {
            if (seaRun[i] < maxSea) relax(j, k + seaCost, seaRun[i] + 1, false);
          } else if (takeable(j)) relax(j, k + cost[terrain[j]] * noise(nx, ny), 0, true);
        }
        continue;
      }
      const pa = areas[y];
      // Stop if this pixel would overshoot the target by more than stopping short would miss it.
      if (taken.length > 0 && area + pa > targetArea && area + pa - targetArea > targetArea - area) break;
      owner[i] = id;
      taken.push(i);
      area += pa;
      if (bySea[i] && i !== start) roots.push(i);

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
          if (maxSea > 0 && dx * dy === 0 && isSea(j)) {
            relax(j, key[i] + seaCost, 1, false);
            continue;
          }
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
          relax(j, key[i] + step * cost[terrain[j]] * noise(nx, ny), 0, false);
        }
      }
    }
    const extra = this.tidy(id, roots, taken, targetArea);
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
  private tidy(id: number, roots: number[], taken: number[], targetArea: number): number[] {
    if (taken.length < 4) return [];
    const { width, height, terrain } = this.map;
    const { owner, cost } = this;
    const start = roots[0];
    const sy = (start / width) | 0;
    const isRoot = new Set(roots);
    const at = (x: number, y: number): number => {
      if (y < 0 || y >= height) return -1;
      if (x < 0 || x >= width) {
        if (!this.map.wraps) return -1;
        x = (x + width) % width;
      }
      return y * width + x;
    };
    const own = (j: number): boolean => j >= 0 && owner[j] === id;

    // Around pixel c, without c itself: how many separate parts of the nation there are that are
    // big (more than `partLimit` pixels) or hold the start. Small parts would just fall off.
    const partLimit = Math.max(4, this.rules.holeSize);
    const bigParts = (c: number): number => {
      const cx = c % width;
      const cy = (c - cx) / width;
      const reached = new Set<number>([c]);
      let big = 0;
      for (const q of around8(cx, cy)) {
        if (!own(q) || reached.has(q)) continue;
        const part = [q];
        reached.add(q);
        let isBig = false;
        for (let k = 0; k < part.length && !isBig; k++) {
          if (isRoot.has(part[k]) || part.length > partLimit) isBig = true;
          const px = part[k] % width;
          for (const r of around8(px, (part[k] - px) / width)) {
            if (own(r) && !reached.has(r)) {
              reached.add(r);
              part.push(r);
            }
          }
        }
        if (isBig) big++;
      }
      return big;
    };
    const around8 = (x: number, y: number): number[] => {
      const list: number[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) list.push(at(x + dx, y + dy));
      return list;
    };

    // 1. Trim: a pixel touching only one own pixel (a spur), or two on opposite sides with
    //    nothing else (a 1-pixel-wide string or neck). A few passes eat strings from the ends.
    //    A neck is only cut if what falls off is small (a snake's tip), never when it holds
    //    two big parts together (e.g. where the land crosses a river).
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const i of taken) {
        if (owner[i] !== id || isRoot.has(i)) continue;
        const x = i % width;
        const y = (i - x) / width;
        const l = own(at(x - 1, y));
        const r = own(at(x + 1, y));
        const u = own(at(x, y - 1));
        const d = own(at(x, y + 1));
        const n = +l + +r + +u + +d;
        if ((n <= 1 || (n === 2 && ((l && r) || (u && d)))) && bigParts(i) <= 1) {
          owner[i] = 0;
          changed = true;
        }
      }
      if (!changed) break;
    }
    // Keep only what's still joined to the start, or to a place it came ashore from the sea
    // (corners count: growth steps diagonally too).
    const keep = new Set<number>(roots.filter((r) => owner[r] === id));
    const queue = [...keep];
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      for (const j of around8(x, y)) {
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
