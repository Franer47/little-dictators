// Where each nation's name goes on the map: across the middle of its biggest piece of land,
// tilted along its longest direction and as big as the land allows (like the names on a
// Paradox map). Plain math on the ownership grid; src/render/labelLayer.ts draws them.

import type { GameMap } from "../map/gameMap.ts";

export interface LabelSpot {
  /** Middle of the land, in map pixels (x may be outside 0..width on a nation across the seam). */
  x: number;
  y: number;
  /** Tilt in radians (kept between -60° and 60° so names never read upside down). */
  angle: number;
  /** How long and how thick the land is along that tilt, in map pixels. */
  length: number;
  thickness: number;
}

const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** One label spot per nation 1..count (index id - 1; null for a nation with no land). */
export function labelSpots(map: GameMap, owner: Uint16Array, count: number): (LabelSpot | null)[] {
  const { width, height } = map;
  const n = count + 1;
  const best: (LabelSpot & { size: number })[] = new Array(n);
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const half = width / 2;
  for (let startPixel = 0; startPixel < owner.length; startPixel++) {
    const id = owner[startPixel];
    if (id === 0 || id >= n || seen[startPixel]) continue;
    // Flood this piece of land, adding up its pixels' positions (x measured from its first pixel).
    const refX = startPixel % width;
    let size = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let top = 0;
    stack[top++] = startPixel;
    seen[startPixel] = 1;
    while (top > 0) {
      const i = stack[--top];
      const x = i % width;
      const y = (i - x) / width;
      let dx = x - refX;
      if (map.wraps) dx = dx >= half ? dx - width : dx < -half ? dx + width : dx;
      size++;
      sx += dx;
      sy += y;
      sxx += dx * dx;
      syy += y * y;
      sxy += dx * y;
      for (const [ox, oy] of SIDES) {
        const ny = y + oy;
        if (ny < 0 || ny >= height) continue;
        let nx = x + ox;
        if (nx < 0 || nx >= width) {
          if (!map.wraps) continue;
          nx = (nx + width) % width;
        }
        const j = ny * width + nx;
        if (seen[j] || owner[j] !== id) continue;
        seen[j] = 1;
        stack[top++] = j;
      }
    }
    if (best[id] && best[id].size >= size) continue;
    // The land's main direction from how its pixels spread (its covariance).
    const mx = sx / size;
    const my = sy / size;
    const cxx = sxx / size - mx * mx;
    const cyy = syy / size - my * my;
    const cxy = sxy / size - mx * my;
    let angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const mid = (cxx + cyy) / 2;
    const diff = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
    let major = mid + diff;
    let minor = Math.max(0, mid - diff);
    // Steep names are hard to read: past 60° turn the name the other way along the land.
    if (Math.abs(angle) > Math.PI / 3) {
      angle = angle > 0 ? angle - Math.PI / 2 : angle + Math.PI / 2;
      [major, minor] = [minor, major];
    }
    // A uniform strip of length L spreads with variance L²/12.
    best[id] = { x: refX + mx + 0.5, y: my + 0.5, angle, length: Math.sqrt(12 * major), thickness: Math.sqrt(12 * minor), size };
  }
  const out: (LabelSpot | null)[] = [];
  for (let id = 1; id < n; id++) {
    const b = best[id];
    out.push(b ? { x: b.x, y: b.y, angle: b.angle, length: b.length, thickness: b.thickness } : null);
  }
  return out;
}

/** The name to write on the map: just the place, e.g. "Haluya" from "Most Holy Great Sultanate of Haluya". */
export function mapName(name: string): string {
  const of = name.indexOf(" of ");
  return (of >= 0 ? name.slice(of + 4) : name).replace(/^the /i, "");
}
