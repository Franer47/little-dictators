// Small line icons for the stats (16×16, drawn in the text colour).

const PATHS: Record<string, string> = {
  coin: '<circle cx="8" cy="8" r="6"/><path d="M10 5.6H7.2a1.4 1.4 0 0 0 0 2.8h1.6a1.4 1.4 0 0 1 0 2.8H6M8 4.2v7.6"/>',
  chest: '<path d="M2 7h12v6.5H2zM2 7a3.5 3 0 0 1 3.5-3h5A3.5 3 0 0 1 14 7M7 7v2.5h2V7"/>',
  people: '<circle cx="6" cy="5.5" r="2.2"/><path d="M2 13.5c0-2.6 1.8-4.2 4-4.2s4 1.6 4 4.2"/><circle cx="11.5" cy="6" r="1.8"/><path d="M10.8 9.4c1.9 0 3.2 1.4 3.2 4.1"/>',
  columns: '<path d="M2 6l6-3.5L14 6M3.5 7v5.5M6.5 7v5.5M9.5 7v5.5M12.5 7v5.5M2 13.5h12"/>',
  heart: '<path d="M8 13.5S2 10 2 6.2a3 3 0 0 1 6-1 3 3 0 0 1 6 1C14 10 8 13.5 8 13.5z"/>',
  swords: '<path d="M2.5 2.5l8 8M13.5 2.5l-8 8M9 12.5l3.5-3.5M3.5 9L7 12.5M11.5 11.5l2 2M4.5 11.5l-2 2"/>',
  star: '<path d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z"/>',
  flame: '<path d="M8 14c-2.8 0-4.5-1.9-4.5-4.3C3.5 6.5 7 5 7 2c2.5 1.5 5.5 4.3 5.5 7.7 0 2.4-1.7 4.3-4.5 4.3zM8 14c-1.2 0-2-.9-2-2 0-1.6 2-2.5 2-4 1 .8 2 2.3 2 4 0 1.1-.8 2-2 2z"/>',
  trend: '<path d="M2 13.5h12M3 11l3.2-3.2 2.6 2.2L13 5.5M10 5.5h3v3"/>',
  wheat: '<path d="M8 14.5V4M8 6.5c-1.8 0-3-1.3-3-3 1.8 0 3 1.3 3 3zm0 0c1.8 0 3-1.3 3-3-1.8 0-3 1.3-3 3zm0 3.5c-1.8 0-3-1.3-3-3 1.8 0 3 1.3 3 3zm0 0c1.8 0 3-1.3 3-3-1.8 0-3 1.3-3 3z"/>',
  flag: '<path d="M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5"/>',
  book: '<path d="M8 4.5C6.5 3.2 4.5 3 2 3v9.5c2.5 0 4.5.2 6 1.5 1.5-1.3 3.5-1.5 6-1.5V3c-2.5 0-4.5.2-6 1.5zM8 4.5V14"/>',
  mountain: '<path d="M1.5 13.5L6 5l2.5 4.5L10.5 7l4 6.5z"/>',
  wave: '<path d="M1.5 6c1.6 0 1.6-1.5 3.25-1.5S6.4 6 8 6s1.6-1.5 3.25-1.5S12.9 6 14.5 6M1.5 10.5c1.6 0 1.6-1.5 3.25-1.5S6.4 10.5 8 10.5 9.6 9 11.25 9s1.65 1.5 3.25 1.5"/>',
  shield: '<path d="M8 1.8l5.5 2v4C13.5 11 11 13.3 8 14.3 5 13.3 2.5 11 2.5 7.8v-4z"/>',
  scales: '<path d="M8 2v12M4.5 14h7M3 4.5h10M3 4.5L1.5 9h3zM13 4.5L11.5 9h3zM1.5 9a1.5 1 0 0 0 3 0M11.5 9a1.5 1 0 0 0 3 0"/>',
  anchor: '<circle cx="8" cy="3.5" r="1.5"/><path d="M8 5v9M5.5 7h5M2.5 9.5c0 2.5 2.5 4.5 5.5 4.5s5.5-2 5.5-4.5"/>',
  link: '<path d="M6.5 9.5l3-3M7 4.8l1-1a2.6 2.6 0 0 1 3.7 3.7l-1 1M9 11.2l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1"/>',
  outflow: '<circle cx="8" cy="8" r="6"/><path d="M5.5 8h5M8.5 5.5L11 8l-2.5 2.5"/>',
};

/** The icon for each stat (by stat id). */
export const STAT_ICONS: Record<string, string> = {
  manpower: "people",
  army: "swords",
  armyQuality: "star",
  aggression: "flame",
  gdp: "trend",
  income: "coin",
  upkeep: "outflow",
  net: "coin",
  treasury: "chest",
  population: "people",
  growth: "trend",
  food: "wheat",
  stability: "columns",
  popularity: "heart",
  ideology: "flag",
  development: "book",
  land: "mountain",
  access: "wave",
  defence: "shield",
  trade: "scales",
  naval: "anchor",
  cohesion: "link",
};

/** An inline SVG icon by name (empty if there's no such icon). */
export function icon(name: string | undefined, className = "icon"): string {
  const path = name ? PATHS[name] : undefined;
  return path
    ? `<svg class="${className}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
    : "";
}

/** A colour for a 0–100 score: red when low, amber in the middle, green when high. */
export function scoreColor(v: number): string {
  const t = Math.max(0, Math.min(1, v / 100));
  const hue = t * 125; // 0 red … 125 green
  return `hsl(${Math.round(hue)} 70% 52%)`;
}

/** Colours for the ideology mix, picked by each ideology's place in the list. */
const IDEOLOGY_COLORS = ["#e8b04a", "#5fa8e8", "#e86a5f", "#7fd17a", "#b48ae8", "#e88ac4", "#4ecdc4", "#f4d35e", "#9aa7b8", "#ff9f5a", "#6c8ef5", "#c3e86a", "#d9a6ff", "#8fd3ff"];

export function ideologyColor(index: number, id: string): string {
  return id === "others" ? "#5d6b7c" : IDEOLOGY_COLORS[index % IDEOLOGY_COLORS.length];
}
