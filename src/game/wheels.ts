// The nation-creation wheels: loaded from public/data/wheels.json, plus the actual spin
// (a weighted random pick). No drawing here; the wheel screen in src/ui/wheel/ shows it.

import { compactNumber, roundSignificant } from "./numbers.ts";
import { weightedPick, type Rng } from "./random.ts";
import { formatText } from "./text.ts";

export interface Slice {
  id: string;
  label: string;
  /** How likely this slice is compared to the others (all 1 = equal odds; 0 = never). */
  weight: number;
  /** A shorter label for small wheels (the retro wheel uses it); the full label shows when it lands. */
  short?: string;
  /** A short line of flavour text. */
  blurb?: string;
  /** What the wheel shows: the label, or for number wheels the range ("8M–25M"). Filled in on load. */
  shown: string;
  /** For number wheels: the range the exact number is picked from, e.g. [8000000, 25000000] people. */
  range?: [number, number];
  /** On an "exact number" wheel: the number this slice stands for. */
  value?: number;
}

/** How a number wheel shows its numbers. */
export interface EstimateFormat {
  /** The result as shown on the card, with {value} in it, e.g. "~{value} people". */
  format: string;
  /** "compact" = 42M / 1.2B, "full" = 350,000. */
  style: "compact" | "full";
  /** How a slice's range is shown on the wheel, with {low} and {high}, e.g. "${low}–{high}". */
  range?: string;
  /** How each slice of the second, "exact number" wheel is shown, e.g. "${value}". */
  value?: string;
  /** How many slices the exact-number wheel has (numbers spread evenly through the range). */
  exactSlices?: number;
  /** The exact-number wheel's question, with {range} in it. */
  exactQuestion?: string;
}

export interface Wheel {
  id: string;
  name: string;
  question: string;
  slices: Slice[];
  /**
   * Set for number wheels (population, GDP…): the first spin picks a range, then a
   * second spin picks the exact number from that range.
   */
  estimate?: EstimateFormat;
}

export interface NameData {
  titles: Record<string, string[]>;
  defaultTitles: string[];
  place: { starts: string[]; middles: string[]; middleChance: number; ends: string[] };
}

export interface WheelData {
  wheels: Wheel[];
  panel: { show: string[] };
  names: NameData;
  /** Screen text (English for now), keyed by name. */
  text: Record<string, string>;
  /** Endings for short big numbers: thousand, million, billion, trillion. */
  numberSuffixes: string[];
}

/** Where a spin landed. */
export interface SpinResult {
  index: number;
  slice: Slice;
  /** Where the wheel stops, as a fraction of a full turn from the start of slice 0 (0..1). */
  stopAt: number;
}

/** Loads and checks the wheel data file. Throws a readable error if something is wrong in it. */
export async function loadWheelData(url = "/data/wheels.json"): Promise<WheelData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  let data: WheelData;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`${url} isn't valid JSON: ${(e as Error).message}`);
  }
  checkWheelData(data, url);
  return data;
}

function checkWheelData(data: WheelData, url: string): void {
  const fail = (msg: string): never => {
    throw new Error(`${url}: ${msg}`);
  };
  if (!Array.isArray(data.wheels) || data.wheels.length === 0) fail(`"wheels" must be a list with at least one wheel`);
  data.numberSuffixes ??= ["K", "M", "B", "T"];
  for (const wheel of data.wheels) {
    const where = `wheel "${wheel.id ?? wheel.name ?? "?"}"`;
    if (!wheel.id || !wheel.name) fail(`${where} needs an "id" and a "name"`);
    if (!Array.isArray(wheel.slices) || wheel.slices.length < 2) fail(`${where} needs at least 2 slices`);
    for (const slice of wheel.slices) {
      if (!slice.label) fail(`${where} has a slice without a "label"`);
      slice.id ??= slice.label.toLowerCase().replace(/\W+/g, "-");
      slice.weight ??= 1;
      if (typeof slice.weight !== "number" || !(slice.weight >= 0))
        fail(`${where}, slice "${slice.label}": "weight" must be a number, 0 or more`);
      if (wheel.estimate) {
        const r = slice.range;
        if (!Array.isArray(r) || r.length !== 2 || !(r[0] > 0) || !(r[1] >= r[0]))
          fail(`${where}, slice "${slice.label}": "range" must be [low, high] with 0 < low <= high`);
      }
      // Number wheels show their ranges ("2M–8M"); the others show their labels.
      slice.shown =
        wheel.estimate && slice.range
          ? formatText(wheel.estimate.range ?? "{low}–{high}", {
              low: compactNumber(slice.range[0], data.numberSuffixes),
              high: compactNumber(slice.range[1], data.numberSuffixes),
            })
          : slice.label;
    }
    if (!wheel.slices.some((s) => s.weight > 0)) fail(`${where}: at least one slice needs a weight above 0`);
  }
  data.panel ??= { show: [] };
  data.text ??= {};
}

