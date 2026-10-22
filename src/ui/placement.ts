// Putting nations on the map (milestone 2d, the Europe test): after the wheel, click a spot
// in Europe (or "Surprise me") and the nation's land grows from there. Then "Next nation"
// goes back to the wheel. "Fill Europe" (for testing) rolls and places nations instantly
// until Europe is full (see "fill" in public/data/placement.json); "Clear" empties the map.
//
// The rules for how land grows are in src/game/territory.ts; this file is the screens and
// buttons around them.

import "./placement.css";
import type { GameMap } from "../map/gameMap.ts";
import { Terrain } from "../map/terrain.ts";
import type { Camera } from "../render/camera.ts";
import { tweenCamera, type CameraTween } from "../render/cameraTween.ts";
import type { MapRenderer } from "../render/mapRenderer.ts";
import { TerritoryLayer, hexToRgb } from "../render/territoryLayer.ts";
import type { CameraControls } from "../input/cameraControls.ts";
import type { Nation } from "../game/nation.ts";
import { rollNation } from "../game/roller.ts";
import { createRng, randomSeed, type Rng } from "../game/random.ts";
import { Region, Territory, type Holding, type PlacementData, type Survey } from "../game/territory.ts";
import type { WheelData } from "../game/wheels.ts";
import type { StatSheet, StatsData } from "../game/stats.ts";
import type { LandRoom } from "../game/room.ts";
import { runWheelScreen } from "./wheel/wheelScreen.ts";
import { closeNationPanel, landText, showNationPanel, updateNationPanelStats } from "./nationPanel.ts";
import { initNationBar, setNationBarHidden, showNationBar } from "./nationBar.ts";
import { showArmyPanel } from "./armyPanel.ts";
import { findBorders, sortAround, type Borders } from "../game/army.ts";
import { capitalOf, divisionsOf, enemiesOf } from "../sim/armies.ts";
import { findFronts, middleOf } from "../sim/fronts.ts";
import { EffectsLayer, type BattleMark, type RippleKind } from "../render/effectsLayer.ts";
import { WorldLayer } from "../render/worldLayer.ts";
import { World, type TickResult } from "../sim/world.ts";
import type { SimData } from "../sim/simData.ts";
import { saveGame, type GameSave } from "../sim/save.ts";
import { GameUi } from "./gameUi.ts";
import { PaintLayer } from "../render/paintLayer.ts";
import { labelSpots, mapName } from "../game/labels.ts";
import { ArmyLayer, type ArmyToken } from "../render/armyLayer.ts";
import { LabelLayer } from "../render/labelLayer.ts";
import { escapeHtml } from "./uiBits.ts";
import { loadPref, savePref } from "./prefs.ts";

/** A nation on the map. */
export interface PlacedNation {
  nation: Nation;
  color: string;
  holding: Holding;
  /** The player's own nation: the first one made on the wheel (Fill's nations never are). */
  mine?: boolean;
}

type Pending = Omit<PlacedNation, "holding">;

export interface PlacementOptions {
  map: GameMap;
  mapName: string;
  camera: Camera;
  renderer: MapRenderer;
  controls: CameraControls;
  requestRender: () => void;
  wheels: WheelData;
  data: PlacementData;
  /** The stat sheet rules (public/data/eras/<era>-stats.json). */
  stats: StatsData;
  /** How the world runs once the clock starts (public/data/eras/<era>-sim.json). */
  sim: SimData;
  /** Fixed seed from the address (?seed=123): the same seed and clicks give the same map. */
  seed?: number;
  /** ?wheel=skip: roll each nation instantly instead of showing the wheel. */
  skipWheel: boolean;
  reducedMotion: boolean;
}

type State = "placing" | "growing" | "idle" | "wheel" | "filling";

export class Placement {
  readonly territory: Territory;
  readonly region: Region;
  readonly nations: PlacedNation[] = [];
  /** The running world: the clock, money, armies, wars (src/sim/world.ts). */
  world: World;
  /** The game's screens: clock, left menu, panels, news (src/ui/gameUi.ts). */
  readonly ui: GameUi;
  /** How long the last stats update took (ms), for the dev checks. */
  statsMs = 0;
  /** Army tokens on the map: yours, your enemies' and the nation whose Army section is open (or everyone's). */
  private armyLayer = new ArmyLayer();
  /** Glowing conquests, battles, ripples (src/render/effectsLayer.ts). */
  private effects = new EffectsLayer();
  /** Where each front's battle is (map pixel), by "a-d", from the last time the fronts were worked out. */
  private battleAt = new Map<string, number>();
  /** Show every nation's armies, not just yours and your enemies'. */
  private showAllArmies = false;
  private labelLayer = new LabelLayer();
  private paintLayer: PaintLayer;
  /** Buildings on the map (under the flags) and war swords (over them). */
  private worldLayer: WorldLayer;
  private warLayer: WorldLayer;
  private worldSeed: number;
  /** Where flags can stand (worked out again only when the land or the Defend paint changes). */
  private borders: Borders | null = null;
  /** Land changed hands since the names and flag positions were last worked out. */
  private mapDirty = false;
  /** Conquered pixels being drawn a few at a time through the month (one list per conqueror). */
  private creep: { owner: number; pixels: number[]; done: number; start: number; ms: number }[] = [];
  /** The nation whose Army section is open (0 = closed), its selected army and the last answer. */
  private army: { nation: number; selected: number | null; message: { ok: boolean; text: string } | null } = { nation: 0, selected: null, message: null };
  private layer: TerritoryLayer;
  private state: State = "wheel";
  /** The nation waiting to be placed. */
  private pending: Pending | null = null;
  /** The nation open in the corner panel. */
  private shownId = 0;
  private rng: Rng;
  /** How many nations have been made, for their seeds. */
  private made = 1;
  private growth: { holding: Holding; startedAt: number; ms: number; done: number } | null = null;
  private cameraMove: CameraTween | null = null;
  private note = "";
  /** While filling: how much of the region is taken (%). */
  private fillProgress = 0;
  /** The nation list shows everything (true) or just the top 3 and yours (remembered). */
  private listOpen = loadPref<boolean>("nationListOpen", false);

  private bar = document.createElement("div");
  private list = document.createElement("aside");

