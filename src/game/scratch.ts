// Map-sized working arrays for the flood fills that look over the whole map (the stat survey,
// the name spots). Made once and reused: on the 6000-wide map a fresh pair is 100 MB, and
// making it every few months was a good part of the time. Only for code that runs straight
// through (no awaits), so two users never share them at once.

let seen = new Uint8Array(0);
let stack = new Int32Array(0);

/** A "seen" flag and a stack, each at least `size` long. `seen` is NOT cleared: fill it first. */
export function scratch(size: number): { seen: Uint8Array; stack: Int32Array } {
  if (seen.length < size) {
    seen = new Uint8Array(size);
    stack = new Int32Array(size);
  }
  return { seen, stack };
}
