// Small pieces of UI shared by the wheel screen and the nation panel.

import "./nationChart.css";
import "./tips.css";
import type { ChartPoint } from "../game/chart.ts";
import type { WheelOutcome } from "../game/nation.ts";
import { formatText } from "../game/text.ts";
import type { ChartSpec } from "../game/wheels.ts";

export { formatText };

/** Makes text safe to put inside innerHTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The flag: for now just the nation's colour on a cloth (a dashed "?" while it has none). */
export function flagPlaceholder(title: string, color?: string): string {
  const cloth = color
    ? `<path d="M4 3h22v13H4z" class="flag-cloth colored" style="fill:${escapeHtml(color)}"/>`
    : '<path d="M4 3h22v13H4z" class="flag-cloth"/><text x="15" y="12.5">?</text>';
  return `<div class="flag-frame" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
    <svg viewBox="0 0 30 22" aria-hidden="true"><path d="M2 2v19" class="flag-pole"/>${cloth}</svg>
  </div>`;
}

/** A speaker icon, crossed out when muted. */
export function speakerIcon(muted: boolean): string {
  return `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" shape-rendering="crispEdges" fill="currentColor">
    <rect x="1" y="5" width="3" height="6"/><path d="M4 5l4-3v12l-4-3z"/>
    ${
      muted
        ? '<path d="M10 5l5 6M15 5l-5 6" stroke="currentColor" stroke-width="1.6" fill="none"/>'
        : '<path d="M10 5.5q1.6 2.5 0 5M12 3.5q3.2 4.5 0 9" stroke="currentColor" stroke-width="1.4" fill="none"/>'
    }</svg>`;
}

/**
 * The nation chart: a square with the nation's dot, the four corners tinted and named, and
 * the axis ends labelled (top: good life, bottom: miserable, left: liberal, right: tyrannical).
 */
export function nationChart(spec: ChartSpec, point: ChartPoint, title = ""): string {
  const x = 50 + point.x * 44;
  const y = 50 - point.y * 44;
  const [tl, tr, bl, br] = (spec.corners ?? ["", "", "", ""]).map(escapeHtml);
  return `<figure class="nation-chart"${title ? ` aria-label="${escapeHtml(title)}"` : ""}>
    ${title ? `<figcaption>${escapeHtml(title)}</figcaption>` : ""}
    <div class="nc-y nc-top">${escapeHtml(spec.y.high)}</div>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <rect class="nc-q nc-tl" x="0" y="0" width="50" height="50"/><rect class="nc-q nc-tr" x="50" y="0" width="50" height="50"/>
      <rect class="nc-q nc-bl" x="0" y="50" width="50" height="50"/><rect class="nc-q nc-br" x="50" y="50" width="50" height="50"/>
      <path class="nc-axis" d="M50 2V98M2 50H98"/>
      <text class="nc-corner" x="4" y="9">${tl}</text><text class="nc-corner" x="96" y="9" text-anchor="end">${tr}</text>
      <text class="nc-corner" x="4" y="96">${bl}</text><text class="nc-corner" x="96" y="96" text-anchor="end">${br}</text>
      <circle class="nc-glow" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8"/>
      <circle class="nc-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6"/>
    </svg>
    <div class="nc-y nc-bottom">${escapeHtml(spec.y.low)}</div>
    <div class="nc-x"><span>← ${escapeHtml(spec.x.low)}</span><span>${escapeHtml(spec.x.high)} →</span></div>
  </figure>`;
}

/** A skull for the rare pull, in chunky pixels (drawn over the wheel's centre). */
export function skullIcon(): string {
  return `<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
    <path fill="#f4ede0" d="M4 1h8v1h2v2h1v6h-1v2h-2v3H4v-3H2v-2H1V4h1V2h2z"/>
    <path fill="#140308" d="M4 6h3v3H4zM9 6h3v3H9zM7 10h2v1H7zM5 13h1v2H5zM7 13h1v2H7zM9 13h1v2H9zM11 13h1v2h-1z"/>
    <path fill="#e0182d" d="M5 7h1v1H5zM10 7h1v1h-1z"/>
  </svg>`;
}

/** 0.125 → "12.5% (1 in 8)". */
export function oddsText(chance: number): string {
  const pct = chance * 100;
  const shown = pct >= 10 ? pct.toFixed(1).replace(/\.0$/, "") : pct.toPrecision(2);
  return chance > 0 ? `${shown}% (1 in ${Math.round(1 / chance).toLocaleString("en-US")})` : "0%";
}

/** What a hover tip shows: a heading, a description, and a small line (e.g. the odds). */
export interface Tip {
  title: string;
  text: string;
  small?: string;
  /** "rare" or "golden" colours the heading; "wide" makes room for a stat's breakdown. */
  kind?: "rare" | "golden" | "wide";
}

