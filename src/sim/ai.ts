// What a nation decides for itself, once a year (in its own month): what to build, how big an
// army to keep, which neighbours to ally with, whether to plan a war, and whether to join a
// coalition against a neighbour that grabs too much. The player's nation thinks this way too;
// the player's pushes and paint just add to it.
//
// And what happens every month (aiMonthly): planned wars are declared when their troops are
// ready (or called off), coalitions strike when they're strong enough, infamy fades, and
// unstable nations may lose a region to a revolt. The numbers are in
// public/data/eras/<era>-sim.json ("ai").

import { capitalOf } from "./armies.ts";
import type { BuildingSpec } from "./simData.ts";
import type { World } from "./world.ts";

export function aiThink(w: World, id: number): void {
  w.touch(id);
  build(w, id);
  recruit(w, id);
  alliances(w, id);
  coalitions(w, id);
  war(w, id);
}

/** Every month: plans come due, coalitions strike, infamy fades, revolts break out. */
export function aiMonthly(w: World): void {
  const ai = w.sim.ai;
  const now = w.absMonth;
  w.live.forEach((l, i) => {
    const id = i + 1;
    if (!l.alive) return;
    if (l.infamy) l.infamy = Math.max(0, l.infamy * (1 - ai.infamyDecay / 12));
    // A planned war: declared when the troops are ready, if it still looks winnable.
    const plan = l.plan;
    if (plan) {
      const t = plan.target;
      if (!w.alive(t) || w.allied(id, t) || w.atWar(id, t)) l.plan = undefined;
      else if (now >= plan.ready) {
        l.plan = undefined;
        if (sides(w, id, t).ours >= sides(w, id, t).theirs * ai.warOdds * 0.85 && w.sheets[i]?.stats.stability.value >= 30) w.declareWar(id, t);
        else w.log("info", `${w.name(id)} has called off its plans against ${w.name(t)}.`, [id, t]);
      }
    }
  });
  // Coalitions strike when together they're strong enough.
  for (const c of [...w.coalitions]) {
    c.members = c.members.filter((m) => w.alive(m) && !w.allied(m, c.target));
    if (!w.alive(c.target) || !c.members.length) {
      w.coalitions = w.coalitions.filter((x) => x !== c);
      continue;
    }
    if (c.members.length < 2 || c.members.some((m) => w.atWar(m, c.target))) continue;
    const ours = c.members.reduce((t, m) => t + w.strength(m), 0);
    const theirs = w.strength(c.target) + w.allies(c.target).reduce((t, a) => t + w.strength(a), 0);
    if (ours < theirs * ai.coalitionOdds) continue;
    const war = w.declareWar(c.members[0], c.target, false);
    for (const m of c.members.slice(1)) if (!war.attackers.includes(m) && !war.defenders.includes(m)) war.attackers.push(m);
    for (const a of war.attackers) for (const d of war.defenders) w.breakAlliance(a, d);
    war.name = `War of the Coalition against ${w.name(c.target)}`;
    w.log("coalition", `A coalition of ${war.attackers.map((m) => w.name(m)).join(", ")} declared war on ${w.name(c.target)}.`, [c.target, ...war.attackers], capitalOf(w, c.target));
    w.coalitions = w.coalitions.filter((x) => x !== c);
  }
  // Revolts in unstable nations.
  w.live.forEach((l, i) => {
    const id = i + 1;
    const s = w.sheets[i];
    if (!l.alive || !s || !w.onRevolt) return;
    const stab = s.stats.stability.value;
    if (stab >= ai.revoltBelow || now - (l.lastRevolt ?? -1e9) < ai.revoltCooldownYears * 12) return;
    if ((w.opts.territory.holding(id)?.pixels.length ?? 0) < ai.revoltMinPixels) return;
    if (w.rng.next() >= ai.revoltChance * ((ai.revoltBelow - stab) / ai.revoltBelow)) return;
    const share = ai.revoltShareMin + w.rng.next() * (ai.revoltShareMax - ai.revoltShareMin);
    const pixels = revoltRegion(w, id, share);
    if (pixels.length < ai.revoltMinPixels / 4) return;
    l.lastRevolt = now;
    w.onRevolt(id, pixels);
  });
}

/** One side's strength against another's, with allies (ours at half: they may not come). */
function sides(w: World, id: number, other: number): { ours: number; theirs: number } {
  const ai = w.sim.ai;
  return {
    ours: w.strength(id) + w.allies(id).reduce((t, a) => t + w.strength(a) * ai.allyJoinsAttack, 0),
    theirs: w.strength(other) + w.allies(other).reduce((t, a) => t + w.strength(a), 0),
  };
}

/**
 * The land that breaks away: grown from the far side of the nation (away from its capital)
 * until it's `share` of the nation's pixels.
 */