  constructor(private opts: PlacementOptions) {
    const { map, data } = opts;
    this.territory = new Territory(map, data.growth);
    this.region = new Region(map, data.regions[data.region], (t) => this.territory.claimableTerrain(t) && t !== Terrain.River);
    this.layer = new TerritoryLayer(map, this.territory);
    opts.renderer.territory = this.layer;
    this.armyLayer.colorOf = (id) => this.nations[id - 1]?.color ?? "#888";
    this.armyLayer.requestRender = opts.requestRender;
    this.effects.requestRender = opts.requestRender;
    this.rng = createRng(opts.seed ?? randomSeed());
    this.worldSeed = opts.seed ?? randomSeed();
    this.world = this.newWorld();
    this.paintLayer = new PaintLayer(map, this.world.paint);
    this.worldLayer = new WorldLayer(opts.requestRender, "buildings");
    this.warLayer = new WorldLayer(opts.requestRender, "wars");
    opts.renderer.overlays.push(this.paintLayer, this.labelLayer, this.worldLayer, this.armyLayer, this.effects, this.warLayer);
    this.build();
    const mine = (): PlacedNation | undefined => this.nations.find((n) => n.mine);
    initNationBar({
      open: () => {
        const m = mine();
        if (m && (this.state === "idle" || this.state === "growing")) this.showNation(m.holding.id);
      },
      speed: (i) => this.ui.setSpeed(i),
    });
    this.ui = new GameUi({
      world: () => this.world,
      canRun: () => (this.state === "idle" || this.state === "growing") && this.nations.some((n) => n.mine),
      afterTick: (r) => this.afterTick(r),
      afterPush: () => this.afterPush(),
      paintChanged: (px) => {
        this.paintLayer.update(px);
        // Defend paint moves your flags; the borders are worked out again when it changed.
        if (px.some((i) => this.territory.owner[i] === this.world.mineId)) this.borders = null;
        this.refreshDivisions();
        this.updateNationBar();
        this.opts.requestRender();
      },
      showNation: (id) => this.showNation(id),
      openArmy: (id) => this.openArmy(id),
      focusNation: (id) => this.focusNation(id),
      pixelUnder: (sx, sy) => {
        const [mx, my] = this.opts.camera.screenToMap(sx, sy);
        return this.opts.map.normalize(Math.floor(mx), Math.floor(my));
      },
      ownerAt: (x, y) => this.territory.ownerAt(x, y),
      colorOf: (id) => this.nations[id - 1]?.color ?? "#888",
      setCursor: (c) => {
        this.opts.renderer.cursor = c;
        this.opts.requestRender();
      },
      setPaintHandler: (fn) => (this.opts.controls.paint = fn),
      adopt: (id) => this.adopt(id),
      save: () => void this.save(),
      requestRender: () => this.opts.requestRender(),
    });
  }

  private newWorld(): World {
    const w = new World({ map: this.opts.map, territory: this.territory, nations: this.nations, stats: this.opts.stats, sim: this.opts.sim, seed: this.worldSeed });
    w.onRevolt = (from, pixels) => this.revolt(from, pixels);
    return w;
  }

  /**
   * A revolt: a new nation is rolled (one whose government differs from the old regime's, if a
   * few tries find one) and takes `pixels` of nation `from`. Returns its id (0 if it can't).
   */
  private revolt(from: number, pixels: number[]): number {
    const old = this.nations[from - 1]?.nation;
    if (!old || !pixels.length) return 0;
    let nation = rollNation(this.opts.wheels, this.opts.mapName, createRng(this.nextSeed()));
    for (let k = 0; k < 4; k++) {
      const differs = nation.results.government?.sliceId !== old.results.government?.sliceId && nation.results.ideology?.sliceId !== old.results.ideology?.sliceId;
      if (differs) break;
      nation = rollNation(this.opts.wheels, this.opts.mapName, createRng(this.nextSeed()));
    }
    let holding;
    try {
      holding = this.territory.addHolding(pixels[0]);
    } catch {
      return 0;
    }
    const placed: PlacedNation = { nation, color: "", holding };
    this.nations.push(placed);
    // Its colour: unlike the nation it breaks from and that nation's neighbours.
    const avoid = new Set<string>([this.nations[from - 1].color]);
    for (const n of this.territory.neighbours(from)) {
      const c = this.nations[n - 1]?.color;
      if (c) avoid.add(c);
    }
    placed.color = this.bestColor(avoid);
    this.layer.setColor(holding.id, placed.color);
    this.world.revolt(from, holding.id, pixels);
    holding.rolledArea = holding.targetArea = holding.area;
    this.updateList();
    return holding.id;
  }

  /** Every placed nation's stat sheet (by id - 1), from the running world. */
  get sheets(): StatSheet[] {
    return this.world.sheets;
  }

  /** The first colour not in use yet (the first nation's colour is picked before the map exists). */
  static firstColor(data: PlacementData): string {
    return data.colors.list[0];
  }

  private get regionName(): string {
    return this.opts.data.regions[this.opts.data.region].name;
  }

  // ---------------------------------------------------------------- the flow

  /** A new nation from the wheel: fly to the region and ask where it goes. */
  begin(nation: Nation, color: string): void {
    const mine = !this.nations.some((n) => n.mine);
    this.pending = { nation, color, mine };
    this.state = "placing";
    this.note = "";
    this.setUiHidden(false);
    this.opts.controls.enabled = true;
    this.showPanel(null);
    this.focusRegion();
    this.update();
  }

  /** The map was clicked on pixel (x, y), at (sx, sy) on screen (CSS pixels). */
  click(x: number, y: number, sx = -1, sy = -1): void {
    if (this.state === "placing") {
      const why = this.whyNot(x, y);
      if (why) {
        this.note = why;
        this.update();
      } else this.place(x, y, "animate");
      return;
    }
    if (this.state === "idle" || this.state === "growing") {
      // An army first: it opens that nation's Army section with the army picked.
      const flag = this.armyLayer.hit(sx, sy);
      if (flag) {
        this.showNation(flag.nation);
        this.openArmy(flag.nation, flag.army);
        return;
      }
      const id = this.territory.ownerAt(x, y);
      if (this.ui.click(id)) return;
      if (id) this.showNation(id);
    }
  }

  /** A right-click on the map (CSS pixels): the diplomacy menu. */
  rightClick(sx: number, sy: number): void {
    if (this.state === "idle" || this.state === "growing") this.ui.rightClick(sx, sy);
  }

  /** The mouse is over pixel (x, y) (or off the map): update the placement cursor. */
  hover(p: [number, number] | null): void {
    const { renderer } = this.opts;
    if (this.state !== "placing" || !p || !this.pending) {
      renderer.preview = null;
      this.ui.hover(p);
      return;
    }
    const [x, y] = p;
    // About the size it will grow to, as a circle.
    const radius = Math.sqrt(this.territory.targetFor(rolledArea(this.pending.nation), y) / this.territory.areas[y] / Math.PI);
    renderer.preview = { radius, color: this.pending.color, valid: !this.whyNot(x, y) };
  }

