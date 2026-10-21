// Draws who owns what: a see-through colour over each nation's land, with a darker line
// along its edge (borders with other nations and coasts), like OpenFront.
//
// It keeps its own copy of the ownership grid ("shown"), so the growth animation can
// reveal a nation's pixels a few at a time while the game already knows the final result.
// Only the pixels that changed (and their neighbours) are repainted, then only that
// rectangle is copied to the image, so a new nation doesn't redraw the whole map.

import type { GameMap } from "../map/gameMap.ts";
import type { Territory } from "../game/territory.ts";

const FILL_ALPHA = 105;
const FILL_ALPHA_SELECTED = 150;
const BORDER_ALPHA = 235;

export class TerritoryLayer {
  readonly image: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private pixels: ImageData;
  /** The owner drawn at each pixel. */
  private shown: Uint16Array;
  /** Colour per nation id: [r, g, b]. */
  private colors: [number, number, number][] = [];
  private selected = 0;
  private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(
    private map: GameMap,
    private territory: Territory,
  ) {
    this.image = new OffscreenCanvas(map.width, map.height);
    this.ctx = this.image.getContext("2d")!;
    this.pixels = this.ctx.createImageData(map.width, map.height);
    this.shown = new Uint16Array(map.width * map.height);
  }

  setColor(id: number, hex: string): void {
    this.colors[id] = hexToRgb(hex);
  }

  /** Shows these pixels with their owner from the ownership grid (the growth animation calls this in steps). */
  reveal(indices: ArrayLike<number>, from = 0, to = indices.length): void {
    const { width } = this.map;
    for (let k = from; k < to; k++) {
      const i = indices[k];
      this.shown[i] = this.territory.owner[i];
    }
    for (let k = from; k < to; k++) {
      const i = indices[k];
      const x = i % width;
      const y = (i - x) / width;
      this.repaintAround(x, y);
    }
  }

  /** Draws one nation brighter (the one open in the corner panel); 0 for none. */
  select(id: number): void {
    if (id === this.selected) return;
    const old = this.selected;
    this.selected = id;
    for (const which of [old, id]) {
      const h = which ? this.territory.holding(which) : undefined;
      if (h) for (const i of h.pixels) this.repaint(i % this.map.width, Math.floor(i / this.map.width));
    }
  }

  /** Empties the layer. */
  clear(): void {
    this.shown.fill(0);
    this.pixels.data.fill(0);
    this.selected = 0;
    this.dirty = { x0: 0, y0: 0, x1: this.map.width - 1, y1: this.map.height - 1 };
  }

  /** Copies the changed rectangle to the image. Returns true if anything changed. */
  flush(): boolean {
    const d = this.dirty;
    if (!d) return false;
    this.ctx.putImageData(this.pixels, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
    this.dirty = null;
    return true;
  }

  private repaintAround(x: number, y: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = this.map.normalize(x + dx, y + dy);
        if (p) this.repaint(p[0], p[1]);
      }
    }
  }

  private repaint(x: number, y: number): void {
    const { width } = this.map;
    const i = y * width + x;
    const id = this.shown[i];
    const o = i * 4;
    const data = this.pixels.data;
    if (id === 0) {
      data[o + 3] = 0;
    } else {
      const [r, g, b] = this.colors[id] ?? [255, 255, 255];
      // An edge pixel: a side neighbour belongs to someone else (or nobody, e.g. the sea).
      const edge =
        this.shownAt(x - 1, y) !== id || this.shownAt(x + 1, y) !== id || this.shownAt(x, y - 1) !== id || this.shownAt(x, y + 1) !== id;
      if (edge) {
        data[o] = r * 0.6;
        data[o + 1] = g * 0.6;
        data[o + 2] = b * 0.6;
        data[o + 3] = BORDER_ALPHA;
      } else {
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = id === this.selected ? FILL_ALPHA_SELECTED : FILL_ALPHA;
      }
    }
    const d = (this.dirty ??= { x0: x, y0: y, x1: x, y1: y });
    if (x < d.x0) d.x0 = x;
    if (x > d.x1) d.x1 = x;
    if (y < d.y0) d.y0 = y;
    if (y > d.y1) d.y1 = y;
  }

  private shownAt(x: number, y: number): number {
    const p = this.map.normalize(x, y);
    return p ? this.shown[p[1] * this.map.width + p[0]] : 0;
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
