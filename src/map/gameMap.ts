import { TERRAIN_BY_COLOR, Terrain, colorKey } from "./terrain.ts";
import type { MapProjection } from "./projection.ts";

export interface MapMeta extends MapProjection {
  name: string;
  image: string;
  projection: string;
  /** True if the map loops east–west: the right edge joins the left edge. */
  wrapX?: boolean;
}

/** The world grid: one terrain value per pixel. Game logic works on this, not on images. */
export class GameMap {
  constructor(
    readonly meta: MapMeta,
    readonly terrain: Uint8Array,
  ) {}

  get width(): number {
    return this.meta.width;
  }

  get height(): number {
    return this.meta.height;
  }

  /** True if the map loops east–west. It never loops north–south. */
  get wraps(): boolean {
    return this.meta.wrapX ?? false;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** On a wrapping map, brings any x back into 0..width-1 (e.g. -1 becomes width-1). */
  wrapX(x: number): number {
    if (!this.wraps) return x;
    return ((x % this.width) + this.width) % this.width;
  }

  /**
   * Turns any pixel position into the real map pixel it stands for, or null if it's off
   * the map. Use this to find neighbours across the left/right seam (Alaska ↔ Chukotka).
   */
  normalize(x: number, y: number): [number, number] | null {
    const wx = this.wrapX(x);
    return this.inBounds(wx, y) ? [wx, y] : null;
  }

  terrainAt(x: number, y: number): Terrain {
    return this.terrain[y * this.width + x];
  }
}

/** Loads a map from public/maps/<name>.json and its PNG. */
export async function loadMap(name: string): Promise<GameMap> {
  const meta: MapMeta = await (await fetch(`/maps/${name}.json`)).json();

  const img = new Image();
  img.src = `/maps/${meta.image}`;
  await img.decode();

  const canvas = new OffscreenCanvas(meta.width, meta.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, meta.width, meta.height);

  const terrain = new Uint8Array(meta.width * meta.height);
  for (let i = 0; i < terrain.length; i++) {
    const key = colorKey(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    terrain[i] = TERRAIN_BY_COLOR.get(key) ?? Terrain.Ocean;
  }
  return new GameMap(meta, terrain);
}
