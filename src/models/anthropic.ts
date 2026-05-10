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
     * Clear the start token instruction when continuing responses.
     */
    if (responseCount > 0) {
      startToken = null
    }

    let effectiveSystem = system
    if (startToken && effectiveSystem) {
      effectiveSystem = `${effectiveSystem}\n---\nBEGIN RESPONSE WITH: ${startToken}\n`
    }

    let output = priorContent

    const result = streamText({
      model,
      messages,
      maxOutputTokens: max_tokens || 4096,
      temperature,
      providerOptions: {
        gateway: { caching: "auto" },
        anthropic: {
          thinking: { type: "disabled" },
        },
      },
      ...(effectiveSystem && { system: effectiveSystem }),
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
    const response = await result.response
    const text = await result.text
    const overflow = finishReason === "length"

    const chunkUsage = await summarizeUsage(usage, response.id)
    runUsage = addUsage(runUsage, chunkUsage)

    if (overflow) {
      /**
       * Drop the last line from an incomplete response.
       */
      const completed = text.split("\n").slice(0, -1).join("\n")
      messages.push(
        { role: "assistant", content: `${completed}\n` },
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
