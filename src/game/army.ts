// Divisions and borders: how many divisions a peacetime army makes, and the border lines a
// nation's armies can stand along at home (src/sim/armies.ts groups the divisions into armies;
// src/render/armyLayer.ts draws them). Plain game logic, no drawing.
// The numbers are in public/data/eras/1500-stats.json, "divisions".

import type { GameMap } from "../map/gameMap.ts";
import { Terrain } from "../map/terrain.ts";

export interface DivisionRules {
  /** Troops in a new division. */
  size: number;
  /** How many troops "bigger" adds to a division. */
  growBy: number;
  /** The biggest a division can get. */
  maxSize: number;
  /** Below this stability the nation refuses any request. */
  minStability: number;
}

/** How many divisions the peacetime army makes (at least one for any army of half a division or more). */
export function baseDivisionCount(army: number, rules: DivisionRules): number {
  return army >= rules.size / 2 ? Math.max(1, Math.round(army / rules.size)) : 0;
}

/**
 * Where each nation's flags can stand: its land border (its future front line), or front and
 * coast together for a nation whose land border is short next to its coast (an island nation
 * with a small foothold on the mainland), or the player's "Defend" paint when there is some.
 * Each list is sorted to walk round the border, so flags can be spread evenly along it.
 * One pass over the map; work it out again only when the land or the Defend paint changes.
 */
export interface Borders {
  /** By nation id (index id − 1): the pixels to spread its flags over, in order round the border. */
  lines: Int32Array[];
}

export function findBorders(
  map: GameMap,
  owner: Uint16Array,
  count: number,
  /** The player's paint (src/sim/world.ts): pixels painted 2 ("Defend") are guarded first. */
  guard?: Uint8Array,
): Borders {
  const { width, height, terrain } = map;
  const n = count + 1;
  const isSea = (t: number): boolean => t === Terrain.Ocean || t === Terrain.ShallowWater;
  // Border kind per pixel: 2 = touches another nation or free land (front), 1 = touches the sea, 0 = inside.
  const kind = new Uint8Array(width * height);
  const frontCount = new Int32Array(n);
  const coastCount = new Int32Array(n);
  const anyPixel = new Int32Array(n).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const id = owner[i];
      if (id === 0 || id >= n) continue;
      if (anyPixel[id] < 0) anyPixel[id] = i;
      let k = 0;
      for (const [dx, dy] of SIDES) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const nx = map.wraps ? (x + dx + width) % width : x + dx;
        if (nx < 0 || nx >= width) continue;
        const j = ny * width + nx;
        if (owner[j] === id) continue;
        if (isSea(terrain[j])) k = Math.max(k, 1);
        else k = 2;
      }
      kind[i] = k;
      if (k === 2) frontCount[id]++;
      else if (k === 1) coastCount[id]++;
    }
  }
  // Each nation's border pixels: its front line only, or front and coast together when the
  // front is under a quarter of its whole border.
  const frontOnly = (id: number): boolean => frontCount[id] >= 0.25 * (frontCount[id] + coastCount[id]) && frontCount[id] > 0;
  const start = new Int32Array(n + 1);
  for (let id = 1; id < n; id++) start[id + 1] = start[id] + (frontOnly(id) ? frontCount[id] : frontCount[id] + coastCount[id]);
  const list = new Int32Array(start[n]);
  const fill = start.slice();
  for (let i = 0; i < owner.length; i++) {
    const id = owner[i];
    if (id === 0 || id >= n || kind[i] === 0) continue;
    if (kind[i] === 2 || !frontOnly(id)) list[fill[id]++] = i;
  }
  // Pixels painted "Defend", per nation (only the player paints, so this is short).
  const guarded = new Map<number, number[]>();
  if (guard) {
    for (let i = 0; i < guard.length; i++) {
      if (guard[i] !== 2) continue;
      const id = owner[i];
      if (id === 0 || id >= n) continue;
      if (!guarded.has(id)) guarded.set(id, []);
      guarded.get(id)!.push(i);
    }
  }
  const lines: Int32Array[] = [];
  for (let id = 1; id < n; id++) {
    const g = guarded.get(id);
    const raw = g?.length ? Int32Array.from(g) : list.subarray(start[id], start[id + 1]);
    lines.push(raw.length ? sortAround(raw, width, map.wraps) : anyPixel[id] >= 0 ? Int32Array.of(anyPixel[id]) : new Int32Array(0));
  }
  return { lines };
}

const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** A border's pixels sorted by angle around its middle, which walks round it. */
export function sortAround(border: Int32Array, width: number, wraps: boolean): Int32Array {
  const ref = border[0] % width;
  const half = width / 2;
  const dx = (i: number): number => {
    let d = (i % width) - ref;
    if (wraps) d = d >= half ? d - width : d < -half ? d + width : d;
    return d;
  };
  let sx = 0;
  let sy = 0;
  for (const i of border) {
    sx += dx(i);
    sy += (i / width) | 0;
  }
  const cx = sx / border.length;
  const cy = sy / border.length;
  const angle = new Map<number, number>();
  for (const i of border) angle.set(i, Math.atan2(((i / width) | 0) - cy, dx(i) - cx));
  return Int32Array.from(border).sort((a, b) => angle.get(a)! - angle.get(b)!);
}
