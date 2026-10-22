// The Army section: a nation's divisions (its flags on the map), their troops, and for your
// own nation its requests: order new divisions (1, 5, 25 or 100 into a queue), or a bigger one. Your nation decides at once
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
  /** Divisions ordered and still waiting, and why (empty when none). */
  queue?: { waiting: number; text: string };
  /** The nation's answer to the last request. */
  message: { ok: boolean; text: string } | null;
  suffixes: string[];
  onSelect(index: number): void;
  onOrder(count: number): void;
  onClearQueue(): void;
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
    else if (act === "order") info.onOrder(Number(el.dataset.count));
    else if (act === "clear") info.onClearQueue();
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
  const each = next.influenceCost ?? 0;
  const orders = [1, 5, 25, 100]
    .map((c) => `<button type="button" class="ap-btn${c === 1 ? " primary" : ""}" data-act="order" data-count="${c}" title="Order ${c} new ${c === 1 ? "division" : "divisions"} of ${n(rules.size)} troops${each ? ` for ✦${c * each}` : ""}">${c === 1 ? icon("swords") : ""}+${c} <small>${each ? `✦${c * each}` : ""}</small></button>`)
    .join("");
  const queue = next.queue?.waiting
    ? `<div class="ap-queue"><span>${icon("clock")}</span><p></p><button type="button" class="ap-btn small" data-act="clear" title="Cancel the divisions still waiting (the influence comes back)">Clear</button></div>`
    : "";
  const requests = next.mine
    ? `<div class="ap-kicker ap-section">Order divisions <small>(${n(rules.size)} troops each)</small></div>
      <div class="ap-actions">${orders}</div>
      ${queue}
      <div class="ap-actions">
        <button type="button" class="ap-btn" data-act="bigger" ${canGrow ? "" : "disabled"} title="${sel ? (canGrow ? `Add ${n(rules.growBy)} troops to the ${ordinal(sel.index + 1)} Division` : `A division can't be bigger than ${n(rules.maxSize)}`) : "Pick a division first"}">${icon("trend")}Bigger division <small>+${n(rules.growBy)}${each ? ` · ✦${each}` : ""}</small></button>
      </div>
      <p class="ap-hint">Ordered divisions wait in a queue: your nation raises a few each month while it has the men, the money and the calm, and they train for a few months first (striped flags). It also recruits on its own once a year.</p>`
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
  const q = panel.querySelector(".ap-queue p");
  if (q && next.queue) q.textContent = next.queue.text;
  const msg = panel.querySelector(".ap-message");
  if (msg && next.message) msg.textContent = next.message.text;
  panel.hidden = false;
}

export function armyPanelOpen(): boolean {
  return !panel.hidden;
}
