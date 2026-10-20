// The wheel screen: spin each wheel in turn, collect the results on the nation card, then
// reveal the nation. Game logic (the random picks, the nation itself) lives in src/game/;
// this file only runs the show.

import "@fontsource/press-start-2p/400.css";
import "@fontsource/luckiest-guy/400.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/600.css";
import "@fontsource/pixelify-sans/700.css";
import "./wheel.css";
import { createNation, describeOutcome, generateName, makeOutcome, type Nation, type WheelOutcome } from "../../game/nation.ts";
import { createRng, type Rng } from "../../game/random.ts";
import { exactWheel, spinWheel, type Slice, type Wheel, type WheelData } from "../../game/wheels.ts";
import { loadPref, savePref } from "../prefs.ts";
import { Confetti } from "./confetti.ts";
import { GAME_SHOW_COLORS, GameShowWheelView } from "./gameShowWheel.ts";
import { RETRO_PALETTE, RetroWheelView } from "./retroWheel.ts";
import { WheelSounds, type SoundStyle } from "./sound.ts";
import { TAU, angleToShow, fractionAtPointer, sliceAt, sliceEdges, ticksPassed, type WheelView } from "./wheelView.ts";
import { escapeHtml, flagPlaceholder, formatText, speakerIcon } from "../uiBits.ts";

type Style = SoundStyle;
type Phase = "ready" | "spinning" | "landing" | "result" | "final";

export interface WheelScreenOptions {
  data: WheelData;
  /** The map being loaded, recorded in the nation's creation record. */
  mapName: string;
  /** Resolves when the map has loaded; "Continue to map" waits for it. */
  mapReady: Promise<unknown>;
  /** Fixed random seed (for testing); a random one if not given. */
  seed?: number;
  /** The screen stays hidden until this resolves, then swoops in (for the intro). */
  showWhen?: Promise<void>;
}

/** Shows the wheel screen and resolves with the finished nation when the player continues. */
export function runWheelScreen(opts: WheelScreenOptions): Promise<Nation> {
  return new Promise((resolve) => new WheelScreen(opts, resolve));
}

interface SpinAnimation {
  startedAt: number;
  from: number;
  to: number;
  windup: number;
  overshoot: number;
  /** Phase lengths in seconds: pull back, spin, settle. */
  pull: number;
  main: number;
  settle: number;
  winner: number;
}

const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);
const easeOutQuart = (t: number): number => 1 - (1 - t) ** 4;
const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;

class WheelScreen {
  private readonly data: WheelData;
  private readonly text: (key: string, vars?: Record<string, string | number>) => string;
  private rng: Rng;
  private style: Style = loadPref<string>("wheelStyle", "gameshow") === "retro" ? "retro" : "gameshow";
  private fast = loadPref<boolean>("wheelFast", false);
  private sounds = new WheelSounds(loadPref("muted", false));
  private confetti = new Confetti();
  private views: Partial<Record<Style, WheelView>> = {};

  private step = 0;
  private outcomes: WheelOutcome[] = [];
  private phase: Phase = "ready";
  private angle = 0;
  private speed = 0;
  private spin: SpinAnimation | null = null;
  private winner: number | null = null;
  private winAt = 0;
  private openedAt = performance.now();
  private lastFrame = performance.now();
  private pointerSlice = -1;
  private nation: Nation | null = null;
  /** Number wheels: the range the first spin landed on, and the exact-number wheel after it. */
  private rangeSlice: Slice | null = null;
  private exact: Wheel | null = null;
  private mapLoaded = false;
  private timers: number[] = [];
  private closed = false;

  private root = document.createElement("div");
  private el: Record<string, HTMLElement> = {};

  constructor(
    private opts: WheelScreenOptions,
    private resolve: (nation: Nation) => void,
  ) {
    this.data = opts.data;
    this.text = (key, vars) => formatText(this.data.text[key] ?? key, vars);
    this.rng = createRng(opts.seed);
    this.angle = -TAU * Math.random();
    this.build();
    this.setStyle(this.style, false);
    this.showWheel();
    if (opts.showWhen) {
      this.root.classList.add("waiting");
      opts.showWhen.then(() => {
        this.root.classList.remove("waiting");
        this.root.classList.add("arriving");
        window.setTimeout(() => this.root.classList.remove("arriving"), 1000);
      });
    }
    opts.mapReady.then(
      () => {
        this.mapLoaded = true;
        this.updateContinue();
      },
      () => {},
    );
    requestAnimationFrame(this.frame);
  }

