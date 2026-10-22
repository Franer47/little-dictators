// Stability in the running game: earned by progress. The roll on the wheel is only a head start.
// Every month each nation looks at how it's doing (its "progress signals"): is the economy
// growing, is it in debt, is it well fed, is the population growing, is it developing, did it
// finish buildings, win or lose wars, gain or lose land, has it had a long peace. Each signal is
// smoothed over a couple of years (or, for events like a war won, remembered and slowly
// forgotten), weighted, and added up into a target. Stability moves a little toward that
// target each month. Buildings (temples, forts), debt and popularity add a lasting part; the
// starting roll's part fades over the first years, and so does how much stability changes the
// rest of the sheet, so a bad roll isn't a death sentence and a good one isn't a free win.
// Deterministic: no randomness. The numbers are in public/data/eras/<era>-sim.json, "stability".

import type { StatSheet } from "../game/stats.ts";
import type { NationLive, World } from "./world.ts";

export const SIGNALS = ["economy", "debt", "food", "population", "development", "buildings", "wars", "land", "peace"] as const;
export type Signal = (typeof SIGNALS)[number];

/** Signals that are events, remembered and slowly forgotten (the others are smoothed readings). */
const EVENTS: ReadonlySet<Signal> = new Set(["buildings", "wars", "land"]);

/** How each signal reads when it helps and when it hurts. */
const WORDS: Record<Signal, [string, string]> = {
  economy: ["Economy growing", "Economy shrinking"],
  debt: ["Out of debt", "In debt"],
  food: ["Well fed", "Hungry: more people than food"],
  population: ["Population growing", "Population falling"],
  development: ["Development rising", "Development falling"],
  buildings: ["New buildings", "Buildings lost"],
  wars: ["Won a war", "Lost a war"],
  land: ["Gained land", "Lost land"],
  peace: ["Long peace", "At war"],
};

/** What the progress signals remember between months. */
export interface StabilityLive {
  /** Each signal's smoothed value or memory, −1..1. */
  mood: Partial<Record<Signal, number>>;
  /** The last readings, to see what changed (income only changes when the sheet is worked out again). */
  lastIncome?: number;
  lastIncomeMonth?: number;
  incomeGrowth?: number;
  lastDevelopment?: number;
  lastKm?: number;
  /** Months since its last war ended (or since the start). */
  peaceMonths: number;
  /** Where it started (World.absMonth) and its starting roll (points above or below 50). */
  born: number;
  roll: number;
  /** What it's heading for, worked out each month. */
  target: number;
}

/** The first stability of a nation from its sheet's roll: a head start, squeezed toward 50. */
export function startStability(w: World, l: NationLive, sheet: StatSheet): void {
  const r = w.sim.stability;
  const roll = sheet.stabilityParts.roll;
  l.stability = clamp(50 + roll * r.startSpread + sheet.stabilityParts.lasting, 0, 100);
  l.progress = { mood: {}, peaceMonths: r.refs.peaceMonths / 2, born: w.absMonth, roll, target: l.stability };
}

/** An event for a nation's stability: a building finished (+), a war won (+) or lost (−)… */
export function stabilityEvent(w: World, id: number, signal: Signal, amount: number): void {
  const p = w.live[id - 1]?.progress;
  if (!p) return;
  p.mood[signal] = clamp((p.mood[signal] ?? 0) + amount, -1, 1);
}

/** How far the starting roll has faded for this nation (1 at its start, toward 0 later). */
function fade(w: World, p: StabilityLive): number {
  const years = Math.max(0, (w.absMonth - p.born) / 12);
  return Math.exp(-years / w.sim.stability.fadeYears);
}

/** How strongly stability changes the rest of the sheet now: mild at first, full later. */
export function stabilityEffect(w: World, l: NationLive): number {
  const p = l.progress;
  if (!p) return 1;
  const start = w.sim.stability.effectStart;
  return start + (1 - start) * (1 - fade(w, p));
}

