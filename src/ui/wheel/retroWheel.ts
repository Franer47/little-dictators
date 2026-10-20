// The "Retro pixel" wheel: drawn pixel by pixel on a small canvas each frame, then scaled
// up with no smoothing, so every pixel stays a crisp square however the wheel turns. The
// slice labels are drawn on top at full screen resolution in a pixel-style font, so they
// stay sharp and easy to read at any angle.

import type { Wheel } from "../../game/wheels.ts";
import { DOOM_RED, TAU, sliceColor, sliceEdges, specialColors, wrapText, type WheelFrame, type WheelView } from "./wheelView.ts";

/** The slice labels' font: Pixelify Sans, a pixel font made for legibility. */
const LABEL_FONT = '700 {size}px "Pixelify Sans", monospace';

/** The retro palette: a few earthy map colours plus some bright accents. */
export const RETRO_PALETTE = {
  outline: "#0b1020",
  shadow: "#000000",
  text: "#fffbea",
  rim: ["#6e4a1c", "#a8742a", "#d9a441"],
  studOff: "#5a3a14",
  studOn: ["#fff3b0", "#ffd84a"],
  hub: ["#9c6a1e", "#e8b33c", "#fbe48a"],
  pointer: ["#7a1f22", "#c8423a", "#ef7a5e"],
  /** Slice colours, each [dark, base, light]. */
  slices: [
    ["#6e2424", "#a63a32", "#d0604f"], // red
    ["#24532b", "#3c7f3a", "#6aab58"], // plains green
    ["#1a3f70", "#285a96", "#4a85c4"], // ocean blue
    ["#7f4318", "#ad5f22", "#d68a48"], // rust
    ["#462c63", "#644287", "#8d6bb3"], // purple
    ["#5e4a2c", "#86683e", "#b09060"], // highland brown
    ["#1d5660", "#2c7f8c", "#55aab5"], // deep teal
    ["#6b5410", "#957620", "#c6a43e"], // mustard
  ],
};

const R = 112; // wheel radius in wheel pixels
const RIM = 9; // rim width
const HUB = 13; // hub radius
const MARGIN = 3;
const SHADOW = { x: 3, y: 4 };
const POINTER_LEN = 18;
const CX = R + MARGIN;
const CY = R + MARGIN;
const W = 2 * R + MARGIN * 2 + POINTER_LEN - 8 + SHADOW.x;
const H = 2 * R + MARGIN * 2 + SHADOW.y;
const STUDS = 24;
// 4×4 ordered-dither thresholds (0..1), for the classic checkered shading.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** "#rrggbb" → a pixel value for a Uint32Array over ImageData (little-endian ABGR). */
function px(hex: string, alpha = 255): number {
  const n = parseInt(hex.slice(1), 16);
  return ((alpha << 24) | ((n & 0xff) << 16) | (n & 0xff00) | (n >> 16)) >>> 0;
}

interface SliceArt {
  colors: [number, number, number];
  center: number; // fraction of a turn
  /** Its label, drawn once into its own canvas (screen pixels), reading outward. */
  label: HTMLCanvasElement | null;
  /** Distance from the wheel centre where the label starts, in screen pixels. */
  labelAt: number;
  /** A rare slice: no label, glowing red edges. */
  rare: boolean;
}

export class RetroWheelView implements WheelView {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  /** The wheel at its own small size, one canvas pixel per wheel pixel. */
  private low = document.createElement("canvas");
  private lowCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private pixels: Uint32Array;
  private wheel: Wheel | null = null;
  private edges: number[] = [0, 1];
  private slices: SliceArt[] = [];
  private kick = 0;
  /** CSS pixels per wheel pixel. */
  private scale = 2;
  private dpr = 1;

  private readonly c = {
    outline: px(RETRO_PALETTE.outline),
    doomRed: px(DOOM_RED),
    shadow: px(RETRO_PALETTE.shadow, 90),
    rim: RETRO_PALETTE.rim.map((h) => px(h)),
    studOff: px(RETRO_PALETTE.studOff),
    studOn: RETRO_PALETTE.studOn.map((h) => px(h)),
    hub: RETRO_PALETTE.hub.map((h) => px(h)),
    pointer: RETRO_PALETTE.pointer.map((h) => px(h)),
  };

