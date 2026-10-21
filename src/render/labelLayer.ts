// Nation names written across their land, tilted along it and sized to fit (src/game/labels.ts
// works out where). Names too small to read at the current zoom are left out.

import type { LabelSpot } from "../game/labels.ts";
import type { MapOverlay, MapView } from "./mapRenderer.ts";

interface Label {
  text: string;
  spot: LabelSpot;
  /** Font size in map pixels that makes the name fit its land. */
  size: number;
}

/** Smallest and biggest name on screen, CSS pixels. */
const MIN_PX = 8;
const MAX_PX = 56;
/** Rough width of one capital letter (with its spacing) compared with the font size. */
const CHAR_WIDTH = 0.86;

export class LabelLayer implements MapOverlay {
  private labels: Label[] = [];
  /** Names are hidden while placing (they'd cover the cursor) or when switched off. */
  visible = true;

  set(entries: { text: string; spot: LabelSpot | null }[]): void {
    this.labels = [];
    for (const { text, spot } of entries) {
      if (!spot || !text) continue;
      const upper = text.toUpperCase();
      const size = Math.min(spot.thickness * 0.5, (spot.length * 0.85) / (upper.length * CHAR_WIDTH));
      if (size > 0) this.labels.push({ text: upper, spot, size });
    }
  }

  draw(ctx: CanvasRenderingContext2D, v: MapView): void {
    if (!this.visible || !this.labels.length) return;
    const zoom = v.scale / v.dpr;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const { text, spot, size } of this.labels) {
      const css = size * zoom;
      if (css < MIN_PX) continue;
      const px = Math.min(MAX_PX, css) * v.dpr;
      const reach = (spot.length * v.scale) / 2;
      for (const k of v.copies) {
        const sx = v.offsetX + (spot.x + k * v.mapWidth) * v.scale;
        const sy = v.offsetY + spot.y * v.scale;
        if (sx + reach < 0 || sx - reach > v.screenWidth || sy + reach < 0 || sy - reach > v.screenHeight) continue;
        ctx.setTransform(1, 0, 0, 1, sx, sy);
        ctx.rotate(spot.angle);
        ctx.font = `700 ${px.toFixed(1)}px Cinzel, Georgia, "Times New Roman", serif`;
        ctx.letterSpacing = `${(px * 0.12).toFixed(1)}px`;
        // Fade the biggest names a little so they don't shout over the map.
        const alpha = css > 30 ? 0.62 : 0.85;
        ctx.lineWidth = Math.max(2, px * 0.14);
        ctx.strokeStyle = `rgba(10, 16, 26, ${alpha * 0.7})`;
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = `rgba(250, 244, 228, ${alpha})`;
        ctx.fillText(text, 0, 0);
      }
    }
    ctx.restore();
  }
}
