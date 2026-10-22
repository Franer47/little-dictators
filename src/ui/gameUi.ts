// The screens of the running game (milestone 4): the clock (pause and speeds), the menu on
// the left (Build, Army, Wars & diplomacy, Brushes) and its panels, the right-click diplomacy
// menu, the feed of world events, answers to your pushes, and the dialog when your nation falls.
// The world itself (src/sim/world.ts) decides everything; this file only shows it and passes
// on your pushes. The placement screen (src/ui/placement.ts) is the host.

import "./gamePanels.css";
import type { PlacementPreview } from "../render/mapRenderer.ts";
import type { BrushId, BuildingSpec } from "../sim/simData.ts";
import { money, type Decision, type GameEvent, type TickResult, type War, type World } from "../sim/world.ts";
import { describeTerms, peaceTerms } from "../sim/war.ts";
import { badge, icon, scoreColor } from "./icons.ts";
import { escapeHtml } from "./uiBits.ts";
import { loadPref, savePref } from "./prefs.ts";
import { setMonthProgress } from "./nationBar.ts";

export interface GameHost {
  world(): World;
  /** Whether time may run (not while placing a nation or on the wheel). */
  canRun(): boolean;
  afterTick(r: TickResult): void;
  /** After a push changed the world: numbers, armies and panels again. */
  afterPush(): void;
  paintChanged(pixels: number[]): void;
  showNation(id: number): void;
  openArmy(id: number): void;
  focusNation(id: number): void;
  pixelUnder(sx: number, sy: number): [number, number] | null;
  ownerAt(x: number, y: number): number;
  colorOf(id: number): string;
  setCursor(c: PlacementPreview | null): void;
  setPaintHandler(fn: ((sx: number, sy: number) => boolean) | null): void;
  /** Makes nation `id` the one you guide (after yours fell). */
  adopt(id: number): void;
  save(): void;
  requestRender(): void;
}

type Panel = "build" | "wars" | "brush" | null;
type Brush = BrushId | "erase";

const BRUSHES: { id: Brush; name: string; color: string; about: string }[] = [
  { id: "warGoal", name: "War goal", color: "#dc2828", about: "Paint other nations' land you want. Your nation goes after it: more likely to war with its owner, and it asks for this land first in a peace." },
  { id: "defend", name: "Defend", color: "#3c82f0", about: "Paint your own land to guard. Your armies at home stand there and forts are built there first." },
  { id: "develop", name: "Develop", color: "#46be5a", about: "Paint your own land to grow. New buildings go there first, and your nation builds farms, markets, workshops and schools more." },
  { id: "erase", name: "Erase", color: "#9a8f78", about: "Removes paint and gives back half of what it cost." },
];

export class GameUi {
  /** 0 = paused, else an index into the speeds + 1. */
  speed = 0;
  private lastSpeed = 1;
  private acc = 0;
  private lastFrame = performance.now();
  private panel: Panel = null;
  private brush: Brush | null = null;
  private brushSize = 1;
  private message: Decision | null = null;
  private eventFilter: "near" | "all" = "near";
  private pickingNation = false;
  /** Big news about your nation waiting to be shown (one letter at a time; the game pauses). */
  private letters: GameEvent[] = [];
  /** The speed to go back to when the letters are read. */
  private resumeSpeed = 0;

  private menu = document.createElement("aside");
  private box = document.createElement("section");
  private feed = document.createElement("div");
  private ctxMenu = document.createElement("div");
  private toastEl = document.createElement("div");
  private dialog = document.createElement("div");
  private toastTimer = 0;