  /** The wheel on screen: the current wheel, or its exact-number wheel. */
  private get wheel(): Wheel {
    return this.exact ?? this.baseWheel;
  }

  private get baseWheel(): Wheel {
    return this.data.wheels[Math.min(this.step, this.data.wheels.length - 1)];
  }

  private get view(): WheelView {
    return (this.views[this.style] ??= this.style === "retro" ? new RetroWheelView() : new GameShowWheelView());
  }

  // ---------------------------------------------------------------- building the page

  private build(): void {
    const t = (key: string): string => escapeHtml(this.text(key));
    const root = this.root;
    root.id = "wheel-screen";
    root.innerHTML = `
      <canvas class="ws-stars"></canvas>
      <div class="ws-rays"></div>
      <header class="ws-top">
        <div class="ws-title"><span class="ws-game">Little Dictators</span><span class="ws-sub">${t("screenTitle")}</span></div>
        <div class="ws-tools">
          <div class="ws-style" role="radiogroup" aria-label="${t("styleLabel")}">
            <button type="button" data-style="retro" role="radio">${t("styleRetro")}</button>
            <button type="button" data-style="gameshow" role="radio">${t("styleGameShow")}</button>
          </div>
          <button type="button" class="ws-fast ws-toggle">${t("fast")}</button>
          <button type="button" class="ws-mute ws-toggle"></button>
        </div>
      </header>
      <main class="ws-main">
        <section class="ws-stage">
          <div class="ws-progress">
            <div class="ws-step"></div>
            <ol class="ws-dots">${this.data.wheels.map(() => "<li></li>").join("")}</ol>
            <div class="ws-wheel-name"></div>
            <div class="ws-question"></div>
          </div>
          <div class="ws-wheel"></div>
          <div class="ws-controls">
            <div class="ws-readout"><div class="ws-readout-label"></div><div class="ws-readout-sub"></div></div>
            <button type="button" class="ws-go"></button>
          </div>
          <div class="ws-hint">${t("spinHint")}</div>
        </section>
        <aside class="ws-card">
          <div class="card-head">
            ${flagPlaceholder(t("flagSoon"))}
            <div class="card-titles">
              <div class="card-kicker">${t("cardTitle")}</div>
              <div class="card-name-row">
                <button type="button" class="card-name" title="${t("renameHint")}" disabled>${t("cardEmpty")}</button>
                <button type="button" class="card-reroll" title="${t("reroll")}" aria-label="${t("reroll")}">${diceIcon()}</button>
              </div>
            </div>
          </div>
          <ol class="card-rows">
            ${this.data.wheels
              .map(
                (w) => `<li data-wheel="${escapeHtml(w.id)}">
                  <span class="row-name">${escapeHtml(w.name)}</span>
                  <span class="row-value">${t("cardEmpty")}</span>
                  <span class="row-est"></span>
                </li>`,
              )
              .join("")}
          </ol>
          <div class="card-final">
            <button type="button" class="card-continue"></button>
            <button type="button" class="card-restart">${t("startOver")}</button>
          </div>
        </aside>
      </main>`;
    const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
    this.el = {
      stars: q(".ws-stars"),
      step: q(".ws-step"),
      dots: q(".ws-dots"),
      wheelName: q(".ws-wheel-name"),
      question: q(".ws-question"),
      wheel: q(".ws-wheel"),
      readout: q(".ws-readout"),
      readoutLabel: q(".ws-readout-label"),
      readoutSub: q(".ws-readout-sub"),
      go: q(".ws-go"),
      fast: q(".ws-fast"),
      mute: q(".ws-mute"),
      card: q(".ws-card"),
      rows: q(".card-rows"),
      name: q(".card-name"),
      reroll: q(".card-reroll"),
      cont: q(".card-continue"),
      restart: q(".card-restart"),
    };
    root.append(this.confetti.canvas);
    document.body.append(root);

    // The first click or key press is what lets the browser play sound.
    root.addEventListener("pointerdown", () => this.sounds.unlock(), { capture: true });
    window.addEventListener("keydown", this.onKey);

    root.querySelectorAll<HTMLButtonElement>(".ws-style button").forEach((b) =>
      b.addEventListener("click", () => {
        b.blur();
        this.setStyle(b.dataset.style as Style, true);
      }),
    );
    this.el.fast.addEventListener("click", () => {
      this.el.fast.blur();
      this.fast = !this.fast;
      savePref("wheelFast", this.fast);
      this.sounds.click(this.style);
      this.updateToggles();
    });
    this.el.mute.addEventListener("click", () => {
      this.el.mute.blur();
      this.sounds.muted = !this.sounds.muted;
      savePref("muted", this.sounds.muted);
      this.sounds.click(this.style);
      this.updateToggles();
    });
    this.el.go.addEventListener("click", () => this.mainAction());
    this.el.wheel.addEventListener("click", () => {
      if (this.phase === "ready" || this.phase === "result") this.mainAction();
    });
    this.el.name.addEventListener("click", () => this.rename());
    this.el.reroll.addEventListener("click", () => this.rerollName());
    this.el.cont.addEventListener("click", () => this.finish());
    this.el.restart.addEventListener("click", () => this.startOver());

    new ResizeObserver(() => this.resize()).observe(this.el.wheel);
    window.addEventListener("resize", this.drawStars);
    this.updateToggles();
  }

