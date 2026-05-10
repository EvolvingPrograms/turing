import chalk from "chalk"

import { type OpenAIResponsesProviderOptions } from "@ai-sdk/openai"
import { generateText } from "ai"

import { substringEndsAt } from "./rolling"
import { summarizeUsage } from "./usage"
import type { GPTTestOptions, TestResult } from "./types"

export async function testWithGPT({
  system,
  messages,
  model = "openai/gpt-5",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  main = false,
  solution,
}: GPTTestOptions): Promise<TestResult> {
  const generation = await generateText({
    model: model || "openai/gpt-5",
    messages: [
      { role: "system", content: system || "You're a helpful assistant." },
      ...messages,
    ],
    maxOutputTokens: 4000,
    providerOptions: {
      gateway: { caching: "auto" },
      openai: {
        reasoningEffort: "high",
      } satisfies OpenAIResponsesProviderOptions,
    },
  })

  let { text } = generation
  const usageSummary = summarizeUsage(generation.usage, generation.providerMetadata)

  text = text.trim()
  solution = solution.trim()

  if (text !== solution) {
    console.log(chalk.bold(chalk.red("INCORRECT")))
    console.log(chalk.red("Output did not match solution."))

    const endsAt = substringEndsAt(text, solution)
    console.log(chalk.green.dim(text.slice(0, endsAt)) + chalk.red(text.slice(endsAt)))

    await Bun.write("text.txt", text)
    await Bun.write("solution.txt", solution)

    return {
      pass: false,
      text,
      metadata: { usage: usageSummary },
    }
  }

  console.log(chalk.bold(chalk.green("CORRECT")))
  console.log(chalk.green("Output exactly matched solution."))

  return {
    pass: true,
    text,
    metadata: { usage: usageSummary },
  }
}
