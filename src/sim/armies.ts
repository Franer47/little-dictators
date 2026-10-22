// Armies (milestone 5, second version, like Victoria 3's fronts): a nation's divisions are
// grouped into a few armies. Each army is sent to a front (the border with one enemy) or stays
// home, and has a stance: Attack (pushes into the enemy's land), Hold (stands its ground) or
// Defend (digs in: harder to beat, fewer losses, never advances). New divisions wait in the
// Reserve at the capital while they train, then join an army.
//
// Every nation commands its own armies (organizeArmies): it forms them, fills them from the
// reserve, sends them where the enemy is strongest and picks their stance. The player can take
// over any of their own armies (front, stance); a "locked" army is left alone by the nation.
// The numbers are in public/data/eras/<era>-sim.json, "army".

import type { DivisionLive, World } from "./world.ts";

export type Stance = "attack" | "hold" | "defend";

export interface ArmyLive {
  id: number;
  name: string;
  /** The enemy whose border it fights on, or 0 = at home (guards every border a little). */
  front: number;
  stance: Stance;
  /** The player commands it: the nation doesn't change its front or stance. */
  locked: boolean;
}

/** "1st Army", "2nd Army"… */
export function armyName(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s} Army`;
}

/** A group of divisions' fighting strength: ready troops × army quality ÷ 50. */
export function divisionsStrength(w: World, id: number, divisions: readonly DivisionLive[]): number {
  const q = w.sheets[id - 1]?.stats.armyQuality.value ?? 50;
  let troops = 0;
  for (const d of divisions) if (d.training === 0) troops += d.troops;
  return (troops * q) / 50;
}

/** The divisions of army `armyId` (0 = the reserve). */
export function divisionsOf(w: World, id: number, armyId: number): DivisionLive[] {
  return w.live[id - 1]?.divisions.filter((d) => (d.army ?? 0) === armyId) ?? [];
}

/** The enemies a nation fights, each once. */
export function enemiesOf(w: World, id: number): number[] {
  const out = new Set<number>();
  for (const war of w.wars) {
    if (war.attackers.includes(id)) war.defenders.forEach((d) => w.alive(d) && out.add(d));
    else if (war.defenders.includes(id)) war.attackers.forEach((a) => w.alive(a) && out.add(a));
  }
  return [...out];
}

/** How strong `id` is on its front with `enemy`, attacking and defending, by stance. */
export function frontPower(w: World, id: number, enemy: number): { attack: number; defence: number; armies: number } {
  const l = w.live[id - 1];
  const rules = w.sim.army;
  if (!l?.alive) return { attack: 0, defence: 0, armies: 0 };
  const armies = l.armies ?? [];
  const fronts = Math.max(1, enemiesOf(w, id).length);
  let attack = 0;
  let defence = 0;
  let count = 0;
  for (const a of armies) {
    const s = divisionsStrength(w, id, divisionsOf(w, id, a.id));
    if (a.front === enemy) {
      const st = rules.stances[a.stance];
      attack += s * st.attack;
      defence += s * st.defence;
      count++;
    } else if (a.front === 0) {
      // Home armies guard every front a little.
      defence += (s * rules.homeShare) / fronts;
    }
  }
  // Every front has some local militia, even with no army on it.
  const militia = (w.strength(id) * rules.militia) / fronts;
  return { attack, defence: defence + militia, armies: count };
}

/**
 * The nation sorts out its armies (each month while at war, else when something changed):
 * worn-out divisions are merged, trained reserves join the armies, armies are formed or merged
 * so there are a sensible number, and the armies the nation commands go to the fronts where
 * the enemy is strongest, attacking where they can win and digging in where they can't.
 */
export function organizeArmies(w: World, id: number): void {
  const l = w.live[id - 1];
  if (!l?.alive) return;
  const rules = w.sim.army;
  const size = w.opts.stats.divisions.size;
  l.armies ??= [];
  l.nextArmy ??= 1;
  const known = new Set(l.armies.map((a) => a.id));
  for (const d of l.divisions) if (d.army && !known.has(d.army)) d.army = 0;

  // Worn-down divisions in the same army are merged back into full ones.
  for (const a of [0, ...known]) {
    const worn = l.divisions.filter((d) => (d.army ?? 0) === a && d.training === 0 && d.troops < size * 0.9).sort((x, y) => y.troops - x.troops);
    // Pour each one into the fullest that still has room; what's left over fills the next.
    let into = 0;
    for (let k = 1; k < worn.length; k++) {
      const move = Math.min(size - worn[into].troops, worn[k].troops);
      worn[into].troops += move;
      worn[k].troops -= move;
      if (worn[into].troops >= size * 0.999) into = k;
    }
  }
  l.divisions = l.divisions.filter((d) => d.troops >= 1);

  // How many armies: about 'armySize' divisions each, at most 'maxArmies'.
  const total = l.divisions.length;
  const wanted = total ? Math.min(rules.maxArmies, Math.max(1, Math.ceil(total / rules.armySize))) : 0;
  const cap = wanted ? Math.ceil(total / wanted) : rules.armySize;
  const count = (a: ArmyLive): number => l.divisions.filter((d) => d.army === a.id).length;
  // Empty armies the nation commands are disbanded.
  l.armies = l.armies.filter((a) => a.locked || count(a) > 0 || l.armies!.length <= wanted);
  while (l.armies.length < wanted) {
    const n = l.nextArmy++;
    l.armies.push({ id: n, name: armyName(n), front: 0, stance: "attack", locked: false });
  }
  // Too many (after losses): the smallest unlocked one joins the others.
  while (l.armies.length > wanted && l.armies.length > 1) {
    const spare: ArmyLive[] = l.armies.filter((a) => !a.locked).sort((a, b) => count(a) - count(b));
    if (!spare.length) break;
    const gone: ArmyLive = spare[0];
    l.armies = l.armies.filter((a: ArmyLive) => a !== gone);
    for (const d of l.divisions) if (d.army === gone.id) d.army = 0;
  }

  // Trained divisions in the reserve join the smallest army.
  if (l.armies.length) {
    for (const d of l.divisions) {
      if ((d.army ?? 0) !== 0 || d.training > 0) continue;
      const target = l.armies.reduce((a, b) => (count(b) < count(a) ? b : a));
      d.army = target.id;
    }
    // Even out the armies the nation commands (one big, one tiny isn't useful).
    for (let guard = 0; guard < 50; guard++) {
      const even: ArmyLive[] = l.armies.filter((a) => !a.locked);
      if (even.length < 2) break;
      even.sort((a, b) => count(b) - count(a));
      const big = even[0];
      const small = even[even.length - 1];
      if (count(big) - count(small) <= 1 || count(big) <= cap) break;
      const d = l.divisions.find((x) => x.army === big.id);
      if (d) d.army = small.id;
    }
  }

  // Fronts: the armies the nation commands go where the enemy is strongest.
  const enemies = enemiesOf(w, id);
  for (const a of l.armies) if (a.front && !enemies.includes(a.front)) a.front = 0;
  const free = l.armies.filter((a) => !a.locked);
  if (!enemies.length) {
    for (const a of free) {
      a.front = 0;
      a.stance = "attack";
    }
    return;
  }
  const threat = enemies.map((e) => ({ e, need: Math.max(1, w.strength(e)), got: 0 }));
  for (const a of l.armies) if (a.locked && a.front) {
    const t = threat.find((x) => x.e === a.front);
    if (t) t.got += divisionsStrength(w, id, divisionsOf(w, id, a.id));
  }
  // Biggest armies first, each to the front that has the least of what it needs.
  const sized = free.map((a) => ({ a, s: divisionsStrength(w, id, divisionsOf(w, id, a.id)) })).sort((x, y) => y.s - x.s);
  for (const { a, s } of sized) {
    threat.sort((x, y) => x.got / x.need - y.got / y.need);
    a.front = threat[0].e;
    threat[0].got += s;
  }
  // Stances: attack where it's stronger, dig in where it's clearly weaker.
  for (const a of free) {
    const mine = frontPower(w, id, a.front).defence + divisionsStrength(w, id, divisionsOf(w, id, a.id));
    const theirs = frontPower(w, a.front, id).attack + frontPower(w, a.front, id).defence * 0.5;
    a.stance = mine >= theirs * rules.attackOdds ? "attack" : mine * 2 < theirs ? "defend" : "hold";
  }
}

/** Where the capital is: the nation's first pixel if it still holds it, else any pixel it holds. */
export function capitalOf(w: World, id: number): number {
  const h = w.opts.territory.holding(id);
  if (!h?.pixels.length) return -1;
  const [x, y] = h.start;
  const i = y * w.opts.map.width + x;
  return w.opts.territory.owner[i] === id ? i : h.pixels[h.pixels.length >> 1];
}
