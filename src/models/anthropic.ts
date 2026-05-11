import chalk from "chalk"

import { streamText } from "ai"

import { checkRollingSolution } from "./rolling"
import { addUsage, printUsage, summarizeUsage, zeroUsage } from "./usage"
import type { ClaudeTestOptions, TestResult } from "./types"
import type { ModelMessage } from "ai"

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
  continuationMode = "trim",
}: ClaudeTestOptions): Promise<TestResult> {
  let responseCount = 0
  let runUsage = zeroUsage()
  const chunkUsages: ReturnType<typeof summarizeUsage>[] = []

  // Two continuation modes:
  //
  //  "trim": every continuation sends exactly 3 messages —
  //    { system (cached), [initial user, assistant: lastChunk, user: CONTINUE] }
  //    lastChunk REPLACES each iteration (sliced from continueBoundary when set).
  //    Cheap, but earlier chunks are not in context. Risky for long traces.
  //
  //  "stack": each completed chunk is APPENDED as its own assistant message
  //    with an anthropic ephemeral cacheControl marker, followed by a CONTINUE
  //    user turn. Messages grow:
  //      [user, asst(c1,cache), user(CONT), asst(c2,cache), user(CONT), ...]
  //    Gateway auto-caching keeps cost low because every prior chunk is
  //    cache-resident. The full trace stays in context on every call.
  //
  // In both modes, the full trace is reassembled client-side for solution
  // checking and the final return value.
  let lastChunk = ""
  let fullTrace = ""
  const stackedMessages: ModelMessage[] = [...messages]

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

    // Opus 4.6+ rejects assistant-terminal prefill — every call must end
    // with a user message. We assemble accordingly per mode.
    let callMessages: ModelMessage[]
    if (continuationMode === "stack") {
      // `stackedMessages` already contains the full conversation history,
      // including any prior asst(chunk N) + user(CONTINUE) pairs appended
      // by the overflow branch below.
      callMessages = stackedMessages
    } else {
      // Trim mode: 3 messages, last assistant chunk + CONTINUE.
      callMessages = lastChunk
        ? [
          ...messages,
          { role: "assistant" as const, content: lastChunk },
          { role: "user" as const, content: "CONTINUE" },
        ]
        : messages
    }

    // `output` tracks the FULL trace client-side (for the rolling solution
    // check, which compares the trace from START).
    let output = fullTrace

    const result = streamText({
      model,
      messages: callMessages,
      ...(systemMessage && { system: systemMessage }),
      maxOutputTokens: max_tokens || 4096,
      temperature,
      providerOptions: {
        anthropic: { thinking: { type: "disabled" } },
        // In stack mode the conversation grows; rely on gateway auto-cache
        // to keep cost flat across continuations. Per-chunk cacheControl
        // markers are attached in the overflow branch below.
        ...(continuationMode === "stack" && { gateway: { caching: "auto" as const } }),
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

      if (continuationMode === "stack") {
        // Append this chunk as its own assistant turn with a cache marker,
        // then a CONTINUE user turn. Subsequent calls see the entire
        // accumulated history; gateway auto-cache keeps cost flat.
        stackedMessages.push(
          {
            role: "assistant",
            content: completed,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" as const } },
            },
          },
          { role: "user", content: "CONTINUE" }
        )
      } else {
        lastChunk = sliceContinuationPrefill(fullTrace, completed, continueBoundary)
      }

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
