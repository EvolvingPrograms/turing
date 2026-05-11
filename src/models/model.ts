import chalk from "chalk"

import { streamText } from "ai"
import type { ModelMessage } from "ai"

import { checkRollingSolution } from "./rolling"
import { addUsage, printUsage, summarizeUsage, zeroUsage } from "./usage"
import type { ModelTestOptions, TestResult } from "./types"

/**
 * Compute the assistant prefill for a continuation after an overflow.
 *
 * Without a boundary regex, returns `completed` (the new chunk minus
 * its last incomplete line). With a boundary regex, returns the suffix
 * of `fullTrace` starting at the last qualifying boundary match.
 *
 * `continueAnchor`: a boundary match only qualifies when this string
 * appears in `fullTrace` AFTER the match — avoids slicing into an
 * in-progress step.
 *
 * When there's a prelude (content before the first qualifying
 * boundary), inject it at the head of the returned prefill with a
 * `<HISTORY_TRUNCATED>` marker line, so the model sees the trace's
 * actual first line (e.g. `CHUNK=2` + memoization table) without
 * needing to re-send the omitted middle.
 */
export function sliceContinuationPrefill(
  fullTrace: string,
  completed: string,
  continueBoundary: RegExp | undefined,
  continueAnchor?: string
): string {
  if (!continueBoundary) return completed
  const flags = continueBoundary.flags.includes("g")
    ? continueBoundary.flags
    : continueBoundary.flags + "g"
  const re = new RegExp(continueBoundary.source, flags)
  let firstMatch = -1
  let lastMatch = -1
  for (const m of fullTrace.matchAll(re)) {
    const idx = m.index ?? -1
    if (idx < 0) continue
    if (continueAnchor) {
      const after = idx + m[0].length
      if (fullTrace.indexOf(continueAnchor, after) === -1) continue
    }
    if (firstMatch < 0) firstMatch = idx
    lastMatch = idx
  }
  if (lastMatch < 0) return completed
  if (firstMatch === 0 || firstMatch === lastMatch) {
    return fullTrace.slice(lastMatch)
  }
  const prelude = fullTrace.slice(0, firstMatch)
  const slice = fullTrace.slice(lastMatch)
  return `${prelude}<HISTORY_TRUNCATED>\n${slice}`
}

/**
 * Build provider-specific options to disable a model's internal
 * reasoning/thinking by default. For models without a known reasoning
 * toggle returns an empty object — those models either don't reason
 * internally or there is no recognized way to disable it. The slug
 * prefix (the part before the first slash) is the provider key.
 *
 * Recognized providers and their disable shapes:
 *   anthropic: providerOptions.anthropic.thinking = { type: "disabled" }
 *   openai:    providerOptions.openai.reasoningEffort = "none"  (or
 *              caller-supplied effort level for models that need a
 *              specific minimum, e.g. gpt-5 wants "minimal" not "none")
 *   deepseek:  providerOptions.deepseek.thinking = { type: "disabled" }
 *   google:    providerOptions.google.thinkingConfig.thinkingBudget = 0
 *              (Gemini 2.5; Gemini 3 ignores budget but accepts it)
 *
 * Add providers here as their reasoning toggles are discovered.
 */
export function disableReasoningOptions(
  modelSlug: string,
  opts?: { reasoningEffort?: string }
): Record<string, Record<string, unknown>> {
  const provider = modelSlug.split("/")[0]
  switch (provider) {
    case "anthropic":
      return { anthropic: { thinking: { type: "disabled" as const } } }
    case "openai":
      return { openai: { reasoningEffort: opts?.reasoningEffort ?? "none" } }
    case "deepseek":
      return { deepseek: { thinking: { type: "disabled" as const } } }
    case "google":
      return { google: { thinkingConfig: { thinkingBudget: 0 } } }
    default:
      return {}
  }
}

/**
 * Unified streaming test runner. Routes any gateway model slug
 * (`anthropic/...`, `openai/...`, etc.) and applies provider-specific
 * options based on the slug prefix. Streams output character-by-
 * character with rolling solution check, handles overflow via trim or
 * stack continuation, and accumulates usage across all chunks.
 */
