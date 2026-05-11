import type { Program } from "./program"
import { formatTrainingTape, encodeArgs, writeTrainingTape, writeTestSet } from "./io"
import { testWithClaude, testWithGPT } from "../models"
import { addUsage, printUsage, zeroUsage, type UsageSummary } from "../models/usage"
import { tqdm } from "../progress"
import { backoff } from "../backoff"
import { resolve } from "path"
import chalk from "chalk"

// Pretty-print a key/value section without using console.table — tables
// look terrible when one of the values is a 145-digit number that wraps
// the entire terminal. Long single-line values are wrapped with hanging
// indent; multi-line values render each line indented under the label.
function printSection(title: string, rows: Array<[string, string]>) {
  const labelW = Math.max(...rows.map(([k]) => k.length))
  const cols = (process.stdout.columns ?? 100) - labelW - 4
  const wrap = (s: string, width: number): string[] => {
    if (s.length <= width) return [s]
    const out: string[] = []
    for (let i = 0; i < s.length; i += width) out.push(s.slice(i, i + width))
    return out
  }
  console.log(chalk.bold(chalk.cyan(title)))
  for (const [key, value] of rows) {
    const valueLines = value.split("\n").flatMap(ln => wrap(ln, Math.max(40, cols)))
    const label = `  ${chalk.bold(key.padEnd(labelW))}  `
    const indent = " ".repeat(label.length - (chalk.bold("").length))
    console.log(label + valueLines[0])
    for (let i = 1; i < valueLines.length; i++) {
      console.log(indent + valueLines[i])
    }
  }
}

export interface RunOptions {
  /** Provider key (e.g. "anthropic") OR a full slug containing "/" (e.g. "anthropic/claude-opus-4.6"). */
  modelKey?: string
  /** Tests to run in parallel. Default: 1. */
  batchSize?: number
  /** Cooldown seconds between batches. Default: 10. */
  waitTime?: number
  /** Run only the first N tests. Default: all. */
  n?: number
  /** When true, also write train.txt and tests.jsonl to programs/<name>/. Default: false. */
  debug?: boolean
  /** Trailing positional args after the model slug — program-specific.
   *  e.g. `bun programs/arithmetic-2026 anthropic/claude... 8 12` → ["8", "12"]. */
  extra?: string[]
  /** Unknown `--key=value` flags collected by parseArgs and forwarded to the
   *  program. Programs read whatever they care about (e.g. `flags.chunk`)
   *  without the lib needing to know about every per-program flag. */
  flags?: Record<string, string>
}

/**
 * Parse CLI flags from process.argv:
 *   bun programs/<name>/index.ts [model-key] [--batch=N] [--limit=N] [--debug]
 * The first non-flag positional arg is the model key.
 * Returns RunOptions populated from argv. Caller can pass overrides that take precedence.
 */
export function parseArgs(overrides?: Partial<RunOptions>): RunOptions {
  const result: RunOptions = { extra: [], flags: {} }

  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith("--")) {
      const flag = arg.slice(2)
      if (flag === "debug") {
        result.debug = true
      } else if (flag.startsWith("batch=")) {
        result.batchSize = parseInt(flag.slice(6), 10)
      } else if (flag.startsWith("n=")) {
        result.n = parseInt(flag.slice(2), 10)
      } else if (flag.startsWith("wait=")) {
        result.waitTime = parseInt(flag.slice(5), 10)
      } else {
        // Unknown --key=value flags get collected into result.flags so
        // programs can read them via opts.flags.<key> without the lib
        // having to know every per-program flag name. Boolean flags
        // (no `=`) get stored as "true".
        const eq = flag.indexOf("=")
        const key = eq === -1 ? flag : flag.slice(0, eq)
        const value = eq === -1 ? "true" : flag.slice(eq + 1)
        result.flags![key] = value
      }
    } else if (arg === "-n") {
      result.n = parseInt(argv[++i] ?? "", 10)
    } else if (result.modelKey === undefined) {
      result.modelKey = arg
    } else {
      result.extra!.push(arg)
    }
  }

  // Caller overrides take precedence
  return { ...result, ...overrides }
}

/**
 * Run a program end-to-end. Resolves CLI args via parseArgs(opts).
 */
