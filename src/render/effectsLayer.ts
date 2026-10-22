// Animations on the map, between the monthly ticks, so the world looks alive instead of
// jumping once a month:
// - conquered land glows in its new owner's colour for a moment as the border creeps forward;
// - every battle has a marker with a bar showing who's winning, and each month it flashes with
//   sparks and smoke, and the troops each side lost float up from it;
// - ripples spread from where something happened: a war declared, a peace signed, a nation
//   fallen, a building finished.
// Purely for show: the game already knows the result. Everything fades on its own; the layer
// asks for frames only while something is moving.

import { compactNumber } from "../game/numbers.ts";
import type { MapOverlay, MapView } from "./mapRenderer.ts";

/** How long conquered land glows (ms). */
const GLOW_MS = 1400;
const SPARK_MS = 700;
const SMOKE_MS = 1600;
const TEXT_MS = 1800;
const RIPPLE_MS = 1800;
/** At most this many particles at once (sparks and smoke), so big wars stay smooth. */
const MAX_PARTICLES = 700;

export interface BattleMark {
  x: number;
  y: number;
  colorA: string;
  colorD: string;
  /** 0..1: how far the bar leans to A (0.5 = even). */
  lean: number;
  mine: boolean;
}

export type RippleKind = "war" | "peace" | "fall" | "build";

interface Glow {
  pixels: number[];
  rgb: string;
  t0: number;
}

interface Particle {
  x: number;
  y: number;
  /** Speed in CSS pixels per ms (screen space), so it looks the same at any zoom. */
  vx: number;
  vy: number;
  t0: number;
  life: number;
  kind: "spark" | "smoke";
  size: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  t0: number;
  /** Sideways offset (CSS pixels) so the two sides' numbers don't overlap. */
  dx: number;
}

interface Ripple {
  x: number;
  y: number;
  kind: RippleKind;
  t0: number;
}

const RIPPLE_COLORS: Record<RippleKind, string> = {
  war: "232, 72, 52",
  peace: "245, 236, 200",
  fall: "30, 20, 18",
  build: "240, 212, 138",
};

export class EffectsLayer implements MapOverlay {
  requestRender: () => void = () => {};
  /** Battle markers, set each month. */
  battles: BattleMark[] = [];
  visible = true;
  private glows: Glow[] = [];
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private ripples: Ripple[] = [];

  /** Newly conquered pixels glow in the conqueror's colour ("#rrggbb"). */
  glow(pixels: number[], color: string): void {
    if (!pixels.length) return;
    this.glows.push({ pixels, rgb: lighten(color), t0: performance.now() });
    this.requestRender();
  }

