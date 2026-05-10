export interface ProgramConfig {
  temperature?: number
  maxTokens?: number
  models: Record<string, string>  // provider key -> gateway model slug
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
  /** Returns the [USER] inputs to feed at test time. Called once per run. */
  generateTestInputs: () => Args[]
  /** Optional: format args as the [USER] block content. Default: args.join("\n"). */
  encode?: (...args: Args) => string
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
