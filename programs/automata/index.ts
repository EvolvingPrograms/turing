import { defineProgram, runProgram } from "../../src/lib"
import { shuffle } from "../utils"
import automaton, { formatTape, type Tape, type TapeValue } from "./eval"

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

function generateTestInputs(): Array<[string, string, string]> {
  const examples: Array<[string, string, string]> = []

  // Non-selected rules: random tape, steps=9
  for (let i = 0; i < 256; i++) {
    if (!selected.includes(i)) {
      const input: Tape = Array(10).fill(0)
      input[Math.floor(Math.random() * input.length)] = 1
      input[Math.floor(Math.random() * input.length)] = 1
      examples.push([formatTape(input), String(i), "9"])
    }
  }

  const shuffled = shuffle(examples)

  // Selected rules prepended (in reverse order, matching original behavior)
  for (const rule of selected.reverse()) {
    const input: Tape = Array(10).fill(0)
    input[Math.floor(Math.random() * input.length)] = 1
    input[Math.floor(Math.random() * input.length)] = 1
    shuffled.unshift([formatTape(input), String(rule), "9"])
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
    models: {
      openai: "openai/gpt-4",
      anthropic: "anthropic/claude-3-opus@20240229",
    },
  },
}))
