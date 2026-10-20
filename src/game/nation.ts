// A nation and how it was made. Plain data only: the wheel screen fills it in and the UI
// shows it, but nothing here draws anything. (Wheel beta: the results are only shown,
// they don't change the game yet.)

import { roundSignificant } from "./numbers.ts";
import { pick, type Rng } from "./random.ts";
import { formatText } from "./text.ts";
import { chanceOf, exactWheel, spinWheel, type NameData, type Slice, type Wheel, type WheelData } from "./wheels.ts";

/** One wheel's result. */
export interface WheelOutcome {
  wheelId: string;
  wheelName: string;
  sliceId: string;
  /** The slice's name in the data file, e.g. "Theocracy" or "Small". */
  label: string;
  /** What the slice showed on the wheel: the label, or the range on number wheels ("2M–8M"). */
  shown: string;
  blurb?: string;
  /** The slice's chance when it was rolled (0..1). */
  chance: number;
  /** For number wheels: the exact number picked by the second spin. */
  estimate?: { value: number; text: string };
  /** For number wheels: the chance of the exact number on the second wheel (0..1). */
  exactChance?: number;
}

/** Everything rolled when the nation was made. */
export interface CreationRecord {
  /** When the nation was created (ISO date-time). */
  createdAt: string;
  /** The map it was made for. */
  map: string;
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
 * wheel and its winning slice: that number is the result.
 */
export function makeOutcome(wheel: Wheel, slice: Slice, exact?: { wheel: Wheel; slice: Slice }): WheelOutcome {
  const outcome: WheelOutcome = {
    wheelId: wheel.id,
    wheelName: wheel.name,
    sliceId: slice.id,
    label: slice.label,
    shown: slice.shown,
    blurb: slice.blurb,
    chance: chanceOf(wheel, slice),
  };
  if (wheel.estimate && exact && exact.slice.value !== undefined) {
    // An exact-number slice's label is the bare number ("120M"); its shown text adds "$" etc.
    outcome.estimate = { value: exact.slice.value, text: formatText(wheel.estimate.format, { value: exact.slice.label }) };
    outcome.exactChance = chanceOf(exact.wheel, exact.slice);
  }
  return outcome;
}

/** How to show a result: the main text, plus a smaller line (the range, on number wheels). */
export function describeOutcome(outcome: WheelOutcome): { main: string; sub: string } {
  return outcome.estimate ? { main: outcome.estimate.text, sub: outcome.shown } : { main: outcome.shown, sub: "" };
}

/** A random name such as "Holy State of Varnia": a title set by the government, plus a made-up place. */
export function generateName(names: NameData, governmentId: string | undefined, rng: Rng): string {
  const titles = (governmentId && names.titles[governmentId]) || names.defaultTitles;
  return pick(rng, titles).replace("{place}", placeName(names.place, rng));
}

function placeName(parts: NameData["place"], rng: Rng): string {
  let name = pick(rng, parts.starts);
  if (rng.next() < parts.middleChance) name = join(name, pick(rng, parts.middles));
  name = join(name, pick(rng, parts.ends));
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/** Joins two name parts, dropping a letter where they'd clash (two vowels, or a doubled letter). */
function join(a: string, b: string): string {
  const vowels = "aeiouy";
  const last = a.slice(-1).toLowerCase();
  const first = b.charAt(0).toLowerCase();
  if (last === first || (vowels.includes(last) && vowels.includes(first))) return a + b.slice(1);
  return a + b;
}

/** Builds the finished nation from the outcomes, in spin order. */
export function createNation(data: WheelData, spins: WheelOutcome[], map: string, rng: Rng): Nation {
  const results: Record<string, WheelOutcome> = {};
  for (const outcome of spins) results[outcome.wheelId] = outcome;
  const name = generateName(data.names, results.government?.sliceId, rng);
  return {
    name,
    results,
    record: { createdAt: new Date().toISOString(), map, seed: rng.seed, spins, firstName: name },
  };
}

/** GDP per person, if the nation has both a population and a GDP estimate. */
export function gdpPerPerson(nation: Nation): number | undefined {
  const people = nation.results.population?.estimate?.value;
  const gdp = nation.results.gdp?.estimate?.value;
  return people && gdp ? roundSignificant(gdp / people, 2) : undefined;
}

/** Rolls every wheel at once, with no animation (used by ?wheel=skip, for quick testing). */
export function rollNation(data: WheelData, map: string, rng: Rng): Nation {
  const spins = data.wheels.map((wheel) => {
    const slice = spinWheel(wheel, rng).slice;
    if (!wheel.estimate) return makeOutcome(wheel, slice);
    const exact = exactWheel(wheel, slice, data);
    return makeOutcome(wheel, slice, { wheel: exact, slice: spinWheel(exact, rng).slice });
  });
  return createNation(data, spins, map, rng);
}
