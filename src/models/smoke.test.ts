import { test, expect } from "bun:test"
import { streamText } from "ai"
import { readFileSync } from "fs"
import { resolve } from "path"

const hasKey =
  !!process.env.AI_GATEWAY_API_KEY ||
  !!process.env.AI_GATEWAY_KEY ||
  !!process.env.VERCEL_OIDC_TOKEN

const live = hasKey ? test : test.skip

if (process.env.AI_GATEWAY_KEY && !process.env.AI_GATEWAY_API_KEY) {
  process.env.AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_KEY
}

live(
  "claude-opus-4.7 via gateway returns a response",
  async () => {
    if (process.env.AI_GATEWAY_KEY && !process.env.AI_GATEWAY_API_KEY) {
      process.env.AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_KEY
    }

    const result = streamText({
      model: "anthropic/claude-opus-4.7",
      messages: [{ role: "user", content: "Reply with exactly the word: pong" }],
      maxOutputTokens: 64,
      temperature: 0,
      providerOptions: {
        gateway: { caching: "auto" },
        anthropic: {
          thinking: { type: "disabled" },
        },
      },
    })

    let streamed = ""
    for await (const chunk of result.textStream) {
      streamed += chunk
    }

    const text = await result.text
    const finishReason = await result.finishReason
    const usage = await result.usage
    const response = await result.response
    const providerMetadata = await result.providerMetadata

    console.log({
      text,
      finishReason,
      streamed,
      modelId: response.modelId,
      usage,
      providerMetadata,
    })

    expect(text.length).toBeGreaterThan(0)
    expect(streamed).toBe(text)
    expect(finishReason).toBe("stop")
  },
  60_000
)

live(
  "claude-opus-4.7 via gateway with full arithmetic-tape system prompt",
  async () => {
    const trainPath = resolve(import.meta.dir, "../../programs/arithmetic-tape/train.txt")
    const testsPath = resolve(import.meta.dir, "../../programs/arithmetic-tape/tests.jsonl")

    const system = readFileSync(trainPath, "utf-8").trim()
    const firstTest = readFileSync(testsPath, "utf-8")
      .trim()
      .split("\n")[0]
    const { input } = JSON.parse(firstTest) as { input: string }

    console.log(`system bytes: ${system.length}`)
    console.log(`first test input:\n${input}`)

    const result = streamText({
      model: "anthropic/claude-opus-4.7",
      system,
      messages: [{ role: "user", content: input }],
      maxOutputTokens: 4096,
      providerOptions: {
        gateway: { caching: "auto" },
        anthropic: {
          thinking: { type: "disabled" },
        },
      },
    })

    let streamed = ""
    for await (const chunk of result.textStream) {
      streamed += chunk
      process.stdout.write(chunk)
    }
    console.log()

    const text = await result.text
    const finishReason = await result.finishReason
    const usage = await result.usage
    const providerMetadata = await result.providerMetadata

    console.log({
      finishReason,
      streamedLen: streamed.length,
      textLen: text.length,
      usage,
      anthropic: providerMetadata?.anthropic,
      gateway: providerMetadata?.gateway,
    })

    expect(usage.outputTokens).toBeGreaterThan(0)
    // The diagnostic we care about: did the model emit reasoning tokens
    // despite thinking: { type: "disabled" }?
    expect(usage.outputTokenDetails?.reasoningTokens ?? 0).toBe(0)
  },
  120_000
)
