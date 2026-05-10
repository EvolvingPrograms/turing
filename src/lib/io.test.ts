import { describe, expect, test, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { defineProgram } from "./program"
import {
  defaultEncode,
  encodeArgs,
  formatTrainingTape,
  formatTestSet,
  writeTrainingTape,
  writeTestSet,
} from "./io"

// ---------------------------------------------------------------------------
// defaultEncode
// ---------------------------------------------------------------------------

describe("defaultEncode", () => {
  test("joins multiple args with newlines", () => {
    expect(defaultEncode(["a", "b", "c"])).toBe("a\nb\nc")
  })

  test("empty array returns empty string", () => {
    expect(defaultEncode([])).toBe("")
  })

  test("single arg returns the arg unchanged", () => {
    expect(defaultEncode(["only"])).toBe("only")
  })
})

// ---------------------------------------------------------------------------
// encodeArgs
// ---------------------------------------------------------------------------

describe("encodeArgs", () => {
  test("falls back to defaultEncode when encode is absent", () => {
    const prog = defineProgram({
      name: "test",
      evaluate: () => "",
      trainingInputs: [],
      generateTestInputs: () => [],
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })
    expect(encodeArgs(prog, ["x", "y"])).toBe("x\ny")
  })

  test("uses custom encode when provided", () => {
    const prog = defineProgram<[string, string]>({
      name: "test",
      evaluate: () => "",
      trainingInputs: [],
      generateTestInputs: () => [],
      encode: (a, b) => `${a}=${b}`,
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })
    expect(encodeArgs(prog, ["x", "y"])).toBe("x=y")
  })
})

// ---------------------------------------------------------------------------
// formatTrainingTape
// ---------------------------------------------------------------------------

describe("formatTrainingTape", () => {
  test("produces correct [USER]/[ASSISTANT] blocks for two training inputs", async () => {
    const prog = defineProgram({
      name: "test",
      evaluate: (...args: string[]) => "trace for " + args.join(","),
      trainingInputs: [["hello", "world"], ["foo", "bar"]],
      generateTestInputs: () => [],
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })

    const result = await formatTrainingTape(prog)

    // Should contain exactly two [USER] and two [ASSISTANT] markers
    const userMatches = result.match(/\[USER\]/g)
    const assistantMatches = result.match(/\[ASSISTANT\]/g)
    expect(userMatches?.length).toBe(2)
    expect(assistantMatches?.length).toBe(2)

    // First block
    expect(result).toContain("[USER]\nhello\nworld\n\n[ASSISTANT]\ntrace for hello,world\n\n")
    // Second block
    expect(result).toContain("[USER]\nfoo\nbar\n\n[ASSISTANT]\ntrace for foo,bar\n\n")
  })

  test("awaits async evaluate", async () => {
    const prog = defineProgram({
      name: "test",
      evaluate: async (...args: string[]) => {
        return Promise.resolve("async trace " + args.join("+"))
      },
      trainingInputs: [["p", "q"]],
      generateTestInputs: () => [],
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })

    const result = await formatTrainingTape(prog)
    expect(result).toBe("[USER]\np\nq\n\n[ASSISTANT]\nasync trace p+q\n\n")
  })

  test("applies custom encode to [USER] block", async () => {
    const prog = defineProgram({
      name: "test",
      evaluate: (a: string, b: string) => `${a}-${b}`,
      trainingInputs: [["x", "y"]],
      generateTestInputs: () => [],
      encode: (a: string, b: string) => `${a}|${b}`,
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })

    const result = await formatTrainingTape(prog)
    expect(result).toBe("[USER]\nx|y\n\n[ASSISTANT]\nx-y\n\n")
  })

  test("returns empty string for no training inputs", async () => {
    const prog = defineProgram({
      name: "test",
      evaluate: () => "irrelevant",
      trainingInputs: [],
      generateTestInputs: () => [],
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })

    const result = await formatTrainingTape(prog)
    expect(result).toBe("")
  })
})

// ---------------------------------------------------------------------------
// formatTestSet
// ---------------------------------------------------------------------------

describe("formatTestSet", () => {
  test("produces one JSON line per test input with default encode", () => {
    const prog = defineProgram<[string, string]>({
      name: "test",
      evaluate: () => "",
      trainingInputs: [],
      generateTestInputs: () => [["a", "b"], ["c", "d"]],
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })

    const result = formatTestSet(prog)
    const lines = result.split("\n").filter((l) => l.length > 0)
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0])).toEqual({ input: "a\nb" })
    expect(JSON.parse(lines[1])).toEqual({ input: "c\nd" })
  })

  test("applies custom encode in test set", () => {
    const prog = defineProgram<[string, string]>({
      name: "test",
      evaluate: () => "",
      trainingInputs: [],
      generateTestInputs: () => [["x", "y"]],
      encode: (a, b) => `${a}:${b}`,
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })

    const result = formatTestSet(prog)
    const lines = result.split("\n").filter((l) => l.length > 0)
    expect(JSON.parse(lines[0])).toEqual({ input: "x:y" })
  })

  test("result has a trailing newline", () => {
    const prog = defineProgram<[string, string]>({
      name: "test",
      evaluate: () => "",
      trainingInputs: [],
      generateTestInputs: () => [["a", "b"]],
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })

    const result = formatTestSet(prog)
    expect(result.endsWith("\n")).toBe(true)
  })

  test("empty generateTestInputs produces a single newline", () => {
    const prog = defineProgram({
      name: "test",
      evaluate: () => "",
      trainingInputs: [],
      generateTestInputs: () => [],
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })

    const result = formatTestSet(prog)
    // [].map(...).join("\n") + "\n" === "\n"
    expect(result).toBe("\n")
  })
})

// ---------------------------------------------------------------------------
// writeTrainingTape and writeTestSet
// ---------------------------------------------------------------------------

describe("writeTrainingTape", () => {
  let tmpDir: string

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("writes train.txt with correct content", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "turing-io-"))

    const prog = defineProgram({
      name: "test",
      evaluate: (...args: string[]) => args.join("+"),
      trainingInputs: [["1", "2"], ["3", "4"]],
      generateTestInputs: () => [],
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })

    await writeTrainingTape(tmpDir, prog)

    const written = readFileSync(join(tmpDir, "train.txt"), "utf8")
    const expected = await formatTrainingTape(prog)
    expect(written).toBe(expected)
  })
})

describe("writeTestSet", () => {
  let tmpDir: string

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("writes tests.jsonl with correct content", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "turing-io-"))

    const prog = defineProgram<[string, string]>({
      name: "test",
      evaluate: () => "",
      trainingInputs: [],
      generateTestInputs: () => [["a", "b"], ["c", "d"]],
      config: { defaultModel: "anthropic/claude-opus-4.6" },
    })

    await writeTestSet(tmpDir, prog)

    const written = readFileSync(join(tmpDir, "tests.jsonl"), "utf8")
    const expected = formatTestSet(prog)
    expect(written).toBe(expected)
  })
})
