import { test, expect } from "bun:test"
import { testWithModel } from "./model"
import type { UsageSummary } from "./usage"

// Live test: run the same trivial "say hello" program N times in a row
// against each model. First call writes the cached system; subsequent
// calls read it back. Verifies cross-invocation cache-hit behavior is
// observable through the unified usage interface for both providers.

const hasKey =
  !!process.env.AI_GATEWAY_API_KEY ||
  !!process.env.AI_GATEWAY_KEY ||
  !!process.env.VERCEL_OIDC_TOKEN

if (process.env.AI_GATEWAY_KEY && !process.env.AI_GATEWAY_API_KEY) {
  process.env.AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_KEY
}

const live = hasKey ? test : test.skip

// Pad above both providers' minimum cacheable size (Anthropic ~1024
// tokens; OpenAI ~1024).
const padding = "Procedurally output exactly what is asked. ".repeat(800)
const SYSTEM = `${padding}\nProgram: when the user says "go", reply with exactly the single word "hello" and nothing else.`

const MODELS = [
  "anthropic/claude-opus-4.6",
  "openai/gpt-5.5",
] as const

for (const model of MODELS) {
  live(
    `${model}: cache write once, reads thereafter`,
    async () => {
      const runs: UsageSummary[] = []

      for (let i = 0; i < 3; i++) {
        const result = await testWithModel({
          system: SYSTEM,
          messages: [{ role: "user", content: "go" }],
          max_tokens: 16,
          model,
          temperature: 0,
          solution: "hello",
          startToken: null,
          main: true,
        })

        expect(result.pass).toBe(true)
        const meta = result.metadata as { chunks: UsageSummary[] }
        runs.push(meta.chunks[0])
      }

      console.log(`per-run usage (${model}):`)
      for (const [i, u] of runs.entries()) {
        console.log(`  run ${i + 1}: write=${u.cacheWriteTokens} read=${u.cacheReadTokens} in=${u.inputTokens} out=${u.outputTokens}`)
      }

      const writes = runs.filter(u => u.cacheWriteTokens > 50).length
      const reads = runs.filter(u => u.cacheReadTokens > 500).length
      if (model.startsWith("anthropic/")) {
        // Anthropic: explicit ephemeral cache write on the first call,
        // reads on every subsequent call.
        expect(writes).toBeLessThanOrEqual(1)
        expect(reads).toBeGreaterThanOrEqual(runs.length - 1)
      } else {
        // OpenAI: auto-cache. No explicit write tokens are reported
        // (writes stays 0). Reads are lazy — first hit may only appear
        // on call 3+. Require at least one hit across the runs.
        expect(reads).toBeGreaterThanOrEqual(1)
      }
    },
    180_000,
  )
}
