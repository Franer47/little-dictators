// Turning big numbers into short text.

/**
 * 42000000 → "42.0M", 1400000000000 → "1.40T", 850000 → "850K": always three digits with a
 * suffix, keeping the decimals ("84.0", not "84"), so a number ticking up or down keeps its
 * width and the screen doesn't shake. Below 1000 with no suffix it's a whole number.
 */
export function compactNumber(value: number, suffixes: readonly string[]): string {
  let n = value;
  let tier = -1;
  while (n >= 1000 && tier < suffixes.length - 1) {
    n /= 1000;
    tier++;
  }
  if (tier < 0) {
    const whole = Math.round(n);
    // 999.6 rounds up to the next unit: "1.00K".
    return whole >= 1000 && suffixes.length ? `1.00${suffixes[0]}` : String(whole);
  }
  let text = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  // Rounding can reach the next size: 99.97 → "100", 999.7K → "1.00M".
  if (Number(text) >= 1000 && tier < suffixes.length - 1) return `1.00${suffixes[tier + 1]}`;
  if (Number(text) >= 100) text = Number(text).toFixed(0);
  else if (Number(text) >= 10) text = Number(text).toFixed(1);
  return text + suffixes[tier];
}

/** Rounds to a number of significant digits: roundSignificant(123456, 2) → 120000. */
export function roundSignificant(value: number, digits: number): number {
  if (value <= 0) return 0;
  const step = 10 ** (Math.floor(Math.log10(value)) - digits + 1);
  return Math.round(value / step) * step;
}
