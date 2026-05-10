import { defineProgram, runProgram } from "../../src/lib"
import { toPositionalHex } from "../encoding"
import { randomHex } from "../utils"
import multiply from "./eval"

await runProgram(defineProgram({
  name: "arithmetic-2026",
  evaluate: (a, b) => multiply(a, b),
  encode: (a, b) => `${toPositionalHex(a)}\n${toPositionalHex(b)}`,
  display: (arg) => BigInt("0x" + arg).toLocaleString("en-US"),
  trainingInputs: [
    // Symmetric anchor: simplest possible 2x2, no skips.
    ["7e", "23"],
    // 2x3 asymmetric (A<B), mid-stream skip in B.
    ["7e", "207"],
    // 2x3 asymmetric (A<B), start-of-trace skip (B's LSB nibble = 0).
    ["9c", "830"],
    // 3x2 asymmetric (A>B). Forces the model to disambiguate which width
    // drives topPos.
    ["a3f", "27"],
    // 4x3 asymmetric (A>B), no skips — the exact shape we observed failing
    // when training was symmetric-only.
    ["1234", "567"],
    // 4x3 asymmetric (A>B), different digit pattern.
    ["7f3a", "825"],
    // 4x6 asymmetric (A<B), multi-iteration with mid-stream skip (B4=0).
    ["c4d8", "9af20b"],
  ],
  generateTestInputs: (opts) => {
    // Trailing positional args are digit counts for A and B:
    //   bun programs/arithmetic-2026 <model> <digits-a> [digits-b]
    // If only one is passed, both operands use it. The lib caps to -n N.
    const extra = opts?.extra ?? []
    if (extra.length > 0) {
      const a = parseInt(extra[0], 10)
      const b = parseInt(extra[1] ?? extra[0], 10)
      return Array.from({ length: 10 }, () => [randomHex(a), randomHex(b)] as [string, string])
    }
    const widths: Array<[number, number]> = [
      [4, 4], [4, 4], [4, 4], [8, 8], [8, 8], [8, 8], [12, 12], [12, 12], [14, 14], [14, 14],
    ]
    return widths.map(([a, b]) => [randomHex(a), randomHex(b)] as [string, string])
  },
  config: {
    temperature: 0,
    maxTokens: 4096,
    defaultModel: "anthropic/claude-opus-4.6",
  },
}))
