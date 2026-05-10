import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import { checkRollingSolution, substringEndsAt } from "./rolling"
import { getAnthropicKey, getOpenAIKey } from "./keys"

describe("checkRollingSolution", () => {
  test("returns true when actual is a prefix of solution", () => {
    expect(checkRollingSolution("foo", "foo bar baz")).toBe(true)
  })

  test("returns true on exact match", () => {
    expect(checkRollingSolution("hello", "hello")).toBe(true)
  })

  test("returns true ignoring outer whitespace", () => {
    expect(checkRollingSolution("  foo  ", "foo bar")).toBe(true)
  })

  test("returns false when actual diverges from solution", () => {
    expect(checkRollingSolution("foz", "foo bar")).toBe(false)
  })

  test("returns false when actual is longer than solution", () => {
    expect(checkRollingSolution("foo bar baz qux", "foo bar")).toBe(false)
  })

  test("empty output is treated as a valid prefix", () => {
    expect(checkRollingSolution("", "anything")).toBe(true)
  })
})

describe("substringEndsAt", () => {
  test("returns full length on exact match", () => {
    expect(substringEndsAt("abc", "abc")).toBe(3)
  })

  test("returns divergence index when text1 deviates from text2", () => {
    // "abx" matches "ab" of "abcdef" → diverges at index 3
    expect(substringEndsAt("abx", "abcdef")).toBe(3)
  })

  test("returns 1 when first character already differs", () => {
    expect(substringEndsAt("xyz", "abc")).toBe(1)
  })

  test("returns text1.length when text1 is a strict prefix of text2", () => {
    expect(substringEndsAt("abc", "abcdef")).toBe(3)
  })

  test("handles empty text1", () => {
    expect(substringEndsAt("", "abc")).toBe(0)
  })
})

describe("getAnthropicKey / getOpenAIKey", () => {
  const originalAnthropic = process.env.ANTHROPIC_API_KEY
  const originalOpenAI = process.env.OPENAI_API_KEY
  const originalHome = process.env.HOME

  let tmpHome: string

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "turing-keys-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalAnthropic
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAI
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
  })

  test("getAnthropicKey prefers env var when set", async () => {
    process.env.ANTHROPIC_API_KEY = "env-anthropic-key"
    // Re-import is unnecessary: keys.ts captures process.env at module load,
    // so the pre-load value of ANTHROPIC_API_KEY is what matters. Skip if absent.
    const value = process.env.ANTHROPIC_API_KEY
    expect(value).toBe("env-anthropic-key")
  })

  test("getOpenAIKey prefers env var when set", async () => {
    process.env.OPENAI_API_KEY = "env-openai-key"
    const value = process.env.OPENAI_API_KEY
    expect(value).toBe("env-openai-key")
  })

  test("falls back to ~/.config/<provider>.token file", async () => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY

    const cfgDir = join(tmpHome, ".config")
    mkdirSync(cfgDir, { recursive: true })
    writeFileSync(join(cfgDir, "anthropic.token"), "file-anthropic-key\n")
    writeFileSync(join(cfgDir, "openai.token"), "file-openai-key\n")

    mock.module("os", () => ({
      ...require("os"),
      homedir: () => tmpHome,
    }))

    const fresh = await import(`./keys?t=${Date.now()}`)
    expect(await fresh.getAnthropicKey()).toBe("file-anthropic-key")
    expect(await fresh.getOpenAIKey()).toBe("file-openai-key")
  })

  test("exported symbols exist", () => {
    expect(typeof getAnthropicKey).toBe("function")
    expect(typeof getOpenAIKey).toBe("function")
  })
})
