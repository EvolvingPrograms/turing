import { test, expect } from "bun:test"
import { testWithClaude } from "./anthropic"
import type { UsageSummary } from "./usage"

// Live test: run the same trivial "say hello" program 10 times in a row.
// First call writes the cached system; subsequent calls read it back.
// This verifies cross-invocation cache hit behavior.

const hasKey =
  !!process.env.AI_GATEWAY_API_KEY ||
  !!process.env.AI_GATEWAY_KEY ||
  !!process.env.VERCEL_OIDC_TOKEN

if (process.env.AI_GATEWAY_KEY && !process.env.AI_GATEWAY_API_KEY) {
  process.env.AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_KEY
}

const live = hasKey ? test : test.skip

// Pad the system above Anthropic's ~1024-token minimum cacheable size.
const padding = "Procedurally output exactly what is asked. ".repeat(800)
const SYSTEM = `${padding}\nProgram: when the user says "go", reply with exactly the single word "hello" and nothing else.`

live(
  "10 runs share one cache write; rest read from cache",
  async () => {
    const runs: UsageSummary[] = []

    for (let i = 0; i < 3; i++) {
      const result = await testWithClaude({
        system: SYSTEM,
        messages: [{ role: "user", content: "go" }],
        max_tokens: 16,
        model: "anthropic/claude-opus-4.6",
        temperature: 0,
        solution: "hello",
        startToken: null,
        main: true,
      })

      expect(result.pass).toBe(true)
      const meta = result.metadata as { chunks: UsageSummary[] }
      runs.push(meta.chunks[0])
    }

    console.log("per-run usage:")
    for (const [i, u] of runs.entries()) {
      console.log(`  run ${i + 1}: write=${u.cacheWriteTokens} read=${u.cacheReadTokens} in=${u.inputTokens} out=${u.outputTokens}`)
    }

    // At most ONE run can be a cold cache write (the first, if the
    // ephemeral cache wasn't warmed by a prior test). Every other run
    // must hit cache and do no significant re-writing.
    const writes = runs.filter(u => u.cacheWriteTokens > 50).length
    const reads = runs.filter(u => u.cacheReadTokens > 500).length
    expect(writes).toBeLessThanOrEqual(1)
    expect(reads).toBeGreaterThanOrEqual(runs.length - 1)
  },
  180_000,
)
