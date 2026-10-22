// Wars with front lines (milestone 5). Every month:
// - each side's armies clash: the war score moves toward the stronger side, and the armies on
//   the fronts lose troops (fewer when they dig in, see armies.ts);
// - along every front (each pair of enemies) the armies there fight: a side whose attacking
//   armies beat the other's defence pushes into its land, pixel by pixel: the bigger its edge,
//   the further. Terrain slows it (mountains, highlands, rivers cost more), and so does the
//   player's "Defend" paint; the player's "War goal" paint is taken first. Conquered land
//   belongs to the conqueror at once.
// When one side is clearly winning (or the war drags on too long) peace is signed: everyone
// keeps what they hold, and the winner may also get tribute, or all of a small loser.
// The numbers are in public/data/eras/<era>-sim.json ("war", "peace").

import { Terrain } from "../map/terrain.ts";
import { frontPower } from "./armies.ts";
import { stabilityEvent } from "./stability.ts";
import type { War, World } from "./world.ts";

export interface PeaceTerms {
  text: string;
}

/** What a peace would give on top of the land already held, worked out without signing it. */
export interface Terms {
  winner: number;
  loser: number;
  kind: "draw" | "tribute" | "annex";
  /** km² of the loser's land the winner takes in the peace (annex only). */
  km: number;
}

/**
 * The terms the current war score gives: below 'tributeAt' nothing more (everyone keeps what
 * they hold); from 'tributeAt' tribute; a loser under 'annexSize' of the winner's size is taken
 * whole from 'annexAt'.
 */
export function peaceTerms(w: World, war: War): Terms {
  const p = w.sim.peace;
  const attackersWon = war.score >= 0;
  const score = Math.abs(war.score);
  const winner = attackersWon ? war.attackers[0] : war.defenders[0];
  const loser = attackersWon ? war.defenders[0] : war.attackers[0];
  const none: Terms = { winner, loser, kind: "draw", km: 0 };
  if (!winner || !loser || score < p.tributeAt) return none;
  const { territory } = w.opts;
  const loserKm = territory.holding(loser)?.area ?? 0;
  const winnerKm = territory.holding(winner)?.area ?? 0;
  if (score >= p.annexAt && loserKm <= winnerKm * p.annexSize) return { ...none, kind: "annex", km: loserKm };
  return { ...none, kind: "tribute" };
}

/** "you keep what you hold, and X pays you tribute" etc., for the Wars panel. */
export function describeTerms(w: World, t: Terms): string {
  const mine = w.mineId;
  const km = `${Math.round(t.km).toLocaleString("en-US")} km²`;
  const we = t.winner === mine;
  const p = w.sim.peace;
  switch (t.kind) {
    case "draw":
      return "everyone keeps the land they hold now, nothing more";
    case "tribute":
      return we
        ? `you keep the land you hold, and ${w.name(t.loser)} pays you ${Math.round(p.tributeShare * 100)}% of its income for ${p.tributeYears} years`
        : `${w.name(t.winner)} keeps what it holds, and you pay it tribute for ${p.tributeYears} years`;
    case "annex":
      return we ? `you take all of ${w.name(t.loser)} (${km})` : `${w.name(t.winner)} takes all of your land`;
  }
}

