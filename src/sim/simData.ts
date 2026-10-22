// The rules of the running world: public/data/eras/<era>-sim.json (clock, influence, buildings,
// what computer-run nations do, wars and peace). Loaded and checked here, with errors that say
// where a mistake is, like the wheel and stats files.

import { readModSet, type ModSet } from "../game/stats.ts";
import { TERRAINS, Terrain } from "../map/terrain.ts";

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
  army: {
    trainingMonths: number;
    disband: number;
    queuePerMonth: number;
    /** About how many divisions an army has, and the most armies a nation keeps. */
    armySize: number;
    maxArmies: number;
    /** Home armies guard every front with this share of their strength (split between the fronts). */
    homeShare: number;
    /** Every front has militia worth this share of the nation's strength, even with no army there. */
    militia: number;
    /** A nation's own armies attack when they're this many times stronger than the enemy on that front. */
    attackOdds: number;
    /** What each stance does: × attack, × defence, × losses. */
    stances: Record<"attack" | "hold" | "defend", { attack: number; defence: number; losses: number }>;
  };
  ai: {
    buildReserve: number;
    warChance: number;
    warOdds: number;
    allianceAt: number;
    breakAllianceAt: number;
    maxAllies: number;
    allyJoinsAttack: number;
    /** How many months a planned war takes to prepare (between these). */
    planMin: number;
    planMax: number;
    /** How much bigger an army it wants at war, while planning one, and when threatened; the most divisions it orders at once. */
    armyBoostWar: number;
    armyBoostPlan: number;
    armyBoostThreat: number;
    maxOrder: number;
    /** Infamy for starting a war, and for land taken (× land ÷ own land); the share that fades in a year. */
    infamyPerWar: number;
    infamyPerLand: number;
    infamyDecay: number;
    /** Coalitions: against infamy from 'coalitionAt', or a nation 'coalitionPower' × stronger than its neighbours' average; members dislike it (relation under 'coalitionRelation'); they strike at 'coalitionOdds' × its strength. */
    coalitionAt: number;
    coalitionPower: number;
    coalitionRelation: number;
    coalitionOdds: number;
    /** Revolts: below 'revoltBelow' stability, a monthly chance up to 'revoltChance'; a region of 'revoltShareMin'..'revoltShareMax' of the land breaks away; not in nations under 'revoltMinPixels' pixels, and not twice within 'revoltCooldownYears'. */
    revoltBelow: number;
    revoltChance: number;
    revoltShareMin: number;
    revoltShareMax: number;
    revoltMinPixels: number;
    revoltCooldownYears: number;
  };
  relations: { base: number; aggression: number; sameIdeology: number; random: number; drift: number; war: number; afterPeace: number; push: number };
  war: {
    scorePerMonth: number;
    losses: number;
    maxLosses: number;
    pushRate: number;
    minPush: number;
    maxShare: number;
    deadZone: number;
    defendPaintCost: number;
    /** How many pixels of sea an attack can cross to land on an enemy's coast, and what landing costs (× terrain). */
    seaCrossing: number;
    seaCost: number;
    /** How much taking one pixel costs, by terrain id (unlisted terrain: 1). */
    conquestCost: number[];
  };
  peace: {
    winAt: number;
    minMonths: number;
    maxMonths: number;
    annexAt: number;
    annexSize: number;
    tributeAt: number;
    tributeShare: number;
    tributeYears: number;
  };
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
    army: { ...numbers("army", ["trainingMonths", "disband", "queuePerMonth", "armySize", "maxArmies", "homeShare", "militia", "attackOdds"]), stances: stances(section("army").stances) },
    ai: numbers("ai", [
      "buildReserve", "warChance", "warOdds", "allianceAt", "breakAllianceAt", "maxAllies", "allyJoinsAttack",
      "planMin", "planMax", "armyBoostWar", "armyBoostPlan", "armyBoostThreat", "maxOrder",
      "infamyPerWar", "infamyPerLand", "infamyDecay", "coalitionAt", "coalitionPower", "coalitionRelation", "coalitionOdds",
      "revoltBelow", "revoltChance", "revoltShareMin", "revoltShareMax", "revoltMinPixels", "revoltCooldownYears",
    ]),
    relations: numbers("relations", ["base", "aggression", "sameIdeology", "random", "drift", "war", "afterPeace", "push"]),
    war: { ...numbers("war", ["scorePerMonth", "losses", "maxLosses", "pushRate", "minPush", "maxShare", "deadZone", "defendPaintCost", "seaCrossing", "seaCost"]), conquestCost: conquestCost(section("war").conquestCost) },
    peace: numbers("peace", ["winAt", "minMonths", "maxMonths", "annexAt", "annexSize", "tributeAt", "tributeShare", "tributeYears"]),
    save: numbers("save", ["everyYears"]),
  };
}

/** army.stances: { "attack": { "attack": 1, "defence": 0.8, "losses": 1 }, "hold": …, "defend": … }. */
function stances(v: unknown): SimData["army"]["stances"] {
  const where = "army.stances";
  if (!isObject(v)) throw new Error(`${where} must be { "attack": {…}, "hold": {…}, "defend": {…} }`);
  const out = {} as SimData["army"]["stances"];
  for (const k of ["attack", "hold", "defend"] as const) {
    const s = v[k];
    if (!isObject(s)) throw new Error(`${where}.${k} is missing`);
    const n = (f: string): number => {
      if (typeof s[f] !== "number" || (s[f] as number) < 0) throw new Error(`${where}.${k}.${f} must be a number, 0 or more`);
      return s[f] as number;
    };
    out[k] = { attack: n("attack"), defence: n("defence"), losses: n("losses") };
  }
  return out;
}

/** war.conquestCost: { "Mountains": 4, … } by terrain name, as a list by terrain id (1 where unlisted). */
function conquestCost(v: unknown): number[] {
  if (!isObject(v)) throw new Error(`war.conquestCost must be { "Plains": 1, "Mountains": 4, … }`);
  const out = new Array<number>(TERRAINS.length).fill(1);
  for (const [name, cost] of Object.entries(v)) {
    if (name === "about") continue;
    const t = TERRAINS.find((x) => Terrain[x.id] === name);
    if (!t) throw new Error(`war.conquestCost: "${name}" isn't a terrain (terrains: ${TERRAINS.map((x) => Terrain[x.id]).join(", ")})`);
    if (typeof cost !== "number" || cost <= 0) throw new Error(`war.conquestCost.${name} must be a number above 0`);
    out[t.id] = cost;
  }
  return out;
}
