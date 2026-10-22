// War fronts: where two nations at war touch. Each warring nation's divisions stand along its
// front with the enemy (instead of along its whole border), and the map marks each war at the
// middle of its front with crossed swords. Worked out each month from the warring nations' own
// pixels only (a few dozen nations), so it's cheap.

import type { GameMap } from "../map/gameMap.ts";
import type { Territory } from "../game/territory.ts";
import type { World } from "./world.ts";

export interface Fronts {
  /** By nation id: its pixels that touch an enemy's, in no particular order. */
  byNation: Map<number, number[]>;
  /** By id × 65536 + enemy: id's pixels that touch that enemy (where its armies on that front stand). */
  byPair: Map<number, number[]>;
  /** Each war's front, for the swords on the map: the middle pixel, and the two leaders. */
  wars: { id: number; x: number; y: number; attacker: number; defender: number; mine: boolean }[];
}

const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function findFronts(map: GameMap, territory: Territory, w: World): Fronts {
  const enemies = new Map<number, Set<number>>();
  const addEnemy = (a: number, b: number): void => {
    if (!enemies.has(a)) enemies.set(a, new Set());
    enemies.get(a)!.add(b);
  };
  for (const war of w.wars) for (const a of war.attackers) for (const d of war.defenders) {
    addEnemy(a, d);
    addEnemy(d, a);
  }
  const { width } = map;
  const owner = territory.owner;
  const byNation = new Map<number, number[]>();
  const byPair = new Map<number, number[]>();
  // Pixels along the front between each pair (for the swords): key a*65536+b with a < b.
  const pairPixels = new Map<number, number[]>();
  for (const [id, foes] of enemies) {
    const holding = territory.holding(id);
    if (!holding) continue;
    const front: number[] = [];
    for (const i of holding.pixels) {
      if (owner[i] !== id) continue;
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of SIDES) {
        const p = map.normalize(x + dx, y + dy);
        if (!p) continue;
        const other = owner[p[1] * width + p[0]];
        if (other && foes.has(other)) {
          front.push(i);
          const own = id * 65536 + other;
          if (!byPair.has(own)) byPair.set(own, []);
          byPair.get(own)!.push(i);
          if (id < other) {
            const key = id * 65536 + other;
            if (!pairPixels.has(key)) pairPixels.set(key, []);
            pairPixels.get(key)!.push(i);
          }
          break;
        }
      }
    }
    if (front.length) byNation.set(id, front);
  }
  const mine = w.mineId;
  const wars: Fronts["wars"] = [];
  for (const war of w.wars) {
    const a = war.attackers[0];
    const d = war.defenders[0];
    if (!a || !d) continue;
    const pixels = pairPixels.get(a < d ? a * 65536 + d : d * 65536 + a);
    if (!pixels?.length) continue; // they don't touch (a war across the sea)
    // The front pixel nearest the middle of the front.
    const ref = pixels[0] % width;
    let sx = 0;
    let sy = 0;
    for (const i of pixels) {
      let dx = (i % width) - ref;
      if (map.wraps) dx = dx > width / 2 ? dx - width : dx < -width / 2 ? dx + width : dx;
      sx += dx;
      sy += (i / width) | 0;
    }
    const cx = ref + sx / pixels.length;
    const cy = sy / pixels.length;
    let best = pixels[0];
    let bestD = Infinity;
    for (const i of pixels) {
      let dx = (i % width) - cx;
      if (map.wraps) dx = dx > width / 2 ? dx - width : dx < -width / 2 ? dx + width : dx;
      const dy = ((i / width) | 0) - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    }
    const involved = [...war.attackers, ...war.defenders].includes(mine);
    wars.push({ id: war.id, x: best % width, y: (best / width) | 0, attacker: a, defender: d, mine: involved });
  }
  return { byNation, byPair, wars };
}