export async function testWithModel({
  system,
  messages,
  max_tokens,
  model = "anthropic/claude-opus-4.6",
  temperature = 0,
  main = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  startToken: _startToken,
  solution,
  continueBoundary,
  continueAnchor,
  continuationMode = "trim",
  warmPrefill,
  stopSequences,
  reasoningEffort,
}: ModelTestOptions): Promise<TestResult> {
  let responseCount = 0
  let runUsage = zeroUsage()
  const chunkUsages: ReturnType<typeof summarizeUsage>[] = []

  // Provider detection from the slug.
  const isAnthropic = typeof model === "string" && model.startsWith("anthropic/")

  // Warm-start: pre-populate fullTrace and derive lastChunk via the
  // slicer so the first API call already sends an assistant prefill +
  // CONTINUE, exactly as if a prior call had overflowed.
  let fullTrace = warmPrefill ?? ""
  let lastChunk = warmPrefill
    ? sliceContinuationPrefill(fullTrace, fullTrace, continueBoundary, continueAnchor)
    : ""
  const stackedMessages: ModelMessage[] = [...messages]

  // System is byte-stable across every call (no per-call instruction
  // appended) so gateway / provider caching keeps the training tape
  // cache-resident. The anthropic cacheControl marker is a belt-and-
  // suspenders hint that other providers ignore.
  const systemMessage = system
    ? {
      role: "system" as const,
      content: system,
      providerOptions: isAnthropic
        ? { anthropic: { cacheControl: { type: "ephemeral" as const } } }
        : undefined,
    }
    : undefined

  // Provider-specific per-call options. Gateway auto-caching applies
  // across all providers. For reasoning-capable models we default to
  // "thinking off" so the model emits visible output immediately
  // rather than burning the output budget on internal reasoning
  // tokens — deterministic-trace tasks transcribe/compute, they don't
  // reason. The shape of "thinking off" varies by provider; see
  // disableReasoningOptions().
  const providerOptions = {
    gateway: { caching: "auto" as const },
    ...disableReasoningOptions(typeof model === "string" ? model : "", { reasoningEffort }),
  }

  while (true) {
    console.log()
    console.log(chalk.bold(chalk.yellow(`Response ${responseCount + 1}:`)))
    console.log()

    // Most modern models reject assistant-terminal prefill — every
    // call must end with a user message. We assemble accordingly.
    let callMessages: ModelMessage[]
    if (continuationMode === "stack") {
      callMessages = stackedMessages
    } else {
      callMessages = lastChunk
        ? [
          ...messages,
          { role: "assistant" as const, content: lastChunk },
          { role: "user" as const, content: "CONTINUE" },
        ]
        : messages
    }

    // `output` tracks the FULL trace client-side (for the rolling
    // solution check, which compares the trace from START).
    let output = fullTrace

    const result = streamText({
      model,
      messages: callMessages,
      ...(systemMessage && { system: systemMessage }),
      maxOutputTokens: max_tokens || 4096,
      temperature,
      ...(stopSequences && stopSequences.length > 0 && { stopSequences }),
      providerOptions,
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
    chunkUsages.push(chunkUsage)

    if (overflow) {
      const completed = text.split("\n").slice(0, -1).join("\n") + "\n"
      fullTrace += completed

      if (continuationMode === "stack") {
        stackedMessages.push(
          {
            role: "assistant",
            content: completed,
            providerOptions: isAnthropic
              ? { anthropic: { cacheControl: { type: "ephemeral" as const } } }
              : undefined,
          },
          { role: "user", content: "CONTINUE" }
        )
      } else {
        lastChunk = sliceContinuationPrefill(fullTrace, completed, continueBoundary, continueAnchor)
      }

      console.log("\n")
      console.log(chalk.gray("Continuing response."))
      printUsage(`chunk ${responseCount + 1}`, chunkUsage, runUsage)
      console.log(chalk.bold(chalk.yellow("Waiting 1s...")))

      await new Promise(resolve => setTimeout(resolve, 1_000))
      responseCount++
      continue
    }

    return {
      pass: true,
      text: fullTrace + text,
      metadata: { finishReason, usage: runUsage, chunks: chunkUsages },
    }
  }
}
