// The Army section: a nation's divisions (its flags on the map), their troops, and for your
// own nation two requests: a new division, or a bigger one. Your nation decides at once
// (src/game/army.ts, decideRequest) and says why. Other nations' armies can be looked at only.

import "./armyPanel.css";
import { ordinal, type Division, type DivisionRules } from "../game/army.ts";
import { compactNumber } from "../game/numbers.ts";
import type { StatSheet } from "../game/stats.ts";
import { escapeHtml } from "./uiBits.ts";
import { icon } from "./icons.ts";

export interface ArmyPanelInfo {
  name: string;
  color: string;
  mine: boolean;
  /** Influence points a request costs. */
  influenceCost?: number;
  divisions: Division[];
  sheet: StatSheet;
  rules: DivisionRules;
  /** The selected division's index, if any. */
  selected: number | null;
  /** The nation's answer to the last request. */
  message: { ok: boolean; text: string } | null;
  suffixes: string[];
  onSelect(index: number): void;
  onNew(): void;
  onBigger(index: number): void;
  onClose(): void;
}

const panel = document.createElement("section");
panel.id = "army-panel";
panel.hidden = true;
panel.setAttribute("aria-label", "Army");
let info: ArmyPanelInfo | null = null;
let ready = false;

function setUp(): void {
  if (ready) return;
  ready = true;
  document.body.append(panel);
  panel.addEventListener("click", (e) => {
    if (!info) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    if (act === "close") info.onClose();
    else if (act === "new") info.onNew();
    else if (act === "bigger" && info.selected !== null) info.onBigger(info.selected);
    else if (act === "select") info.onSelect(Number(el.dataset.index));
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) info?.onClose();
  });
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());
  panel.addEventListener("wheel", (e) => e.stopPropagation());
}

export function showArmyPanel(next: ArmyPanelInfo | null): void {
  setUp();
  info = next;
  if (!next) {
    panel.hidden = true;
    return;
  }
  const { sheet, rules, divisions } = next;
  const n = (v: number): string => compactNumber(Math.round(v), next.suffixes);
  const money = (v: number): string => (v < 0 ? "−$" : "$") + compactNumber(Math.abs(Math.round(v)), next.suffixes);
  const s = sheet.stats;
  const troops = divisions.reduce((sum, d) => sum + d.troops, 0);
  const cost = troops * sheet.factors.soldierCost.value;
  const sel = next.selected !== null ? divisions.find((d) => d.index === next.selected) : undefined;
  const chips = divisions
    .map(
      (d) => `<button type="button" class="ap-div${d.index === next.selected ? " selected" : ""}${d.training ? " training" : ""}" data-act="select" data-index="${d.index}" title="${escapeHtml(`${ordinal(d.index + 1)} Division: ${d.troops.toLocaleString("en-US")} troops${d.training ? " (in training)" : ""}`)}">
        <span class="ap-flag" style="background:${escapeHtml(next.color)}"></span>
        <span class="ap-div-name">${ordinal(d.index + 1)}</span>
        <span class="ap-div-troops">${n(d.troops)}</span>
      </button>`,
    )
    .join("");
  const canGrow = sel && sel.troops + rules.growBy <= rules.maxSize;
  const requests = next.mine
    ? `<div class="ap-actions">
        <button type="button" class="ap-btn primary" data-act="new">${icon("swords")}New division <small>+${n(rules.size)}${next.influenceCost ? ` · ✦${next.influenceCost}` : ""}</small></button>
        <button type="button" class="ap-btn" data-act="bigger" ${canGrow ? "" : "disabled"} title="${sel ? (canGrow ? `Add ${n(rules.growBy)} troops to the ${ordinal(sel.index + 1)} Division` : `A division can't be bigger than ${n(rules.maxSize)}`) : "Pick a division first"}">${icon("trend")}Bigger <small>+${n(rules.growBy)}${next.influenceCost ? ` · ✦${next.influenceCost}` : ""}</small></button>
      </div>
      <p class="ap-hint">You can only ask, with influence. Your nation agrees if it has the men, the money and the calm to do it; new soldiers train for a few months first (striped flags). It also recruits on its own once a year.</p>`
    : `<p class="ap-hint">You can look at other nations' armies, but only ask your own.</p>`;
  panel.innerHTML = `
    <header>
      <span class="ap-flag big" style="background:${escapeHtml(next.color)}"></span>
      <div class="ap-title"><span class="ap-kicker">${next.mine ? "Your army" : "Army"}</span><span class="ap-name"></span></div>
      <button type="button" class="ap-close" data-act="close" aria-label="Close" title="Close (Esc)">×</button>
    </header>
    <div class="ap-summary">
      <div><span>Troops</span><b>${n(troops)}</b></div>
      <div><span>Divisions</span><b>${divisions.length}</b></div>
      <div><span>Manpower</span><b>${n(s.manpower.value)}</b></div>
      <div><span>Cost/yr</span><b>${money(cost)}</b></div>
      <div><span>Quality</span><b>${Math.round(s.armyQuality.value)}</b></div>
      <div><span>Net/yr</span><b class="${s.net.value < 0 ? "down" : "up"}">${money(s.net.value)}</b></div>
    </div>
    ${next.message ? `<p class="ap-message ${next.message.ok ? "ok" : "no"}"></p>` : ""}
    ${requests}
    <div class="ap-divs">${chips || '<p class="ap-hint">No divisions: the army is smaller than half a division.</p>'}</div>`;
  panel.querySelector(".ap-name")!.textContent = next.name;
  const msg = panel.querySelector(".ap-message");
  if (msg && next.message) msg.textContent = next.message.text;
  panel.hidden = false;
}

export function armyPanelOpen(): boolean {
  return !panel.hidden;
}
