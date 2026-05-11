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
 * the last boundary match. The boundary regex must match at the start of
 * a line (use the `m` flag).
 *
 * If `continueAnchor` is provided, a boundary match only qualifies when
 * `continueAnchor` appears somewhere in `fullTrace` AFTER the match.
 * This avoids slicing into a boundary whose step is still in progress
 * (e.g. a FIRE row whose REFRESH block hasn't finished emitting yet).
 * In that case we back up to the previous qualifying boundary.
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
  let lastMatch = -1
  for (const m of fullTrace.matchAll(re)) {
    const idx = m.index ?? -1
    if (idx < 0) continue
    if (continueAnchor) {
      const after = idx + m[0].length
      if (fullTrace.indexOf(continueAnchor, after) === -1) continue
    }
    lastMatch = idx
  }
  return lastMatch >= 0 ? fullTrace.slice(lastMatch) : completed
}

export async function testWithClaude({
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
  // Warm-start: pre-populate fullTrace and derive lastChunk via the
  // slicer so the first API call already sends an assistant prefill +
  // CONTINUE, exactly as if a prior call had overflowed. Skips the
  // model having to regenerate the warmPrefill rows from scratch.
  let fullTrace = warmPrefill ?? ""
  let lastChunk = warmPrefill
    ? sliceContinuationPrefill(fullTrace, fullTrace, continueBoundary, continueAnchor)
    : ""
  const stackedMessages: ModelMessage[] = [...messages]

  // System is byte-stable across every call (no per-call instruction
  // appended). The training tape contains many full trace examples, so
  // the model emits the correct first token (e.g. CHUNK=2) from its
  // in-context prior — no explicit BEGIN RESPONSE WITH needed. This
  // keeps every call's cache breakpoint identical: one write on call 1,
  // cache reads on every continuation.
  const systemMessage = system
    ? {
      role: "system" as const,
      content: system,
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
