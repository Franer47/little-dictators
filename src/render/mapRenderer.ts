import { paintTerrain } from "./terrainColors.ts";
import type { GameMap } from "../map/gameMap.ts";
import type { Camera } from "./camera.ts";
import type { TerritoryLayer } from "./territoryLayer.ts";

/** The "place your nation here" cursor: a circle about the size the nation will grow to. */
export interface PlacementPreview {
  /** Radius in map pixels. */
  radius: number;
  /** "#rrggbb". */
  color: string;
  /** False over water, ice, another nation or outside the region: drawn as a red cross. */
  valid: boolean;
}

/** Where the map is on screen, for layers drawn on top of it (names, army flags). */
export interface MapView {
  /** Device pixels per map pixel. */
  scale: number;
  /** Where map pixel (0, 0) of the real map is, in device pixels. */
  offsetX: number;
  offsetY: number;
  /** Device pixels per CSS pixel. */
  dpr: number;
  /** Which copies of the map are on screen (see visibleCopies). */
  copies: number[];
  mapWidth: number;
  /** Size of the screen in device pixels. */
  screenWidth: number;
  screenHeight: number;
}

/** Something drawn over the map in screen space (so text and flags stay sharp at any zoom). */
export interface MapOverlay {
  draw(ctx: CanvasRenderingContext2D, view: MapView): void;
}

/**
 * Draws the map. The whole map is painted once into a small offscreen image
 * (one canvas pixel per map pixel), which is then scaled up with the camera's zoom.
 * Nations' land is a second image of the same size on top (see territoryLayer.ts).
 */
export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private mapImage: OffscreenCanvas;
  hovered: [number, number] | null = null;
  /** Nations' land, drawn over the terrain. */
  territory: TerritoryLayer | null = null;
  /** Shown at the hovered pixel while placing a nation. */
  preview: PlacementPreview | null = null;
  /** The brush outline at the hovered pixel while painting (same look as the placement preview). */
  cursor: PlacementPreview | null = null;
  /** Drawn over the land, in order (nation names, then army flags). */
  overlays: MapOverlay[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private map: GameMap,
    private camera: Camera,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.mapImage = new OffscreenCanvas(map.width, map.height);
    this.paintMapImage();
  }

  private paintMapImage(): void {
    const ctx = this.mapImage.getContext("2d")!;
    const img = ctx.createImageData(this.map.width, this.map.height);
    paintTerrain(this.map, img.data);
    ctx.putImageData(img, 0, 0);
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.camera.setViewSize(w, h);
  }

  render(): void {
    const { ctx, camera } = this;
    const dpr = window.devicePixelRatio || 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b3354";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Map pixels -> device pixels.
    const scale = camera.zoom * dpr;
    const offsetX = (camera.viewWidth / 2 - camera.x * camera.zoom) * dpr;
    const offsetY = (camera.viewHeight / 2 - camera.y * camera.zoom) * dpr;
    const { width, height } = this.map;
    const copies = this.visibleCopies();

    // On a wrapping map, draw one copy of the map per visible "Earth" side by side.
    // Each copy's edges are rounded to whole device pixels so neighbouring copies
    // meet exactly, with no thin seam of background between them.
    ctx.imageSmoothingEnabled = false;
    const top = Math.round(offsetY);
    const bottom = Math.round(offsetY + height * scale);
    const layers: CanvasImageSource[] = [this.mapImage];
    if (this.territory) {
      this.territory.flush();
      layers.push(this.territory.image);
    }
    for (const layer of layers) {
      for (const k of copies) {
        const left = Math.round(offsetX + k * width * scale);
        const right = Math.round(offsetX + (k + 1) * width * scale);
        ctx.drawImage(layer, left, top, right - left, bottom - top);
      }
    }

    if (this.overlays.length) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const view: MapView = { scale, offsetX, offsetY, dpr, copies, mapWidth: width, screenWidth: this.canvas.width, screenHeight: this.canvas.height };
      for (const overlay of this.overlays) overlay.draw(ctx, view);
    }

    if (this.hovered) {
      const [hx, hy] = this.hovered;
      ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = Math.max(1.5 / scale, 0.08);
      for (const k of copies) ctx.strokeRect(hx + k * width, hy, 1, 1);
      if (this.preview) this.drawPreview(this.preview, hx, hy, dpr / scale, copies);
      else if (this.cursor) this.drawPreview(this.cursor, hx, hy, dpr / scale, copies);
    }
  }

  /** `px` is one CSS pixel in map pixels, for line widths that stay the same at any zoom. */
  private drawPreview(preview: PlacementPreview, hx: number, hy: number, px: number, copies: number[]): void {
    const { ctx } = this;
    for (const k of copies) {
      const cx = hx + 0.5 + k * this.map.width;
      const cy = hy + 0.5;
      ctx.beginPath();
      if (preview.valid) {
        ctx.arc(cx, cy, Math.max(preview.radius, 8 * px), 0, Math.PI * 2);
        ctx.fillStyle = preview.color + "40";
        ctx.fill();
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.lineWidth = 2 * px;
        ctx.strokeStyle = preview.color;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const r = 8 * px;
        ctx.moveTo(cx - r, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r);
        ctx.lineTo(cx - r, cy + r);
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = "#ff4d4d";
        ctx.stroke();
      }
    }
  }

  /**
   * Which copies of the map are on screen: 0 is the real map, -1 the copy to its
   * left, 1 the copy to its right, and so on. A map that doesn't wrap only has copy 0.
   */
  private visibleCopies(): number[] {
    const { camera, map } = this;
    if (!map.wraps) return [0];
    const halfView = camera.viewWidth / 2 / camera.zoom;
    const first = Math.floor((camera.x - halfView) / map.width);
    const last = Math.floor((camera.x + halfView) / map.width);
    const copies: number[] = [];
    for (let k = first; k <= last; k++) copies.push(k);
    return copies;
  }
}