  /** Who owns pixel (x, y), for the hover info. */
  ownerName(x: number, y: number): string | null {
    const id = this.territory.ownerAt(x, y);
    return id ? (this.nations[id - 1]?.nation.name ?? null) : null;
  }

  /** Why a nation can't start at (x, y), or "" if it can. */
  private whyNot(x: number, y: number): string {
    const owner = this.ownerName(x, y);
    if (owner) return `That land belongs to ${owner}.`;
    const t = this.opts.map.terrainAt(x, y);
    if (t === Terrain.Ice) return "Nobody can live on the ice.";
    if (!this.territory.claimableTerrain(t) || t === Terrain.River) return "Pick land, not water.";
    if (!this.region.contains(x, y)) return `Nations can only start in ${this.regionName}.`;
    return "";
  }

  private surprise(): void {
    if (this.state !== "placing" || !this.pending) return;
    const spot = this.territory.freeSpot(this.region, this.rng, rolledArea(this.pending.nation), this.opts.data.start);
    if (!spot) {
      this.note = `There's no free land left in ${this.regionName}.`;
      this.update();
      return;
    }
    this.place(spot[0], spot[1], "animate");
  }

  /**
   * Places the waiting nation at (x, y) and grows its land: "animate" plays the growth,
   * "instant" shows it at once, "fill" is for Fill (no screen updates; a nation without a
   * colour gets one that stands out from its actual neighbours).
   */
  private place(x: number, y: number, how: "animate" | "instant" | "fill"): PlacedNation | null {
    const pending = this.pending;
    if (!pending) return null;
    const holding = this.territory.place(x, y, rolledArea(pending.nation), growthSeed(pending.nation, this.nations.length + 1));
    const placed: PlacedNation = { ...pending, holding };
    if (!placed.color) placed.color = this.colorFor(holding.id);
    this.nations.push(placed);
    this.pending = null;
    this.layer.setColor(holding.id, placed.color);
    this.note = "";
    this.opts.renderer.preview = null;
    if (how === "fill") {
      this.layer.reveal(holding.pixels);
      return placed;
    }
    this.refreshStats();
    if (how === "animate" && !this.opts.reducedMotion) {
      this.state = "growing";
      // Longer for bigger nations, but never more than about two seconds.
      const ms = Math.min(2000, 700 + holding.pixels.length * 0.8);
      this.growth = { holding, startedAt: performance.now(), ms, done: 0 };
      this.showNation(holding.id);
      requestAnimationFrame(this.animate);
    } else {
      this.layer.reveal(holding.pixels);
      this.state = "idle";
      this.showNation(holding.id);
    }
    this.update();
    this.opts.requestRender();
    return placed;
  }

  private animate = (now: number): void => {
    const g = this.growth;
    if (!g) return;
    const t = Math.min(1, (now - g.startedAt) / g.ms);
    const eased = 1 - (1 - t) ** 2.2;
    const upTo = t >= 1 ? g.holding.pixels.length : Math.floor(eased * g.holding.pixels.length);
    if (upTo > g.done) {
      this.layer.reveal(g.holding.pixels, g.done, upTo);
      g.done = upTo;
      this.opts.requestRender();
    }
    if (t < 1) requestAnimationFrame(this.animate);
    else this.finishGrowth();
  };

  /** Ends the growth animation (at once, if it's still playing). */
  private finishGrowth(): void {
    const g = this.growth;
    if (!g) return;
    if (g.done < g.holding.pixels.length) this.layer.reveal(g.holding.pixels, g.done);
    this.growth = null;
    this.state = "idle";
    this.update();
    this.opts.requestRender();
  }

  /** Back to the wheel for another nation. */
  private async next(): Promise<void> {
    if (this.state !== "idle") return;
    this.state = "wheel";
    const color = this.pickColor();
    const seed = this.nextSeed();
    let nation: Nation;
    if (this.opts.skipWheel) {
      nation = rollNation(this.opts.wheels, this.opts.mapName, createRng(seed), this.room());
    } else {
      this.opts.controls.enabled = false;
      this.opts.renderer.hovered = null;
      this.setUiHidden(true);
      nation = await runWheelScreen({ data: this.opts.wheels, mapName: this.opts.mapName, mapReady: Promise.resolve(), seed, color, room: this.room() });
    }
    this.begin(nation, color);
  }

