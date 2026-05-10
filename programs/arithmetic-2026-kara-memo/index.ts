import { defineProgram, parseArgs, runProgram } from "../../src/lib"
import { randInt } from "../utils"
import { makeMultiply } from "./eval"

// CLI flags:
//   --chunk=N         base-10^N cell size for cross-memo leaves (default 2)
//   --kt=N            Karatsuba fires when max digit count > N (default 8)
const opts = parseArgs()
const CHUNK = parseInt(opts.flags?.chunk ?? "2", 10)
const KT = parseInt(opts.flags?.kt ?? "8", 10)

if (!Number.isInteger(CHUNK) || CHUNK < 1 || CHUNK > 6) {
  throw new Error(`--chunk=N must be 1..6, got: ${opts.flags?.chunk}`)
}
if (!Number.isInteger(KT) || KT < 4) {
  throw new Error(`--kt=N must be >= 4, got: ${opts.flags?.kt}`)
}

const multiply = makeMultiply(CHUNK, KT)

function randomDecimal(digits: number, leadingNonZero = true): string {
  let s = ""
  for (let i = 0; i < digits; i++) {
    const lo = leadingNonZero && i === 0 ? 1 : 0
    s += randInt(lo, 9).toString()
  }
  return s
}

await runProgram(defineProgram({
  name: "arithmetic-2026-kara-memo",
  evaluate: (a, b) => multiply(a, b),
  // Give the model both forms: the integer (Karatsuba splits the operand
  // by division on the integer) and the cell-aligned LSB-first tape (the
  // cross-memo sub-block transcribes cells 1:1 from [USER]). Without the
  // cell form the model has to mentally chunk the integer when entering
  // a cross-memo block at the top level, which drifts on the first tape
  // copy. Same TAPE_CHUNK=4 wrapping as cross-memo standalone.
  encode: (a, b) => {
    const TAPE_CHUNK = 4
    const cellEncode = (s: string): string => {
      const pad = s.length % CHUNK === 0 ? 0 : CHUNK - (s.length % CHUNK)
      const padded = "0".repeat(pad) + s
      const cells: string[] = []
      for (let i = padded.length; i > 0; i -= CHUNK) {
        cells.push(padded.slice(i - CHUNK, i))
      }
      const labeled = cells.map((v, i) => `${i}:${v}`)
      const lines: string[] = []
      for (let i = 0; i < labeled.length; i += TAPE_CHUNK) {
        lines.push(labeled.slice(i, i + TAPE_CHUNK).join(" "))
      }
      return lines.join("\n")
    }
    return `A=${a}\n${cellEncode(a)}\nB=${b}\n${cellEncode(b)}`
  },
  display: (arg) => BigInt(arg).toLocaleString("en-US"),
  // FIRE ticks re-print the A/B tapes via REFRESH; SKIP ticks don't.
  // Slice the overflow prefill from the last FIRE so the model always has
  // the most recent operand re-print in context on continuation. Slicing
  // at any tick would cut off the REFRESH and leave the model without
  // the operand tape for 1..REFRESH_INTERVAL-1 iterations at a time.
  continueBoundary: /^tick=\d+ \[FIRE\]/m,
  trainingInputs: [
    // Sub-threshold: triggers pure cross-memo path (no Karatsuba).
    // These demonstrate the cross-memo base case.
    ["47", "23"],
    ["1234", "5678"],
    ["12345678", "87654321"],
    // Above threshold: Karatsuba fires. Sub-multiplications use cross-memo.
    // 12-digit input: half=6, sub-mults are ~6-digit (under threshold).
    ["123456789012", "987654321098"],
    // 16-digit input: half=8, sub-mults are ~8-digit (at threshold boundary,
    // sums-of-halves may exceed → cross-memo).
    ["1234567890123456", "9876543210987654"],
  ],
  generateTestInputs: (opts) => {
    const extra = opts?.extra ?? []
    if (extra.length > 0) {
      const a = parseInt(extra[0], 10)
      const b = parseInt(extra[1] ?? extra[0], 10)
      return Array.from({ length: 10 }, () =>
        [randomDecimal(a), randomDecimal(b)] as [string, string]
      )
    }
    const widths: Array<[number, number]> = [
      [8, 8], [8, 8], [16, 16], [16, 16], [32, 32], [32, 32],
    ]
    return widths.map(([a, b]) => [randomDecimal(a), randomDecimal(b)] as [string, string])
  },
  config: {
    temperature: 0,
    maxTokens: 4096,
    defaultModel: "anthropic/claude-opus-4.6",
  },
}))
