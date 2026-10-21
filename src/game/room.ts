// How much room is left in the world, and how it changes the land wheel: the fuller the
// map, the rarer the big lands, and sizes bigger than any free gap shrink away. So a nation
// rolled late doesn't get "Vast" on the wheel and then only scraps on the map.

import type { Slice, Wheel } from "./wheels.ts";

/** The free land left where new nations go (e.g. Europe). */
export interface LandRoom {
  /** The region's name, e.g. "Europe". */
  region: string;
  /** Free land left, km². */
  left: number;
  /** How much of the region's land is owned already (0..1). */
  taken: number;
  /** The biggest single free patch of land, km². */
  biggestGap: number;
  /** Leave out slices whose sizes are all below this (km²), e.g. no city-states when Fill makes nations. */
  smallest?: number;
}

/** A land wheel's "room" settings (in the era file). */
export interface RoomRule {
  about?: string;
  /**
   * How fast big slices get rarer as the map fills: a slice's weight is multiplied by
   * (share still free) ^ (its typical size / fullness). Smaller = big lands vanish sooner.
   */
  fullness: number;
}

/**
 * The land wheel for the world as it is now. Each slice's weight shrinks with how full the
 * map is (more for bigger slices); a slice that only partly fits in the biggest free gap
 * keeps that part of its weight, and one that can't fit at all is removed. The smallest
 * slice always stays, so there is always something to land on.
 */
export function roomWeighted(wheel: Wheel, room: LandRoom, rule: RoomRule): Wheel {
  if (room.taken <= 0 && !Number.isFinite(room.biggestGap) && !room.smallest) return wheel;
  const free = Math.max(0, 1 - room.taken);
  const slices: Slice[] = [];
  for (const slice of wheel.slices) {
    const [low, high] = slice.range ?? [0, 0];
    if (!slice.range) {
      slices.push(slice);
      continue;
    }
    const typical = Math.sqrt(low * high);
    let weight = room.taken > 0 ? slice.weight * free ** (typical / rule.fullness) : slice.weight;
    if (room.smallest && high <= room.smallest) weight = 0;
    if (low >= room.biggestGap) weight = 0;
    else if (high > room.biggestGap) weight *= (room.biggestGap - low) / (high - low);
    if (weight > 0) slices.push({ ...slice, weight });
  }
  if (!slices.length) slices.push(wheel.slices[0]);
  return { ...wheel, slices };
}
