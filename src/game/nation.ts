// A nation and how it was made. Plain data only: the wheel screen fills it in and the UI
// shows it, but nothing here draws anything. (The results are only shown for now; they
// don't change the game yet.) The spin-by-spin rules are in roller.ts.

import { chartPosition, type ChartPoint } from "./chart.ts";
import { roundSignificant } from "./numbers.ts";
import { pick, type Rng } from "./random.ts";
import { formatText } from "./text.ts";
import { chanceOf, compareSize, formatNumber, type NameData, type PlaceParts, type Slice, type Wheel, type WheelData } from "./wheels.ts";

/** One wheel's result. */
export interface WheelOutcome {
  wheelId: string;
  wheelName: string;
  /** What the result is called on the card and panel (e.g. "Population" for the density wheel). */
  resultName: string;
  sliceId: string;
  /** The slice's name in the data file, e.g. "Theocracy" or "Settled". */
  label: string;
  /** What the slice showed on the wheel: the label, or the range on some number wheels. */
  shown: string;
  blurb?: string;
  /** Extra name keys from the slice (see NameData.titles). */
  tags?: string[];
  /** Where this result pushes the nation on the chart. */
  chart?: [number | null, number | null];
  /** The slice's chance when it was rolled (0..1), including any spin before it (rare pull, golden chance). */
  chance: number;
  /** For number wheels: the exact number and what it adds up to. */
  estimate?: Estimate;
  /** For number wheels: the chance of the exact number on the second wheel (0..1). */
  exactChance?: number;
  /** For multi-pick wheels (e.g. 3 bonus resources): every pick, in order. */
  picks?: { sliceId: string; label: string; chance: number }[];
  /** A rare pull (one of the rare governments or ideologies). */
  rare?: boolean;
  /** From the golden spin. */
  golden?: boolean;
  /** A wheel that wasn't spun after all (the golden spin's "no luck"). */
  none?: boolean;
  /** What this result did to the nation, e.g. "Land ×2". */
  effectText?: string;
}

export interface Estimate {
  /** The result: an area, a population, a GDP… (the picked number times any chained result). */
  value: number;
  /** The result as text, e.g. "~1.2M people". */
  text: string;
  /** The number the second spin picked, e.g. 18 (people per km²), before any golden boost. Same as value on unchained wheels. */
  rate: number;
  /** The picked number as text, e.g. "18 people/km²". */
  rateText: string;
  /** The small line under the result, e.g. "Settled · 18 people/km²". */
  detail: string;
  /** A golden bonus multiplied this result (and limits stopped applying). */
  boost?: number;
}

/** Everything rolled when the nation was made. */
export interface CreationRecord {
  /** When the nation was created (ISO date-time). */
  createdAt: string;
  /** The map it was made for. */
  map: string;
  /** The era of the wheels, e.g. "1500". */
  era: string;
  /** The random seed used; the same seed gives the same rolls. */
  seed: number;
  /** Results in the order the wheels were spun. */
  spins: WheelOutcome[];
  /** The name first rolled, before any re-rolls or renaming. */
  firstName: string;
  /** The nation's dot on the chart. */
  chart: ChartPoint;
  /** The chance it had of a golden spin (0..1). */
  goldenChance?: number;
}

export interface Nation {
  name: string;
  /** Results by wheel id, e.g. results.government.label. */
  results: Record<string, WheelOutcome>;
  record: CreationRecord;
}

/**
 * Turns the winning slice into an outcome. Number wheels also pass the exact-number
 * wheel and its winning slice, plus the results so far (a chained wheel needs the one it
 * multiplies by).
 */
