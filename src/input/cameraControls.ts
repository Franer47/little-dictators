import type { Camera } from "../render/camera.ts";

const KEY_PAN_SPEED = 700; // screen pixels per second
const KEY_ZOOM_SPEED = 2.5; // zoom factor per second
const WHEEL_ZOOM_PER_PIXEL = 0.0015; // one mouse-wheel notch (~100px) ≈ 16% zoom
const DRAG_THRESHOLD = 4; // pixels moved before a press counts as a drag, not a click

export interface CameraControlsOptions {
  onChange: () => void;
  onHover: (sx: number, sy: number) => void;
  onClick: (sx: number, sy: number) => void;
  onFit: () => void;
  /** A right-click (no drag) on the map, e.g. the diplomacy menu. */
  onRightClick?: (sx: number, sy: number) => void;
}

/** Mouse and keyboard controls for moving the camera around. */
export class CameraControls {
  /** Off while another screen (e.g. the wheel) is in front of the map. */
  enabled = true;
  /**
   * While a brush is picked: called on a left press and every move while it's held, instead of
   * panning (the right button still pans). Returns false to pan as usual after all.
   */
  paint: ((sx: number, sy: number) => boolean) | null = null;
  private painting = false;
  private keys = new Set<string>();
  private dragStart: { x: number; y: number } | null = null;
  private lastPointer = { x: 0, y: 0 };
  private dragging = false;
  private lastFrame = performance.now();

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private opts: CameraControlsOptions,
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    requestAnimationFrame(this.tick);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.painting = e.button === 0 && !!this.paint && this.paint(e.offsetX, e.offsetY);
    this.dragStart = { x: e.offsetX, y: e.offsetY };
    this.lastPointer = { x: e.offsetX, y: e.offsetY };
    this.dragging = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.painting) {
      this.paint?.(e.offsetX, e.offsetY);
      this.lastPointer = { x: e.offsetX, y: e.offsetY };
      this.opts.onHover(e.offsetX, e.offsetY);
      return;
    }
    if (this.dragStart) {
      const moved = Math.hypot(e.offsetX - this.dragStart.x, e.offsetY - this.dragStart.y);
      if (moved > DRAG_THRESHOLD) {
        this.dragging = true;
        this.canvas.classList.add("dragging");
      }
      if (this.dragging) {
        this.camera.panBy(e.offsetX - this.lastPointer.x, e.offsetY - this.lastPointer.y);
        this.opts.onChange();
      }
    }
    this.lastPointer = { x: e.offsetX, y: e.offsetY };
    this.opts.onHover(e.offsetX, e.offsetY);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragStart && !this.dragging && !this.painting && e.button === 0) {
      this.opts.onClick(e.offsetX, e.offsetY);
    }
    if (this.dragStart && !this.dragging && e.button === 2) this.opts.onRightClick?.(e.offsetX, e.offsetY);
    this.painting = false;
    this.dragStart = null;
    this.dragging = false;
    this.canvas.classList.remove("dragging");
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Wheel deltas can be in lines or pages instead of pixels; convert to pixels.
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 800 : 1;
    const delta = Math.max(-600, Math.min(600, e.deltaY * unit));
    const factor = Math.exp(-delta * WHEEL_ZOOM_PER_PIXEL);
    this.camera.zoomAt(factor, e.offsetX, e.offsetY);
    this.opts.onChange();
    this.opts.onHover(e.offsetX, e.offsetY);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // Not while typing (e.g. renaming the nation) or while the map is covered.
    if (!this.enabled || (e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
    this.keys.add(e.code);
    if (e.code === "KeyF") {
      this.opts.onFit();
    }
  };

  /** Runs every frame to apply held-down keys smoothly. */
  private tick = (now: number): void => {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    let dx = 0;
    let dy = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy -= 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx += 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx -= 1;

    let zoom = 0;
    if (this.keys.has("KeyE") || this.keys.has("Equal") || this.keys.has("NumpadAdd")) zoom += 1;
    if (this.keys.has("KeyQ") || this.keys.has("Minus") || this.keys.has("NumpadSubtract")) zoom -= 1;

    if (dx || dy || zoom) {
      const speed = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 2 : 1;
      this.camera.panBy(dx * KEY_PAN_SPEED * speed * dt, dy * KEY_PAN_SPEED * speed * dt);
      if (zoom) {
        const factor = Math.pow(KEY_ZOOM_SPEED, zoom * dt);
        this.camera.zoomAt(factor, this.camera.viewWidth / 2, this.camera.viewHeight / 2);
      }
      this.opts.onChange();
    }
    requestAnimationFrame(this.tick);
  };
}
