// The running world (milestone 4): the clock, and everything that changes month by month —
// money, people, development, buildings, armies, relations, alliances, wars and peace. Plain
// game logic, no drawing: the screens (src/ui/) read it and ask it to do things. All the
// numbers are in public/data/eras/<era>-sim.json (see simData.ts).
//
// Every nation decides for itself once a year (src/sim/ai.ts). The player's nation does too,
// but the player can push it with influence points: build this, recruit, war, peace, relations.
// The nation may still say no, and says why.

import type { GameMap } from "../map/gameMap.ts";
import type { Nation } from "../game/nation.ts";
import type { Territory } from "../game/territory.ts";
import { baseDivisionCount } from "../game/army.ts";
import { mapName } from "../game/labels.ts";
import { compactNumber } from "../game/numbers.ts";
import { createRng, type Rng } from "../game/random.ts";
import { accessShare, statSheet, surveyLand, type LandFacts, type LiveState, type StatSheet, type StatsData } from "../game/stats.ts";
import type { BrushId, BuildingSpec, PushId, SimData } from "./simData.ts";
import { aiMonthly, aiRecruit, aiThink } from "./ai.ts";
import { capitalOf, organizeArmies, type ArmyLive, type Stance } from "./armies.ts";
import { fightWars, makePeace, type PeaceTerms } from "./war.ts";

/** What the world needs to know about a nation on the map (the placement screen's PlacedNation). */
export interface WorldNation {
  nation: Nation;
  color: string;
  mine?: boolean;
}

export interface DivisionLive {
  troops: number;
  /** Months of training left (0 = ready to fight). */
  training: number;
  /** The army it belongs to (see armies.ts); 0 or missing = the reserve at the capital. */
  army?: number;
}

/** A nation's state that changes as time runs. */
export interface NationLive {
  alive: boolean;
  population: number;
  treasury: number;
  development: number;
  /** Building levels by building id. */
  buildings: Record<string, number>;
  /** Under construction: which building, months left, and the pixel it stands on. */
  building: { id: string; monthsLeft: number; at: number }[];
  /** Where finished buildings stand (one per level built), for the map. */
  sites: { id: string; at: number }[];
  divisions: DivisionLive[];
  /** Its armies (see armies.ts); divisions not in one are in the reserve. */
  armies?: ArmyLive[];
  /** The number the next new army gets ("3rd Army"). */
  nextArmy?: number;
  /** How much its neighbours fear it for grabbing land and starting wars (fades over the years). */
  infamy?: number;
  /** A war it's preparing: whom, and the month (World.absMonth) its troops are ready. */
  plan?: { target: number; ready: number };
  /** When it last had a revolt (World.absMonth). */
  lastRevolt?: number;
  /** Tribute this nation pays: to whom, how much a year, for how many more years. */
  tributes: { to: number; amount: number; yearsLeft: number }[];
  /** Divisions ordered but not raised yet (raised a few a month when it has the men and money). */
  recruitQueue?: number;
  /** Buildings ordered but not started yet (started when it can afford them), by building id. */
  buildQueue?: string[];
  /** The month (0–11) it thinks in each year. */
  thinkMonth: number;
}

export interface War {
  id: number;
  name: string;
  attackers: number[];
  defenders: number[];
  /** −100..100; above 0 the attackers are winning. */
  score: number;
  months: number;
  /** Push not yet spent on each front (by "winner-loser"), carried to next month. */
  progress?: Record<string, number>;
}

/** A front where armies fought this month: the two sides, who pushed (0 = nobody), by how much (0..1), and the troops each side lost there. */
export interface Battle {
  a: number;
  d: number;
  winner: number;
  edge: number;
  lostA: number;
  lostD: number;
}

export type EventKind = "war" | "peace" | "build" | "army" | "diplomacy" | "fall" | "info" | "threat" | "coalition" | "revolt";

/** Nations banding together against one that grabs too much or grows too strong. */
export interface Coalition {
  target: number;
  members: number[];
}

export interface GameEvent {
  year: number;
  month: number;
  kind: EventKind;
  text: string;
  /** The nations it's about (for "your nation" filtering and zooming to them). */
  nations: number[];
  /** Where on the map it happened (a pixel), for the ripple there; missing for old events. */
  at?: number;
}

export interface Decision {
  ok: boolean;
  reason: string;
}

export interface TickResult {
  /** Pixels that changed owner this month (peace treaties), to repaint. */
  changedPixels: number[];
  events: GameEvent[];
  newYear: boolean;
  /** Set when the player's nation fell this month. */
  playerFell: boolean;
}

/** Everything about the running world that a save needs (the land itself is saved separately). */
export interface WorldSave {
  year: number;
  month: number;
  influence: number;
  live: NationLive[];
  wars: War[];
  relations: [number, number][];
  relationBase: [number, number][];
  alliances: number[];
  events: GameEvent[];
  nextWarId: number;
  paint: Uint8Array;
  coalitions?: Coalition[];
}

export interface WorldOptions {
  map: GameMap;
  territory: Territory;
  nations: WorldNation[];
  stats: StatsData;
  sim: SimData;
  seed: number;
}

