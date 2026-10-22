// The Army section: a nation's armies (one token each on the map), the reserve waiting at its
// capital, and for your own nation the commands: order new divisions (1, 5, 25 or 100 into a
// queue), and for each army its front and stance. Your nation commands its armies itself; when
// you give an army an order you command it, until you give it back. Other nations' armies can
// be looked at only. The rules are in src/sim/armies.ts.

import "./armyPanel.css";
import type { DivisionRules } from "../game/army.ts";
import { compactNumber } from "../game/numbers.ts";
import type { StatSheet } from "../game/stats.ts";
import type { Stance } from "../sim/armies.ts";
import { escapeHtml } from "./uiBits.ts";
import { icon } from "./icons.ts";

export interface ArmyRow {
  id: number;
  name: string;
  divisions: number;
  troops: number;
  training: number;
  /** Troops ÷ full strength (0..1). */
  strength: number;
  /** Enemy id, 0 = at home. */
  front: number;
  stance: Stance;
  /** You command it (the nation leaves it alone). */
  locked: boolean;
}

export interface ArmyPanelInfo {
  name: string;
  color: string;
  mine: boolean;
  /** Influence points one division costs. */
  influenceCost?: number;
  sheet: StatSheet;
  rules: DivisionRules;
  armies: ArmyRow[];
  reserve: { divisions: number; training: number; troops: number };
  /** The nation's enemies (fronts its armies can go to). */
  enemies: { id: number; name: string }[];
  /** The selected army's id, if any. */
  selected: number | null;
  /** The answer to the last command. */
  message: { ok: boolean; text: string } | null;
  /** Divisions ordered and still waiting, and why (empty when none). */
  queue?: { waiting: number; text: string };
  /** Every nation's armies show on the map (not just yours and your enemies'). */
  showAll: boolean;
  suffixes: string[];
  onSelect(army: number): void;
  onFront(army: number, front: number): void;
  onStance(army: number, stance: Stance): void;
  onRelease(army: number): void;
  onOrder(count: number): void;
  onClearQueue(): void;
  onShowAll(on: boolean): void;
  onClose(): void;
}

