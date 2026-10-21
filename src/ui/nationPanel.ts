// The nation panel in the bottom-right corner of the map: flag placeholder, name and a few
// key results. Click it to open the creation record (everything rolled for the nation).
// One nation at a time: showing another replaces it (click a nation on the map).
// Above it, once the nation has land, its stat sheet (src/game/stats.ts): point at a stat
// (or tab to it) to see where the number comes from.

import "./nationPanel.css";
import { describeOutcome, type Nation } from "../game/nation.ts";
import { resultGroups, type WheelData } from "../game/wheels.ts";
import type { StatSheet, StatsData } from "../game/stats.ts";
import { escapeHtml, flagPlaceholder, formatText, hoverTips, nationChart, oddsText, outcomeTip } from "./uiBits.ts";
import { loadPref, savePref } from "./prefs.ts";

export interface PanelExtras {
  /** The nation's colour, shown as its flag. */
  color?: string;
  /**
   * Its land on the map: the rolled size, what it was meant to get where it started (the roll
   * evened out for the latitude) and what it actually got (km²; none until it's placed).
   */
  land?: { rolled: number; target?: number; actual?: number };
  /** Its stat sheet (none until it's placed). */
  stats?: { sheet: StatSheet; data: StatsData };
}

/** Removes the panel's window listeners when the panel is replaced. */
let lastPanel: AbortController | null = null;

export function showNationPanel(nation: Nation, data: WheelData, extras: PanelExtras = {}): void {
  closeNationPanel();
  const listeners = (lastPanel = new AbortController());
  const text = (key: string, vars?: Record<string, string | number>): string => escapeHtml(formatText(data.text[key] ?? key, vars));
  const panel = document.createElement("div");
  panel.id = "nation-panel";

  const facts = data.panel.show
    .map((id) => nation.results[id])
    .filter(Boolean)
    .map((r) => `<li><span class="np-fact-name">${escapeHtml(r.resultName)}</span> ${escapeHtml(describeOutcome(r).main)}</li>`)
    .join("");
  const landFact = extras.land
    ? `<li><span class="np-fact-name">${text("panelLand")}</span> ${escapeHtml(landText(extras.land, data))}</li>`
    : "";

  const created = new Date(nation.record.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  // The record lists every result in the card's groups, with its odds.
  const groups = resultGroups(data)
    .map((group) => {
      const rows = group.wheels
        .map((id) => nation.results[id])
        .filter(Boolean)
        .map((r) => {
          const { main, sub } = describeOutcome(r);
          return `<tr data-wheel="${escapeHtml(r.wheelId)}" tabindex="0"${r.rare ? ' class="np-rare"' : r.golden || r.estimate?.boost ? ' class="np-golden"' : ""}>
            <th scope="row">${escapeHtml(r.resultName)}</th>
            <td><div class="np-result">${escapeHtml(main)}</div>${sub ? `<div class="np-est">${escapeHtml(sub)}</div>` : ""}</td>
            <td class="np-odds">${text("recordOdds", { chance: oddsText(r.chance * (r.exactChance ?? 1)) })}</td>
          </tr>`;
        })
        .join("");
      return rows ? `<tbody><tr class="np-group"><th colspan="3" scope="rowgroup">${escapeHtml(group.name)}</th></tr>${rows}</tbody>` : "";
    })
    .join("");

  panel.innerHTML = `
    <section class="np-record" hidden role="dialog" aria-labelledby="np-record-title">
      <header>
        <h2 id="np-record-title">${text("recordTitle")}</h2>
        <button type="button" class="np-close" aria-label="${text("close")}" title="${text("close")} (Esc)">×</button>
      </header>
      <div class="np-record-body">
        <div class="np-record-name"></div>
        <table>${groups}</table>
        ${data.chart ? nationChart(data.chart, nation.record.chart, data.text.chartTitle ?? "") : ""}
        <dl>
          ${nation.record.goldenChance !== undefined ? `<dt>${text("recordGolden")}</dt><dd>${(nation.record.goldenChance * 100).toFixed(1)}%</dd>` : ""}
          ${extras.land?.actual !== undefined ? `<dt>${text("recordLandTaken")}</dt><dd>${escapeHtml(landText(extras.land, data))}</dd>` : ""}
          <dt>${text("recordFirstName")}</dt><dd>${escapeHtml(nation.record.firstName)}</dd>
          <dt>${text("recordEra")}</dt><dd>${escapeHtml(data.eraName)}</dd>
          <dt>${text("recordCreated")}</dt><dd>${escapeHtml(created)}</dd>
          <dt>${text("recordMap")}</dt><dd>${escapeHtml(nation.record.map)}</dd>
          <dt>${text("recordSeed")}</dt><dd>${nation.record.seed}</dd>
        </dl>
      </div>
    </section>
    ${extras.stats ? statsBox(extras.stats.sheet, extras.stats.data) : ""}
    <button type="button" class="np-summary" title="${text("panelHint")}" aria-expanded="false">
      ${flagPlaceholder((extras.color ? data.text.flagColor : data.text.flagSoon) ?? "", extras.color)}
      <span class="np-text">
        <span class="np-name"></span>
        <ul class="np-facts">${landFact}${facts}</ul>
      </span>
    </button>`;
  panel.querySelector(".np-name")!.textContent = nation.name;
  panel.querySelector(".np-record-name")!.textContent = nation.name;
  document.body.append(panel);

  const record = panel.querySelector<HTMLElement>(".np-record")!;
  const summary = panel.querySelector<HTMLButtonElement>(".np-summary")!;
  const statsEl = panel.querySelector<HTMLElement>(".np-stats");
  const setOpen = (open: boolean): void => {
    record.hidden = !open;
    // The record and the stats don't both fit: the record takes the stats' place while it's open.
    if (statsEl) statsEl.hidden = open;
    summary.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("open", open);
  };
  summary.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
  panel.querySelector(".np-close")!.addEventListener("click", () => setOpen(false));
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !record.hidden) setOpen(false);
    },
    { signal: listeners.signal },
  );
  // Point at a row (or tab to it) to see what the result means.
  hoverTips(record, "tr[data-wheel]", (row) => {
    const outcome = nation.results[row.dataset.wheel ?? ""];
    return outcome ? outcomeTip(outcome, data.text.tipOdds ?? "Odds: {chance}") : null;
  });
  if (statsEl && extras.stats) {
    const { sheet } = extras.stats;
    const toggle = statsEl.querySelector<HTMLButtonElement>(".np-stats-toggle")!;
    toggle.addEventListener("click", () => {
      const open = statsEl.classList.toggle("collapsed") === false;
      toggle.setAttribute("aria-expanded", String(open));
      savePref("statsOpen", open);
    });
    hoverTips(statsEl, "[data-stat]", (el) => {
      const stat = sheet.stats[el.dataset.stat as keyof StatSheet["stats"]];
      return stat ? { title: `${stat.name} · ${stat.text}`, text: stat.why.join("\n"), small: stat.about, kind: "wide" } : null;
    });
  }
  // Keep presses on the panel from reaching the map behind it.
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());
  panel.addEventListener("wheel", (e) => e.stopPropagation());
}

