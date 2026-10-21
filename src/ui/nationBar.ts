// The strip across the top of the screen: your own nation's key numbers at a glance (money,
// people, stability, popularity, army, development and the ideology mix) and the Army button.
// Point at a number to see where it comes from; click the name to open your nation.

import "./nationBar.css";
import type { StatSheet, StatsData } from "../game/stats.ts";
import { escapeHtml, hoverTips } from "./uiBits.ts";
import { badge, icon, ideologyColor, scoreColor, statIcon } from "./icons.ts";

export interface NationBarInfo {
  name: string;
  color: string;
  sheet: StatSheet;
  data: StatsData;
  /** How many divisions its army has on the map. */
  divisions: number;
}

const bar = document.createElement("header");
bar.id = "nation-bar";
bar.hidden = true;
let current: NationBarInfo | null = null;

/** Sets up the strip (once): `open` runs when the player clicks their nation's name, `army` on the Army button. */
export function initNationBar(handlers: { open: () => void; army: () => void }): void {
  document.body.append(bar);
  bar.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    if (el.closest(".nb-head")) handlers.open();
    else if (el.closest(".nb-army")) handlers.army();
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
    <button type="button" class="nb-army" title="Your divisions; ask for new or bigger ones">${icon("swords")}Army <span class="nb-count">${info.divisions}</span></button>`;
  bar.querySelector(".nb-name")!.textContent = info.name;
  bar.hidden = false;
  document.body.classList.add("has-strip");
}

/** Hides the strip while the wheel screen is up (it comes back with showNationBar). */
export function setNationBarHidden(hidden: boolean): void {
  bar.hidden = hidden || !current;
  document.body.classList.toggle("has-strip", !bar.hidden);
}
