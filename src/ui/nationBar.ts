// The strip across the top of the screen: your own nation's key numbers at a glance (money,
// people, stability, popularity, army, development and the ideology mix), and at its right end
// the date with the speed buttons and your influence points. Point at a number to see where it
// comes from; click the name to open your nation.

import "./nationBar.css";
import type { StatSheet, StatsData } from "../game/stats.ts";
import { escapeHtml, hoverTips } from "./uiBits.ts";
import { badge, icon, ideologyColor, scoreColor, statIcon } from "./icons.ts";

export interface NationBarInfo {
  name: string;
  color: string;
  sheet: StatSheet;
  data: StatsData;
  /** The running clock: date, speed (0 = paused), the speed choices, and your influence. */
  clock?: { date: string; speed: number; speeds: number[]; influence: number; perMonth: number };
}

const bar = document.createElement("header");
bar.id = "nation-bar";
bar.hidden = true;
let current: NationBarInfo | null = null;

/** Sets up the strip (once): `open` runs when the player clicks their nation's name, `speed` on a speed button. */
export function initNationBar(handlers: { open: () => void; speed: (i: number) => void }): void {
  document.body.append(bar);
  bar.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    if (el.closest(".nb-head")) handlers.open();
    const sp = el.closest<HTMLElement>("[data-speed]");
    if (sp) handlers.speed(Number(sp.dataset.speed));
  });
  hoverTips(bar, "[data-stat]", (el) => {
    const stat = current?.sheet.stats[el.dataset.stat as keyof StatSheet["stats"]];
    if (!stat) return null;
    // Money shows the treasury and the yearly change together.
    const extra = stat.id === "treasury" ? ["", `${current!.sheet.stats.net.name}: ${current!.sheet.stats.net.text}`, ...current!.sheet.stats.net.why] : [];
    return { title: `${stat.name} · ${stat.text}`, text: [...stat.why, ...extra].join("\n"), small: stat.about, kind: "wide" };
  });
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());
  bar.addEventListener("wheel", (e) => e.stopPropagation());
}

/** Shows (or updates) the strip for your nation; null hides it. */
export function showNationBar(info: NationBarInfo | null): void {
  current = info;
  if (!info) {
    bar.hidden = true;
    document.body.classList.remove("has-strip");
    return;
  }
  const s = info.sheet.stats;
  const delta = (v: number, text: string): string =>
    `<span class="nb-delta ${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${escapeHtml(text.replace(/^[+−-]/, ""))}</span>`;
  const meter = (v: number): string => `<span class="nb-meter"><span style="width:${Math.max(2, Math.min(100, v))}%;background:${scoreColor(v)}"></span></span>`;
  const item = (id: keyof StatSheet["stats"], label: string, value: string): string =>
    `<div class="nb-item" data-stat="${id}" tabindex="0">${statIcon(s[id])}<span class="nb-text"><span class="nb-label">${escapeHtml(label)}</span><span class="nb-value">${value}</span></span></div>`;
  const score = (id: "stability" | "popularity" | "development", label: string): string =>
    item(id, label, `<b style="color:${scoreColor(s[id].value)}">${Math.round(s[id].value)}</b>${meter(s[id].value)}`);

  const options = info.data.ideology?.options ?? [];
  const colorOf = (id: string): string => {
    const i = options.findIndex((o) => o.id === id);
    return ideologyColor(i >= 0 ? i : id.length, id);
  };
  const mix = info.sheet.ideologies;
  const segments = mix.map((m) => `<span style="width:${(m.share * 100).toFixed(1)}%;background:${colorOf(m.id)}"></span>`).join("");
  const main = mix[0];

  bar.innerHTML = `
    <button type="button" class="nb-head" title="Open your nation">
      <span class="nb-flag" style="background:${escapeHtml(info.color)}"></span>
      <span class="nb-title"><span class="nb-you">Your nation</span><span class="nb-name"></span></span>
    </button>
    <div class="nb-items">
      ${item("treasury", "Treasury", `<b>${escapeHtml(s.treasury.text)}</b>${delta(s.net.value, s.net.text)}`)}
      ${item("population", "Population", `<b>${escapeHtml(s.population.text)}</b>${delta(s.growth.value, s.growth.text)}`)}
      ${score("stability", "Stability")}
      ${score("popularity", "Popularity")}
      ${item("army", "Army", `<b>${escapeHtml(s.army.text)}</b><span class="nb-sub">/ ${escapeHtml(s.manpower.text)}</span>`)}
      ${score("development", "Development")}
      ${
        main
          ? `<div class="nb-item nb-ideology" data-stat="ideology" tabindex="0">${badge("flag", colorOf(main.id))}<span class="nb-text"><span class="nb-label">Ideology</span><span class="nb-value"><b>${escapeHtml(main.label)} ${Math.round(main.share * 100)}%</b></span><span class="nb-stack">${segments}</span></span></div>`
          : ""
      }
    </div>
    ${info.clock ? clockHtml(info.clock) : ""}`;
  bar.querySelector(".nb-name")!.textContent = info.name;
  bar.hidden = false;
  document.body.classList.add("has-strip");
}

/** Hides the strip while the wheel screen is up (it comes back with showNationBar). */
export function setNationBarHidden(hidden: boolean): void {
  bar.hidden = hidden || !current;
  document.body.classList.toggle("has-strip", !bar.hidden);
}

function clockHtml(c: NonNullable<NationBarInfo["clock"]>): string {
  const speeds = [`<button type="button" data-speed="0" class="paused${c.speed === 0 ? " on" : ""}" title="Pause (Space)">❚❚</button>`]
    .concat(c.speeds.map((x, i) => `<button type="button" data-speed="${i + 1}" class="${c.speed === i + 1 ? "on" : ""}" title="Speed ×${x} (key ${i + 1})">${"▶".repeat(Math.min(3, i + 1))}</button>`))
    .join("");
  return `<div class="nb-influence" title="Influence: what you spend to push your nation (build, recruit, war, peace, relations, brushes). You get about ${c.perMonth.toFixed(1)} a month, more when it's stable and likes its ruler.">${icon("star")}${Math.floor(c.influence)}</div>
    <div class="nb-clock"><span class="nb-date">${escapeHtml(c.date)}</span><div class="nb-speeds">${speeds}</div></div>`;
}