  private resize(): void {
    const box = this.el.wheel;
    this.view.resize(box.clientWidth, box.clientHeight);
    // Centre the game show's light rays on the wheel.
    const rect = this.view.canvas.getBoundingClientRect();
    this.root.style.setProperty("--cx", `${rect.left + rect.height / 2}px`);
    this.root.style.setProperty("--cy", `${rect.top + rect.height / 2}px`);
  }

  private setStyle(style: Style, byPlayer: boolean): void {
    if (this.phase === "spinning" || this.phase === "landing") return;
    this.style = style;
    savePref("wheelStyle", style);
    this.root.classList.toggle("style-retro", style === "retro");
    this.root.classList.toggle("style-gameshow", style === "gameshow");
    this.root.querySelectorAll<HTMLButtonElement>(".ws-style button").forEach((b) => {
      b.setAttribute("aria-checked", String(b.dataset.style === style));
    });
    const view = this.view;
    view.setWheel(this.wheel);
    this.el.wheel.replaceChildren(view.canvas);
    this.resize();
    this.drawStars();
    if (byPlayer) this.sounds.click(style);
  }

  private updateToggles(): void {
    this.el.fast.setAttribute("aria-pressed", String(this.fast));
    const muted = this.sounds.muted;
    this.el.mute.setAttribute("aria-pressed", String(muted));
    this.el.mute.innerHTML = speakerIcon(muted);
    this.el.mute.title = muted ? this.text("unmute") : this.text("mute");
    this.el.mute.setAttribute("aria-label", this.el.mute.title);
  }

