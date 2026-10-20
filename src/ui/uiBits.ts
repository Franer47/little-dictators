// Small pieces of UI shared by the wheel screen and the nation panel.

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
