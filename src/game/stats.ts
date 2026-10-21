// The stat sheet (milestone 3a): every nation's numbers, worked out from its wheel results
// and the land it actually got. Plain game logic, no drawing: the simulation (milestone 4)
// will run on these numbers. All modifiers are in public/data/eras/<era>-stats.json.
//
// Two steps:
// - surveyLand() looks at the whole map once and counts, for every nation at the same time,
//   its land by terrain, coastline, riverbanks, how many pieces it's in and how spread out it is.
// - statSheet() turns one nation's wheel results and land into its stats. Each stat keeps
//   a "why" list (its breakdown), so the panel can show where every number comes from.
//
// How a factor (recruit rate, tax rate, defence…) is worked out: start at its base, add up
// every percentage that applies (base × (1 + all the %)), add every plain number, multiply by
// any "×", and keep it between min and max.

import { TERRAINS, Terrain } from "../map/terrain.ts";
import type { GameMap } from "../map/gameMap.ts";
import type { Nation, WheelOutcome } from "./nation.ts";
import { compactNumber } from "./numbers.ts";
import type { Wheel, WheelData } from "./wheels.ts";

// ---------------------------------------------------------------- the data file

/** The numbers stats are built from (each one in the data file's "factors"). */
export const FACTOR_IDS = [
  "recruitRate", "armyShare", "soldierCost", "armyBudget", "armyQuality", "taxRate", "adminCost", "treasuryYears",
  "food", "growthRate", "stability", "popularity", "aggression", "defence", "trade", "naval", "cohesion",
] as const;
export type FactorId = (typeof FACTOR_IDS)[number];

/** The stats on the sheet. */
export const STAT_IDS = [
  "manpower", "army", "armyQuality", "aggression", "gdp", "income", "upkeep", "net", "treasury",
  "population", "growth", "food", "stability", "popularity", "land", "access", "defence", "trade", "naval", "cohesion",
] as const;
export type StatId = (typeof STAT_IDS)[number];

/** Coast and river access: the "access" modifiers, each scaled 0..1. */
const ACCESS_IDS = ["coast", "river", "waterBorder", "landlocked", "overseas"] as const;
type AccessId = (typeof ACCESS_IDS)[number];
const ACCESS_NAMES: Record<AccessId, string> = {
  coast: "Coast",
  river: "Rivers",
  waterBorder: "Water borders",
  landlocked: "Landlocked",
  overseas: "Land overseas",
};

export type FactorFormat = "percent" | "money" | "score" | "times" | "years";

export interface FactorSpec {
  name: string;
  base: number;
  min: number;
  max: number;
  format: FactorFormat;
  about?: string;
}

/** One modifier: "+30%" (pct 0.3), "+20" (flat 20) or "×0.5" (mult 0.5). */
export interface Modifier {
  kind: "pct" | "flat" | "mult";
  amount: number;
}

type ModSet = Partial<Record<FactorId, Modifier>>;

export interface StatsData {
  inputs: { land: string; people: string; wealth: string; resources?: string };
  groups: { id: string; name: string; stats: StatId[] }[];
  stats: Record<StatId, { name: string; short?: string; about?: string }>;
  factors: Record<FactorId, FactorSpec>;
  food: { perKm2: number[]; riverBank: number; coast: number };
  growth: { min: number; max: number };
  cohesion: { outsideMain: number; perPiece: number; maxPieces: number; spread: number };
  /** By terrain id. */
  terrain: (ModSet | undefined)[];
  access: Partial<Record<AccessId, ModSet>>;
  chart: { x?: ModSet; y?: ModSet };
  /** By wheel id, then slice id. */
  results: Record<string, Record<string, ModSet>>;
  numberSuffixes: string[];
}

/** Loads public/data/eras/<era>-stats.json and checks it against the wheels. */
export async function loadStatsData(wheels: WheelData): Promise<StatsData> {
  const url = `${import.meta.env.BASE_URL}data/eras/${wheels.era}-stats.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch (e) {
    throw new Error(`${url} isn't valid JSON: ${(e as Error).message}`);
  }
  return parseStatsData(raw, wheels, url);
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
/** The keys of a data object, without its "about" note. */
const keysOf = (o: Record<string, unknown>): string[] => Object.keys(o).filter((k) => k !== "about");

