// The player's brush paint on the map: war goals (red stripes), land to defend (blue) and land
// to develop (green). One image the size of the map, repainted only where paint changed, drawn
// over the nations' colours.

import type { GameMap } from "../map/gameMap.ts";
import type { MapOverlay, MapView } from "./mapRenderer.ts";

/** Colour per paint value (1 war goal, 2 defend, 3 develop): [r, g, b, alpha]. */
const COLORS: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [220, 40, 40, 170],
  [60, 130, 240, 150],
  [70, 190, 90, 150],
];

export class PaintLayer implements MapOverlay {
  readonly image: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private pixels: ImageData;
  private dirty = false;
  visible = true;

  constructor(
    private map: GameMap,
    private paint: Uint8Array,
  ) {
    this.image = new OffscreenCanvas(map.width, map.height);
    this.ctx = this.image.getContext("2d")!;
    this.pixels = this.ctx.createImageData(map.width, map.height);
  }

  /** Uses a different paint grid (e.g. after loading a save) and redraws all of it. */
  setPaint(paint: Uint8Array): void {
    this.paint = paint;
    this.redrawAll();
  }

  redrawAll(): void {
    for (let i = 0; i < this.paint.length; i++) this.color(i);
    this.dirty = true;
  }

  /** Repaints these pixels from the paint grid. */
  update(indices: readonly number[]): void {
    for (const i of indices) this.color(i);
    if (indices.length) this.dirty = true;
  }

  private color(i: number): void {
    const v = this.paint[i];
    const x = i % this.map.width;
    const y = (i - x) / this.map.width;
    // War goals are striped, so the nation's own colour still shows through.
    const c = v === 1 && (x + y) % 3 === 0 ? COLORS[0] : COLORS[v] ?? COLORS[0];
    const o = i * 4;
    this.pixels.data[o] = c[0];
    this.pixels.data[o + 1] = c[1];
    this.pixels.data[o + 2] = c[2];
    this.pixels.data[o + 3] = c[3];
  }

  draw(ctx: CanvasRenderingContext2D, v: MapView): void {
    if (!this.visible) return;
    if (this.dirty) {
      this.ctx.putImageData(this.pixels, 0, 0);
      this.dirty = false;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const top = Math.round(v.offsetY);
    const bottom = Math.round(v.offsetY + this.map.height * v.scale);
    for (const k of v.copies) {
      const left = Math.round(v.offsetX + k * v.mapWidth * v.scale);
      const right = Math.round(v.offsetX + (k + 1) * v.mapWidth * v.scale);
      ctx.drawImage(this.image, left, top, right - left, bottom - top);
    }
    ctx.restore();
  }
}
