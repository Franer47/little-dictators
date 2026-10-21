// Simple wars (milestone 4): no front lines yet (that's milestone 5). Every month each side's
// armies clash at the border: both lose troops, and the war score moves toward the stronger
// side. When one side is clearly winning (or the war drags on too long) peace is signed:
// white peace, tribute for some years, or border land that really changes owner on the map.
// The numbers are in public/data/eras/<era>-sim.json ("war", "peace").

import type { War, World } from "./world.ts";

export interface PeaceTerms {
  text: string;
}

const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** One month of every war: battles, losses, war score, and peace where it's due. */
export function fightWars(w: World): void {
  const rules = w.sim.war;
  const peace = w.sim.peace;
  for (const war of [...w.wars]) {
    war.attackers = war.attackers.filter((id) => w.alive(id));
    war.defenders = war.defenders.filter((id) => w.alive(id));
    if (!war.attackers.length || !war.defenders.length) {
      w.wars = w.wars.filter((x) => x !== war);
      continue;
    }
    war.months++;
    const side = (ids: number[], defending: boolean): number =>
      ids.reduce((t, id) => t + w.strength(id) * (defending ? 1 + (w.sheets[id - 1]?.stats.defence.value ?? 0) / 100 : 1), 0);
    const sa = side(war.attackers, false);
    const sd = side(war.defenders, true);
    if (sa + sd > 0) {
      const share = sa / (sa + sd);
      war.score = Math.max(-100, Math.min(100, war.score + (share - 0.5) * 2 * rules.scorePerMonth));
      // Losses: more against a stronger enemy.
      const lossA = Math.min(rules.maxLosses, rules.losses * Math.sqrt(sd / Math.max(1, sa)));
      const lossD = Math.min(rules.maxLosses, rules.losses * Math.sqrt(sa / Math.max(1, sd)));
      for (const id of war.attackers) bleed(w, id, lossA);
      for (const id of war.defenders) bleed(w, id, lossD);
    }
    // Peace: when one side is clearly winning, or the war drags on.
    const decided = Math.abs(war.score) >= peace.winAt && war.months >= peace.minMonths;
    const tired = war.months >= peace.maxMonths;
    const shrug = war.months >= 12 && Math.abs(war.score) < 15 && w.rng.next() < 0.03;
    if (decided || tired || shrug) makePeace(w, war);
  }
}

/** A nation loses `share` of its fighting troops. */
function bleed(w: World, id: number, share: number): void {
  const l = w.live[id - 1];
  for (const d of l.divisions) if (d.training === 0) d.troops *= 1 - share;
}

/** Ends a war on its current score, with terms to match. */
export function makePeace(w: World, war: War): PeaceTerms {
  const p = w.sim.peace;
  const attackersWon = war.score >= 0;
  const score = Math.abs(war.score);
  const winner = attackersWon ? war.attackers[0] : war.defenders[0];
  const loser = attackersWon ? war.defenders[0] : war.attackers[0];
  let text = `Peace: the ${war.name} ends in a draw.`;
  if (winner && loser && score >= p.tributeAt) {
    let tookLand = false;
    if (score >= p.landAt) {
      const loserPixels = w.opts.territory.holding(loser)?.pixels.length ?? 0;
      const count = Math.max(1, Math.round(loserPixels * p.landShare * (score / 100)));
      const pixels = takeBorderLand(w, loser, winner, count);
      if (pixels.length) {
        tookLand = true;
        const km = pixels.reduce((s, i) => s + w.opts.territory.areas[(i / w.opts.map.width) | 0], 0);
        text = `Peace: ${w.name(winner)} wins the ${war.name} and takes ${Math.round(km).toLocaleString("en-US")} km² from ${w.name(loser)}.`;
      }
    }
    if (!tookLand) {
      const income = Math.max(0, w.sheets[loser - 1]?.stats.income.value ?? 0);
      const amount = income * p.tributeShare;
      w.live[loser - 1].tributes.push({ to: winner, amount, yearsLeft: p.tributeYears });
      text = `Peace: ${w.name(winner)} wins the ${war.name}; ${w.name(loser)} pays it ${Math.round(p.tributeShare * 100)}% of its income for ${p.tributeYears} years.`;
    }
  }
  for (const id of [...war.attackers, ...war.defenders]) w.touch(id);
  w.peaceSigned(war, { text });
  return { text };
}

/**
 * Up to `count` of the loser's pixels next to the winner's land, spreading inward from the
 * border. The player's war-goal paint is taken first. Returns the pixels that changed owner.
 */
function takeBorderLand(w: World, loser: number, winner: number, count: number): number[] {
  const { map, territory } = w.opts;
  const { width, height } = map;
  const owner = territory.owner;
  const prefer = winner === w.mineId;
  const seen = new Uint8Array(width * height);
  const painted: number[] = [];
  const plain: number[] = [];
  const push = (i: number): void => {
    if (seen[i]) return;
    seen[i] = 1;
    (prefer && w.paint[i] === 1 ? painted : plain).push(i);
  };
  const holding = territory.holding(loser);
  if (!holding) return [];
  // Start from the loser's pixels that touch the winner.
  for (const i of holding.pixels) {
    if (owner[i] !== loser) continue;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of SIDES) {
      const p = map.normalize(x + dx, y + dy);
      if (p && owner[p[1] * width + p[0]] === winner) {
        push(i);
        break;
      }
    }
  }
  const taken: number[] = [];
  let hp = 0;
  let hq = 0;
  while (taken.length < count && (hp < painted.length || hq < plain.length)) {
    const i = hp < painted.length ? painted[hp++] : plain[hq++];
    taken.push(i);
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of SIDES) {
      const p = map.normalize(x + dx, y + dy);
      if (!p) continue;
      const j = p[1] * width + p[0];
      if (owner[j] === loser && j < height * width) push(j);
    }
  }
  if (!taken.length) return [];
  if (loser === w.mineId) w.landChanged();
  territory.transfer(taken, winner);
  // Paint on land that changed hands no longer applies.
  for (const i of taken) w.paint[i] = 0;
  w.markChanged(taken);
  return taken;
}
