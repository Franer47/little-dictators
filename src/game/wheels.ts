// The nation-creation wheels: loaded from public/data/ (wheels.json for the shared bits and
// which era is active, plus one file per era with that era's wheels and names), plus the
// actual spin (a weighted random pick). No drawing here; src/ui/wheel/ shows it.

import { compactNumber, roundSignificant } from "./numbers.ts";
import { weightedPick, type Rng } from "./random.ts";
import { formatText } from "./text.ts";

export interface Slice {
  id: string;
  label: string;
  /** How likely this slice is compared to the others (all 1 = equal odds; 0 = never). */
  weight: number;
  /** A shorter label for the wheel itself; the full label shows when it lands. */
  short?: string;
  /** A short line of flavour text. */
  blurb?: string;
  /** Extra keys for picking name titles, e.g. "islamic" or "steppe" (see NameData.titles). */
  tags?: string[];
  /** What the wheel shows: the label, or for number wheels maybe the range ("8K–25K km²"). Filled in on load. */
  shown: string;
  /** For number wheels: the range the exact number is picked from, e.g. [15, 25] people per km². */
  range?: [number, number];
  /** For number wheels: the range written out ("15–25 people/km²"). Filled in on load. */
  rangeText?: string;
  /** On an "exact number" wheel: the number this slice stands for (before any chaining). */
  value?: number;
  /** A rare slice: drawn in gold, and a big celebration when it lands. */
  rare?: boolean;
}

/**
 * How a number wheel works. The first spin picks a slice with a range; a second spin
 * picks the exact number in that range. A chained wheel ("times") multiplies that number
 * by an earlier wheel's result: density × land = population, wealth × population = GDP.
 */
export interface NumberSpec {
  /** What the first wheel's slices show: their range (default) or their label. */
  shows?: "range" | "label";
  /** How a range is written, with {low} and {high}, e.g. "{low}–{high} km²". */
  range?: string;
  /** "compact" (default) = 42M / 1.2K, "full" = 1,200. */
  rangeStyle?: NumberStyle;
  /** How the picked number reads, with {value}, e.g. "{value} people/km²". */
  value?: string;
  style?: NumberStyle;
  /** Significant digits of the picked numbers on the exact wheel (default 2: 41,000 / 18 / 1,600). */
  digits?: number;
  /** Chain: the id of an earlier number wheel whose result this number is multiplied by. */
  times?: string;
  /** How the result reads (after chaining), with {value}, e.g. "~{value} people". */
  total?: string;
  totalStyle?: NumberStyle;
  /** Significant digits of the result after chaining (default 2). */
  totalDigits?: number;
  /** The result is never more than this. */
  max?: number;
  /** How many slices the exact-number wheel has (numbers spread evenly through the range). */
  exactSlices?: number;
  /** What each exact slice shows: the picked number ("value"), or the result it gives ("total"). */
  exactShows?: "value" | "total";
  /** How each exact slice is written, with {value}, e.g. "${value}". */
  exactLabel?: string;
  /** The exact-number wheel's question, with {range} and {label}. */
  exactQuestion?: string;
  /** The small line under the result, with {label}, {range}, {value}, {total} and {compare}. */
  detail?: string;
  /** A friendly size comparison, e.g. "≈ the size of Portugal" (for land). */
  compare?: Comparison;
}

export type NumberStyle = "compact" | "full";

export interface Comparison {
  /** Texts with {place}: when the size is close, bigger, or smaller than the nearest place. */
  near: string;
  bigger: string;
  smaller: string;
  /** [name, size] pairs, in the same unit as the wheel. */
  places: [string, number][];
}

export interface Wheel {
  id: string;
  name: string;
  /** The name of the result on the card and panel, if not the wheel's name (e.g. "Population"). */
  resultName?: string;
  question: string;
  slices: Slice[];
  /** Set for number wheels. */
  number?: NumberSpec;
  /** Spin this wheel this many times, never landing on the same slice twice (e.g. 3 bonus resources). */
  picks?: number;
  /** true = the wheel stays in the file but isn't spun (and isn't shown anywhere). */
  off?: boolean;
}

/** Syllables for made-up place names: a start + sometimes a middle + an end, e.g. Var + nia. */
export interface PlaceParts {
  /** Extra keys for picking titles when this style is used (e.g. "islamic"). */
  tags?: string[];
  starts: string[];
  middles?: string[];
  middleChance?: number;
  ends: string[];
  /** Put in front sometimes, e.g. "Al-". */
  prefixes?: string[];
  prefixChance?: number;
  /** false = glue parts as they are; true (default) = drop a letter where vowels or doubles clash. */
  smooth?: boolean;
  /** Place names shorter or longer than this are rolled again. */
  minLength?: number;
  maxLength?: number;
}

