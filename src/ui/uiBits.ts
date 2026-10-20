// Small pieces of UI shared by the wheel screen and the nation panel.

import "./nationChart.css";
import type { ChartPoint } from "../game/chart.ts";
import type { ChartSpec } from "../game/wheels.ts";

export { formatText } from "../game/text.ts";

/** Makes text safe to put inside innerHTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** An empty flag frame on a little pole. Real flags come in a later milestone. */
export function flagPlaceholder(title: string): string {
  return `<div class="flag-frame" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
    <svg viewBox="0 0 30 22" aria-hidden="true"><path d="M2 2v19" class="flag-pole"/><path d="M4 3h22v13H4z" class="flag-cloth"/><text x="15" y="12.5">?</text></svg>
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