/** Reads "+30%", "-15%", "+20", "-0.5", "×0" (or "x0"); null if it's none of those. */
export function parseModifier(text: unknown): Modifier | null {
  if (typeof text === "number") return { kind: "flat", amount: text };
  if (typeof text !== "string") return null;
  const t = text.trim().replace(/−/g, "-");
  const mult = /^[×x*](\d+(?:\.\d+)?)$/.exec(t);
  if (mult) return { kind: "mult", amount: Number(mult[1]) };
  const m = /^([+-])(\d+(?:\.\d+)?)(%?)$/.exec(t);
  if (!m) return null;
  const n = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  return m[3] ? { kind: "pct", amount: n / 100 } : { kind: "flat", amount: n };
}

/** Checks the stats file and turns it into StatsData, with an error that says where any mistake is. */
export function parseStatsData(raw: unknown, wheels: WheelData, url: string): StatsData {
  const fail = (msg: string): never => {
    throw new Error(`${url}: ${msg}`);
  };
  if (!isObject(raw)) return fail("the file must be one { … } object");
  const section = (key: string): Record<string, unknown> => (isObject(raw[key]) ? raw[key] : fail(`"${key}" must be a { … } object`));
  const num = (v: unknown, where: string): number => (typeof v === "number" && Number.isFinite(v) ? v : fail(`${where} must be a number`));
  const factorList = FACTOR_IDS.join(", ");

  const modSet = (v: unknown, where: string): ModSet => {
    if (!isObject(v)) return fail(`${where} must be { "factor": "+10%", … }`);
    const set: ModSet = {};
    for (const key of keysOf(v)) {
      if (!(FACTOR_IDS as readonly string[]).includes(key)) fail(`${where}: "${key}" isn't a factor (factors: ${factorList})`);
      const mod = parseModifier(v[key]);
      if (!mod) fail(`${where}.${key}: "${String(v[key])}" isn't a modifier; write "+30%", "-15%", "+20", "-5" or "×0.5"`);
      set[key as FactorId] = mod!;
    }
    return set;
  };
  const pct = (v: unknown, where: string): number => {
    const mod = parseModifier(v);
    return mod?.kind === "pct" ? mod.amount : fail(`${where} must be a percentage like "+50%"`);
  };

  // Which wheels give land, people and wealth.
  const inputs = section("inputs");
  const wheelById = new Map(wheels.wheels.map((w) => [w.id, w]));
  const wheelList = [...wheelById.keys()].join(", ");
  const numberWheel = (key: string, optional = false): string => {
    const id = inputs[key];
    if (optional && id === undefined) return "";
    if (typeof id !== "string" || !wheelById.has(id)) return fail(`inputs.${key}: "${String(id)}" isn't a wheel (wheels: ${wheelList})`);
    if (!optional && !wheelById.get(id)!.number) fail(`inputs.${key}: wheel "${id}" isn't a number wheel`);
    return id;
  };
  const resources = numberWheel("resources", true);

  // Factors: every one the code uses must be there.
  const factorsRaw = section("factors");
  const factors = {} as Record<FactorId, FactorSpec>;
  const formats: FactorFormat[] = ["percent", "money", "score", "times", "years"];
  for (const id of FACTOR_IDS) {
    const f = factorsRaw[id];
    if (!isObject(f)) fail(`factors.${id} is missing (every factor is needed: ${factorList})`);
    const spec = f as Record<string, unknown>;
    const where = `factors.${id}`;
    const format = spec.format as FactorFormat;
    if (!formats.includes(format)) fail(`${where}.format must be one of ${formats.join(", ")}`);
    const min = num(spec.min, `${where}.min`);
    const max = num(spec.max, `${where}.max`);
    if (min > max) fail(`${where}: "min" is bigger than "max"`);
    factors[id] = { name: typeof spec.name === "string" ? spec.name : id, base: num(spec.base, `${where}.base`), min, max, format, about: spec.about as string | undefined };
  }
  for (const key of keysOf(factorsRaw)) if (!(FACTOR_IDS as readonly string[]).includes(key)) fail(`factors: "${key}" isn't a factor the game uses (factors: ${factorList})`);

  // Stats: names and groups.
  const statsRaw = section("stats");
  const stats = {} as StatsData["stats"];
  for (const id of STAT_IDS) {
    const s = statsRaw[id];
    if (!isObject(s) || typeof s.name !== "string") fail(`stats.${id} needs a "name"`);
    stats[id] = s as StatsData["stats"][StatId];
  }
  if (!Array.isArray(raw.groups)) fail(`"groups" must be a list of { "name": …, "stats": [ … ] }`);
  const groups = (raw.groups as unknown[]).map((g, i) => {
    if (!isObject(g) || typeof g.name !== "string" || !Array.isArray(g.stats)) return fail(`groups[${i}] needs a "name" and a "stats" list`);
    for (const s of g.stats) if (!(STAT_IDS as readonly string[]).includes(s)) fail(`groups[${i}] ("${g.name}"): "${s}" isn't a stat (stats: ${STAT_IDS.join(", ")})`);
    return { id: typeof g.id === "string" ? g.id : String(i), name: g.name, stats: g.stats as StatId[] };
  });

  // Food per km² by terrain.
  const food = section("food");
  if (!isObject(food.perKm2)) fail(`food.perKm2 must be { "Plains": 45, … }`);
  const perKm2 = new Array<number>(TERRAINS.length).fill(0);
  const terrainId = (name: string, where: string): Terrain => {
    const t = TERRAINS.find((x) => Terrain[x.id] === name);
    return t ? t.id : fail(`${where}: "${name}" isn't a terrain (terrains: ${TERRAINS.map((x) => Terrain[x.id]).join(", ")})`);
  };
  const perKm2Raw = food.perKm2 as Record<string, unknown>;
  for (const name of keysOf(perKm2Raw)) perKm2[terrainId(name, "food.perKm2")] = num(perKm2Raw[name], `food.perKm2.${name}`);

  const growth = section("growth");
  const cohesion = section("cohesion");

  const terrainRaw = section("terrain");
  const terrain: StatsData["terrain"] = new Array(TERRAINS.length);
  for (const name of keysOf(terrainRaw)) terrain[terrainId(name, "terrain")] = modSet(terrainRaw[name], `terrain.${name}`);

  const accessRaw = section("access");
  const access: StatsData["access"] = {};
  for (const key of keysOf(accessRaw)) {
    if (!(ACCESS_IDS as readonly string[]).includes(key)) fail(`access: "${key}" isn't known (use: ${ACCESS_IDS.join(", ")})`);
    access[key as AccessId] = modSet(accessRaw[key], `access.${key}`);
  }

  const chartRaw = section("chart");
  const chart: StatsData["chart"] = {};
  for (const key of keysOf(chartRaw)) {
    if (key !== "x" && key !== "y") fail(`chart: "${key}" isn't an axis (use "x" or "y")`);
    chart[key as "x" | "y"] = modSet(chartRaw[key], `chart.${key}`);
  }

  // Results: every wheel and slice id must exist (rare results are on the rare slice's own wheel).
  const resultsRaw = section("results");
  const results: StatsData["results"] = {};
  for (const wheelId of keysOf(resultsRaw)) {
    const wheel = wheelById.get(wheelId) ?? fail(`results: there's no wheel "${wheelId}" (wheels: ${wheelList})`);
    const ids = sliceIds(wheel);
    const byId = resultsRaw[wheelId];
    if (!isObject(byId)) fail(`results.${wheelId} must be { "slice-id": { … }, … }`);
    results[wheelId] = {};
    for (const sliceId of keysOf(byId as Record<string, unknown>)) {
      if (!ids.has(sliceId)) fail(`results.${wheelId}: wheel "${wheel.name}" has no slice "${sliceId}" (its slices: ${[...ids].join(", ")})`);
      results[wheelId][sliceId] = modSet((byId as Record<string, unknown>)[sliceId], `results.${wheelId}.${sliceId}`);
    }
  }

  return {
    inputs: { land: numberWheel("land"), people: numberWheel("people"), wealth: numberWheel("wealth"), resources: resources || undefined },
    groups,
    stats,
    factors,
    food: { perKm2, riverBank: pct(food.riverBank, "food.riverBank"), coast: pct(food.coast, "food.coast") },
    growth: { min: num(growth.min, "growth.min"), max: num(growth.max, "growth.max") },
    cohesion: {
      outsideMain: num(cohesion.outsideMain, "cohesion.outsideMain"),
      perPiece: num(cohesion.perPiece, "cohesion.perPiece"),
      maxPieces: num(cohesion.maxPieces, "cohesion.maxPieces"),
      spread: num(cohesion.spread, "cohesion.spread"),
    },
    terrain,
    access,
    chart,
    results,
    numberSuffixes: wheels.numberSuffixes,
  };
}

