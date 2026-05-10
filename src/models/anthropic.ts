import chalk from "chalk"

import { streamText } from "ai"

import { checkRollingSolution } from "./rolling"
import { addUsage, printUsage, summarizeUsage, zeroUsage } from "./usage"
import type { ClaudeTestOptions, TestResult } from "./types"

/**
 * Compute the assistant prefill for a continuation after an overflow.
 *
 * Without a boundary regex, returns `completed` (the new chunk minus its
 * last incomplete line) — same behavior as before this helper existed.
 *
 * With a boundary regex, returns the suffix of `fullTrace` starting at
 * the last boundary match. This makes the resumed prefill cover a complete
 * in-flight step even when the API cut landed inside one. The boundary
 * regex must match at the start of a line (use the `m` flag).
 */
export function sliceContinuationPrefill(
  fullTrace: string,
  completed: string,
  continueBoundary: RegExp | undefined
): string {
  if (!continueBoundary) return completed
  const flags = continueBoundary.flags.includes("g")
    ? continueBoundary.flags
    : continueBoundary.flags + "g"
  const re = new RegExp(continueBoundary.source, flags)
  let lastMatch = -1
  for (const m of fullTrace.matchAll(re)) lastMatch = m.index ?? -1
  return lastMatch >= 0 ? fullTrace.slice(lastMatch) : completed
}

export async function testWithClaude({
  system,
  messages,
  max_tokens,
  model = "anthropic/claude-opus-4.6",
  temperature = 0,
  main = false,
  startToken,
  solution,
  continueBoundary,
}: ClaudeTestOptions): Promise<TestResult> {
  let responseCount = 0
  let runUsage = zeroUsage()
  const chunkUsages: ReturnType<typeof summarizeUsage>[] = []

  // Rolling prefill: every continuation sends exactly
  //   { system (cached), messages: [...initial, { assistant: lastChunk }] }
  // where lastChunk is the previous call's output (truncated to last
  // complete line). No cacheControl on messages — only the system has a
  // breakpoint. The trace itself contains enough state (REFRESH operands,
  // running carry/sum) to continue from the last chunk alone; earlier
  // chunks are not re-sent. Full trace is reassembled client-side for
  // the final return value.
  let lastChunk = ""
  let fullTrace = ""

  // Keep system byte-stable across continuations so the breakpoint stays
  // valid. Optionally append a BEGIN RESPONSE WITH instruction on the
  // first call only; the instruction is encoded once and never mutated.
  const effectiveSystem = startToken && system
    ? `${system}\n---\nBEGIN RESPONSE WITH: ${startToken}\n`
    : system

  const systemMessage = effectiveSystem
    ? {
      role: "system" as const,
      content: effectiveSystem,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" as const } },
      },
    }
    : undefined

  while (true) {
    console.log()
    console.log(chalk.bold(chalk.yellow(`Response ${responseCount + 1}:`)))
    console.log()

    // Opus 4.6+ rejects assistant-terminal prefill ("conversation must end
    // with a user message"). So on continuation we send the last chunk as
    // an assistant turn and append a user CONTINUE prompt. The lastChunk
    // replaces (not appends) — messages never grow beyond 3 entries.
    const callMessages = lastChunk
      ? [
        ...messages,
        { role: "assistant" as const, content: lastChunk },
        { role: "user" as const, content: "CONTINUE" },
      ]
      : messages

    // `output` tracks the FULL trace client-side (for the rolling solution
    // check, which compares the trace from START). The API only ever sees
    // `lastChunk` as the prefill — never the full trace.
    let output = fullTrace

    const result = streamText({
      model,
      messages: callMessages,
      ...(systemMessage && { system: systemMessage }),
      maxOutputTokens: max_tokens || 4096,
      temperature,
      providerOptions: {
        anthropic: { thinking: { type: "disabled" } },
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
    chunkUsages.push(chunkUsage)

    if (overflow) {
      // Drop the last (incomplete) line; the model will recompute it.
      // Everything before it is a clean suffix of the trace.
      const completed = text.split("\n").slice(0, -1).join("\n") + "\n"
      fullTrace += completed
      lastChunk = sliceContinuationPrefill(fullTrace, completed, continueBoundary)

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
      text: fullTrace + text,
      metadata: { finishReason, usage: runUsage, chunks: chunkUsages },
    }
  }
}
