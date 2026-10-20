// The camera looks at a point on the map (in map pixels) with a zoom level
// (screen pixels per map pixel).
//
// Map edges: the top and bottom edges never come inside the screen. On a map that
// wraps east–west the camera can pan sideways forever (x is kept in 0..width); on a
// map that doesn't wrap, the left and right edges never come inside the screen either.

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
    private wrapX = false,
  ) {}

  setViewSize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.minZoom = this.fitZoom();
    this.zoom = Math.max(this.minZoom, this.zoom);
    this.clamp();
  }

  /**
   * The furthest you can zoom out: the map just fills the screen height. A map that
   * doesn't wrap must also fill the screen width, so no empty space shows at its sides.
   */
  fitZoom(): number {
    const fillHeight = this.viewHeight / this.mapHeight;
    return this.wrapX ? fillHeight : Math.max(fillHeight, this.viewWidth / this.mapWidth);
  }

  fitToMap(): void {
    this.zoom = this.minZoom;
    this.x = this.mapWidth / 2;
    this.y = this.mapHeight / 2;
    this.clamp();
  }

  /** Map position under a screen point. On a wrapping map x can be outside 0..width. */
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

  /** Jump to a centre and zoom (kept within the usual limits). */
  moveTo(x: number, y: number, zoom: number): void {
    this.x = x;
    this.y = y;
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    this.clamp();
  }

  /** Keep the map's edges off the screen (except the left/right seam of a wrapping map). */
  private clamp(): void {
    this.y = clampAxis(this.y, this.viewHeight / this.zoom, this.mapHeight);
    if (this.wrapX) {
      // Same spot, one Earth over: keeps x small no matter how far you pan.
      this.x = ((this.x % this.mapWidth) + this.mapWidth) % this.mapWidth;
    } else {
      this.x = clampAxis(this.x, this.viewWidth / this.zoom, this.mapWidth);
    }
  }
}

/**
 * Keeps a camera centre where the visible span (in map pixels) stays inside 0..size.
 * If the span is bigger than the map, the map is centred instead.
 */
function clampAxis(center: number, visible: number, size: number): number {
  if (visible >= size) return size / 2;
  const half = visible / 2;
  return Math.min(size - half, Math.max(half, center));
}
