// The "Bold game show" wheel: bright slices, a ring of chasing light bulbs, pegs, and a
// flapper that gets knocked by every peg that goes past.

import type { Wheel } from "../../game/wheels.ts";
import { wrapText } from "./pixelFont.ts";
import { TAU, sliceColor, sliceEdges, type WheelFrame, type WheelView } from "./wheelView.ts";

export const GAME_SHOW_COLORS = ["#ff3b4e", "#ff9f1c", "#ffd60a", "#2ec95c", "#1fb5ff", "#4a5cff", "#b04dff", "#ff4fb3"];
export const GAME_SHOW_FONT = '"Luckiest Guy", "Arial Black", system-ui, sans-serif';

const BULBS = 28;
const DISC = 0.955; // the spinning disc's radius, as a share of the wheel radius
const PEG_RADIUS = 0.022;
const PEG_AT = 0.925;

// Flapper physics, in radians of wheel turn at the rim.
const SPRING = 1100;
const DAMPING = 16;
const CONTACT = 0.05; // how far from a peg's centre the flapper's tip touches it
const MAX_FLAP = 0.17; // past this the peg slips under the tip and the flapper snaps back

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

export class GameShowWheelView implements WheelView {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private disc = document.createElement("canvas");
  private wheel: Wheel | null = null;
  private edges: number[] = [0, 1];
  private pegs: number[] = [];
  private size = 400; // CSS px: the canvas height
  private dpr = 1;
  private flap = 0;
  private flapSpeed = 0;

  constructor() {
    this.canvas.className = "wheel-canvas gameshow";
    this.ctx = this.canvas.getContext("2d")!;
    // Draw again once the display font has loaded, so the labels use it.
    document.fonts?.load(`40px ${GAME_SHOW_FONT}`).then(() => this.renderDisc()).catch(() => {});
  }

  private get R(): number {
    return this.size * 0.4;
  }

  private get center(): { x: number; y: number } {
    return { x: this.size * 0.5, y: this.size * 0.5 };
  }

  setWheel(wheel: Wheel): void {
    this.wheel = wheel;
    this.edges = sliceEdges(wheel);
    // Pegs: one on every slice edge, plus extra ones inside big slices, about 16 a turn.
    this.pegs = [];
    for (let i = 0; i < wheel.slices.length; i++) {
      const [a, b] = [this.edges[i], this.edges[i + 1]];
      const m = Math.max(1, Math.round((b - a) * 16));
      for (let j = 0; j < m; j++) this.pegs.push(a + ((b - a) * j) / m);
    }
    this.renderDisc();
  }