/** Every result id a wheel can give: its slices and the slices of their follow-up wheels (rare pulls). */
function sliceIds(wheel: Wheel): Set<string> {
  const ids = new Set<string>();
  for (const s of wheel.slices) {
    ids.add(s.id);
    if (s.then) for (const id of sliceIds(s.then)) ids.add(id);
  }
  return ids;
}

// ---------------------------------------------------------------- the land

/** What one nation's land is like. Areas in km², lengths in km. */
export interface LandFacts {
  km: number;
  pixels: number;
  /** km² of each terrain (by terrain id). */
  terrainKm: number[];
  /** km² of each terrain that is on a river (next to one, or the river itself). */
  riverKm: number[];
  /** km² of each terrain that is on the coast (next to sea or lake). */
  coastKm: number[];
  coastPixels: number;
  riverPixels: number;
  /** Rough length of its coastline and riverbanks (one pixel's width per pixel on them). */
  coastlineKm: number;
  riverbankKm: number;
  /** Edges of its land that face water / other land (any land not its own, owned or not). */
  waterEdges: number;
  landEdges: number;
  /** Separate pieces of land (islands, exclaves) and the size of the biggest. */
  pieces: number;
  mainPieceKm: number;
  /** 1 = a round blob, near 0 = a long thin snake (from how far its pixels are from its middle). */
  compactness: number;
}

