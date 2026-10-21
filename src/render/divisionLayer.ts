// Army flags on the map: one little flag per division in its nation's colour, with its troops.
// Flags only show when zoomed in close (further out they'd cover the map). Up close, a nation's
// flags that would overlap merge into one with their total; zoom in more to see every division.
// The nation whose Army section is open shows its flags from further out (one flag per army).
// Divisions in training have a striped flag; the selected one is gold.

import type { Division } from "../game/army.ts";
import { compactNumber } from "../game/numbers.ts";
import type { MapOverlay, MapView } from "./mapRenderer.ts";

/** Flags show from this zoom (CSS pixels per map pixel); further out they'd cover the map. */
const MIN_ZOOM = 7;
/** The nation in focus (its Army section is open) shows from this zoom. */
const FOCUS_MIN_ZOOM = 1.5;
/** Below this zoom each nation's army is one flag. */
const WHOLE_ARMY_ZOOM = 5;
/** About how close (CSS pixels) a nation's flags may stand before they merge. */
const MERGE_PX = 44;

interface Hit {
  /** Where the flag is drawn, CSS pixels. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  nation: number;
  indices: number[];
}

/** Adds up the divisions of one flag while grouping. */
interface Sum {
  nation: number;
  troops: number;
  training: number;
  indices: number[];
  refX: number;
  dx: number;
  y: number;
}

/** One flag on the map: one division, or several merged. Positions in map pixels. */
interface Group {
  nation: number;
  troops: number;
  x: number;
  y: number;
  training: number;
  indices: number[];
}

export class DivisionLayer implements MapOverlay {
  private list: Division[] = [];
  /** Each nation's colour, by id. */
  colorOf: (nation: number) => string = () => "#888";
  selected: { nation: number; index: number } | null = null;
  /** The nation whose Army section is open (0 = none): its flags show from further out. */
  focus = 0;
  visible = true;
  private hits: Hit[] = [];
  /**
   * The merged flags for each zoom step, worked out once. Flags are merged on a grid fixed to
   * the map (not the screen), and the grid only changes when the zoom passes a power of two,
   * so dragging the map never changes which flags are merged.
   */
  private cache = new Map<number, Group[]>();

  get divisions(): Division[] {
    return this.list;
  }

  set divisions(list: Division[]) {
    this.list = list;
    this.cache.clear();
  }

  /** The flags at zoom step `step` (-1 = one flag per army). */
  private groupsAt(step: number): Group[] {
    const cached = this.cache.get(step);
    if (cached) return cached;
    // Map pixels per grid cell: about MERGE_PX on screen at this step's zoom (2^step).
    const cell = step < 0 ? 0 : MERGE_PX / 2 ** step;
    const w = this.mapWidth;
    const byKey = new Map<number, Sum>();
    for (const d of this.list) {
      const key = step < 0 ? d.nation : (d.nation * 4096 + Math.floor(d.x / cell)) * 4096 + Math.floor(d.y / cell);
      let sum = byKey.get(key);
      if (!sum) byKey.set(key, (sum = { nation: d.nation, troops: 0, training: 0, indices: [], refX: d.x, dx: 0, y: 0 }));
      // x is measured from the group's first flag, so an army across the map's seam stays together.
      let dx = d.x - sum.refX;
      if (w && Math.abs(dx) > w / 2) dx -= Math.sign(dx) * w;
      sum.dx += dx;
      sum.y += d.y;
      sum.troops += d.troops;
      if (d.training) sum.training++;
      sum.indices.push(d.index);
    }
    const groups = [...byKey.values()].map((s) => {
      const n = s.indices.length;
      return { nation: s.nation, troops: s.troops, x: s.refX + s.dx / n, y: s.y / n, training: s.training, indices: s.indices };
    });
    this.cache.set(step, groups);
    return groups;
  }

  /** The map's width in pixels (from the last frame), for armies across its seam. */
  private mapWidth = 0;

