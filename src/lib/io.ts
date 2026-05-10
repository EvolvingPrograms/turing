import { resolve } from "path"
import type { Program } from "./program"

/**
 * Default arg encoder: joins args with newlines.
 * Used when program.encode is not provided.
 */
export function defaultEncode(args: readonly string[]): string {
  return args.join("\n")
}

/**
 * Apply program.encode (or default) to one row of args.
 */
export function encodeArgs<Args extends readonly string[]>(
  program: Program<Args>,
  args: Args
): string {
  if (program.encode) {
    return program.encode(...args)
  }
  return defaultEncode(args)
}

/**
 * Generate the full training-tape text for a program by running every
 * training input through program.evaluate and stitching [USER]/[ASSISTANT]
 * blocks. Returns the tape as a string (does not write to disk).
 */
export async function formatTrainingTape<Args extends readonly string[]>(
  program: Program<Args>
): Promise<string> {
  const blocks: string[] = []
  for (const args of program.trainingInputs) {
    const trace = await program.evaluate(...args)
    const user = encodeArgs(program, args)
    blocks.push(`[USER]\n${user}\n\n[ASSISTANT]\n${trace}\n\n`)
  }
  return blocks.join("")
}

/**
 * Generate the full test-set as JSONL text (one object per line, with
 * trailing newline). Calls program.generateTestInputs() once.
 * Returns the text (does not write to disk).
 */
export function formatTestSet<Args extends readonly string[]>(
  program: Program<Args>
): string {
  const inputs = program.generateTestInputs()
  return inputs.map((args) => JSON.stringify({ input: encodeArgs(program, args) })).join("\n") + "\n"
}

/**
 * Write the training tape to <programDir>/train.txt. Used in --debug mode.
 */
export async function writeTrainingTape<Args extends readonly string[]>(
  programDir: string,
  program: Program<Args>
): Promise<void> {
  const tape = await formatTrainingTape(program)
  await Bun.write(resolve(programDir, "train.txt"), tape)
}

/**
 * Write the test set to <programDir>/tests.jsonl. Used in --debug mode.
 */
export async function writeTestSet<Args extends readonly string[]>(
  programDir: string,
  program: Program<Args>
): Promise<void> {
  const jsonl = formatTestSet(program)
  await Bun.write(resolve(programDir, "tests.jsonl"), jsonl)
}