const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** One month of every war: battles, losses, war score, the fronts moving, and peace where it's due. */
export function fightWars(w: World): void {
  const rules = w.sim.war;
  // Troops each nation lost this month (shared out over its battles, for the map).
  const lost = new Map<number, number>();
  const peace = w.sim.peace;
  // Every pair of enemies is a front (they may not touch: they can fight across a short stretch of sea, see push).
  const pairs: [number, number][] = [];
  for (const war of w.wars) {
    for (const a of war.attackers) for (const d of war.defenders) if (w.alive(a) && w.alive(d)) pairs.push([a, d]);
  }
  for (const war of [...w.wars]) {
    war.attackers = war.attackers.filter((id) => w.alive(id));
    war.defenders = war.defenders.filter((id) => w.alive(id));
    if (!war.attackers.length || !war.defenders.length) {
      w.wars = w.wars.filter((x) => x !== war);
      continue;
    }
    war.months++;
    const side = (ids: number[], defending: boolean): number =>
      ids.reduce((t, id) => t + w.strength(id) * (defending ? 1 + defence(w, id) : 1), 0);
    const sa = side(war.attackers, false);
    const sd = side(war.defenders, true);
    if (sa + sd > 0) {
      const share = sa / (sa + sd);
      war.score = Math.max(-100, Math.min(100, war.score + (share - 0.5) * 2 * rules.scorePerMonth));
      // Losses: more against a stronger enemy.
      const lossA = Math.min(rules.maxLosses, rules.losses * Math.sqrt(sd / Math.max(1, sa)));
      const lossD = Math.min(rules.maxLosses, rules.losses * Math.sqrt(sa / Math.max(1, sd)));
      for (const id of war.attackers) lost.set(id, (lost.get(id) ?? 0) + bleed(w, id, war.defenders, lossA));
      for (const id of war.defenders) lost.set(id, (lost.get(id) ?? 0) + bleed(w, id, war.attackers, lossD));
    }
  }
  // The fronts move: on each, a side whose attacking armies beat the other's defence pushes in.
  const warOf = (a: number, d: number): War | undefined => w.wars.find((x) => x.attackers.includes(a) && x.defenders.includes(d));
  w.battles = [];
  for (const [a, d] of pairs) {
    if (!w.alive(a) || !w.alive(d)) continue;
    const pa = frontPower(w, a, d);
    const pd = frontPower(w, d, a);
    // Each side's edge when it attacks: its attack against the other's defence (with forts and terrain).
    const edgeOf = (att: number, def: number): number => (att > def && att > 0 ? (att - def) / (att + def) : 0);
    const ea = edgeOf(pa.attack, pd.defence * (1 + defence(w, d)));
    const ed = edgeOf(pd.attack, pa.defence * (1 + defence(w, a)));
    const [winner, loser, edge] = ea >= ed ? [a, d, ea] : [d, a, ed];
    if (pa.armies || pd.armies) w.battles.push({ a, d, winner: edge >= rules.deadZone ? winner : 0, edge, lostA: 0, lostD: 0 });
    if (edge < rules.deadZone) continue;
    const war = warOf(a, d);
    if (war) push(w, war, winner, loser, edge);
  }
  // Each nation's losses, shared out over the battles it fought.
  const fights = new Map<number, number>();
  for (const b of w.battles) for (const id of [b.a, b.d]) fights.set(id, (fights.get(id) ?? 0) + 1);
  for (const b of w.battles) {
    b.lostA = (lost.get(b.a) ?? 0) / (fights.get(b.a) ?? 1);
    b.lostD = (lost.get(b.d) ?? 0) / (fights.get(b.d) ?? 1);
  }
  // Peace: when one side is clearly winning, or the war drags on. When the player's nation is
  // the one winning, the player decides when to stop (Make peace) and keeps conquering till then.
  for (const war of [...w.wars]) {
    const winnerIsMine = (war.score >= 0 ? war.attackers[0] : war.defenders[0]) === w.mineId && w.mineId > 0;
    const decided = !winnerIsMine && Math.abs(war.score) >= peace.winAt && war.months >= peace.minMonths;
    const tired = war.months >= peace.maxMonths * (winnerIsMine ? 2 : 1);
    // A long war going nowhere may just stop, but not the player's own (they decide).
    const playerIn = [...war.attackers, ...war.defenders].includes(w.mineId);
    const shrug = !playerIn && war.months >= 12 && Math.abs(war.score) < 15 && w.rng.next() < 0.03;
    if (decided || tired || shrug) makePeace(w, war);
  }
}

/** A nation's defence as a bonus (0.5 = +50%). */
function defence(w: World, id: number): number {
  return (w.sheets[id - 1]?.stats.defence.value ?? 0) / 100;
}

/**
 * A nation's armies facing `enemies` lose `share` of their troops (× their stance's losses);
 * its home armies lose a third of that; the reserve is safe at the capital.
 */
function bleed(w: World, id: number, enemies: number[], share: number): number {
  const l = w.live[id - 1];
  const stances = w.sim.army.stances;
  const rate = new Map<number, number>();
  for (const a of l.armies ?? []) {
    if (enemies.includes(a.front)) rate.set(a.id, share * stances[a.stance].losses);
    else if (a.front === 0) rate.set(a.id, share / 3);
  }
  let lost = 0;
  for (const d of l.divisions) {
    if (d.training > 0) continue;
    const cut = d.troops * (rate.get(d.army ?? 0) ?? 0);
    d.troops -= cut;
    lost += cut;
  }
  return lost;
}

