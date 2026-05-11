import { defineProgram, runProgram } from "../../src/lib"
import { shuffle } from "../utils"
import automaton, { formatTape, type Tape, type TapeValue } from "./eval"

// CLI flags (read inside generateTestInputs via opts.flags):
//   --rule=N[,M,...] : restrict tests to one or more specific rules.
//                      Each named rule gets 20 random-tape instances so
//                      `--n=K` can slice down to K runs.
//   --steps=N        : override generations per test (default 9).
//                      Training still uses its own varied step counts
//                      (12, 9, 3, 2) so the model has seen multiple
//                      step counts regardless of test-side --steps.

// Adapter: the runner calls evaluate with string args; testAutomata already
// handles string initialState (via deformatTape) and string ruleNumber/generations.
async function evaluate(tapeStr: string, ruleStr: string, stepsStr: string): Promise<string> {
  return automaton(tapeStr, ruleStr, stepsStr, true)
}

// Helper to build a zero-filled Tape of length n with specific bits set.
function makeTape(length: number, ...setBits: number[]): Tape {
  const tape = Array.from<TapeValue>({ length }).fill(0)
  for (const bit of setBits) tape[bit] = 1
  return tape
}

// Training inputs derived from create-train.ts, tracing each tape mutation.
// Each tuple captures the tape state AT the moment automaton() was called.
const trainingInputs: Array<[string, string, string]> = [
  // twelve = [0,0,0,0,0,0,0,0,1,0,0,0] (twelve[8]=1)
  [formatTape(makeTape(12, 8)), "90", "12"],
  // twelve[0]=1 → [1,0,0,0,0,0,0,0,1,0,0,0]
  [formatTape(makeTape(12, 0, 8)), "54", "12"],

  // eleven = [0,0,0,0,0,0,0,0,0,1,0] (eleven[9]=1)
  [formatTape(makeTape(11, 9)), "150", "12"],
  // eleven[2]=1 → [0,0,1,0,0,0,0,0,0,1,0]
  [formatTape(makeTape(11, 2, 9)), "60", "9"],

  // four = [0,0,1,0] (four[2]=1), no mutations yet
  [formatTape(makeTape(4, 2)), "90", "3"],
  [formatTape(makeTape(4, 2)), "60", "3"],
  [formatTape(makeTape(4, 2)), "111", "9"],
  [formatTape(makeTape(4, 2)), "30", "9"],
  // four[0]=1 → [1,0,1,0]
  [formatTape(makeTape(4, 0, 2)), "211", "9"],
  [formatTape(makeTape(4, 0, 2)), "223", "3"],
  [formatTape(makeTape(4, 0, 2)), "227", "2"],
  [formatTape(makeTape(4, 0, 2)), "233", "3"],
]

// Replicate create-test.ts: curated rules prepended, rest shuffled with random 10-cell tapes.
const selected = [1, 0, 30, 54, 60, 62, 90, 94, 102, 110, 122, 126, 150, 158, 182, 188, 190, 220, 222, 250, 254]

function randomTape10(): Tape {
  const input: Tape = Array(10).fill(0)
  input[Math.floor(Math.random() * input.length)] = 1
  input[Math.floor(Math.random() * input.length)] = 1
  return input
}

function generateTestInputs(
  opts?: { flags?: Record<string, string> }
): Array<[string, string, string]> {
  const steps = opts?.flags?.steps ?? "9"
  const ruleFlag = opts?.flags?.rule

  if (ruleFlag) {
    const rules = ruleFlag.split(",").map(s => parseInt(s.trim(), 10))
    for (const r of rules) {
      if (!Number.isInteger(r) || r < 0 || r > 255) {
        throw new Error(`--rule values must be integers 0..255, got: ${ruleFlag}`)
      }
    }
    const out: Array<[string, string, string]> = []
    for (const r of rules) {
      for (let k = 0; k < 20; k++) {
        out.push([formatTape(randomTape10()), String(r), steps])
      }
    }
    return out
  }

  const examples: Array<[string, string, string]> = []

  // Non-selected rules: random tape
  for (let i = 0; i < 256; i++) {
    if (!selected.includes(i)) {
      examples.push([formatTape(randomTape10()), String(i), steps])
    }
  }

  const shuffled = shuffle(examples)

  // Selected rules prepended (in reverse order, matching original behavior)
  for (const rule of selected.reverse()) {
    shuffled.unshift([formatTape(randomTape10()), String(rule), steps])
  }

  return shuffled
}

await runProgram(defineProgram({
  name: "automata",
  evaluate,
  encode: (tape, rule, steps) => `${tape}\n${rule}\n${steps}`,
  trainingInputs,
  generateTestInputs,
  config: {
    temperature: 0,
    maxTokens: 4096,
    defaultModel: "anthropic/claude-opus-4.6",
  },
}))
