import { defineProgram, runProgram } from "../../src/lib"
import { toPositionalHex } from "../encoding"
import { randomHex } from "../utils"
import multiply from "./eval"

await runProgram(defineProgram({
  name: "arithmetic-2026",
  evaluate: (a, b) => multiply(a, b),
  encode: (a, b) => `${toPositionalHex(a)}\n${toPositionalHex(b)}`,
  trainingInputs: [
    ["7e", "23"],
    ["a3f", "207"],
    ["9c", "830"],
    ["1234", "5678"],
    ["abc1", "9d20"],
    ["7f3a", "8025"],
    ["c4d801", "9af20b"],
  ],
  generateTestInputs: () => {
    const widths = [4, 4, 4, 8, 8, 8, 12, 12, 14, 14]
    return widths.map(w => [randomHex(w), randomHex(w)] as [string, string])
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