/**
 * `winner` pushes into `loser`'s land along their front: it has a budget of
 * front length × 'pushRate' × its edge (0..1) (at least 'minPush' × its edge, at most 'maxShare'
 * of the loser's land), plus whatever it didn't spend last month on this front. Each pixel
 * costs its terrain's 'conquestCost' (doubled on the player's Defend paint). It spreads from
 * the front inward, the player's War goal paint first.
 */
function push(w: World, war: War, winner: number, loser: number, edge: number): void {
  const { map, territory } = w.opts;
  const { width } = map;
  const owner = territory.owner;
  const rules = w.sim.war;
  const holding = territory.holding(loser);
  if (!holding?.pixels.length) return;
  const preferGoal = winner === w.mineId;
  const guarded = loser === w.mineId;
  const seen = new Set<number>();
  const painted: number[] = [];
  const plain: number[] = [];
  const add = (i: number): void => {
    if (seen.has(i)) return;
    seen.add(i);
    (preferGoal && w.paint[i] === 1 ? painted : plain).push(i);
  };
  // The front: the loser's pixels that touch the winner.
  for (const i of holding.pixels) {
    if (owner[i] !== loser) continue;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of SIDES) {
      const p = map.normalize(x + dx, y + dy);
      if (p && owner[p[1] * width + p[0]] === winner) {
        add(i);
        break;
      }
    }
  }
  // No land front: land on the loser's coast across a short stretch of sea, if there's one.
  let seaCost = 1;
  if (!painted.length && !plain.length) {
    for (const i of landings(w, winner, loser)) add(i);
    seaCost = rules.seaCost;
  }
  const frontLength = painted.length + plain.length;
  if (!frontLength) return;
  const key = `${winner}-${loser}`;
  war.progress ??= {};
  // Push on this front from the other side's earlier months is lost when the tide turns.
  delete war.progress[`${loser}-${winner}`];
  // At most 'maxShare' of the loser's land a month, but never under 'minPush' (so a nearly beaten nation can be finished).
  let budget = Math.min(Math.max(frontLength * rules.pushRate, rules.minPush) * edge, Math.max(holding.pixels.length * rules.maxShare, rules.minPush));
  budget += war.progress[key] ?? 0;
  const taken: number[] = [];
  let hp = 0;
  let hq = 0;
  while (hp < painted.length || hq < plain.length) {
    const i = hp < painted.length ? painted[hp++] : plain[hq++];
    let cost = (rules.conquestCost[map.terrain[i]] ?? 1) * (taken.length < frontLength ? seaCost : 1);
    if (guarded && w.paint[i] === 2) cost *= rules.defendPaintCost;
    if (cost > budget) {
      // Not enough left this month for this pixel: maybe a cheaper one is still in reach.
      if (budget < 1) break;
      continue;
    }
    budget -= cost;
    taken.push(i);
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of SIDES) {
      const p = map.normalize(x + dx, y + dy);
      if (!p) continue;
      const j = p[1] * width + p[0];
      if (owner[j] === loser) add(j);
    }
  }
  // What wasn't spent carries over (a little, so it can't pile up forever).
  war.progress[key] = Math.min(budget, 6);
  if (!taken.length) return;
  if (loser === w.mineId) w.landChanged();
  infamyForLand(w, winner, taken);
  w.transferLand(taken, winner);
  w.lastConqueror.set(loser, winner);
  // Paint on land that changed hands no longer applies.
  for (const i of taken) w.paint[i] = 0;
  w.markChanged(taken);
  w.touch(winner);
  w.touch(loser);
}

/** Taking land costs infamy: 'infamyPerLand' × the land taken ÷ the taker's own land. */
function infamyForLand(w: World, winner: number, pixels: readonly number[]): void {
  const { territory, map } = w.opts;
  let km = 0;
  for (const i of pixels) km += territory.areas[(i / map.width) | 0];
  const own = territory.holding(winner)?.area ?? 0;
  if (own > 0) w.addInfamy(winner, (w.sim.ai.infamyPerLand * km) / own);
}

/**
 * The loser's coast pixels the winner can reach over at most 'seaCrossing' pixels of sea from
 * its own coast (islands, straits). Empty if the sea between them is wider.
 */
