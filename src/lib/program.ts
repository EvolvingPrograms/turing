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
