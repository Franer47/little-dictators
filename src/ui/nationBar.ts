// The bar in the top-left corner: your own nation's key numbers at a glance (money,
// people, stability, popularity, army, development and the ideology mix). Point at a number
// to see where it comes from; click the name to open your nation in the corner panel.

import "./nationBar.css";
import type { StatSheet, StatsData } from "../game/stats.ts";
import { escapeHtml, hoverTips } from "./uiBits.ts";
import { STAT_ICONS, icon, ideologyColor, scoreColor } from "./icons.ts";

export interface NationBarInfo {
  name: string;
  color: string;
  sheet: StatSheet;
  data: StatsData;
}

const bar = document.createElement("div");
bar.id = "nation-bar";
bar.hidden = true;
let current: NationBarInfo | null = null;
let onOpen: () => void = () => {};

/** Sets up the bar (once); `open` runs when the player clicks their nation's name. */
export function initNationBar(open: () => void): void {
  onOpen = open;
  document.body.append(bar);
  bar.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".nb-head")) onOpen();
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

/** Shows (or updates) the bar for your nation; null hides it. */
export function showNationBar(info: NationBarInfo | null): void {
  current = info;
  if (!info) {
    bar.hidden = true;
    return;
  }
  const s = info.sheet.stats;
  const signed = (v: number, text: string): string => `<span class="nb-delta ${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${escapeHtml(text.replace(/^[+−-]/, ""))}</span>`;
  const meter = (v: number): string =>
    `<span class="nb-meter"><span style="width:${Math.max(2, Math.min(100, v))}%;background:${scoreColor(v)}"></span></span>`;
  const row = (id: keyof StatSheet["stats"], label: string, value: string, extra = ""): string =>
    `<div class="nb-row" data-stat="${id}" tabindex="0">${icon(STAT_ICONS[id])}<span class="nb-label">${escapeHtml(label)}</span><span class="nb-value">${value}</span>${extra}</div>`;
  const score = (id: "stability" | "popularity" | "development", label: string): string =>
    row(id, label, `${meter(s[id].value)}<b style="color:${scoreColor(s[id].value)}">${Math.round(s[id].value)}</b>`);

  const options = info.data.ideology?.options ?? [];
  const colorOf = (id: string): string => {
    const i = options.findIndex((o) => o.id === id);
    return ideologyColor(i >= 0 ? i : hash(id), id);
  };
  const mix = info.sheet.ideologies;
  const segments = mix.map((m) => `<span style="width:${(m.share * 100).toFixed(1)}%;background:${colorOf(m.id)}"></span>`).join("");
  const legend = mix
    .slice(0, 3)
    .map((m) => `<span class="nb-legend-item"><i style="background:${colorOf(m.id)}"></i>${escapeHtml(m.label)} ${Math.round(m.share * 100)}%</span>`)
    .join("");

  bar.innerHTML = `
    <button type="button" class="nb-head" title="Open your nation">
      <span class="nb-flag" style="background:${escapeHtml(info.color)}"></span>
      <span class="nb-title"><span class="nb-you">Your nation</span><span class="nb-name"></span></span>
    </button>
    <div class="nb-rows">
      ${row("treasury", "Treasury", `<b>${escapeHtml(s.treasury.text)}</b>`, signed(s.net.value, s.net.text))}
      ${row("population", "Population", `<b>${escapeHtml(s.population.text)}</b>`, signed(s.growth.value, s.growth.text))}
      ${score("stability", "Stability")}
      ${score("popularity", "Popularity")}
      ${row("army", "Army", `<b>${escapeHtml(s.army.text)}</b>`, `<span class="nb-sub">of ${escapeHtml(s.manpower.text)}</span>`)}
      ${score("development", "Development")}
      ${mix.length ? `<div class="nb-ideology" data-stat="ideology" tabindex="0"><div class="nb-row-top">${icon(STAT_ICONS.ideology)}<span class="nb-label">Ideology</span></div><div class="nb-stack">${segments}</div><div class="nb-legend">${legend}</div></div>` : ""}
    </div>`;
  bar.querySelector(".nb-name")!.textContent = info.name;
  bar.hidden = false;
}

/** Hides the bar while the wheel screen is up (it comes back with showNationBar). */
export function setNationBarHidden(hidden: boolean): void {
  bar.hidden = hidden || !current;
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}