/**
 * A government's titles. Keys are a name style ("arabic"), a style's tag ("islamic"), or a
 * slice id or tag from any result ("sunni"), tried in that order, then "default". Also:
 * "styles" = the name styles this government draws from, "prefer" = a wheel whose keys
 * are tried first (e.g. a theocracy's religion).
 */
export type TitleSet = Record<string, string[] | string | undefined> & { styles?: string[]; prefer?: string };

export interface NameData {
  /** Which wheel picks the title ("Kingdom of…"). */
  titlesBy: string;
  /** If this wheel is spun (e.g. culture), its slice picks the name style; otherwise the government does. */
  placesBy: string;
  titles: Record<string, TitleSet>;
  defaultTitles: string[];
  /** Name styles: place syllables by style id (latin, arabic…), plus "default". */
  places: Record<string, PlaceParts>;
  /** Which wheel adds a word to the name (e.g. outlook: Expansionist → "Great …"). */
  modifiersBy?: string;
  /** How often a modifier is used (0..1). */
  modifierChance?: number;
  /** Patterns by slice id: "{name}" is the whole name, "{place}" just the place ("Kingdom of Greater X"). */
  modifiers?: Record<string, string[]>;
}

/** A labelled group of results on the nation card and in the creation record. */
export interface ResultGroup {
  name: string;
  wheels: string[];
}

export interface WheelData {
  /** The era these wheels are for, e.g. "1500". */
  era: string;
  eraName: string;
  wheels: Wheel[];
  groups: ResultGroup[];
  panel: { show: string[] };
  names: NameData;
  /** Screen text (English for now), keyed by name. */
  text: Record<string, string>;
  /** Endings for short big numbers: thousand, million, billion, trillion. */
  numberSuffixes: string[];
  /** Where the numbers come from (shown nowhere; for whoever edits the file). */
  notes?: unknown;
}

/** Where a spin landed. */
export interface SpinResult {
  index: number;
  slice: Slice;
  /** Where the wheel stops, as a fraction of a full turn from the start of slice 0 (0..1). */
  stopAt: number;
}

/** The shared file: which era is active and where each era's file is. */
interface SharedFile {
  era: string;
  eras: Record<string, string>;
  text?: Record<string, string>;
  numberSuffixes?: string[];
}

/** One era's file. */
interface EraFile {
  name?: string;
  wheels: Wheel[];
  groups?: ResultGroup[];
  panel?: { show: string[] };
  names: NameData;
  text?: Record<string, string>;
  notes?: unknown;
}

const DATA_DIR = "/data/";

/**
 * Loads and checks the wheel data: public/data/wheels.json, then the active era's file
 * (or `era`, if given). Throws a readable error if something is wrong in either.
 */
export async function loadWheelData(era?: string): Promise<WheelData> {
  const sharedUrl = `${DATA_DIR}wheels.json`;
  const shared = await fetchJson<SharedFile>(sharedUrl);
  const fail = (msg: string): never => {
    throw new Error(`${sharedUrl}: ${msg}`);
  };
  if (!shared.eras || typeof shared.eras !== "object") fail(`"eras" must list each era's file, e.g. { "1500": "eras/1500.json" }`);
  const id = era ?? shared.era;
  if (!id || !shared.eras[id]) fail(`era "${id}" isn't in "eras" (known: ${Object.keys(shared.eras).join(", ")})`);
  const eraUrl = DATA_DIR + shared.eras[id];
  const file = await fetchJson<EraFile>(eraUrl);
  if (!Array.isArray(file.wheels)) throw new Error(`${eraUrl}: "wheels" must be a list of wheels`);
  // Wheels marked "off" stay in the file but aren't spun or shown.
  const off = new Set(file.wheels.filter((w) => w.off).map((w) => w.id));
  const data: WheelData = {
    era: id,
    eraName: file.name ?? id,
    wheels: file.wheels.filter((w) => !off.has(w.id)),
    groups: (file.groups ?? []).map((g) => ({ ...g, wheels: (g.wheels ?? []).filter((w) => !off.has(w)) })).filter((g) => g.wheels.length),
    panel: { show: (file.panel?.show ?? []).filter((w) => !off.has(w)) },
    names: file.names,
    text: { ...shared.text, ...file.text },
    numberSuffixes: shared.numberSuffixes ?? ["K", "M", "B", "T"],
    notes: file.notes,
  };
  checkWheelData(data, eraUrl);
  return data;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new Error(`${url} isn't valid JSON: ${(e as Error).message}`);
  }
}

