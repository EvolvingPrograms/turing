import { testWithClaude, testWithGPT } from "./models"
import { addUsage, printUsage, zeroUsage, type UsageSummary } from "./models/usage"
import type { Config, Test } from "./types"
import { loadJSONFile, loadJSONLFile, loadModuleFile, loadTextFile } from "./utils"
import { tqdm } from "./progress"
import { backoff } from "./backoff"

const MODEL = process.argv[2] || "openai"

const prompt = await loadTextFile("train.txt")
const config = await loadJSONFile<Config>("config.json")
const tests = await loadJSONLFile<Test>("tests.jsonl")

const resolvedModel = config.models[MODEL]
if (!resolvedModel) {
  throw new Error(
    `Unknown provider key "${MODEL}". Available: ${Object.keys(config.models).join(", ")}`
  )
}

console.log(`Provider key: ${MODEL}`)
console.log(`Resolved model: ${resolvedModel}`)
console.log(`Tests: ${tests.length}`)

async function runChallenge(test: Test, worker: number) {
  const { default: evaluator } = await loadModuleFile("eval.ts")
  if (!evaluator) {
    throw new Error("Failed to load the evaluator.")
  }  

  const model = config.models[MODEL]
  const main = worker === 0

  const { input } = test
  const args = input.trim().split("\n")

  const solution = await evaluator(...args, true)

  /**
   * We dope the context with a start token from the examples, and induce the
   * model to respond without deviating from the example format at any point.
   * 
   * This token will usually be TAPE, but it is done dynamically here so it's
   * more extensible in the future.
   */
  const startToken = solution.split("\n")?.[0].split(" ")?.[0]
  if (!startToken) {
    throw new Error("Failed to find a start token in the solution. We use the first word of the solution.")
  }

  const params = { model, debug: true, worker, main, ...config }

  console.log()
  console.table(args)
  console.table({ startToken })
  console.table(params)
  console.log(`Starting worker ${worker}...`)

  const startTest = model.startsWith("openai/") ? testWithGPT : testWithClaude
  const { pass, metadata } = await startTest({
    system: prompt,
    startToken,
    messages: [{ role: "user", content: input }],
    solution,
    ...params 
  })

  return {
    pass,
    metadata
  }
}

async function runBatch(start: number, n: number) {
  const promises: ReturnType<typeof runChallenge>[] = []
  for (let i = 0; i < n; i++) {
    promises.push(
      backoff(() => runChallenge(tests[start + i], i))
    )
  }

  return await Promise.all(promises)
}

export async function test(batchSize = 1, waitTime = 60) {
  let correct = 0
  let totalUsage = zeroUsage()
  const runs = tests.length
  const numBatches = Math.ceil(runs / batchSize)

  const indexes = new Array(numBatches).keys()
  for (const batch of tqdm(indexes)) {
    if (batch > 0) {
      console.log()
      console.log(`${waitTime} second cooldown...`)
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
    }

    const start = batch * batchSize
    const end = Math.min(start + batchSize, runs)
    const remainingRuns = runs - start
    const adjustedBatchSize = Math.min(batchSize, remainingRuns)

    const results = await runBatch(start, adjustedBatchSize)
    await new Promise(resolve => setTimeout(resolve, 1000))

    for (const [i, result] of results.entries()) {
      const { pass, metadata } = result
      if (pass) correct++

      const runUsage =
        metadata && typeof metadata === "object" && "usage" in metadata
          ? (metadata as { usage: UsageSummary }).usage
          : undefined

      if (runUsage) {
        totalUsage = addUsage(totalUsage, runUsage)
        printUsage(`run ${start + i + 1}`, runUsage, totalUsage)
      }
    }

    const Test = `${end} / ${runs}`
    const Correct = `${correct} / ${end}`
    const Accuracy = `${(correct / end).toFixed(2)}`

    console.log()
    console.table({ Test, Correct, Accuracy })
    console.log()
  }

  console.log("")
  console.log("--- Final score ---")
  console.log(`${correct} / ${runs} (${(100 * correct / runs).toFixed(2)}%)`)
  if (totalUsage.cost !== undefined) {
    console.log(`Total cost: $${totalUsage.cost.toFixed(4)}`)
  }
  console.log(`Total tokens: in=${totalUsage.inputTokens} out=${totalUsage.outputTokens} cache(read=${totalUsage.cacheReadTokens} write=${totalUsage.cacheWriteTokens})`)
  console.log()
}