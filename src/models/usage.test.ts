import { describe, expect, test, spyOn } from "bun:test"

import { zeroUsage, addUsage, printUsage, summarizeUsage } from "./usage"
import type { UsageSummary } from "./usage"

// ---------------------------------------------------------------------------
// zeroUsage
// ---------------------------------------------------------------------------

describe("zeroUsage", () => {
  test("returns all-zero numeric fields", () => {
    const z = zeroUsage()
    expect(z.inputTokens).toBe(0)
    expect(z.outputTokens).toBe(0)
    expect(z.totalTokens).toBe(0)
    expect(z.cacheReadTokens).toBe(0)
    expect(z.cacheWriteTokens).toBe(0)
    expect(z.reasoningTokens).toBe(0)
  })

  test("cost is undefined (not 0)", () => {
    expect(zeroUsage().cost).toBeUndefined()
  })

  test("each call returns a new object", () => {
    const a = zeroUsage()
    const b = zeroUsage()
    expect(a).not.toBe(b)
  })

  test("mutating the result does not affect subsequent calls", () => {
    const a = zeroUsage()
    a.inputTokens = 999
    const b = zeroUsage()
    expect(b.inputTokens).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// addUsage
// ---------------------------------------------------------------------------

describe("addUsage", () => {
  const makeUsage = (overrides: Partial<UsageSummary> = {}): UsageSummary => ({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    ...overrides,
  })

  test("sums all numeric fields", () => {
    const a = makeUsage({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      reasoningTokens: 1,
    })
    const b = makeUsage({
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      cacheReadTokens: 4,
      cacheWriteTokens: 6,
      reasoningTokens: 2,
    })
    const result = addUsage(a, b)
    expect(result.inputTokens).toBe(30)
    expect(result.outputTokens).toBe(15)
    expect(result.totalTokens).toBe(45)
    expect(result.cacheReadTokens).toBe(6)
    expect(result.cacheWriteTokens).toBe(9)
    expect(result.reasoningTokens).toBe(3)
  })

  test("cost undefined + undefined → undefined", () => {
    const a = makeUsage()
    const b = makeUsage()
    expect(addUsage(a, b).cost).toBeUndefined()
  })

  test("cost defined + undefined → treats undefined as 0", () => {
    const a = makeUsage({ cost: 1 })
    const b = makeUsage()
    expect(addUsage(a, b).cost).toBe(1)
  })

  test("undefined + cost defined → treats undefined as 0", () => {
    const a = makeUsage()
    const b = makeUsage({ cost: 2.5 })
    expect(addUsage(a, b).cost).toBe(2.5)
  })

  test("cost + cost → sums", () => {
    const a = makeUsage({ cost: 1.5 })
    const b = makeUsage({ cost: 2.5 })
    expect(addUsage(a, b).cost).toBeCloseTo(4.0)
  })

  test("does not mutate inputs", () => {
    const a = makeUsage({ inputTokens: 10, cost: 1 })
    const b = makeUsage({ inputTokens: 20, cost: 2 })
    const aCopy = { ...a }
    const bCopy = { ...b }
    addUsage(a, b)
    expect(a).toEqual(aCopy)
    expect(b).toEqual(bCopy)
  })
})

// ---------------------------------------------------------------------------
// summarizeUsage — without providerMetadata
// ---------------------------------------------------------------------------

describe("summarizeUsage (no providerMetadata)", () => {
  test("projects basic usage fields", () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
    }
    const result = summarizeUsage(usage)
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(50)
    expect(result.totalTokens).toBe(150)
    expect(result.cacheReadTokens).toBe(0)
    expect(result.cacheWriteTokens).toBe(0)
    expect(result.reasoningTokens).toBe(0)
    expect(result.cost).toBeUndefined()
  })

  test("projects cacheReadTokens and cacheWriteTokens", () => {
    const usage = {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 1234, cacheWriteTokens: 567 },
      outputTokenDetails: { textTokens: 100, reasoningTokens: 0 },
    }
    const result = summarizeUsage(usage)
    expect(result.cacheReadTokens).toBe(1234)
    expect(result.cacheWriteTokens).toBe(567)
    expect(result.cost).toBeUndefined()
  })

  test("projects reasoningTokens", () => {
    const usage = {
      inputTokens: 50,
      outputTokens: 300,
      totalTokens: 350,
      inputTokenDetails: { noCacheTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 100, reasoningTokens: 200 },
    }
    const result = summarizeUsage(usage)
    expect(result.reasoningTokens).toBe(200)
    expect(result.cost).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// summarizeUsage — with gateway providerMetadata
// ---------------------------------------------------------------------------

describe("summarizeUsage (gateway cost in providerMetadata)", () => {
  const baseUsage = {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
  }

  test("parses cost string returned by the gateway", () => {
    const meta = { gateway: { cost: "0.0042" } }
    const result = summarizeUsage(baseUsage, meta)
    expect(result.cost).toBeCloseTo(0.0042)
  })

  test("accepts numeric cost as-is", () => {
    const meta = { gateway: { cost: 0.0099 } }
    const result = summarizeUsage(baseUsage, meta)
    expect(result.cost).toBeCloseTo(0.0099)
  })

  test("missing gateway field → cost undefined", () => {
    const result = summarizeUsage(baseUsage, {})
    expect(result.cost).toBeUndefined()
  })

  test("missing cost field → cost undefined", () => {
    const result = summarizeUsage(baseUsage, { gateway: {} })
    expect(result.cost).toBeUndefined()
  })

  test("malformed cost string → cost undefined", () => {
    const result = summarizeUsage(baseUsage, { gateway: { cost: "not-a-number" } })
    expect(result.cost).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// printUsage
// ---------------------------------------------------------------------------

describe("printUsage", () => {
  test("logs label, token counts, and dollar sign once", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {})

    const usage: UsageSummary = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      cacheReadTokens: 800,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      cost: 0.0123,
    }

    printUsage("run 1", usage, usage)

    // Three calls: leading blank console.log() (separator from streamed
    // output), per-run summary line, cumulative summary line.
    expect(spy).toHaveBeenCalledTimes(3)

    const runLine = spy.mock.calls[1].join(" ")
    const cumLine = spy.mock.calls[2].join(" ")
    expect(runLine).toContain("run 1")
    expect(runLine).toContain("in=")
    expect(runLine).toContain("out=")
    expect(runLine).toContain("$")
    expect(cumLine).toContain("cum")
    expect(cumLine).toContain("in=")
    expect(cumLine).toContain("out=")

    spy.mockRestore()
  })
})
