// A tiny 5×7 pixel font for drawing crisp text on the retro wheel (uppercase only).
// Each glyph is rows of "#" (on) and "." (off); narrow glyphs have fewer columns.

const GLYPHS: Record<string, string> = {
  A: ".###. #...# #...# ##### #...# #...# #...#",
  B: "####. #...# #...# ####. #...# #...# ####.",
  C: ".###. #...# #.... #.... #.... #...# .###.",
  D: "####. #...# #...# #...# #...# #...# ####.",
  E: "##### #.... #.... ####. #.... #.... #####",
  F: "##### #.... #.... ####. #.... #.... #....",
  G: ".###. #...# #.... #.### #...# #...# .####",
  H: "#...# #...# #...# ##### #...# #...# #...#",
  I: "### .#. .#. .#. .#. .#. ###",
  J: "..### ...#. ...#. ...#. ...#. #..#. .##..",
  K: "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
  L: "#.... #.... #.... #.... #.... #.... #####",
  M: "#...# ##.## #.#.# #.#.# #...# #...# #...#",
  N: "#...# #...# ##..# #.#.# #..## #...# #...#",
  O: ".###. #...# #...# #...# #...# #...# .###.",
  P: "####. #...# #...# ####. #.... #.... #....",
  Q: ".###. #...# #...# #...# #.#.# #..#. .##.#",
  R: "####. #...# #...# ####. #.#.. #..#. #...#",
  S: ".#### #.... #.... .###. ....# ....# ####.",
  T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
  U: "#...# #...# #...# #...# #...# #...# .###.",
  V: "#...# #...# #...# #...# #...# .#.#. ..#..",
  W: "#...# #...# #...# #.#.# #.#.# #.#.# .#.#.",
  X: "#...# #...# .#.#. ..#.. .#.#. #...# #...#",
  Y: "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
  Z: "##### ....# ...#. ..#.. .#... #.... #####",
  "0": ".###. #...# #..## #.#.# ##..# #...# .###.",
  "1": "..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.",
  "2": ".###. #...# ....# ...#. ..#.. .#... #####",
  "3": "##### ...#. ..#.. ...#. ....# #...# .###.",
  "4": "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
  "5": "##### #.... ####. ....# ....# #...# .###.",
  "6": "..##. .#... #.... ####. #...# #...# .###.",
  "7": "##### ....# ...#. ..#.. .#... .#... .#...",
  "8": ".###. #...# #...# .###. #...# #...# .###.",
  "9": ".###. #...# #...# .#### ....# ...#. .##..",
  "-": ".... .... .... #### .... .... ....",
  "–": ".... .... .... #### .... .... ....",
  "$": "..#.. .#### #.#.. .###. ..#.# ####. ..#..",
  "²": "##. ..# .#. ### ... ... ...",
  "'": "# # # . . . .",
  ".": ". . . . . . #",
  ",": ".. .. .. .. .. .# #.",
  "!": "# # # # # . #",
  "?": ".###. #...# ....# ...#. ..#.. ..... ..#..",
  "/": "....# ...#. ...#. ..#.. .#... .#... #....",
  "(": "..# .#. #.. #.. #.. .#. ..#",
  ")": "#.. .#. ..# ..# ..# .#. #..",
  "&": ".#... #.#.. #.#.. .#... #.#.# #..#. .##.#",
  ":": ". # . . . # .",
  " ": "... ... ... ... ... ... ...",
};

export const GLYPH_HEIGHT = 7;

const parsed = new Map<string, boolean[][]>(
  Object.entries(GLYPHS).map(([ch, rows]) => [ch, rows.split(" ").map((row) => [...row].map((c) => c === "#"))]),
);

function glyph(ch: string): boolean[][] {
  return parsed.get(ch) ?? parsed.get("?")!;
}

/** Width of a line of text in pixels, with `spacing` empty pixels between letters. */
export function textWidth(text: string, spacing = 1): number {
  let w = 0;
  for (const ch of text.toUpperCase()) w += glyph(ch)[0].length + spacing;
  return Math.max(0, w - spacing);
}

/** Calls plot(x, y) for every lit pixel of the text, with its top-left at (x, y). */
export function drawText(text: string, x: number, y: number, plot: (x: number, y: number) => void, spacing = 1): void {
  for (const ch of text.toUpperCase()) {
    const rows = glyph(ch);
    rows.forEach((row, gy) => row.forEach((on, gx) => on && plot(x + gx, y + gy)));
    x += rows[0].length + spacing;
  }
}

/** Splits text into lines no wider than maxWidth, breaking between words. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number = textWidth): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (!line || measure(tryLine) <= maxWidth) line = tryLine;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
