import { defineProgram, parseArgs, runProgram } from "../../src/lib"
import { randInt } from "../utils"
import { makeMultiply } from "./eval"

// Read --chunk=N via the lib's CLI parser (the same one runProgram uses).
// All training and test runs in one invocation use the same chunk. To
// compare e.g. chunk=2 vs chunk=3, run the program twice with the flag
// changed. Default chunk=2 (base-100, 2x2 mental products).
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
  name: "arithmetic-2026-cross-memo",
  evaluate: (a, b) => multiply(a, b),
  // Encode in CHUNK-digit cells, LSB-first — matching the tape format the
  // model emits inside the trace. Also break across multiple lines (4 cells
  // per line) to match the tape's TAPE_CHUNK chunking, so the model sees the
  // exact same shape in [USER] as it must produce in the trace's first lines.
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
    return `${cellEncode(a)}\n${cellEncode(b)}`
  },
  display: (arg) => BigInt(arg).toLocaleString("en-US"),
  // Trim continuations, sliced from the most recent FIRE tick. The trace
  // emits a `RESUME k=N carry=C prev=O<k-1>_..` line right after every
  // `k=N` header, which gives the model an in-voice situational summary
  // at every row boundary. Combined with `[i/n]` at line start, this lets
  // the model re-establish frame from a short prefill alone — no need to
  // keep the entire prior conversation in context (stack mode).
  continuationMode: "trim",
  continueStart: /^RESUME k=\d+ tick=0\/\d+ FIRE /m,
  continueEnd: "END_REFRESH",
  postTest: (args, trace) => {
    const [aStr, bStr] = args
    const expected = BigInt(aStr) * BigInt(bStr)
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
    // 20-dig × 20-dig — 10 base-100 cells per operand. At TAPE_CHUNK=8 this
    // crosses the single-line tape threshold (10 cells = 2 lines), so the
    // model sees what a multi-line REFRESH looks like in training. Without
    // this, the model extrapolates poorly from 1-line tapes to 8-line ones
    // at large operand sizes and tends to collapse them back to a single line.
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
    systemPreamble: "COMPUTER_MODE: NEVER WRITE HUMAN LANGUAGE TEXT RESPONSES; ONLY COMPUTE PROGRAM",
  },
}))