  /**
   * Testing shortcut: rolls and places nations at random spots until `fill.percent` of the
   * region's land is owned. Late nations land in the gaps and end up smaller than rolled.
   */
  private async fill(): Promise<void> {
    if (this.state === "wheel" || this.state === "filling") return;
    this.finishGrowth();
    this.state = "filling";
    this.opts.renderer.preview = null;
    this.update();
    const { percent, minArea, maxNations, maxAttempts, absorbSteps, batchArea, smallestRoll } = this.opts.data.fill;
    const spotRules = { ...this.opts.data.start, minArea };
    const started = performance.now();
    let full = false;
    let lastId = 0;
    // Looking over the free land is the slow part on a big map, so one look (a survey) is used
    // for a batch of nations: about one per `batchArea` km² of free land (fewer as it fills),
    // keeping each batch's nations apart. A failed spot with an old survey just takes a new one.
    let survey: Survey | null = null;
    let fresh = false;
    let batchLeft = 0;
    const batch: Holding[] = [];
    const resurvey = (): void => {
      survey = this.territory.survey(this.region, spotRules);
      fresh = true;
      batchLeft = Math.max(1, Math.min(40, Math.round(survey.room.left / batchArea)));
      batch.length = 0;
    };
    const placeAnywhere = (pending: Pending): boolean => {
      if (!survey || batchLeft <= 0) resurvey();
      const spot = this.territory.spotFrom(survey!, this.rng, rolledArea(pending.nation), spotRules, batch);
      if (!spot) {
        if (fresh) full = true;
        else batchLeft = 0;
        return false;
      }
      this.pending = pending;
      const placed = this.place(spot[0], spot[1], "fill")!;
      lastId = placed.holding.id;
      batch.push(placed.holding);
      batchLeft--;
      fresh = false;
      return true;
    };
    // The nation waiting to be placed goes first (it keeps the colour on its card).
    const first = this.pending;
    if (first) while (!placeAnywhere(first) && !full);
    // Every placement takes at least one free pixel, so this always ends; the caps keep it short.
    // It works in short bursts and lets the page draw in between, so you can watch the map fill.
    let burst = performance.now();
    for (let tries = 0; !full && tries < maxAttempts && this.nations.length < maxNations; tries++) {
      if (performance.now() - burst > 40) {
        const last = survey as Survey | null;
        this.fillProgress = Math.round((last ? last.room.taken : 0) * 100);
        this.updateBar();
        this.opts.requestRender();
        await new Promise((resolve) => setTimeout(resolve, 0));
        burst = performance.now();
      }
      if (!survey || batchLeft <= 0) resurvey();
      if (survey!.room.taken * 100 >= percent) break;
      // Pick the spot first, then roll the nation for the free land around it: sizes bigger
      // than the free patch it starts in shrink or go (an island gets an island-sized nation),
      // but wide open land (the middle of Africa, settled late) still gives big nations.
      const start = this.territory.pickStart(survey!, this.rng, spotRules, batch);
      if (start < 0) {
        if (fresh) full = true;
        else batchLeft = 0;
        continue;
      }
      const pocket = this.territory.pocketAt(start);
      // Fill leaves out the smallest land sizes (city-states, tiny lands): on a full world they
      // only make dot-sized nations. Your own wheel still has them.
      const room = { region: this.regionName, left: pocket, taken: 0, biggestGap: pocket, smallest: smallestRoll };
      const pending: Pending = { nation: rollNation(this.opts.wheels, this.opts.mapName, createRng(this.nextSeed()), room), color: "" };
      const target = rolledArea(pending.nation);
      const x = start % this.opts.map.width;
      if (this.territory.roomAt(start, target) >= Math.min(minArea, target)) {
        this.pending = pending;
        const placed = this.place(x, (start - x) / this.opts.map.width, "fill")!;
        lastId = placed.holding.id;
        batch.push(placed.holding);
        batchLeft--;
        fresh = false;
      } else placeAnywhere(pending);
    }
    // The fill ends with the leftovers (the last few % of the land: small gaps, islands, slivers
    // between borders) going to the nearest nations, so the whole region is owned when the game
    // starts, instead of being filled with lots of tiny late nations.
    // Rounds of `absorbSteps` pixels each while that still takes land, then one last pass with
    // no limit for far-off islands (e.g. Jan Mayen), which go to the nearest nation.
    if (absorbSteps > 0) {
      for (let round = 0; round <= 10; round++) {
        const gained = this.territory.absorbLeftovers(this.region, round < 10 ? absorbSteps : 30000);
        for (const [, pixels] of gained) this.layer.reveal(pixels);
        if (!gained.size && round < 10) round = 9; // nothing more nearby: go to the last pass
      }
    }
    if (import.meta.env.DEV) {
      const share = Math.round(this.territory.ownedShare(this.region) * 100);
      console.log(`Fill: ${this.nations.length} nations, ${share}% of ${this.regionName}, in ${Math.round(performance.now() - started)} ms`);
    }
    const filled = performance.now();
    this.refreshStats();
    if (import.meta.env.DEV) console.log(`Stats for ${this.nations.length} nations: ${Math.round(this.statsMs)} ms (fill itself ${Math.round(filled - started)} ms)`);
    this.pending = null;
    this.state = "idle";
    this.note = "";
    if (lastId) this.showNation(lastId);
    this.update();
    this.opts.requestRender();
  }

