// Random numbers for game logic. Everything random in the game should come from an Rng,
// never Math.random(), so a game can be replayed later from its seed.

/** A random number source: next() gives a number in [0, 1). */
export interface Rng {
  readonly seed: number;
  next(): number;
}

/** A new seed from the browser's crypto random source. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** A seeded random source (mulberry32: small, fast, good enough for games). Same seed, same numbers. */
export function createRng(seed: number = randomSeed()): Rng {
  let state = seed >>> 0;
  return {
    seed: seed >>> 0,
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** A whole number from min to max, both included. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}

/** One item from a list, all equally likely. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)];
}

/**
 * Picks an index by weight: weight 2 is twice as likely as weight 1, weight 0 never wins.
 * Also returns where in the winner's share the roll landed (0..1), which a wheel uses as
 * the exact spot to stop on, so the picture always matches the roll.
 */
export function weightedPick(rng: Rng, weights: readonly number[]): { index: number; within: number } {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) throw new Error("weightedPick: weights must add up to more than 0");
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0) continue;
    if (roll < weights[i]) return { index: i, within: roll / weights[i] };
    roll -= weights[i];
  }
  // Only reachable through rounding at the very top end: give it to the last real slice.
  let last = weights.length - 1;
  while (weights[last] <= 0) last--;
  return { index: last, within: 1 - 1e-9 };
}
