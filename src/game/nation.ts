// A nation and how it was made. Plain data only: the wheel screen fills it in and the UI
// shows it, but nothing here draws anything. (The results are only shown for now; they
// don't change the game yet.)

import { pick, type Rng } from "./random.ts";
import { formatText } from "./text.ts";
import {
  chainTotal,
  chanceOf,
  compareSize,
  exactWheel,
  formatNumber,
  spinWheel,
  type NameData,
  type PlaceParts,
  type Slice,
  withoutPicked,
  type Wheel,
  type WheelData,
} from "./wheels.ts";

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
  /** The slice's chance when it was rolled (0..1). */
  chance: number;
  /** For number wheels: the exact number and what it adds up to. */
  estimate?: Estimate;
  /** For number wheels: the chance of the exact number on the second wheel (0..1). */
  exactChance?: number;
  /** For multi-pick wheels (e.g. 3 bonus resources): every pick, in order. */
  picks?: { sliceId: string; label: string; chance: number; rare?: boolean }[];
  /** Landed on a rare slice. */
  rare?: boolean;
}

export interface Estimate {
  /** The result: an area, a population, a GDP… (the picked number times any chained result). */
  value: number;
  /** The result as text, e.g. "~1.2M people". */
  text: string;
  /** The number the second spin picked, e.g. 18 (people per km²). Same as value on unchained wheels. */
  rate: number;
  /** The picked number as text, e.g. "18 people/km²". */
  rateText: string;
  /** The small line under the result, e.g. "Settled · 18 people/km²". */
  detail: string;
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
    chance: chanceOf(wheel, slice),
  };
  if (slice.rare) outcome.rare = true;
  const num = wheel.number;
  if (num && exact && exact.slice.value !== undefined) {
    const sfx = data.numberSuffixes;
    const rate = exact.slice.value;
    const value = chainTotal(num, rate, chainBase(wheel, results));
    const rateText = formatText(num.value ?? "{value}", { value: formatNumber(rate, num.style ?? "compact", sfx) });
    const text = num.times
      ? formatText(num.total ?? "{value}", { value: formatNumber(value, num.totalStyle ?? "compact", sfx) })
      : rateText;
    const detail = formatText(num.detail ?? "{range}", {
      label: slice.label,
      range: slice.rangeText ?? "",
      value: rateText,
      total: text,
      compare: num.compare ? compareSize(num.compare, value) : "",
    });
    outcome.estimate = { value, text, rate, rateText, detail };
    outcome.exactChance = chanceOf(exact.wheel, exact.slice);
  }
  return outcome;
}

/**
 * A multi-pick wheel's result (e.g. bonus resources "Iron, Salt, Wine"). Each pick is
 * made from `wheels[i]`, the wheel as it was for that spin (without earlier picks).
 */
export function makePicksOutcome(wheel: Wheel, picks: { wheel: Wheel; slice: Slice }[]): WheelOutcome {
  const list = picks.map(({ wheel: w, slice }) => ({ sliceId: slice.id, label: slice.label, chance: chanceOf(w, slice), rare: slice.rare }));
  const label = list.map((p) => p.label).join(", ");
  const outcome: WheelOutcome = {
    wheelId: wheel.id,
    wheelName: wheel.name,
    resultName: wheel.resultName ?? wheel.name,
    sliceId: list.map((p) => p.sliceId).join("+"),
    label,
    shown: label,
    chance: list.reduce((c, p) => c * p.chance, 1),
    picks: list,
  };
  if (list.some((p) => p.rare)) outcome.rare = true;
  return outcome;
}

/** The earlier result a chained number wheel multiplies by (undefined if it isn't chained). */
export function chainBase(wheel: Wheel, results: Record<string, WheelOutcome>): number | undefined {
  const id = wheel.number?.times;
  return id ? results[id]?.estimate?.value : undefined;
}

/** How to show a result: the main text, plus a smaller line (details on number wheels). */
export function describeOutcome(outcome: WheelOutcome): { main: string; sub: string } {
  return outcome.estimate ? { main: outcome.estimate.text, sub: outcome.estimate.detail } : { main: outcome.shown, sub: "" };
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
export function createNation(data: WheelData, spins: WheelOutcome[], map: string, rng: Rng): Nation {
  const results = resultsById(spins);
  const name = generateName(data.names, results, rng);
  return {
    name,
    results,
    record: { createdAt: new Date().toISOString(), map, era: data.era, seed: rng.seed, spins, firstName: name },
  };
}

export function resultsById(spins: readonly WheelOutcome[]): Record<string, WheelOutcome> {
  const results: Record<string, WheelOutcome> = {};
  for (const outcome of spins) results[outcome.wheelId] = outcome;
  return results;
}

/** Spins one wheel with no animation, including its exact-number spin or its extra picks. */
export function rollWheel(data: WheelData, wheel: Wheel, results: Record<string, WheelOutcome>, rng: Rng): WheelOutcome {
  if (wheel.picks && wheel.picks > 1) return rollPicks(wheel, [], rng);
  const slice = spinWheel(wheel, rng).slice;
  return rollExact(data, wheel, slice, results, rng);
}

/** The rest of a multi-pick wheel, after the picks already made. */
export function rollPicks(wheel: Wheel, done: { wheel: Wheel; slice: Slice }[], rng: Rng): WheelOutcome {
  const picks = [...done];
  while (picks.length < (wheel.picks ?? 1)) {
    const now = withoutPicked(wheel, picks.map((p) => p.slice));
    picks.push({ wheel: now, slice: spinWheel(now, rng).slice });
  }
  return makePicksOutcome(wheel, picks);
}

/** The rest of a spin once the first wheel landed on `slice`: the exact number, if it's a number wheel. */
export function rollExact(data: WheelData, wheel: Wheel, slice: Slice, results: Record<string, WheelOutcome>, rng: Rng): WheelOutcome {
  if (!wheel.number) return makeOutcome(wheel, slice, data);
  const exact = exactWheel(wheel, slice, data, chainBase(wheel, results));
  return makeOutcome(wheel, slice, data, { wheel: exact, slice: spinWheel(exact, rng).slice }, results);
}

/** Rolls every wheel at once, with no animation (used by ?wheel=skip, for quick testing). */
export function rollNation(data: WheelData, map: string, rng: Rng): Nation {
  const results: Record<string, WheelOutcome> = {};
  const spins = data.wheels.map((wheel) => (results[wheel.id] = rollWheel(data, wheel, results, rng)));
  return createNation(data, spins, map, rng);
}