  constructor(private host: GameHost) {
    this.menu.id = "side-menu";
    this.box.id = "game-panel";
    this.box.hidden = true;
    this.feed.id = "event-feed";
    this.ctxMenu.id = "ctx-menu";
    this.ctxMenu.hidden = true;
    this.toastEl.id = "game-toast";
    this.toastEl.hidden = true;
    this.dialog.id = "game-dialog";
    this.dialog.hidden = true;
    document.body.append(this.menu, this.box, this.feed, this.ctxMenu, this.toastEl, this.dialog);
    for (const el of [this.menu, this.box, this.feed, this.ctxMenu, this.dialog]) {
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.addEventListener("wheel", (e) => e.stopPropagation());
    }
    this.menu.innerHTML = `
      <button type="button" data-open="build" title="Buildings: push your nation to build">${badge("columns", "#e6c25a")}<span>Build</span></button>
      <button type="button" data-open="army" title="Your armies">${badge("swords", "#e0604f")}<span>Army</span></button>
      <button type="button" data-open="wars" title="Wars, allies and neighbours">${badge("flag", "#b494ec")}<span>Wars</span></button>
      <button type="button" data-open="brush" title="Paint the map with influence">${badge("trend", "#62b0e6")}<span>Brushes</span></button>
      <button type="button" data-open="help" title="How to play">${badge("book", "#d4b062")}<span>How to</span></button>`;
    this.menu.hidden = true;
    this.menu.addEventListener("click", (e) => {
      const which = (e.target as HTMLElement).closest<HTMLElement>("[data-open]")?.dataset.open;
      if (which === "help") return this.showHowTo();
      if (which === "army") {
        this.setPanel(null);
        this.host.openArmy(this.host.world().mineId);
      } else if (which) this.setPanel(this.panel === which ? null : (which as Panel));
    });
    this.box.addEventListener("click", (e) => this.onPanelClick(e));
    this.feed.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-nation], [data-filter]");
      if (el?.dataset.filter) {
        this.eventFilter = el.dataset.filter as "near" | "all";
        this.renderFeed();
      } else if (el?.dataset.nation) this.host.focusNation(Number(el.dataset.nation));
    });
    this.ctxMenu.addEventListener("click", (e) => this.onMenuClick(e));
    this.dialog.addEventListener("click", (e) => this.onDialogClick(e));
    window.addEventListener("pointerdown", () => (this.ctxMenu.hidden = true));
    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("beforeunload", () => this.host.save());
    requestAnimationFrame(this.frame);
  }

  /** Shows or hides the game's screens (hidden while the wheel is up). */
  setVisible(on: boolean): void {
    if (on && this.menu.hidden && !loadPref<boolean>("howToSeen", false)) {
      savePref("howToSeen", true);
      window.setTimeout(() => this.showHowTo(), 400);
    }
    this.menu.hidden = !on;
    this.feed.hidden = !on;
    if (!on) {
      this.box.hidden = true;
      this.ctxMenu.hidden = true;
    } else if (this.panel) this.box.hidden = false;
  }

  // ---------------------------------------------------------------- the clock

  get speeds(): number[] {
    return this.host.world().sim.clock.speeds;
  }

  setSpeed(i: number): void {
    this.speed = Math.max(0, Math.min(this.speeds.length, i));
    if (this.speed) this.lastSpeed = this.speed;
    this.acc = 0;
    this.host.afterPush();
  }

  togglePause(): void {
    this.setSpeed(this.speed ? 0 : this.lastSpeed);
  }

  private frame = (now: number): void => {
    const dt = Math.min(250, now - this.lastFrame);
    this.lastFrame = now;
    if (this.speed && this.host.canRun()) {
      const w = this.host.world();
      this.acc += dt * this.speeds[this.speed - 1];
      // At most one month per frame, so even the fastest speed stays smooth.
      if (this.acc >= w.sim.clock.msPerMonth) {
        this.acc -= w.sim.clock.msPerMonth;
        if (this.acc > w.sim.clock.msPerMonth) this.acc = 0;
        const result = w.tick();
        this.host.afterTick(result);
        this.onTick(result);
      }
      setMonthProgress(this.acc / w.sim.clock.msPerMonth);
    }
    requestAnimationFrame(this.frame);
  };

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea") || this.menu.hidden) return;
    if (e.code === "Space") {
      e.preventDefault();
      this.togglePause();
    } else if (/^Digit[1-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      if (n <= this.speeds.length) this.setSpeed(n);
    } else if (e.code === "Escape") {
      if (this.brush) this.pickBrush(null);
      this.ctxMenu.hidden = true;
    }
  }

  private onTick(r: TickResult): void {
    if (r.events.length) this.renderFeed();
    this.updateBadges();
    // Big news about your nation comes as a letter, and the game waits for you.
    const mine = this.host.world().mineId;
    const big = r.events.filter((e) => e.nations.includes(mine) && (e.kind === "war" || e.kind === "peace" || (e.kind === "diplomacy" && e.text.includes("no longer"))));
    if (big.length && !r.playerFell) {
      if (!this.letters.length && this.dialog.hidden) this.resumeSpeed = this.speed;
      this.letters.push(...big);
      this.setSpeed(0);
      if (this.dialog.hidden) this.showLetter();
    }
    if (this.panel && r.newYear) this.renderPanel();
    else if (this.panel === "wars" || this.panel === "build") this.renderPanel();
    const w = this.host.world();
    if (r.newYear && (w.year - w.sim.clock.startYear) % w.sim.save.everyYears === 0) this.host.save();
    if (r.playerFell) {
      this.setSpeed(0);
      this.showFallen();
    }
  }

  // ---------------------------------------------------------------- panels

  setPanel(p: Panel): void {
    this.panel = p;
    if (p) this.host.openArmy(0);
    if (p !== "brush") this.pickBrush(null);
    for (const b of this.menu.querySelectorAll<HTMLElement>("[data-open]")) b.classList.toggle("on", b.dataset.open === p);
    this.message = null;
    this.renderPanel();
  }

  /** Redraws whatever panel is open (after the world changed), and the war count on the Wars button. */
  refresh(): void {
    if (this.panel) this.renderPanel();
    this.updateBadges();
  }

  /** A red count of your wars on the Wars button. */
  private updateBadges(): void {
    const w = this.host.world();
    const n = w.mineId ? w.warsOf(w.mineId).length : 0;
    const btn = this.menu.querySelector<HTMLElement>('[data-open="wars"]');
    if (!btn) return;
    let badgeEl = btn.querySelector<HTMLElement>(".gp-count");
    if (!n) return badgeEl?.remove();
    if (!badgeEl) {
      badgeEl = document.createElement("b");
      badgeEl.className = "gp-count";
      btn.append(badgeEl);
    }
    badgeEl.textContent = String(n);
    btn.title = `Wars, allies and neighbours: you're in ${n} ${n === 1 ? "war" : "wars"}`;
  }

  private renderPanel(): void {
    const w = this.host.world();
    if (!this.panel || !w.mineId || !w.alive(w.mineId)) {
      this.box.hidden = true;
      return;
    }
    this.box.hidden = false;
    const msg = this.message ? `<p class="gp-message ${this.message.ok ? "ok" : "no"}">${escapeHtml(this.message.reason)}</p>` : "";
    const header = (title: string, kicker: string): string =>
      `<header><div><span class="gp-kicker">${escapeHtml(kicker)}</span><h2>${escapeHtml(title)}</h2></div><button type="button" class="gp-close" data-act="close" title="Close (Esc)">×</button></header>`;
    const influence = `<div class="gp-influence" title="Influence: what you spend to push your nation. You earn more each month when it's stable and likes its ruler.">${icon("star")} <b>${Math.floor(w.influence)}</b> influence</div>`;
    if (this.panel === "build") this.box.innerHTML = header("Build", "Push your nation") + influence + msg + this.buildHtml(w);
    else if (this.panel === "wars") this.box.innerHTML = header("Wars & diplomacy", "Your nation abroad") + influence + msg + this.warsHtml(w);
    else this.box.innerHTML = header("Brushes", "Paint the map") + influence + this.brushHtml(w);
  }

  private buildHtml(w: World): string {
    const id = w.mineId;
    const l = w.live[id - 1];
    const s = w.sheets[id - 1];
    const cost = w.sim.influence.costs.build;
    const rows = w.sim.buildings
      .map((b: BuildingSpec) => {
        const level = l.buildings[b.id] ?? 0;
        const going = l.building.filter((x) => x.id === b.id);
        const queued = (l.buildQueue ?? []).filter((x) => x === b.id).length;
        const block = w.buildBlock(id, b, queued);
        const never = block === "max" || block === "coast";
        const why = never ? (queued ? `${b.name} reaches the top level (${b.maxLevel}) with the ones in the queue.` : w.whyCantBuild(id, b)) : block ? `${w.whyCantBuild(id, b)} Ordering it puts it in the queue.` : "";
        const dots = Array.from({ length: b.maxLevel }, (_, k) => `<i class="${k < level ? "on" : k < level + going.length + queued ? "going" : ""}"></i>`).join("");
        const effects = Object.entries(b.effectText)
          .map(([f, v]) => `${v} ${w.opts.stats.factors[f as keyof typeof w.opts.stats.factors]?.name.toLowerCase() ?? f}`)
          .join(", ");
        const status = [going.length ? `Building… ${going[0].monthsLeft} months left` : "", queued ? `${queued} in the queue` : ""].filter(Boolean).join(" · ");
        return `<div class="gp-building${never ? " blocked" : ""}">
          ${badge(b.icon, "#e6c25a")}
          <div class="gp-b-text"><div class="gp-b-name">${escapeHtml(b.name)} <span class="gp-dots">${dots}</span></div>
            <div class="gp-b-eff">${escapeHtml(effects)} per level</div>
            <div class="gp-b-cost">${money(w.buildCost(id, b))} · ${b.months} months ${status ? `<span class="gp-going">${status}</span>` : ""}</div></div>
          <button type="button" class="gp-btn" data-build="${b.id}" title="${escapeHtml(why || `Push your nation to build it (costs ${cost} influence)`)}">${block && !never ? "Queue" : "Build"} <small>✦${cost}</small></button>
        </div>`;
      })
      .join("");
    const waiting = l.buildQueue ?? [];
    const queue = waiting.length
      ? `<div class="gp-queue"><span>Queue: ${waiting.map((x, i) => `${i + 1}. ${escapeHtml(w.buildingSpec(x)?.name ?? x)}`).join(", ")}. They start by themselves when there's money and a free builder.</span><button type="button" class="gp-btn" data-clearbuild="1" title="Cancel the waiting buildings (the influence comes back)">Clear</button></div>`
      : "";
    return `<p class="gp-hint">Treasury ${escapeHtml(s.stats.treasury.text)} · income ${escapeHtml(s.stats.income.text)}. Two things can be built at once; order more and they wait in the queue. Your nation also builds what it thinks it needs, once a year.</p>${queue}${rows}`;
  }

  private warsHtml(w: World): string {
    const id = w.mineId;
    const costs = w.sim.influence.costs;
    const name = (n: number): string => `<button type="button" class="gp-link" data-nation="${n}"><i style="background:${escapeHtml(this.host.colorOf(n))}"></i>${escapeHtml(w.name(n))}</button>`;
    const wars = w.warsOf(id).map((war: War) => {
      const attacking = war.attackers.includes(id);
      const ours = attacking ? war.score : -war.score;
      const pct = (ours + 100) / 2;
      return `<div class="gp-war">
        <div class="gp-war-name">${escapeHtml(war.name)} <span class="gp-sub">· ${war.months} months</span></div>
        <div class="gp-sides"><div>${(attacking ? war.attackers : war.defenders).map(name).join("")}</div><span>vs</span><div>${(attacking ? war.defenders : war.attackers).map(name).join("")}</div></div>
        <div class="gp-score" title="War score: ${Math.round(ours)} for you (−100 lost … 100 won)"><span style="width:${pct}%;background:${scoreColor(pct)}"></span></div>
        <div class="gp-sub">War score ${ours > 0 ? "+" : ""}${Math.round(ours)}. Peace now: ${escapeHtml(describeTerms(w, peaceTerms(w, war)))}.${ours > 0 ? " Keep fighting to win more; it's up to you when to stop." : ""}</div>
        <button type="button" class="gp-btn" data-peace="${war.id}">Make peace <small>✦${costs.offerPeace}</small></button>
      </div>`;
    });
    const allies = w.allies(id);
    const neighbours = [...(w.neighbours[id - 1] ?? [])].filter((n) => w.alive(n)).sort((a, b) => w.relation(id, b) - w.relation(id, a));
    const rel = (n: number): string => {
      const r = Math.round(w.relation(id, n));
      return `<span class="gp-rel" style="color:${scoreColor((r + 100) / 2)}" title="Relations: −100 hate … 100 love">${r > 0 ? "+" : ""}${r}</span>`;
    };
    const rows = neighbours
      .map(
        (n) => `<div class="gp-nb">${name(n)}${rel(n)}${w.allied(id, n) ? '<span class="gp-tag">ally</span>' : ""}${w.atWar(id, n) ? '<span class="gp-tag war">war</span>' : ""}
        <span class="gp-acts">
          <button type="button" data-rel="${n}" data-dir="1" title="Improve relations (✦${costs.improveRelations})">＋</button>
          <button type="button" data-rel="${n}" data-dir="-1" title="Worsen relations (✦${costs.worsenRelations})">−</button>
          <button type="button" data-ally="${n}" title="Propose an alliance (✦${costs.alliance})">Ally</button>
          <button type="button" data-war="${n}" title="Push for war (✦${costs.declareWar})">War</button>
        </span></div>`,
      )
      .join("");
    const treaties = w.events
      .filter((e) => e.kind === "peace" && e.nations.includes(id))
      .slice(-4)
      .reverse()
      .map((e) => `<p class="gp-treaty"><small>${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][e.month]} ${e.year}</small> ${escapeHtml(e.text.replace(/^Peace: /, ""))}</p>`)
      .join("");
    return `
      <h3>Your wars</h3>${wars.join("") || '<p class="gp-hint">At peace.</p>'}
      ${treaties ? `<h3>Recent treaties</h3>${treaties}` : ""}
      <h3>Allies</h3><p class="gp-hint">${allies.length ? allies.map(name).join(" ") : "None yet. Allies join each other's defensive wars."}</p>
      <h3>Neighbours</h3>${rows || '<p class="gp-hint">No neighbours.</p>'}
      <p class="gp-hint">Right-click any nation on the map for the same choices.</p>`;
  }

  private brushHtml(w: World): string {
    const costs = w.sim.brushes.cost;
    const costText = (id: Brush): string => (id === "erase" ? "refunds half" : `✦${costs[id as BrushId]} a pixel`);
    const buttons = BRUSHES.map(
      (b) => `<button type="button" class="gp-brush${this.brush === b.id ? " on" : ""}" data-brush="${b.id}" title="${escapeHtml(b.about)}">
        <i style="background:${b.color}"></i><span><b>${escapeHtml(b.name)}</b><small>${costText(b.id)}</small></span></button>`,
    ).join("");
    const sizes = w.sim.brushes.sizes
      .map((r, k) => `<button type="button" class="gp-size${k === this.brushSize ? " on" : ""}" data-size="${k}">${["S", "M", "L", "XL"][k] ?? r}</button>`)
      .join("");
    const active = BRUSHES.find((b) => b.id === this.brush);
    return `<div class="gp-brushes">${buttons}</div>
      <div class="gp-sizes"><span>Size</span>${sizes}</div>
      <p class="gp-hint">${active ? `${escapeHtml(active.about)} Drag on the map with the left mouse button; the right button still moves the map. Esc puts the brush down.` : "Pick a brush, then paint on the map."}</p>
      <p class="gp-hint">Painted: ${w.paintedOn(w.mineId, 2)} defend and ${w.paintedOn(w.mineId, 3)} develop pixels on your land.</p>`;
  }

  private onPanelClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!el) return;
    const w = this.host.world();
    const d = el.dataset;
    let decision: Decision | null = null;
    if (d.act === "close") return this.setPanel(null);
    if (d.build) decision = w.pushBuild(d.build);
    else if (d.clearbuild) decision = w.clearBuildQueue();
    else if (d.peace) decision = w.pushPeace(Number(d.peace));
    else if (d.rel) decision = w.pushRelations(Number(d.rel), Number(d.dir) as 1 | -1);
    else if (d.ally) decision = w.pushAlliance(Number(d.ally));
    else if (d.war) decision = w.pushWar(Number(d.war));
    else if (d.nation) return this.host.focusNation(Number(d.nation));
    else if (d.brush) return this.pickBrush(this.brush === d.brush ? null : (d.brush as Brush));
    else if (d.size) {
      this.brushSize = Number(d.size);
      return this.renderPanel();
    }
    if (decision) {
      this.message = decision;
      this.host.afterPush();
      this.renderFeed();
      this.renderPanel();
    }
  }

  // ---------------------------------------------------------------- brushes

  private pickBrush(b: Brush | null): void {
    this.brush = b;
    if (!b) {
      this.host.setPaintHandler(null);
      this.host.setCursor(null);
    } else {
      this.host.setPaintHandler((sx, sy) => this.paintAt(sx, sy));
    }
    if (this.panel === "brush") this.renderPanel();
  }

  /** The brush outline follows the mouse while a brush is picked. */
  hover(p: [number, number] | null): void {
    if (!this.brush || !p) return this.host.setCursor(null);
    const meta = BRUSHES.find((b) => b.id === this.brush)!;
    const r = this.host.world().sim.brushes.sizes[this.brushSize] ?? 1;
    this.host.setCursor({ radius: r + 0.5, color: meta.color, valid: true });
  }

  private paintAt(sx: number, sy: number): boolean {
    const p = this.host.pixelUnder(sx, sy);
    if (!p || !this.brush) return true;
    const w = this.host.world();
    const changed = w.paintAt(this.brush === "erase" ? null : this.brush, p[0], p[1], w.sim.brushes.sizes[this.brushSize] ?? 1);
    if (changed.length) {
      this.host.paintChanged(changed);
      if (this.panel === "brush") this.renderPanel();
    } else if (this.brush !== "erase" && w.influence < (w.sim.brushes.cost[this.brush as BrushId] ?? 0)) this.toast("Out of influence: wait for more, or erase some paint.");
    return true;
  }

  // ---------------------------------------------------------------- right-click diplomacy

  /** Right-click on the map: the diplomacy menu for the nation there. */
  rightClick(sx: number, sy: number): void {
    const w = this.host.world();
    const p = this.host.pixelUnder(sx, sy);
    const id = p ? this.host.ownerAt(...p) : 0;
    if (!id || !w.mineId || !w.alive(w.mineId)) return;
    if (this.brush) return this.pickBrush(null);
    const mine = id === w.mineId;
    const costs = w.sim.influence.costs;
    const war = w.atWar(w.mineId, id);
    const r = Math.round(w.relation(w.mineId, id));
    this.ctxMenu.innerHTML = mine
      ? `<div class="cm-title">${escapeHtml(w.name(id))}</div><button type="button" data-cm="open" data-id="${id}">Open your nation</button><button type="button" data-cm="army" data-id="${id}">Army</button><button type="button" data-cm="build" data-id="${id}">Build</button>`
      : `<div class="cm-title"><i style="background:${escapeHtml(this.host.colorOf(id))}"></i>${escapeHtml(w.name(id))}<span style="color:${scoreColor((r + 100) / 2)}">${r > 0 ? "+" : ""}${r}</span></div>
        <button type="button" data-cm="open" data-id="${id}">Open its stats</button>
        <button type="button" data-cm="rel" data-dir="1" data-id="${id}">Improve relations <small>✦${costs.improveRelations}</small></button>
        <button type="button" data-cm="rel" data-dir="-1" data-id="${id}">Worsen relations <small>✦${costs.worsenRelations}</small></button>
        ${w.allied(w.mineId, id) ? "" : `<button type="button" data-cm="ally" data-id="${id}">Propose alliance <small>✦${costs.alliance}</small></button>`}
        ${war ? `<button type="button" data-cm="peace" data-war="${war.id}">Offer peace <small>✦${costs.offerPeace}</small></button>` : `<button type="button" data-cm="war" data-id="${id}" class="danger">Declare war <small>✦${costs.declareWar}</small></button>`}`;
    this.ctxMenu.hidden = false;
    const x = Math.min(window.innerWidth - this.ctxMenu.offsetWidth - 8, sx + 4);
    const y = Math.min(window.innerHeight - this.ctxMenu.offsetHeight - 8, sy + 4);
    this.ctxMenu.style.left = `${x}px`;
    this.ctxMenu.style.top = `${y}px`;
  }

  private onMenuClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cm]");
    if (!el) return;
    const w = this.host.world();
    const id = Number(el.dataset.id);
    this.ctxMenu.hidden = true;
    let decision: Decision | null = null;
    switch (el.dataset.cm) {
      case "open":
        return this.host.showNation(id);
      case "army":
        return this.host.openArmy(id);
      case "build":
        return this.setPanel("build");
      case "rel":
        decision = w.pushRelations(id, Number(el.dataset.dir) as 1 | -1);
        break;
      case "ally":
        decision = w.pushAlliance(id);
        break;
      case "war":
        decision = w.pushWar(id);
        break;
      case "peace":
        decision = w.pushPeace(Number(el.dataset.war));
        break;
    }
    if (decision) {
      this.toast(decision.reason, decision.ok);
      this.host.afterPush();
      this.renderFeed();
      this.refresh();
    }
  }

  toast(text: string, ok = false): void {
    this.toastEl.textContent = text;
    this.toastEl.className = ok ? "ok" : "";
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), 5000);
  }

  // ---------------------------------------------------------------- the feed of events

  renderFeed(): void {
    const w = this.host.world();
    const mine = w.mineId;
    const near = new Set<number>([mine, ...(w.neighbours[mine - 1] ?? [])]);
    const list = w.events
      .filter((e: GameEvent) => this.eventFilter === "all" || e.nations.some((n) => near.has(n)))
      .slice(-6)
      .reverse();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const kindIcon: Record<string, [string, string]> = {
      war: ["swords", "#e0604f"],
      peace: ["heart", "#93d17c"],
      build: ["columns", "#e6c25a"],
      army: ["swords", "#e8a25a"],
      diplomacy: ["link", "#6fd0a4"],
      fall: ["flame", "#f06a3c"],
      info: ["star", "#d4b062"],
    };
    this.feed.innerHTML = `<div class="ef-head"><span>World news</span>
        <button type="button" data-filter="near" class="${this.eventFilter === "near" ? "on" : ""}">Near you</button>
        <button type="button" data-filter="all" class="${this.eventFilter === "all" ? "on" : ""}">Everything</button></div>
      ${list.map((e) => `<div class="ef-row${e.nations.includes(mine) ? " mine" : ""}" data-nation="${e.nations[0] ?? 0}">${badge(...(kindIcon[e.kind] ?? kindIcon.info))}<span><small>${months[e.month]} ${e.year}</small> ${escapeHtml(e.text)}</span></div>`).join("") || '<p class="ef-empty">Nothing has happened yet. Press ▶ (or Space) to start the clock.</p>'}`;
  }

  // ---------------------------------------------------------------- when your nation falls

  private showFallen(): void {
    const w = this.host.world();
    this.dialog.innerHTML = `<div class="gd-box"><h2>Your nation has fallen</h2>
      <p>In ${w.dateText()} the last of your land was taken. The world goes on without you.</p>
      <div class="gd-actions"><button type="button" class="gp-btn primary" data-dlg="pick">Pick a new nation</button><button type="button" class="gp-btn" data-dlg="watch">Keep watching</button></div></div>`;
    this.dialog.hidden = false;
  }

  /** The next letter about your nation (war declared, peace signed…). */
  private showLetter(): void {
    const e = this.letters.shift();
    if (!e) return;
    const w = this.host.world();
    const mine = w.mineId;
    const titles: Record<string, string> = { war: "War!", peace: "Peace", diplomacy: "An alliance ends" };
    let title = titles[e.kind] ?? "News";
    if (e.kind === "war") title = e.text.startsWith(w.name(mine)) ? "We go to war" : "War is declared on us!";
    const more = this.letters.length ? `<p class="gd-more">${this.letters.length} more…</p>` : "";
    this.dialog.innerHTML = `<div class="gd-box letter ${e.kind}"><span class="gd-date">${escapeHtml(w.dateText())}</span><h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(e.text)}</p>${more}
      <div class="gd-actions"><button type="button" class="gp-btn primary" data-dlg="letter">${this.letters.length ? "Next" : "Carry on"}</button>${e.kind === "war" ? '<button type="button" class="gp-btn" data-dlg="wars">See your wars</button>' : ""}</div></div>`;
    this.dialog.hidden = false;
  }

  /** The short guide (first time, and from the How to button). */
  private showHowTo(): void {
    const w = this.host.world();
    const c = w.sim.influence.costs;
    this.dialog.innerHTML = `<div class="gd-box howto"><h2>How to play</h2>
      <ol>
        <li><b>Start the clock</b> with ▶ in the top strip (or <b>Space</b>); keys <b>1 2 3</b> set the speed. A month passes every few seconds.</li>
        <li><b>Your nation runs itself</b>, like every other nation: it builds, recruits, makes friends and enemies. You <b>guide</b> it with <b>influence ✦</b>, which you earn every month.</li>
        <li><b>Build</b>, <b>Army</b> and <b>Wars</b> on the left let you push it: a building (✦${c.build}), divisions (✦${c.recruit} each; your armies go to the fronts by themselves, or command them in Army), better or worse relations, an alliance, war (✦${c.declareWar}) or peace. It can say no, and tells you why.</li>
        <li><b>Right-click</b> any nation for diplomacy. <b>Brushes</b> paint land you want (War goal), land to guard (Defend) and land to grow (Develop).</li>
        <li>In a war the stronger side <b>pushes the border pixel by pixel</b> (mountains and rivers slow it). When you're winning, you choose when to make peace; you keep what you took. Watch <b>World news</b> in the corner, and point at any number to see where it comes from.</li>
      </ol>
      <p class="gd-small">The game saves itself every year; the start screen shows Continue.</p>
      <div class="gd-actions"><button type="button" class="gp-btn primary" data-dlg="close">Got it</button></div></div>`;
    this.dialog.hidden = false;
  }

  private onDialogClick(e: MouseEvent): void {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-dlg]")?.dataset.dlg;
    if (!act) return;
    this.dialog.hidden = true;
    if (act === "letter" || act === "wars") {
      if (act === "wars") {
        this.letters.length = 0;
        this.setPanel("wars");
        return;
      }
      if (this.letters.length) return this.showLetter();
      if (this.resumeSpeed) this.setSpeed(this.resumeSpeed);
      return;
    }
    if (act === "close") return;
    if (act === "pick") {
      this.pickingNation = true;
      this.toast("Click any nation on the map to guide it.", true);
    } else this.setSpeed(this.lastSpeed);
  }

  /** A left-click on the map: used to pick a new nation after yours fell. Returns true if used. */
  click(id: number): boolean {
    if (!this.pickingNation || !id || !this.host.world().alive(id)) return false;
    this.pickingNation = false;
    this.host.adopt(id);
    this.toast(`You now guide ${this.host.world().name(id)}.`, true);
    return true;
  }
}
