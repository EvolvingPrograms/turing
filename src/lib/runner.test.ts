import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { parseArgs } from "./runner"

describe("parseArgs", () => {
  const originalArgv = process.argv

  beforeEach(() => {
    process.argv = ["bun", "/some/index.ts"]
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  test("no args — all fields absent", () => {
    const opts = parseArgs()
    expect(opts.modelKey).toBeUndefined()
    expect(opts.debug).toBeUndefined()
    expect(opts.batchSize).toBeUndefined()
    expect(opts.limit).toBeUndefined()
    expect(opts.waitTime).toBeUndefined()
  })

  test("just modelKey positional", () => {
    process.argv = ["bun", "/some/index.ts", "anthropic"]
    const opts = parseArgs()
    expect(opts.modelKey).toBe("anthropic")
    expect(opts.debug).toBeUndefined()
  })

  test("flag-only --debug — no modelKey", () => {
    process.argv = ["bun", "/some/index.ts", "--debug"]
    const opts = parseArgs()
    expect(opts.modelKey).toBeUndefined()
    expect(opts.debug).toBe(true)
  })

  test("modelKey + flags in any order", () => {
    process.argv = ["bun", "/some/index.ts", "--debug", "anthropic", "--batch=4"]
    const opts = parseArgs()
    expect(opts.modelKey).toBe("anthropic")
    expect(opts.debug).toBe(true)
    expect(opts.batchSize).toBe(4)
  })

  test("multiple positionals — first wins, second is silently ignored", () => {
    process.argv = ["bun", "/some/index.ts", "anthropic", "extra"]
    const opts = parseArgs()
    // Only the first non-flag positional is captured as modelKey;
    // subsequent positionals are silently dropped (not --prefixed, but modelKey
    // is already set so the else-if branch is skipped).
    expect(opts.modelKey).toBe("anthropic")
  })

  test("--batch=N sets batchSize", () => {
    process.argv = ["bun", "/some/index.ts", "--batch=4"]
    const opts = parseArgs()
    expect(opts.batchSize).toBe(4)
  })

  test("--limit=N sets limit", () => {
    process.argv = ["bun", "/some/index.ts", "--limit=10"]
    const opts = parseArgs()
    expect(opts.limit).toBe(10)
  })

  test("--wait=N sets waitTime", () => {
    process.argv = ["bun", "/some/index.ts", "--wait=30"]
    const opts = parseArgs()
    expect(opts.waitTime).toBe(30)
  })

  test("invalid numeric --batch=abc yields NaN (parseInt behaviour)", () => {
    process.argv = ["bun", "/some/index.ts", "--batch=abc"]
    const opts = parseArgs()
    // parseInt("abc", 10) === NaN — impl does not validate, just stores it
    expect(Number.isNaN(opts.batchSize)).toBe(true)
  })

  test("overrides take precedence over argv", () => {
    process.argv = ["bun", "/some/index.ts", "--debug", "anthropic"]
    const opts = parseArgs({ modelKey: "openai" })
    expect(opts.modelKey).toBe("openai")
    expect(opts.debug).toBe(true)
  })

  test("partial overrides — only overridden field wins, rest come from argv", () => {
    process.argv = ["bun", "/some/index.ts", "anthropic", "--batch=8"]
    const opts = parseArgs({ debug: true })
    expect(opts.modelKey).toBe("anthropic")
    expect(opts.batchSize).toBe(8)
    expect(opts.debug).toBe(true)
  })
})