const pairKey = (a: number, b: number): number => (a < b ? a * 65536 + b : b * 65536 + a);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export class World {
  year: number;
  /** 0 = January. */
  month = 0;
  /** The player's influence points. */
  influence: number;
  /** By nation id − 1. */
  live: NationLive[] = [];
  sheets: StatSheet[] = [];
  land: LandFacts[] = [];
  /** Each nation's neighbours (by id − 1), from the land. */
  neighbours: Set<number>[] = [];
  wars: War[] = [];
  /** This month's battles (for the map). */
  battles: Battle[] = [];
  coalitions: Coalition[] = [];
  /**
   * Makes a new nation out of `pixels` of nation `from` (a revolt): rolls it, puts it on the
   * map and returns its id (0 if it can't). Set by the screen that owns the nations
   * (src/ui/placement.ts), which then calls revolt().
   */
  onRevolt?: (from: number, pixels: number[]) => number;
  /** How much two nations like each other (−100..100), and what it drifts back to. */
  relations = new Map<number, number>();
  relationBase = new Map<number, number>();
  alliances = new Set<number>();
  events: GameEvent[] = [];
  /** Who last took land from each nation (by id), for "X has fallen to Y". */
  lastConqueror = new Map<number, number>();
  /** The player's paint: 0 none, 1 war goal, 2 defend, 3 develop (one value per map pixel). */
  paint: Uint8Array;
  rng: Rng;
  private nextWarId = 1;
  private landDirty = true;
  /** Pixels that changed owner since the screen last repainted them. */
  private changed: number[] = [];
  /** Nations whose numbers changed (built, recruited, signed a peace…): worked out again next month. */
  private dirty = new Set<number>();
  /** The player's land changed: look over the land at once rather than in a few months. */
  private landUrgent = false;

  constructor(readonly opts: WorldOptions) {
    this.year = opts.sim.clock.startYear;
    this.influence = opts.sim.influence.start;
    this.paint = new Uint8Array(opts.map.width * opts.map.height);
    this.rng = createRng(opts.seed);
  }

  get sim(): SimData {
    return this.opts.sim;
  }

  get nations(): WorldNation[] {
    return this.opts.nations;
  }

  /** The player's nation id (0 if none). */
  get mineId(): number {
    return this.nations.findIndex((n) => n.mine) + 1;
  }

  /** Months since year 0: for plans and cooldowns. */
  get absMonth(): number {
    return this.year * 12 + this.month;
  }

  /** Adds to a nation's infamy (wars started, land taken). */
  addInfamy(id: number, v: number): void {
    const l = this.live[id - 1];
    if (l && v > 0) l.infamy = (l.infamy ?? 0) + v;
  }

  dateText(): string {
    return `${MONTHS[this.month]} ${this.year}`;
  }

  name(id: number): string {
    const n = this.nations[id - 1];
    return n ? mapName(n.nation.name) : "?";
  }

  alive(id: number): boolean {
    return this.live[id - 1]?.alive ?? false;
  }

  // ---------------------------------------------------------------- stats

  /** Marks the land as changed (a nation was placed, a treaty moved pixels): survey it again next time. */
  landChanged(): void {
    this.landDirty = true;
    this.landUrgent = true;
  }

  /** Pixels that changed owner (peace treaties): the land is surveyed again and the screen repaints them. */
  markChanged(pixels: number[]): void {
    const mine = this.mineId;
    for (const i of pixels) {
      this.changed.push(i);
      if (this.opts.territory.owner[i] === mine) this.landUrgent = true;
    }
    this.landDirty = true;
  }

  /** The pixels that changed owner since the last call (for repainting), and whether any nation fell. */
  takeChanged(): number[] {
    const out = this.changed;
    this.changed = [];
    return out;
  }

  /**
   * Works out every nation's stat sheet from its land and live state. Looks at the whole map
   * only when the land changed; otherwise it's just the numbers (about 20 ms for 900 nations).
   * New nations get their starting live state here.
   */
  recompute(everyone = true): void {
    const { map, territory, stats } = this.opts;
    // The land is looked over again when it changed: at once for a new nation or the player's
    // land, otherwise every third month (treaties happen somewhere almost every month).
    const due = everyone || this.landUrgent || this.month % 3 === 0;
    if ((this.landDirty && due) || this.land.length !== this.nations.length) {
      // A new nation changes everyone's survey; a treaty only the nations in it (they're marked dirty).
      if (this.land.length !== this.nations.length) everyone = true;
      this.landUrgent = false;
      this.land = surveyLand(map, territory.owner, territory.areas, this.nations.length);
      this.neighbours = findNeighbours(map, territory.owner, this.nations.length);
      this.landDirty = false;
    }
    // New nations: start from what their sheet says.
    for (let i = this.live.length; i < this.nations.length; i++) this.live.push(this.startLive(i + 1));
    for (let i = 0; i < this.live.length; i++) if (!this.live[i].armies && this.sheets[i]) organizeArmies(this, i + 1);
    if (this.sheets.length !== this.nations.length) everyone = true;
    const tributeIn = new Map<number, number>();
    for (const l of this.live) for (const t of l.tributes) tributeIn.set(t.to, (tributeIn.get(t.to) ?? 0) + t.amount);
    // Month by month the numbers change slowly, so only a quarter of the nations (in turn) are
    // worked out again, plus the player's, those at war and those that just changed.
    const mine = this.mineId;
    const fighting = new Set<number>();
    if (!everyone) for (const w of this.wars) for (const id of [...w.attackers, ...w.defenders]) fighting.add(id);
    this.nations.forEach((n, i) => {
      const id = i + 1;
      if (!everyone && id % 4 !== this.month % 4 && id !== mine && !fighting.has(id) && !this.dirty.has(id)) return;
      this.sheets[i] = statSheet(n.nation, this.land[i], stats, this.liveState(id, tributeIn.get(id) ?? 0));
    });
    this.dirty.clear();
    this.ensureRelations();
  }

  /** A nation's numbers changed: work its sheet out again next time. */
  touch(id: number): void {
    this.dirty.add(id);
  }

  /** What a nation's stat sheet needs from its live state. */
  private liveState(id: number, tributeIn: number): LiveState {
    const l = this.live[id - 1];
    const mods: LiveState["mods"] = [];
    for (const b of this.sim.buildings) {
      const level = l.buildings[b.id] ?? 0;
      if (level > 0) mods.push({ label: `${b.name} (level ${level})`, set: b.effects, scale: level });
    }
    if (l.treasury < 0) mods.push({ label: "In debt", set: this.sim.growth.debt });
    const paid = l.tributes.reduce((s, t) => s + t.amount, 0);
    return {
      population: l.population,
      army: l.divisions.reduce((s, d) => s + d.troops, 0),
      treasury: l.treasury,
      development: l.development,
      tribute: tributeIn - paid,
      mods,
    };
  }

  private startLive(id: number): NationLive {
    const n = this.nations[id - 1];
    const sheet = statSheet(n.nation, this.land[id - 1], this.opts.stats);
    const rules = this.opts.stats.divisions;
    const divisions: DivisionLive[] = [];
    for (let k = baseDivisionCount(sheet.baseArmy, rules); k > 0; k--) divisions.push({ troops: rules.size, training: 0 });
    return {
      alive: this.land[id - 1].pixels > 0,
      population: sheet.stats.population.value,
      treasury: sheet.stats.treasury.value,
      development: sheet.stats.development.value,
      buildings: {},
      building: [],
      sites: [],
      divisions,
      tributes: [],
      thinkMonth: Math.floor(this.rng.next() * 12),
    };
  }

  /** Starting relations for every pair of neighbours that doesn't have one yet. */
  private ensureRelations(): void {
    const r = this.sim.relations;
    this.neighbours.forEach((set, i) => {
      const a = i + 1;
      for (const b of set) {
        if (b < a) continue;
        const key = pairKey(a, b);
        if (this.relationBase.has(key)) continue;
        const sa = this.sheets[a - 1];
        const sb = this.sheets[b - 1];
        if (!sa || !sb) continue;
        const same = sa.ideologies[0]?.id && sa.ideologies[0]?.id === sb.ideologies[0]?.id;
        const base =
          r.base - r.aggression * (sa.stats.aggression.value + sb.stats.aggression.value) / 2 + (same ? r.sameIdeology : 0) + (this.rng.next() * 2 - 1) * r.random;
        this.relationBase.set(key, base);
        this.relations.set(key, base);
      }
    });
  }

  relation(a: number, b: number): number {
    return this.relations.get(pairKey(a, b)) ?? 0;
  }

  /** Changes how two nations feel about each other; `lasting` also moves where it drifts back to. */
  shiftRelation(a: number, b: number, by: number, lasting = 0): void {
    const key = pairKey(a, b);
    const clamp = (v: number): number => Math.max(-100, Math.min(100, v));
    this.relations.set(key, clamp((this.relations.get(key) ?? 0) + by));
    if (lasting) this.relationBase.set(key, clamp((this.relationBase.get(key) ?? 0) + lasting));
  }

  allied(a: number, b: number): boolean {
    return this.alliances.has(pairKey(a, b));
  }

  allies(id: number): number[] {
    const out: number[] = [];
    for (const key of this.alliances) {
      const a = Math.floor(key / 65536);
      const b = key % 65536;
      if (a === id && this.alive(b)) out.push(b);
      else if (b === id && this.alive(a)) out.push(a);
    }
    return out;
  }

  ally(a: number, b: number): void {
    this.alliances.add(pairKey(a, b));
  }

  breakAlliance(a: number, b: number): void {
    this.alliances.delete(pairKey(a, b));
  }

  warsOf(id: number): War[] {
    return this.wars.filter((w) => w.attackers.includes(id) || w.defenders.includes(id));
  }

  atWar(a: number, b: number): War | undefined {
    return this.wars.find((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)));
  }

  /** Troops ready to fight × army quality ÷ 50. */
  strength(id: number): number {
    const l = this.live[id - 1];
    const s = this.sheets[id - 1];
    if (!l?.alive || !s) return 0;
    let troops = 0;
    for (const d of l.divisions) if (d.training === 0) troops += d.troops;
    return (troops * s.stats.armyQuality.value) / 50;
  }

  // ---------------------------------------------------------------- saving

  serialize(): WorldSave {
    return {
      year: this.year,
      month: this.month,
      influence: this.influence,
      live: this.live,
      wars: this.wars,
      relations: [...this.relations],
      relationBase: [...this.relationBase],
      alliances: [...this.alliances],
      events: this.events.slice(-100),
      nextWarId: this.nextWarId,
      paint: this.paint,
      coalitions: this.coalitions,
    };
  }

  load(s: WorldSave): void {
    this.year = s.year;
    this.month = s.month;
    this.influence = s.influence;
    this.live = s.live;
    this.wars = s.wars;
    this.relations = new Map(s.relations);
    this.relationBase = new Map(s.relationBase);
    this.alliances = new Set(s.alliances);
    this.events = s.events;
    this.nextWarId = s.nextWarId;
    this.paint.set(s.paint);
    this.coalitions = s.coalitions ?? [];
    this.landDirty = true;
    this.recompute();
  }

  // ---------------------------------------------------------------- the clock

  /** One month passes. */
  tick(): TickResult {
    const result: TickResult = { changedPixels: [], events: [], newYear: false, playerFell: false };
    const before = this.events.length;
    this.month++;
    if (this.month === 12) {
      this.month = 0;
      this.year++;
      result.newYear = true;
    }
    const mine = this.mineId;
    const g = this.sim.growth;

    this.live.forEach((l, i) => {
      if (!l.alive) return;
      const id = i + 1;
      const s = this.sheets[i];
      // Money, people and development.
      l.treasury += s.stats.net.value / 12;
      l.population *= (1 + s.stats.growth.value) ** (1 / 12);
      const target = s.factors.development.value;
      const speed = (g.developmentPerYear + g.perSchool * (l.buildings.school ?? 0)) / 12;
      l.development += Math.max(-speed, Math.min(speed, target - l.development));
      // Buildings finish.
      for (const b of l.building) b.monthsLeft--;
      for (const b of l.building.filter((x) => x.monthsLeft <= 0)) {
        l.buildings[b.id] = (l.buildings[b.id] ?? 0) + 1;
        this.dirty.add(id);
        l.sites.push({ id: b.id, at: b.at });
        const spec = this.buildingSpec(b.id);
        if (id === mine) this.log("build", `${this.name(id)} finished a ${spec?.name ?? b.id} (level ${l.buildings[b.id]}).`, [id], b.at);
      }
      l.building = l.building.filter((x) => x.monthsLeft > 0);
      // Divisions train; tiny ones are broken up.
      for (const d of l.divisions) if (d.training > 0) d.training--;
      l.divisions = l.divisions.filter((d) => d.troops >= this.sim.army.disband || d.training > 0);
      // Tribute years run out.
      if (result.newYear) {
        for (const t of l.tributes) t.yearsLeft--;
        l.tributes = l.tributes.filter((t) => t.yearsLeft > 0 && this.alive(t.to));
      }
    });

    // Ordered divisions and buildings.
    this.live.forEach((l, i) => {
      if (l.alive && (l.recruitQueue || l.buildQueue?.length)) this.workQueues(i + 1);
    });

    // The player's influence.
    if (mine && this.alive(mine)) {
      const s = this.sheets[mine - 1];
      const inf = this.sim.influence;
      this.influence = Math.min(inf.max, this.influence + inf.perMonth + inf.perStability * s.stats.stability.value + inf.perPopularity * s.stats.popularity.value);
    }

    // Armies: every nation at war each month (and the player's), the others now and then.
    this.live.forEach((l, i) => {
      const id = i + 1;
      if (l.alive && (id === mine || this.month % 3 === l.thinkMonth % 3 || this.warsOf(id).length)) organizeArmies(this, id);
    });

    // Wars, then peace.
    fightWars(this);
    // Plans come due, coalitions strike, revolts.
    aiMonthly(this);

    // Relations drift back toward where they started; wars sour them.
    const drift = this.sim.relations.drift;
    for (const [key, v] of this.relations) {
      const base = this.relationBase.get(key) ?? 0;
      this.relations.set(key, v + (base - v) * drift);
    }
    for (const w of this.wars) for (const a of w.attackers) for (const d of w.defenders) this.shiftRelation(a, d, this.sim.relations.war);

    // Each nation thinks once a year, in its own month.
    this.live.forEach((l, i) => {
      if (l.alive && l.thinkMonth === this.month) aiThink(this, i + 1);
    });

    // Nations with no land left have fallen.
    result.changedPixels = this.takeChanged();
    if (result.changedPixels.length) this.checkFallen();
    if (mine && !this.alive(mine)) result.playerFell = true;
    this.recompute(false);
    result.events = this.events.slice(before);
    return result;
  }

  /** After land changed hands: nations left with no land have fallen. */
  checkFallen(): void {
    const { territory } = this.opts;
    this.live.forEach((l, i) => {
      if (l.alive && !territory.holding(i + 1)?.pixels.length) this.fall(i + 1);
    });
  }

  /** A nation has no land left: it's gone, with its wars, alliances and debts. */
  fall(id: number): void {
    const l = this.live[id - 1];
    if (!l?.alive) return;
    l.alive = false;
    l.divisions = [];
    l.armies = [];
    l.building = [];
    l.tributes = [];
    for (const w of this.wars) {
      w.attackers = w.attackers.filter((x) => x !== id);
      w.defenders = w.defenders.filter((x) => x !== id);
    }
    this.wars = this.wars.filter((w) => w.attackers.length && w.defenders.length);
    for (const key of [...this.alliances]) if (Math.floor(key / 65536) === id || key % 65536 === id) this.alliances.delete(key);
    const by = this.lastConqueror.get(id);
    const start = this.opts.territory.holding(id)?.start;
    const at = start ? start[1] * this.opts.map.width + start[0] : undefined;
    this.log("fall", by && this.alive(by) ? `${this.name(id)} has fallen to ${this.name(by)}.` : `${this.name(id)} has fallen.`, by ? [id, by] : [id], at);
  }

  log(kind: EventKind, text: string, nations: number[], at?: number): void {
    this.events.push({ year: this.year, month: this.month, kind, text, nations, ...(at !== undefined && at >= 0 ? { at } : {}) });
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  // ---------------------------------------------------------------- building

  buildingSpec(id: string): BuildingSpec | undefined {
    return this.sim.buildings.find((b) => b.id === id);
  }

  /** What the next level of a building costs this nation now. */
  buildCost(id: number, b: BuildingSpec): number {
    const l = this.live[id - 1];
    const level = (l.buildings[b.id] ?? 0) + l.building.filter((x) => x.id === b.id).length;
    return b.costYears * Math.max(0, this.sheets[id - 1].stats.income.value) * (1 + b.costGrowth * level);
  }

  /** Whether nation `id` can start the next level of `b` now ("" = yes, else why not). */
  whyCantBuild(id: number, b: BuildingSpec): string {
    const l = this.live[id - 1];
    switch (this.buildBlock(id, b)) {
      case "max":
        return `${b.name} is already at the top level (${b.maxLevel}).`;
      case "coast":
        return `${b.name} needs a coast.`;
      case "busy":
        return "It's already building two things; it waits for one to finish.";
      case "money":
        return `It can't afford it: it costs ${money(this.buildCost(id, b))} and the treasury has ${money(l.treasury)}.`;
      default:
        return "";
    }
  }

  /** What stops a building now: "max" or "coast" (never), "busy" or "money" (later), or "" (nothing). */
  buildBlock(id: number, b: BuildingSpec, queued = 0): "max" | "coast" | "busy" | "money" | "" {
    const l = this.live[id - 1];
    const level = (l.buildings[b.id] ?? 0) + l.building.filter((x) => x.id === b.id).length + queued;
    if (level >= b.maxLevel) return "max";
    if (b.needs === "coast" && !this.land[id - 1]?.coastPixels) return "coast";
    if (l.building.length >= 2) return "busy";
    if (l.treasury < this.buildCost(id, b)) return "money";
    return "";
  }

  /**
   * Gives these pixels to nation `to` (conquest, a peace), with what's on them: each former owner
   * hands over the same share of its people as of its land, and the buildings standing there
   * (and its treasury, if all its land is taken). Buildings still being built there are lost.
   */
  transferLand(pixels: readonly number[], to: number): void {
    const { territory, map } = this.opts;
    const kmFrom = new Map<number, number>();
    for (const i of pixels) {
      const o = territory.owner[i];
      if (o && o !== to) kmFrom.set(o, (kmFrom.get(o) ?? 0) + territory.areas[(i / map.width) | 0]);
    }
    const before = new Map<number, number>();
    for (const o of kmFrom.keys()) before.set(o, territory.holding(o)?.area ?? 0);
    territory.transfer(pixels, to);
    const taken = new Set(pixels);
    const lt = this.live[to - 1];
    for (const [from, km] of kmFrom) {
      const lf = this.live[from - 1];
      if (!lf || !lt) continue;
      const share = Math.min(1, km / Math.max(1e-9, before.get(from) ?? 0));
      const people = lf.population * share;
      lf.population -= people;
      lt.population += people;
      const keep: NationLive["sites"] = [];
      for (const site of lf.sites) {
        if (!taken.has(site.at)) {
          keep.push(site);
          continue;
        }
        lf.buildings[site.id] = Math.max(0, (lf.buildings[site.id] ?? 0) - 1);
        const spec = this.buildingSpec(site.id);
        if (spec && (lt.buildings[site.id] ?? 0) < spec.maxLevel) {
          lt.buildings[site.id] = (lt.buildings[site.id] ?? 0) + 1;
          lt.sites.push(site);
        }
      }
      lf.sites = keep;
      lf.building = lf.building.filter((b) => !taken.has(b.at));
      // All of it taken: its treasury goes too.
      if (share >= 0.999 && lf.treasury > 0) {
        lt.treasury += lf.treasury;
        lf.treasury = 0;
      }
      this.dirty.add(from);
    }
    this.dirty.add(to);
  }

  /**
   * Works through a nation's queues: raises up to 'queuePerMonth' ordered divisions while it has
   * the men, the money and the calm, and starts ordered buildings when it can afford them.
   */
  private workQueues(id: number): void {
    const l = this.live[id - 1];
    const s = this.sheets[id - 1];
    if (!l?.alive || !s) return;
    const rules = this.opts.stats.divisions;
    if (l.recruitQueue) {
      const cost = rules.size * s.factors.soldierCost.value;
      let army = s.stats.army.value;
      let net = s.stats.net.value;
      for (let n = 0; n < this.sim.army.queuePerMonth && l.recruitQueue > 0; n++) {
        if (this.recruitBlock(id, army, net) !== "") break;
        l.divisions.push({ troops: rules.size, training: this.sim.army.trainingMonths });
        l.recruitQueue--;
        army += rules.size;
        net -= cost;
        this.dirty.add(id);
      }
    }
    while (l.buildQueue?.length) {
      const b = this.buildingSpec(l.buildQueue[0]);
      const block = b ? this.buildBlock(id, b) : "max";
      if (block === "max" || block === "coast") {
        l.buildQueue.shift(); // can never be built: drop it
        continue;
      }
      if (block) break; // busy or short of money: wait
      this.startBuilding(id, b!);
      l.buildQueue.shift();
    }
  }

  /** What stops raising one more division now ("" = nothing), given the army and net income so far. */
  recruitBlock(id: number, army?: number, net?: number): "" | "unstable" | "men" | "money" {
    const s = this.sheets[id - 1];
    const rules = this.opts.stats.divisions;
    const cost = rules.size * s.factors.soldierCost.value;
    if (s.stats.stability.value < rules.minStability) return "unstable";
    if ((army ?? s.stats.army.value) + rules.size > s.stats.manpower.value) return "men";
    if ((net ?? s.stats.net.value) - cost < 0) return "money";
    return "";
  }

  /** The recruiting queue's state in words, for the Army section. */
  queueText(id: number): string {
    const l = this.live[id - 1];
    const waiting = l?.recruitQueue ?? 0;
    if (!waiting) return "";
    const why = { unstable: "the state is too unstable", men: "it has no more men to call up", money: "it can't pay for more soldiers", "": "" }[this.recruitBlock(id)];
    return why
      ? `${waiting} ordered, waiting: ${why}.`
      : `${waiting} ordered: up to ${this.sim.army.queuePerMonth} are raised each month.`;
  }

  /** Starts building the next level of `b` (pays for it now). Assumes whyCantBuild said yes. */
  startBuilding(id: number, b: BuildingSpec): void {
    const l = this.live[id - 1];
    l.treasury -= this.buildCost(id, b);
    l.building.push({ id: b.id, monthsLeft: b.months, at: this.siteFor(id, b) });
    this.dirty.add(id);
  }

  /** Where a new building goes: on the player's "Develop" (or for forts "Defend") paint first, else anywhere on its land. */
  private siteFor(id: number, b: BuildingSpec): number {
    const holding = this.opts.territory.holding(id);
    if (!holding?.pixels.length) return 0;
    if (id === this.mineId) {
      const want = b.id === "fort" ? 2 : 3;
      const painted: number[] = [];
      for (const i of holding.pixels) if (this.paint[i] === want && this.opts.territory.owner[i] === id) painted.push(i);
      if (painted.length) return painted[Math.floor(this.rng.next() * painted.length)];
    }
    return holding.pixels[Math.floor(this.rng.next() * holding.pixels.length)];
  }

  // ---------------------------------------------------------------- the player's pushes

  /** Spends influence on a push, or says why not ("" = paid). */
  private pay(push: PushId): string {
    const cost = this.sim.influence.costs[push];
    if (this.influence < cost) return `Not enough influence: this costs ${cost}, you have ${Math.floor(this.influence)}.`;
    this.influence -= cost;
    return "";
  }

  /** Push your nation to build the next level of a building. */
  pushBuild(buildingId: string): Decision {
    const id = this.mineId;
    const b = this.buildingSpec(buildingId);
    if (!id || !b || !this.alive(id)) return { ok: false, reason: "You have no nation to push." };
    const l = this.live[id - 1];
    const queued = (l.buildQueue ?? []).filter((x) => x === b.id).length;
    const block = this.buildBlock(id, b, queued);
    if (block === "max" || block === "coast") {
      const now = this.buildBlock(id, b);
      const why = now === "max" || now === "coast" ? this.whyCantBuild(id, b) : `${b.name} would pass the top level (${b.maxLevel}), counting the ones in the queue.`;
      return { ok: false, reason: `Refused: ${why.charAt(0).toLowerCase()}${why.slice(1)}` };
    }
    const unpaid = this.pay("build");
    if (unpaid) return { ok: false, reason: unpaid };
    // Can't start yet (short of money, or already building two things): it goes in the queue.
    if (block || l.buildQueue?.length) {
      (l.buildQueue ??= []).push(b.id);
      const why = block === "busy" ? "it's building two things" : block === "money" ? `it needs ${money(this.buildCost(id, b))}` : "others are ahead of it";
      return { ok: true, reason: `Ordered: a ${b.name} is in the queue (number ${l.buildQueue.length}); it starts as soon as it can (now ${why}).` };
    }
    const cost = this.buildCost(id, b);
    this.startBuilding(id, b);
    this.recompute();
    return { ok: true, reason: `Agreed: building a ${b.name} for ${money(cost)}, ready in ${b.months} months.` };
  }

  /**
   * Orders `count` new divisions (influence per division). They go in the queue and are raised a
   * few a month while the nation has the men, the money and the calm.
   */
  orderDivisions(count: number): Decision {
    const id = this.mineId;
    if (!id || !this.alive(id)) return { ok: false, reason: "You have no nation to push." };
    const each = this.sim.influence.costs.recruit;
    const affordable = each > 0 ? Math.floor(this.influence / each) : count;
    const n = Math.min(count, affordable);
    if (n <= 0) return { ok: false, reason: `Not enough influence: each division costs ${each}, you have ${Math.floor(this.influence)}.` };
    this.influence -= n * each;
    const l = this.live[id - 1];
    l.recruitQueue = (l.recruitQueue ?? 0) + n;
    this.workQueues(id);
    this.recompute();
    const short = n < count ? ` (you could pay for ${n} of ${count})` : "";
    return { ok: true, reason: `Ordered ${n} ${n === 1 ? "division" : "divisions"}${short} for ✦${n * each}. ${this.queueText(id) || "All raised: they train for a few months."}` };
  }

  /** Cancels the divisions still waiting in the queue; their influence comes back. */
  clearRecruitQueue(): Decision {
    const id = this.mineId;
    const l = this.live[id - 1];
    const n = l?.recruitQueue ?? 0;
    if (!n) return { ok: false, reason: "Nothing is waiting." };
    l.recruitQueue = 0;
    this.influence = Math.min(this.sim.influence.max, this.influence + n * this.sim.influence.costs.recruit);
    return { ok: true, reason: `Cancelled ${n} waiting divisions; ✦${n * this.sim.influence.costs.recruit} back.` };
  }

  /** Cancels the buildings still waiting; their influence comes back. */
  clearBuildQueue(): Decision {
    const id = this.mineId;
    const l = this.live[id - 1];
    const n = l?.buildQueue?.length ?? 0;
    if (!n) return { ok: false, reason: "Nothing is waiting." };
    l.buildQueue = [];
    this.influence = Math.min(this.sim.influence.max, this.influence + n * this.sim.influence.costs.build);
    return { ok: true, reason: `Cancelled ${n} waiting buildings; ✦${n * this.sim.influence.costs.build} back.` };
  }

  /** You take command of one of your armies: send it to a front (enemy id, 0 = home) and/or set its stance. */
  commandArmy(armyId: number, order: { front?: number; stance?: Stance }): Decision {
    const id = this.mineId;
    const a = this.live[id - 1]?.armies?.find((x) => x.id === armyId);
    if (!a) return { ok: false, reason: "That army is gone." };
    if (order.front !== undefined) a.front = order.front;
    if (order.stance) a.stance = order.stance;
    a.locked = true;
    return { ok: true, reason: `${a.name}: ${a.front ? `to the front with ${this.name(a.front)}` : "at home"}, ${a.stance === "attack" ? "attacking" : a.stance === "hold" ? "holding the line" : "defending"}. You command it now.` };
  }

  /** Hands an army back to your nation, which then decides its front and stance itself. */
  releaseArmy(armyId: number): Decision {
    const id = this.mineId;
    const a = this.live[id - 1]?.armies?.find((x) => x.id === armyId);
    if (!a) return { ok: false, reason: "That army is gone." };
    a.locked = false;
    organizeArmies(this, id);
    return { ok: true, reason: `${a.name} is back under your nation's command.` };
  }

  /** Push better (+1) or worse (−1) relations between your nation and `other`. */
  pushRelations(other: number, dir: 1 | -1): Decision {
    const id = this.mineId;
    if (!id || !this.alive(id) || !this.alive(other) || other === id) return { ok: false, reason: "Pick another nation." };
    const unpaid = this.pay(dir > 0 ? "improveRelations" : "worsenRelations");
    if (unpaid) return { ok: false, reason: unpaid };
    const by = this.sim.relations.push * dir;
    this.shiftRelation(id, other, by, by / 2);
    return { ok: true, reason: `Relations with ${this.name(other)} are now ${Math.round(this.relation(id, other))}.` };
  }

  /** Push your nation to ally with `other`; they decide too. */
  pushAlliance(other: number): Decision {
    const id = this.mineId;
    if (!id || !this.alive(id) || !this.alive(other) || other === id) return { ok: false, reason: "Pick another nation." };
    if (this.allied(id, other)) return { ok: false, reason: `You're already allied with ${this.name(other)}.` };
    if (this.atWar(id, other)) return { ok: false, reason: `You're at war with ${this.name(other)}.` };
    const ai = this.sim.ai;
    if (this.allies(other).length >= ai.maxAllies + 1) return { ok: false, reason: `${this.name(other)} has enough allies.` };
    if (this.relation(id, other) < ai.allianceAt - 10) return { ok: false, reason: `${this.name(other)} doesn't like you enough (relations ${Math.round(this.relation(id, other))}, they want ${ai.allianceAt - 10}).` };
    const unpaid = this.pay("alliance");
    if (unpaid) return { ok: false, reason: unpaid };
    this.ally(id, other);
    this.log("diplomacy", `${this.name(id)} and ${this.name(other)} are now allies.`, [id, other]);
    return { ok: true, reason: `Allied with ${this.name(other)}: you'll defend each other.` };
  }

  /** Push your nation to declare war on `other`. */
  pushWar(other: number): Decision {
    const id = this.mineId;
    if (!id || !this.alive(id) || !this.alive(other) || other === id) return { ok: false, reason: "Pick another nation." };
    if (this.atWar(id, other)) return { ok: false, reason: `You're already at war with ${this.name(other)}.` };
    if (this.allied(id, other)) return { ok: false, reason: `${this.name(other)} is your ally.` };
    const s = this.sheets[id - 1];
    if (s.stats.stability.value < 25) return { ok: false, reason: `Refused: the state is too unstable for a war (stability ${Math.round(s.stats.stability.value)}).` };
    const mySide = this.strength(id) + this.allies(id).reduce((t, a) => t + this.strength(a) * 0.5, 0);
    const theirSide = this.strength(other) + this.allies(other).reduce((t, a) => t + this.strength(a), 0);
    const goal = this.paintedOn(other, 1);
    const nerve = 0.6 - s.stats.aggression.value / 250 - Math.min(0.2, goal / 2000);
    if (mySide < theirSide * nerve) return { ok: false, reason: `Refused: ${this.name(other)} and its allies are much stronger (${Math.round(theirSide)} against your ${Math.round(mySide)}).` };
    const unpaid = this.pay("declareWar");
    if (unpaid) return { ok: false, reason: unpaid };
    this.declareWar(id, other);
    return { ok: true, reason: `War! ${this.name(id)} has declared war on ${this.name(other)}.` };
  }

  /** Offer peace in one of your wars; the other side decides. */
  pushPeace(warId: number): Decision {
    const id = this.mineId;
    const war = this.wars.find((w) => w.id === warId);
    if (!war || !id) return { ok: false, reason: "That war is over." };
    const mineAttacking = war.attackers.includes(id);
    const forThem = mineAttacking ? -war.score : war.score;
    if (forThem > 25) return { ok: false, reason: `They're winning (score ${Math.round(forThem)} for them) and won't stop yet.` };
    const unpaid = this.pay("offerPeace");
    if (unpaid) return { ok: false, reason: unpaid };
    const terms = makePeace(this, war);
    return { ok: true, reason: terms.text };
  }

  /** Starts a war: the defender's allies join it, the attacker's might. */
  declareWar(attacker: number, defender: number, announce = true): War {
    const war: War = { id: this.nextWarId++, name: `${this.name(attacker)}–${this.name(defender)} War`, attackers: [attacker], defenders: [defender], score: 0, months: 0 };
    for (const a of this.allies(defender)) if (!war.attackers.includes(a) && !this.atWar(a, defender)) war.defenders.push(a);
    for (const a of this.allies(attacker))
      if (!war.defenders.includes(a) && !war.attackers.includes(a) && this.rng.next() < this.sim.ai.allyJoinsAttack) war.attackers.push(a);
    // Allies on both sides break their alliance.
    for (const a of war.attackers) for (const d of war.defenders) this.breakAlliance(a, d);
    this.wars.push(war);
    // Both sides send their armies to the new fronts at once, and the defenders call up more.
    for (const id of [...war.attackers, ...war.defenders]) organizeArmies(this, id);
    for (const id of war.defenders) if (id !== this.mineId) aiRecruit(this, id);
    this.addInfamy(attacker, this.sim.ai.infamyPerWar);
    this.live[attacker - 1].plan = undefined;
    if (!announce) return war;
    this.shiftRelation(attacker, defender, -30, -10);
    const joined = [...war.attackers.slice(1), ...war.defenders.slice(1)];
    this.log("war", `${this.name(attacker)} declared war on ${this.name(defender)}${joined.length ? ` (with ${joined.map((n) => this.name(n)).join(", ")})` : ""}.`, [...war.attackers, ...war.defenders], capitalOf(this, defender));
    return war;
  }

  /**
   * A revolt: nation `rebels` (just made, see onRevolt) takes `pixels` of `from` with the people
   * and buildings there, some of its soldiers desert to it, and it fights for its independence.
   */
  revolt(from: number, rebels: number, pixels: number[]): void {
    const lf = this.live[from - 1];
    if (!lf) return;
    const before = this.opts.territory.holding(from)?.pixels.length ?? 1;
    const share = pixels.length / Math.max(1, before);
    this.live[rebels - 1] = {
      alive: true,
      population: 0,
      treasury: 0,
      development: lf.development,
      buildings: {},
      building: [],
      sites: [],
      divisions: [],
      tributes: [],
      thinkMonth: Math.floor(this.rng.next() * 12),
    };
    this.transferLand(pixels, rebels);
    this.markChanged(pixels);
    this.landChanged();
    // Soldiers from there go over to the rebels.
    const lr = this.live[rebels - 1];
    const leave = lf.divisions.filter(() => this.rng.next() < share);
    lf.divisions = lf.divisions.filter((d) => !leave.includes(d));
    for (const d of leave) lr.divisions.push({ troops: d.troops, training: d.training });
    this.recompute(true);
    this.shiftRelation(from, rebels, -60, -40);
    const war = this.declareWar(rebels, from, false);
    war.name = `${this.name(rebels)} War of Independence`;
    const at = capitalOf(this, rebels);
    this.log("revolt", `Revolt in ${this.name(from)}! ${this.name(rebels)} breaks away and fights for its independence.`, [from, rebels], at);
  }

  /** Called by makePeace: logs it and sets relations. */
  peaceSigned(war: War, terms: PeaceTerms): void {
    this.wars = this.wars.filter((w) => w !== war);
    for (const a of war.attackers) for (const d of war.defenders) this.shiftRelation(a, d, this.sim.relations.afterPeace - this.relation(a, d) * 0.5, -10);
    this.log("peace", terms.text, [...war.attackers, ...war.defenders], capitalOf(this, war.defenders[0] ?? war.attackers[0]));
  }

  // ---------------------------------------------------------------- brushes

  /** How many pixels of nation `owner`'s land carry this paint (1 war goal, 2 defend, 3 develop). */
  paintedOn(owner: number, value: number): number {
    const holding = this.opts.territory.holding(owner);
    if (!holding) return 0;
    let n = 0;
    for (const i of holding.pixels) if (this.paint[i] === value && this.opts.territory.owner[i] === owner) n++;
    return n;
  }

  /**
   * Paints a round dab of `brush` (or erases with null) at (cx, cy). War goals go on other
   * nations' land, Defend and Develop on your own. Costs influence per pixel; stops when it runs
   * out. Returns the pixels that changed.
   */
  paintAt(brush: BrushId | null, cx: number, cy: number, radius: number): number[] {
    const { map, territory } = this.opts;
    const mine = this.mineId;
    if (!mine) return [];
    const value = brush === "warGoal" ? 1 : brush === "defend" ? 2 : brush === "develop" ? 3 : 0;
    const costs = this.sim.brushes.cost;
    const costOf = (v: number): number => (v === 1 ? costs.warGoal : v === 2 ? costs.defend : v === 3 ? costs.develop : 0);
    const changed: number[] = [];
    const r2 = radius * radius + radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const p = map.normalize(cx + dx, cy + dy);
        if (!p) continue;
        const i = p[1] * map.width + p[0];
        const owner = territory.owner[i];
        if (!owner) continue;
        const old = this.paint[i];
        if (value === 0) {
          if (!old) continue;
          this.influence += costOf(old) * this.sim.brushes.eraseRefund;
          this.paint[i] = 0;
          changed.push(i);
          continue;
        }
        if (old === value) continue;
        if (value === 1 ? owner === mine : owner !== mine) continue;
        const cost = costOf(value);
        if (this.influence < cost) return changed;
        this.influence -= cost;
        this.paint[i] = value;
        changed.push(i);
      }
    }
    return changed;
  }
}

/** Every nation's neighbours (land touching, side by side, across the map's seam too). */
export function findNeighbours(map: GameMap, owner: Uint16Array, count: number): Set<number>[] {
  const { width, height } = map;
  const sets = Array.from({ length: count }, () => new Set<number>());
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = owner[y * width + x];
      if (!a || a > count) continue;
      const right = x + 1 < width ? owner[y * width + x + 1] : map.wraps ? owner[y * width] : 0;
      const down = y + 1 < height ? owner[(y + 1) * width + x] : 0;
      for (const b of [right, down]) {
        if (b && b !== a && b <= count) {
          sets[a - 1].add(b);
          sets[b - 1].add(a);
        }
      }
    }
  }
  return sets;
}

export function money(v: number): string {
  return (v < 0 ? "−$" : "$") + compactNumber(Math.abs(Math.round(v)), ["K", "M", "B", "T"]);
}

/** Whether nation `id` has a coast (for ports). */
export function hasCoast(land: LandFacts): boolean {
  return accessShare(land.coastPixels, land.pixels) > 0;
}