  draw(ctx: CanvasRenderingContext2D, v: MapView): void {
    this.hits = [];
    this.mapWidth = v.mapWidth;
    const zoom = v.scale / v.dpr;
    if (!this.visible || !this.list.length) return;
    const onlyFocus = zoom < MIN_ZOOM;
    if (onlyFocus && (!this.focus || zoom < FOCUS_MIN_ZOOM)) return;
    const step = zoom < WHOLE_ARMY_ZOOM ? -1 : Math.floor(Math.log2(zoom));
    const sel = this.selected;
    const margin = 40 * v.dpr;
    const shown: { g: Group; x: number; y: number; selected: boolean }[] = [];
    for (const g of this.groupsAt(step)) {
      if (onlyFocus && g.nation !== this.focus) continue;
      for (const k of v.copies) {
        const x = Math.round(v.offsetX + (g.x + 0.5 + k * v.mapWidth) * v.scale);
        const y = Math.round(v.offsetY + (g.y + 0.5) * v.scale);
        if (x < -margin || x > v.screenWidth + margin || y < -margin || y > v.screenHeight + margin) continue;
        shown.push({ g, x, y, selected: !!sel && sel.nation === g.nation && g.indices.includes(sel.index) });
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const u = v.dpr;
    ctx.font = `700 ${10 * u}px Georgia, "Times New Roman", serif`;
    ctx.textBaseline = "middle";
    // Selected last, so it's drawn on top.
    shown.sort((a, b) => Number(a.selected) - Number(b.selected));
    for (const { g, x, y, selected } of shown) {
      this.drawFlag(ctx, x, y, u, g, selected);
      this.hits.push({ x0: (x - 3 * u) / u, y0: (y - 22 * u) / u, x1: (x + 40 * u) / u, y1: (y + 2 * u) / u, nation: g.nation, indices: g.indices });
    }
    ctx.restore();
  }

  private drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, g: Group, selected: boolean): void {
    const color = this.colorOf(g.nation);
    const poleTop = y - 20 * u;
    const w = 15 * u;
    const h = 10 * u;
    // Pole and its foot.
    ctx.fillStyle = "rgba(10, 14, 22, 0.55)";
    ctx.beginPath();
    ctx.ellipse(x, y, 3.5 * u, 1.5 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1a1d24";
    ctx.lineWidth = 1.6 * u;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, poleTop);
    ctx.stroke();
    // The cloth, with a little wave.
    ctx.beginPath();
    ctx.moveTo(x, poleTop);
    ctx.quadraticCurveTo(x + w * 0.5, poleTop - 2 * u, x + w, poleTop + 1 * u);
    ctx.lineTo(x + w, poleTop + h + 1 * u);
    ctx.quadraticCurveTo(x + w * 0.5, poleTop + h - 2 * u, x, poleTop + h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (g.training) {
      // Training: white stripes across the cloth.
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = 2 * u;
      for (let s = -h; s < w; s += 5 * u) {
        ctx.beginPath();
        ctx.moveTo(x + s, poleTop + h + 2 * u);
        ctx.lineTo(x + s + h, poleTop - 2 * u);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.lineWidth = (selected ? 2.2 : 1.2) * u;
    ctx.strokeStyle = selected ? "#f0d48a" : "rgba(10, 14, 22, 0.85)";
    ctx.stroke();
    // Troops (and how many divisions, when merged) on a dark tag next to the cloth.
    const text = compactNumber(g.troops, ["K", "M", "B"]);
    const tw = text.length * 6.1 * u + 6 * u;
    const tx = x + w + 2 * u;
    const ty = poleTop + h / 2;
    ctx.fillStyle = selected ? "rgba(70, 54, 8, 0.92)" : "rgba(26, 22, 17, 0.88)";
    roundRect(ctx, tx, ty - 6 * u, tw, 12 * u, 3 * u);
    ctx.fill();
    ctx.fillStyle = selected ? "#f0d48a" : "#f1e8d4";
    ctx.fillText(text, tx + 3 * u, ty + 0.5 * u);
  }

  /** The flag at a screen point (CSS pixels), if any: its nation and the divisions in it. */
  hit(x: number, y: number): { nation: number; indices: number[] } | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return { nation: h.nation, indices: h.indices };
    }
    return null;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