export function makeOutcome(
  wheel: Wheel,
  slice: Slice,
  data: WheelData,
  exact?: { wheel: Wheel; slice: Slice },
  results: Record<string, WheelOutcome> = {},
): WheelOutcome {
  const outcome: WheelOutcome = {
    wheelId: wheel.id,
    wheelName: wheel.name,
    resultName: wheel.resultName ?? wheel.name,
    sliceId: slice.id,
    label: slice.label,
    shown: slice.shown,
    blurb: slice.blurb,
    tags: slice.tags,
    chart: slice.chart,
    chance: chanceOf(wheel, slice),
  };
  if (slice.golden) outcome.golden = true;
  if (wheel.number && exact && exact.slice.value !== undefined) {
    outcome.estimate = makeEstimate(data, wheel, slice, exact.slice.value, chainBase(wheel, results));
    outcome.exactChance = chanceOf(exact.wheel, exact.slice);
  }
  return outcome;
}

/**
 * A number wheel's result: the picked number (`rate`), chained to the earlier result it
 * multiplies by (`base`), times any golden `boost`. Limits ("max") only hold unboosted.
 */
export function makeEstimate(data: WheelData, wheel: Wheel, slice: Slice, rate: number, base: number | undefined, boost = 1): Estimate {
  const num = wheel.number!;
  const sfx = data.numberSuffixes;
  // A boost multiplies the picked number itself (twice the people per km², twice the output per person).
  const picked = boost !== 1 ? roundSignificant(rate * boost, num.digits ?? 2) : rate;
  const raw = num.times ? roundSignificant(picked * (base ?? 0), num.totalDigits ?? 2) : picked;
  const value = boost === 1 && num.max !== undefined ? Math.min(num.max, raw) : raw;
  const rateText = formatText(num.value ?? "{value}", { value: formatNumber(picked, num.style ?? "compact", sfx) });
  const text = num.times
    ? formatText(num.total ?? "{value}", { value: formatNumber(value, num.totalStyle ?? "compact", sfx) })
    : formatText(num.value ?? "{value}", { value: formatNumber(value, num.style ?? "compact", sfx) });
  let detail = formatText(num.detail ?? "{range}", {
    label: slice.label,
    range: slice.rangeText ?? "",
    value: rateText,
    total: text,
    compare: num.compare ? compareSize(num.compare, value) : "",
  });
  if (boost !== 1) detail = [formatText(data.text.boosted ?? "×{factor} golden bonus", { factor: boost }), detail].filter(Boolean).join(" · ");
  const estimate: Estimate = { value, text, rate, rateText, detail };
  if (boost !== 1) estimate.boost = boost;
  return estimate;
}

/** The earlier result a chained number wheel multiplies by (undefined if it isn't chained). */
export function chainBase(wheel: Wheel, results: Record<string, WheelOutcome>): number | undefined {
  const id = wheel.number?.times;
  return id ? results[id]?.estimate?.value : undefined;
}

/** How to show a result: the main text, plus a smaller line (details on number wheels). */
export function describeOutcome(outcome: WheelOutcome): { main: string; sub: string } {
  if (outcome.estimate) return { main: outcome.estimate.text, sub: outcome.estimate.detail };
  return { main: outcome.shown, sub: outcome.effectText ?? "" };
}

/**
 * A random name such as "Holy Sultanate of Al-Basra" or "Iron Grand Duchy of Wittenstein":
 * a title picked by the government, a made-up place name in a style that fits it (or the
 * culture's style, if a culture wheel is spun), and sometimes a word from the outlook.
 */
export function generateName(names: NameData, results: Record<string, WheelOutcome>, rng: Rng): string {
  const gov = results[names.titlesBy]?.sliceId;
  const set = gov ? names.titles[gov] : undefined;
  const style = nameStyle(names, results, set?.styles, rng);
  const parts = names.places[style] ?? names.places.default;
  let title = pick(rng, titlesFor(names, set, [style, ...(parts.tags ?? [])], results));
  let wrap = "{name}";
  // A word from the outlook, e.g. "Great {name}" or "Greater {place}", unless the title has it already.
  const mods = names.modifiersBy ? names.modifiers?.[results[names.modifiersBy]?.sliceId ?? ""] : undefined;
  if (mods?.length && rng.next() < (names.modifierChance ?? 1)) {
    const mod = pick(rng, mods);
    const word = mod.replace(/\{(name|place)\}/g, "").trim().toLowerCase();
    if (!title.toLowerCase().includes(word)) {
      if (mod.includes("{place}")) title = title.replace("{place}", mod);
      else wrap = mod;
    }
  }
  return wrap.replace("{name}", title.replace("{place}", placeName(parts, rng)));
}

