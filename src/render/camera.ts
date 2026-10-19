// The camera looks at a point on the map (in map pixels) with a zoom level
// (screen pixels per map pixel).

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  minZoom = 0.5;
  maxZoom = 48;

  /** Screen size in CSS pixels. */
  viewWidth = 1;
  viewHeight = 1;

  constructor(
    private mapWidth: number,
    private mapHeight: number,
  ) {}

  setViewSize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.minZoom = this.fitZoom() * 0.75;
    this.clamp();
  }

  /** Zoom level at which the whole map fits on screen. */
  fitZoom(): number {
    return Math.min(this.viewWidth / this.mapWidth, this.viewHeight / this.mapHeight);
  }

  fitToMap(): void {
    this.zoom = this.fitZoom();
    this.x = this.mapWidth / 2;
    this.y = this.mapHeight / 2;
  }

  screenToMap(sx: number, sy: number): [number, number] {
    return [this.x + (sx - this.viewWidth / 2) / this.zoom, this.y + (sy - this.viewHeight / 2) / this.zoom];
  }

  /** Move by a distance in screen pixels. */
  panBy(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  /** Zoom by a factor, keeping the map point under (sx, sy) in place. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const [mx, my] = this.screenToMap(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const [mx2, my2] = this.screenToMap(sx, sy);
    this.x += mx - mx2;
    this.y += my - my2;
    this.clamp();
  }

  /** Keep the camera centre on the map so it can't get lost in the void. */
  private clamp(): void {
    this.x = Math.min(this.mapWidth, Math.max(0, this.x));
    this.y = Math.min(this.mapHeight, Math.max(0, this.y));
  }
}
