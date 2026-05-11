export interface ProgramConfig {
  temperature?: number
  maxTokens?: number
  /** Full gateway model slug used when no slug is passed on the CLI. e.g. "anthropic/claude-opus-4.6". */
  defaultModel: string
  /** Optional preamble prepended to the system message (training tape).
   *  Byte-stable across continuations, so caching is preserved. Useful for
   *  forbidding prose / "narration drift" via an explicit directive that
   *  appears in the system on every call. */
  systemPreamble?: string
  /** Optional stop sequences passed to the model. When generated, the
   *  model halts after emitting the sequence. Used to terminate the
   *  trace at an explicit end-of-program marker (e.g. "DONE"). */
  stopSequences?: string[]
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
  generateTestInputs: (opts?: { extra?: string[]; flags?: Record<string, string>; n?: number }) => Args[]
  /** When true, the program's generateTestInputs interprets `-n` itself
   *  (e.g. as trials-per-rule) and the runner does NOT post-slice the
   *  returned list. When false/undefined (default), the runner caps the
   *  returned list to the first n inputs. */
  handleN?: boolean
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
  /** Optional anchor string used together with `continueBoundary`. A
   *  boundary match only qualifies as a slice point when this string
   *  appears later in the trace. Prevents slicing into an in-progress
   *  step (e.g. a FIRE row whose REFRESH block hasn't finished
   *  emitting yet); the slicer backs up to the previous qualifying
   *  boundary in that case. */
  continueAnchor?: string
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
  /** Optional: parse the model's trace at the end of a test and return
   *  a labeled set of lines to render. Useful for verifying that the
   *  model's output decodes to the mathematically-expected value and
   *  showing the formatted result (e.g. A × B = comma-formatted product).
   *  Return null/undefined to skip.
   *
   *  Args are widened to `readonly string[]` here (rather than the
   *  program-specific `Args` tuple) so that `Program<[string,string]>`
   *  and `Program<[]>` both remain assignable to `Program<string[]>`
   *  in callers like `runProgram` — function-parameter contravariance
   *  rejects the narrower tuple types otherwise. */
  postTest?: (args: readonly string[], trace: string) => Array<[string, string]> | null | undefined
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
