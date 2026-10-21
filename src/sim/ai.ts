// What a nation decides for itself, once a year (in its own month): what to build, whether to
// raise or break up divisions, which neighbours to ally with, and whether to start a war. The
// player's nation thinks this way too; the player's pushes and paint just add to it. The
// numbers are in public/data/eras/<era>-sim.json ("ai").

import type { BuildingSpec } from "./simData.ts";
import type { World } from "./world.ts";

export function aiThink(w: World, id: number): void {
  w.touch(id);
  build(w, id);
  recruit(w, id);
  alliances(w, id);
  war(w, id);
}

/** How much a nation wants the next level of a building: its needs, character and the player's paint. */
function want(w: World, id: number, b: BuildingSpec): number {
  const s = w.sheets[id - 1];
  const st = s.stats;
  const level = w.live[id - 1].buildings[b.id] ?? 0;
  const ideology = s.ideologies[0]?.id ?? "";
  const gov = w.nations[id - 1].nation.results.government?.sliceId ?? "";
  const foodUse = st.population.value / Math.max(1, st.food.value);
  const atWar = w.warsOf(id).length > 0;
  let score = 1;
  switch (b.id) {
    case "farm":
      score += foodUse > 0.8 ? 4 : foodUse > 0.5 ? 1.5 : 0;
      break;
    case "market":
      score += st.trade.value / 30 + (ideology === "mercantile" || gov === "merchant-republic" ? 2 : 0);
      break;
    case "workshop":
      score += 1 + st.development.value / 40;
      break;
    case "fort":
      score += (atWar ? 2 : 0) + st.aggression.value / 100 + (id === w.mineId && w.paintedOn(id, 2) ? 3 : 0);
      break;
    case "barracks":
      score += st.aggression.value / 35 + (ideology === "militarist" ? 2 : 0) + (atWar ? 1 : 0);
      break;
    case "port":
      score += st.naval.value / 25 + (ideology === "seafaring" ? 2 : 0);
      break;
    case "school":
      score += 0.8 + (ideology === "scholarly" || ideology === "humanist" ? 2 : 0);
      break;
    case "temple":
      score += st.stability.value < 40 ? 3 : st.popularity.value < 40 ? 1.5 : 0;
      break;
  }
  if (id === w.mineId && w.paintedOn(id, 3) && ["farm", "market", "workshop", "school"].includes(b.id)) score += 1.5;
  return (score * (0.75 + w.rng.next() * 0.5)) / (1 + level);
}

function build(w: World, id: number): void {
  const l = w.live[id - 1];
  const s = w.sheets[id - 1];
  const reserve = (Math.max(0, s.stats.upkeep.value) * w.sim.ai.buildReserve) / 12;
  const options = w.sim.buildings
    .map((b) => ({ b, score: want(w, id, b) }))
    .sort((a, c) => c.score - a.score);
  for (const { b } of options) {
    if (w.whyCantBuild(id, b)) continue;
    if (l.treasury - w.buildCost(id, b) < reserve) continue;
    w.startBuilding(id, b);
    return;
  }
}

function recruit(w: World, id: number): void {
  const l = w.live[id - 1];
  const s = w.sheets[id - 1];
  const rules = w.opts.stats.divisions;
  const troops = l.divisions.reduce((t, d) => t + d.troops, 0);
  // In debt and losing money: break up the smallest division.
  if (l.treasury < 0 && s.stats.net.value < 0 && l.divisions.length) {
    const smallest = l.divisions.reduce((a, d) => (d.troops < a.troops ? d : a));
    l.divisions = l.divisions.filter((d) => d !== smallest);
    return;
  }
  const atWar = w.warsOf(id).length > 0;
  const target = s.baseArmy * (atWar ? 1.5 : 1);
  if (s.stats.stability.value < rules.minStability) return;
  let added = 0;
  let total = troops;
  let net = s.stats.net.value;
  const cost = rules.size * s.factors.soldierCost.value;
  while (total + rules.size / 2 < target && total + rules.size <= s.stats.manpower.value && net - cost > 0 && added < 3) {
    l.divisions.push({ troops: rules.size, training: w.sim.army.trainingMonths });
    total += rules.size;
    net -= cost;
    added++;
  }
}

function alliances(w: World, id: number): void {
  const ai = w.sim.ai;
  for (const other of w.allies(id)) if (w.relation(id, other) < ai.breakAllianceAt) {
    w.breakAlliance(id, other);
    w.log("diplomacy", `${w.name(id)} and ${w.name(other)} are no longer allies.`, [id, other]);
  }
  if (id === w.mineId) return; // the player chooses their own allies
  if (w.allies(id).length >= ai.maxAllies) return;
  const friends = [...(w.neighbours[id - 1] ?? [])]
    .filter((o) => w.alive(o) && !w.allied(id, o) && !w.atWar(id, o) && w.relation(id, o) >= ai.allianceAt && w.allies(o).length < ai.maxAllies && o !== w.mineId)
    .sort((a, b) => w.relation(id, b) - w.relation(id, a));
  const pick = friends[0];
  if (pick) {
    w.ally(id, pick);
    w.log("diplomacy", `${w.name(id)} and ${w.name(pick)} are now allies.`, [id, pick]);
  }
}

function war(w: World, id: number): void {
  const s = w.sheets[id - 1];
  if (s.stats.stability.value < 30) return;
  if (w.wars.some((x) => x.attackers[0] === id)) return; // one war of its own at a time
  const aggression = s.stats.aggression.value / 100;
  const mine = id === w.mineId;
  // The player's war-goal paint makes their nation keener.
  const goalBonus = mine ? 0.15 : 0;
  if (w.rng.next() > w.sim.ai.warChance * aggression * aggression + goalBonus) return;
  const mySide = w.strength(id) + w.allies(id).reduce((t, a) => t + w.strength(a) * w.sim.ai.allyJoinsAttack, 0);
  const targets = [...(w.neighbours[id - 1] ?? [])]
    .filter((o) => w.alive(o) && !w.allied(id, o) && !w.atWar(id, o) && w.relation(id, o) < -10)
    .map((o) => {
      const theirs = w.strength(o) + w.allies(o).reduce((t, a) => t + w.strength(a), 0);
      const goal = mine ? w.paintedOn(o, 1) : 0;
      return { o, theirs, score: -w.relation(id, o) + (goal ? 50 : 0) - theirs / Math.max(1, mySide) * 20 };
    })
    .filter((t) => mySide >= t.theirs * w.sim.ai.warOdds || (mine && w.paintedOn(t.o, 1) > 0 && mySide >= t.theirs))
    .sort((a, b) => b.score - a.score);
  if (mine) {
    // Only go after a painted target on its own; the player declares other wars themselves.
    const painted = targets.find((t) => w.paintedOn(t.o, 1) > 0);
    if (painted) w.declareWar(id, painted.o);
    return;
  }
  if (targets[0]) w.declareWar(id, targets[0].o);
}