/** One month: read the signals, work out the target, and move stability toward it. */
export function updateStability(w: World, id: number): void {
  const l = w.live[id - 1];
  const s = w.sheets[id - 1];
  const p = l?.progress;
  if (!l?.alive || !s || !p || l.stability === undefined) return;
  const r = w.sim.stability;
  const st = s.stats;
  const km = s.land.km;
  // The readings this month, each −1..1.
  // Income: a nation's sheet is worked out every few months, so growth is measured between changes.
  const income = st.income.value;
  if (p.lastIncome === undefined || p.lastIncomeMonth === undefined) {
    p.lastIncome = income;
    p.lastIncomeMonth = w.absMonth;
  } else if (income !== p.lastIncome) {
    const months = Math.max(1, w.absMonth - p.lastIncomeMonth);
    p.incomeGrowth = p.lastIncome > 0 ? ((income - p.lastIncome) / p.lastIncome) * (12 / months) : 0;
    p.lastIncome = income;
    p.lastIncomeMonth = w.absMonth;
  }
  const incomeGrowth = p.incomeGrowth ?? 0;
  const netShare = income > 0 ? st.net.value / income : st.net.value < 0 ? -1 : 0;
  const foodUse = st.food.value > 0 ? st.population.value / st.food.value : 2;
  const atWar = w.warsOf(id).length > 0;
  p.peaceMonths = atWar ? 0 : p.peaceMonths + 1;
  const reading: Partial<Record<Signal, number>> = {
    economy: 0.5 * clamp(incomeGrowth / r.refs.income, -1, 1) + 0.5 * clamp(netShare / r.refs.net, -1, 1),
    debt: l.treasury < 0 ? -1 : 0,
    food: foodUse <= r.refs.wellFed ? r.refs.fedBonus : foodUse <= 1 ? (r.refs.fedBonus * (1 - foodUse)) / (1 - r.refs.wellFed) : -clamp((foodUse - 1) / r.refs.hungry, 0, 1),
    population: clamp(st.growth.value / r.refs.growth, -1, 1),
    development: p.lastDevelopment === undefined ? 0 : clamp(((l.development - p.lastDevelopment) * 12) / r.refs.development, -1, 1),
    peace: atWar ? -r.refs.atWar : Math.min(1, p.peaceMonths / r.refs.peaceMonths),
  };
  // Land gained or lost this month is an event (it's remembered, then forgotten).
  if (p.lastKm && p.lastKm > 0 && km !== p.lastKm) stabilityEvent(w, id, "land", clamp((km - p.lastKm) / p.lastKm / r.refs.land, -1, 1));
  p.lastDevelopment = l.development;
  p.lastKm = km;
  const smooth = 1 / r.smoothMonths;
  const forget = 1 - 1 / r.memoryMonths;
  for (const sig of SIGNALS) {
    if (EVENTS.has(sig)) p.mood[sig] = (p.mood[sig] ?? 0) * forget;
    else p.mood[sig] = (p.mood[sig] ?? 0) + ((reading[sig] ?? 0) - (p.mood[sig] ?? 0)) * smooth;
  }
  // The target: the base, plus the signals, plus what lasts, plus the fading roll.
  const rollNow = p.roll * r.startSpread * fade(w, p);
  let target = r.base + s.stabilityParts.lasting + rollNow;
  for (const sig of SIGNALS) target += r.weights[sig] * (p.mood[sig] ?? 0);
  p.target = clamp(target, 0, 100);
  l.stability = clamp(l.stability + (p.target - l.stability) * r.moveRate, 0, 100);
}

/** Stability's why lines for the sheet: where it's heading and what pushes it. */
export function stabilityLines(w: World, l: NationLive, sheet: StatSheet | undefined): string[] {
  const p = l.progress;
  const r = w.sim.stability;
  if (!p || l.stability === undefined) return [];
  const now = Math.round(l.stability);
  const target = Math.round(p.target);
  const lines = [`Now ${now}, heading for ${target}${target > now ? " (rising)" : target < now ? " (falling)" : ""}. Earned by progress; it moves a little each month.`];
  const parts: [string, number][] = [];
  for (const sig of SIGNALS) {
    const v = r.weights[sig] * (p.mood[sig] ?? 0);
    if (Math.abs(v) >= 0.5) parts.push([WORDS[sig][v >= 0 ? 0 : 1], v]);
  }
  const rollNow = p.roll * r.startSpread * fade(w, p);
  if (Math.abs(rollNow) >= 0.5) parts.push(["Starting roll (fading)", rollNow]);
  parts.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [label, v] of parts) lines.push(`${label} ${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(Math.abs(v) < 9.95 ? 1 : 0)}`);
  if (sheet && Math.abs(sheet.stabilityParts.lasting) >= 0.5) lines.push(...sheet.stabilityParts.lastingLines);
  return lines;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
