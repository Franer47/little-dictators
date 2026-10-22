// Armies on the map: one token per army (its nation's flag, how many divisions, a strength bar
// and its stance), standing on the front it was sent to or along its border at home. A
// nation's Reserve (new divisions still training) waits at its capital. When an army is sent
// somewhere else it marches there smoothly instead of jumping. Which nations' armies show is
// decided by the screen (src/ui/placement.ts): yours, your enemies' and the one you look at.

import { compactNumber } from "../game/numbers.ts";
import type { MapOverlay, MapView } from "./mapRenderer.ts";

export interface ArmyToken {
  nation: number;
  /** The army's id within its nation (0 = the reserve). */
  army: number;
  name: string;
  divisions: number;
  troops: number;
  /** Divisions still training. */
  training: number;
  /** Troops ÷ full strength (0..1). */
  strength: number;
  stance: "attack" | "hold" | "defend" | "reserve";
  /** Where it stands (map pixels). */
  x: number;
  y: number;
}

/** How long a march to a new spot takes on screen (ms). */
const MARCH_MS = 900;

interface Shown {
  token: ArmyToken;
  /** Where the march started (map pixels) and when. */
  fromX: number;
  fromY: number;
  t0: number;
}

interface Hit {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  nation: number;
  army: number;
}

export class ArmyLayer implements MapOverlay {
  colorOf: (nation: number) => string = () => "#888";
  /** Asks for another frame (while armies are marching). */
  requestRender: () => void = () => {};
  selected: { nation: number; army: number } | null = null;
  visible = true;
  private shown = new Map<string, Shown>();
  private hits: Hit[] = [];
  private mapWidth = 0;

  get tokens(): ArmyToken[] {
    return [...this.shown.values()].map((s) => s.token);
  }

  /** The armies to show now; ones that moved march from where they were drawn last. */
  set tokens(list: ArmyToken[]) {
    const now = performance.now();
    const next = new Map<string, Shown>();
    for (const t of list) {
      const key = `${t.nation}:${t.army}`;
      const old = this.shown.get(key);
      if (old && (old.token.x !== t.x || old.token.y !== t.y)) {
        const [x, y] = this.position(old, now);
        next.set(key, { token: t, fromX: x, fromY: y, t0: now });
      } else next.set(key, { token: t, fromX: old?.fromX ?? t.x, fromY: old?.fromY ?? t.y, t0: old?.t0 ?? 0 });
    }
    this.shown = next;
    this.requestRender();
  }

  /** Where a token is drawn at time `now` (map pixels), part-way along its march. */
  private position(s: Shown, now: number): [number, number] {
    const t = Math.min(1, (now - s.t0) / MARCH_MS);
    if (t >= 1) return [s.token.x, s.token.y];
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    let dx = s.token.x - s.fromX;
    // Across the map's seam, the short way round.
    if (this.mapWidth && Math.abs(dx) > this.mapWidth / 2) dx -= Math.sign(dx) * this.mapWidth;
    return [s.fromX + dx * e, s.fromY + (s.token.y - s.fromY) * e];
  }