  constructor() {
    this.canvas.className = "wheel-canvas retro";
    this.ctx = this.canvas.getContext("2d")!;
    this.low.width = W;
    this.low.height = H;
    this.lowCtx = this.low.getContext("2d")!;
    this.image = this.lowCtx.createImageData(W, H);
    this.pixels = new Uint32Array(this.image.data.buffer);
    // Draw the labels again once the font has loaded.
    document.fonts?.load(this.font(40)).then(() => this.renderLabels()).catch(() => {});
  }

  /** CSS pixels per wheel pixel (the size of one "big pixel"), for matching effects. */
  get pixelSize(): number {
    return this.scale;
  }

  private font(size: number): string {
    return LABEL_FONT.replace("{size}", String(size));
  }

  setWheel(wheel: Wheel): void {
    this.wheel = wheel;
    this.edges = sliceEdges(wheel);
    this.renderLabels();
  }

  /**
   * Lays out each slice's label along its middle line, reading outward, centred between
   * the hub and the rim, white with a dark outline so it reads on every colour. All labels
   * on a wheel share one size where they can, so the wheel reads evenly; a very long one
   * may go a little smaller rather than shrink everything.
   */
  private renderLabels(): void {
    const wheel = this.wheel;
    if (!wheel) return;
    const k = this.scale * this.dpr; // screen pixels per wheel pixel
    const n = wheel.slices.length;
    const palette = RETRO_PALETTE.slices;
    const g = document.createElement("canvas").getContext("2d")!;
    const inner = (HUB + 4) * k;
    const outer = (R - RIM - 4) * k;
    const room = outer - inner;
    const biggest = Math.round(R * k * 0.15);
    const smallest = R * k * 0.05;

    // Where a label of this size would go, or null if it doesn't fit: up to two lines, no
    // further out than the rim, and the slice must be tall enough where its inner end sits.
    const fit = (text: string, tanHalf: number, size: number) => {
      g.font = this.font(size);
      const lines = wrapText(text, room, (t) => g.measureText(t).width);
      if (lines.length > 2) return null;
      const widest = Math.max(...lines.map((l) => g.measureText(l).width));
      const pad = Math.max(1, Math.round(size / 11)); // outline thickness
      const tall = lines.length * size * 0.95 + pad * 2;
      const at = Math.max(inner + (room - widest) / 2, tall / 2 / tanHalf);
      return at + widest > outer ? null : { lines, size, widest, pad, at };
    };
    const info = wheel.slices.map((slice, i) => {
      const [start, end] = [this.edges[i], this.edges[i + 1]];
      const tanHalf = Math.tan(Math.min(((end - start) * TAU) / 2, 1.2));
      const text = slice.rare ? "" : (slice.short ?? slice.shown); // rare slices have no label
      let best = 0;
      for (let size = biggest; text && size >= smallest; size = Math.floor(size * 0.94))
        if (fit(text, tanHalf, size)) {
          best = size;
          break;
        }
      return { start, end, tanHalf, text, best };
    });
    // One size for the wheel: the smallest that every label fits at, but not dragged below
    // 90% of the typical label by one very long name (that one just goes smaller).
    const fitting = info.map((x) => x.best).filter((x) => x > 0).sort((p, q) => p - q);
    const median = fitting[Math.floor(fitting.length / 2)] ?? 0;
    const shared = Math.max(fitting[0] ?? 0, Math.floor(median * 0.9));

    this.slices = info.map((x, i) => {
      const slice = wheel.slices[i];
      const colors = (specialColors(wheel, slice, i) ?? palette[sliceColor(i, n, palette.length)]).map((h) => px(h)) as [number, number, number];
      const art: SliceArt = { colors, center: (x.start + x.end) / 2, label: null, labelAt: 0, rare: !!slice.rare };
      const layout = x.best > 0 ? fit(x.text, x.tanHalf, Math.min(x.best, shared)) : null;
      if (layout) {
        art.label = this.drawLabel(layout.lines, layout.size, layout.widest, layout.pad);
        art.labelAt = layout.at - layout.pad;
      }
      return art;
    });
  }

