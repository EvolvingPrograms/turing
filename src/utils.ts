import { existsSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import { readFile, writeFile } from "fs/promises"

export type TextFile = `${string}.txt`
export type JSONFile = `${string}.json`
export type JSONLFile = `${string}.jsonl`
export type TSFile = `${string}.ts`

export type TestFile = TextFile | JSONFile | JSONLFile | TSFile

export const isTextFile = (file: TestFile): file is TextFile => file.endsWith(".txt")
export const isJSONFile = (file: TestFile): file is JSONFile => file.endsWith(".json")
export const isJSONLFile = (file: TestFile): file is JSONLFile => file.endsWith(".jsonl")
export const isTSFile = (file: TestFile): file is TSFile => file.endsWith(".ts")

const TEST_DIR = dirname(Bun.main)

export const loadTextFile = async (file: TextFile) => {
  const path = resolve(TEST_DIR, file)
  return (await readFile(path, "utf-8")).trim()
}

export const loadJSONFile = async <T>(file: JSONFile) => {
  const path = resolve(TEST_DIR, file)
  const contents = (await readFile(path, "utf-8")).trim()
  return JSON.parse(contents) as T
}

export const loadJSONLFile = async <T>(file: JSONLFile) => {
  const path = resolve(TEST_DIR, file)
  const contents = (await readFile(path, "utf-8")).trim()
  return contents.split("\n").map((line) => JSON.parse(line)) as T[]
}

export const loadModuleFile = async (file: TSFile) => {
  const path = resolve(TEST_DIR, file)
  return await import(path)
}


export const writeTestFile = async (
  id: string,
  path: string,
  contents: string
) => {
  const fullPath = resolve("logs", id, path)
  const logDir = resolve("logs", id)

  if (existsSync(logDir) === false) {
    mkdirSync(logDir, { recursive: true })
  }

  return await writeFile(fullPath, contents)
}

export function longFormat(value: number) {
  return value.toLocaleString("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
  })
}