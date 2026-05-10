import { gateway } from "ai"
import type { LanguageModelUsage } from "ai"
import chalk from "chalk"

import { longFormat } from "../utils"

export type UsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** USD; populated when the gateway returns generation info. */
  cost?: number;
}

const ZERO: UsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
}

/**
 * The gateway needs a moment after a stream finishes before generation info is
 * available — we retry a small number of times. This is best-effort: if the
 * lookup fails we still return the local usage data.
 */
async function fetchCost(id: string, attempts = 4): Promise<number | undefined> {
  for (let i = 0; i < attempts; i++) {
    try {
      const info = await gateway.getGenerationInfo({ id })
      return info.totalCost
    } catch {
      await new Promise((r) => setTimeout(r, 250 * (i + 1)))
    }
  }
  return undefined
}

export async function summarizeUsage(
  usage: LanguageModelUsage,
  responseId?: string
): Promise<UsageSummary> {
  const cost = responseId ? await fetchCost(responseId) : undefined
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
    cost,
  }
}

export function addUsage(a: UsageSummary, b: UsageSummary): UsageSummary {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cost:
      a.cost === undefined && b.cost === undefined
        ? undefined
        : (a.cost ?? 0) + (b.cost ?? 0),
  }
}

export const zeroUsage = (): UsageSummary => ({ ...ZERO })

const usd = (n: number) => `$${n.toFixed(4)}`

export function printUsage(label: string, run: UsageSummary, total: UsageSummary) {
  const tokens = `in=${longFormat(run.inputTokens)} out=${longFormat(run.outputTokens)}`
  const cache =
    run.cacheReadTokens || run.cacheWriteTokens
      ? ` cache(read=${longFormat(run.cacheReadTokens)} write=${longFormat(run.cacheWriteTokens)})`
      : ""
  const reasoning = run.reasoningTokens
    ? ` reasoning=${longFormat(run.reasoningTokens)}`
    : ""
  const runCost = run.cost !== undefined ? ` ${usd(run.cost)}` : ""
  const totalCost =
    total.cost !== undefined ? ` (cum ${usd(total.cost)})` : ""

  console.log(chalk.gray(`[${label}] ${tokens}${cache}${reasoning}${runCost}${totalCost}`))
}