  private drawLabel(lines: string[], size: number, widest: number, pad: number): HTMLCanvasElement {
    const lineH = size * 0.95;
    const label = document.createElement("canvas");
    label.width = Math.ceil(widest + pad * 2);
    label.height = Math.ceil(lines.length * lineH + pad * 3);
    const g = label.getContext("2d")!;
    g.font = this.font(size);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const write = (dx: number, dy: number): void =>
      lines.forEach((line, i) => g.fillText(line, label.width / 2 + dx, pad + lineH * (i + 0.5) + dy));
    // A hard-edged outline: the text in dark, nudged to all sides, then white on top.
    g.fillStyle = RETRO_PALETTE.outline;
    for (let dy = -pad; dy <= pad; dy += pad) for (let dx = -pad; dx <= pad; dx += pad) write(dx, dy);
    write(pad, pad * 2); // a little extra shadow below-right
    g.fillStyle = RETRO_PALETTE.text;
    write(0, 0);
    return label;
  }

  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    let deviceScale = Math.min(width / W, height / H) * dpr;
    // Whole-number scales keep every pixel the same size; use one if it costs little room.
    const whole = Math.floor(deviceScale);
    if (whole >= 2 && whole / deviceScale > 0.9) deviceScale = whole;
    this.scale = deviceScale / dpr;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * deviceScale);
    this.canvas.height = Math.round(H * deviceScale);
    this.canvas.style.width = `${W * this.scale}px`;
    this.canvas.style.height = `${H * this.scale}px`;
    this.renderLabels();
  }

  tickStops(): number[] {
    return this.edges.slice(0, -1);
  }

  onTick(): void {
    this.kick = 1;
  }

  hubCenter(): { x: number; y: number } {
    return { x: CX * this.scale, y: CY * this.scale };
  }

  pointerTip(): { x: number; y: number } {
    return { x: (CX + R - 7) * this.scale, y: CY * this.scale };
  }

  draw(f: WheelFrame): void {
    const { c, pixels, edges, slices } = this;
    this.kick *= Math.exp(-f.dt * 16);
    const n = slices.length;
    const spinning = f.speed > 0.5;
    const blinkOn = f.winner !== null && f.winTime < 1.1 ? Math.floor(f.winTime * 8) % 2 === 0 : true;
    const studPhase = f.winner !== null ? -1 : spinning ? Math.floor(f.time * 14) : Math.floor(f.time * 2);
    const studAllOn = f.winner !== null && Math.floor(f.winTime * 5) % 2 === 0;
    const sliceInner = HUB + 1.5;
    const sliceOuter = R - RIM - 1.5;

    let p = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++, p++) {
        const dx = x + 0.5 - CX;
        const dy = y + 0.5 - CY;
        const r = Math.hypot(dx, dy);
        const bayer = BAYER[(y & 3) * 4 + (x & 3)];
        if (r > R + 0.5) {
          // Outside the wheel: a checkered drop shadow, else see-through.
          const inShadow = Math.hypot(dx - SHADOW.x, dy - SHADOW.y) <= R + 0.5 && ((x + y) & 1) === 0;
          pixels[p] = inShadow ? c.shadow : 0;
          continue;
        }
        // Light comes from the top-left of the screen; it doesn't turn with the wheel.
        const light = r > 0 ? -(dx + dy) / (r * Math.SQRT2) : 0;
        if (r > R - 1.5 || (r > sliceOuter && r <= R - RIM)) {
          pixels[p] = c.outline;
          continue;
        }
        if (r <= HUB) {
          const s = light * Math.min(1, r / HUB);
          pixels[p] = s > 0.25 + bayer * 0.5 ? c.hub[2] : s < -0.25 - bayer * 0.5 ? c.hub[0] : c.hub[1];
          if (r > HUB - 1.2) pixels[p] = c.outline;
          continue;
        }
        if (r <= sliceInner) {
          pixels[p] = c.outline;
          continue;
        }
        // Spot on the wheel as a fraction of a turn (wheel frame, not screen).
        const screenAngle = Math.atan2(dy, dx);
        let frac = (screenAngle - f.angle) / TAU;
        frac -= Math.floor(frac);

        if (r > R - RIM) {
          // Rim with studs (light bulbs) that turn with the wheel.
          const k = Math.round(frac * STUDS);
          const a = (k / STUDS) * TAU + f.angle;
          const sd = Math.hypot(dx - (R - RIM / 2) * Math.cos(a), dy - (R - RIM / 2) * Math.sin(a));
          if (sd < 2.6) {
            const on = studAllOn || (studPhase >= 0 && (k + studPhase) % (spinning ? 3 : 2) === 0);
            pixels[p] = sd > 1.9 ? c.outline : on ? (sd < 1 ? c.studOn[0] : c.studOn[1]) : c.studOff;
          } else {
            const s = light;
            pixels[p] = s > 0.3 + bayer * 0.4 ? c.rim[2] : s < -0.3 - bayer * 0.4 ? c.rim[0] : c.rim[1];
          }
          continue;
        }

        // Slices.
        let i = 0;
        while (i < n - 1 && frac >= edges[i + 1]) i++;
        const edgeDist = Math.min(frac - edges[i], edges[i + 1] - frac) * TAU * r;
        const art = slices[i];
        if (art.rare && edgeDist < 1.7) {
          pixels[p] = c.doomRed; // a rare slice's red edges
          continue;
        }
        if (edgeDist < 0.7) {
          pixels[p] = c.outline;
          continue;
        }
        const s = light * Math.max(0, (r - (sliceOuter - 40)) / 40);
        let color = s > 0.3 + bayer * 0.5 ? art.colors[2] : s < -0.3 - bayer * 0.5 ? art.colors[0] : art.colors[1];
        if (f.winner !== null) {
          if (f.winner === i) color = blinkOn ? art.colors[2] : art.colors[1];
          else color = art.colors[0];
        }
        pixels[p] = color;
      }
    }
    this.drawPointer();
    this.lowCtx.putImageData(this.image, 0, 0);

    // Scale the pixel wheel up with no smoothing, then put the sharp labels on top.
    const ctx = this.ctx;
    const k = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.low, 0, 0, this.canvas.width, this.canvas.height);
    slices.forEach((art, i) => {
      if (!art.label) return;
      ctx.save();
      ctx.translate(CX * k, CY * k);
      ctx.rotate(f.angle + art.center * TAU);
      if (f.winner !== null && f.winner !== i) ctx.globalAlpha = 0.5;
      ctx.drawImage(art.label, art.labelAt, -art.label.height / 2);
      ctx.restore();
    });
  }

  /** The red arrow on the right, pointing at the wheel. It jumps a little at each tick. */
  private drawPointer(): void {
    const { pixels, c } = this;
    const tipX = CX + R - 7;
    const len = POINTER_LEN;
    const bend = this.kick * 2.5;
    const inside = (lx: number, ly: number): boolean => {
      const y = ly - bend * (1 - lx / len); // the tip swings more than the base
      return (lx >= 0 && lx <= len - 5 && Math.abs(y) <= lx * 0.42 + 0.6) || Math.hypot(lx - (len - 6), y) <= 5.6;
    };
    for (let y = CY - 9; y <= CY + 9; y++) {
      for (let x = tipX - 1; x < Math.min(W, tipX + len + 1); x++) {
        const lx = x + 0.5 - tipX;
        const ly = y + 0.5 - CY;
        let color = 0;
        if (inside(lx, ly)) {
          const top = ly - bend * (1 - lx / len);
          color = top < -1.5 ? c.pointer[2] : top > 1.5 ? c.pointer[0] : c.pointer[1];
          if (Math.hypot(lx - (len - 6), top) <= 1.6) color = c.hub[2]; // rivet
        } else if (inside(lx + 1, ly) || inside(lx - 1, ly) || inside(lx, ly + 1) || inside(lx, ly - 1)) {
          color = c.outline;
        }
        if (color) pixels[y * W + x] = color;
      }
    }
  }
}
