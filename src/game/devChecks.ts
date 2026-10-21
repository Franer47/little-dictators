// Checks to run from the browser console while developing (dev server only):
//   game.checkWeights()      spins every wheel 100,000 times and compares wins with weights
//   game.checkNumbers(10000) rolls that many nations and prints min / median / max of the numbers
//   game.sampleNations(5)    rolls a few whole nations and prints them
//   game.checkStats()        the spread of every stat over the nations on the map, and anything absurd

import { describeOutcome, type Nation } from "./nation.ts";
import { rollNation } from "./roller.ts";
import { compactNumber } from "./numbers.ts";
import { createRng } from "./random.ts";
import { exactWheel, simulateSpins, type WheelData } from "./wheels.ts";
import { STAT_IDS, type StatSheet } from "./stats.ts";

export function checkWeights(data: WheelData): Record<string, ReturnType<typeof simulateSpins>> {
  const rng = createRng();
  const results: Record<string, ReturnType<typeof simulateSpins>> = {};
  for (const wheel of data.wheels) {
    console.log(`${wheel.name} (100,000 spins):`);
    results[wheel.id] = simulateSpins(wheel, rng);
    console.table(results[wheel.id]);
    if (wheel.number && !wheel.number.times) {
      // Also the exact-number wheel that follows its first slice.
      const exact = exactWheel(wheel, wheel.slices[0], data);
      console.log(`${wheel.name}, exact numbers for ${wheel.slices[0].shown}:`);
      results[exact.id] = simulateSpins(exact, rng);
      console.table(results[exact.id]);
    }
  }
  return results;
}

type Spread = Record<string, string>;

/**
 * Rolls many nations and prints the spread of every number: each number wheel's picked
 * number (density, output per person) and its result (area, population, GDP).
 */
export function checkNumbers(data: WheelData, nations = 10_000): Record<string, Spread> {
  const rng = createRng();
  const columns = new Map<string, number[]>();
  const add = (name: string, value: number): void => {
    if (!columns.has(name)) columns.set(name, []);
    columns.get(name)!.push(value);
  };
  let rare = 0;
  let golden = 0;
  let poorest: Nation | null = null;
  let richest: Nation | null = null;
  const gdpOf = (n: Nation): number => lastNumber(n)?.estimate?.value ?? 0;
  for (let i = 0; i < nations; i++) {
    const nation = rollNation(data, "check", rng);
    for (const wheel of data.wheels) {
      const e = nation.results[wheel.id]?.estimate;
      if (!e) continue;
      if (wheel.number?.times) add(`${wheel.name} (picked)`, e.rate);
      add(wheel.resultName ?? wheel.name, e.value);
    }
    add("Chart x (left -1 … right 1)", nation.record.chart.x);
    add("Chart y (miserable -1 … good life 1)", nation.record.chart.y);
    add("Golden chance %", (nation.record.goldenChance ?? 0) * 100);
    if (nation.record.spins.some((r) => r.rare)) rare++;
    if (nation.record.spins.some((r) => !r.none && data.wheels.find((w) => w.id === r.wheelId)?.gate)) golden++;
    if (!poorest || gdpOf(nation) < gdpOf(poorest)) poorest = nation;
    if (!richest || gdpOf(nation) > gdpOf(richest)) richest = nation;
  }
  const table: Record<string, Spread> = {};
  const fmt = (x: number): string => (Math.abs(x) < 100 ? (Math.round(x * 100) / 100).toString() : compactNumber(x, data.numberSuffixes));
  for (const [name, values] of columns) {
    values.sort((a, b) => a - b);
    const at = (p: number): number => values[Math.min(values.length - 1, Math.floor(p * values.length))];
    table[name] = { min: fmt(values[0]), "10%": fmt(at(0.1)), median: fmt(at(0.5)), "90%": fmt(at(0.9)), max: fmt(values[values.length - 1]) };
  }
  console.log(`Numbers from ${nations.toLocaleString("en-US")} rolled nations:`);
  console.table(table);
  const pct = (n: number): string => `${((n / nations) * 100).toFixed(2)}%`;
  console.log(`Rare pulls: ${pct(rare)} of nations. Golden spins won: ${pct(golden)}.`);
  table["Rare pull / golden spin"] = { min: "", "10%": "", median: `${pct(rare)} / ${pct(golden)}`, "90%": "", max: "" };
  if (poorest) console.log("Smallest economy:", summary(poorest));
  if (richest) console.log("Biggest economy:", summary(richest));
  return table;
}

