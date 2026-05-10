import type { LanguageModelUsage, ProviderMetadata } from "ai"
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
 * Pull cost (USD) from gateway-provided providerMetadata. The gateway returns
 * cost as a string (e.g. "0.000265") in providerMetadata.gateway.cost on every
 * response — no extra HTTP roundtrip needed. Falls back to undefined if the
 * field isn't present (e.g. running against a non-gateway provider).
 */
function extractCost(providerMetadata?: ProviderMetadata): number | undefined {
  const raw = providerMetadata?.gateway?.cost
  if (typeof raw === "string") {
    const n = parseFloat(raw)
    return Number.isFinite(n) ? n : undefined
  }
  if (typeof raw === "number") return raw
  return undefined
}

export function summarizeUsage(
  usage: LanguageModelUsage,
  providerMetadata?: ProviderMetadata
): UsageSummary {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
    cost: extractCost(providerMetadata),
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

function fmtTokens(u: UsageSummary): string {
  const cache =
    u.cacheReadTokens || u.cacheWriteTokens
      ? ` cache(read=${longFormat(u.cacheReadTokens)} write=${longFormat(u.cacheWriteTokens)})`
      : ""
  const reasoning = u.reasoningTokens
    ? ` reasoning=${longFormat(u.reasoningTokens)}`
    : ""
  const cost = u.cost !== undefined ? ` ${usd(u.cost)}` : ""
  return `in=${longFormat(u.inputTokens)} out=${longFormat(u.outputTokens)}${cache}${reasoning}${cost}`
}

export function printUsage(label: string, run: UsageSummary, total: UsageSummary) {
  // Leading newline: the model's streamed RETURN line above doesn't end in \n,
  // so the per-run summary would otherwise collide with it.
  console.log()
  console.log(chalk.gray(`[${label}] ${fmtTokens(run)}`))
  console.log(chalk.gray(`[cum]     ${fmtTokens(total)}`))
}
