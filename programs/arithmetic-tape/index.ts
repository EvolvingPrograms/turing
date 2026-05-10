import { defineProgram, runProgram } from "../../src/lib"
import { toPositionalBinary } from "../encoding"
import multiply from "./eval"

const train: Array<[number, number]> = [
  [7_954_114_363, 9_999_999_999],
  [75, 75],
  [11, 20],
  [4, 3],
  [9, 83],
  [12, 98],
  [49, 302],
  [29, 12],
  [96, 213],
]

const curatedTests: Array<[number, number]> = [
  [99_999_420, 99_999_069],
  [19_278, 12_306],
]

await runProgram(defineProgram({
  name: "arithmetic-tape",
  evaluate: (a, b) => multiply(a, b),
  encode: (a, b) => `${a}\n${b}`,
  trainingInputs: train.map(([a, b]) =>
    [toPositionalBinary(a), toPositionalBinary(b)] as [string, string]
  ),
  generateTestInputs: () => {
    const tests: Array<[string, string]> = curatedTests.map(([a, b]) =>
      [toPositionalBinary(a), toPositionalBinary(b)]
    )
    for (let i = 0; i < 10; i++) {
      const a = Math.floor(Math.random() * 10)
      const b = Math.floor(Math.random() * 10)
      tests.push([toPositionalBinary(a), toPositionalBinary(b)])
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
