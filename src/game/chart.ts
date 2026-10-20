// The nation chart: every nation gets a dot from its results. Left ↔ right is how good or
// evil its politics are (liberal and peaceful ↔ nationalist and tyrannical), bottom ↔ top
// is how good a place it is to live (miserable ↔ a good life). The dot sizes the slices of
// the bonus wheel, and the closer it is to a corner, the better the chance of a golden spin.

import type { WheelOutcome } from "./nation.ts";
import type { Gate, Wheel, WheelData } from "./wheels.ts";

export interface ChartPoint {
  /** -1 (left: liberal, peaceful) .. 1 (right: nationalist, tyrannical). */
  x: number;
  /** -1 (bottom: miserable) .. 1 (top: a good life). */
  y: number;
}

/** The nation's dot: the average push of its results on each axis, spread out, kept inside the chart. */
export function chartPosition(data: WheelData, results: Record<string, WheelOutcome>): ChartPoint {
  const [sx, sy] = data.chart?.spread ?? [1, 1];
  const sums = [0, 0];
  const counts = [0, 0];
  for (const r of Object.values(results))
    r.chart?.forEach((v, axis) => {
      if (v === null || v === undefined) return;
      sums[axis] += v;
      counts[axis]++;
    });
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
  return { x: clamp(counts[0] ? (sums[0] / counts[0]) * sx : 0), y: clamp(counts[1] ? (sums[1] / counts[1]) * sy : 0) };
}

/** 1 in a corner of the chart, 0 in the middle. */
export function cornerCloseness(p: ChartPoint): number {
  const d = Math.hypot(1 - Math.abs(p.x), 1 - Math.abs(p.y));
  return Math.max(0, 1 - d / Math.SQRT2);
}

/** The chance of "yes" on a gate (the golden spin): highest in the corners. */
export function gateChance(gate: Gate, p: ChartPoint): number {
  return gate.maxChance * cornerCloseness(p) ** (gate.power ?? 1);
}

/** Which corner the dot is nearest: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
export function cornerOf(p: ChartPoint): number {
  return (p.y >= 0 ? 0 : 2) + (p.x >= 0 ? 1 : 0);
}

/** The wheel with its slices sized (or picked) by the nation's spot on the chart. */
export function chartWeighted(wheel: Wheel, p: ChartPoint): Wheel {
  const cw = wheel.chartWeights;
  if (!cw) return wheel;
  if (cw.mode === "quadrant") {
    const corner = cornerOf(p);
    return { ...wheel, slices: wheel.slices.filter((s) => !s.at || cornerOf({ x: s.at[0], y: s.at[1] }) === corner) };
  }
  const floor = cw.floor ?? 0.1;
  const reach = cw.reach ?? 0.5;
  return {
    ...wheel,
    slices: wheel.slices.map((s) => {
      const d2 = s.at ? (s.at[0] - p.x) ** 2 + (s.at[1] - p.y) ** 2 : 0;
      return { ...s, weight: s.weight * (floor + (1 - floor) * Math.exp(-d2 / (2 * reach * reach))) };
    }),
  };
}
