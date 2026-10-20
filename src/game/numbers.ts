// Turning big numbers into short text.

/** 42000000 → "42M", 1400000000000 → "1.4T", 850000 → "850K". */
export function compactNumber(value: number, suffixes: readonly string[]): string {
  let n = value;
  let tier = -1;
  while (n >= 1000 && tier < suffixes.length - 1) {
    n /= 1000;
    tier++;
  }
  const text = n >= 100 ? Math.round(n).toString() : n >= 10 ? (Math.round(n * 10) / 10).toString() : (Math.round(n * 100) / 100).toString();
  return tier < 0 ? text : text + suffixes[tier];
}

/** Rounds to a number of significant digits: roundSignificant(123456, 2) → 120000. */
export function roundSignificant(value: number, digits: number): number {
  if (value <= 0) return 0;
  const step = 10 ** (Math.floor(Math.log10(value)) - digits + 1);
  return Math.round(value / step) * step;
}
