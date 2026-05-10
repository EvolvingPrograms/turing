import { test, expect } from "bun:test"
import { streamText } from "ai"

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
