import chalk from "chalk"

import { streamText } from "ai"

import { checkRollingSolution } from "./rolling"
import { addUsage, printUsage, summarizeUsage, zeroUsage } from "./usage"
import type { ClaudeTestOptions, TestResult } from "./types"

export async function testWithClaude({
  system,
  messages,
  max_tokens,
  model = "anthropic/claude-opus-4.6",
  temperature = 0,
  main = false,
  startToken,
  solution,
}: ClaudeTestOptions): Promise<TestResult> {
  let responseCount = 0
  let runUsage = zeroUsage()

  while (true) {
    console.log()
    console.log(chalk.bold(chalk.yellow(`Response ${responseCount + 1}:`)))
    console.log()

    const assistantMessages = messages.filter(({ role }) => role === "assistant")

    /**
     * Select last {responseCount} assistant messages.
     */
    const priorContent =
      assistantMessages
        .slice(assistantMessages.length - responseCount)
        .map(({ content }) =>
          typeof content === "string"
            ? content
            : content
              .map((part) => (part.type === "text" ? part.text : ""))
              .join("")
        )
        .join("")

    /**
     * Keep the system content byte-stable across continuations so the
     * cache_control marker stays valid. We *don't* drop the BEGIN RESPONSE
     * WITH instruction on iter > 0 the way we used to — that would mutate
     * the system content between iterations and bust the cache.
     */
    const effectiveSystem = startToken && system
      ? `${system}\n---\nBEGIN RESPONSE WITH: ${startToken}\n`
      : system

    let output = priorContent

    // Pass the training tape as a SystemModelMessage with an explicit
    // anthropic cache_control marker. The top-level system: field accepts
    // string | SystemModelMessage | SystemModelMessage[], so we can attach
    // providerOptions without putting it inside `messages` (which would
    // trigger the SDK's prompt-injection warning).
    const systemMessage = effectiveSystem
      ? {
        role: "system" as const,
        content: effectiveSystem,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" as const } },
        },
      }
      : undefined

    const result = streamText({
      model,
      messages,
      ...(systemMessage && { system: systemMessage }),
      maxOutputTokens: max_tokens || 4096,
      temperature,
      providerOptions: {
        gateway: { caching: "auto" },
        anthropic: {
          thinking: { type: "disabled" },
        },
      },
    })

    let failedResult: TestResult | null = null

    for await (const text of result.textStream) {
      output += text
      if (main) {
        process.stdout.write(text)
      }

      const correct = checkRollingSolution(output, solution)
      if (!correct) {
        failedResult = { pass: false, text: output, metadata: null }
        break
      }
    }

    if (failedResult) {
      return failedResult
    }

    const finishReason = await result.finishReason
    const usage = await result.usage
    const providerMetadata = await result.providerMetadata
    const text = await result.text
    const overflow = finishReason === "length"

    const chunkUsage = summarizeUsage(usage, providerMetadata)
    runUsage = addUsage(runUsage, chunkUsage)

    if (overflow) {
      /**
       * Drop the last line from an incomplete response.
       */
      const completed = text.split("\n").slice(0, -1).join("\n")
      // Mark the assistant continuation with cacheControl so the next call
      // can read its prior partial response from cache instead of
      // re-processing it. Combined with the stable system above, the entire
      // prefix prior to "CONTINUE" stays cache-resident.
      messages.push(
        {
          role: "assistant",
          content: `${completed}\n`,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" as const } },
          },
        },
        { role: "user", content: "CONTINUE" }
      )

      console.log("\n")
      console.log(chalk.gray("Continuing response."))
      printUsage(`chunk ${responseCount + 1}`, chunkUsage, runUsage)
      console.log(chalk.bold(chalk.yellow("Waiting 10s...")))

      await new Promise(resolve => setTimeout(resolve, 10_000))
      responseCount++
      continue
    }

    return {
      pass: true,
      text,
      metadata: { finishReason, usage: runUsage },
    }
  }
}
