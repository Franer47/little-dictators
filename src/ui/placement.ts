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
import { Region, Territory, type Holding, type PlacementData } from "../game/territory.ts";
import type { WheelData } from "../game/wheels.ts";
import type { LandRoom } from "../game/room.ts";
import { runWheelScreen } from "./wheel/wheelScreen.ts";
import { closeNationPanel, landText, showNationPanel } from "./nationPanel.ts";
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
  /** Fixed seed from the address (?seed=123): the same seed and clicks give the same map. */
  seed?: number;
  /** ?wheel=skip: roll each nation instantly instead of showing the wheel. */
  skipWheel: boolean;
  reducedMotion: boolean;
}

type State = "placing" | "growing" | "idle" | "wheel";

export class Placement {
  readonly territory: Territory;
  readonly region: Region;
  readonly nations: PlacedNation[] = [];
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
    this.rng = createRng(opts.seed ?? randomSeed());
    this.build();
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

  /** The map was clicked on pixel (x, y). */
  click(x: number, y: number): void {
    if (this.state === "placing") {
      const why = this.whyNot(x, y);
      if (why) {
        this.note = why;
        this.update();
      } else this.place(x, y, "animate");
      return;
    }
    if (this.state === "idle" || this.state === "growing") {
      const id = this.territory.ownerAt(x, y);
      if (id) this.showNation(id);
    }
  }

  /** The mouse is over pixel (x, y) (or off the map): update the placement cursor. */
  hover(p: [number, number] | null): void {
    const { renderer } = this.opts;
    if (this.state !== "placing" || !p || !this.pending) {
      renderer.preview = null;
      return;
    }
    const [x, y] = p;
    // About the size it will grow to, as a circle.
    const radius = Math.sqrt(rolledArea(this.pending.nation) / this.territory.areas[y] / Math.PI);
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
    if (!this.region.contains(x, y)) return `For this test, nations go in ${this.regionName}.`;
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
  private fill(): void {
    if (this.state === "wheel") return;
    this.finishGrowth();
    const { percent, minArea, maxNations, maxAttempts, absorbSteps } = this.opts.data.fill;
    const spotRules = { ...this.opts.data.start, minArea };
    const started = performance.now();
    let full = false;
    let lastId = 0;
    const placeAnywhere = (pending: Pending): void => {
      const spot = this.territory.freeSpot(this.region, this.rng, rolledArea(pending.nation), spotRules);
      if (!spot) {
        full = true;
        return;
      }
      this.pending = pending;
      lastId = this.place(spot[0], spot[1], "fill")!.holding.id;
    };
    // The nation waiting to be placed goes first (it keeps the colour on its card).
    if (this.pending) placeAnywhere(this.pending);
    // Every placement takes at least one free pixel, so this always ends; the caps keep it short.
    for (let tries = 0; !full && tries < maxAttempts && this.nations.length < maxNations; tries++) {
      if (this.territory.ownedShare(this.region) * 100 >= percent) break;
      placeAnywhere({ nation: rollNation(this.opts.wheels, this.opts.mapName, createRng(this.nextSeed()), this.room()), color: "" });
    }
    // A full fill ends with the leftovers (small islands, slivers between borders) going to the
    // nearest nations, so the whole region is owned when the game starts.
    // Rounds of `absorbSteps` pixels each while that still takes land, then one last pass with
    // no limit for far-off islands (e.g. Jan Mayen), which go to the nearest nation.
    if (percent >= 100) {
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
    this.pending = null;
    this.state = "idle";
    // Stopping because the gaps left are too small for another nation is the normal end of a 100% fill.
    this.note = full && percent < 100 ? `No room for more nations in ${this.regionName}.` : "";
    if (lastId) this.showNation(lastId);
    this.update();
    this.opts.requestRender();
  }

  private clear(): void {
    if (this.state === "wheel") return;
    this.growth = null;
    this.territory.clear();
    this.layer.clear();
    this.nations.length = 0;
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
      showNationPanel(placed.nation, this.opts.wheels, {
        color: placed.color,
        land: { rolled: placed.holding.rolledArea, actual: placed.holding.area },
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
        <button type="button" class="nl-fill" title="Testing shortcut: roll and place nations at random until ${this.opts.data.fill.percent < 100 ? `${this.opts.data.fill.percent}% of ${escapeHtml(this.regionName)}'s land is taken` : `there's no room left in ${escapeHtml(this.regionName)}`}">Fill ${escapeHtml(this.regionName)}</button>
        <button type="button" class="nl-clear" title="Remove every nation from the map">Clear</button>
      </footer>`;
    document.body.append(this.bar, this.list);
    this.bar.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
      if (action === "surprise") this.surprise();
      else if (action === "next") void this.next();
    });
    this.list.querySelector(".nl-fill")!.addEventListener("click", () => this.fill());
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
    } else if (this.state === "growing" && this.growth) {
      const placed = this.nations[this.growth.holding.id - 1];
      html = `<div class="pb-main">${swatch(placed.color)}<span><b>${escapeHtml(placed.nation.name)}</b> is taking its land…</span></div>`;
    } else if (this.state === "idle") {
      const last = this.nations[this.nations.length - 1];
      const info = last
        ? `${swatch(last.color)}<span><b>${escapeHtml(last.nation.name)}</b> · Land ${escapeHtml(landText({ rolled: last.holding.rolledArea, actual: last.holding.area }, this.opts.wheels))}</span>`
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
        const short = n.holding.area < n.holding.rolledArea * 0.995;
        const title = short ? `${km(n.holding.area)} km² of ${km(n.holding.rolledArea)} km² rolled (boxed in)` : `${km(n.holding.area)} km²`;
        return `<li data-id="${n.holding.id}" class="${n.holding.id === this.shownId ? "selected" : ""}${gap}" title="${escapeHtml(title)}">
          <span class="nl-swatch" style="background:${escapeHtml(n.color)}"></span>
          <span class="nl-name">${escapeHtml(n.nation.name)}</span>${n.mine ? '<span class="nl-you">You</span>' : ""}
          <span class="nl-area${short ? " short" : ""}">${km(n.holding.area)}</span>
        </li>`;
      })
      .join("");
    (this.list.querySelector(".nl-fill") as HTMLButtonElement).disabled = this.state === "wheel";
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
