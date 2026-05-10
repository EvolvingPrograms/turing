import { writeFile } from "fs/promises"
import { resolve, dirname } from "path"
import { toPositional } from "../utils"

const TEST_JSONL = resolve(dirname(Bun.main), "tests.jsonl")

await writeFile(TEST_JSONL, "")

type Example = { input: string }

function randomHex(nibbles: number): string {
  let s = ""
  // First nibble nonzero to keep length stable.
  s += Math.floor(Math.random() * 15 + 1).toString(16)
  for (let i = 1; i < nibbles; i++) {
    s += Math.floor(Math.random() * 16).toString(16)
  }
  return s
}

const widths = [4, 4, 4, 8, 8, 8, 12, 12, 14, 14]

const examples: Example[] = widths.map(w => ({
  input: `${toPositional(randomHex(w))}\n${toPositional(randomHex(w))}`,
}))

for (const example of examples) {
  await writeFile(TEST_JSONL, JSON.stringify(example) + "\n", { flag: "a" })
}