  resize(width: number, height: number): void {
    this.size = Math.max(160, Math.min(height, width / 1.1));
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.size * 1.1 * this.dpr);
    this.canvas.height = Math.round(this.size * this.dpr);
    this.canvas.style.width = `${this.size * 1.1}px`;
    this.canvas.style.height = `${this.size}px`;
    this.renderDisc();
  }

  tickStops(): number[] {
    return this.pegs;
  }

  onTick(): void {}

  pointerTip(): { x: number; y: number } {
    return { x: this.center.x + this.R * 0.93, y: this.center.y };
  }

  /** Draws the spinning part (slices, labels, pegs) once into its own canvas. */
  private renderDisc(): void {
    const wheel = this.wheel;
    if (!wheel) return;
    const r = this.R * DISC * this.dpr;
    const d = Math.ceil(r * 2 + 4);
    this.disc.width = d;
    this.disc.height = d;
    const g = this.disc.getContext("2d")!;
    g.translate(d / 2, d / 2);

    wheel.slices.forEach((_, i) => {
      const a0 = this.edges[i] * TAU;
      const a1 = this.edges[i + 1] * TAU;
      const base = GAME_SHOW_COLORS[sliceColor(i, wheel.slices.length, GAME_SHOW_COLORS.length)];
      const grad = g.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      grad.addColorStop(0, shade(base, 0.45));
      grad.addColorStop(0.55, base);
      grad.addColorStop(1, shade(base, -0.25));
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r, a0, a1);
      g.closePath();
      g.fillStyle = grad;
      g.fill();
    });

    // Slice edges: a white line with a soft dark edge.
    g.lineCap = "round";
    for (let i = 0; i < wheel.slices.length; i++) {
      const a = this.edges[i] * TAU;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      g.strokeStyle = "rgba(0,0,0,0.25)";
      g.lineWidth = 5 * this.dpr;
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 2.2 * this.dpr;
      g.stroke();
    }

    // Labels: along each slice, reading outward, pushed toward the rim.
    wheel.slices.forEach((slice, i) => {
      const a0 = this.edges[i] * TAU;
      const a1 = this.edges[i + 1] * TAU;
      if (a1 - a0 < 0.05) return; // too thin for a label (e.g. weight 0)
      const outer = r * 0.84;
      const inner = r * 0.24;
      const room = outer - inner;
      g.save();
      g.rotate((a0 + a1) / 2);
      let size = r * 0.105;
      let lines: string[] = [];
      for (; size > r * 0.035; size *= 0.93) {
        g.font = `${size}px ${GAME_SHOW_FONT}`;
        lines = wrapText(slice.shown.toUpperCase(), room, (t) => g.measureText(t).width);
        const tall = lines.length * size * 1.0;
        const widest = Math.max(...lines.map((l) => g.measureText(l).width));
        const innerEnd = outer - widest;
        if (lines.length <= 2 && widest <= room && 2 * innerEnd * Math.tan(Math.min((a1 - a0) / 2, 1.2)) >= tall * 1.15) break;
      }
      g.textAlign = "right";
      g.textBaseline = "middle";
      g.lineJoin = "round";
      lines.forEach((line, k) => {
        const y = (k - (lines.length - 1) / 2) * size * 1.0 + size * 0.08;
        g.lineWidth = size * 0.22;
        g.strokeStyle = "rgba(40, 10, 40, 0.75)";
        g.strokeText(line, outer, y);
        g.fillStyle = "#fff";
        g.fillText(line, outer, y);
      });
      g.restore();
    });

    // Pegs.
    for (const f of this.pegs) {
      const a = f * TAU;
      const x = Math.cos(a) * this.R * PEG_AT * this.dpr;
      const y = Math.sin(a) * this.R * PEG_AT * this.dpr;
      const pr = this.R * PEG_RADIUS * this.dpr;
      g.beginPath();
      g.arc(x + pr * 0.25, y + pr * 0.35, pr, 0, TAU);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fill();
      const pg = g.createRadialGradient(x - pr * 0.3, y - pr * 0.3, pr * 0.1, x, y, pr);
      pg.addColorStop(0, "#ffffff");
      pg.addColorStop(0.5, "#ffe9a8");
      pg.addColorStop(1, "#b8862a");
      g.beginPath();
      g.arc(x, y, pr, 0, TAU);
      g.fillStyle = pg;
      g.fill();
    }
  }

  draw(f: WheelFrame): void {
    const { ctx, R } = this;
    const { x: cx, y: cy } = this.center;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size * 1.1, this.size);
    this.stepFlapper(f);

    // Outer frame with a warm glow.
    ctx.save();
    ctx.shadowColor = f.winner !== null ? "rgba(255, 220, 120, 0.9)" : "rgba(255, 190, 80, 0.55)";
    ctx.shadowBlur = R * (f.winner !== null ? 0.13 + 0.03 * Math.sin(f.winTime * 8) : 0.09);
    const frame = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    frame.addColorStop(0, "#fff1b8");
    frame.addColorStop(0.35, "#e7b23c");
    frame.addColorStop(0.65, "#a8701c");
    frame.addColorStop(1, "#f6d27a");
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.085, 0, TAU);
    ctx.fillStyle = frame;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.985, 0, TAU);
    ctx.fillStyle = "#3a1240";
    ctx.fill();

    this.drawBulbs(f, cx, cy);

    // The spinning disc, with a little motion blur when it's fast.
    const blur = Math.min(4, Math.floor(f.speed / 7));
    for (let k = blur; k >= 0; k--) {
      ctx.globalAlpha = k === 0 ? 1 : 0.28;
      this.drawDisc(f.angle - k * f.speed * 0.006, cx, cy);
    }
    ctx.globalAlpha = 1;

    if (f.winner !== null) this.drawWinner(f, cx, cy);

    // Static sheen: depth at the edge and a glossy highlight that stays put as it spins.
    const rd = R * DISC;
    const depth = ctx.createRadialGradient(cx, cy, rd * 0.6, cx, cy, rd);
    depth.addColorStop(0, "rgba(0,0,0,0)");
    depth.addColorStop(1, "rgba(30,0,40,0.35)");
    ctx.beginPath();
    ctx.arc(cx, cy, rd, 0, TAU);
    ctx.fillStyle = depth;
    ctx.fill();
    const gloss = ctx.createLinearGradient(cx - rd, cy - rd, cx + rd * 0.2, cy + rd * 0.2);
    gloss.addColorStop(0, "rgba(255,255,255,0.28)");
    gloss.addColorStop(0.5, "rgba(255,255,255,0.04)");
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gloss;
    ctx.fill();

    this.drawHub(cx, cy);
    this.drawFlapper(cx, cy);
  }

  private drawDisc(angle: number, cx: number, cy: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(this.disc, -this.disc.width / this.dpr / 2, -this.disc.height / this.dpr / 2, this.disc.width / this.dpr, this.disc.height / this.dpr);
    ctx.restore();
  }

  /** The winning slice pops out and glows; the rest go dim. */
  private drawWinner(f: WheelFrame, cx: number, cy: number): void {
    const { ctx } = this;
    const i = f.winner!;
    const rd = this.R * DISC;
    const a0 = this.edges[i] * TAU + f.angle;
    const a1 = this.edges[i + 1] * TAU + f.angle;
    const t = Math.min(1, f.winTime / 0.35);
    const pop = easeOutBack(t) * this.R * 0.045;
    const mid = (a0 + a1) / 2;
    const dim = Math.min(1, f.winTime / 0.3) * 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rd, a1, a0 + TAU);
    ctx.closePath();
    ctx.fillStyle = `rgba(20, 0, 30, ${dim})`;
    ctx.fill();
    ctx.restore();

    const ox = Math.cos(mid) * pop;
    const oy = Math.sin(mid) * pop;
    const wedge = (): void => {
      ctx.beginPath();
      ctx.moveTo(cx + ox, cy + oy);
      ctx.arc(cx + ox, cy + oy, rd * (1 + 0.03 * t), a0, a1);
      ctx.closePath();
    };
    ctx.save();
    ctx.shadowColor = "rgba(255, 240, 160, 0.95)";
    ctx.shadowBlur = this.R * (0.12 + 0.05 * Math.sin(f.winTime * 9));
    wedge();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
    ctx.save();
    wedge();
    ctx.clip();
    ctx.translate(cx + ox, cy + oy);
    ctx.rotate(f.angle);
    const s = 1 + 0.03 * t;
    const w = (this.disc.width / this.dpr) * s;
    ctx.drawImage(this.disc, -w / 2, -w / 2, w, w);
    ctx.restore();
    ctx.save();
    wedge();
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 + 0.3 * Math.sin(f.winTime * 10)})`;
    ctx.stroke();
    ctx.restore();
  }

  private drawBulbs(f: WheelFrame, cx: number, cy: number): void {
    const { ctx, R } = this;
    const spinning = f.speed > 0.5;
    const chase = spinning ? Math.floor(f.time * (8 + f.speed * 2)) : Math.floor(f.time * 2.5);
    for (let k = 0; k < BULBS; k++) {
      const a = (k / BULBS) * TAU;
      const x = cx + Math.cos(a) * R * 1.035;
      const y = cy + Math.sin(a) * R * 1.035;
      let on: boolean;
      if (f.winner !== null) on = Math.floor(f.winTime * 7) % 2 === k % 2 || f.winTime > 2.2;
      else if (spinning) on = (k + chase) % 4 === 0 || (k + chase) % 4 === 1;
      else on = (k + chase) % 2 === 0;
      const br = R * 0.028;
      if (on) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, br * 3.2);
        glow.addColorStop(0, "rgba(255, 250, 220, 0.9)");
        glow.addColorStop(0.35, "rgba(255, 220, 120, 0.45)");
        glow.addColorStop(1, "rgba(255, 200, 80, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, br * 3.2, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, br, 0, TAU);
      ctx.fillStyle = on ? "#fffbe6" : "#7a4a14";
      ctx.fill();
    }
  }

  private drawHub(cx: number, cy: number): void {
    const { ctx, R } = this;
    const hr = R * 0.15;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = hr * 0.4;
    ctx.shadowOffsetY = hr * 0.08;
    const g = ctx.createRadialGradient(cx - hr * 0.35, cy - hr * 0.4, hr * 0.1, cx, cy, hr);
    g.addColorStop(0, "#fff6c8");
    g.addColorStop(0.45, "#f0c043");
    g.addColorStop(1, "#9a6416");
    ctx.beginPath();
    ctx.arc(cx, cy, hr, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = Math.max(2, hr * 0.08);
    ctx.strokeStyle = "#6a3c0c";
    ctx.stroke();
    // A star in the middle.
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 === 0 ? hr * 0.55 : hr * 0.23;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = "#ff3b4e";
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, hr * 0.05);
    ctx.strokeStyle = "#7a1020";
    ctx.stroke();
  }

  /** The flapper is a spring; any peg near its tip pushes it along until the peg slips past. */
  private stepFlapper(f: WheelFrame): void {
    const steps = 4;
    const dt = Math.min(f.dt, 0.05) / steps;
    for (let s = 0; s < steps; s++) {
      this.flapSpeed += (-SPRING * this.flap - DAMPING * this.flapSpeed) * dt;
      this.flap += this.flapSpeed * dt;
    }
    for (const peg of this.pegs) {
      let rel = (peg * TAU + f.angle) % TAU;
      if (rel > Math.PI) rel -= TAU;
      if (rel < -Math.PI) rel += TAU;
      const push = rel + CONTACT;
      if (push > 0 && push < MAX_FLAP && push > this.flap) {
        this.flap = push;
        this.flapSpeed = Math.max(this.flapSpeed, 0);
      }
    }
  }

  private drawFlapper(cx: number, cy: number): void {
    const { ctx, R } = this;
    const pivotX = cx + R * 1.13;
    const len = R * 0.24;
    const swing = Math.min(0.9, (this.flap * R) / len);
    ctx.save();
    ctx.translate(pivotX, cy);
    ctx.rotate(-swing); // pegs move down past the tip, so the tip swings down (the base stays put)
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = R * 0.04;
    ctx.shadowOffsetY = R * 0.015;
    const w = R * 0.075;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.quadraticCurveTo(-len * 0.45, -w * 1.05, 0, -w);
    ctx.arc(0, 0, w, -Math.PI / 2, Math.PI / 2);
    ctx.quadraticCurveTo(-len * 0.45, w * 1.05, -len, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -w, 0, w);
    g.addColorStop(0, "#ff8a7a");
    g.addColorStop(0.45, "#e32636");
    g.addColorStop(1, "#8a0f1c");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = Math.max(2, R * 0.012);
    ctx.strokeStyle = "#f6d27a";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.42, 0, TAU);
    const rivet = ctx.createRadialGradient(-w * 0.12, -w * 0.12, 0, 0, 0, w * 0.42);
    rivet.addColorStop(0, "#fff6c8");
    rivet.addColorStop(1, "#a8701c");
    ctx.fillStyle = rivet;
    ctx.fill();
    ctx.restore();
  }
}

function easeOutBack(t: number): number {
  const c = 2.2;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}
