// rng.js — seeded random numbers (same as the tractor cave game).
// mulberry32 turns one 32-bit seed into a repeatable stream of numbers in [0, 1).
// Same seed = same cave, which makes bugs reproducible.

export function mulberry32(seed) {
  let a = seed >>> 0; // >>> 0 forces the number into an unsigned 32-bit integer.
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    // Math.imul multiplies two numbers as 32-bit integers (the way C would), which this hash relies on.
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small helper: a stable pseudo-random number per tile, for visual variation
// that must not change from frame to frame (colours, which walls get lanterns).
export function hash2(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
