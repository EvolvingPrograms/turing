import { defineProgram, runProgram } from "../../src/lib"
import gol, { deformatGrid, formatGridBlock, formatGridRaw, type Grid, type CellValue } from "./eval"

// CLI flags:
//   --size=N   : square grid side (default 10). Random fill.
//   --steps=N  : generations per test (default 2).
//   --n=K      : number of test instances (default 1).
//   --density=F: live-cell fraction for random tapes (default 0.35).
//
// Schema imitates Olivia Helens' CGoL tape format (see
// oliviahelens/CoGL_automaton share/format-for-lewis.md). Three
// few-shots — block 4x4 / 2-step, blinker 5x5 / 2-step, glider 6x6
// / 4-step — are emitted as the training tape. The ~28K-token shot
// prefix caches across all trials.

async function evaluate(gridStr: string, stepsStr: string): Promise<string> {
  return gol(gridStr, stepsStr, true)
}

function makeGrid(rows: number, cols: number, ...alive: Array<[number, number]>): Grid {
  const g: Grid = Array.from({ length: rows }, () => Array(cols).fill(0) as CellValue[])
  for (const [r, c] of alive) g[r][c] = 1
  return g
}

function randomGrid(rows: number, cols: number, density = 0.35): Grid {
  const g: Grid = Array.from({ length: rows }, () => Array(cols).fill(0) as CellValue[])
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g[r][c] = Math.random() < density ? 1 : 0
    }
  }
  return g
}

const trainingInputs: Array<[string, string]> = [
  // Small noisy shots — non-iconic patterns at sizes where most cells
  // sit on the border (so the model sees many `oob░(t)` entries in
  // sequence, reinforcing the OOB tally format). 4 steps each so each
  // small shot contributes 4× the cell-line count, balancing the
  // training tape against the interior-heavy large shots.
  [formatGridRaw(makeGrid(6, 6, [0, 1], [1, 4], [2, 0], [2, 3], [3, 5], [4, 2], [5, 4])), "4"],
  [formatGridRaw(makeGrid(6, 6, [0, 0], [0, 5], [2, 2], [3, 3], [5, 0], [5, 5])), "4"],
  [formatGridRaw(makeGrid(6, 6, [1, 1], [1, 3], [2, 0], [3, 5], [4, 1], [4, 4])), "4"],
  // LWSS 10x10 / 2 steps — full-scale spaceship, matches the production
  // test grid size. Critical anchor: without an at-scale shot the model
  // compresses the verbose 8-neighbor format on 10x10 inputs.
  [formatGridRaw(makeGrid(
    10, 10,
    [2, 2], [2, 5],
    [3, 6],
    [4, 2], [4, 6],
    [5, 3], [5, 4], [5, 5], [5, 6],
  )), "2"],
  // 16x16 / 2 steps — larger OOD anchor. Random-ish pattern with mixed
  // density so the model has seen the two-digit-index format up to
  // and past the typical test grid sizes.
  [formatGridRaw(makeGrid(
    16, 16,
    [1, 2], [1, 5], [2, 3], [2, 4], [2, 10], [2, 11],
    [4, 7], [4, 8], [5, 1], [5, 13], [5, 14],
    [7, 6], [7, 7], [7, 8], [8, 2], [8, 12],
    [10, 3], [10, 4], [10, 5], [11, 9],
    [13, 1], [13, 2], [13, 13], [14, 14],
  )), "2"],
]

function generateTestInputs(
  opts?: { flags?: Record<string, string>; n?: number }
): Array<[string, string]> {
  const size = parseInt(opts?.flags?.size ?? "10", 10)
  const steps = opts?.flags?.steps ?? "2"
  const density = parseFloat(opts?.flags?.density ?? "0.35")
  const trials = opts?.n ?? 1

  if (!Number.isInteger(size) || size < 2 || size > 40) {
    throw new Error(`--size must be an integer 2..40, got: ${opts?.flags?.size}`)
  }

  return Array.from({ length: trials }, () => [
    formatGridRaw(randomGrid(size, size, density)),
    steps,
  ] as [string, string])
}

await runProgram(defineProgram({
  name: "game-of-life",
  evaluate,
  encode: (grid, steps) => {
    const g = deformatGrid(grid)
    const R = g.length
    const C = g[0].length
    return `SIZE ${R}x${C}\nSTEPS ${steps}\nGRID 0/${steps}\n${formatGridBlock(g)}`
  },
  trainingInputs,
  generateTestInputs,
  handleN: true,
  // Step structure: `STEP t→t+1` starts a step (the slice point);
  // `NEW GRID t+1/N` ends it (must appear after the start for the
  // step to qualify as complete). A "complete step" is one full
  // STEP block + its resulting NEW GRID. With `continueWindow: 2`
  // the prefill carries the last 2 complete steps in full (cells
  // and all), preceded by the algorithmic header (RULE/LOOKUP/
  // BOUNDARY + initial GRID 0/N). If fewer than 2 complete steps
  // have been emitted, the slicer returns the full trace untrimmed.
  continuationMode: "trim",
  continueStart: /^STEP \d+→\d+$/m,
  continueEnd: /^NEW GRID /m,
  continueWindow: 2,
  config: {
    temperature: 0,
    maxTokens: 128_000,
    defaultModel: "anthropic/claude-opus-4.6",
    systemPreamble: "COMPUTER_MODE: NO_HUMAN_LANGUAGE\nFAILS_IF: COMPUTATION_BREAK\nSTOP_TOKEN: DONE",
    stopSequences: ["DONE"],
  },
}))
