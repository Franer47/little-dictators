import { TERRAINS } from "../map/terrain.ts";
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
    for (let i = 0; i < this.map.terrain.length; i++) {
      const [r, g, b] = TERRAINS[this.map.terrain[i]].color;
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
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

    // Map pixels -> screen pixels.
    const scale = camera.zoom * dpr;
    const offsetX = (camera.viewWidth / 2 - camera.x * camera.zoom) * dpr;
    const offsetY = (camera.viewHeight / 2 - camera.y * camera.zoom) * dpr;
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapImage, 0, 0);

    if (this.hovered) {
      const [hx, hy] = this.hovered;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = Math.max(1.5 / scale, 0.08);
      ctx.strokeRect(hx, hy, 1, 1);
    }
  }
}
