export interface ProgramConfig {
  temperature?: number
  maxTokens?: number
  /** Full gateway model slug used when no slug is passed on the CLI. e.g. "anthropic/claude-opus-4.6". */
  defaultModel: string
}

/**
 * A complete in-context-learning experiment. Each program defines:
 *   - an evaluator that produces the algorithm's trace ([ASSISTANT] half)
 *   - a list of training inputs (each becomes a [USER]/[ASSISTANT] block in train.txt)
 *   - a generator for test inputs (rows of tests.jsonl)
 *   - model + budget config
 *
 * `Args` is the tuple of strings each evaluator accepts and each training/test
 * row provides. Default is string[].
 */
export interface Program<Args extends readonly string[] = string[]> {
  name: string
  /** Produces the trace. Same string the model rolling-checks against. */
  evaluate: (...args: Args) => string | Promise<string>
  /** Each tuple becomes one [USER]/[ASSISTANT] block in the training tape. */
  trainingInputs: Args[]
  /** Returns the [USER] inputs to feed at test time. Called once per run.
   *  Receives trailing positional args from the CLI (e.g. arithmetic-2026
   *  reads `extra[0]` / `extra[1]` as the digit counts for A and B), plus
   *  any unknown `--key=value` flags via `flags` (e.g. `flags.chunk`).
   *  The lib caps the returned array to `-n N` if the user passes one. */
  generateTestInputs: (opts?: { extra?: string[]; flags?: Record<string, string> }) => Args[]
  /** Optional: format args as the [USER] block content. Default: args.join("\n"). */
  encode?: (...args: Args) => string
  /** Optional: human-friendly representation of one arg for the run banner table
   *  (e.g. decimal for a hex arg). Receives the raw arg string and its index. */
  display?: (arg: string, index: number) => string
  /** Optional: regex marking the start of an atomic step in the trace.
   *  On overflow / continuation, the assistant prefill is sliced from the
   *  last match in the full trace — so the model always resumes with a
   *  complete in-flight step in context, even when the cut landed mid-step.
   *  Must be a multiline (`m` flag) regex that matches at line start.
   *  Only consulted when continuationMode === "trim". */
  continueBoundary?: RegExp
  /** How to assemble messages across overflow continuations.
   *
   *  - "trim" (default): replace the assistant prefill each continuation
   *    with a single chunk derived from the latest output (sliced from
   *    `continueBoundary` when set). Messages stay at 3 entries. Cheap
   *    but discards earlier chunks — risky for very long traces where
   *    pattern calibration across many prior steps matters.
   *
   *  - "stack": append each completed chunk as its own assistant message
   *    with an anthropic ephemeral cacheControl marker. Messages grow:
   *    [user, asst(c1), user(CONT), asst(c2), user(CONT), ...]. The full
   *    trace stays in context on every call; gateway auto-caching keeps
   *    cost low because every prior chunk is cache-resident. Use for
   *    long traces (128-digit cross-memo, 32-digit kara-memo) where the
   *    model needs the full prior pattern to disambiguate continuation. */
  continuationMode?: "trim" | "stack"
  config: ProgramConfig
}

/**
 * Identity helper for type inference. Use:
 *   defineProgram({ name, evaluate, ... })
 */
export function defineProgram<Args extends readonly string[]>(
  p: Program<Args>
): Program<Args> {
  return p
}