  private clear(): void {
    if (this.state === "wheel" || this.state === "filling") return;
    this.growth = null;
    this.territory.clear();
    this.layer.clear();
    this.nations.length = 0;
    this.ui.setSpeed(0);
    this.world = this.newWorld();
    this.paintLayer.setPaint(this.world.paint);
    this.armyLayer.tokens = [];
    this.effects.battles = [];
    this.labelLayer.set([]);
    this.openArmy(0);
    showNationBar(null);
    this.shownId = 0;
    this.note = "";
    if (this.pending) {
      this.state = "placing";
      this.showPanel(null);
    } else {
      this.state = "idle";
      closeNationPanel();
    }
    this.update();
    this.opts.requestRender();
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Works out every nation's stat sheet again: one look over the whole map for everyone's land
   * (terrain, coasts, rivers, pieces), then each nation's numbers. Run whenever land changes.
   */
  refreshStats(): void {
    const t0 = performance.now();
    this.world.landChanged();
    this.world.recompute();
    this.statsMs = performance.now() - t0;
    this.refreshMap();
    this.updateNationBar();
    this.ui.renderFeed();
  }

  /** The army flags and the names on the map, after the land or the armies changed. */
  private refreshMap(): void {
    const { map } = this.opts;
    const t0 = performance.now();
    this.refreshDivisions(true);
    const spots = labelSpots(map, this.territory.owner, this.nations.length);
    this.labelLayer.set(this.nations.map((n, i) => ({ text: this.world.alive(i + 1) || !this.world.live[i] ? mapName(n.nation.name) : "", spot: spots[i] })));
    if (import.meta.env.DEV && this.nations.length > 50) console.log(`Armies (${this.armyLayer.tokens.length}) and names: ${Math.round(performance.now() - t0)} ms`);
    this.opts.requestRender();
  }

  /** The army flags (troops change every month; positions follow the land and the Defend paint). */
  private refreshDivisions(bordersChanged = false): void {
    const w = this.world;
    if (bordersChanged || !this.borders || this.borders.lines.length !== this.nations.length)
      this.borders = findBorders(this.opts.map, this.territory.owner, this.nations.length, w.paint);
    // Armies stand on the front they were sent to; the map marks each war there.
    const fronts = findFronts(this.opts.map, this.territory, w);
    this.armyLayer.tokens = this.armyTokens(fronts.byPair);
    this.warLayer.wars = fronts.wars;
    // Battles: where each one is, and a bar for who's winning.
    this.battleAt.clear();
    const battles: BattleMark[] = [];
    const colorOf = (id: number): string => this.nations[id - 1]?.color ?? "#888";
    for (const b of w.battles) {
      const px = [...(fronts.byPair.get(b.a * 65536 + b.d) ?? []), ...(fronts.byPair.get(b.d * 65536 + b.a) ?? [])];
      if (!px.length) continue;
      const at = middleOf(this.opts.map, px);
      this.battleAt.set(`${b.a}-${b.d}`, at);
      const lean = 0.5 + (b.winner === b.a ? b.edge : b.winner === b.d ? -b.edge : 0) / 2;
      battles.push({ x: at % this.opts.map.width, y: Math.floor(at / this.opts.map.width), colorA: colorOf(b.a), colorD: colorOf(b.d), lean, mine: b.a === w.mineId || b.d === w.mineId });
    }
    this.effects.battles = battles;
    // Planned wars: where the planner masses its troops.
    const plans: WorldLayer["plans"] = [];
    w.live.forEach((l, i) => {
      const t = l.alive ? l.plan?.target : 0;
      if (!t) return;
      const px = fronts.byPair.get((i + 1) * 65536 + t);
      if (!px?.length) return;
      const at = middleOf(this.opts.map, px);
      plans.push({ x: at % this.opts.map.width, y: Math.floor(at / this.opts.map.width), color: colorOf(i + 1), mine: t === w.mineId || i + 1 === w.mineId });
    });
    this.warLayer.plans = plans;
    // Buildings where they stand (finished, and being built).
    const width = this.opts.map.width;
    const mine = w.mineId;
    const marks: WorldLayer["buildings"] = [];
    w.live.forEach((l, i) => {
      if (!l.alive) return;
      const id = i + 1;
      const iconOf = (b: string): string => w.buildingSpec(b)?.icon ?? "columns";
      for (const site of l.sites) if (this.territory.owner[site.at] === id) marks.push({ x: site.at % width, y: (site.at / width) | 0, icon: iconOf(site.id), building: false, mine: id === mine });
      for (const b of l.building) marks.push({ x: b.at % width, y: (b.at / width) | 0, icon: iconOf(b.id), building: true, mine: id === mine });
    });
    this.worldLayer.buildings = marks;
    if (this.army.nation) this.renderArmy();
  }

  /**
   * The army tokens to show: each army on its front (spread along it when several share it) or
   * along its border at home, and the reserve at the capital. Only your armies, your enemies'
   * and those of the nation whose Army section is open, unless "every nation's" is on.
   */
  private armyTokens(byPair: Map<number, number[]>): ArmyToken[] {
    const w = this.world;
    const { map } = this.opts;
    const width = map.width;
    const size = this.opts.stats.divisions.size;
    const mine = w.mineId;
    const show = new Set<number>();
    if (this.showAllArmies) w.live.forEach((l, i) => l.alive && show.add(i + 1));
    else {
      if (mine) {
        show.add(mine);
        for (const e of enemiesOf(w, mine)) show.add(e);
      }
      if (this.army.nation) show.add(this.army.nation);
    }
    const out: ArmyToken[] = [];
    const at = (p: number): { x: number; y: number } => ({ x: p % width, y: (p / width) | 0 });
    for (const id of show) {
      const l = w.live[id - 1];
      if (!l?.alive) continue;
      // Armies grouped by where they stand: each front, or home (the border).
      const groups = new Map<number, typeof l.armies>();
      for (const a of l.armies ?? []) {
        if (!divisionsOf(w, id, a.id).length) continue;
        if (!groups.has(a.front)) groups.set(a.front, []);
        groups.get(a.front)!.push(a);
      }
      for (const [front, list] of groups) {
        const border = this.borders?.lines[id - 1];
        const px = front ? byPair.get(id * 65536 + front) : undefined;
        const line = px?.length ? sortAround(Int32Array.from(px), width, map.wraps) : border;
        if (!line?.length || !list) continue;
        list.forEach((a, k) => {
          const divs = divisionsOf(w, id, a.id);
          const troops = divs.reduce((t, d) => t + d.troops, 0);
          out.push({
            nation: id,
            army: a.id,
            name: a.name,
            divisions: divs.length,
            troops,
            training: divs.filter((d) => d.training > 0).length,
            strength: troops / Math.max(1, divs.length * size),
            stance: a.stance,
            front: a.front,
            ...at(line[Math.floor(((k + 0.5) * line.length) / list.length)]),
          });
        });
      }
      const reserve = divisionsOf(w, id, 0);
      const capital = capitalOf(w, id);
      if (reserve.length && capital >= 0) {
        const troops = reserve.reduce((t, d) => t + d.troops, 0);
        out.push({
          nation: id,
          army: 0,
          name: "Reserve",
          divisions: reserve.length,
          troops,
          training: reserve.filter((d) => d.training > 0).length,
          strength: troops / Math.max(1, reserve.length * size),
          stance: "reserve",
          front: 0,
          ...at(capital),
        });
      }
    }
    return out;
  }

  /** After a month passed: repaint land that changed hands, then the numbers and screens. */
  private afterTick(r: TickResult): void {
    if (r.changedPixels.length) {
      this.creepIn(r.changedPixels);
      this.paintLayer.update(r.changedPixels);
      this.mapDirty = true;
    }
    // Names and flag positions follow the land: worked out again every few months (they take a
    // look over the whole map), or at once when your own land changed.
    const mine = this.world.mineId;
    const mineChanged = r.changedPixels.some((i) => this.territory.owner[i] === mine) || r.events.some((e) => e.kind === "peace" && e.nations.includes(mine));
    if (this.mapDirty && (mineChanged || this.world.month % 3 === 0)) {
      this.mapDirty = false;
      this.refreshMap();
      this.updateList();
    } else this.refreshDivisions();
    this.updateNationBar();
    this.refreshShownPanel();
    this.animateMonth(r);
    this.opts.requestRender();
  }

  /** The month's battles flash (sparks, smoke, losses), armies lunge, and events ripple. */
  private animateMonth(r: TickResult): void {
    if (this.opts.reducedMotion) return;
    const w = this.world;
    const width = this.opts.map.width;
    const mine = w.mineId;
    const colorOf = (id: number): string => this.nations[id - 1]?.color ?? "#888";
    for (const b of w.battles) {
      const at = this.battleAt.get(`${b.a}-${b.d}`);
      if (at === undefined) continue;
      const x = at % width;
      const y = Math.floor(at / width);
      const near = [b.a, b.d].some((id) => id === mine || id === this.army.nation);
      this.effects.clash(x, y, [{ amount: b.lostA, color: colorOf(b.a) }, { amount: b.lostD, color: colorOf(b.d) }], near);
      this.armyLayer.lungeAt(b.a, b.d, x, y);
      this.armyLayer.lungeAt(b.d, b.a, x, y);
    }
    const kinds: Partial<Record<string, RippleKind>> = { war: "war", peace: "peace", fall: "fall", build: "build" };
    for (const e of r.events) {
      const kind = kinds[e.kind];
      if (kind && e.at !== undefined) this.effects.ripple(e.at % width, Math.floor(e.at / width), kind);
    }
  }

  /**
   * Draws conquered pixels a few at a time over most of a month (at the current speed), each
   * front at the same pace, so borders creep forward instead of jumping. The game already
   * counts them as conquered; this is only the drawing.
   */
  private creepIn(pixels: number[]): void {
    // Whatever is still creeping from last month is finished first.
    for (const c of this.creep) this.layer.reveal(c.pixels, c.done);
    this.creep = [];
    const speed = this.ui?.speed ?? 0;
    const clock = this.opts.sim.clock;
    // Spread over the whole month, so the border keeps moving instead of jumping.
    const ms = speed ? (clock.msPerMonth / clock.speeds[speed - 1]) * 0.97 : 0;
    if (!ms || this.opts.reducedMotion) {
      this.layer.reveal(pixels);
      return;
    }
    // One list per conqueror, in the order it took them (front first).
    const byOwner = new Map<number, number[]>();
    for (const i of pixels) {
      const o = this.territory.owner[i];
      if (!byOwner.has(o)) byOwner.set(o, []);
      byOwner.get(o)!.push(i);
    }
    const start = performance.now();
    for (const [owner, list] of byOwner) this.creep.push({ owner, pixels: list, done: 0, start, ms });
    requestAnimationFrame(this.creepFrame);
  }

  private creepFrame = (now: number): void => {
    for (const c of this.creep) {
      const upTo = Math.min(c.pixels.length, Math.ceil(((now - c.start) / c.ms) * c.pixels.length));
      if (upTo > c.done) {
        this.layer.reveal(c.pixels, c.done, upTo);
        // The newly taken land glows in its conqueror's colour for a moment.
        this.effects.glow(c.pixels.slice(c.done, upTo), this.nations[c.owner - 1]?.color ?? "#ffffff");
        c.done = upTo;
      }
    }
    this.creep = this.creep.filter((c) => c.done < c.pixels.length);
    this.opts.requestRender();
    if (this.creep.length) requestAnimationFrame(this.creepFrame);
  };

  /** After a push (build, recruit, war…): the same, without a month passing. */
  private afterPush(): void {
    const changed = this.world.takeChanged();
    if (changed.length) {
      this.world.checkFallen();
      this.afterTick({ changedPixels: changed, events: [], newYear: false, playerFell: false });
      this.ui.refresh();
      return;
    }
    this.refreshDivisions();
    this.updateNationBar();
    this.refreshShownPanel();
    this.ui.refresh();
    this.opts.requestRender();
  }

  /** The corner panel's numbers, if it shows a nation. */
  private refreshShownPanel(): void {
    const sheet = this.shownId ? this.sheets[this.shownId - 1] : undefined;
    if (sheet) updateNationPanelStats(sheet, this.opts.stats);
  }

  /** Moves the camera to a nation (e.g. from the news) and opens it. */
  private focusNation(id: number): void {
    const h = this.territory.holding(id);
    if (!h?.pixels.length) return;
    const { map, camera } = this.opts;
    const i = h.pixels[Math.floor(h.pixels.length / 2)];
    const x = i % map.width;
    this.cameraMove?.stop();
    this.cameraMove = tweenCamera(camera, { x: x + 0.5, y: (i - x) / map.width + 0.5, zoom: Math.max(camera.zoom, 4) }, 700, this.opts.requestRender);
    this.showNation(id);
  }

  /** You guide nation `id` now (after yours fell). */
  private adopt(id: number): void {
    for (const n of this.nations) n.mine = false;
    const n = this.nations[id - 1];
    if (!n) return;
    n.mine = true;
    this.world.recompute();
    this.refreshDivisions();
    this.updateNationBar();
    this.showNation(id);
    this.ui.renderFeed();
  }

  /** Saves the game in the browser (every year, and when the page closes). */
  async save(): Promise<boolean> {
    const mine = this.nations.find((n) => n.mine);
    if (!mine || !this.world.live.length) return false;
    const save: GameSave = {
      version: 1,
      savedAt: new Date().toISOString(),
      map: this.opts.mapName,
      seed: this.worldSeed,
      made: this.made,
      nations: this.nations.map((n) => ({ nation: n.nation, color: n.color, mine: n.mine, start: n.holding.start, rolledArea: n.holding.rolledArea, targetArea: n.holding.targetArea })),
      owner: this.territory.owner,
      world: this.world.serialize(),
      label: `${mine.nation.name}, ${this.world.dateText()}`,
    };
    return saveGame(save);
  }

  /** Continues a saved game: the land, the nations and the running world. */
  restore(save: GameSave): void {
    this.territory.restore(save.owner, save.nations);
    this.nations.length = 0;
    save.nations.forEach((n, k) => {
      const holding = this.territory.holding(k + 1)!;
      this.nations.push({ nation: n.nation, color: n.color, mine: n.mine, holding });
      this.layer.setColor(k + 1, n.color);
      this.layer.reveal(holding.pixels);
    });
    this.made = save.made;
    this.worldSeed = save.seed;
    this.world = this.newWorld();
    this.world.recompute();
    this.world.load(save.world);
    this.paintLayer.setPaint(this.world.paint);
    this.pending = null;
    this.state = "idle";
    this.setUiHidden(false);
    this.opts.controls.enabled = true;
    this.refreshMap();
    this.updateNationBar();
    this.ui.renderFeed();
    const mine = this.nations.findIndex((n) => n.mine) + 1;
    if (mine) this.focusNation(mine);
    this.update();
  }

  // ---------------------------------------------------------------- the army section

  /** Opens nation `id`'s Army section (0 closes it), optionally with an army picked. */
  private openArmy(id: number, select: number | null = null): void {
    this.army = { nation: id, selected: select, message: null };
    this.armyLayer.selected = id && select !== null ? { nation: id, army: select } : null;
    // Its armies show on the map while the section is open.
    this.refreshDivisions();
    this.renderArmy();
    this.opts.requestRender();
  }

  private renderArmy(): void {
    const id = this.army.nation;
    const placed = this.nations[id - 1];
    const sheet = this.sheets[id - 1];
    if (!id || !placed || !sheet) {
      showArmyPanel(null);
      return;
    }
    const w = this.world;
    const l = w.live[id - 1];
    const size = this.opts.stats.divisions.size;
    const answer = (d: { ok: boolean; reason: string }): void => {
      this.army.message = { ok: d.ok, text: d.reason };
      this.afterPush();
      this.renderArmy();
    };
    const armies = (l?.armies ?? []).map((a) => {
      const divs = divisionsOf(w, id, a.id);
      const troops = divs.reduce((t, d) => t + d.troops, 0);
      return { id: a.id, name: a.name, divisions: divs.length, troops, training: divs.filter((d) => d.training > 0).length, strength: troops / Math.max(1, divs.length * size), front: a.front, stance: a.stance, locked: a.locked };
    });
    const reserve = divisionsOf(w, id, 0);
    showArmyPanel({
      name: placed.nation.name,
      color: placed.color,
      mine: !!placed.mine,
      influenceCost: this.opts.sim.influence.costs.recruit,
      sheet,
      rules: this.opts.stats.divisions,
      armies,
      reserve: { divisions: reserve.length, training: reserve.filter((d) => d.training > 0).length, troops: reserve.reduce((t, d) => t + d.troops, 0) },
      enemies: enemiesOf(w, id).map((e) => ({ id: e, name: w.name(e) })),
      selected: this.army.selected,
      message: this.army.message,
      showAll: this.showAllArmies,
      suffixes: this.opts.stats.numberSuffixes,
      onSelect: (army) => {
        this.army.selected = army;
        this.armyLayer.selected = { nation: id, army };
        this.renderArmy();
        this.opts.requestRender();
      },
      onFront: (army, front) => answer(w.commandArmy(army, { front })),
      onStance: (army, stance) => answer(w.commandArmy(army, { stance })),
      onRelease: (army) => answer(w.releaseArmy(army)),
      queue: placed.mine ? { waiting: l?.recruitQueue ?? 0, text: w.queueText(id) } : undefined,
      onOrder: (count) => answer(w.orderDivisions(count)),
      onClearQueue: () => answer(w.clearRecruitQueue()),
      onShowAll: (on) => {
        this.showAllArmies = on;
        this.refreshDivisions();
        this.opts.requestRender();
      },
      onClose: () => this.openArmy(0),
    });
  }

  /** The top-left bar shows your own nation's numbers (once it's on the map). */
  private updateNationBar(): void {
    const mine = this.nations.find((n) => n.mine);
    const sheet = mine ? this.sheets[mine.holding.id - 1] : undefined;
    const w = this.world;
    const inf = this.opts.sim.influence;
    const perMonth = sheet ? inf.perMonth + inf.perStability * sheet.stats.stability.value + inf.perPopularity * sheet.stats.popularity.value : 0;
    const clock = { date: w.dateText(), speed: this.ui?.speed ?? 0, speeds: this.opts.sim.clock.speeds, influence: w.influence, perMonth };
    showNationBar(mine && sheet && w.alive(mine.holding.id) ? { name: mine.nation.name, color: mine.color, sheet, data: this.opts.stats, clock } : null);
    this.ui?.setVisible(!!mine && !this.bar.hidden);
  }

  /** The room left in the region now, for the land wheel. */
  private room(): LandRoom {
    return { region: this.regionName, ...this.territory.room(this.region) };
  }

  private nextSeed(): number | undefined {
    const n = this.made++;
    return this.opts.seed !== undefined ? (this.opts.seed + n * 7919) >>> 0 : undefined;
  }

  /** For a new nation before it's placed (its card shows it): the least-used colour. */
  private pickColor(): string {
    return this.bestColor(new Set());
  }

  /** For a nation placed by Fill: a colour unlike the nations its land actually touches. */
  private colorFor(id: number): string {
    const touching = new Set<string>();
    for (const n of this.territory.neighbours(id)) {
      const c = this.nations[n - 1]?.color;
      if (c) touching.add(c);
    }
    return this.bestColor(touching);
  }

  /**
   * The colour that looks most different from `avoid` (neighbours' colours), preferring
   * colours few nations use yet. With 60+ nations colours repeat, but not next to each other.
   */
  private bestColor(avoid: Set<string>): string {
    const list = this.opts.data.colors.list;
    const uses = new Map<string, number>();
    for (const n of [...this.nations, ...(this.pending ? [this.pending] : [])]) uses.set(n.color, (uses.get(n.color) ?? 0) + 1);
    const avoidRgb = [...avoid].map(hexToRgb);
    let best = list[0];
    let bestScore = -Infinity;
    for (const c of list) {
      const rgb = hexToRgb(c);
      // How unlike the nearest neighbour colour it is (capped: past "clearly different" it doesn't matter).
      const unlike = avoidRgb.length ? Math.min(250, ...avoidRgb.map((o) => colorDistance(rgb, o))) : 250;
      const score = unlike - 40 * (uses.get(c) ?? 0);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }

  private focusRegion(): void {
    const { camera, requestRender, reducedMotion } = this.opts;
    const { x0, y0, x1, y1 } = this.region.box;
    const zoom = Math.min(camera.viewWidth / (x1 - x0 + 1), camera.viewHeight / (y1 - y0 + 1)) * 0.92;
    const to = { x: (x0 + x1 + 1) / 2, y: (y0 + y1 + 1) / 2, zoom };
    this.cameraMove?.stop();
    // Pan the short way round on a wrapping map.
    const w = this.opts.map.width;
    if (this.opts.map.wraps && Math.abs(to.x - camera.x) > w / 2) camera.x += to.x > camera.x ? w : -w;
    if (reducedMotion) {
      camera.moveTo(to.x, to.y, to.zoom);
      requestRender();
    } else this.cameraMove = tweenCamera(camera, to, 1100, requestRender);
  }

  private showNation(id: number): void {
    const placed = this.nations[id - 1];
    if (!placed) return;
    this.shownId = id;
    this.layer.select(id);
    this.showPanel(placed);
    this.updateList();
    this.opts.requestRender();
  }

  /** Shows a placed nation in the corner panel, or (null) the one waiting to be placed. */
  private showPanel(placed: PlacedNation | null): void {
    if (placed) {
      const sheet = this.sheets[placed.holding.id - 1];
      showNationPanel(placed.nation, this.opts.wheels, {
        color: placed.color,
        stats: sheet ? { sheet, data: this.opts.stats } : undefined,
        land: { rolled: placed.holding.rolledArea, target: placed.holding.targetArea, actual: placed.holding.area },
      });
    } else if (this.pending) {
      this.shownId = 0;
      this.layer.select(0);
      showNationPanel(this.pending.nation, this.opts.wheels, { color: this.pending.color, land: { rolled: rolledArea(this.pending.nation) } });
    }
  }

  private setUiHidden(hidden: boolean): void {
    this.bar.hidden = hidden;
    this.list.hidden = hidden;
    setNationBarHidden(hidden);
    this.ui?.setVisible(!hidden && this.nations.some((n) => n.mine));
    if (hidden) showArmyPanel(null);
    else if (this.army.nation) this.renderArmy();
    if (hidden) closeNationPanel();
  }

  // ---------------------------------------------------------------- the bar and the list

  private build(): void {
    this.bar.id = "place-bar";
    this.bar.hidden = true;
    this.list.id = "nation-list";
    this.list.hidden = true;
    this.list.innerHTML = `
      <header>
        <span class="nl-title">Nations</span><span class="nl-count"></span>
        <button type="button" class="nl-toggle" aria-expanded="false"><span aria-hidden="true">▾</span></button>
      </header>
      <ol class="nl-rows"></ol>
      <footer>
        <button type="button" class="nl-fill" title="Make and place nations until ${this.opts.data.fill.percent}% of ${escapeHtml(this.regionName)}'s land is taken; then the nations spread into what's left">Fill ${escapeHtml(this.regionName)}</button>
        <button type="button" class="nl-clear" title="Remove every nation from the map">Clear</button>
      </footer>`;
    document.body.append(this.bar, this.list);
    this.bar.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
      if (action === "surprise") this.surprise();
      else if (action === "next") void this.next();
    });
    this.list.querySelector(".nl-fill")!.addEventListener("click", () => void this.fill());
    this.list.querySelector(".nl-clear")!.addEventListener("click", () => this.clear());
    this.list.querySelector(".nl-toggle")!.addEventListener("click", () => {
      this.listOpen = !this.listOpen;
      savePref("nationListOpen", this.listOpen);
      this.updateList();
    });
    this.list.querySelector(".nl-rows")!.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
      if (row) this.showNation(Number(row.dataset.id));
    });
  }

  private update(): void {
    this.updateBar();
    this.updateList();
  }

  private updateBar(): void {
    document.getElementById("map")?.classList.toggle("placing", this.state === "placing");
    const note = this.note ? `<div class="pb-note">${escapeHtml(this.note)}</div>` : "";
    const swatch = (color: string): string => `<span class="pb-swatch" style="background:${escapeHtml(color)}"></span>`;
    let html = "";
    if (this.state === "placing" && this.pending) {
      html = `<div class="pb-main">${swatch(this.pending.color)}<span>Place <b>${escapeHtml(this.pending.nation.name)}</b>: click any land in ${escapeHtml(this.regionName)}</span>
        <button type="button" data-action="surprise">Surprise me</button></div>`;
    } else if (this.state === "filling") {
      html = `<div class="pb-main"><span>Filling ${escapeHtml(this.regionName)}… ${this.nations.length.toLocaleString("en-US")} nations · ${this.fillProgress}%</span></div>`;
    } else if (this.state === "growing" && this.growth) {
      const placed = this.nations[this.growth.holding.id - 1];
      html = `<div class="pb-main">${swatch(placed.color)}<span><b>${escapeHtml(placed.nation.name)}</b> is taking its land…</span></div>`;
    } else if (this.state === "idle") {
      const last = this.nations[this.nations.length - 1];
      const info = last
        ? `${swatch(last.color)}<span><b>${escapeHtml(last.nation.name)}</b> · Land ${escapeHtml(landText({ rolled: last.holding.rolledArea, target: last.holding.targetArea, actual: last.holding.area }, this.opts.wheels))}</span>`
        : `<span>The map is empty.</span>`;
      html = `<div class="pb-main">${info}<button type="button" data-action="next" class="pb-next">${last ? "Next nation" : "New nation"}</button></div>`;
    }
    this.bar.innerHTML = html + note;
  }

  private updateList(): void {
    const share = Math.round(this.territory.ownedShare(this.region) * 100);
    this.list.querySelector(".nl-title")!.textContent = `${this.nations.length} ${this.nations.length === 1 ? "nation" : "nations"}`;
    this.list.querySelector(".nl-count")!.textContent = `· ${share}% of ${this.regionName}`;
    const km = (v: number): string => Math.round(v).toLocaleString("en-US");
    // Biggest first. Closed, the list shows only the top 3 and your own nation.
    const byLand = [...this.nations].sort((a, b) => b.holding.area - a.holding.area || a.holding.id - b.holding.id);
    const shortList = byLand.slice(0, 3);
    const mine = byLand.find((n) => n.mine);
    if (mine && !shortList.includes(mine)) shortList.push(mine);
    const canOpen = byLand.length > shortList.length;
    const open = this.listOpen && canOpen;
    const toggle = this.list.querySelector<HTMLButtonElement>(".nl-toggle")!;
    toggle.hidden = !canOpen;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.title = open ? "Show only the top 3 and your nation" : `Show all ${byLand.length} nations`;
    toggle.setAttribute("aria-label", toggle.title);
    this.list.classList.toggle("open", open);
    this.list.querySelector(".nl-rows")!.innerHTML = (open ? byLand : shortList)
      .map((n, i) => {
        const gap = !open && n === mine && byLand.indexOf(n) > i ? " gap" : "";
        const short = n.holding.area < n.holding.targetArea * 0.995;
        const title = short ? `${km(n.holding.area)} km² of ${km(n.holding.rolledArea)} km² rolled (boxed in)` : `${km(n.holding.area)} km²`;
        return `<li data-id="${n.holding.id}" class="${n.holding.id === this.shownId ? "selected" : ""}${gap}" title="${escapeHtml(title)}">
          <span class="nl-swatch" style="background:${escapeHtml(n.color)}"></span>
          <span class="nl-name">${escapeHtml(n.nation.name)}</span>${n.mine ? '<span class="nl-you">You</span>' : ""}
          <span class="nl-area${short ? " short" : ""}">${km(n.holding.area)}</span>
        </li>`;
      })
      .join("");
    (this.list.querySelector(".nl-fill") as HTMLButtonElement).disabled = this.state === "wheel" || this.state === "filling";
    (this.list.querySelector(".nl-clear") as HTMLButtonElement).disabled = this.state === "filling";
    this.list.querySelector(".nl-rows li.selected")?.scrollIntoView({ block: "nearest" });
  }
}

/** The land size rolled on the wheel, km² (golden "Double land" included). */
export function rolledArea(nation: Nation): number {
  return nation.results.land?.estimate?.value ?? 50_000;
}

/** The growth's random seed: from the nation's own seed and its number, so it's repeatable. */
function growthSeed(nation: Nation, id: number): number {
  return (nation.record.seed ^ Math.imul(id, 0x9e3779b9)) >>> 0;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  // Weighted RGB distance: close enough to how different colours look.
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}
