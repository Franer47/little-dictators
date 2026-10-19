import { paintTerrain } from "./terrainColors.ts";
import type { GameMap } from "../map/gameMap.ts";
import type { Camera } from "./camera.ts";

/**
 * Draws the map. The whole map is painted once into a small offscreen image
 * (one canvas pixel per map pixel), which is then scaled up with the camera's zoom.
 */
export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private mapImage: OffscreenCanvas;
  hovered: [number, number] | null = null;

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
    for (const k of copies) {
      const left = Math.round(offsetX + k * width * scale);
      const right = Math.round(offsetX + (k + 1) * width * scale);
      ctx.drawImage(this.mapImage, left, top, right - left, bottom - top);
    }

    if (this.hovered) {
      const [hx, hy] = this.hovered;
      ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = Math.max(1.5 / scale, 0.08);
      for (const k of copies) ctx.strokeRect(hx + k * width, hy, 1, 1);
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
