// Simple wars (milestone 4): no front lines yet (that's milestone 5). Every month each side's
// armies clash at the border: both lose troops, and the war score moves toward the stronger
// side. When one side is clearly winning (or the war drags on too long) peace is signed:
// white peace, tribute for some years, or border land that really changes owner on the map.
// The numbers are in public/data/eras/<era>-sim.json ("war", "peace").

import type { War, World } from "./world.ts";

export interface PeaceTerms {
  text: string;
}

/** What a peace would give, worked out without signing it (for the Wars panel and for makePeace). */
export interface Terms {
  winner: number;
  loser: number;
  kind: "draw" | "tribute" | "land" | "annex";
  /** Share of the loser's land the winner takes (0..1; 1 = all of it). */
  landShare: number;
  /** About how many km² that is. */
  km: number;
}

/**
 * The terms the current war score gives: below 'tributeAt' a draw; then tribute; from 'landAt'
 * border land, from 'minLandShare' of the loser's land rising to 'maxLandShare' at a score of
 * 100; and a loser under 'annexSize' of the winner's size is taken whole from 'annexAt'.
 */
export function peaceTerms(w: World, war: War): Terms {
  const p = w.sim.peace;
  const attackersWon = war.score >= 0;
  const score = Math.abs(war.score);
  const winner = attackersWon ? war.attackers[0] : war.defenders[0];
  const loser = attackersWon ? war.defenders[0] : war.attackers[0];
  const none: Terms = { winner, loser, kind: "draw", landShare: 0, km: 0 };
  if (!winner || !loser || score < p.tributeAt) return none;
  if (score < p.landAt) return { ...none, kind: "tribute" };
  const { territory } = w.opts;
  const loserKm = territory.holding(loser)?.area ?? 0;
  const winnerKm = territory.holding(winner)?.area ?? 0;
  if (score >= p.annexAt && loserKm <= winnerKm * p.annexSize) return { ...none, kind: "annex", landShare: 1, km: loserKm };
  const t = Math.min(1, (score - p.landAt) / Math.max(1, 100 - p.landAt));
  const share = p.minLandShare + (p.maxLandShare - p.minLandShare) * t;
  return { ...none, kind: "land", landShare: share, km: loserKm * share };
}

/** "you'd take about 12,000 km² (35% of their land)" etc., for the Wars panel. */
export function describeTerms(w: World, t: Terms): string {
  const mine = w.mineId;
  const km = `${Math.round(t.km).toLocaleString("en-US")} km²`;
  const we = t.winner === mine;
  switch (t.kind) {
    case "draw":
      return "a draw: nobody gains anything";
    case "tribute":
      return we ? `${w.name(t.loser)} pays you ${Math.round(w.sim.peace.tributeShare * 100)}% of its income for ${w.sim.peace.tributeYears} years` : `you pay ${w.name(t.winner)} tribute for ${w.sim.peace.tributeYears} years`;
    case "land":
      return we ? `you take about ${km} (${Math.round(t.landShare * 100)}% of ${w.name(t.loser)}'s land)` : `${w.name(t.winner)} takes about ${km} (${Math.round(t.landShare * 100)}% of your land)`;
    case "annex":
      return we ? `you take all of ${w.name(t.loser)} (${km})` : `${w.name(t.winner)} takes all of your land`;
  }
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
    // Peace: when one side is clearly winning, or the war drags on. When the player's nation is
    // the one winning, the player decides when to stop (Offer peace), up to a full win.
    const winnerIsMine = (war.score >= 0 ? war.attackers[0] : war.defenders[0]) === w.mineId && w.mineId > 0;
    const decided = Math.abs(war.score) >= (winnerIsMine ? 100 : peace.winAt) && war.months >= peace.minMonths;
    const tired = war.months >= peace.maxMonths * (winnerIsMine ? 2 : 1);
    // A long war going nowhere may just stop, but not the player's own (they decide).
    const playerIn = [...war.attackers, ...war.defenders].includes(w.mineId);
    const shrug = !playerIn && war.months >= 12 && Math.abs(war.score) < 15 && w.rng.next() < 0.03;
    if (decided || tired || shrug) makePeace(w, war);
  }
}

/** A nation loses `share` of its fighting troops. */
function bleed(w: World, id: number, share: number): void {
  const l = w.live[id - 1];
  for (const d of l.divisions) if (d.training === 0) d.troops *= 1 - share;
}

/** Ends a war on its current score, with terms to match (see peaceTerms). */
export function makePeace(w: World, war: War): PeaceTerms {
  const p = w.sim.peace;
  const terms = peaceTerms(w, war);
  const { winner, loser } = terms;
  let text = `Peace: the ${war.name} ends in a draw.`;
  if (terms.kind !== "draw") {
    let tookLand = false;
    if (terms.kind === "annex") {
      const all = Array.from(w.opts.territory.holding(loser)?.pixels ?? []);
      if (all.length) {
        if (loser === w.mineId) w.landChanged();
        w.opts.territory.transfer(all, winner);
        for (const i of all) w.paint[i] = 0;
        w.markChanged(all);
        tookLand = true;
        text = `Peace: ${w.name(winner)} wins the ${war.name} and takes all of ${w.name(loser)}.`;
      }
    } else if (terms.kind === "land") {
      const loserPixels = w.opts.territory.holding(loser)?.pixels.length ?? 0;
      const count = Math.max(1, Math.round(loserPixels * terms.landShare));
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
  // The winner's allies get a smaller tribute from the loser.
  if (terms.kind !== "draw") {
    const allies = (winner === war.attackers[0] ? war.attackers : war.defenders).filter((id) => id !== winner && w.alive(id));
    const income = Math.max(0, w.sheets[loser - 1]?.stats.income.value ?? 0);
    if (allies.length && w.alive(loser)) {
      for (const a of allies) w.live[loser - 1].tributes.push({ to: a, amount: (income * p.tributeShare) / 2, yearsLeft: p.tributeYears });
      text += ` Its allies (${allies.map((a) => w.name(a)).join(", ")}) get ${Math.round((p.tributeShare / 2) * 100)}% of ${w.name(loser)}'s income for ${p.tributeYears} years.`;
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
  // Where the taking started (the front), to find the loser's next-nearest land.
  const startPixels = [...painted, ...plain];
  if (!startPixels.length) return []; // they don't touch: tribute instead
  const fx = startPixels.length ? startPixels.reduce((s, i) => s + (i % width), 0) / startPixels.length : 0;
  const fy = startPixels.length ? startPixels.reduce((s, i) => s + ((i / width) | 0), 0) / startPixels.length : 0;
  while (taken.length < count) {
    if (hp >= painted.length && hq >= plain.length) {
      // This piece of the loser's land is used up (an island, an exclave): carry on from its
      // land nearest the front (war-goal paint first), so the winner gets the share it won.
      let next = -1;
      let best = Infinity;
      for (const i of holding.pixels) {
        if (seen[i] || owner[i] !== loser) continue;
        let dx = Math.abs((i % width) - fx);
        if (map.wraps) dx = Math.min(dx, width - dx);
        const dy = ((i / width) | 0) - fy;
        const d = dx * dx + dy * dy - (prefer && w.paint[i] === 1 ? 1e9 : 0);
        if (d < best) {
          best = d;
          next = i;
        }
      }
      if (next < 0) break;
      push(next);
    }
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
