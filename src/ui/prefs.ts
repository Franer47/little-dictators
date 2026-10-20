// Small player preferences kept in the browser (style, sound…). Storage can be missing or
// blocked (private windows, strict settings), so every read and write is allowed to fail.

const PREFIX = "littleDictators.";

export function loadPref<T extends string | boolean>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return typeof value === typeof fallback ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: string | boolean): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not saved; it still works for this visit.
  }
}