/** Removes the panel (if one is showing). */
export function closeNationPanel(): void {
  lastPanel?.abort();
  lastPanel = null;
  document.getElementById("nation-panel")?.remove();
}

/** E.g. "210,000 km² (rolled 340,000)", or just "340,000 km²" when it got it all. */
export function landText(land: { rolled: number; target?: number; actual?: number }, data: WheelData): string {
  const km = (v: number): string => Math.round(v).toLocaleString("en-US");
  if (land.actual === undefined) return formatText(data.text.landToPlace ?? "{rolled} km²", { rolled: km(land.rolled) });
  // Within half a percent counts as the full size (land comes in whole pixels).
  const full = land.actual >= (land.target ?? land.rolled) * 0.995;
  return formatText(data.text[full ? "landFull" : "landShort"] ?? "{actual} km²", { actual: km(land.actual), rolled: km(land.rolled) });
}

/** The stat sheet box: the stats in their groups, each with its breakdown on hover. */
function statsBox(sheet: StatSheet, data: StatsData): string {
  const open = loadPref<boolean>("statsOpen", true);
  const groups = data.groups
    .map((g) => {
      const rows = g.stats
        .map((id) => sheet.stats[id])
        .map(
          (s) => `<div class="np-stat${s.warn ? " warn" : ""}" data-stat="${s.id}" tabindex="0">
            <span class="np-stat-name">${escapeHtml(s.short)}</span>
            <span class="np-stat-val">${escapeHtml(s.text)}</span>
            ${s.detail ? `<span class="np-stat-detail">${escapeHtml(s.detail)}</span>` : ""}
          </div>`,
        )
        .join("");
      return `<section class="np-stat-group"><h3>${escapeHtml(g.name)}</h3>${rows}</section>`;
    })
    .join("");
  return `<div class="np-stats${open ? "" : " collapsed"}">
    <button type="button" class="np-stats-toggle" aria-expanded="${open}" title="Show or hide the stat sheet">Stats <span aria-hidden="true">▾</span></button>
    <div class="np-stats-body">${groups}</div>
  </div>`;
}
