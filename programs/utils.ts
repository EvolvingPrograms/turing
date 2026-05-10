/**
 * Generic utilities for programs/. Anything encoding-related lives in
 * ./encoding.ts; this file is for randomness and other format-agnostic
 * helpers.
 */

/** Inclusive integer in [min, max]. */
export const randInt = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** Fisher-Yates-ish shuffle (sort by random key). Returns a new array. */
export function shuffle<T>(array: T[]): T[] {
  return array
    .map(value => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value)
}

/** Random hex string of N nibbles. With leadingNonZero (default), the first nibble is in [1,15]. Lowercase. */
export const randomHex = (nibbles: number, leadingNonZero = true): string => {
  let s = ""
  for (let i = 0; i < nibbles; i++) {
    const lo = leadingNonZero && i === 0 ? 1 : 0
    s += randInt(lo, 15).toString(16)
  }
  return s
}

/** Random binary string of N bits. With leadingNonZero (default), MSB is 1. */
export const randomBinary = (bits: number, leadingNonZero = true): string => {
  let s = ""
  for (let i = 0; i < bits; i++) {
    if (leadingNonZero && i === 0) {
      s += "1"
    } else {
      s += randInt(0, 1).toString()
    }
  }
  return s
}