const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const T = TERRAINS.length;

/**
 * Looks at the whole map once and returns the land of nations 1..count (index id - 1).
 * `owner` is the ownership grid (nation id per pixel), `areas` the km² of a pixel per row.
 */
export function surveyLand(map: GameMap, owner: Uint16Array, areas: Float64Array, count: number): LandFacts[] {
  const { width, height, terrain } = map;
  const n = count + 1;
  const km = new Float64Array(n);
  const px = new Float64Array(n);
  const terrainKm = new Float64Array(n * T);
  const riverKm = new Float64Array(n * T);
  const coastKm = new Float64Array(n * T);
  const coastPx = new Float64Array(n);
  const riverPx = new Float64Array(n);
  const coastLen = new Float64Array(n);
  const riverLen = new Float64Array(n);
  const waterEdges = new Float64Array(n);
  const landEdges = new Float64Array(n);
  // For the spread: sums of x, x², y, y² (x measured from the first pixel seen, across the seam).
  const refX = new Int32Array(n).fill(-1);
  const sx = new Float64Array(n);
  const sxx = new Float64Array(n);
  const sy = new Float64Array(n);
  const syy = new Float64Array(n);
  const isSea = (t: number): boolean => t === Terrain.Ocean || t === Terrain.ShallowWater;
  const wraps = map.wraps;
  const half = width / 2;

  for (let y = 0; y < height; y++) {
    const a = areas[y];
    const side = Math.sqrt(a);
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const id = owner[i];
      if (id === 0 || id >= n) continue;
      const t = terrain[i];
      km[id] += a;
      px[id]++;
      terrainKm[id * T + t] += a;
      let coast = false;
      let river = t === Terrain.River;
      for (const [dx, dy] of SIDES) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        let nx = x + dx;
        if (nx < 0 || nx >= width) {
          if (!wraps) continue;
          nx = (nx + width) % width;
        }
        const j = ny * width + nx;
        const nt = terrain[j];
        if (nt === Terrain.River) river = true;
        if (owner[j] === id) continue;
        if (isSea(nt)) {
          coast = true;
          waterEdges[id]++;
        } else landEdges[id]++;
      }
      if (coast) {
        coastPx[id]++;
        coastLen[id] += side;
        coastKm[id * T + t] += a;
      }
      if (river) {
        riverPx[id]++;
        riverLen[id] += side;
        riverKm[id * T + t] += a;
      }
      if (refX[id] < 0) refX[id] = x;
      let dx = x - refX[id];
      if (wraps) dx = dx >= half ? dx - width : dx < -half ? dx + width : dx;
      sx[id] += dx;
      sxx[id] += dx * dx;
      sy[id] += y;
      syy[id] += y * y;
    }
  }

  // Pieces: flood each unvisited patch of one nation's land (4 sides, across the seam).
  const pieces = new Float64Array(n);
  const mainKm = new Float64Array(n);
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  for (let start = 0; start < owner.length; start++) {
    const id = owner[start];
    if (id === 0 || id >= n || seen[start]) continue;
    let top = 0;
    let pieceKm = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      const x = i % width;
      const y = (i - x) / width;
      pieceKm += areas[y];
      for (const [dx, dy] of SIDES) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        let nx = x + dx;
        if (nx < 0 || nx >= width) {
          if (!wraps) continue;
          nx = (nx + width) % width;
        }
        const j = ny * width + nx;
        if (seen[j] || owner[j] !== id) continue;
        seen[j] = 1;
        stack[top++] = j;
      }
    }
    pieces[id]++;
    if (pieceKm > mainKm[id]) mainKm[id] = pieceKm;
  }

  const out: LandFacts[] = [];
  for (let id = 1; id < n; id++) {
    const p = px[id];
    // Moment of inertia compared with a disc of the same size: 1 for a disc, less for anything stretched.
    const spread = p > 0 ? sxx[id] - (sx[id] * sx[id]) / p + syy[id] - (sy[id] * sy[id]) / p : 0;
    const compactness = spread > 0 ? Math.min(1, (p * p) / (2 * Math.PI * spread)) : 1;
    out.push({
      km: km[id],
      pixels: p,
      terrainKm: Array.from(terrainKm.subarray(id * T, id * T + T)),
      riverKm: Array.from(riverKm.subarray(id * T, id * T + T)),
      coastKm: Array.from(coastKm.subarray(id * T, id * T + T)),
      coastPixels: coastPx[id],
      riverPixels: riverPx[id],
      coastlineKm: coastLen[id],
      riverbankKm: riverLen[id],
      waterEdges: waterEdges[id],
      landEdges: landEdges[id],
      pieces: pieces[id],
      mainPieceKm: mainKm[id],
      compactness,
    });
  }
  return out;
}