export async function runProgram<Args extends readonly string[]>(
  program: Program<Args>,
  options?: RunOptions
): Promise<void> {
  const opts = parseArgs(options)

  // Require a full slug ("provider/model"). No legacy short-key lookup.
  const resolvedModel = opts.modelKey ?? program.config.defaultModel
  if (!resolvedModel.includes("/")) {
    throw new Error(
      `Model must be a full slug like "anthropic/claude-opus-4.6". Got: "${resolvedModel}". Pass on the CLI as the first positional argument.`
    )
  }

  const temperature = program.config.temperature ?? 0
  const max_tokens = program.config.maxTokens ?? 4096
  const batchSize = opts.batchSize ?? 1
  const waitTime = opts.waitTime ?? 10
  const debug = opts.debug ?? false

  // Generate test inputs and cap to -n if specified.
  let testInputs = program.generateTestInputs({
    extra: opts.extra,
    flags: opts.flags,
  })
  if (opts.n !== undefined) {
    testInputs = testInputs.slice(0, opts.n)
  }

  const runs = testInputs.length

  console.log(`Model: ${resolvedModel}`)
  console.log(`Tests: ${runs}`)

  // Format training tape in memory
  const trainingTape = await formatTrainingTape(program)
  // System content sent to the API: optional preamble + training tape.
  // Assembled here (not inside formatTrainingTape) so the training-tape
  // file written by --debug stays just the examples, and the API-call
  // payload is the thing that combines call-site directives with data.
  const systemContent = program.config.systemPreamble
    ? `${program.config.systemPreamble}\n\n${trainingTape}`
    : trainingTape

  // In debug mode, write tape and test set to disk
  if (debug) {
    const programDir = resolve(process.cwd(), "programs", program.name)
    await writeTrainingTape(programDir, program)
    await writeTestSet(programDir, program)
  }

  const startTest = resolvedModel.startsWith("openai/") ? testWithGPT : testWithClaude

  let correct = 0
  let totalUsage = zeroUsage()
  const numBatches = Math.ceil(runs / batchSize)
  const indexes = new Array(numBatches).keys()

  for (const batch of tqdm(indexes)) {
    if (batch > 0) {
      console.log()
      console.log(`${waitTime} second cooldown...`)
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000))
    }

    const start = batch * batchSize
    const end = Math.min(start + batchSize, runs)
    const adjustedBatchSize = end - start

    const promises: Promise<{ pass: boolean; metadata: unknown; text: string; args: string[] }>[] = Array.from({ length: adjustedBatchSize }, (_, i) => {
      const worker = i
      const args = testInputs[start + i]

      return backoff(async () => {
        const main = worker === 0
        const solution = await program.evaluate(...args)
        const input = encodeArgs(program, args)
        const messages = [{ role: "user" as const, content: input }]

        const startToken = solution.split("\n")?.[0].split(" ")?.[0]
        if (!startToken) {
          throw new Error(
            "Failed to find a start token in the solution. We use the first word of the solution."
          )
        }

        // --from=<k>: skip ahead. Pre-populate the trace with the
        // correct solution up to (but not including) the line that
        // says `RESUME k=<from> ...`. The model resumes by emitting
        // that line and continues from there. Lets you verify the
        // heaviest middle rows without waiting for the easy ramp-up.
        let warmPrefill: string | undefined
        const fromKStr = opts.flags?.from
        if (fromKStr !== undefined) {
          const fromK = parseInt(fromKStr, 10)
          if (!Number.isFinite(fromK)) {
            throw new Error(`--from=N must be an integer, got: ${fromKStr}`)
          }
          const lines = solution.split("\n")
          const resumeRe = /^RESUME k=(\d+)\b/
          let cut = -1
          for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(resumeRe)
            if (m && parseInt(m[1], 10) === fromK) { cut = i; break }
          }
          if (cut < 0) {
            throw new Error(`--from=${fromK}: no "RESUME k=${fromK}" found in solution`)
          }
          warmPrefill = lines.slice(0, cut).join("\n") + "\n"
        }

        const params = {
          model: resolvedModel,
          debug: true,
          worker,
          main,
          temperature,
          max_tokens,
        }

        console.log()
        console.log(chalk.bold(chalk.magenta(`── test ${start + i + 1}/${runs} (worker ${worker}) ──`)))
        for (let idx = 0; idx < args.length; idx++) {
          const arg = args[idx]
          const rows: Array<[string, string]> = []
          if (program.display) rows.push(["decimal", program.display(arg, idx)])
          rows.push(["raw", arg])
          // `input` is the full encoded user message; for multi-arg
          // programs the encoder may produce a single multi-line block
          // covering all args (with labels like A: / B: / R:). Show the
          // whole encoded block once under the first arg rather than
          // trying to slice it line-by-line.
          if (idx === 0) rows.push(["encoded", input])
          console.log()
          printSection(`Arg ${idx}`, rows)
        }
        console.log()
        printSection("Params", [
          ["model", String(params.model)],
          ["temperature", String(params.temperature)],
          ["max_tokens", String(params.max_tokens)],
          ["worker", String(params.worker)],
          ["startToken", String(startToken)],
          ...(warmPrefill ? [["warmStart", `from k=${opts.flags?.from} (${warmPrefill.length} chars pre-populated)`] as [string, string]] : []),
        ])
        console.log()
        console.log(chalk.dim(`Starting worker ${worker}...`))

        const result = await startTest({
          system: systemContent,
          startToken,
          messages,
          solution,
          continueBoundary: program.continueBoundary,
          continueAnchor: program.continueAnchor,
          continuationMode: program.continuationMode,
          warmPrefill,
          ...params,
        })

        return { pass: result.pass, metadata: result.metadata, text: result.text, args: [...args] as string[] }
      })
    })

    const results = await Promise.all(promises)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    for (const [i, result] of results.entries()) {
      const { pass, metadata, text, args } = result
      if (pass) correct++

      const runUsage =
        metadata && typeof metadata === "object" && "usage" in metadata
          ? (metadata as { usage: UsageSummary }).usage
          : undefined

      if (runUsage) {
        totalUsage = addUsage(totalUsage, runUsage)
        printUsage(`run ${start + i + 1}`, runUsage, totalUsage)
      }

      if (pass && program.postTest) {
        const rows = program.postTest(args as unknown as Args, text)
        if (rows && rows.length > 0) {
          console.log()
          printSection(`Test ${start + i + 1} verification`, rows)
        }
      }
    }

    const accuracy = (correct / end).toFixed(2)
    console.log()
    printSection("Progress", [
      ["Test", `${end} / ${runs}`],
      ["Correct", `${correct} / ${end}`],
      ["Accuracy", accuracy],
    ])
    console.log()
  }

  console.log("")
  console.log("--- Final score ---")
  console.log(`${correct} / ${runs} (${(100 * correct / runs).toFixed(2)}%)`)
  if (totalUsage.cost !== undefined) {
    console.log(`Total cost: $${totalUsage.cost.toFixed(4)}`)
  }
  console.log(
    `Total tokens: in=${totalUsage.inputTokens} out=${totalUsage.outputTokens} cache(read=${totalUsage.cacheReadTokens} write=${totalUsage.cacheWriteTokens})`
  )
  console.log()

  if (correct < runs) {
    process.exit(1)
  }
}
