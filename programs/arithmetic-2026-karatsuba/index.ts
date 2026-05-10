import { defineProgram, runProgram } from "../../src/lib"
import { randInt } from "../utils"
import multiply from "./eval"

function randomDecimal(digits: number, leadingNonZero = true): string {
  let s = ""
  for (let i = 0; i < digits; i++) {
    const lo = leadingNonZero && i === 0 ? 1 : 0
    s += randInt(lo, 9).toString()
  }
  return s
}

await runProgram(defineProgram({
  name: "arithmetic-2026-karatsuba",
  evaluate: (a, b) => multiply(a, b),
  // Inputs are passed as bare decimal strings — the algorithm operates on
  // the integer values directly (splits via /10^half, %10^half), so there's
  // no positional tape to encode.
  encode: (a, b) => `A=${a}\nB=${b}`,
  display: (arg) => BigInt(arg).toLocaleString("en-US"),
  trainingInputs: [
    // 2x2 — minimum recursion depth (1 level), 3 single-digit base cases.
    ["12", "34"],
    // 2x2 with sum-of-halves overflow (78+56=134 → 3 digit).
    // Sum overflow is the structural complication that makes Karatsuba
    // recursion asymmetric; this exercises that path.
    ["78", "56"],
    // 2x2 max (99*99) — sums overflow maximally (9+9=18 each).
    ["99", "99"],
    // 3x2 asymmetric. Forces the model to handle differing operand widths
    // and rounding-up of half size.
    ["123", "45"],
    // 4x4 — z3 recurses (sum overflows half-width); z0/z2 are inline base.
    ["1234", "5678"],
    // 6x6 — 3-digit halves; z0/z2 recurse since LO is 3-digit (>= 100).
    // Critical for the model to see z0/z2 in CALL/RET form, not just inline.
    ["123456", "789012"],
    // 8x8 — 4-digit halves; all three sub-calls recurse (z0/z2/z3). Anchors
    // the model on "any operand >= 100 means CALL/RET, not inline base."
    ["12345678", "87654321"],
  ],
  generateTestInputs: (opts) => {
    const extra = opts?.extra ?? []
    if (extra.length > 0) {
      const a = parseInt(extra[0], 10)
      const b = parseInt(extra[1] ?? extra[0], 10)
      return Array.from({ length: 10 }, () => [randomDecimal(a), randomDecimal(b)] as [string, string])
    }
    // Default sweep — small to large, scaling slowly because Karatsuba's
    // recursion balloons trace size faster than cross's per-position emit.
    const widths: Array<[number, number]> = [
      [2, 2], [2, 2], [4, 4], [4, 4], [6, 6], [6, 6], [8, 8], [8, 8], [12, 12], [16, 16],
    ]
    return widths.map(([a, b]) => [randomDecimal(a), randomDecimal(b)] as [string, string])
  },
  config: {
    temperature: 0,
    maxTokens: 4096,
    defaultModel: "anthropic/claude-opus-4.6",
  },
}))
