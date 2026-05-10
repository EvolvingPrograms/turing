import { describe, expect, test, mock, spyOn } from "bun:test"

import { zeroUsage, addUsage, printUsage } from "./usage"
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
// summarizeUsage — no responseId
// ---------------------------------------------------------------------------

describe("summarizeUsage (no responseId)", () => {
  test("projects basic usage fields", async () => {
    const { summarizeUsage } = await import("./usage")
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
    }
    const result = await summarizeUsage(usage)
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(50)
    expect(result.totalTokens).toBe(150)
    expect(result.cacheReadTokens).toBe(0)
    expect(result.cacheWriteTokens).toBe(0)
    expect(result.reasoningTokens).toBe(0)
    expect(result.cost).toBeUndefined()
  })

  test("projects cacheReadTokens and cacheWriteTokens", async () => {
    const { summarizeUsage } = await import("./usage")
    const usage = {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 1234, cacheWriteTokens: 567 },
      outputTokenDetails: { textTokens: 100, reasoningTokens: 0 },
    }
    const result = await summarizeUsage(usage)
    expect(result.cacheReadTokens).toBe(1234)
    expect(result.cacheWriteTokens).toBe(567)
    expect(result.cost).toBeUndefined()
  })

  test("projects reasoningTokens", async () => {
    const { summarizeUsage } = await import("./usage")
    const usage = {
      inputTokens: 50,
      outputTokens: 300,
      totalTokens: 350,
      inputTokenDetails: { noCacheTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 100, reasoningTokens: 200 },
    }
    const result = await summarizeUsage(usage)
    expect(result.reasoningTokens).toBe(200)
    expect(result.cost).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// summarizeUsage — with responseId (mock gateway)
// ---------------------------------------------------------------------------

describe("summarizeUsage (with responseId)", () => {
  const baseUsage = {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
  }

  test("populates cost from gateway.getGenerationInfo", async () => {
    mock.module("ai", () => ({
      gateway: {
        getGenerationInfo: async () => ({
          totalCost: 0.0042,
        }),
      },
    }))

    const fresh = await import(`./usage?t=${Date.now()}`)
    const result = await fresh.summarizeUsage(baseUsage, "gen_xyz")
    expect(result.cost).toBeCloseTo(0.0042)
  })

  test("retries on first failure and returns cost on second success", async () => {
    let calls = 0
    mock.module("ai", () => ({
      gateway: {
        getGenerationInfo: async () => {
          calls++
          if (calls === 1) throw new Error("temporarily unavailable")
          return { totalCost: 0.0099 }
        },
      },
    }))

    const fresh = await import(`./usage?t=${Date.now()}`)
    const result = await fresh.summarizeUsage(baseUsage, "gen_retry")
    // Should succeed eventually (2nd attempt)
    expect(result.cost).toBeCloseTo(0.0099)
    expect(calls).toBeGreaterThanOrEqual(2)
  }, 10_000)

  test("always-failing gateway → cost is undefined, no throw", async () => {
    mock.module("ai", () => ({
      gateway: {
        getGenerationInfo: async () => {
          throw new Error("gateway down")
        },
      },
    }))

    const fresh = await import(`./usage?t=${Date.now()}`)
    const result = await fresh.summarizeUsage(baseUsage, "gen_fail")
    expect(result.cost).toBeUndefined()
    // Numeric fields still populated
    expect(result.inputTokens).toBe(100)
  }, 10_000)
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

    expect(spy).toHaveBeenCalledTimes(1)

    // Reconstruct what was logged — chalk wraps in ANSI codes so join all args
    const logged = spy.mock.calls[0].join(" ")
    expect(logged).toContain("run 1")
    expect(logged).toContain("in=")
    expect(logged).toContain("out=")
    expect(logged).toContain("$")

    spy.mockRestore()
  })
})