/** How much coast (or river) a nation has, 0..1: 1 = all round (an island), 0.5 = about one side. */
export function accessShare(edgePixels: number, pixels: number): number {
  return pixels > 0 ? Math.min(1, edgePixels / (2 * Math.sqrt(pixels))) : 0;
}

// ---------------------------------------------------------------- the stat sheet

export interface Stat {
  id: StatId;
  name: string;
  /** The label in the panel. */
  short: string;
  value: number;
  /** Compact text for the panel, e.g. "42K" or "$1.2B/yr". */
  text: string;
  /** A small extra, e.g. "62% used". */
  detail?: string;
  /** The breakdown: where the number comes from, one line each. */
  why: string[];
  about?: string;
  /** Something is wrong here (over food capacity, losing money…): the panel shows it in red. */
  warn?: boolean;
}

export interface Factor {
  value: number;
  /** "Base 2%", "Militarist +30%", … */
  lines: string[];
}

export interface StatSheet {
  stats: Record<StatId, Stat>;
  factors: Record<FactorId, Factor>;
  land: LandFacts;
}

interface Contribution {
  label: string;
  mod: Modifier;
  /** How much of the modifier applies (1 for wheel results; the land share for terrain…). */
  scale: number;
}

/** Works out a nation's stat sheet from its wheel results and its land. */
export function statSheet(nation: Nation, land: LandFacts, data: StatsData): StatSheet {
  const sfx = data.numberSuffixes;
  const people = (v: number): string => compactNumber(Math.max(0, Math.round(v)), sfx);
  const money = (v: number): string => (v < 0 ? "−" : "") + "$" + compactNumber(Math.abs(Math.round(v)), sfx);
  const kmText = (v: number): string => withCommas(v);
  const pctText = (v: number, digits = 1): string => `${(v * 100).toFixed(digits)}%`;

  // ---- what applies to this nation
  const contributions = new Map<FactorId, Contribution[]>();
  const add = (set: ModSet | undefined, label: string, scale = 1): void => {
    if (!set || scale === 0) return;
    for (const [id, mod] of Object.entries(set) as [FactorId, Modifier][]) {
      if (!contributions.has(id)) contributions.set(id, []);
      contributions.get(id)!.push({ label, mod, scale });
    }
  };
  const fromResult = (r: WheelOutcome): void => {
    if (r.none) return;
    const byId = data.results[r.wheelId];
    if (!byId) return;
    if (r.picks) for (const p of r.picks) add(byId[p.sliceId], p.label);
    else add(byId[r.sliceId], r.label);
  };
  nation.record.spins.forEach(fromResult);

  const { x, y } = nation.record.chart;
  add(data.chart.x, x >= 0 ? `Chart: nationalist side (${x.toFixed(2)})` : `Chart: liberal side (${x.toFixed(2)})`, x);
  add(data.chart.y, y >= 0 ? `Chart: good life (${y.toFixed(2)})` : `Chart: miserable (${y.toFixed(2)})`, y);

  const km = Math.max(land.km, 1e-9);
  for (let t = 0; t < T; t++) {
    const share = land.terrainKm[t] / km;
    if (share > 0) add(data.terrain[t], `${TERRAINS[t].name} (${Math.round(share * 100)}% of land)`, share);
  }
  const coast = accessShare(land.coastPixels, land.pixels);
  const river = accessShare(land.riverPixels, land.pixels);
  const edges = land.waterEdges + land.landEdges;
  const access: Record<AccessId, number> = {
    coast,
    river,
    waterBorder: edges > 0 ? land.waterEdges / edges : 0,
    landlocked: land.coastPixels === 0 ? 1 : 0,
    overseas: land.pieces > 1 ? 1 : 0,
  };
  for (const id of ACCESS_IDS) {
    const v = access[id];
    const label = id === "landlocked" || id === "overseas" ? ACCESS_NAMES[id] : `${ACCESS_NAMES[id]} (${Math.round(v * 100)}%)`;
    add(data.access[id], label, v);
  }

  // The shape of the land costs cohesion.
  const c = data.cohesion;
  const outside = land.km > 0 ? 1 - land.mainPieceKm / land.km : 0;
  if (outside > 0) add({ cohesion: { kind: "flat", amount: c.outsideMain } }, `Land outside its main piece (${Math.round(outside * 100)}%)`, outside);
  if (land.pieces > 1) {
    const extra = land.pieces - 1;
    const amount = c.perPiece < 0 ? Math.max(c.maxPieces, c.perPiece * extra) : Math.min(c.maxPieces, c.perPiece * extra);
    add({ cohesion: { kind: "flat", amount } }, `${extra} extra ${extra === 1 ? "piece" : "pieces"} (islands, exclaves)`);
  }
  const spread = 1 - land.compactness;
  if (spread > 0) add({ cohesion: { kind: "flat", amount: c.spread } }, `Spread out (${Math.round(spread * 100)}%)`, spread);

  // ---- the factors
  const factors = {} as Record<FactorId, Factor>;
  for (const id of FACTOR_IDS) factors[id] = computeFactor(data.factors[id], contributions.get(id) ?? [], sfx);
  const f = (id: FactorId): number => factors[id].value;
  const indent = (id: FactorId): string[] => [`${data.factors[id].name}:`, ...factors[id].lines.map((l) => `  ${l}`)];

  // ---- the numbers everything starts from
  const results = nation.results;
  const rolledKm = results[data.inputs.land]?.estimate?.value ?? land.km;
  const rolledPeople = results[data.inputs.people]?.estimate?.value ?? 0;
  const gdpRolled = results[data.inputs.wealth]?.estimate?.value ?? 0;
  const density = rolledKm > 0 ? rolledPeople / rolledKm : 0;
  const perPerson = rolledPeople > 0 ? gdpRolled / rolledPeople : 0;

  const population = density * land.km;
  const gdp = population * perPerson;
  const income = gdp * f("taxRate");
  const manpower = population * f("recruitRate");
  const wanted = manpower * f("armyShare");
  const affordable = (income * f("armyBudget")) / f("soldierCost");
  const army = Math.max(0, Math.min(wanted, affordable));
  const armyCost = army * f("soldierCost");
  const admin = income * f("adminCost");
  const upkeep = armyCost + admin;
  const net = income - upkeep;
  const treasury = income * f("treasuryYears");

  // Food: what each kind of land feeds, more on rivers and coasts, × farming.
  const foodLines: string[] = [];
  let rawFood = 0;
  let riverFood = 0;
  let coastFood = 0;
  for (let t = 0; t < T; t++) {
    const per = data.food.perKm2[t];
    if (!per || !land.terrainKm[t]) continue;
    const fed = per * land.terrainKm[t];
    rawFood += fed;
    riverFood += per * land.riverKm[t] * data.food.riverBank;
    coastFood += per * land.coastKm[t] * data.food.coast;
    foodLines.push(`${TERRAINS[t].name}: ${kmText(land.terrainKm[t])} km² × ${per}/km² = ${people(fed)}`);
  }
  if (riverFood > 0) foodLines.push(`On rivers ${signed(data.food.riverBank * 100, 0)}%: +${people(riverFood)}`);
  if (coastFood > 0) foodLines.push(`On coasts ${signed(data.food.coast * 100, 0)}%: +${people(coastFood)}`);
  const capacity = (rawFood + riverFood + coastFood) * f("food");
  const foodUse = capacity > 0 ? population / capacity : population > 0 ? 9.99 : 0;
  const growth = clamp(f("growthRate") * (1 - foodUse), data.growth.min, data.growth.max);

  const stat = (id: StatId, value: number, text: string, why: string[], extra: Partial<Stat> = {}): Stat => {
    const s = data.stats[id];
    return { id, name: s.name, short: s.short ?? s.name, value, text, why, about: s.about, ...extra };
  };
  const score = (id: StatId & FactorId): Stat => stat(id, f(id), String(Math.round(f(id))), factors[id].lines);

  const mix = TERRAINS.map((t, i) => ({ name: t.name, km: land.terrainKm[i] }))
    .filter((m) => m.km > 0)
    .sort((a, b) => b.km - a.km);
  const mixText = mix
    .filter((m) => m.km / km >= 0.005)
    .slice(0, 3)
    .map((m) => `${Math.round((m.km / km) * 100)}% ${m.name.toLowerCase()}`)
    .join(", ");

  const stats: Record<StatId, Stat> = {
    population: stat("population", population, people(population), [
      `${density < 10 ? density.toFixed(1) : Math.round(density)} people/km² × ${kmText(land.km)} km² of land`,
      ...(Math.abs(land.km - rolledKm) > rolledKm * 0.005 ? [`(Rolled ${kmText(rolledKm)} km² and ~${people(rolledPeople)} people; it got ${kmText(land.km)} km²)`] : []),
    ]),
    gdp: stat("gdp", gdp, money(gdp), [`Population ${people(population)} × $${withCommas(perPerson)} per person`]),
    income: stat("income", income, `${money(income)}/yr`, [`GDP ${money(gdp)} × tax rate ${pctText(f("taxRate"))}`, ...indent("taxRate")]),
    manpower: stat("manpower", manpower, people(manpower), [`Population ${people(population)} × recruit rate ${pctText(f("recruitRate"))}`, ...indent("recruitRate")]),
    army: stat(
      "army",
      army,
      people(army),
      [
        `Manpower ${people(manpower)} × kept under arms ${pctText(f("armyShare"))} = ${people(wanted)}`,
        affordable < wanted
          ? `Capped: it can only pay for ${people(affordable)} (income ${money(income)} × army budget ${pctText(f("armyBudget"), 0)} ÷ ${money(f("soldierCost"))} a soldier)`
          : `It could pay for up to ${people(affordable)} (income ${money(income)} × army budget ${pctText(f("armyBudget"), 0)} ÷ ${money(f("soldierCost"))} a soldier)`,
        ...indent("armyShare"),
        ...indent("soldierCost"),
        ...indent("armyBudget"),
      ],
      { detail: affordable < wanted ? "pay-capped" : undefined },
    ),
    armyQuality: score("armyQuality"),
    aggression: score("aggression"),
    upkeep: stat("upkeep", upkeep, `${money(upkeep)}/yr`, [
      `Army: ${people(army)} soldiers × ${money(f("soldierCost"))} = ${money(armyCost)}`,
      `Court & officials: ${pctText(f("adminCost"), 0)} of income = ${money(admin)}`,
      ...indent("adminCost"),
    ]),
    net: stat("net", net, `${net >= 0 ? "+" : ""}${money(net)}/yr`, [`Income ${money(income)} − upkeep ${money(upkeep)}`], { warn: net < 0 }),
    treasury: stat("treasury", treasury, money(treasury), [`Income ${money(income)} × ${f("treasuryYears").toFixed(2)} years of savings`, ...indent("treasuryYears")]),
    growth: stat(
      "growth",
      growth,
      `${growth >= 0 ? "+" : "−"}${Math.abs(growth * 100).toFixed(2)}%/yr`,
      [
        `Birth rate ${pctText(f("growthRate"), 2)}/yr × room left ${Math.round((1 - foodUse) * 100)}% (food ${Math.round(foodUse * 100)}% used)`,
        ...indent("growthRate"),
      ],
      { warn: growth < 0 },
    ),
    food: stat(
      "food",
      capacity,
      people(capacity),
      [`Feeds ${people(capacity)}; ${people(population)} people use ${Math.round(foodUse * 100)}% of it`, ...foodLines, ...indent("food")],
      { detail: `${Math.round(foodUse * 100)}% used`, warn: foodUse > 1 },
    ),
    stability: score("stability"),
    popularity: score("popularity"),
    land: stat("land", land.km, `${compactNumber(Math.round(land.km), sfx)} km²`, [
      ...mix.map((m) => `${m.name}: ${kmText(m.km)} km² (${Math.round((m.km / km) * 100)}%)`),
      land.pieces > 1 ? `${land.pieces} pieces; the biggest is ${kmText(land.mainPieceKm)} km²` : "One piece of land",
      `Shape: ${Math.round(land.compactness * 100)}% compact`,
    ], { detail: mixText }),
    access: stat(
      "access",
      land.coastlineKm,
      land.coastPixels ? `${compactNumber(Math.round(land.coastlineKm), sfx)} km` : "Landlocked",
      [
        land.coastPixels ? `Coastline about ${kmText(land.coastlineKm)} km (sea and lake shores): coast ${Math.round(coast * 100)}%` : "No coast: landlocked",
        land.riverPixels ? `Riverbanks about ${kmText(land.riverbankKm)} km: rivers ${Math.round(river * 100)}%` : "No big rivers",
        `Water borders: ${Math.round(access.waterBorder * 100)}% of its border is water`,
      ],
      { detail: land.riverPixels ? `rivers ${Math.round(river * 100)}%` : undefined },
    ),
    defence: score("defence"),
    trade: score("trade"),
    naval: score("naval"),
    cohesion: score("cohesion"),
  };
  return { stats, factors, land };
}