/** Rolls a few nations and prints each one in a line. */
export function sampleNations(data: WheelData, count = 5): string[] {
  const rng = createRng();
  const lines = Array.from({ length: count }, () => summary(rollNation(data, "sample", rng)));
  lines.forEach((l) => console.log(l));
  return lines;
}

/** "Name: Culture Latin, ... , GDP ~$4.2B (Prosperous · $2,100 per person · today's money)". */
export function summary(nation: Nation): string {
  const parts = nation.record.spins.map((r) => {
    const { main, sub } = describeOutcome(r);
    return `${r.resultName} ${main}${sub ? ` (${sub})` : ""}`;
  });
  return `${nation.name}: ${parts.join(", ")}`;
}

/** The last number result in spin order (GDP, in the 1500 set). */
function lastNumber(nation: Nation) {
  return [...nation.record.spins].reverse().find((r) => r.estimate);
}

/**
 * The spread (min / 10% / median / 90% / max) of every stat over the nations on the map, plus
 * a list of anything that looks absurd for 1500. Fill the world first for a good sample.
 */
export function checkStats(nations: readonly { nation: Nation }[], sheets: readonly StatSheet[], ms = 0): { table: Record<string, Spread>; problems: string[] } {
  const table: Record<string, Spread> = {};
  const problems: string[] = [];
  if (!sheets.length) {
    console.log("No nations on the map yet: place some (or Fill) first.");
    return { table, problems };
  }
  const columns: Record<string, number[]> = {};
  const add = (name: string, v: number): void => void (columns[name] ??= []).push(v);
  sheets.forEach((sheet, i) => {
    if (!sheet.land.pixels) return; // a fallen nation
    const s = sheet.stats;
    const name = nations[i]?.nation.name ?? `#${i + 1}`;
    for (const id of STAT_IDS) {
      const v = s[id].value;
      if (!Number.isFinite(v)) problems.push(`${name}: ${id} is ${v}`);
      add(s[id].name, v);
    }
    const pop = s.population.value;
    add("Army, % of population", (s.army.value / Math.max(1, pop)) * 100);
    add("Income, % of GDP", (s.income.value / Math.max(1, s.gdp.value)) * 100);
    add("Food used %", (pop / Math.max(1, s.food.value)) * 100);
    add("Growth %/yr", s.growth.value * 100);
    add("Pieces", sheet.land.pieces);
    add("Compactness %", sheet.land.compactness * 100);
    if (s.army.value > pop * 0.05) problems.push(`${name}: army ${Math.round(s.army.value)} is over 5% of its ${Math.round(pop)} people`);
    if (s.income.value > s.gdp.value * 0.15) problems.push(`${name}: income is over 15% of GDP`);
    if (Math.abs(s.growth.value) > 0.02) problems.push(`${name}: growth ${(s.growth.value * 100).toFixed(2)}%/yr`);
    if (s.food.value <= 0 && pop > 0) problems.push(`${name}: its land feeds nobody`);
  });
  const fmt = (x: number): string => (Math.abs(x) < 100 ? (Math.round(x * 100) / 100).toString() : compactNumber(Math.abs(x), ["K", "M", "B", "T"]).replace(/^/, x < 0 ? "-" : ""));
  for (const [name, values] of Object.entries(columns)) {
    values.sort((a, b) => a - b);
    const at = (p: number): number => values[Math.min(values.length - 1, Math.floor(p * values.length))];
    table[name] = { min: fmt(values[0]), "10%": fmt(at(0.1)), median: fmt(at(0.5)), "90%": fmt(at(0.9)), max: fmt(values[values.length - 1]) };
  }
  console.log(`Stats of ${sheets.length.toLocaleString("en-US")} nations${ms ? ` (worked out in ${Math.round(ms)} ms)` : ""}:`);
  console.table(table);
  if (problems.length) console.warn(`${problems.length} things look off:\n${problems.slice(0, 30).join("\n")}`);
  else console.log("Nothing looks absurd.");
  return { table, problems };
}
