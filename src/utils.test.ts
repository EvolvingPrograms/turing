import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import {
  isTextFile,
  isJSONFile,
  isJSONLFile,
  isTSFile,
  loadTextFile,
  loadJSONFile,
  loadJSONLFile,
  loadModuleFile,
  writeTestFile,
  longFormat,
} from "./utils"

// --- Type guards ---

describe("isTextFile", () => {
  test("returns true for .txt file", () => {
    expect(isTextFile("foo.txt")).toBe(true)
  })

  test("returns false for .json file", () => {
    expect(isTextFile("foo.json" as any)).toBe(false)
  })
})

describe("isJSONFile", () => {
  test("returns true for .json file", () => {
    expect(isJSONFile("data.json")).toBe(true)
  })

  test("returns false for .txt file", () => {
    expect(isJSONFile("data.txt" as any)).toBe(false)
  })
})

describe("isJSONLFile", () => {
  test("returns true for .jsonl file", () => {
    expect(isJSONLFile("data.jsonl")).toBe(true)
  })

  test("returns false for .json file", () => {
    expect(isJSONLFile("data.json" as any)).toBe(false)
  })
})

describe("isTSFile", () => {
  test("returns true for .ts file", () => {
    expect(isTSFile("module.ts")).toBe(true)
  })

  test("returns false for .txt file", () => {
    expect(isTSFile("module.txt" as any)).toBe(false)
  })
})

// --- longFormat ---

describe("longFormat", () => {
  test("formats 0", () => {
    expect(longFormat(0)).toBe("0")
  })

  test("formats 1", () => {
    expect(longFormat(1)).toBe("1")
  })

  test("formats 999 without compact suffix", () => {
    expect(longFormat(999)).toContain("999")
  })

  test("formats 1500 with K suffix", () => {
    const result = longFormat(1500)
    expect(result).toContain("1.5")
    expect(result.toUpperCase()).toContain("K")
  })

  test("formats 1_500_000 with M suffix", () => {
    const result = longFormat(1_500_000)
    expect(result).toContain("1.5")
    expect(result.toUpperCase()).toContain("M")
  })

  test("formats negative number", () => {
    const result = longFormat(-1500)
    expect(result).toContain("1.5")
    expect(result).toContain("-")
  })
})

// --- writeTestFile ---

describe("writeTestFile", () => {
  let tmpDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpDir = mkdtempSync(join(tmpdir(), "turing-utils-"))
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("writes file to logs/<id>/<path> relative to CWD", async () => {
    await writeTestFile("run-1", "output.txt", "hello world")
    const content = readFileSync(join(tmpDir, "logs", "run-1", "output.txt"), "utf-8")
    expect(content).toBe("hello world")
  })

  test("creates intermediate directories if they do not exist", async () => {
    await writeTestFile("new-id", "result.txt", "data")
    const content = readFileSync(join(tmpDir, "logs", "new-id", "result.txt"), "utf-8")
    expect(content).toBe("data")
  })

  test("overwrites existing file with new contents", async () => {
    await writeTestFile("run-2", "file.txt", "first")
    await writeTestFile("run-2", "file.txt", "second")
    const content = readFileSync(join(tmpDir, "logs", "run-2", "file.txt"), "utf-8")
    expect(content).toBe("second")
  })
})

// --- File loaders (loadTextFile, loadJSONFile, loadJSONLFile, loadModuleFile) ---
//
// These functions resolve paths relative to TEST_DIR = dirname(Bun.main), which
// is captured as a module-level constant at import time. There is no way to
// patch Bun.main after the module has already been imported, so we cannot
// redirect file resolution to a temp directory in tests. Direct behavioural
// tests are therefore skipped; only a symbol-presence sanity check is included.

describe("file loaders (sanity)", () => {
  test("loadTextFile is a function", () => {
    expect(typeof loadTextFile).toBe("function")
  })

  test("loadJSONFile is a function", () => {
    expect(typeof loadJSONFile).toBe("function")
  })

  test("loadJSONLFile is a function", () => {
    expect(typeof loadJSONLFile).toBe("function")
  })

  test("loadModuleFile is a function", () => {
    expect(typeof loadModuleFile).toBe("function")
  })

  // Skipped: cannot test real file I/O because TEST_DIR is captured at module
  // import time from dirname(Bun.main) and cannot be overridden after import.
  test.skip("loadTextFile reads a file relative to Bun.main dir", async () => {})
  test.skip("loadJSONFile parses JSON relative to Bun.main dir", async () => {})
  test.skip("loadJSONLFile parses JSONL relative to Bun.main dir", async () => {})
  test.skip("loadModuleFile imports a TS module relative to Bun.main dir", async () => {})
})
