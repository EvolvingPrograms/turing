import { defineProgram, runProgram } from "../../src/lib"
import { toPositional } from "../encoding"
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
  name: "arithmetic-2026-cross",
  evaluate: (a, b) => multiply(a, b),
  // Encode input LSB-first so position labels mean the same thing in the
  // [USER] block and in the tape inside the [ASSISTANT] response. Removes
  // the mental-reversal cognitive load that caused mid-tape copy drift on
  // long operands.
  encode: (a, b) => {
    const rev = (s: string) => s.split("").reverse().join("")
    return `${toPositional(rev(a))}\n${toPositional(rev(b))}`
  },
  display: (arg) => BigInt(arg).toLocaleString("en-US"),
  trainingInputs: [
    // 2x2 — basic, every line type appears
    ["47", "23"],
    // 2x2 with max single-digit products everywhere
    ["99", "99"],
    // 3x2 — first asymmetric case
    ["478", "32"],
    // 4x2 with leading zero result digit (A[0]=0 forces a "no products" k=0 path)
    ["7890", "12"],
    // 3x2 with internal zero
    ["105", "23"],
    // 3x3 — symmetric, big enough to show full diagonal sweep
    ["123", "456"],
    // 4x3 asymmetric (A>B), no zeros
    ["1234", "567"],
    // 6x6 — exercises the "many products per output position" middle of the diagonal
    ["123456", "789012"],
    // 8x4 asymmetric — gives the model an 8-cell A tape so it's seen what
    // long monotonous A copies look like with explicit position labels
    ["13579246", "8642"],
    // 10x10 — nearly the smallest test case width; closes the inductive gap
    // between the small training cases and 16-digit tests
    ["1234567890", "9876543210"],
  ],
  generateTestInputs: (opts) => {
    // Trailing positional args = digit counts for A and B.
    //   bun programs/arithmetic-2026-cross <model> <digits-a> [digits-b]
    const extra = opts?.extra ?? []
    if (extra.length > 0) {
      const a = parseInt(extra[0], 10)
      const b = parseInt(extra[1] ?? extra[0], 10)
      return Array.from({ length: 10 }, () =>
        [randomDecimal(a), randomDecimal(b)] as [string, string]
      )
    }
    const widths: Array<[number, number]> = [
      [4, 4], [4, 4], [8, 8], [8, 8], [12, 12], [12, 12], [16, 16], [16, 16], [19, 19], [19, 19],
    ]
    return widths.map(([a, b]) => [randomDecimal(a), randomDecimal(b)] as [string, string])
  },
  config: {
    temperature: 0,
    maxTokens: 4096,
    defaultModel: "anthropic/claude-opus-4.6",
  },
}))
