// { "input": "0000000010\n26\n10" }
// { "input": "0001000010\n18\n10" }
// { "input": "0001010010\n30\n10" }
// { "input": "0101000010\n22\n10" }

import { writeFile } from "fs/promises"
import { resolve, dirname } from "path"
import { formatTape, type Tape } from "./eval"
import { shuffle } from "../../src/utils"

const TEST_JSONL = resolve(
  dirname(Bun.main),
  "tests.jsonl"
)

await writeFile(TEST_JSONL, "")

type Example = {
  input: string;
}

// const selected: number[] = []
const selected = [1, 0, 30, 54, 60, 62, 90, 94, 102, 110, 122, 126, 150, 158, 182, 188, 190, 220, 222, 250, 254]
const examples: Example[] = []

// Add the remaining rules (0 to 255) excluding the selected ones
for (let i = 0; i < 256; i++) {
  if (!selected.includes(i)) {
    const input: Tape = Array(10).fill(0)
    input[Math.floor(Math.random() * input.length)] = 1
    input[Math.floor(Math.random() * input.length)] = 1
    examples.push({ input: `${formatTape(input)}\n${i}\n9` })
  }
}

const shuffled = shuffle(examples)

// Add the selected rules first
for (const rule of selected.reverse()) {
  const input: Tape = Array(10).fill(0)
  input[Math.floor(Math.random() * input.length)] = 1
  input[Math.floor(Math.random() * input.length)] = 1
  shuffled.unshift({ input: `${formatTape(input)}\n${rule}\n9` })
}

for (const example of shuffled) {
  await writeFile(TEST_JSONL, JSON.stringify(example) + "\n", { flag: "a" })
}