const STANCES: { id: Stance; label: string; about: string }[] = [
  { id: "attack", label: "Attack", about: "Pushes into the enemy's land." },
  { id: "hold", label: "Hold", about: "Holds the line: stronger in defence, never advances." },
  { id: "defend", label: "Defend", about: "Digs in: much stronger in defence, fewer losses, never advances." },
];

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
    const army = Number(el.dataset.army);
    if (act === "close") info.onClose();
    else if (act === "order") info.onOrder(Number(el.dataset.count));
    else if (act === "clear") info.onClearQueue();
    else if (act === "select") info.onSelect(army);
    else if (act === "stance") info.onStance(army, el.dataset.stance as Stance);
    else if (act === "release") info.onRelease(army);
  });
  panel.addEventListener("change", (e) => {
    if (!info) return;
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.act === "front") info.onFront(Number(el.dataset.army), Number(el.value));
    else if (el.dataset.act === "showall") info.onShowAll((el as HTMLInputElement).checked);
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
  const { sheet, rules } = next;
  const n = (v: number): string => compactNumber(Math.round(v), next.suffixes);
  const money = (v: number): string => (v < 0 ? "−$" : "$") + compactNumber(Math.abs(Math.round(v)), next.suffixes);
  const s = sheet.stats;
  const troops = next.armies.reduce((t, a) => t + a.troops, 0) + next.reserve.troops;
  const divisions = next.armies.reduce((t, a) => t + a.divisions, 0) + next.reserve.divisions;
  const cost = troops * sheet.factors.soldierCost.value;
  const flag = `<span class="ap-flag" style="background:${escapeHtml(next.color)}"></span>`;
  const bar = (v: number): string => `<span class="ap-bar"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%;background:${v > 0.66 ? "#7cc46a" : v > 0.33 ? "#e0b84a" : "#d4593f"}"></i></span>`;
  const enemyName = (id: number): string => next.enemies.find((e) => e.id === id)?.name ?? "";

  const armies = next.armies
    .map((a) => {
      const where = a.front ? `Front: ${escapeHtml(enemyName(a.front))}` : "At home, guarding the borders";
      const fronts = next.mine
        ? `<select data-act="front" data-army="${a.id}" title="Where this army fights">
            <option value="0"${a.front === 0 ? " selected" : ""}>At home (guards every border)</option>
            ${next.enemies.map((e) => `<option value="${e.id}"${a.front === e.id ? " selected" : ""}>Front: ${escapeHtml(e.name)}</option>`).join("")}
          </select>`
        : `<span class="ap-where">${where}</span>`;
      const stances = STANCES.map(
        (st) =>
          `<button type="button" class="ap-stance${a.stance === st.id ? " on" : ""}" data-act="stance" data-army="${a.id}" data-stance="${st.id}" title="${escapeHtml(st.about)}" ${next.mine ? "" : "disabled"}>${st.label}</button>`,
      ).join("");
      const command = next.mine
        ? a.locked
          ? `<span class="ap-cmd you">You command it</span><button type="button" class="ap-link" data-act="release" data-army="${a.id}" title="Let your nation decide its front and stance again">Give back</button>`
          : `<span class="ap-cmd">Your nation commands it (give an order to take over)</span>`
        : "";
      return `<div class="ap-army${a.id === next.selected ? " selected" : ""}" data-act="select" data-army="${a.id}">
        <div class="ap-army-head">${flag}<b>${escapeHtml(a.name)}</b><span class="ap-sub">${a.divisions} div · ${n(a.troops)}${a.training ? ` · ${a.training} training` : ""}</span>${bar(a.strength)}</div>
        <div class="ap-army-row">${fronts}</div>
        <div class="ap-army-row ap-stances">${stances}</div>
        ${command ? `<div class="ap-army-row">${command}</div>` : ""}
      </div>`;
    })
    .join("");

  const each = next.influenceCost ?? 0;
  const orders = [1, 5, 25, 100]
    .map((c) => `<button type="button" class="ap-btn${c === 1 ? " primary" : ""}" data-act="order" data-count="${c}" title="Order ${c} new ${c === 1 ? "division" : "divisions"} of ${n(rules.size)} troops${each ? ` for ✦${c * each}` : ""}">${c === 1 ? icon("swords") : ""}+${c} <small>${each ? `✦${c * each}` : ""}</small></button>`)
    .join("");
  const queue = next.queue?.waiting
    ? `<div class="ap-queue"><span>${icon("clock")}</span><p></p><button type="button" class="ap-btn small" data-act="clear" title="Cancel the divisions still waiting (the influence comes back)">Clear</button></div>`
    : "";
  const orderBox = next.mine
    ? `<div class="ap-kicker ap-section">Order divisions <small>(${n(rules.size)} troops each)</small></div>
      <div class="ap-actions">${orders}</div>
      ${queue}`
    : "";
  const reserve = next.reserve.divisions
    ? `<div class="ap-reserve">${flag}<span><b>Reserve</b> at the capital: ${next.reserve.divisions} ${next.reserve.divisions === 1 ? "division" : "divisions"} (${n(next.reserve.troops)})${next.reserve.training ? `, ${next.reserve.training} still training` : ""}. They join an army once trained.</span></div>`
    : "";

  panel.innerHTML = `
    <header>
      <span class="ap-flag big" style="background:${escapeHtml(next.color)}"></span>
      <div class="ap-title"><span class="ap-kicker">${next.mine ? "Your army" : "Army"}</span><span class="ap-name"></span></div>
      <button type="button" class="ap-close" data-act="close" aria-label="Close" title="Close (Esc)">×</button>
    </header>
    <div class="ap-summary">
      <div><span>Troops</span><b>${n(troops)}</b></div>
      <div><span>Divisions</span><b>${divisions}</b></div>
      <div><span>Manpower</span><b>${n(s.manpower.value)}</b></div>
      <div><span>Cost/yr</span><b>${money(cost)}</b></div>
      <div><span>Quality</span><b>${Math.round(s.armyQuality.value)}</b></div>
      <div><span>Net/yr</span><b class="${s.net.value < 0 ? "down" : "up"}">${money(s.net.value)}</b></div>
    </div>
    ${next.message ? `<p class="ap-message ${next.message.ok ? "ok" : "no"}"></p>` : ""}
    ${orderBox}
    <div class="ap-kicker ap-section">Armies</div>
    <div class="ap-armies">${armies || '<p class="ap-hint">No armies yet.</p>'}${reserve}</div>
    <p class="ap-hint">${next.mine ? "Your nation sends its armies where the enemy is strongest and picks their stance; give an army an order to command it yourself. Attack pushes into enemy land; Hold and Defend never advance but are harder to beat." : "You can look at other nations' armies, but only command your own."}</p>
    <label class="ap-check"><input type="checkbox" data-act="showall" ${next.showAll ? "checked" : ""}> Show every nation's armies on the map</label>`;
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