/** Which syllable style the name uses: the culture's if one was spun, else one the government suits. */
function nameStyle(names: NameData, results: Record<string, WheelOutcome>, styles: string[] | undefined, rng: Rng): string {
  const culture = results[names.placesBy]?.sliceId;
  if (culture && names.places[culture]) return culture;
  const all = Object.keys(names.places).filter((k) => k !== "default");
  const list = styles?.length ? styles : all;
  return list.length ? pick(rng, list) : "default";
}

/** The title list for this nation: its government's titles, by the first key that has some. */
function titlesFor(names: NameData, set: NameData["titles"][string] | undefined, styleKeys: string[], results: Record<string, WheelOutcome>): string[] {
  if (!set) return names.defaultTitles;
  const keysOf = (r: WheelOutcome): string[] => [r.sliceId, ...(r.tags ?? [])];
  const preferred = set.prefer ? results[set.prefer] : undefined;
  const others = Object.values(results).filter((r) => r !== preferred);
  const keys = [...(preferred ? keysOf(preferred) : []), ...styleKeys, ...others.flatMap(keysOf)];
  for (const key of [...keys, "default"]) {
    const list = key === "prefer" || key === "styles" ? undefined : set[key];
    if (Array.isArray(list) && list.length) return list;
  }
  return names.defaultTitles;
}

function placeName(parts: PlaceParts, rng: Rng): string {
  const min = parts.minLength ?? 4;
  const max = parts.maxLength ?? 12;
  let name = "";
  // Roll again if it comes out too short or too long (a few tries, then keep the last).
  for (let tries = 0; tries < 8; tries++) {
    name = pick(rng, parts.starts);
    if (parts.middles?.length && rng.next() < (parts.middleChance ?? 0)) name = join(name, pick(rng, parts.middles), parts.smooth);
    name = join(name, pick(rng, parts.ends), parts.smooth);
    // Also roll again on three vowels in a row ("Touux"), which reads badly in any style.
    if (name.length >= min && name.length <= max && !/[aeiou]{3}/i.test(name)) break;
  }
  name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  if (parts.prefixes?.length && rng.next() < (parts.prefixChance ?? 0)) name = pick(rng, parts.prefixes) + name;
  return name;
}

/** Joins two name parts, dropping a letter where they'd clash (two vowels, or a doubled letter). */
function join(a: string, b: string, smooth = true): string {
  if (!smooth) return a + b;
  const vowels = "aeiouy";
  const last = a.slice(-1).toLowerCase();
  const first = b.charAt(0).toLowerCase();
  if (last === first || (vowels.includes(last) && vowels.includes(first))) return a + b.slice(1);
  return a + b;
}

/** Builds the finished nation from the outcomes, in spin order. */
export function createNation(data: WheelData, spins: WheelOutcome[], map: string, rng: Rng, goldenChance?: number): Nation {
  const results = resultsById(spins);
  const name = generateName(data.names, results, rng);
  const record: CreationRecord = {
    createdAt: new Date().toISOString(),
    map,
    era: data.era,
    seed: rng.seed,
    spins,
    firstName: name,
    chart: chartPosition(data, results),
  };
  if (goldenChance !== undefined) record.goldenChance = goldenChance;
  return { name, results, record };
}

export function resultsById(spins: readonly WheelOutcome[]): Record<string, WheelOutcome> {
  const results: Record<string, WheelOutcome> = {};
  for (const outcome of spins) results[outcome.wheelId] = outcome;
  return results;
}