/** A factor's value and breakdown lines. */
function computeFactor(spec: FactorSpec, list: Contribution[], sfx: string[]): Factor {
  let pct = 0;
  let flat = 0;
  let mult = 1;
  const lines = [`Base ${formatFactor(spec.base, spec.format, sfx)}`];
  for (const { label, mod, scale } of list) {
    if (mod.kind === "pct") {
      const v = mod.amount * scale;
      pct += v;
      if (Math.abs(v) >= 0.005) lines.push(`${label} ${signed(v * 100, Math.abs(v * 100 - Math.round(v * 100)) >= 0.05 ? 1 : 0)}%`);
    } else if (mod.kind === "flat") {
      const v = mod.amount * scale;
      flat += v;
      if (Math.abs(v) >= flatThreshold(spec.format)) lines.push(`${label} ${signedFactor(v, spec.format, sfx)}`);
    } else {
      const v = 1 + (mod.amount - 1) * scale;
      mult *= v;
      lines.push(`${label} ×${Number(v.toFixed(2))}`);
    }
  }
  const raw = (spec.base * (1 + pct) + flat) * mult;
  const value = clamp(raw, spec.min, spec.max);
  if (value !== raw) lines.push(`Kept at the ${value === spec.min ? "lowest" : "highest"}: ${formatFactor(value, spec.format, sfx)}`);
  return { value, lines };
}

