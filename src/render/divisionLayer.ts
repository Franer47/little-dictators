// Army flags on the map: one little flag per division in its nation's colour, with its troops.
// Flags only show when zoomed in close (further out they'd cover the map). Up close, a nation's
// flags that would overlap merge into one with their total; zoom in more to see every division.
// The nation whose Army section is open shows its flags from further out (one flag per army). Divisions in training have a striped flag; the selected one is gold.

import type { Division } from "../game/army.ts";
import { compactNumber } from "../game/numbers.ts";
import type { MapOverlay, MapView } from "./mapRenderer.ts";

/** Flags show from this zoom (CSS pixels per map pixel); further out they'd cover the map. */
const MIN_ZOOM = 7;
/** The nation in focus (its Army section is open) shows from this zoom. */
const FOCUS_MIN_ZOOM = 1.5;
/** Below this zoom each nation's army is one flag. */
const WHOLE_ARMY_ZOOM = 5;
/** Further in, a nation's flags closer than this (CSS pixels) merge: wider at middle zoom. */
function mergePx(zoom: number): number {
  return zoom < 9 ? 56 : 30;
}

interface Hit {
  /** Where the flag is drawn, CSS pixels. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  nation: number;
  indices: number[];
}

interface Group {
  nation: number;
  troops: number;
  count: number;
  sx: number;
  sy: number;
  training: number;
  selected: boolean;
  indices: number[];
}

export class DivisionLayer implements MapOverlay {
  divisions: Division[] = [];
  /** Each nation's colour, by id. */
  colorOf: (nation: number) => string = () => "#888";
  selected: { nation: number; index: number } | null = null;
  /** The nation whose Army section is open (0 = none): its flags show from further out. */
  focus = 0;
  visible = true;
  private hits: Hit[] = [];

  draw(ctx: CanvasRenderingContext2D, v: MapView): void {
    this.hits = [];
    const zoom = v.scale / v.dpr;
    if (!this.visible || !this.divisions.length) return;
    const onlyFocus = zoom < MIN_ZOOM;
    if (onlyFocus && (!this.focus || zoom < FOCUS_MIN_ZOOM)) return;
    const cell = mergePx(zoom) * v.dpr;
    const groups = new Map<number, Group>();
    const margin = 40 * v.dpr;
    for (const d of this.divisions) {
      if (onlyFocus && d.nation !== this.focus) continue;
      for (const k of v.copies) {
        const sx = v.offsetX + (d.x + 0.5 + k * v.mapWidth) * v.scale;
        const sy = v.offsetY + (d.y + 0.5) * v.scale;
        if (sx < -margin || sx > v.screenWidth + margin || sy < -margin || sy > v.screenHeight + margin) continue;
        // One number per (nation, cell), or per (nation, map copy) for whole armies: cells are
        // well under 2,048 a side on any screen.
        const key = zoom < WHOLE_ARMY_ZOOM ? -(d.nation * 16 + k + 8) : (d.nation * 2048 + Math.floor(sx / cell) + 1) * 2048 + Math.floor(sy / cell) + 1;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { nation: d.nation, troops: 0, count: 0, sx: 0, sy: 0, training: 0, selected: false, indices: [] }));
        g.troops += d.troops;
        g.count++;
        g.sx += sx;
        g.sy += sy;
        if (d.training) g.training++;
        if (this.selected && this.selected.nation === d.nation && this.selected.index === d.index) g.selected = true;
        g.indices.push(d.index);
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const u = v.dpr;
    ctx.font = `700 ${10 * u}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    // Selected last, so it's drawn on top.
    const list = [...groups.values()].sort((a, b) => Number(a.selected) - Number(b.selected));
    for (const g of list) {
      const x = Math.round(g.sx / g.count);
      const y = Math.round(g.sy / g.count);
      this.drawFlag(ctx, x, y, u, g);
      this.hits.push({ x0: (x - 3 * u) / u, y0: (y - 22 * u) / u, x1: (x + 40 * u) / u, y1: (y + 2 * u) / u, nation: g.nation, indices: g.indices });
    }
    ctx.restore();
  }

  private drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, g: Group): void {
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
    ctx.lineWidth = (g.selected ? 2.2 : 1.2) * u;
    ctx.strokeStyle = g.selected ? "#ffd84a" : "rgba(10, 14, 22, 0.85)";
    ctx.stroke();
    // Troops (and how many divisions, when merged) on a dark tag next to the cloth.
    const text = compactNumber(g.troops, ["K", "M", "B"]);
    const tw = text.length * 6.1 * u + 6 * u;
    const tx = x + w + 2 * u;
    const ty = poleTop + h / 2;
    ctx.fillStyle = g.selected ? "rgba(70, 54, 8, 0.92)" : "rgba(12, 18, 28, 0.85)";
    roundRect(ctx, tx, ty - 6 * u, tw, 12 * u, 3 * u);
    ctx.fill();
    ctx.fillStyle = g.selected ? "#ffd84a" : "#eef2f6";
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
