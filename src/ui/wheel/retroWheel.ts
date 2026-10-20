// The "Retro pixel" wheel: drawn pixel by pixel on a small canvas each frame, then scaled
// up with no smoothing, so every pixel stays a crisp square however the wheel turns.

import type { Wheel } from "../../game/wheels.ts";
import { GLYPH_HEIGHT, drawText, textWidth, wrapText } from "./pixelFont.ts";
import { TAU, sliceColor, sliceEdges, type WheelFrame, type WheelView } from "./wheelView.ts";

/** The retro palette: a few earthy map colours plus some bright accents. */
export const RETRO_PALETTE = {
  outline: "#0b1020",
  shadow: "#000000",
  text: "#f4f1e6",
  rim: ["#6e4a1c", "#a8742a", "#d9a441"],
  studOff: "#5a3a14",
  studOn: ["#fff3b0", "#ffd84a"],
  hub: ["#9c6a1e", "#e8b33c", "#fbe48a"],
  pointer: ["#7a1f22", "#c8423a", "#ef7a5e"],
  /** Slice colours, each [dark, base, light]. */
  slices: [
    ["#8a2c2a", "#c0453a", "#e2705c"], // red
    ["#2a6131", "#4a9a45", "#86c76a"], // plains green
    ["#1f4f8a", "#2f6db3", "#5a9ee0"], // ocean blue
    ["#a3561b", "#d97a2b", "#f0a05a"], // orange
    ["#553577", "#7b4fa3", "#a57ccc"], // purple
    ["#9c7b47", "#c9a66b", "#e3c995"], // highland tan
    ["#256f7d", "#3ba3b3", "#7fd0d8"], // shallow cyan
    ["#9a7a12", "#d8b22a", "#f2d86a"], // gold
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
const LINE_GAP = 1;

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
  /** Label mask: 0 = nothing, 1 = outline, 2 = text. */
  mask: Uint8Array;
  maskW: number;
  maskH: number;
  /** Distance from the wheel centre where the mask starts. */
  maskU: number;
}

export class RetroWheelView implements WheelView {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private pixels: Uint32Array;
  private edges: number[] = [0, 1];
  private slices: SliceArt[] = [];
  private kick = 0;
  private scale = 2;

  private readonly c = {
    outline: px(RETRO_PALETTE.outline),
    shadow: px(RETRO_PALETTE.shadow, 90),
    text: px(RETRO_PALETTE.text),
    rim: RETRO_PALETTE.rim.map((h) => px(h)),
    studOff: px(RETRO_PALETTE.studOff),
    studOn: RETRO_PALETTE.studOn.map((h) => px(h)),
    hub: RETRO_PALETTE.hub.map((h) => px(h)),
    pointer: RETRO_PALETTE.pointer.map((h) => px(h)),
  };

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = "wheel-canvas retro";
    this.ctx = this.canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(W, H);
    this.pixels = new Uint32Array(this.image.data.buffer);
  }

  setWheel(wheel: Wheel): void {
    this.edges = sliceEdges(wheel);
    const n = wheel.slices.length;
    const palette = RETRO_PALETTE.slices;
    this.slices = wheel.slices.map((slice, i) => {
      const colors = palette[sliceColor(i, n, palette.length)].map((h) => px(h)) as [number, number, number];
      const start = this.edges[i];
      const end = this.edges[i + 1];
      return { colors, center: (start + end) / 2, ...this.labelMask(slice.shown, (end - start) * TAU) };
    });
  }

  /** Lays out a slice's label along its middle line, reading outward, pushed against the rim. */
  private labelMask(label: string, sliceAngle: number): Pick<SliceArt, "mask" | "maskW" | "maskH" | "maskU"> {
    const inner = HUB + 4;
    const outer = R - RIM - 4;
    const room = outer - inner;
    let lines = wrapText(label.toUpperCase(), room);
    const fits = (ls: string[]): boolean => {
      const h = ls.length * (GLYPH_HEIGHT + LINE_GAP) - LINE_GAP;
      const widest = Math.max(...ls.map(textWidth));
      // The text's inner end must sit where the slice is tall enough for it.
      const u = outer - widest;
      return widest <= room && 2 * u * Math.tan(Math.min(sliceAngle / 2, 1.2)) >= h;
    };
    if (lines.length > 3 || !fits(lines)) {
      // Too long or the slice is too thin: shorten until it fits, or give up on the label.
      let text = lines.join(" ");
      while (text.length > 1 && !fits([text])) text = text.slice(0, -1);
      lines = text.length > 1 && fits([text + "."]) ? [text + "."] : [];
    }
    const widest = lines.length ? Math.max(...lines.map(textWidth)) : 0;
    const maskW = widest + 2;
    const maskH = Math.max(0, lines.length * (GLYPH_HEIGHT + LINE_GAP) - LINE_GAP) + 2;
    const mask = new Uint8Array(maskW * maskH);
    lines.forEach((line, k) => {
      const x = 1 + widest - textWidth(line);
      const y = 1 + k * (GLYPH_HEIGHT + LINE_GAP);
      drawText(line, x, y, (gx, gy) => (mask[gy * maskW + gx] = 2));
    });
    // A 1-pixel dark outline around the letters keeps them readable on any colour.
    for (let y = 0; y < maskH; y++)
      for (let x = 0; x < maskW; x++) {
        if (mask[y * maskW + x]) continue;
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx >= 0 && ny >= 0 && nx < maskW && ny < maskH && mask[ny * maskW + nx] === 2) mask[y * maskW + x] = 1;
          }
      }
    return { mask, maskW, maskH, maskU: outer - maskW + 1 };
  }

  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    let deviceScale = Math.min(width / W, height / H) * dpr;
    // Whole-number scales keep every pixel the same size; use one if it costs little room.
    const whole = Math.floor(deviceScale);
    if (whole >= 2 && whole / deviceScale > 0.9) deviceScale = whole;
    this.scale = deviceScale / dpr;
    this.canvas.style.width = `${W * this.scale}px`;
    this.canvas.style.height = `${H * this.scale}px`;
  }

  tickStops(): number[] {
    return this.edges.slice(0, -1);
  }

  onTick(): void {
    this.kick = 1;
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
        if (edgeDist < 0.7) {
          pixels[p] = c.outline;
          continue;
        }
        const art = slices[i];
        // Label: turn this pixel into the slice's own frame and look it up in the mask.
        let delta = (frac - art.center) * TAU;
        if (delta > Math.PI) delta -= TAU;
        if (delta < -Math.PI) delta += TAU;
        const mx = Math.round(r * Math.cos(delta) - art.maskU);
        const my = Math.round(r * Math.sin(delta) + art.maskH / 2 - 0.5);
        if (mx >= 0 && my >= 0 && mx < art.maskW && my < art.maskH) {
          const m = art.mask[my * art.maskW + mx];
          if (m) {
            const dim = f.winner !== null && f.winner !== i;
            pixels[p] = m === 1 ? c.outline : dim && (x + y) & 1 ? art.colors[0] : c.text;
            continue;
          }
        }
        const s = light * Math.max(0, (r - (sliceOuter - 40)) / 40);
        let color = s > 0.3 + bayer * 0.5 ? art.colors[2] : s < -0.3 - bayer * 0.5 ? art.colors[0] : art.colors[1];
        if (f.winner !== null) {
          if (f.winner === i) color = blinkOn ? art.colors[2] : art.colors[1];
          else color = (x + y) & 1 ? art.colors[0] : c.outline;
        }
        pixels[p] = color;
      }
    }
    this.drawPointer();
    this.ctx.putImageData(this.image, 0, 0);
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