/**
 * The second wheel of a number wheel: after landing on a range such as 70M–200M, this
 * wheel's slices are numbers spread evenly through it (on a log scale, so each step is the
 * same percentage), rounded to 2 significant digits.
 */
export function exactWheel(wheel: Wheel, slice: Slice, data: WheelData): Wheel {
  const est = wheel.estimate!;
  const [low, high] = slice.range!;
  const count = Math.max(1, Math.round(est.exactSlices ?? 10));
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = roundSignificant(low * (high / low) ** ((i + 0.5) / count), 2);
    if (!values.includes(v)) values.push(v);
  }
  return {
    id: `${wheel.id}:exact`,
    name: wheel.name,
    question: formatText(est.exactQuestion ?? "{range}", { range: slice.shown }),
    slices: values.map((value) => {
      const label = formatNumber(est, value, data.numberSuffixes);
      return { id: String(value), label, shown: formatText(est.value ?? "{value}", { value: label }), weight: 1, value };
    }),
  };
}

/** A number in a number wheel's style: "42M" (compact) or "350,000" (full). */
export function formatNumber(est: EstimateFormat, value: number, suffixes: readonly string[]): string {
  return est.style === "full" ? value.toLocaleString("en-US") : compactNumber(value, suffixes);
}

/** Spins a wheel: picks a slice by weight and the exact spot to stop on. */
export function spinWheel(wheel: Wheel, rng: Rng): SpinResult {
  const weights = wheel.slices.map((s) => s.weight);
  const { index, within } = weightedPick(rng, weights);
  const total = totalWeight(wheel);
  const before = weights.slice(0, index).reduce((a, b) => a + b, 0);
  // Stop in the middle third of the winning slice, so its label rests nearly level and the
  // pointer is never near a line. This doesn't change which slice wins (that's the roll),
  // only where inside it the wheel comes to rest.
  const inside = 1 / 3 + within / 3;
  return { index, slice: wheel.slices[index], stopAt: (before + inside * weights[index]) / total };
}

export function totalWeight(wheel: Wheel): number {
  return wheel.slices.reduce((sum, s) => sum + s.weight, 0);
}

/** The chance of a slice, 0..1. */
export function chanceOf(wheel: Wheel, slice: Slice): number {
  return slice.weight / totalWeight(wheel);
}

/**
 * Dev check: spins a wheel many times and compares how often each slice won with its
 * weight. Run from the browser console: game.checkWeights() (all wheels).
 */
export function simulateSpins(
  wheel: Wheel,
  rng: Rng,
  spins = 100_000,
): { label: string; expected: string; got: string; diff: string }[] {
  const wins = new Array<number>(wheel.slices.length).fill(0);
  for (let i = 0; i < spins; i++) wins[spinWheel(wheel, rng).index]++;
  const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;
  return wheel.slices.map((slice, i) => {
    const expected = chanceOf(wheel, slice);
    const got = wins[i] / spins;
    return { label: slice.label, expected: pct(expected), got: pct(got), diff: `${((got - expected) * 100).toFixed(2)} pts` };
  });
}