function checkWheelData(data: WheelData, url: string): void {
  const fail = (msg: string): never => {
    throw new Error(`${url}: ${msg}`);
  };
  const isList = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === "string");
  if (!Array.isArray(data.wheels) || data.wheels.length === 0) fail(`"wheels" must be a list with at least one wheel`);
  const seen = new Map<string, Wheel>();
  for (const wheel of data.wheels) {
    const where = `wheel "${wheel.id ?? wheel.name ?? "?"}"`;
    if (!wheel.id || !wheel.name) fail(`${where} needs an "id" and a "name"`);
    if (seen.has(wheel.id)) fail(`two wheels have the id "${wheel.id}"`);
    if (!Array.isArray(wheel.slices) || wheel.slices.length < 2) fail(`${where} needs at least 2 slices`);
    if (wheel.picks !== undefined) {
      if (!Number.isInteger(wheel.picks) || wheel.picks < 1 || wheel.picks >= wheel.slices.length)
        fail(`${where}: "picks" must be a whole number from 1 to one less than its number of slices`);
      if (wheel.number) fail(`${where}: a number wheel can't have "picks"`);
    }
    const num = wheel.number;
    if (num) {
      if (num.times !== undefined && !seen.get(num.times)?.number)
        fail(`${where}: "times" must be the id of a number wheel spun before it (got "${num.times}")`);
      if (num.max !== undefined && !(num.max > 0)) fail(`${where}: "max" must be a number above 0`);
      for (const key of ["shows", "exactShows"] as const) {
        const ok = key === "shows" ? ["range", "label"] : ["value", "total"];
        if (num[key] !== undefined && !ok.includes(num[key]!)) fail(`${where}: "${key}" must be ${ok.map((s) => `"${s}"`).join(" or ")}`);
      }
      const c = num.compare;
      if (c && (!Array.isArray(c.places) || !c.places.every((p) => Array.isArray(p) && typeof p[0] === "string" && p[1] > 0)))
        fail(`${where}: "compare.places" must be a list of ["name", size] pairs`);
    }
    const ids = new Set<string>();
    for (const slice of wheel.slices) {
      if (!slice.label) fail(`${where} has a slice without a "label"`);
      slice.id ??= slice.label.toLowerCase().replace(/\W+/g, "-");
      if (ids.has(slice.id)) fail(`${where} has two slices with the id "${slice.id}"`);
      ids.add(slice.id);
      slice.weight ??= 1;
      if (typeof slice.weight !== "number" || !(slice.weight >= 0))
        fail(`${where}, slice "${slice.label}": "weight" must be a number, 0 or more`);
      if (slice.tags !== undefined && !isList(slice.tags)) fail(`${where}, slice "${slice.label}": "tags" must be a list of words`);
      slice.shown = slice.label;
      if (num) {
        const r = slice.range;
        if (!Array.isArray(r) || r.length !== 2 || !(r[0] > 0) || !(r[1] >= r[0]))
          fail(`${where}, slice "${slice.label}": "range" must be [low, high] with 0 < low <= high`);
        if (num.max !== undefined && !num.times && r![1] > num.max)
          fail(`${where}, slice "${slice.label}": its range goes up to ${r![1]}, above the wheel's "max" of ${num.max}`);
        slice.rangeText = formatText(num.range ?? "{low}–{high}", {
          low: formatNumber(r![0], num.rangeStyle ?? "compact", data.numberSuffixes),
          high: formatNumber(r![1], num.rangeStyle ?? "compact", data.numberSuffixes),
        });
        if ((num.shows ?? "range") === "range") slice.shown = slice.rangeText;
      }
    }
    if (!wheel.slices.some((s) => s.weight > 0)) fail(`${where}: at least one slice needs a weight above 0`);
    seen.set(wheel.id, wheel);
  }

  for (const group of data.groups) {
    if (!group.name || !Array.isArray(group.wheels)) fail(`each of "groups" needs a "name" and a list of "wheels"`);
    for (const id of group.wheels) if (!seen.has(id)) fail(`group "${group.name}" lists a wheel "${id}" that doesn't exist`);
  }
  for (const id of data.panel.show ?? []) if (!seen.has(id)) fail(`"panel.show" lists a wheel "${id}" that doesn't exist`);

  const names = data.names;
  if (!names || typeof names !== "object") fail(`"names" is missing`);
  names.titlesBy ??= "government";
  names.placesBy ??= "culture";
  names.titles ??= {};
  if (!isList(names.defaultTitles)) fail(`"names.defaultTitles" must be a list of titles like "Kingdom of {place}"`);
  if (!names.places?.default) fail(`"names.places" needs a "default" set of syllables`);
  for (const [gov, byKey] of Object.entries(names.titles))
    for (const [key, list] of Object.entries(byKey)) {
      if (key === "prefer") continue;
      if (!isList(list)) fail(`"names.titles.${gov}.${key}" must be a list of titles like "Kingdom of {place}"`);
      if (key === "styles")
        for (const style of list as string[]) if (!names.places[style]) fail(`"names.titles.${gov}.styles" lists "${style}", which isn't in "names.places"`);
    }
  for (const [key, list] of Object.entries(names.modifiers ?? {}))
    if (!Array.isArray(list) || !list.every((m) => typeof m === "string" && (m.includes("{name}") || m.includes("{place}"))))
      fail(`"names.modifiers.${key}" must be a list of patterns with {name} or {place} in them`);
  for (const [key, parts] of Object.entries(names.places)) {
    if (!isList(parts.starts) || !isList(parts.ends)) fail(`"names.places.${key}" needs "starts" and "ends" lists`);
    if (parts.middles !== undefined && !isList(parts.middles)) fail(`"names.places.${key}.middles" must be a list`);
    if (parts.prefixes !== undefined && !isList(parts.prefixes)) fail(`"names.places.${key}.prefixes" must be a list`);
  }
  data.text ??= {};
}

