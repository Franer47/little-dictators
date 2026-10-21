// Putting nations on the map (milestone 2d, the Europe test): after the wheel, click a spot
// in Europe (or "Surprise me") and the nation's land grows from there. Then "Next nation"
// goes back to the wheel. "Fill Europe" (for testing) rolls and places nations instantly
// until there are about 15; "Clear" empties the map.
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
import { runWheelScreen } from "./wheel/wheelScreen.ts";
import { closeNationPanel, landText, showNationPanel } from "./nationPanel.ts";
import { escapeHtml } from "./uiBits.ts";

/** A nation on the map. */
export interface PlacedNation {
  nation: Nation;
  color: string;
  holding: Holding;
}

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
  private pending: { nation: Nation; color: string } | null = null;
  /** The nation open in the corner panel. */
  private shownId = 0;
  private rng: Rng;
  /** How many nations have been made, for their seeds. */
  private made = 1;
  private growth: { holding: Holding; startedAt: number; ms: number; done: number } | null = null;
  private cameraMove: CameraTween | null = null;
  private note = "";

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
    this.pending = { nation, color };
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
      } else this.place(x, y, true);
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
    const spot = this.territory.freeSpot(this.region, this.rng, rolledArea(this.pending.nation));
    if (!spot) {
      this.note = `There's no free land left in ${this.regionName}.`;
      this.update();
      return;
    }
    this.place(spot[0], spot[1], true);
  }

  /** Places the waiting nation at (x, y) and grows its land (animated, or all at once). */
  private place(x: number, y: number, animate: boolean): PlacedNation | null {
    const pending = this.pending;
    if (!pending) return null;
    const holding = this.territory.place(x, y, rolledArea(pending.nation), growthSeed(pending.nation, this.nations.length + 1));
    const placed: PlacedNation = { ...pending, holding };
    this.nations.push(placed);
    this.pending = null;
    this.layer.setColor(holding.id, pending.color);
    this.note = "";
    this.opts.renderer.preview = null;
    if (animate && !this.opts.reducedMotion) {
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
      nation = rollNation(this.opts.wheels, this.opts.mapName, createRng(seed));
    } else {
      this.opts.controls.enabled = false;
      this.opts.renderer.hovered = null;
      this.setUiHidden(true);
      nation = await runWheelScreen({ data: this.opts.wheels, mapName: this.opts.mapName, mapReady: Promise.resolve(), seed, color });
    }
    this.begin(nation, color);
  }

  /** Testing shortcut: rolls and places nations at random until there are `fillCount`, or no room is left. */
  private fill(): void {
    if (this.state === "wheel") return;
    this.finishGrowth();
    const target = this.opts.data.fillCount;
    let full = false;
    let lastId = 0;
    const started = performance.now();
    // The nation waiting to be placed goes first.
    if (this.pending) {
      const spot = this.territory.freeSpot(this.region, this.rng, rolledArea(this.pending.nation));
      if (spot) lastId = this.place(spot[0], spot[1], false)!.holding.id;
      else full = true;
    }
    while (!full && this.nations.length < target) {
      const nation = rollNation(this.opts.wheels, this.opts.mapName, createRng(this.nextSeed()));
      const spot = this.territory.freeSpot(this.region, this.rng, rolledArea(nation));
      if (!spot) {
        full = true;
        break;
      }
      this.pending = { nation, color: this.pickColor(spot) };
      lastId = this.place(spot[0], spot[1], false)!.holding.id;
    }
    if (import.meta.env.DEV) console.log(`Fill: ${this.nations.length} nations in ${Math.round(performance.now() - started)} ms`);
    this.pending = null;
    this.state = "idle";
    this.note = full ? `No free land left in ${this.regionName}.` : "";
    if (lastId) this.showNation(lastId);
    this.update();
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

  private nextSeed(): number | undefined {
    const n = this.made++;
    return this.opts.seed !== undefined ? (this.opts.seed + n * 7919) >>> 0 : undefined;
  }

  /**
   * A colour no nation is using yet. If a spot is given, the one most unlike the colours of
   * the nations nearby, so neighbours don't look alike.
   */
  private pickColor(spot?: [number, number]): string {
    const list = this.opts.data.colors.list;
    const used = new Set([...this.nations.map((n) => n.color), ...(this.pending ? [this.pending.color] : [])]);
    const free = list.filter((c) => !used.has(c));
    const choices = free.length ? free : list;
    if (!spot) return free.length ? free[0] : list[this.nations.length % list.length];
    const near = this.nations.filter((n) => this.distance(n.holding.start, spot) < 160).map((n) => hexToRgb(n.color));
    if (!near.length) return choices[0];
    let best = choices[0];
    let bestScore = -1;
    for (const c of choices) {
      const rgb = hexToRgb(c);
      const score = Math.min(...near.map((o) => colorDistance(rgb, o)));
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }

  private distance(a: [number, number], b: [number, number]): number {
    const w = this.opts.map.width;
    let dx = Math.abs(a[0] - b[0]);
    if (this.opts.map.wraps) dx = Math.min(dx, w - dx);
    return Math.hypot(dx, a[1] - b[1]);
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
      <header><span class="nl-title">Nations</span><span class="nl-count"></span></header>
      <ol class="nl-rows"></ol>
      <footer>
        <button type="button" class="nl-fill" title="Testing shortcut: roll and place nations at random until there are ${this.opts.data.fillCount}">Fill ${escapeHtml(this.regionName)}</button>
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
    this.list.querySelector(".nl-count")!.textContent = String(this.nations.length);
    const km = (v: number): string => Math.round(v).toLocaleString("en-US");
    this.list.querySelector(".nl-rows")!.innerHTML = this.nations
      .map((n) => {
        const short = n.holding.area < n.holding.rolledArea * 0.995;
        const title = short ? `${km(n.holding.area)} km² of ${km(n.holding.rolledArea)} km² rolled (boxed in)` : `${km(n.holding.area)} km²`;
        return `<li data-id="${n.holding.id}" class="${n.holding.id === this.shownId ? "selected" : ""}" title="${escapeHtml(title)}">
          <span class="nl-swatch" style="background:${escapeHtml(n.color)}"></span>
          <span class="nl-name">${escapeHtml(n.nation.name)}</span>
          <span class="nl-area${short ? " short" : ""}">${km(n.holding.area)}</span>
        </li>`;
      })
      .join("");
    (this.list.querySelector(".nl-fill") as HTMLButtonElement).disabled = this.state === "wheel";
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