/** 1234567 → "1,234,567" (much faster than toLocaleString, which matters for 900 sheets). */
function withCommas(v: number): string {
  const text = String(Math.round(Math.abs(v)));
  let out = "";
  for (let i = 0; i < text.length; i++) out += (i > 0 && (text.length - i) % 3 === 0 ? "," : "") + text[i];
  return v < 0 ? `−${out}` : out;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

function signed(v: number, digits: number): string {
  const r = Number(v.toFixed(digits));
  return `${r < 0 ? "−" : "+"}${Math.abs(r).toFixed(digits)}`;
}

function flatThreshold(format: FactorFormat): number {
  return format === "percent" ? 0.0005 : format === "times" || format === "years" ? 0.005 : 0.5;
}

/** A factor's value as text: "2.0%", "$8,000", "62", "×1.15", "0.5 years". */
export function formatFactor(v: number, format: FactorFormat, sfx: string[]): string {
  switch (format) {
    case "percent":
      return `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`;
    case "money":
      return `$${v >= 100_000 ? compactNumber(v, sfx) : withCommas(v)}`;
    case "score":
      return String(Math.round(v));
    case "times":
      return `×${v.toFixed(2)}`;
    case "years":
      return `${v.toFixed(2)} years`;
  }
}

function signedFactor(v: number, format: FactorFormat, sfx: string[]): string {
  const sign = v < 0 ? "−" : "+";
  const a = Math.abs(v);
  if (format === "percent") return `${sign}${(a * 100).toFixed(1)} pts`;
  if (format === "score") return `${sign}${Math.round(a)}`;
  if (format === "money") return `${sign}${formatFactor(a, format, sfx)}`;
  return `${sign}${a.toFixed(2)}`;
}
