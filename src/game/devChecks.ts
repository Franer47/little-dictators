// Checks to run from the browser console while developing (dev server only):
//   game.checkWeights()      spins every wheel 100,000 times and compares wins with weights
//   game.checkNumbers(10000) rolls that many nations and prints min / median / max of the numbers
//   game.sampleNations(5)    rolls a few whole nations and prints them

import { describeOutcome, type Nation } from "./nation.ts";
import { rollNation } from "./roller.ts";
import { compactNumber } from "./numbers.ts";
import { createRng } from "./random.ts";
import { exactWheel, simulateSpins, type WheelData } from "./wheels.ts";

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