  draw(ctx: CanvasRenderingContext2D, v: MapView): void {
    this.hits = [];
    this.mapWidth = v.mapWidth;
    if (!this.visible || !this.shown.size) return;
    const now = performance.now();
    const u = v.dpr;
    const margin = 60 * u;
    let marching = false;
    const items: { s: Shown; x: number; y: number; selected: boolean }[] = [];
    for (const s of this.shown.values()) {
      if (now - s.t0 < MARCH_MS) marching = true;
      const [mx, my] = this.position(s, now);
      for (const k of v.copies) {
        const x = Math.round(v.offsetX + (mx + 0.5 + k * v.mapWidth) * v.scale);
        const y = Math.round(v.offsetY + (my + 0.5) * v.scale);
        if (x < -margin || x > v.screenWidth + margin || y < -margin || y > v.screenHeight + margin) continue;
        const sel = this.selected;
        items.push({ s, x, y, selected: !!sel && sel.nation === s.token.nation && sel.army === s.token.army });
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textBaseline = "middle";
    // Tokens that would cover each other (several armies on one short front) stack downward.
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const placed: { x: number; y: number }[] = [];
    const tw = 46 * u;
    const th = 22 * u;
    for (const it of items) {
      for (let guard = 0; guard < 12 && placed.some((p) => Math.abs(p.x - it.x) < tw && Math.abs(p.y - it.y) < th); guard++) it.y += th;
      placed.push({ x: it.x, y: it.y });
    }
    // Lower ones in front; the selected one on top.
    items.sort((a, b) => Number(a.selected) - Number(b.selected) || a.y - b.y);
    for (const it of items) {
      this.drawToken(ctx, it.x, it.y, u, it.s.token, it.selected);
      this.hits.push({ x0: (it.x - 4 * u) / u, y0: (it.y - 26 * u) / u, x1: (it.x + 46 * u) / u, y1: (it.y + 3 * u) / u, nation: it.s.token.nation, army: it.s.token.army });
    }
    ctx.restore();
    if (marching) this.requestRender();
  }

  private drawToken(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, t: ArmyToken, selected: boolean): void {
    const reserve = t.stance === "reserve";
    const color = this.colorOf(t.nation);
    const poleTop = y - 24 * u;
    const w = 18 * u;
    const h = 12 * u;
    // Shadow, pole.
    ctx.fillStyle = "rgba(10, 14, 22, 0.55)";
    ctx.beginPath();
    ctx.ellipse(x, y, 4.5 * u, 1.8 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1a1d24";
    ctx.lineWidth = 1.8 * u;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, poleTop);
    ctx.stroke();
    // The cloth.
    ctx.beginPath();
    ctx.moveTo(x, poleTop);
    ctx.quadraticCurveTo(x + w * 0.5, poleTop - 2 * u, x + w, poleTop + 1 * u);
    ctx.lineTo(x + w, poleTop + h + 1 * u);
    ctx.quadraticCurveTo(x + w * 0.5, poleTop + h - 2 * u, x, poleTop + h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (reserve || t.training >= t.divisions) {
      // Training: white stripes.
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
    ctx.lineWidth = (selected ? 2.4 : 1.2) * u;
    ctx.strokeStyle = selected ? "#f0d48a" : "rgba(10, 14, 22, 0.85)";
    ctx.stroke();
    // The stance on the cloth: ▲ attack, ▬ hold, a shield for defend, R for the reserve.
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.strokeStyle = "rgba(10, 14, 22, 0.6)";
    ctx.lineWidth = 1 * u;
    const cx = x + w / 2;
    const cy = poleTop + h / 2;
    ctx.beginPath();
    if (t.stance === "attack") {
      ctx.moveTo(cx - 3.5 * u, cy + 2.5 * u);
      ctx.lineTo(cx, cy - 3.5 * u);
      ctx.lineTo(cx + 3.5 * u, cy + 2.5 * u);
    } else if (t.stance === "hold") {
      ctx.rect(cx - 4 * u, cy - 1.5 * u, 8 * u, 3 * u);
    } else if (t.stance === "defend") {
      ctx.moveTo(cx - 3.5 * u, cy - 3.5 * u);
      ctx.lineTo(cx + 3.5 * u, cy - 3.5 * u);
      ctx.lineTo(cx + 3.5 * u, cy);
      ctx.quadraticCurveTo(cx + 3 * u, cy + 3 * u, cx, cy + 4 * u);
      ctx.quadraticCurveTo(cx - 3 * u, cy + 3 * u, cx - 3.5 * u, cy);
    }
    ctx.closePath();
    if (!reserve) {
      ctx.stroke();
      ctx.fill();
    } else {
      ctx.font = `700 ${9 * u}px Georgia, serif`;
      ctx.textAlign = "center";
      ctx.fillText("R", cx, cy + 0.5 * u);
      ctx.textAlign = "left";
    }
    // The tag: how many divisions, and a strength bar under it.
    const text = reserve ? `${t.divisions}` : `${t.divisions}`;
    ctx.font = `700 ${11 * u}px Georgia, "Times New Roman", serif`;
    const tw = Math.max(18 * u, ctx.measureText(text).width + 8 * u);
    const tx = x + w + 2 * u;
    const ty = poleTop + h / 2;
    ctx.fillStyle = selected ? "rgba(70, 54, 8, 0.94)" : "rgba(26, 22, 17, 0.9)";
    roundRect(ctx, tx, ty - 7 * u, tw, 14 * u, 3 * u);
    ctx.fill();
    ctx.fillStyle = selected ? "#f0d48a" : "#f1e8d4";
    ctx.fillText(text, tx + 4 * u, ty + 0.5 * u);
    // Strength bar (green → red as it wears down).
    const bw = tw;
    const by = ty + 8 * u;
    ctx.fillStyle = "rgba(10, 14, 22, 0.8)";
    ctx.fillRect(tx, by, bw, 3 * u);
    const s = Math.max(0, Math.min(1, t.strength));
    ctx.fillStyle = s > 0.66 ? "#7cc46a" : s > 0.33 ? "#e0b84a" : "#d4593f";
    ctx.fillRect(tx, by, bw * s, 3 * u);
  }

  /** The army token at a screen point (CSS pixels), if any. */
  hit(x: number, y: number): { nation: number; army: number } | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return { nation: h.nation, army: h.army };
    }
    return null;
  }

  /** The troops figure for a tooltip: "4.8K". */
  static troopsText(t: ArmyToken): string {
    return compactNumber(Math.round(t.troops), ["K", "M", "B"]);
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