  /** A battle this month at (x, y) map pixels: sparks, smoke and the losses floating up. */
  clash(x: number, y: number, lost: { amount: number; color: string }[], showNumbers: boolean): void {
    const now = performance.now();
    if (this.particles.length < MAX_PARTICLES) {
      for (let k = 0; k < 9; k++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 0.03 + Math.random() * 0.06;
        this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.02, t0: now + Math.random() * 250, life: SPARK_MS, kind: "spark", size: 1.5 + Math.random() * 1.5 });
      }
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.push({ x, y, vx: Math.cos(a) * 0.006, vy: -0.01 - Math.random() * 0.008, t0: now + k * 120, life: SMOKE_MS, kind: "smoke", size: 5 + Math.random() * 4 });
      }
    }
    if (showNumbers)
      lost.forEach((l, k) => {
        if (l.amount < 1) return;
        this.texts.push({ x, y, text: `−${compactNumber(Math.round(l.amount), ["K", "M", "B"])}`, color: l.color, t0: now + k * 150, dx: k === 0 ? -16 : 16 });
      });
    this.requestRender();
  }

  /** Rings spreading from a map pixel. */
  ripple(x: number, y: number, kind: RippleKind): void {
    this.ripples.push({ x, y, kind, t0: performance.now() });
    this.requestRender();
  }

  draw(ctx: CanvasRenderingContext2D, v: MapView): void {
    if (!this.visible) return;
    const now = performance.now();
    const u = v.dpr;
    const width = Math.round(v.mapWidth);
    const screen = (x: number, y: number, k: number): [number, number] => [v.offsetX + (x + 0.5 + k * v.mapWidth) * v.scale, v.offsetY + (y + 0.5) * v.scale];
    const off = (sx: number, sy: number, m: number): boolean => sx < -m || sx > v.screenWidth + m || sy < -m || sy > v.screenHeight + m;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Conquered land glowing.
    this.glows = this.glows.filter((g) => now - g.t0 < GLOW_MS);
    const px = Math.max(1, v.scale);
    for (const g of this.glows) {
      const t = (now - g.t0) / GLOW_MS;
      ctx.fillStyle = `rgba(${g.rgb}, ${(0.75 * (1 - t) ** 2).toFixed(3)})`;
      for (const i of g.pixels) {
        const x = i % width;
        const y = (i - x) / width;
        for (const k of v.copies) {
          const sx = v.offsetX + (x + k * v.mapWidth) * v.scale;
          const sy = v.offsetY + y * v.scale;
          if (off(sx, sy, px)) continue;
          ctx.fillRect(sx, sy, px + 0.5, px + 0.5);
        }
      }
    }

    // Ripples.
    this.ripples = this.ripples.filter((r) => now - r.t0 < RIPPLE_MS);
    for (const r of this.ripples) {
      const t = (now - r.t0) / RIPPLE_MS;
      for (const k of v.copies) {
        const [sx, sy] = screen(r.x, r.y, k);
        if (off(sx, sy, 90 * u)) continue;
        for (const lag of [0, 0.25]) {
          const tt = t - lag;
          if (tt <= 0) continue;
          const radius = (6 + 70 * easeOut(tt)) * u;
          ctx.strokeStyle = `rgba(${RIPPLE_COLORS[r.kind]}, ${(0.85 * (1 - tt)).toFixed(3)})`;
          ctx.lineWidth = (3 - 2 * tt) * u;
          ctx.beginPath();
          ctx.arc(sx, sy, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Battle markers: a small bar under the war's swords showing who's winning.
    for (const b of this.battles) {
      for (const k of v.copies) {
        const [sx, sy] = screen(b.x, b.y, k);
        if (off(sx, sy, 40 * u)) continue;
        const w = (b.mine ? 34 : 24) * u;
        const h = (b.mine ? 5 : 4) * u;
        const x0 = sx - w / 2;
        const y0 = sy + (b.mine ? 17 : 12) * u;
        ctx.fillStyle = "rgba(10, 8, 6, 0.85)";
        ctx.fillRect(x0 - u, y0 - u, w + 2 * u, h + 2 * u);
        ctx.fillStyle = b.colorA;
        ctx.fillRect(x0, y0, w * b.lean, h);
        ctx.fillStyle = b.colorD;
        ctx.fillRect(x0 + w * b.lean, y0, w * (1 - b.lean), h);
      }
    }

    // Smoke under, sparks over.
    this.particles = this.particles.filter((p) => now - p.t0 < p.life);
    for (const kind of ["smoke", "spark"] as const) {
      for (const p of this.particles) {
        if (p.kind !== kind) continue;
        const age = now - p.t0;
        if (age < 0) continue;
        const t = age / p.life;
        for (const k of v.copies) {
          const [bx, by] = screen(p.x, p.y, k);
          const sx = bx + p.vx * age * u;
          const sy = by + p.vy * age * u + (kind === "spark" ? 0.00004 * age * age * u : 0);
          if (off(sx, sy, 20 * u)) continue;
          ctx.beginPath();
          if (kind === "smoke") {
            ctx.fillStyle = `rgba(70, 64, 58, ${(0.45 * (1 - t)).toFixed(3)})`;
            ctx.arc(sx, sy, (p.size + 8 * t) * u, 0, Math.PI * 2);
          } else {
            ctx.fillStyle = t < 0.4 ? `rgba(255, 240, 180, ${(1 - t).toFixed(3)})` : `rgba(255, 150, 60, ${(1 - t).toFixed(3)})`;
            ctx.arc(sx, sy, p.size * (1 - t * 0.5) * u, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }
    }

    // Losses floating up.
    this.texts = this.texts.filter((f) => now - f.t0 < TEXT_MS);
    ctx.font = `700 ${12 * u}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of this.texts) {
      const age = now - f.t0;
      if (age < 0) continue;
      const t = age / TEXT_MS;
      for (const k of v.copies) {
        const [bx, by] = screen(f.x, f.y, k);
        const sx = bx + f.dx * u;
        const sy = by - (10 + 30 * easeOut(t)) * u;
        if (off(sx, sy, 30 * u)) continue;
        ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.5) / 0.5);
        ctx.lineWidth = 3 * u;
        ctx.strokeStyle = "rgba(10, 8, 6, 0.85)";
        ctx.strokeText(f.text, sx, sy);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, sx, sy);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (this.glows.length || this.ripples.length || this.particles.length || this.texts.length) requestAnimationFrame(() => this.requestRender());
  }
}

function easeOut(t: number): number {
  return 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
}

/** "#rrggbb" → "r, g, b" a third of the way to white, for the glow. */
function lighten(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "255, 240, 200";
  return [m[1], m[2], m[3]].map((c) => Math.round(parseInt(c, 16) + (255 - parseInt(c, 16)) * 0.35)).join(", ");
}