  /** The pixel night sky behind the retro wheel: a dithered gradient with stars. */
  private drawStars = (): void => {
    const canvas = this.el.stars as HTMLCanvasElement;
    if (this.style !== "retro") return;
    const scale = 4;
    const w = Math.ceil(window.innerWidth / scale);
    const h = Math.ceil(window.innerHeight / scale);
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d")!;
    const bands = ["#0b1020", "#101a33", "#142340", "#1b2f52"];
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let y = 0; y < h; y++) {
      const v = (y / h) * (bands.length - 1);
      for (let x = 0; x < w; x++) {
        const k = Math.min(bands.length - 1, Math.floor(v + (bayer[(y & 3) * 4 + (x & 3)] + 0.5) / 16));
        g.fillStyle = bands[k];
        g.fillRect(x, y, 1, 1);
      }
    }
    // Stars at fixed spots (a tiny hash), so they don't jump when the window changes size.
    for (let i = 0; i < 140; i++) {
      const hx = Math.sin(i * 127.1) * 43758.5453;
      const hy = Math.sin(i * 311.7) * 43758.5453;
      const x = Math.floor((hx - Math.floor(hx)) * w);
      const y = Math.floor((hy - Math.floor(hy)) * h * 0.85);
      g.fillStyle = i % 7 === 0 ? "#fbe48a" : i % 3 === 0 ? "#7fb4e6" : "#c9d6e8";
      g.fillRect(x, y, 1, 1);
      if (i % 11 === 0) {
        g.fillRect(x - 1, y, 3, 1);
        g.fillRect(x, y - 1, 1, 3);
      }
    }
  };

  // ---------------------------------------------------------------- the flow

  /** Shows the current wheel and its place in the progress bar. */
  private showWheel(): void {
    const wheel = this.wheel;
    const total = this.data.wheels.length;
    this.el.step.textContent = this.text(this.exact ? "spinOfExact" : "spinOf", { n: this.step + 1, total });
    this.el.wheelName.textContent = wheel.name;
    this.el.question.textContent = wheel.question ?? "";
    [...this.el.dots.children].forEach((dot, i) => {
      dot.classList.toggle("done", i < this.step);
      dot.classList.toggle("current", i === this.step);
    });
    [...this.el.rows.children].forEach((row, i) => row.classList.toggle("current", i === this.step));
    this.view.setWheel(wheel);
    this.winner = null;
    this.pointerSlice = -1;
    this.setReadout("?", "", false);
    this.phase = "ready";
    this.updateGo();
  }

  private updateGo(): void {
    const go = this.el.go as HTMLButtonElement;
    const last = this.step >= this.data.wheels.length - 1;
    const label: Record<Phase, string> = {
      ready: this.text("spin"),
      spinning: this.text("spinning"),
      landing: this.text("spinning"),
      result: this.rangeSlice && !this.exact ? this.text("exact") : last ? this.text("finish") : this.text("next"),
      final: "",
    };
    go.textContent = label[this.phase];
    go.disabled = this.phase === "spinning" || this.phase === "landing";
    go.classList.toggle("next", this.phase === "result");
  }

  private setReadout(label: string, sub: string, result: boolean): void {
    this.el.readoutLabel.textContent = label;
    this.el.readoutSub.textContent = sub;
    this.el.readout.classList.toggle("result", result);
    if (result) {
      this.el.readout.classList.remove("pop");
      void this.el.readout.offsetWidth; // restart the CSS animation
      this.el.readout.classList.add("pop");
    }
  }

  private mainAction(): void {
    this.sounds.unlock();
    if (this.phase === "ready") this.startSpin();
    else if (this.phase === "result") this.next();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.closed || e.repeat || this.root.classList.contains("waiting")) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, button, [contenteditable]")) return;
    if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
      e.preventDefault();
      this.sounds.unlock();
      if (this.phase === "final") {
        if (e.code !== "Space") this.finish();
      } else this.mainAction();
    }
  };

  private startSpin(): void {
    const result = spinWheel(this.wheel, this.rng);
    const edges = sliceEdges(this.wheel);
    const fast = this.fast;
    const turns = fast ? 1 : 4 + Math.floor(Math.random() * 3);
    const to = angleToShow(result.stopAt, this.angle) + turns * TAU;
    // Overshoot a touch and roll back, but never far enough to leave the winning slice.
    const room = (result.stopAt - edges[result.index]) * TAU;
    this.spin = {
      startedAt: performance.now(),
      from: this.angle,
      to,
      windup: fast ? 0 : 0.12,
      overshoot: fast ? 0 : Math.min(0.05, room * 0.6),
      pull: fast ? 0 : 0.28,
      main: fast ? 0.7 : 3.4 + Math.random() * 1.1,
      settle: fast ? 0 : 0.45,
      winner: result.index,
    };
    const base = this.baseWheel;
    if (this.exact) this.outcomes[this.step] = makeOutcome(base, this.rangeSlice!, { wheel: this.exact, slice: result.slice });
    else if (base.estimate) this.rangeSlice = result.slice; // a number wheel: the exact number is the next spin
    else this.outcomes[this.step] = makeOutcome(base, result.slice);
    this.phase = "spinning";
    this.root.classList.add("spinning");
    this.updateGo();
    this.sounds.spinStart(this.style);
  }

  /** The wheel's angle during a spin, `t` seconds in. Returns null when it's finished. */
  private spinAngle(s: SpinAnimation, t: number): number | null {
    if (t < s.pull) return s.from - s.windup * easeOutQuad(t / s.pull);
    t -= s.pull;
    const start = s.from - s.windup;
    if (t < s.main) return start + (s.to + s.overshoot - start) * easeOutQuart(t / s.main);
    t -= s.main;
    if (t < s.settle) return s.to + s.overshoot * (1 - easeInOutSine(t / s.settle));
    return null;
  }

  private landed(): void {
    const s = this.spin!;
    this.spin = null;
    this.angle = s.to;
    this.speed = 0;
    this.winner = s.winner;
    this.winAt = performance.now();
    this.phase = "landing";
    this.root.classList.remove("spinning");
    if (this.rangeSlice && !this.exact) {
      this.landedOnRange(this.rangeSlice);
      return;
    }
    const outcome = this.outcomes[this.step];
    const { main, sub } = describeOutcome(outcome);
    this.setReadout(main, [sub, outcome.blurb].filter(Boolean).join(" · "), true);
    this.sounds.win(this.style);
    this.celebrate(false);
    this.later(this.fast ? 250 : 750, () => this.flyToCard(outcome));
  }

  /** A number wheel's first spin: show the range (also on the card), then on to the exact number. */
  private landedOnRange(slice: Slice): void {
    this.setReadout(slice.shown, slice.blurb ?? "", true);
    this.sounds.win(this.style);
    this.celebrate(false);
    const row = this.el.rows.children[this.step] as HTMLElement;
    this.later(this.fast ? 150 : 600, () => {
      row.querySelector(".row-est")!.textContent = slice.shown;
      row.classList.remove("flash");
      void row.offsetWidth;
      row.classList.add("flash");
      this.sounds.thunk(this.style);
      this.phase = "result";
      this.updateGo();
      if (this.fast) this.later(120, () => this.phase === "result" && this.next());
    });
  }

  private celebrate(big: boolean): void {
    if (this.style === "gameshow") {
      const rect = this.view.canvas.getBoundingClientRect();
      const tip = this.view.pointerTip();
      this.confetti.burst(rect.left + tip.x, rect.top + tip.y, GAME_SHOW_COLORS, {
        count: big ? 260 : 110,
        direction: -Math.PI / 2,
        spread: big ? Math.PI * 1.4 : Math.PI * 0.9,
        power: big ? 1.3 : 0.9,
      });
      if (big) {
        this.confetti.burst(0, window.innerHeight * 0.7, GAME_SHOW_COLORS, { count: 120, direction: -Math.PI / 3, spread: 0.6, power: 1.6 });
        this.confetti.burst(window.innerWidth, window.innerHeight * 0.7, GAME_SHOW_COLORS, { count: 120, direction: (-Math.PI * 2) / 3, spread: 0.6, power: 1.6 });
      }
    } else {
      const rect = (big ? this.el.card : this.view.canvas).getBoundingClientRect();
      const tip = big ? { x: rect.width / 2, y: rect.height * 0.2 } : this.view.pointerTip();
      const pixel = Math.max(2, Math.round((this.view as RetroWheelView).pixelSize));
      const colors = [...RETRO_PALETTE.studOn, RETRO_PALETTE.slices[0][2], RETRO_PALETTE.slices[2][2], RETRO_PALETTE.text];
      this.confetti.burst(rect.left + tip.x, rect.top + tip.y, colors, { count: big ? 160 : 60, pixel, power: big ? 1.1 : 0.7, spread: Math.PI * 1.3 });
    }
  }

  /** The result flies from under the wheel onto its row of the nation card. */
  private flyToCard(outcome: WheelOutcome): void {
    const row = this.el.rows.children[this.step] as HTMLElement;
    const value = row.querySelector<HTMLElement>(".row-value")!;
    const from = this.el.readoutLabel.getBoundingClientRect();
    const to = value.getBoundingClientRect();
    const chip = document.createElement("div");
    chip.className = "ws-chip";
    chip.textContent = describeOutcome(outcome).main;
    this.root.append(chip);
    const cw = chip.offsetWidth;
    const ch = chip.offsetHeight;
    const fx = from.left + from.width / 2 - cw / 2;
    const fy = from.top + from.height / 2 - ch / 2;
    const tx = to.left + Math.min(to.width, cw * 0.7) / 2 - cw / 2;
    const ty = to.top + to.height / 2 - ch / 2;
    const anim = chip.animate(
      [
        { transform: `translate(${fx}px, ${fy}px) scale(1)`, opacity: 1 },
        { transform: `translate(${(fx + tx) / 2}px, ${Math.min(fy, ty) - 60}px) scale(1.1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${tx}px, ${ty}px) scale(0.7)`, opacity: 0.6 },
      ],
      { duration: this.fast ? 280 : 560, easing: "cubic-bezier(.45,.05,.55,.95)" },
    );
    const land = (): void => {
      chip.remove();
      this.fillRow(row, outcome);
      this.sounds.thunk(this.style);
      this.phase = "result";
      this.updateGo();
      if (this.fast) this.later(120, () => this.phase === "result" && this.next());
    };
    anim.finished.then(land, land);
  }

  private fillRow(row: HTMLElement, outcome: WheelOutcome): void {
    const { main, sub } = describeOutcome(outcome);
    row.querySelector(".row-value")!.textContent = main;
    row.querySelector(".row-est")!.textContent = sub;
    row.classList.add("filled");
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
  }

  private next(): void {
    this.sounds.click(this.style);
    if (this.rangeSlice && !this.exact) {
      this.exact = exactWheel(this.baseWheel, this.rangeSlice, this.data);
    } else {
      this.exact = null;
      this.rangeSlice = null;
      if (this.step >= this.data.wheels.length - 1) {
        this.reveal();
        return;
      }
      this.step++;
    }
    const box = this.el.wheel;
    const out = box.animate([{ transform: "none", opacity: 1 }, { transform: "scale(0.6) rotate(-25deg)", opacity: 0 }], {
      duration: this.fast ? 90 : 200,
      easing: "ease-in",
    });
    this.phase = "landing";
    this.updateGo();
    const swap = (): void => {
      this.showWheel();
      box.animate([{ transform: "scale(0.6) rotate(25deg)", opacity: 0 }, { transform: "none", opacity: 1 }], {
        duration: this.fast ? 120 : 340,
        easing: "cubic-bezier(.3,1.6,.6,1)",
      });
    };
    out.finished.then(swap, swap);
  }

  // ---------------------------------------------------------------- the finished nation

  private reveal(): void {
    const nation = createNation(this.data, this.outcomes, this.opts.mapName, this.rng);
    this.nation = nation;
    const card = this.el.card;
    const before = card.getBoundingClientRect();
    this.phase = "final";
    this.root.classList.add("final");
    [...this.el.rows.children].forEach((row) => row.classList.remove("current"));
    (this.el.name as HTMLButtonElement).disabled = false;
    const after = card.getBoundingClientRect();
    card.animate(
      [
        { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width})`, transformOrigin: "top left" },
        { transform: "none", transformOrigin: "top left" },
      ],
      { duration: 650, easing: "cubic-bezier(.2,.9,.25,1.05)" },
    );
    this.scrambleName(nation.name, 1100);
    this.updateContinue();
    this.later(250, () => {
      this.sounds.reveal(this.style);
      this.celebrate(true);
    });
  }

  private updateContinue(): void {
    const cont = this.el.cont as HTMLButtonElement;
    cont.disabled = !this.mapLoaded;
    cont.textContent = this.mapLoaded ? this.text("continue") : this.text("loadingMap");
  }

  /** Letters flicker through random ones before settling on the name, left to right. */
  private scrambleName(name: string, ms: number): void {
    const el = this.el.name;
    const start = performance.now();
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const tick = (): void => {
      if (this.nation?.name !== name) return; // a newer name took over
      const p = Math.min(1, (performance.now() - start) / ms);
      const settled = Math.floor(p * name.length);
      el.textContent = [...name]
        .map((c, i) => (i < settled || c === " " ? c : letters[Math.floor(Math.random() * letters.length)]))
        .join("");
      if (p < 1) requestAnimationFrame(tick);
    };
    tick();
  }

  private rerollName(): void {
    if (!this.nation) return;
    this.sounds.click(this.style);
    let name = this.nation.name;
    for (let tries = 0; tries < 5 && name === this.nation.name; tries++)
      name = generateName(this.data.names, this.nation.results.government?.sliceId, this.rng);
    this.nation.name = name;
    this.scrambleName(name, 500);
    const btn = this.el.reroll;
    btn.classList.remove("roll");
    void btn.offsetWidth;
    btn.classList.add("roll");
  }

  /** Click the name to type your own. Enter or clicking away keeps it, Esc cancels. */
  private rename(): void {
    const nation = this.nation;
    if (!nation || this.phase !== "final") return;
    const button = this.el.name;
    const input = document.createElement("input");
    input.className = "card-name-input";
    input.value = nation.name;
    input.maxLength = 48;
    input.setAttribute("aria-label", this.text("renameHint"));
    button.hidden = true;
    button.after(input);
    input.focus();
    input.select();
    let done = false;
    const close = (keep: boolean): void => {
      if (done) return;
      done = true;
      const name = input.value.trim().replace(/\s+/g, " ");
      if (keep && name) nation.name = name;
      button.textContent = nation.name;
      input.remove();
      button.hidden = false;
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") close(true);
      else if (e.key === "Escape") close(false);
      e.stopPropagation();
    });
    input.addEventListener("blur", () => close(true));
  }

  private startOver(): void {
    this.sounds.click(this.style);
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.confetti.clear();
    this.rng = createRng();
    this.outcomes = [];
    this.nation = null;
    this.rangeSlice = null;
    this.exact = null;
    this.step = 0;
    this.root.classList.remove("final");
    const name = this.el.name as HTMLButtonElement;
    name.textContent = this.text("cardEmpty");
    name.disabled = true;
    [...this.el.rows.children].forEach((row) => {
      row.classList.remove("filled", "flash");
      row.querySelector(".row-value")!.textContent = this.text("cardEmpty");
      row.querySelector(".row-est")!.textContent = "";
    });
    this.showWheel();
  }

  private finish(): void {
    if (!this.nation || !this.mapLoaded || this.closed) return;
    this.closed = true;
    this.sounds.click(this.style);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("resize", this.drawStars);
    const nation = this.nation;
    const fade = this.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: "ease-in" });
    const done = (): void => {
      this.root.remove();
      this.resolve(nation);
    };
    fade.finished.then(done, done);
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  // ---------------------------------------------------------------- every frame

  private frame = (now: number): void => {
    if (this.closed) return;
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const prev = this.angle;
    if (this.spin) {
      const a = this.spinAngle(this.spin, (now - this.spin.startedAt) / 1000);
      if (a === null) this.landed();
      else this.angle = a;
    }
    this.speed = dt > 0 ? Math.abs(this.angle - prev) / dt : 0;

    const view = this.view;
    if (this.angle !== prev) {
      const edges = sliceEdges(this.wheel);
      const slice = sliceAt(edges, fractionAtPointer(this.angle));
      if (ticksPassed(view.tickStops(), prev, this.angle) > 0) {
        view.onTick();
        this.sounds.tick(this.style, slice, this.speed);
      }
      if (slice !== this.pointerSlice && this.phase === "spinning") {
        this.pointerSlice = slice;
        this.el.readoutLabel.textContent = this.wheel.slices[slice].shown;
        this.el.readoutSub.textContent = "";
      }
    }
    if (this.phase !== "final") {
      view.draw({
        angle: this.angle,
        speed: this.speed,
        dt,
        time: (now - this.openedAt) / 1000,
        winner: this.winner,
        winTime: (now - this.winAt) / 1000,
      });
    }
    requestAnimationFrame(this.frame);
  };
}

function diceIcon(): string {
  return `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" shape-rendering="crispEdges">
    <rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor" opacity=".2"/>
    <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor"/>
    <rect x="4" y="4" width="2" height="2" fill="currentColor"/><rect x="10" y="4" width="2" height="2" fill="currentColor"/>
    <rect x="7" y="7" width="2" height="2" fill="currentColor"/>
    <rect x="4" y="10" width="2" height="2" fill="currentColor"/><rect x="10" y="10" width="2" height="2" fill="currentColor"/></svg>`;
}
