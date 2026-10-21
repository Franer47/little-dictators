// The rules of the running world: public/data/eras/<era>-sim.json (clock, influence, buildings,
// what computer-run nations do, wars and peace). Loaded and checked here, with errors that say
// where a mistake is, like the wheel and stats files.

import { readModSet, type ModSet } from "../game/stats.ts";

export type PushId = "build" | "recruit" | "improveRelations" | "worsenRelations" | "alliance" | "declareWar" | "offerPeace";
export type BrushId = "warGoal" | "defend" | "develop";

export interface BuildingSpec {
  id: string;
  name: string;
  icon: string;
  about: string;
  costYears: number;
  costGrowth: number;
  months: number;
  maxLevel: number;
  needs?: "coast";
  effects: ModSet;
  /** The effects as written in the file, e.g. { food: "+8%" }, for showing. */
  effectText: Record<string, string>;
}

export interface SimData {
  clock: { startYear: number; msPerMonth: number; speeds: number[] };
  influence: { start: number; perMonth: number; perStability: number; perPopularity: number; max: number; costs: Record<PushId, number> };
  brushes: { cost: Record<BrushId, number>; eraseRefund: number; sizes: number[] };
  buildings: BuildingSpec[];
  growth: { developmentPerYear: number; perSchool: number; debt: ModSet };
  army: { trainingMonths: number; disband: number };
  ai: { buildReserve: number; warChance: number; warOdds: number; allianceAt: number; breakAllianceAt: number; maxAllies: number; allyJoinsAttack: number };
  relations: { base: number; aggression: number; sameIdeology: number; random: number; drift: number; war: number; afterPeace: number; push: number };
  war: { scorePerMonth: number; losses: number; maxLosses: number };
  peace: { winAt: number; minMonths: number; maxMonths: number; landAt: number; landShare: number; tributeAt: number; tributeShare: number; tributeYears: number };
  save: { everyYears: number };
}

const PUSHES: PushId[] = ["build", "recruit", "improveRelations", "worsenRelations", "alliance", "declareWar", "offerPeace"];
const BRUSHES: BrushId[] = ["warGoal", "defend", "develop"];

export async function loadSimData(era: string): Promise<SimData> {
  const url = `${import.meta.env.BASE_URL}data/eras/${era}-sim.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch (e) {
    throw new Error(`${url} isn't valid JSON: ${(e as Error).message}`);
  }
  try {
    return parseSimData(raw);
  } catch (e) {
    throw new Error(`${url}: ${(e as Error).message}`);
  }
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

export function parseSimData(raw: unknown): SimData {
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  if (!isObject(raw)) return fail("the file must be one { … } object");
  const section = (key: string): Record<string, unknown> => (isObject(raw[key]) ? raw[key] : fail(`"${key}" must be a { … } object`));
  /** Reads the named numbers of a section, checking each one. */
  const numbers = <K extends string>(key: string, names: K[]): Record<K, number> => {
    const sec = section(key);
    const out = {} as Record<K, number>;
    for (const n of names) {
      const v = sec[n];
      if (typeof v !== "number" || !Number.isFinite(v)) fail(`${key}.${n} must be a number`);
      out[n] = v as number;
    }
    return out;
  };

  const clockSec = section("clock");
  const speeds = clockSec.speeds;
  if (!Array.isArray(speeds) || !speeds.length || !speeds.every((v) => typeof v === "number" && v > 0)) fail(`clock.speeds must be a list of numbers, e.g. [1, 3, 10]`);
  const clock = { ...numbers("clock", ["startYear", "msPerMonth"]), speeds: speeds as number[] };

  const infSec = section("influence");
  if (!isObject(infSec.costs)) fail(`influence.costs must be { "build": 6, … }`);
  const costs = {} as Record<PushId, number>;
  for (const p of PUSHES) {
    const v = (infSec.costs as Record<string, unknown>)[p];
    if (typeof v !== "number" || v < 0) fail(`influence.costs.${p} must be a number, 0 or more`);
    costs[p] = v as number;
  }
  const influence = { ...numbers("influence", ["start", "perMonth", "perStability", "perPopularity", "max"]), costs };

  const brushSec = section("brushes");
  if (!isObject(brushSec.cost)) fail(`brushes.cost must be { "warGoal": 0.08, … }`);
  const brushCost = {} as Record<BrushId, number>;
  for (const b of BRUSHES) {
    const v = (brushSec.cost as Record<string, unknown>)[b];
    if (typeof v !== "number" || v < 0) fail(`brushes.cost.${b} must be a number, 0 or more`);
    brushCost[b] = v as number;
  }
  const sizes = brushSec.sizes;
  if (!Array.isArray(sizes) || !sizes.length || !sizes.every((v) => typeof v === "number" && v >= 0)) fail(`brushes.sizes must be a list of numbers`);
  const brushes = { cost: brushCost, eraseRefund: numbers("brushes", ["eraseRefund"]).eraseRefund, sizes: sizes as number[] };

  const bSec = section("buildings");
  const buildings: BuildingSpec[] = [];
  for (const id of Object.keys(bSec).filter((k) => k !== "about")) {
    const b = bSec[id];
    const where = `buildings.${id}`;
    if (!isObject(b)) fail(`${where} must be { "name": …, "effects": { … } }`);
    const spec = b as Record<string, unknown>;
    const num = (n: string, min = 0): number => {
      const v = spec[n];
      if (typeof v !== "number" || v < min) fail(`${where}.${n} must be a number, ${min} or more`);
      return v as number;
    };
    if (typeof spec.name !== "string") fail(`${where} needs a "name"`);
    if (spec.needs !== undefined && spec.needs !== "coast") fail(`${where}.needs can only be "coast"`);
    buildings.push({
      id,
      name: spec.name as string,
      icon: typeof spec.icon === "string" ? spec.icon : "columns",
      about: typeof spec.about === "string" ? spec.about : "",
      costYears: num("costYears"),
      costGrowth: num("costGrowth"),
      months: num("months", 1),
      maxLevel: num("maxLevel", 1),
      needs: spec.needs as "coast" | undefined,
      effects: readModSet(spec.effects, `${where}.effects`),
      effectText: Object.fromEntries(Object.entries(spec.effects as Record<string, unknown>).filter(([k]) => k !== "about").map(([k, v]) => [k, String(v)])),
    });
  }
  if (!buildings.length) fail(`"buildings" needs at least one building`);

  const growthSec = section("growth");
  const growth = { ...numbers("growth", ["developmentPerYear", "perSchool"]), debt: readModSet(growthSec.debt, "growth.debt") };

  return {
    clock,
    influence,
    brushes,
    buildings,
    growth,
    army: numbers("army", ["trainingMonths", "disband"]),
    ai: numbers("ai", ["buildReserve", "warChance", "warOdds", "allianceAt", "breakAllianceAt", "maxAllies", "allyJoinsAttack"]),
    relations: numbers("relations", ["base", "aggression", "sameIdeology", "random", "drift", "war", "afterPeace", "push"]),
    war: numbers("war", ["scorePerMonth", "losses", "maxLosses"]),
    peace: numbers("peace", ["winAt", "minMonths", "maxMonths", "landAt", "landShare", "tributeAt", "tributeShare", "tributeYears"]),
    save: numbers("save", ["everyYears"]),
  };
}
