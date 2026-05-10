import { defineProgram, runProgram } from "../../src/lib"
import { toPositional } from "../encoding"
import multiply from "./eval"

const train: Array<[number, number]> = [
  [99_999, 99_99],
  [10_000_019, 15_485_863],
  [1_000_003, 1_299_709],
  [19_278, 12_306],
  [11, 20],
  [4, 3],
  [12, 12],
  [16, 15],
  [24, 16],
  [32, 31],
  [64, 63],
  [49, 30],
]

const curatedTests: Array<[number, number]> = [
  [99_971, 99_993],
]

await runProgram(defineProgram({
  name: "arithmetic",
  evaluate: (a, b) => multiply(a, b),
  trainingInputs: train.map(([a, b]) =>
    [toPositional(a), toPositional(b)] as [string, string]
  ),
  generateTestInputs: () => {
    const tests: Array<[string, string]> = curatedTests.map(([a, b]) =>
      [toPositional(a), toPositional(b)]
    )
    for (let i = 0; i < 10; i++) {
      const a = Math.floor(Math.random() * 10)
      const b = Math.floor(Math.random() * 10)
      tests.push([toPositional(a), toPositional(b)])
    }
    return tests
  },
  config: {
    temperature: 0,
    maxTokens: 4096,
    models: {
      openai: "openai/gpt-5",
      anthropic: "anthropic/claude-opus-4.6",
    },
  },
}))
