// Armies on the map: every nation's soldiers are split into divisions (a little flag each),
// spread along its borders, ready to hold the front when wars come (milestone 5). The player
// can ask their nation for a new division or a bigger one; the nation decides at once whether
// it can (money, men, stability). Plain game logic, no drawing (src/render/divisionLayer.ts).
// The numbers are in public/data/eras/1500-stats.json, "divisions".

import type { GameMap } from "../map/gameMap.ts";
import { Terrain } from "../map/terrain.ts";
import { compactNumber } from "./numbers.ts";
import type { StatSheet } from "./stats.ts";

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

export interface Division {
  /** Its owner's nation id. */
  nation: number;
  /** Its number within the nation (0 = the 1st division). */
  index: number;
  troops: number;
  /** Where its flag stands (map pixel). */
  x: number;
  y: number;
  /** Asked for by the player: it trains once time runs (milestone 4). */
  training: boolean;
}

/** What the player asked one nation for: extra divisions, and extra troops on existing ones (by index). */
export interface ArmyOrders {
  added: number[];
  grown: Map<number, number>;
}

export function emptyOrders(): ArmyOrders {
  return { added: [], grown: new Map() };
}

/** Troops the player asked for in total (they are added to the nation's army and its upkeep). */
export function orderedTroops(orders: ArmyOrders | undefined): number {
  if (!orders) return 0;
  let sum = 0;
  for (const t of orders.added) sum += t;
  for (const t of orders.grown.values()) sum += t;
  return sum;
}

/** How many divisions the peacetime army makes (at least one for any army of half a division or more). */
export function baseDivisionCount(army: number, rules: DivisionRules): number {
  return army >= rules.size / 2 ? Math.max(1, Math.round(army / rules.size)) : 0;
}

/**
 * Every nation's divisions, with their flags spread evenly along its land borders (its future
 * front line). A nation whose land border is short next to its coast (an island nation with a
 * small foothold on the mainland) guards its coast too. One pass over the map finds every
 * nation's border pixels.
 */
export function placeDivisions(
  map: GameMap,
  owner: Uint16Array,
  sheets: readonly StatSheet[],
  rules: DivisionRules,
  orders: ReadonlyMap<number, ArmyOrders>,
): Division[] {
  const { width, height, terrain } = map;
  const n = sheets.length + 1;
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
  // Each nation's border pixels in one flat list: its front line only, or front and coast together
  // when the front is under a quarter of its whole border.
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

  const out: Division[] = [];
  for (let id = 1; id < n; id++) {
    const sheet = sheets[id - 1];
    const o = orders.get(id);
    const troops: number[] = [];
    for (let k = baseDivisionCount(sheet.baseArmy, rules); k > 0; k--) troops.push(rules.size);
    const base = troops.length;
    if (o) for (const t of o.added) troops.push(t);
    if (o) for (const [index, extra] of o.grown) if (index < troops.length) troops[index] += extra;
    if (!troops.length) continue;
    const spots = spreadAlong(list.subarray(start[id], start[id + 1]), troops.length, width, map.wraps, anyPixel[id]);
    troops.forEach((t, index) => {
      const p = spots[index];
      out.push({ nation: id, index, troops: t, x: p % width, y: (p / width) | 0, training: index >= base || (o?.grown.has(index) ?? false) });
    });
  }
  return out;
}

const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * `count` pixels spread evenly along a border: sorted by angle around the border's middle
 * (which walks round it), then every (length / count)th one.
 */
function spreadAlong(border: Int32Array, count: number, width: number, wraps: boolean, fallback: number): number[] {
  if (!border.length) return new Array(count).fill(Math.max(0, fallback));
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
  const sorted = Array.from(border).sort((a, b) => Math.atan2(((a / width) | 0) - cy, dx(a) - cx) - Math.atan2(((b / width) | 0) - cy, dx(b) - cx));
  const spots: number[] = [];
  for (let k = 0; k < count; k++) spots.push(sorted[Math.floor(((k + 0.5) * sorted.length) / count)]);
  return spots;
}

export interface Decision {
  ok: boolean;
  /** Why, in plain words. */
  reason: string;
}

/**
 * Whether a nation agrees to raise `troops` more soldiers. It refuses when it's too unstable,
 * when it hasn't got the men (its manpower), or when it can't pay for them every year.
 */
export function decideRequest(sheet: StatSheet, troops: number, rules: DivisionRules, suffixes: string[]): Decision {
  const s = sheet.stats;
  const cost = troops * sheet.factors.soldierCost.value;
  const money = (v: number): string => (v < 0 ? "−$" : "$") + compactNumber(Math.abs(Math.round(v)), suffixes);
  const people = (v: number): string => compactNumber(Math.round(v), suffixes);
  if (s.stability.value < rules.minStability)
    return { ok: false, reason: `Refused: the state is too unstable (stability ${Math.round(s.stability.value)}, needs ${rules.minStability}) to raise new troops.` };
  if (s.army.value + troops > s.manpower.value)
    return { ok: false, reason: `Refused: not enough men. The army would be ${people(s.army.value + troops)}, but only ${people(s.manpower.value)} can be called up.` };
  if (s.net.value - cost < 0)
    return { ok: false, reason: `Refused: it can't pay for them. ${people(troops)} more soldiers cost ${money(cost)} a year, and its net income is only ${money(s.net.value)}.` };
  return { ok: true, reason: `Agreed: ${people(troops)} more soldiers for ${money(cost)} a year. They're in training and will be ready once time runs.` };
}

/** "1st", "2nd", "3rd", "4th"… */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
