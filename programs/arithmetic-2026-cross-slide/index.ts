import { defineProgram, parseArgs, runProgram } from "../../src/lib"
import { randInt } from "../utils"
import { makeMultiply } from "./eval"

// Same CLI shape as arithmetic-2026-cross-memo: --chunk=N selects the
// base-10^N cell size. The slide variant uses a reversed-B tape (`R`)
// so per-pair indexing is `A[i] * R[i + t0]` with both indices
// incrementing in lockstep — no `j = k - i` per pair.
const opts = parseArgs()
const CHUNK = parseInt(opts.flags?.chunk ?? "2", 10)

if (!Number.isInteger(CHUNK) || CHUNK < 1 || CHUNK > 6) {
  throw new Error(`--chunk=N must be an integer 1..6, got: ${opts.flags?.chunk}`)
}

const multiply = makeMultiply(CHUNK)

function randomDecimal(digits: number, leadingNonZero = true): string {
  let s = ""
  for (let i = 0; i < digits; i++) {
    const lo = leadingNonZero && i === 0 ? 1 : 0
    s += randInt(lo, 9).toString()
  }
  return s
}

await runProgram(defineProgram({
  name: "arithmetic-2026-cross-slide",
  evaluate: (a, b) => multiply(a, b),
  encode: (a, b) => {
    const TAPE_CHUNK = 4
    // Slide variant: hand the model BOTH B (normal) and R (B reversed)
    // so it never has to mentally reverse 64+ cells during REFRESH —
    // it just transcribes whichever tape is asked for. The reversal is
    // a deterministic encoder step, not a model task.
    const cellsLSB = (s: string): string[] => {
      const pad = s.length % CHUNK === 0 ? 0 : CHUNK - (s.length % CHUNK)
      const padded = "0".repeat(pad) + s
      const cells: string[] = []
      for (let i = padded.length; i > 0; i -= CHUNK) {
        cells.push(padded.slice(i - CHUNK, i))
      }
      return cells
    }
    const labelWrap = (cells: string[]): string => {
      const labeled = cells.map((v, i) => `${i}:${v}`)
      const lines: string[] = []
      for (let i = 0; i < labeled.length; i += TAPE_CHUNK) {
        lines.push(labeled.slice(i, i + TAPE_CHUNK).join(" "))
      }
      return lines.join("\n")
    }
    const aCells = cellsLSB(a)
    const bCells = cellsLSB(b)
    const rCells = bCells.slice().reverse()
    return `A:\n${labelWrap(aCells)}\nB:\n${labelWrap(bCells)}\nR:\n${labelWrap(rCells)}`
  },
  display: (arg) => BigInt(arg).toLocaleString("en-US"),
  continuationMode: "trim",
  continueBoundary: /^RESUME k=\d+ tick=0\/\d+ FIRE /m,
  continueAnchor: "END_REFRESH",
  postTest: (args, trace) => {
    const [aStr, bStr] = args
    const expected = BigInt(aStr) * BigInt(bStr)
    // RETURN is wrapped at TAPE_CHUNK=8 cells per line, so the tape
    // spans many lines. Scan from the "RETURN " line and keep collecting
    // O-cell tokens from each subsequent line until we hit a blank line
    // or a non-O-shaped line.
    const lines = trace.split("\n")
    const retIdx = lines.findIndex(l => l.startsWith("RETURN "))
    if (retIdx < 0) return [["error", "no RETURN line in trace"]]
    const tokens: string[] = []
    tokens.push(...lines[retIdx].slice("RETURN ".length).trim().split(/\s+/).filter(Boolean))
    for (let i = retIdx + 1; i < lines.length; i++) {
      const l = lines[i].trim()
      if (!l || !/^O\d+_\d+\b/.test(l)) break
      tokens.push(...l.split(/\s+/).filter(Boolean))
    }
    const BASE = 10n ** BigInt(CHUNK)
    let computed = 0n
    for (let i = tokens.length - 1; i >= 0; i--) {
      const m = tokens[i].match(/^O\d+_(\d+)$/)
      if (!m) return [["error", `bad RETURN token: ${tokens[i]}`]]
      computed = computed * BASE + BigInt(m[1])
    }
    return [
      ["A", BigInt(aStr).toLocaleString("en-US")],
      ["B", BigInt(bStr).toLocaleString("en-US")],
      ["A × B", expected.toLocaleString("en-US")],
      ["computed", computed.toLocaleString("en-US")],
      ["cells", String(tokens.length)],
      ["match", computed === expected ? "✓" : "✗ MISMATCH"],
    ]
  },
  trainingInputs: [
    ["47", "23"],
    ["99", "99"],
    ["478", "32"],
    ["7890", "12"],
    ["123", "456"],
    ["1234", "5678"],
    ["123456", "789012"],
    ["13579246", "8642"],
    ["1234567890", "9876543210"],
    ["12345678901234567890", "98765432109876543210"],
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
      [4, 4], [4, 4], [8, 8], [8, 8], [12, 12], [12, 12], [16, 16], [16, 16], [19, 19], [19, 19],
    ]
    return widths.map(([a, b]) => [randomDecimal(a), randomDecimal(b)] as [string, string])
  },
  config: {
    temperature: 0,
    maxTokens: 4096,
    defaultModel: "anthropic/claude-opus-4.6",
    systemPreamble: "COMPUTER_MODE: NEVER WRITE HUMAN LANGUAGE",
  },
}))