/** A result's tip: its name, its description (each pick's, for multi-pick wheels), and its odds. */
export function outcomeTip(outcome: WheelOutcome, oddsLabel: string): Tip {
  const text = outcome.picks
    ? outcome.picks.map((p) => (p.blurb ? `${p.label}: ${p.blurb}` : p.label)).join("\n")
    : [outcome.blurb, outcome.effectText].filter(Boolean).join("\n");
  return {
    title: outcome.estimate ? `${outcome.label} · ${outcome.estimate.text}` : outcome.label,
    text,
    small: outcome.none ? "" : formatText(oddsLabel, { chance: oddsText(outcome.chance * (outcome.exactChance ?? 1)) }),
    kind: outcome.rare ? "rare" : outcome.golden ? "golden" : undefined,
  };
}

let tipBox: HTMLDivElement | null = null;
/** The element whose tip was clicked open ("pinned"): it stays until closed or another is clicked. */
let pinnedEl: HTMLElement | null = null;
let pinListeners = false;

function unpin(): void {
  pinnedEl?.classList.remove("tip-pinned");
  pinnedEl = null;
  if (tipBox) {
    tipBox.classList.remove("pinned");
    tipBox.hidden = true;
  }
}

/**
 * Hover (or keyboard focus) on an element matching `selector` inside `root` shows a tip
 * box next to it. Clicking it (or Enter / Space) pins the tip open, with a close button, so
 * a press always does something; clicking it again, anywhere else or Esc closes it.
 * `tipFor` says what's in the tip, or null for none.
 */
export function hoverTips(root: HTMLElement, selector: string, tipFor: (el: HTMLElement) => Tip | null): void {
  const show = (el: HTMLElement, pin = false): void => {
    const tip = tipFor(el);
    if (!tip) return hide();
    if (!tipBox) {
      tipBox = document.createElement("div");
      tipBox.className = "ui-tip";
      tipBox.setAttribute("role", "tooltip");
      document.body.append(tipBox);
      tipBox.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".ui-tip-close")) unpin();
      });
    }
    const box = tipBox;
    box.className = `ui-tip${tip.kind ? ` ${tip.kind}` : ""}${pin ? " pinned" : ""}`;
    box.innerHTML = `<button type="button" class="ui-tip-close" aria-label="Close" title="Close (Esc)">×</button><div class="ui-tip-title"></div><div class="ui-tip-text"></div><div class="ui-tip-small"></div><div class="ui-tip-hint">Click to keep this open</div>`;
    box.children[1].textContent = tip.title;
    box.children[2].textContent = tip.text;
    box.children[3].textContent = tip.small ?? "";
    box.hidden = false;
    // Just under the element, lined up with its left edge; above it if there's no room below.
    const r = el.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left));
    let y = r.bottom + 6;
    if (y + h > window.innerHeight - 8) y = r.top - h - 6;
    box.style.left = `${x}px`;
    box.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, y))}px`;
  };
  const hide = (): void => {
    if (tipBox && !pinnedEl) tipBox.hidden = true;
  };
  const pin = (el: HTMLElement): void => {
    if (pinnedEl === el) return unpin();
    pinnedEl?.classList.remove("tip-pinned");
    pinnedEl = el;
    el.classList.add("tip-pinned");
    show(el, true);
  };
  const target = (e: Event): HTMLElement | null => (e.target as HTMLElement | null)?.closest?.<HTMLElement>(selector) ?? null;
  root.addEventListener("pointerover", (e) => {
    const el = target(e);
    if (el && !pinnedEl) show(el);
  });
  root.addEventListener("pointerout", (e) => {
    if (target(e) && !target({ target: (e as PointerEvent).relatedTarget } as unknown as Event)) hide();
  });
  root.addEventListener("focusin", (e) => {
    const el = target(e);
    if (el && !pinnedEl) show(el);
  });
  root.addEventListener("focusout", hide);
  root.addEventListener("click", (e) => {
    const el = target(e);
    if (el) pin(el);
  });
  root.addEventListener("keydown", (e) => {
    const el = target(e);
    if (el && (e.key === "Enter" || e.key === " ") && !(el instanceof HTMLButtonElement)) {
      e.preventDefault();
      pin(el);
    }
  });
  if (!pinListeners) {
    pinListeners = true;
    // A press anywhere else closes a pinned tip (capture: panels stop presses reaching the map).
    window.addEventListener(
      "pointerdown",
      (e) => {
        const t = e.target as HTMLElement;
        if (pinnedEl && !t.closest(".ui-tip") && !pinnedEl.contains(t)) unpin();
      },
      true,
    );
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pinnedEl) unpin();
    });
  }
}

/** Hides any open tip (e.g. when the screen changes). */
export function hideTips(): void {
  unpin();
  if (tipBox) tipBox.hidden = true;
}
