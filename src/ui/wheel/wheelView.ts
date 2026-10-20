// What both wheel styles share: the drawing interface and the slice geometry.
//
// Angles: the pointer sits on the right of the wheel (3 o'clock). The wheel's rotation
// `angle` is in radians, clockwise. A spot on the wheel is a "fraction" 0..1 of a full
// turn, measured clockwise from the start of the first slice; slices take up room in
// proportion to their weight, so the picture always matches the odds.

import type { Wheel } from "../../game/wheels.ts";

export const TAU = Math.PI * 2;

/** One frame's worth of what to draw. */
export interface WheelFrame {
  /** Wheel rotation in radians (clockwise). */
  angle: number;
  /** How fast it turns, radians per second. */
  speed: number;
  /** Seconds since the last frame. */
  dt: number;
  /** Seconds since the screen opened, for blinking lights. */
  time: number;
  /** Index of the winning slice once the wheel has stopped, else null. */
  winner: number | null;
  /** Seconds since the winner was decided. */
  winTime: number;
}

export interface WheelView {
  readonly canvas: HTMLCanvasElement;
  setWheel(wheel: Wheel): void;
  /** Sizes the wheel to fit in a box of this many CSS pixels. */
  resize(width: number, height: number): void;
  /** Where the pointer clicks as the wheel turns (fractions of a turn). */
  tickStops(): number[];
  /** Called when the wheel passes a tick stop, so the pointer can flap. */
  onTick(): void;
  draw(frame: WheelFrame): void;
  /** The pointer's tip in CSS pixels, relative to the canvas, for effects. */
  pointerTip(): { x: number; y: number };
}

/** Slice edges as fractions of a turn: [0, ..., 1], one more entry than there are slices. */
export function sliceEdges(wheel: Wheel): number[] {
  const total = wheel.slices.reduce((sum, s) => sum + s.weight, 0);
  const edges = [0];
  let sum = 0;
  for (const slice of wheel.slices) {
    sum += slice.weight;
    edges.push(sum / total);
  }
  edges[edges.length - 1] = 1;
  return edges;
}

/** Which slice covers a fraction of the turn. */
export function sliceAt(edges: readonly number[], fraction: number): number {
  const f = ((fraction % 1) + 1) % 1;
  for (let i = 1; i < edges.length; i++) if (f < edges[i]) return i - 1;
  return edges.length - 2;
}

/** The fraction of the wheel that's under the pointer at this rotation. */
export function fractionAtPointer(angle: number): number {
  return (((-angle / TAU) % 1) + 1) % 1;
}

/** The wheel rotation that puts this fraction under the pointer, nearest above `from`. */
export function angleToShow(fraction: number, from: number): number {
  const base = -fraction * TAU;
  const turns = Math.ceil((from - base) / TAU);
  return base + turns * TAU;
}

/** How many tick stops passed the pointer when the wheel turned from `prev` to `next`. */
export function ticksPassed(stops: readonly number[], prev: number, next: number): number {
  let n = 0;
  for (const s of stops) n += Math.abs(Math.floor(s + next / TAU) - Math.floor(s + prev / TAU));
  return n;
}

/** Which palette colour a slice gets: in order, but never the same as the slice next to it. */
export function sliceColor(index: number, count: number, paletteSize: number): number {
  const k = index % paletteSize;
  return index === count - 1 && count > 1 && k === 0 ? 1 % paletteSize : k;
}
