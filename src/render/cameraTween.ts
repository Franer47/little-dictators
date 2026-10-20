// Smooth camera moves, for cinematic moments such as zooming into the map at the start.

import type { Camera } from "./camera.ts";

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface CameraTween {
  /** Resolves when the move has finished (or was stopped). */
  done: Promise<void>;
  /** Stops where it is. */
  stop(): void;
}

/**
 * Moves the camera to a centre and zoom over `ms` milliseconds. Zoom changes on a log
 * scale, so zooming in feels steady. `onFrame` is called after every step (to redraw).
 */
export function tweenCamera(
  camera: Camera,
  to: { x: number; y: number; zoom: number },
  ms: number,
  onFrame: () => void,
  ease: (t: number) => number = easeInOutCubic,
): CameraTween {
  const from = { x: camera.x, y: camera.y, zoom: camera.zoom };
  const start = performance.now();
  let stopped = false;
  let finish = (): void => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  const step = (now: number): void => {
    if (stopped) return finish();
    const t = ms > 0 ? Math.min(1, (now - start) / ms) : 1;
    const e = ease(t);
    camera.moveTo(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e, from.zoom * (to.zoom / from.zoom) ** e);
    onFrame();
    if (t < 1) requestAnimationFrame(step);
    else finish();
  };
  requestAnimationFrame(step);
  return {
    done,
    stop: () => {
      stopped = true;
    },
  };
}