function landings(w: World, winner: number, loser: number): number[] {
  const { map, territory } = w.opts;
  const { width, height, terrain } = map;
  const owner = territory.owner;
  const maxSteps = w.sim.war.seaCrossing;
  const holding = territory.holding(winner);
  if (!holding || maxSteps <= 0) return [];
  const isSea = (i: number): boolean => terrain[i] === Terrain.Ocean || terrain[i] === Terrain.ShallowWater;
  const steps = new Map<number, number>();
  let frontier: number[] = [];
  // Start from the sea next to the winner's land.
  for (const i of holding.pixels) {
    if (owner[i] !== winner) continue;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of SIDES) {
      const p = map.normalize(x + dx, y + dy);
      if (!p) continue;
      const j = p[1] * width + p[0];
      if (isSea(j) && !steps.has(j)) {
        steps.set(j, 1);
        frontier.push(j);
      }
    }
  }
  const found = new Set<number>();
  for (let step = 1; step <= maxSteps && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of SIDES) {
        const p = map.normalize(x + dx, y + dy);
        if (!p || p[1] >= height) continue;
        const j = p[1] * width + p[0];
        if (owner[j] === loser) found.add(j);
        else if (isSea(j) && !steps.has(j)) {
          steps.set(j, step + 1);
          next.push(j);
        }
      }
    }
    frontier = next;
  }
  return [...found];
}

/** Ends a war on its current score: everyone keeps what they hold, plus the terms (see peaceTerms). */
export function makePeace(w: World, war: War): PeaceTerms {
  const p = w.sim.peace;
  const terms = peaceTerms(w, war);
  const { winner, loser } = terms;
  let text = `Peace: the ${war.name} ends; everyone keeps what they hold.`;
  if (terms.kind === "annex") {
    const all = Array.from(w.opts.territory.holding(loser)?.pixels ?? []);
    if (all.length) {
      if (loser === w.mineId) w.landChanged();
      infamyForLand(w, winner, all);
      w.transferLand(all, winner);
      for (const i of all) w.paint[i] = 0;
      w.markChanged(all);
      text = `Peace: ${w.name(winner)} wins the ${war.name} and takes all of ${w.name(loser)}.`;
    }
  } else if (terms.kind === "tribute") {
    const income = Math.max(0, w.sheets[loser - 1]?.stats.income.value ?? 0);
    w.live[loser - 1].tributes.push({ to: winner, amount: income * p.tributeShare, yearsLeft: p.tributeYears });
    text = `Peace: ${w.name(winner)} wins the ${war.name}, keeps what it took, and ${w.name(loser)} pays it ${Math.round(p.tributeShare * 100)}% of its income for ${p.tributeYears} years.`;
  }
  // The winner's allies get a smaller tribute from the loser.
  if (terms.kind !== "draw") {
    const allies = (winner === war.attackers[0] ? war.attackers : war.defenders).filter((id) => id !== winner && w.alive(id));
    const income = Math.max(0, w.sheets[loser - 1]?.stats.income.value ?? 0);
    if (allies.length && w.alive(loser) && terms.kind !== "annex") {
      for (const a of allies) w.live[loser - 1].tributes.push({ to: a, amount: (income * p.tributeShare) / 2, yearsLeft: p.tributeYears });
      text += ` Its allies (${allies.map((a) => w.name(a)).join(", ")}) get ${Math.round((p.tributeShare / 2) * 100)}% of ${w.name(loser)}'s income for ${p.tributeYears} years.`;
    }
  }
  // Winning lifts stability, losing hurts it (more for a bigger win); allies feel half of it.
  if (Math.abs(war.score) >= p.tributeAt) {
    const big = w.sim.stability.events.war * (0.4 + 0.6 * Math.min(1, Math.abs(war.score) / 100));
    const winners = winner === war.attackers[0] ? war.attackers : war.defenders;
    const losers = winner === war.attackers[0] ? war.defenders : war.attackers;
    for (const id of winners) stabilityEvent(w, id, "wars", id === winner ? big : big / 2);
    for (const id of losers) stabilityEvent(w, id, "wars", id === loser ? -big : -big / 2);
  }
  for (const id of [...war.attackers, ...war.defenders]) w.touch(id);
  w.peaceSigned(war, { text });
  return { text };
}