function revoltRegion(w: World, id: number, share: number): number[] {
  const { map, territory } = w.opts;
  const { width } = map;
  const pixels = territory.holding(id)?.pixels;
  const capital = capitalOf(w, id);
  if (!pixels?.length || capital < 0) return [];
  const cx = capital % width;
  const cy = Math.floor(capital / width);
  const dist = (i: number): number => {
    let dx = Math.abs((i % width) - cx);
    if (map.wraps) dx = Math.min(dx, width - dx);
    const dy = Math.floor(i / width) - cy;
    return dx * dx + dy * dy;
  };
  // The farthest of a few hundred of its pixels.
  let seed = pixels[0];
  for (let k = 0; k < 300; k++) {
    const i = pixels[Math.floor(w.rng.next() * pixels.length)];
    if (dist(i) > dist(seed)) seed = i;
  }
  const want = Math.floor(pixels.length * share);
  const owner = territory.owner;
  const taken = new Set<number>([seed]);
  const out = [seed];
  for (let h = 0; h < out.length && out.length < want; h++) {
    const i = out[h];
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const p = map.normalize(x + dx, y + dy);
      if (!p) continue;
      const j = p[1] * width + p[0];
      if (owner[j] === id && j !== capital && !taken.has(j)) {
        taken.add(j);
        out.push(j);
        if (out.length >= want) break;
      }
    }
  }
  return out;
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
  // The army it wants: bigger at war, while planning one, or when someone threatens it.
  const ai = w.sim.ai;
  const atWar = w.warsOf(id).length > 0;
  const threatened = w.live.some((o) => o.alive && o.plan?.target === id) || w.coalitions.some((c) => c.target === id && c.members.length > 1);
  const boost = Math.max(1, atWar ? ai.armyBoostWar : 1, l.plan ? ai.armyBoostPlan : 1, threatened ? ai.armyBoostThreat : 1);
  const target = s.baseArmy * boost;
  if (s.stats.stability.value < rules.minStability) return;
  // It orders what's missing; the queue raises them a few a month while it can pay (see World.workQueues).
  const queued = l.recruitQueue ?? 0;
  const missing = Math.floor((target - troops) / rules.size) - queued;
  if (missing > 0) l.recruitQueue = queued + Math.min(missing, ai.maxOrder);
}

/** A nation under threat (a war, a plan against it) rethinks its army at once. */
export function aiRecruit(w: World, id: number): void {
  if (w.alive(id) && w.sheets[id - 1]) recruit(w, id);
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
  const pick = targets[0];
  if (!pick || w.live[id - 1].plan) return;
  // Computer nations plan first: they mass troops on the border for a few months (everyone can
  // see it coming), then declare war if it still looks winnable (aiMonthly).
  const ai = w.sim.ai;
  const months = Math.round(ai.planMin + w.rng.next() * (ai.planMax - ai.planMin));
  w.live[id - 1].plan = { target: pick.o, ready: w.absMonth + months };
  w.log("threat", `${w.name(id)} is massing troops on its border with ${w.name(pick.o)}.`, [pick.o, id], capitalOf(w, pick.o));
  recruit(w, id);
  aiRecruit(w, pick.o);
}

/**
 * Coalitions: a nation joins one against a neighbour that grabs too much land (its infamy) or
 * grows far stronger than everyone around it, if it doesn't like that neighbour. Members leave
 * once they've made friends with it; the coalition ends when the target calms down.
 */
function coalitions(w: World, id: number): void {
  const ai = w.sim.ai;
  for (const c of w.coalitions) {
    if (c.members.includes(id) && (w.relation(id, c.target) > ai.coalitionRelation + 30 || w.allied(id, c.target))) c.members = c.members.filter((m) => m !== id);
  }
  // A coalition lasts while its target stays a good deal of a danger (so it doesn't break up and re-form every year).
  w.coalitions = w.coalitions.filter((c) => c.members.length && w.alive(c.target) && dangerous(w, c.target, 0.6));
  if (id === w.mineId) return; // the player chooses their own friends and foes
  if (w.coalitions.some((c) => c.members.includes(id))) return; // one coalition at a time
  for (const t of w.neighbours[id - 1] ?? []) {
    if (!w.alive(t) || t === id || w.allied(id, t) || w.relation(id, t) >= ai.coalitionRelation) continue;
    if (!dangerous(w, t)) continue;
    let c = w.coalitions.find((x) => x.target === t);
    if (c?.members.includes(id)) continue;
    if (!c) w.coalitions.push((c = { target: t, members: [] }));
    c.members.push(id);
    w.shiftRelation(id, t, -10);
    if (c.members.length === 2)
      w.log("coalition", `A coalition against ${w.name(t)} has formed: ${c.members.map((m) => w.name(m)).join(" and ")}.`, [t, ...c.members], capitalOf(w, t));
    else if (c.members.length > 2) w.log("coalition", `${w.name(id)} has joined the coalition against ${w.name(t)}.`, [t, id]);
    return;
  }
}

/** Too much infamy, or far stronger than the nations around it (× `slack`: lower keeps an existing coalition together). */
function dangerous(w: World, t: number, slack = 1): boolean {
  const ai = w.sim.ai;
  if ((w.live[t - 1]?.infamy ?? 0) >= ai.coalitionAt * slack) return true;
  const around = [...(w.neighbours[t - 1] ?? [])].filter((n) => w.alive(n));
  if (around.length < 2) return false;
  const avg = around.reduce((s, n) => s + w.strength(n), 0) / around.length;
  return w.strength(t) > avg * ai.coalitionPower * slack;
}