/**
 * The second wheel of a number wheel: after landing on a range such as 15–25 people/km²,
 * this wheel's slices are numbers spread evenly through it (on a log scale, so each step
 * is the same percentage), rounded to 2 significant digits (or "digits"). `base` is the earlier result a
 * chained wheel multiplies by (the land area for density, the population for wealth).
 */
export function exactWheel(wheel: Wheel, slice: Slice, data: WheelData, base?: number): Wheel {
  const num = wheel.number!;
  const [low, high] = slice.range!;
  const count = Math.max(1, Math.round(num.exactSlices ?? 10));
  const showTotal = num.exactShows === "total";
  const slices: Slice[] = [];
  for (let i = 0; i < count; i++) {
    const value = roundSignificant(low * (high / low) ** ((i + 0.5) / count), num.digits ?? 2);
    const label = showTotal
      ? formatNumber(chainTotal(num, value, base), num.totalStyle ?? "compact", data.numberSuffixes)
      : formatNumber(value, num.style ?? "compact", data.numberSuffixes);
    if (slices.some((s) => s.label === label)) continue;
    slices.push({ id: String(value), label, shown: formatText(num.exactLabel ?? "{value}", { value: label }), weight: 1, value });
  }
  return {
    id: `${wheel.id}:exact`,
    name: wheel.name,
    question: formatText(num.exactQuestion ?? "{range}", { range: slice.rangeText ?? "", label: slice.label }),
    slices,
  };
}

/** A number wheel's result: the picked number, times the earlier result it chains to, capped by "max". */
export function chainTotal(num: NumberSpec, value: number, base: number | undefined): number {
  const total = num.times ? roundSignificant(value * (base ?? 0), num.totalDigits ?? 2) : value;
  return num.max !== undefined ? Math.min(num.max, total) : total;
}

/** A number in a style: "42M" (compact) or "350,000" (full). */
export function formatNumber(value: number, style: NumberStyle, suffixes: readonly string[]): string {
  return style === "full" ? value.toLocaleString("en-US") : compactNumber(value, suffixes);
}

/** "≈ the size of Portugal": the nearest place in a comparison list. */
export function compareSize(c: Comparison, size: number): string {
  let best = c.places[0];
  for (const p of c.places) if (Math.abs(Math.log(size / p[1])) < Math.abs(Math.log(size / best[1]))) best = p;
  const ratio = size / best[1];
  const text = ratio > 1.12 ? c.bigger : ratio < 1 / 1.12 ? c.smaller : c.near;
  return formatText(text, { place: best[0] });
}

/** A multi-pick wheel without the slices already won, for its next spin. */
export function withoutPicked(wheel: Wheel, picked: readonly Slice[]): Wheel {
  const taken = new Set(picked.map((s) => s.id));
  return { ...wheel, slices: wheel.slices.filter((s) => !taken.has(s.id)) };
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

/** The groups for the card and record, with any wheel not in a group added to a last one. */
export function resultGroups(data: WheelData): ResultGroup[] {
  const grouped = new Set(data.groups.flatMap((g) => g.wheels));
  const rest = data.wheels.filter((w) => !grouped.has(w.id)).map((w) => w.id);
  return rest.length ? [...data.groups, { name: data.text.groupOther ?? "Other", wheels: rest }] : data.groups;
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
