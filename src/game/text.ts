// Display text helpers shared by game code and UI.

/** Fills {name} slots in a text: formatText("Spin {n} / {total}", { n: 2, total: 5 }). */
export function formatText(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (slot, key: string) => (key in vars ? String(vars[key]) : slot));
}
